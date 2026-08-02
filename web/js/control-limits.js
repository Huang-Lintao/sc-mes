/* ==========================================================================
 * MES 多孔碳 — 自定义规格控制限管理
 * 支持：区间值（lower/upper）和单边值（仅下限 / 仅上限）
 * 存储：localStorage，按 "产品|工序|检测项" 索引
 * ========================================================================== */
(function () {
  "use strict";
  const KEY = "mes.controlLimits.v1";

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function write(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
  }

  // 索引 = 产品|工序|检测项（同一指标可对不同产品/工序分别设置）
  function idx(product, stage, metric) {
    return [product || "*", stage || "*", metric || "*"].join("|");
  }

  // 取出对当前 (产品, 工序, 检测项) 生效的自定义限
  // 匹配规则：精确优先，否则用通配符 *
  function get(product, stage, metric) {
    const d = read();
    // 精确三级匹配
    const k1 = idx(product, stage, metric);
    if (d[k1]) return { ...d[k1], _key: k1 };
    // 产品|工序|*
    if (d[idx(product, stage, "*")]) return { ...d[idx(product, stage, "*")], _key: idx(product, stage, "*") };
    // 产品|*|指标
    if (d[idx(product, "*", metric)]) return { ...d[idx(product, "*", metric)], _key: idx(product, "*", metric) };
    // *|*|*
    if (d[idx("*", "*", metric)]) return { ...d[idx("*", "*", metric)], _key: idx("*", "*", metric) };
    return null;
  }

  // 类型：
  //   none: 不限（系统默认）
  //   range: 区间 [lower, upper]
  //   ge: 大于等于（仅下限）
  //   le: 小于等于（仅上限）
  //   eq: 等于（一般规格用）
  function set(product, stage, metric, limit) {
    const d = read();
    const k = idx(product, stage, metric);
    if (!limit || limit.type === "none" || (limit.lower == null && limit.upper == null)) {
      delete d[k];
    } else {
      d[k] = {
        type: limit.type,
        lower: numOrNull(limit.lower),
        upper: numOrNull(limit.upper),
        target: numOrNull(limit.target),
        updatedAt: Date.now(),
        note: limit.note || "",
      };
    }
    write(d);
  }
  function remove(product, stage, metric) {
    const d = read();
    delete d[idx(product, stage, metric)];
    write(d);
  }
  function all() { return read(); }

  function numOrNull(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  // 构造 markLine 数据用于 ECharts（覆盖 spec 默认值）
  // 输入：custom 对象（如 {type:'range', lower:1, upper:2}）
  // 返回：[{ xAxis, lineStyle, label }] 或 []
  function toMarkLines(custom) {
    if (!custom) return [];
    const lines = [];
    const mk = (v, color, form) => ({
      xAxis: v,
      lineStyle: { color, type: "dashed", width: 1.2 },
      label: { formatter: form, fontSize: 10, color },
    });
    if (custom.lower != null) lines.push(mk(custom.lower, "#dc2626", custom.type === "ge" ? "≥下限" : "下限"));
    if (custom.upper != null) lines.push(mk(custom.upper, "#dc2626", custom.type === "le" ? "≤上限" : "上限"));
    if (custom.target != null) {
      lines.push({
        xAxis: custom.target,
        lineStyle: { color: "#2563eb", type: "solid", width: 1 },
        label: { formatter: "目标", fontSize: 10, color: "#2563eb" },
      });
    }
    return lines;
  }
  function toMarkArea(custom) {
    if (!custom || custom.lower == null || custom.upper == null) return [];
    return [[
      { xAxis: custom.lower, itemStyle: { color: "rgba(22,163,74,.08)" } },
      { xAxis: custom.upper },
    ]];
  }

  // 判定：值 v 是否符合自定义限（返回 true/false/null 表示未判定）
  function judge(v, custom) {
    if (!custom || (custom.lower == null && custom.upper == null)) return null;
    if (v == null || v === "" || isNaN(v)) return null;
    const x = Number(v);
    switch (custom.type) {
      case "range": return x >= custom.lower && x <= custom.upper;
      case "ge":    return x >= custom.lower;
      case "le":    return x <= custom.upper;
      case "eq":    return x === custom.lower; // custom.lower 作为目标值
      default:      return null;
    }
  }

  /* ==========================================================================
   * SPC 判异规则（Western Electric / Nelson 8 条）
   * 输入：values（数值数组，按时间/序号排序）、mean（中心线）、sd（标准差）
   * 返回：{ rules: [{rule, name, indices:[...]}, ...], violationIdx:Set }
   * 仅当 sd>0 且样本量足够时生效。
   * ========================================================================== */
  function detectAnomalies(values, mean, sd) {
    const rules = [];
    const vIdx = new Set();
    // SPC 判异规则需要足够样本量才有统计意义；低于 20 点时返回空，避免小样本误报
    if (!values || values.length < 20 || !(sd > 0) || !isFinite(mean)) return { rules, violationIdx: vIdx };
    const n = values.length;
    const U3 = mean + 3 * sd, L3 = mean - 3 * sd;
    const U2 = mean + 2 * sd, L2 = mean - 2 * sd;
    const U1 = mean + sd, L1 = mean - sd;

    // 规则 1：一点超出 ±3σ
    const r1 = [];
    for (let i = 0; i < n; i++) if (values[i] > U3 || values[i] < L3) r1.push(i);
    if (r1.length) rules.push({ rule: 1, name: "单点超出 ±3σ 控制限", indices: r1 });

    // 规则 2：连续 9 点在中心线同侧
    let runSide = 0, side = 0;
    for (let i = 0; i < n; i++) {
      const s = values[i] >= mean ? 1 : -1;
      if (s === side) runSide++; else { side = s; runSide = 1; }
      if (runSide >= 9) { const idx = []; for (let k = i - 8; k <= i; k++) idx.push(k); rules.push({ rule: 2, name: "连续 9 点在中心线同侧", indices: idx }); break; }
    }

    // 规则 3：连续 6 点递增或递减
    for (let i = 0; i + 5 < n; i++) {
      let up = true, down = true;
      for (let k = i + 1; k <= i + 5; k++) {
        if (!(values[k] > values[k - 1])) up = false;
        if (!(values[k] < values[k - 1])) down = false;
      }
      if (up || down) rules.push({ rule: 3, name: "连续 6 点单调（趋势）", indices: [i, i + 1, i + 2, i + 3, i + 4, i + 5] });
    }

    // 规则 4：连续 14 点交替上下
    if (n >= 14) {
      let alt = true;
      for (let i = 1; i < n; i++) {
        const d1 = values[i] - values[i - 1], d2 = values[i - 1] - values[i - 2];
        if (i >= 2 && d1 * d2 >= 0) { alt = false; break; }
      }
      if (alt) rules.push({ rule: 4, name: "连续 14 点交替升降", indices: Array.from({ length: n }, (_, i) => i) });
    }

    // 规则 5：连续 3 点中至少 2 点超出 ±2σ（同侧）
    for (let i = 0; i + 2 < n; i++) {
      const seg = [i, i + 1, i + 2];
      const hi = seg.filter(k => values[k] > U2).length;
      const lo = seg.filter(k => values[k] < L2).length;
      if (hi >= 2 || lo >= 2) rules.push({ rule: 5, name: "连续 3 点中 2 点超出 ±2σ", indices: seg });
    }

    // 规则 6：连续 5 点中至少 4 点超出 ±1σ（同侧）
    for (let i = 0; i + 4 < n; i++) {
      const seg = [i, i + 1, i + 2, i + 3, i + 4];
      const hi = seg.filter(k => values[k] > U1).length;
      const lo = seg.filter(k => values[k] < L1).length;
      if (hi >= 4 || lo >= 4) rules.push({ rule: 6, name: "连续 5 点中 4 点超出 ±1σ", indices: seg });
    }

    // 规则 7：连续 15 点在中心线 ±1σ 内
    for (let i = 0; i + 14 < n; i++) {
      let inside = true;
      for (let k = i; k <= i + 14; k++) if (values[k] > U1 || values[k] < L1) { inside = false; break; }
      if (inside) rules.push({ rule: 7, name: "连续 15 点落在 ±1σ 内（分层/过度控制）", indices: Array.from({ length: 15 }, (_, k) => i + k) });
    }

    // 规则 8：连续 8 点在中心线同侧且超出 ±1σ
    for (let i = 0; i + 7 < n; i++) {
      const seg = [i, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6, i + 7];
      const hi = seg.every(k => values[k] > U1);
      const lo = seg.every(k => values[k] < L1);
      if (hi || lo) rules.push({ rule: 8, name: "连续 8 点在中心线同侧且超出 ±1σ", indices: seg });
    }

    for (const r of rules) r.indices.forEach(k => vIdx.add(k));
    return { rules, violationIdx: vIdx };
  }

  window.MESControl = {
    get, set, remove, all,
    toMarkLines, toMarkArea, judge,
    detectAnomalies,
  };
})();
