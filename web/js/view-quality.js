/* 质量分析 - 批次级 / 硅碳负极专项 / 趋势 / 鱼骨 / 判异 / 洞察 / 改进报告 */
"use strict";
Views.quality = (() => {
  // 质量分析模块从全局 S.product 取基体，避免与顶部"基体"分段重复
  const st = { product: App.S.product, stage: "混料", supplier: "", metric: null, tab: "trend", xAxisMode: "date", dateFrom: "", dateTo: "", fbDefect: null, reportDefect: null, focusBatch: null };
  // 把 st 暴露到 App.S.quality 让顶部基体切换能联动重置
  App.S.quality = st;

  /* ---------- 硅碳负极行业关键指标（用于一键洞察与风险评分） ---------- */
  const SI_ANODE_CRITICAL = ["磁性总量", "D50", "水分", "比表面积", "孔容", "孔径", "振实", "灰分", "挥发分", "pH", "真密度"];
  const SI_ANODE_UNITS = { "磁性总量": "ppm", "D50": "μm", "水分": "%", "比表面积": "m2/g", "孔容": "cm3/g", "孔径": "nm", "振实": "g/cm3" };

  /* ---------- 自定义规格控制限 UI ---------- */
  function buildLimitsToolbar(product, stage, metric, onChange) {
    const cur = MESControl.get(product, stage, metric);
    const wrap = App.el("div", { class: "limits-toolbar" });
    const typeSel = App.el("select", { title: "规则类型" },
      App.el("option", { value: "none", selected: (!cur || cur.type === "none") ? "" : null }, "不使用（按系统规格）"),
      App.el("option", { value: "range", selected: cur && cur.type === "range" ? "" : null }, "区间 [lower, upper]"),
      App.el("option", { value: "ge",    selected: cur && cur.type === "ge"    ? "" : null }, "下限 ≥ 仅下限"),
      App.el("option", { value: "le",    selected: cur && cur.type === "le"    ? "" : null }, "上限 ≤ 仅上限"),
      App.el("option", { value: "eq",    selected: cur && cur.type === "eq"    ? "" : null }, "等于（目标值）"),
    );
    const lowerInp = App.el("input", { type: "number", step: "any", placeholder: "下限", value: cur && cur.lower != null ? cur.lower : "" });
    const upperInp = App.el("input", { type: "number", step: "any", placeholder: "上限", value: cur && cur.upper != null ? cur.upper : "" });
    const targetInp = App.el("input", { type: "number", step: "any", placeholder: "目标", value: cur && cur.target != null ? cur.target : "" });
    const info = App.el("span", { class: "lim-info" }, cur ? `当前: ${describeLimit(cur)}` : "系统规则：从规格标准读取");

    const saveBtn = App.el("button", { class: "lim-save" }, "保存规则");
    const clearBtn = App.el("button", { class: "lim-clear", title: "清除此规则，使用系统规格" }, "清除");

    saveBtn.addEventListener("click", () => {
      const t = typeSel.value;
      const lim = {
        type: t,
        lower: t === "le" || t === "eq" ? null : (lowerInp.value === "" ? null : Number(lowerInp.value)),
        upper: t === "ge" || t === "eq" ? null : (upperInp.value === "" ? null : Number(upperInp.value)),
        target: targetInp.value === "" ? null : Number(targetInp.value),
      };
      MESControl.set(product, stage, metric, lim);
      info.textContent = `当前: ${describeLimit(lim)}`;
      if (onChange) onChange();
    });
    clearBtn.addEventListener("click", () => {
      MESControl.remove(product, stage, metric);
      typeSel.value = "none";
      lowerInp.value = "";
      upperInp.value = "";
      targetInp.value = "";
      info.textContent = "系统规则：从规格标准读取";
      if (onChange) onChange();
    });

    wrap.append(
      App.el("span", { style: "color:var(--ink-2)" }, "判定规则"),
      typeSel,
      lowerInp, App.el("span", { class: "lim-info" }, "≤"),
      upperInp, App.el("span", { class: "lim-info" }, "≤"),
      targetInp,
      saveBtn, clearBtn, info
    );
    return wrap;
  }
  function describeLimit(l) {
    if (!l || l.type === "none") return "未设置";
    const parts = [];
    if (l.lower != null) parts.push(`下限 ${l.type === "ge" ? "≥ " : ""}${l.lower}`);
    if (l.upper != null) parts.push(`上限 ${l.type === "le" ? "≤ " : ""}${l.upper}`);
    if (l.target != null) parts.push(`目标 ${l.target}`);
    return parts.join("，");
  }

  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const std = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
  /* 计算包含规格线/控制限的坐标轴范围，避免极限与坐标轴最大/最小值重叠 */
  function axisRange(values, limits, padRatio = 0.08) {
    const vals = (values || []).filter(v => typeof v === "number" && !isNaN(v));
    const lims = (limits || []).filter(v => typeof v === "number" && !isNaN(v));
    let lo = vals.length ? Math.min(...vals) : (lims.length ? Math.min(...lims) : 0);
    let hi = vals.length ? Math.max(...vals) : (lims.length ? Math.max(...lims) : 1);
    for (const v of lims) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (lo === hi) { lo -= 1; hi += 1; }
    const range = hi - lo || Math.abs(lo) || 1;
    const pad = range * padRatio || 0.5;
    return { min: +(lo - pad).toFixed(6), max: +(hi + pad).toFixed(6) };
  }
  /* 根据坐标轴跨度推断统一的小数位数，避免刻度标签位数参差不齐 */
  function axisDecimals(range) {
    if (!isFinite(range) || range <= 0) return 2;
    const log10 = Math.log10(range);
    const base = Math.floor(log10);
    return Math.max(0, -base + 1);
  }
  function axisLabelFormatter(range, metric) {
    const decimals = axisDecimals(range);
    const isPct = metric && (/收率/.test(String(metric)) || metric === null);
    return v => isPct ? App.fmtPct(v) : App.fmt(v, decimals);
  }
  const quantile = (arr, q) => {
    const a = [...arr].sort((x, y) => x - y);
    const pos = (a.length - 1) * q, base = Math.floor(pos), rest = pos - base;
    return a[base + 1] !== undefined ? a[base] + rest * (a[base + 1] - a[base]) : a[base];
  };
  function normalPdf(x, mu, sigma) {
    if (sigma <= 0) return 0;
    const z = (x - mu) / sigma;
    return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
  }
  function probit(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const plow = 0.02425, phigh = 1 - plow;
    let q, r;
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    } else if (p <= phigh) {
      q = p - 0.5; r = q*q;
      return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
  }
  function skewness(arr) {
    const n = arr.length; if (n < 3) return 0;
    const m = mean(arr), s = std(arr);
    if (s === 0) return 0;
    let sum = 0; for (const v of arr) sum += ((v - m) / s) ** 3;
    return (n / ((n - 1) * (n - 2))) * sum;
  }
  function kurtosis(arr) {
    const n = arr.length; if (n < 4) return 0;
    const m = mean(arr), s = std(arr);
    if (s === 0) return 0;
    let sum = 0; for (const v of arr) sum += ((v - m) / s) ** 4;
    return n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * sum - 3 * (n - 1) ** 2 / ((n - 2) * (n - 3));
  }
  function capBadge(cpk) {
    if (cpk == null) return null;
    if (cpk >= 1.33) return { cls: "ok", text: `能力充足 (Cpk=${cpk.toFixed(2)})` };
    if (cpk >= 1.0) return { cls: "warn", text: `能力不足 (Cpk=${cpk.toFixed(2)})` };
    return { cls: "bad", text: `严重不足 (Cpk=${cpk.toFixed(2)})` };
  }

  /* ---------- 批次与追溯工具 ---------- */
  function metricsFor() {
    const { S } = App;
    const set = new Set();
    for (const sp of S.data.specs) if (sp.product === st.product && sp.stage === st.stage) set.add(sp.metric);
    for (const b of S.data.batches) {
      if (b.product !== st.product || b.stage !== st.stage) continue;
      for (const [k, v] of Object.entries(b.metrics || {})) {
        if (typeof v === "number" && !App.TEXT_METRICS.has(k)) set.add(k);
      }
    }
    const order = App.METRIC_ORDER;
    return [...set].sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)) || a.localeCompare(b));
  }
  function specFor() {
    const fb = focusBatch();
    if (fb) return App.effectiveSpec(fb, st.metric) || null;
    return App.lookupSpec(st.product, st.stage, st.metric, st.supplier) || null;
  }
  function specForBatch(b, metric) { return App.effectiveSpec(b, metric) || null; }
  function supplierFilter(b) {
    if (!st.supplier) return true;
    return App.batchSupplier(b) === st.supplier;
  }
  function points() {
    const list = [];
    for (const b of App.S.data.batches) {
      if (b.product !== st.product || b.stage !== st.stage) continue;
      if (!supplierFilter(b)) continue;
      const v = (b.metrics || {})[st.metric];
      if (typeof v !== "number") continue;
      list.push({ b, v, date: App.isDate(b.date) ? b.date : null });
    }
    return list;
  }
  function batchesFor(product, stage, supplier) {
    return App.S.data.batches
      .filter(b => b.product === product && b.stage === stage && (supplier ? App.batchSupplier(b) === supplier : true))
      .sort(App.cmpBatch);
  }
  function suppliersFor(product, stage) {
    const set = new Set();
    for (const b of App.S.data.batches) {
      if (b.product !== product || b.stage !== stage) continue;
      const s = App.batchSupplier(b);
      if (s) set.add(s);
    }
    return ["", ...[...set].sort((a, b) => a.localeCompare(b, "zh-CN"))];
  }

  /* ---------- 供方质量对比专用工具 ---------- */
  function bigBatchId(id) { return String(id).replace(/-\d+$/, ""); }
  function metricsForSupplier() {
    const list = metricsFor();
    const extra = [];
    if (st.stage !== "原料来料") {
      const def = App.STAGE_FIELDS[st.stage];
      if (def && def.weights.some(w => w[0] === "产能")) extra.push("产能");
      if (def && def.weights.some(w => w[0] === "收率")) extra.push("收率");
    }
    return [...extra, ...list];
  }
  function dateFilter(b) {
    if (!b.date) return true;
    if (st.dateFrom && b.date < st.dateFrom) return false;
    if (st.dateTo && b.date > st.dateTo) return false;
    return true;
  }
  function unitForMetric(metric) {
    if (metric === "产能") return "kg/h";
    if (metric === "收率") return "%";
    const spec = App.lookupSpec(st.product, st.stage, metric, "") || null;
    return (spec && spec.unit) || App.S.units.get(metric) || "";
  }
  function collectSupplierPoints() {
    const isYieldCap = st.metric === "产能" || st.metric === "收率";
    if (!isYieldCap) {
      const pts = [];
      for (const b of App.S.data.batches) {
        if (b.product !== st.product || b.stage !== st.stage) continue;
        if (!dateFilter(b)) continue;
        const v = (b.metrics || {})[st.metric];
        if (typeof v !== "number") continue;
        pts.push({ b, v, date: b.date || null, supplier: App.batchSupplier(b) || "未填写", label: b.id });
      }
      return pts;
    }
    // 产能/收率按大批次聚合均值
    const groups = new Map();
    for (const b of App.S.data.batches) {
      if (b.product !== st.product || b.stage !== st.stage) continue;
      if (!dateFilter(b)) continue;
      const v = (b.weights || {})[st.metric];
      if (typeof v !== "number") continue;
      const big = bigBatchId(b.id);
      if (!groups.has(big)) groups.set(big, { vals: [], batches: [] });
      groups.get(big).vals.push(v);
      groups.get(big).batches.push(b);
    }
    const pts = [];
    for (const [big, g] of groups) {
      pts.push({
        b: g.batches[0],
        v: mean(g.vals),
        date: g.batches[0].date || null,
        supplier: App.batchSupplier(g.batches[0]) || "未填写",
        label: big,
        bigBatch: true,
      });
    }
    return pts;
  }
  function parentBatches(b) {
    const { S } = App;
    return (S.parentsOf.get(b.id) || []).map(id => S.byId.get(id)).filter(Boolean);
  }
  function childBatches(b) {
    const { S } = App;
    return (S.childrenOf.get(b.id) || []).map(id => S.byId.get(id)).filter(Boolean);
  }

  /* ---------- 上下游批次悬浮提示 ---------- */
  let batchTooltipEl = null;
  function ensureBatchTooltip() {
    if (batchTooltipEl) return;
    batchTooltipEl = App.el("div", { id: "batch-tooltip", class: "batch-tooltip" });
    document.body.appendChild(batchTooltipEl);
  }
  function positionBatchTooltip(e) {
    if (!batchTooltipEl) return;
    const rect = batchTooltipEl.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + rect.width > window.innerWidth - 8) x = e.clientX - rect.width - 10;
    if (y + rect.height > window.innerHeight - 8) y = e.clientY - rect.height - 10;
    batchTooltipEl.style.left = x + "px";
    batchTooltipEl.style.top = y + "px";
  }
  function showBatchTooltip(b, e) {
    ensureBatchTooltip();
    const info = batchVerdictInfo(b);
    const metrics = Object.entries(b.metrics || {})
      .filter(([, v]) => typeof v === "number")
      .slice(0, 10)
      .map(([k, v]) => {
        const sp = specForBatch(b, k);
        const j = sp ? App.judgeVal(v, sp) : null;
        const cls = j === false ? "bt-bad" : j === true ? "bt-ok" : "";
        const unit = (sp && sp.unit) || App.S.units.get(k) || "";
        return App.el("div", null,
          App.el("span", null, k),
          App.el("span", { class: cls }, `${App.fmtMetric(k, v)}${unit}`));
      });
    batchTooltipEl.innerHTML = "";
    batchTooltipEl.append(
      App.el("div", { class: "bt-title" }, b.id),
      App.el("div", { class: "bt-meta" }, `${b.product} · ${b.stage}${b.date ? " · " + b.date : ""}`),
      App.el("div", { class: "bt-meta" }, "判定：", App.el("span", { class: "bt-" + info.cls }, info.text)),
      App.el("div", { class: "bt-meta" }, `数量：${App.qtyText(b)}`),
      metrics.length ? App.el("div", { class: "bt-metrics" }, ...metrics) : null
    );
    batchTooltipEl.style.display = "block";
    // 先显示再测尺寸并定位
    requestAnimationFrame(() => positionBatchTooltip(e));
  }
  function hideBatchTooltip() {
    if (batchTooltipEl) batchTooltipEl.style.display = "none";
  }
  function batchLinkChip(b) {
    const chip = App.el("span", { class: "chip batch-chip", title: "点击查看批次详情" }, b.id);
    chip.addEventListener("mouseenter", e => showBatchTooltip(b, e));
    chip.addEventListener("mousemove", e => positionBatchTooltip(e));
    chip.addEventListener("mouseleave", hideBatchTooltip);
    chip.addEventListener("click", () => { hideBatchTooltip(); App.openBatchDrawer(b.id); });
    return chip;
  }

  function upstreamStages(b) {
    const idx = App.STAGES.indexOf(b.stage);
    return idx > 0 ? App.STAGES.slice(0, idx) : [];
  }
  function downstreamStages(b) {
    const idx = App.STAGES.indexOf(b.stage);
    return idx >= 0 && idx < App.STAGES.length - 1 ? App.STAGES.slice(idx + 1) : [];
  }
  function batchMetric(b, metric) { return (b.metrics || {})[metric]; }
  function batchVerdictInfo(b) {
    const fails = b.fails || [];
    if (!fails.length) return { text: b.verdict || "合格", cls: "ok" };
    return { text: `不合格 · ${fails.join("、")}`, cls: "bad" };
  }
  function focusBatch() {
    if (!st.focusBatch) return null;
    return App.S.byId.get(st.focusBatch) || null;
  }

  /* ---------- 硅碳负极专项：风险评分与批次定位 ---------- */
  function batchRiskScore(b) {
    const { S } = App;
    let score = 0, reasons = [];
    const criticalFails = (b.fails || []).filter(k => SI_ANODE_CRITICAL.includes(k));
    if (criticalFails.length) { score += criticalFails.length * 40; reasons.push(...criticalFails.map(k => `${k} 不合格`)); }
    // 磁性总量是硅碳负极电池安全关键
    const mag = batchMetric(b, "磁性总量");
    const magSpec = specForBatch(b, "磁性总量");
    if (typeof mag === "number" && magSpec) {
      const j = App.judgeVal(mag, magSpec);
      if (j === false) { score += 50; reasons.push("磁性总量超标（安全风险）"); }
      else if (magSpec.upper != null && mag > magSpec.upper * 0.8) { score += 15; reasons.push("磁性总量逼近上限"); }
    }
    // 水分影响浆料稳定性
    const h2o = batchMetric(b, "水分");
    const h2oSpec = specForBatch(b, "水分");
    if (typeof h2o === "number" && h2oSpec) {
      const j = App.judgeVal(h2o, h2oSpec);
      if (j === false) { score += 35; reasons.push("水分异常"); }
    }
    // D50 影响涂布
    const d50 = batchMetric(b, "D50");
    const d50Spec = specForBatch(b, "D50");
    if (typeof d50 === "number" && d50Spec) {
      const j = App.judgeVal(d50, d50Spec);
      if (j === false) { score += 30; reasons.push("D50 失控"); }
    }
    // 下游影响：如果本批合格但下游批因相同指标不合格，且下游批以本批为原料，则本批有传递风险
    const kids = childBatches(b);
    for (const c of kids) {
      const cFails = (c.fails || []).filter(k => SI_ANODE_CRITICAL.includes(k));
      if (cFails.length) { score += 20; reasons.push(`下游 ${c.id}(${c.stage}) 出现 ${cFails.join("、")}`); }
    }
    return { score: Math.min(100, score), reasons: reasons.slice(0, 6) };
  }
  function allBatchRisks() {
    const list = [];
    for (const b of App.S.data.batches) {
      if (!supplierFilter(b)) continue;
      const r = batchRiskScore(b);
      if (r.score > 0) list.push({ b, ...r });
    }
    list.sort((a, b) => b.score - a.score);
    return list;
  }
  function batchesByCriticalMetric(metric) {
    const list = [];
    for (const b of App.S.data.batches) {
      if (!supplierFilter(b)) continue;
      const v = batchMetric(b, metric);
      if (typeof v !== "number") continue;
      const sp = specForBatch(b, metric);
      const j = sp ? App.judgeVal(v, sp) : null;
      const deviation = deviationRatio(v, sp);
      list.push({ b, v, sp, j, deviation });
    }
    list.sort((a, b) => {
      // 不合格优先；其次按偏离度
      if ((a.j === false) !== (b.j === false)) return a.j === false ? -1 : 1;
      return (b.deviation || 0) - (a.deviation || 0);
    });
    return list;
  }
  function deviationRatio(v, sp) {
    if (!sp) return null;
    if (sp.lower != null && sp.upper != null) {
      const mid = (sp.lower + sp.upper) / 2;
      const half = (sp.upper - sp.lower) / 2 || 1;
      return Math.abs(v - mid) / half;
    }
    if (sp.upper != null) return v / sp.upper;
    if (sp.lower != null) return sp.lower / v;
    return null;
  }
  function downstreamPassRisk() {
    // 上游批次合格，但下游批次因相同指标不合格的传递案例
    const cases = [];
    const { S } = App;
    for (const b of S.data.batches) {
      if (!supplierFilter(b)) continue;
      const parents = parentBatches(b);
      if (!parents.length) continue;
      for (const k of (b.fails || [])) {
        if (!SI_ANODE_CRITICAL.includes(k)) continue;
        const parentBad = parents.filter(p => (p.fails || []).includes(k));
        if (parentBad.length) {
          cases.push({ downstream: b, metric: k, upstreamBad: parentBad });
        }
      }
    }
    cases.sort((a, b) => b.upstreamBad.length - a.upstreamBad.length);
    return cases.slice(0, 10);
  }

  /* ---------- 批次聚焦选择器（共享） ---------- */
  function buildBatchFocusSelector(product, stage, onFocus, supplier) {
    const batches = batchesFor(product, stage, supplier);
    const sel = App.el("select", { class: "input", style: "min-width:220px" });
    sel.append(App.el("option", { value: "" }, `可选 ${batches.length} 个批次进行聚焦分析…`));
    for (const b of batches) {
      const info = batchVerdictInfo(b);
      const label = `${b.id}${b.date ? " · " + b.date : ""}${info.text !== "合格" ? " · " + info.text : ""}`;
      sel.append(App.el("option", { value: b.id }, label));
    }
    const fb = focusBatch();
    if (fb && fb.product === product && fb.stage === stage) sel.value = fb.id;
    else sel.value = "";
    sel.addEventListener("change", () => { st.focusBatch = sel.value || null; if (onFocus) onFocus(st.focusBatch); });
    return sel;
  }
  function renderFocusBatchCard(b) {
    if (!b) return null;
    const info = batchVerdictInfo(b);
    const risk = batchRiskScore(b);
    const parents = parentBatches(b);
    const children = childBatches(b);
    const kvRows = [
      ["批次号", b.id],
      ["工序", b.stage],
      ["产品", b.product],
      ["日期", b.date || "—"],
      ["判定", info.text],
      ["数量", App.qtyText(b)],
    ];
    const kv = App.el("div", { class: "kv-table" });
    for (const [k, v] of kvRows) kv.append(App.el("div", { class: "kv" }, App.el("span", { class: "k" }, k), App.el("span", { class: "v" }, v)));
    // 上下游批次：可悬浮提示、可点击打开详情
    for (const [label, list] of [["上游批", parents], ["下游批", children]]) {
      const vWrap = App.el("span", { class: "v" });
      if (list.length) {
        const chipsWrap = App.el("div", { style: "display:flex; flex-wrap:wrap; gap:6px" });
        for (const p of list) chipsWrap.append(batchLinkChip(p));
        vWrap.append(chipsWrap);
      } else {
        vWrap.append(App.el("span", { class: "muted" }, "无"));
      }
      kv.append(App.el("div", { class: "kv" }, App.el("span", { class: "k" }, label), vWrap));
    }

    const metricChips = App.el("div", { style: "display:flex; flex-wrap:wrap; gap:6px; margin-top:10px" });
    for (const [mk, mv] of Object.entries(b.metrics || {})) {
      if (typeof mv !== "number") continue;
      const sp = specForBatch(b, mk);
      const j = sp ? App.judgeVal(mv, sp) : null;
      const unit = (sp && sp.unit) || App.S.units.get(mk) || "";
      metricChips.append(App.el("span", { class: "chip" + (j === false ? " bad" : j === true ? " ok" : "") }, `${mk}: ${App.fmtMetric(mk, mv)}${unit}`));
    }

    return App.el("div", { class: "card", style: "margin-bottom:16px" },
      App.el("div", { class: "card-head" },
        App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "crosshair" }), `聚焦批次：${b.id}`),
        App.el("div", { class: "muted small", style: "display:flex; gap:8px; align-items:center" },
          App.el("span", { class: `pill ${info.cls}` }, info.text),
          risk.score > 0 ? App.el("span", { class: `pill ${risk.score >= 60 ? "bad" : risk.score >= 30 ? "warn" : "info"}` }, `风险 ${risk.score}`) : null,
          App.el("button", { class: "btn sm", onclick: () => App.openBatchDrawer(b.id) }, "打开批次详情"))),
      App.el("div", { class: "card-body" },
        kv,
        metricChips,
        risk.reasons.length ? App.el("div", { class: "hint small", style: "margin-top:10px; color:#b91c1c" }, `风险因素：${risk.reasons.join("；")}`) : null));
  }


  /* ---------- 聚合分析用：规格与自定义控制限 ---------- */
  function effectiveSpec() {
    const spec = App.lookupSpec(st.product, st.stage, st.metric, st.supplier) || null;
    const custom = MESControl.get(st.product, st.stage, st.metric);
    if (!custom) return spec;
    return {
      ...(spec || {}),
      type: custom.type,
      lower: custom.lower != null ? custom.lower : (spec ? spec.lower : null),
      upper: custom.upper != null ? custom.upper : (spec ? spec.upper : null),
      target: custom.target != null ? custom.target : (spec ? spec.target : null),
      raw: describeLimit(custom),
      isCustom: true,
    };
  }
  function orderedPoints() {
    const pts = points();
    return pts.slice().sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date);
      return a.b.id.localeCompare(b.b.id);
    });
  }

  /* ---------- Western Electric 判异规则 ---------- */
  function detectRules(ordered) {
    const vals = ordered.map(p => p.v);
    if (vals.length < 2) return [];
    const m = mean(vals), s = std(vals);
    if (s === 0) return [];
    const out = [];
    const push = (idx, rule, detail) => {
      if (idx < 0 || idx >= ordered.length) return;
      out.push({ idx, p: ordered[idx], rule, detail });
    };
    for (let i = 0; i < vals.length; i++) {
      const z = (vals[i] - m) / s;
      if (Math.abs(z) > 3) push(i, "规则1：点超出3σ控制限", `z=${z.toFixed(2)}`);
    }
    for (let i = 8; i < vals.length; i++) {
      const side = Math.sign(vals[i] - m);
      if (side === 0) continue;
      let ok = true;
      for (let j = i - 8; j <= i; j++) if (Math.sign(vals[j] - m) !== side) { ok = false; break; }
      if (ok) push(i, "规则2：连续9点同侧中心线", `自 ${ordered[i - 8].b.id}`);
    }
    for (let i = 5; i < vals.length; i++) {
      let inc = true, dec = true;
      for (let j = i - 4; j <= i; j++) {
        if (vals[j] <= vals[j - 1]) inc = false;
        if (vals[j] >= vals[j - 1]) dec = false;
      }
      if (inc || dec) push(i, "规则3：连续6点递增或递减", `趋势${inc ? "上升" : "下降"}`);
    }
    for (let i = 13; i < vals.length; i++) {
      let ok = true;
      for (let j = i - 12; j <= i; j++) {
        const d1 = vals[j] - vals[j - 1], d2 = vals[j - 1] - vals[j - 2];
        if (d1 * d2 >= 0) { ok = false; break; }
      }
      if (ok) push(i, "规则4：连续14点上下交替", `自 ${ordered[i - 13].b.id}`);
    }
    for (let i = 2; i < vals.length; i++) {
      const slice = vals.slice(i - 2, i + 1);
      const high = slice.filter(v => v > m + 2 * s).length;
      const low = slice.filter(v => v < m - 2 * s).length;
      if (high >= 2) push(i, "规则5：连续3点中2点超出+2σ", `z=${((vals[i]-m)/s).toFixed(2)}`);
      else if (low >= 2) push(i, "规则5：连续3点中2点超出-2σ", `z=${((vals[i]-m)/s).toFixed(2)}`);
    }
    for (let i = 4; i < vals.length; i++) {
      const slice = vals.slice(i - 4, i + 1);
      const high = slice.filter(v => v > m + s).length;
      const low = slice.filter(v => v < m - s).length;
      if (high >= 4) push(i, "规则6：连续5点中4点超出+1σ", `z=${((vals[i]-m)/s).toFixed(2)}`);
      else if (low >= 4) push(i, "规则6：连续5点中4点超出-1σ", `z=${((vals[i]-m)/s).toFixed(2)}`);
    }
    for (let i = 14; i < vals.length; i++) {
      let ok = true;
      for (let j = i - 14; j <= i; j++) if (Math.abs(vals[j] - m) > s) { ok = false; break; }
      if (ok) push(i, "规则7：连续15点落在±1σ内", `自 ${ordered[i - 14].b.id}`);
    }
    for (let i = 7; i < vals.length; i++) {
      let ok = true;
      for (let j = i - 7; j <= i; j++) if (Math.abs(vals[j] - m) <= s) { ok = false; break; }
      if (ok) push(i, "规则8：连续8点落在±1σ外", `自 ${ordered[i - 7].b.id}`);
    }
    const seen = new Set();
    return out.filter(x => { const k = `${x.p.b.id}|${x.rule}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  /* ===================== 分布分析 ===================== */
  function drawDistribution(body) {
    const spec = effectiveSpec();
    const ordered = orderedPoints();
    const vals = ordered.map(p => p.v);
    const unit = (spec && spec.unit) || App.S.units.get(st.metric) || "";
    if (!vals.length) { body.append(App.el("div", { class: "empty" }, "该产品/工序暂无数值型指标数据")); return; }

    const m = mean(vals), sd = vals.length > 1 ? std(vals) : 0;
    const med = quantile(vals, .5), q1 = quantile(vals, .25), q3 = quantile(vals, .75), mn = Math.min(...vals), mx = Math.max(...vals);
    const se = (sd > 0 && vals.length) ? sd / Math.sqrt(vals.length) : 0;
    const cv = m !== 0 ? sd / Math.abs(m) * 100 : 0;
    const skew = vals.length >= 3 ? skewness(vals) : 0;
    const kurt = vals.length >= 4 ? kurtosis(vals) : 0;

    const histDom = App.el("div", { class: "chart" });
    const normDom = App.el("div", { class: "chart" });
    const statDom = App.el("div", { class: "card", style: "margin-bottom:16px" });

    const rows = [
      ["样本量", String(vals.length), "均值", App.fmtMetric(st.metric, m)],
      ["中位数", App.fmtMetric(st.metric, med), "标准差", App.fmtMetric(st.metric, sd)],
      ["最小值", App.fmtMetric(st.metric, mn), "最大值", App.fmtMetric(st.metric, mx)],
      ["Q1", App.fmtMetric(st.metric, q1), "Q3", App.fmtMetric(st.metric, q3)],
      ["IQR", App.fmtMetric(st.metric, q3 - q1), "极差", App.fmtMetric(st.metric, mx - mn)],
      ["标准误", App.fmtMetric(st.metric, se), "变异系数", cv.toFixed(2) + "%"],
      ["偏度", skew.toFixed(3), "峰度", kurt.toFixed(3)],
    ];
    const table = App.el("table", { class: "tbl" },
      App.el("tbody", {}, ...rows.map(r => App.el("tr", {},
        App.el("td", { style: "font-weight:600;color:var(--ink-2)" }, r[0]),
        App.el("td", { class: "num" }, r[1]),
        App.el("td", { style: "font-weight:600;color:var(--ink-2)" }, r[2]),
        App.el("td", { class: "num" }, r[3])))));
    statDom.append(App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "table" }), "描述统计")), table);

    body.append(
      statDom,
      App.el("div", { class: "grid", style: "grid-template-columns: 1fr 1fr" },
        App.el("div", { class: "card" }, App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "bar-chart-horizontal" }), "分布直方图")), histDom),
        App.el("div", { class: "card" }, App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "trending-up" }), "正态概率图")), normDom)),
    );

    if (vals.length >= 3) {
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const nBins = Math.min(18, Math.max(5, Math.ceil(Math.sqrt(vals.length))));
      const step = (hi - lo) / nBins || 1;
      const bins = Array.from({ length: nBins }, (_, i) => ({ x0: lo + i * step, x1: lo + (i + 1) * step, n: 0 }));
      for (const v of vals) { const i = Math.min(nBins - 1, Math.floor((v - lo) / step)); bins[i].n++; }
      const histMarkArea = [];
      if (spec && spec.lower != null && spec.upper != null) histMarkArea.push([{ xAxis: spec.lower, itemStyle: { color: spec.isCustom ? "rgba(37,99,235,.08)" : "rgba(22,163,74,.08)" } }, { xAxis: spec.upper }]);
      const histMarkLine = [
        ...(spec && spec.lower != null ? [{ xAxis: spec.lower, lineStyle: { color: spec.isCustom ? "#2563eb" : "#dc2626", type: "dashed" }, label: { formatter: "下限", fontSize: 10, color: spec.isCustom ? "#2563eb" : "#dc2626" } }] : []),
        ...(spec && spec.upper != null ? [{ xAxis: spec.upper, lineStyle: { color: spec.isCustom ? "#2563eb" : "#dc2626", type: "dashed" }, label: { formatter: "上限", fontSize: 10, color: spec.isCustom ? "#2563eb" : "#dc2626" } }] : []),
        { xAxis: m, lineStyle: { color: "#2563eb" }, label: { formatter: "均值", fontSize: 10, color: "#2563eb" } },
      ];
      const histXRange2 = axisRange(vals, [spec && spec.lower, spec && spec.upper, m].filter(v => v != null), 0.05);
      const histXFmt2 = axisLabelFormatter(histXRange2.max - histXRange2.min, st.metric);
      App.makeChart(histDom, {
        grid: { left: 44, right: 20, top: 30, bottom: 40 },
        tooltip: { trigger: "item", formatter: p => `${App.fmt(p.data.value[0], 3)} ~ ${App.fmt(p.data.value[1], 3)}：<b>${p.data.value[2]}</b> 批` },
        xAxis: { type: "value", min: histXRange2.min, max: histXRange2.max, axisLabel: { formatter: histXFmt2, fontSize: 10 } },
        yAxis: { type: "value", minInterval: 1, name: "批次" },
        toolbox: { feature: { saveAsImage: {} }, right: 10, top: 0 },
        series: [{
          type: "bar", barWidth: "92%",
          itemStyle: { color: "#0d9488", borderRadius: [3, 3, 0, 0] },
          data: bins.map(bn => ({ value: [bn.x0, bn.x1, bn.n] })),
          markLine: { silent: true, symbol: "none", data: histMarkLine },
          markArea: { silent: true, data: histMarkArea },
        }],
      });
    } else {
      histDom.append(App.el("div", { class: "empty" }, "数据点不足，无法绘制分布"));
    }

    if (vals.length >= 3) {
      const sorted = [...vals].sort((a, b) => a - b);
      const Nn = sorted.length;
      const ptsNQ = sorted.map((v, i) => [probit((i + 0.5) / Nn), v]);
      const zMin = ptsNQ[0][0], zMax = ptsNQ[Nn - 1][0];
      App.makeChart(normDom, {
        grid: { left: 56, right: 20, top: 30, bottom: 44 },
        tooltip: { trigger: "item", formatter: p => p.seriesName === "样本" ? `z=${p.data[0].toFixed(2)}　值=<b>${App.fmtMetric(st.metric, p.data[1])}</b>` : "" },
        legend: { data: ["样本", "正态参考线"], top: 0, textStyle: { fontSize: 11 } },
        xAxis: { type: "value", name: "分位数 z", nameLocation: "middle", nameGap: 26, axisLabel: { fontSize: 10 } },
        yAxis: { type: "value", name: unit, scale: true, axisLabel: { formatter: axisLabelFormatter(Math.max(...vals) - Math.min(...vals) || 1, st.metric), fontSize: 10 } },
        toolbox: { feature: { saveAsImage: {} }, right: 10, top: 0 },
        series: [
          { name: "样本", type: "scatter", symbolSize: 6, itemStyle: { color: "#2563eb" }, data: ptsNQ },
          { name: "正态参考线", type: "line", symbol: "none", lineStyle: { color: "#dc2626", type: "dashed", width: 1.5 }, data: [[zMin, m + sd * zMin], [zMax, m + sd * zMax]] },
        ],
      });
    } else {
      normDom.append(App.el("div", { class: "empty" }, "数据点不足，无法绘制正态概率图"));
    }
  }

  /* ===================== 工序对比 ===================== */
  function drawBoxplot(body) {
    const spec = effectiveSpec();
    const unit = (spec && spec.unit) || App.S.units.get(st.metric) || "";
    const boxStages = [], boxData = [], scatterData = [];
    for (const s of App.STAGES) {
      const vs = [];
      for (const b of App.S.data.batches) {
        if (b.product !== st.product || b.stage !== s) continue;
        const v = (b.metrics || {})[st.metric];
        if (typeof v === "number") vs.push(v);
      }
      if (vs.length >= 2) {
        boxStages.push(s);
        boxData.push([Math.min(...vs), quantile(vs, .25), quantile(vs, .5), quantile(vs, .75), Math.max(...vs)]);
        vs.forEach(v => scatterData.push([boxStages.length - 1, v]));
      }
    }
    if (!boxData.length) { body.append(App.el("div", { class: "empty" }, "该产品/指标在各工序均无足够数据")); return; }

    const boxDom = App.el("div", { class: "chart", style: "height:420px" });
    body.append(App.el("div", { class: "card" },
      App.el("div", { class: "card-head" },
        App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "git-compare" }), `${st.metric} 工序间对比（箱线图）`),
        App.el("span", { class: "muted small" }, `单位：${unit || "—"}`)),
      boxDom));

    const boxLines = [];
    if (spec && spec.lower != null) boxLines.push({ yAxis: spec.lower, lineStyle: { color: spec.isCustom ? "#2563eb" : "#dc2626", type: "dashed" }, label: { position: "middle", formatter: `下限${spec.isCustom ? "（自定义）" : ""} ${spec.lower}`, fontSize: 9, color: spec.isCustom ? "#2563eb" : "#dc2626", distance: 8 } });
    if (spec && spec.upper != null) boxLines.push({ yAxis: spec.upper, lineStyle: { color: spec.isCustom ? "#2563eb" : "#dc2626", type: "dashed" }, label: { position: "middle", formatter: `上限${spec.isCustom ? "（自定义）" : ""} ${spec.upper}`, fontSize: 9, color: spec.isCustom ? "#2563eb" : "#dc2626", distance: 8 } });
    const boxYValues2 = boxData.flat().concat(scatterData.map(d => d[1]));
    const boxYRange2 = axisRange(boxYValues2, [spec && spec.lower, spec && spec.upper].filter(v => v != null), 0.08);
    App.makeChart(boxDom, {
      grid: { left: 56, right: 20, top: 30, bottom: 30 },
      tooltip: { trigger: "item" },
      xAxis: { type: "category", data: boxStages },
      yAxis: { type: "value", name: unit, min: boxYRange2.min, max: boxYRange2.max, axisLabel: { formatter: axisLabelFormatter(boxYRange2.max - boxYRange2.min, st.metric) } },
      toolbox: { feature: { saveAsImage: {} }, right: 10, top: 0 },
      series: [
        { type: "boxplot", data: boxData, itemStyle: { color: "rgba(37,99,235,.18)", borderColor: "#2563eb" }, markLine: boxLines.length ? { silent: true, symbol: "none", symbolSize: 0, data: boxLines } : undefined },
        { type: "scatter", symbolSize: 4, itemStyle: { color: "rgba(13,148,136,.55)" }, data: scatterData },
      ],
    });
  }

  /* ===================== 缺陷 Pareto ===================== */
  function drawPareto(body) {
    const defectList = [];
    for (const mt of metricsFor()) {
      let cnt = 0, tot = 0;
      for (const b of App.S.data.batches) {
        if (b.product !== st.product || b.stage !== st.stage) continue;
        if (!supplierFilter(b)) continue;
        const v = (b.metrics || {})[mt];
        if (typeof v !== "number") continue;
        tot++;
        const j = App.judgeVal(v, App.effectiveSpec(b, mt) || null);
        if (j === false) cnt++;
      }
      if (tot > 0) defectList.push({ mt, rate: cnt / tot, cnt, tot });
    }
    defectList.sort((a, b) => b.rate - a.rate);
    if (!defectList.length) { body.append(App.el("div", { class: "empty" }, "无可用指标")); return; }

    const paretoDom = App.el("div", { class: "chart", style: "height:360px" });
    const tableWrap = App.el("div", { class: "tbl-wrap", style: "max-height:260px; margin-top:16px" });
    const table = App.el("table", { class: "tbl" },
      App.el("thead", {}, App.el("tr", {},
        App.el("th", {}, "指标"), App.el("th", { class: "num" }, "缺陷批数"), App.el("th", { class: "num" }, "总批数"),
        App.el("th", { class: "num" }, "缺陷率"), App.el("th", {}, "累计占比"))));
    const tbody = App.el("tbody");
    let cum = 0;
    defectList.forEach((d, i) => {
      cum += d.rate;
      tbody.append(App.el("tr", {},
        App.el("td", {}, d.mt),
        App.el("td", { class: "num" }, String(d.cnt)),
        App.el("td", { class: "num" }, String(d.tot)),
        App.el("td", { class: "num" }, (d.rate * 100).toFixed(1) + "%"),
        App.el("td", { class: "num" }, (cum * 100).toFixed(1) + "%")));
    });
    table.append(tbody);
    tableWrap.append(table);

    body.append(
      App.el("div", { class: "card" },
        App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "alert-triangle" }), `${st.product} · ${st.stage} 缺陷分析（按指标 Pareto）`)),
        paretoDom),
      App.el("div", { class: "card", style: "margin-top:16px" },
        App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "list" }), "缺陷指标明细")),
        tableWrap),
    );

    const top = defectList.slice(0, 12);
    const cumArr = []; let run = 0;
    for (const d of top) { run += d.rate; cumArr.push(+(run * 100).toFixed(1)); }
    App.makeChart(paretoDom, {
      grid: { left: 56, right: 56, top: 30, bottom: 64 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { data: ["缺陷率", "累计%"], top: 0, textStyle: { fontSize: 11 } },
      xAxis: { type: "category", data: top.map(d => d.mt), axisLabel: { rotate: top.length > 6 ? 35 : 0, fontSize: 10 } },
      yAxis: [
        { type: "value", name: "缺陷率", axisLabel: { formatter: v => (v * 100).toFixed(0) + "%" }, max: 1 },
        { type: "value", name: "累计%", min: 0, max: 100, axisLabel: { formatter: "{value}%" }, splitLine: { show: false } },
      ],
      toolbox: { feature: { saveAsImage: {} }, right: 10, top: 0 },
      series: [
        { name: "缺陷率", type: "bar", data: top.map(d => +d.rate.toFixed(4)), itemStyle: { color: "#ef4444", borderRadius: [3, 3, 0, 0] }, label: { show: true, position: "top", fontSize: 10, formatter: p => (p.value * 100).toFixed(1) + "%" } },
        { name: "累计%", type: "line", yAxisIndex: 1, data: cumArr, symbolSize: 6, lineStyle: { color: "#1e293b", width: 2 }, itemStyle: { color: "#1e293b" } },
      ],
    });
  }

  /* ===================== 供方质量对比（分阶段控制图） ===================== */
  function drawSupplier(body) {
    const availableMetrics = metricsForSupplier();
    if (!st.metric || !availableMetrics.includes(st.metric)) st.metric = availableMetrics[0] || null;
    if (!st.metric) { body.append(App.el("div", { class: "empty" }, "该产品/工序暂无可用指标")); return; }
    if (!["batchId", "sequence"].includes(st.xAxisMode)) st.xAxisMode = "batchId";

    const isYieldCap = st.metric === "产能" || st.metric === "收率";
    const unit = unitForMetric(st.metric);

    /* ---- 工具栏：指标 + 横坐标 + 日期范围 ---- */
    const metricSel = App.el("select", { class: "input", style: "min-width:150px" });
    for (const m of availableMetrics) metricSel.append(App.el("option", { value: m, selected: m === st.metric ? "" : null }, m));
    metricSel.value = st.metric;
    metricSel.addEventListener("change", () => { st.metric = metricSel.value; App.render(); });

    const xSel = App.el("select", { class: "input", style: "min-width:100px" },
      App.el("option", { value: "batchId", selected: st.xAxisMode === "batchId" ? "" : null }, "批次号"),
      App.el("option", { value: "sequence", selected: st.xAxisMode === "sequence" ? "" : null }, "序号"));
    xSel.value = st.xAxisMode;
    xSel.addEventListener("change", () => { st.xAxisMode = xSel.value; App.render(); });

    const dateFromIn = App.el("input", { class: "input", type: "text", placeholder: "年/月/日", value: st.dateFrom ? st.dateFrom.replace(/-/g, "/") : "", style: "width:130px" });
    const dateToIn = App.el("input", { class: "input", type: "text", placeholder: "年/月/日", value: st.dateTo ? st.dateTo.replace(/-/g, "/") : "", style: "width:130px" });
    for (const input of [dateFromIn, dateToIn]) {
      input.addEventListener("focus", () => {
        const raw = input.value.replace(/\//g, "-");
        input.type = "date";
        input.value = raw;
      });
      input.addEventListener("change", () => {
        const key = input === dateFromIn ? "dateFrom" : "dateTo";
        st[key] = input.value ? input.value.replace(/\//g, "-") : "";
        App.render();
      });
      input.addEventListener("blur", () => {
        if (!input.value) { input.type = "text"; input.value = ""; }
        else { input.type = "text"; input.value = input.value.replace(/-/g, "/"); }
      });
    }

    body.append(App.el("div", { class: "toolbar" },
      App.el("span", { class: "small", style: "font-weight:600; color:var(--ink-2)" }, "指标"), metricSel,
      App.el("span", { class: "small", style: "font-weight:600; color:var(--ink-2); margin-left:4px" }, "横坐标"), xSel,
      App.el("span", { class: "small", style: "font-weight:600; color:var(--ink-2); margin-left:4px" }, "日期从"), dateFromIn,
      App.el("span", { class: "small", style: "font-weight:600; color:var(--ink-2)" }, "至"), dateToIn));

    /* ---- 数据收集 ---- */
    let pts = collectSupplierPoints();
    if (!pts.length) { body.append(App.el("div", { class: "empty" }, "该筛选条件下暂无数据")); return; }

    // 按供方分组，每个供方一个阶段；阶段内按横轴模式排序
    const bySup = new Map();
    for (const p of pts) {
      if (!bySup.has(p.supplier)) bySup.set(p.supplier, []);
      bySup.get(p.supplier).push(p);
    }
    const supNames = [...bySup.keys()].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const stages = [];
    let globalIdx = 0;
    for (let i = 0; i < supNames.length; i++) {
      const sup = supNames[i];
      const arr = bySup.get(sup);
      if (st.xAxisMode === "batchId") arr.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
      // sequence 保持 collectSupplierPoints 返回的原始顺序
      for (const p of arr) p.x = globalIdx++;
      stages.push({ sup, arr, startX: arr[0].x, endX: arr[arr.length - 1].x });
      if (i < supNames.length - 1) globalIdx++; // 阶段之间留一个空位，避免分隔线卡在节点上
    }

    const xLabels = new Array(globalIdx).fill("");
    let seqIdx = 1;
    for (const stg of stages) {
      for (const p of stg.arr) {
        xLabels[p.x] = st.xAxisMode === "sequence" ? String(seqIdx++) : p.label;
      }
    }

    // 计算各阶段统计量
    // 调色板：拉开色相距离，让 GY(蓝)/XT(绿)/ZG(橙) 等前几个阶段在低透明度下也清晰可辨
    const palette = ["#3b82f6", "#10b981", "#f97316", "#8b5cf6", "#ec4899", "#06b6d4", "#f59e0b", "#6366f1", "#84cc16", "#0ea5e9"];
    // 构造 ECharts 渐变对象：纵向（顶深底浅），让相邻阶段通过深浅自然衔接
    const stageGrad = color => ({
      type: "linear", x: 0, y: 0, x2: 0, y2: 1,
      colorStops: [
        { offset: 0, color: color + "38" },   // 顶部约 22% 透明度
        { offset: 1, color: color + "0a" },   // 底部约 4% 透明度
      ],
      global: false,
    });
    const supColor = {};
    for (let i = 0; i < stages.length; i++) {
      const stg = stages[i];
      stg.color = palette[i % palette.length];
      supColor[stg.sup] = stg.color;
      const vs = stg.arr.map(p => p.v);
      stg.n = vs.length;
      stg.mean = mean(vs);
      stg.sd = vs.length > 1 ? std(vs) : 0;
      stg.min = Math.min(...vs);
      stg.max = Math.max(...vs);
      // 各供方按自己的规格判定
      const supSpec = isYieldCap ? null : (App.lookupSpec(st.product, st.stage, st.metric, stg.sup === "未填写" ? "" : stg.sup) || null);
      const judged = supSpec ? vs.map(v => App.judgeVal(v, supSpec)).filter(j => j !== null) : [];
      stg.ok = judged.filter(j => j).length;
      stg.passRate = judged.length ? stg.ok / judged.length : null;
      stg.spec = supSpec;
    }

    // 构建单值序列：所有阶段连续排列，阶段之间用 null 断开
    const seriesData = new Array(globalIdx).fill(null);
    for (const stg of stages) {
      for (const p of stg.arr) {
        seriesData[p.x] = {
          value: [p.x, p.v],
          bid: p.label,
          date: p.date,
          supplier: p.supplier,
          itemStyle: { color: stg.color },
        };
      }
    }

    // 阶段分隔线、规格线
    const markLines = [];

    // 判断所有阶段规格是否一致：一致则画一条贯穿全图的规格线，避免重复标签
    const specsWithVal = stages.map(s => s.spec).filter(Boolean);
    let unifiedSpec = null;
    if (specsWithVal.length === stages.length && specsWithVal.length > 0) {
      const first = specsWithVal[0];
      const allSame = specsWithVal.every(sp => sp.lower === first.lower && sp.upper === first.upper && sp.target === first.target);
      if (allSame) unifiedSpec = first;
    }

    for (const stg of stages) {
      // 阶段分隔虚线（精致、不抢眼）
      if (stg.endX < globalIdx - 1) {
        markLines.push([
          { coord: [stg.endX + 0.5, "min"], lineStyle: { color: "#e2e8f0", type: "dashed", width: 1, opacity: 0.9 } },
          { coord: [stg.endX + 0.5, "max"] }
        ]);
      }
      // 阶段均值线：颜色与供方阶段一致，标签放到线条右端内下方（position: 'insideEndBottom'）
      // 与右侧的规格/中值标签（position: 'end'，chart 最右端外）彻底分离，避免 y 值接近时重叠
      const meanLabelRich = {
        formatter: `{t|均值}{v|${App.fmtMetric(st.metric, stg.mean)}}`,
        position: "insideEndBottom",
        fontSize: 9,
        color: stg.color,
        distance: 4,
        backgroundColor: stg.color + "14",
        borderColor: stg.color + "55",
        borderWidth: 1,
        borderRadius: 3,
        padding: [2, 5],
        rich: {
          t: { color: "#64748b", fontSize: 9, fontWeight: 500, padding: [0, 4, 0, 0] },
          v: { color: stg.color, fontSize: 9, fontWeight: 700 },
        },
      };
      markLines.push([
        { coord: [stg.startX - 0.4, stg.mean], lineStyle: { color: stg.color, type: "solid", width: 1.5 }, label: meanLabelRich },
        { coord: [stg.endX + 0.4, stg.mean] }
      ]);
    }

    // 规格线：统一则画贯穿线，否则按阶段画；标签一律放在图表最右侧，避免阶段内部拥挤
    const specLabelBase = {
      backgroundColor: "rgba(255,255,255,.92)",
      borderWidth: 1,
      borderRadius: 3,
      padding: [2, 5],
      distance: 4,
      fontSize: 9,
    };
    // 通用 rich 标签生成器：灰底前缀 + 数值高亮
    const specRich = (lineColor, prefix, val) => ({
      formatter: `{t|${prefix}}{v|${val}}`,
      backgroundColor: lineColor + "12",
      borderColor: lineColor + "55",
      color: lineColor,
      rich: {
        t: { color: "#64748b", fontSize: 9, fontWeight: 500, padding: [0, 4, 0, 0] },
        v: { color: lineColor, fontSize: 9, fontWeight: 700 },
      },
    });
    if (unifiedSpec) {
      const lineColor = unifiedSpec.isCustom ? "#2563eb" : "#16a34a";
      if (unifiedSpec.lower != null) {
        markLines.push({ yAxis: unifiedSpec.lower, lineStyle: { color: lineColor, type: "dashed", width: 1.5 }, label: { ...specLabelBase, ...specRich(lineColor, "下限", unifiedSpec.lower), position: "end", distance: 6 } });
      }
      if (unifiedSpec.upper != null) {
        markLines.push({ yAxis: unifiedSpec.upper, lineStyle: { color: lineColor, type: "dashed", width: 1.5 }, label: { ...specLabelBase, ...specRich(lineColor, "上限", unifiedSpec.upper), position: "end", distance: 6 } });
      }
      if (unifiedSpec.target != null) {
        const tgtColor = "#f59e0b";
        markLines.push({ yAxis: unifiedSpec.target, lineStyle: { color: tgtColor, type: "dotted", width: 1.8 }, label: { ...specLabelBase, ...specRich(tgtColor, "中值", unifiedSpec.target), position: "end", distance: 6 } });
      }
    } else {
      for (const stg of stages) {
        const specColor = stg.spec && stg.spec.isCustom ? "#2563eb" : "#16a34a";
        if (stg.spec && stg.spec.lower != null) {
          markLines.push([
            { coord: [stg.startX - 0.4, stg.spec.lower], lineStyle: { color: specColor, type: "dashed", width: 1.5 } },
            { coord: [stg.endX + 0.4, stg.spec.lower], label: { ...specLabelBase, ...specRich(specColor, "下限", stg.spec.lower), position: "end", distance: 6 } }
          ]);
        }
        if (stg.spec && stg.spec.upper != null) {
          markLines.push([
            { coord: [stg.startX - 0.4, stg.spec.upper], lineStyle: { color: specColor, type: "dashed", width: 1.5 } },
            { coord: [stg.endX + 0.4, stg.spec.upper], label: { ...specLabelBase, ...specRich(specColor, "上限", stg.spec.upper), position: "end", distance: 6 } }
          ]);
        }
        if (stg.spec && stg.spec.target != null) {
          const tgtColor = "#f59e0b";
          markLines.push([
            { coord: [stg.startX - 0.4, stg.spec.target], lineStyle: { color: tgtColor, type: "dotted", width: 1.8 } },
            { coord: [stg.endX + 0.4, stg.spec.target], label: { ...specLabelBase, ...specRich(tgtColor, "中值", stg.spec.target), position: "end", distance: 6 } }
          ]);
        }
      }
    }

    // 计算纵轴范围：数据 + 所有规格线/均值线，确保完整显示且不贴边
    const yLimits = [];
    for (const stg of stages) {
      yLimits.push(stg.mean);
      if (stg.spec) {
        if (stg.spec.lower != null) yLimits.push(stg.spec.lower);
        if (stg.spec.upper != null) yLimits.push(stg.spec.upper);
        if (stg.spec.target != null) yLimits.push(stg.spec.target);
      }
    }
    const dataValues = seriesData.filter(p => p).map(p => p.value[1]);
    const yRange = axisRange(dataValues, yLimits, 0.08);

    // 统计表：各供方阶段统计
    const chartDom = App.el("div", { class: "chart", style: "height:360px" });
    const tableWrap = App.el("div", { class: "tbl-wrap", style: "max-height:320px; margin-top:16px" });
    const table = App.el("table", { class: "tbl" },
      App.el("thead", {}, App.el("tr", {},
        App.el("th", {}, "供方"), App.el("th", { class: "num" }, "样本量"), App.el("th", { class: "num" }, "均值"),
        App.el("th", { class: "num" }, "标准差"), App.el("th", { class: "num" }, "最小值"), App.el("th", { class: "num" }, "最大值"),
        App.el("th", { class: "num" }, isYieldCap ? "—" : "合格率"))));
    const tbody = App.el("tbody");
    for (const stg of stages) {
      const row = App.el("tr", { class: "clickable" },
        App.el("td", {}, App.el("span", { class: "mono", style: `color:${stg.color}` }, stg.sup)),
        App.el("td", { class: "num" }, String(stg.n)),
        App.el("td", { class: "num" }, App.fmtMetric(st.metric, stg.mean)),
        App.el("td", { class: "num" }, App.fmtMetric(st.metric, stg.sd)),
        App.el("td", { class: "num" }, App.fmtMetric(st.metric, stg.min)),
        App.el("td", { class: "num" }, App.fmtMetric(st.metric, stg.max)),
        App.el("td", { class: "num" }, stg.passRate != null ? (stg.passRate * 100).toFixed(1) + "%" : "—"));
      row.addEventListener("click", () => App.openBatchDrawer(stg.arr[0].b.id));
      tbody.append(row);
    }
    table.append(tbody);
    tableWrap.append(table);

    // 顶部精致阶段图例条：避免与图表内部数据重叠
    const stageStrip = App.el("div", { class: "stage-legend-strip" });
    for (const stg of stages) {
      stageStrip.append(App.el("div", { class: "stage-chip", style: `--chip-color:${stg.color}` },
        App.el("span", { class: "stage-dot" }),
        App.el("span", { class: "stage-name" }, stg.sup),
        App.el("span", { class: "stage-count" }, `n=${stg.n}`)));
    }

    body.append(
      App.el("div", { class: "card supplier-stage-card" },
        App.el("div", { class: "card-head" },
          App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "truck" }), `${st.product} · ${st.stage} · ${st.metric} 供方分阶段控制图`),
          App.el("span", { class: "muted small" }, isYieldCap ? "已按大批次聚合均值" : `单位：${unit || "—"}`)),
        stageStrip,
        chartDom),
      App.el("div", { class: "card", style: "margin-top:16px" },
        App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "list" }), "各供方阶段统计")),
        tableWrap),
    );

    const isSeq = st.xAxisMode === "sequence";
    // batchId 模式：标签水平显示，调高 maxBatchLabels 抽样阈值，保证节点与批号一一对应
    const maxBatchLabels = 16;
    const batchInterval = isSeq ? 0 : (xLabels.length > maxBatchLabels ? Math.ceil(xLabels.length / maxBatchLabels) - 1 : 0);
    const yFormatter = axisLabelFormatter(yRange.max - yRange.min, st.metric);

    // 批次号太长时去除品名前缀，并按字符数逐步截断，确保节点与批号一一对应
    const shortBatchLabel = l => {
      if (!l) return l;
      const m = l.match(/-\d{5,}/);
      if (m) l = l.slice(m.index + 1);
      if (l.length <= 13) return l;
      // 统一截断为「前10 + … + 后2」，宽度可控避免像素重叠
      return l.slice(0, 10) + "…" + l.slice(-2);
    };
    const displayLabels = isSeq ? xLabels : xLabels.map(shortBatchLabel);

    const chart = App.makeChart(chartDom, {
      grid: { left: 56, right: 80, top: 28, bottom: 48, containLabel: false },
      // 单位已在 card-head 末尾显示（"单位：μm"），此处不再重复用 title 渲染
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(255,255,255,.96)",
        borderColor: "#e2e8f0",
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: "#1e293b", fontSize: 12 },
        formatter: p => {
          if (!p.data) return p.name;
          return `<b style="font-family:monospace">${p.data.bid}</b><br/>供方：${p.data.supplier}<br/>${st.metric} = <b>${App.fmtMetric(st.metric, p.data.value[1])}</b>${p.data.date ? `<br/><span class="muted">${p.data.date}</span>` : ""}`;
        }
      },
      xAxis: {
        // category 轴：每个分类对应一个节点，批号作为轴标签全部显示（interval: 0 + hideOverlap: false 真正生效）
        // boundaryGap: false → 分类 i 中心 = i，半整数坐标（x.5）才是分类边界，与 markArea/分隔线坐标体系一致
        type: "category",
        data: displayLabels,
        boundaryGap: false,
        splitLine: { show: false },
        axisLine: { lineStyle: { color: "#cbd5e1", width: 1 } },
        axisTick: { show: false },
        axisLabel: {
          rotate: 0,
          fontSize: 8,
          color: "#64748b",
          hideOverlap: false,
          interval: 0,
          margin: 8,
          formatter: (v) => v || "",
        }
      },
      yAxis: {
        type: "value",
        // 单位改用 title 组件放在纵轴正上方，此处不再使用 yAxis.name
        min: yRange.min,
        max: yRange.max,
        axisLabel: { formatter: yFormatter, color: "#64748b", fontSize: 10 },
        splitLine: { lineStyle: { color: "#f1f5f9", width: 1 } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      legend: { show: false },
      toolbox: { feature: { saveAsImage: {} }, right: 10, top: 0 },
      dataZoom: xLabels.length > 24 ? [{ type: "slider", height: 18, bottom: 4, start: 0, end: 100 }, { type: "inside" }] : undefined,
      series: [
        // 每个供方一个独立系列：折线连接 + 精致点
        ...stages.map(stg => ({
          name: stg.sup,
          type: "line",
          showSymbol: true,
          symbolSize: 9,
          connectNulls: false,
          smooth: false,
          lineStyle: { color: stg.color, width: 2, shadowColor: stg.color + "30", shadowBlur: 10, shadowOffsetY: 4 },
          itemStyle: {
            color: "#fff",
            borderColor: stg.color,
            borderWidth: 2.5,
            shadowColor: "rgba(15,23,42,.18)",
            shadowBlur: 6,
            shadowOffsetY: 3,
          },
          emphasis: {
            scale: 1.5,
            itemStyle: { shadowBlur: 10, shadowOffsetY: 4 },
            lineStyle: { width: 3 },
          },
          data: seriesData.map((p, i) => (p && i >= stg.startX && i <= stg.endX) ? p : null),
        })),
        // 空系列承载阶段分隔线、规格线、阶段区域填充
        {
          name: "参考线",
          type: "line",
          data: [],
          markLine: { silent: false, symbol: "none", data: markLines },
          // 阶段区域填充：覆盖 y 轴完整范围，x 轴左右边界精确对齐分隔虚线
          // 第一阶段从图表左边界 -0.5 开始；后续阶段左边界与上一阶段分隔线重合
          markArea: { silent: true, data: stages.map((stg, i) => [{
            xAxis: i === 0 ? -0.5 : stages[i - 1].endX + 0.5,
            yAxis: yRange.max,
            itemStyle: { color: stageGrad(stg.color), borderWidth: 0 }
          }, {
            xAxis: stg.endX + 0.5,
            yAxis: yRange.min
          }]) },
        },
      ],
    });
  }

  /* ===================== 判异规则 ===================== */
  function drawRules(body) {
    const ordered = orderedPoints();
    const vals = ordered.map(p => p.v);
    if (vals.length < 2) { body.append(App.el("div", { class: "empty" }, "数据点不足，无法执行判异规则")); return; }

    const m = mean(vals), sd = std(vals);
    const spec = effectiveSpec();
    const violations = detectRules(ordered);

    const rulesInfo = [
      ["规则1", "1点超出3σ控制限", "过程存在异常特殊原因"],
      ["规则2", "连续9点落在中心线同侧", "过程发生偏移"],
      ["规则3", "连续6点递增或递减", "过程存在趋势"],
      ["规则4", "连续14点上下交替", "数据可能存在过度调整或分层问题"],
      ["规则5", "连续3点中有2点落在2σ~3σ区（同侧）", "过程波动偏大"],
      ["规则6", "连续5点中有4点落在1σ~2σ区（同侧）", "过程中心可能偏移"],
      ["规则7", "连续15点落在±1σ内", "数据分层或测量分辨率不足"],
      ["规则8", "连续8点落在±1σ外且两侧均无点在±1σ内", "过程双模分布或过度调整"],
    ];
    const infoDom = App.el("div", { class: "card", style: "margin-bottom:16px" });
    const infoTable = App.el("table", { class: "tbl" },
      App.el("thead", {}, App.el("tr", {}, App.el("th", {}, "规则"), App.el("th", {}, "判异准则"), App.el("th", {}, "含义"))));
    const infoBody = App.el("tbody");
    for (const [r, c, h] of rulesInfo) {
      infoBody.append(App.el("tr", {}, App.el("td", { style: "font-weight:600" }, r), App.el("td", {}, c), App.el("td", { class: "muted" }, h)));
    }
    infoTable.append(infoBody);
    infoDom.append(App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "info" }), "Western Electric 判异规则说明")), infoTable);

    const summaryDom = App.el("div", { class: "stat-strip", style: "margin-bottom:16px" },
      App.el("div", { class: "st" }, App.el("div", { class: "v" }, String(vals.length)), App.el("div", { class: "l" }, "样本量")),
      App.el("div", { class: "st" }, App.el("div", { class: "v" }, App.fmtMetric(st.metric, m)), App.el("div", { class: "l" }, "中心线（均值）")),
      App.el("div", { class: "st" }, App.el("div", { class: "v" }, App.fmtMetric(st.metric, sd)), App.el("div", { class: "l" }, "控制限σ")),
      App.el("div", { class: "st" }, App.el("div", { class: "v", style: violations.length ? "color:#dc2626" : "" }, String(violations.length)), App.el("div", { class: "l" }, "异常触发点")),
    );

    body.append(summaryDom, infoDom);

    if (!violations.length) {
      body.append(App.el("div", { class: "card" },
        App.el("div", { class: "card-body" },
          App.el("div", { class: "note" }, App.el("i", { "data-lucide": "check-circle-2" }), `当前序列未触发任何 Western Electric 判异规则，过程处于统计受控状态。`))));
      return;
    }

    const chartDom = App.el("div", { class: "chart tall", style: "height:360px" });
    const tableWrap = App.el("div", { class: "tbl-wrap", style: "max-height:320px; margin-top:16px" });
    const table = App.el("table", { class: "tbl" },
      App.el("thead", {}, App.el("tr", {},
        App.el("th", {}, "批次号"), App.el("th", {}, "规则"), App.el("th", { class: "num" }, "指标值"),
        App.el("th", { class: "num" }, "z 值"), App.el("th", {}, "详情"))));
    const tbody = App.el("tbody");
    for (const v of violations) {
      const z = (v.p.v - m) / sd;
      const row = App.el("tr", { class: "clickable" },
        App.el("td", { class: "mono" }, v.p.b.id),
        App.el("td", {}, App.el("span", { class: "pill bad" }, v.rule.split("：")[0])),
        App.el("td", { class: "num" }, App.fmtMetric(st.metric, v.p.v)),
        App.el("td", { class: "num" }, z.toFixed(2)),
        App.el("td", { class: "muted small" }, v.detail));
      row.addEventListener("click", () => App.openBatchDrawer(v.p.b.id));
      tbody.append(row);
    }
    table.append(tbody);
    tableWrap.append(table);

    body.append(
      App.el("div", { class: "card" },
        App.el("div", { class: "card-head" },
          App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "shield-alert" }), `${st.metric} 判异控制图`),
          App.el("span", { class: "muted small" }, `触发 ${violations.length} 处异常`)),
        chartDom),
      App.el("div", { class: "card", style: "margin-top:16px" },
        App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "list" }), "异常点明细")),
        tableWrap),
    );

    const xLabels = ordered.map((p, i) => p.date || p.b.id);
    const seriesData = ordered.map((p, i) => {
      const vio = violations.filter(x => x.p.b.id === p.b.id);
      const color = vio.length ? "#dc2626" : "#2563eb";
      const size = vio.length ? 10 : 5;
      return { value: [i, p.v], bid: p.b.id, label: xLabels[i], itemStyle: { color }, symbolSize: size };
    });
    const rulesYLimits = [m - 3 * sd, m - 2 * sd, m - sd, m, m + sd, m + 2 * sd, m + 3 * sd];
    const rulesYRange = axisRange(vals, rulesYLimits, 0.08);
    App.makeChart(chartDom, {
      grid: { left: 62, right: 28, top: 44, bottom: 56 },
      tooltip: {
        trigger: "item",
        formatter: p => {
          const vio = violations.filter(x => x.p.b.id === p.data.bid);
          return `<b style="font-family:monospace">${p.data.bid}</b><br/>${st.metric} = <b>${App.fmtMetric(st.metric, p.data.value[1])}</b>` +
            (vio.length ? `<br/><span style="color:#dc2626">${vio.map(x => x.rule.split("：")[0]).join("、")}</span>` : "");
        }
      },
      xAxis: { type: "category", data: xLabels, axisLabel: { hideOverlap: true, rotate: xLabels.length > 20 ? 35 : 0, fontSize: 10, interval: Math.max(0, Math.ceil(xLabels.length / 16) - 1) } },
      yAxis: { type: "value", name: App.S.units.get(st.metric) || "", min: rulesYRange.min, max: rulesYRange.max, axisLabel: { formatter: axisLabelFormatter(rulesYRange.max - rulesYRange.min, st.metric) }, splitLine: { lineStyle: { color: "#eef2f6" } } },
      toolbox: { feature: { saveAsImage: {} }, right: 8, top: 0 },
      dataZoom: [{ type: "slider", height: 18, bottom: 10, start: 0, end: xLabels.length > 30 ? 50 : 100 }, { type: "inside" }],
      series: [{
        name: st.metric, type: "line", showSymbol: true, connectNulls: false,
        lineStyle: { color: "#94a3b8", width: 1 },
        data: seriesData,
        markLine: {
          silent: true, symbol: "none",
          data: [
            { yAxis: +m.toFixed(6), lineStyle: { color: "#2563eb", type: "solid", width: 1.5 }, label: { formatter: `CL ${App.fmtMetric(st.metric, m)}`, position: "insideEndTop", fontSize: 9, color: "#2563eb" } },
            { yAxis: +(m + 3 * sd).toFixed(6), lineStyle: { color: "#dc2626", type: "dashed" }, label: { formatter: "+3σ", fontSize: 9, color: "#dc2626" } },
            { yAxis: +(m - 3 * sd).toFixed(6), lineStyle: { color: "#dc2626", type: "dashed" }, label: { formatter: "-3σ", fontSize: 9, color: "#dc2626" } },
            { yAxis: +(m + 2 * sd).toFixed(6), lineStyle: { color: "#f59e0b", type: "dashed", width: 1 }, label: { formatter: "+2σ", fontSize: 9, color: "#f59e0b" } },
            { yAxis: +(m - 2 * sd).toFixed(6), lineStyle: { color: "#f59e0b", type: "dashed", width: 1 }, label: { formatter: "-2σ", fontSize: 9, color: "#f59e0b" } },
            { yAxis: +(m + sd).toFixed(6), lineStyle: { color: "#10b981", type: "dashed", width: 1 }, label: { formatter: "+1σ", fontSize: 9, color: "#10b981" } },
            { yAxis: +(m - sd).toFixed(6), lineStyle: { color: "#10b981", type: "dashed", width: 1 }, label: { formatter: "-1σ", fontSize: 9, color: "#10b981" } },
          ]
        },
      }],
    });
  }

  /* ===================== 渲染入口 ===================== */
  function render(root) {
    root.innerHTML = "";
    const { S } = App;
    const products = S.data.meta.products || [];
    st.tab = st.tab || "trend";
    // 跟随顶部"基体"按钮：当 S.product 变化时同步 st.product
    if (st.product !== S.product) {
      st.product = S.product;
      st.metric = null;
      st.supplier = "";
      st.focusBatch = null;
      st.fbDefect = null;
      st.reportDefect = null;
    }

    const TABS = [
      { id: "trend", name: "趋势与能力", icon: "activity" },
      { id: "distribution", name: "分布分析", icon: "bar-chart-horizontal" },
      { id: "boxplot", name: "工序对比", icon: "git-compare" },
      { id: "pareto", name: "缺陷 Pareto", icon: "alert-triangle" },
      { id: "supplier", name: "供方质量对比", icon: "truck" },
      { id: "rules", name: "判异规则", icon: "shield-alert" },
      { id: "insight", name: "一键洞察", icon: "sparkles" },
      { id: "report", name: "改进报告", icon: "file-text" },
    ];
    const tabbar = App.el("div", { class: "tabbar" });
    for (const t of TABS) {
      tabbar.append(App.el("button", { class: "tab" + (st.tab === t.id ? " active" : ""), onclick: () => { st.tab = t.id; App.render(); } },
        App.el("i", { "data-lucide": t.icon }), t.name));
    }

    const ctx = App.el("div", { class: "toolbar" });
    const stageSeg = App.el("div", { class: "seg" });
    const supplierSel = App.el("select", { class: "input", style: "min-width:120px" });
    function rebuildSupplierSel() {
      supplierSel.innerHTML = "";
      const suppliers = suppliersFor(st.product, st.stage);
      if (!suppliers.includes(st.supplier)) st.supplier = "";
      supplierSel.append(App.el("option", { value: "" }, "全部供方"));
      for (const s of suppliers) {
        if (!s) continue;
        supplierSel.append(App.el("option", { value: s }, s));
      }
      supplierSel.value = st.supplier || "";
    }
    function rebuildSegs() {
      stageSeg.innerHTML = "";
      for (const s of App.STAGES) stageSeg.append(App.el("button", { class: s === st.stage ? "active" : "", onclick: () => { st.stage = s; st.metric = null; st.supplier = ""; st.fbDefect = null; st.reportDefect = null; st.focusBatch = null; App.render(); } }, s));
      rebuildSupplierSel();
    }
    rebuildSegs();
    supplierSel.addEventListener("change", () => { st.supplier = supplierSel.value; st.focusBatch = null; App.render(); });
    // 基体显示：从 App.S.product 取（顶部按钮控制），不再有内部分段
    ctx.append(
      App.el("span", { class: "small", style: "font-weight:600; color:var(--ink-2)" }, "基体："), App.el("span", { class: "mono", style: "color:var(--ink-1); font-weight:600; padding: 4px 10px; background: var(--accent-soft); border-radius: 999px;" }, st.product),
      App.el("span", { class: "small", style: "font-weight:600; color:var(--ink-2); margin-left:4px" }, "工序"), stageSeg);
    if (st.tab !== "supplier") ctx.append(App.el("span", { class: "small", style: "font-weight:600; color:var(--ink-2); margin-left:8px" }, "供方"), supplierSel);

    const body = App.el("div");
    function drawActive() {
      body.innerHTML = "";
      App.disposeCharts();
      if (st.tab === "trend") drawTrend(body);
      else if (st.tab === "distribution") drawDistribution(body);
      else if (st.tab === "boxplot") drawBoxplot(body);
      else if (st.tab === "pareto") drawPareto(body);
      else if (st.tab === "supplier") drawSupplier(body);
      else if (st.tab === "rules") drawRules(body);
      else if (st.tab === "insight") drawInsight(body);
      else if (st.tab === "report") drawReport(body);
      App.refreshIcons();
    }

    root.append(tabbar, ctx, body);
    drawActive();
  }

  /* ===================== 趋势与能力（批次级） ===================== */
  function drawTrend(body) {
    const { S } = App;
    const metricSel = App.el("select", { class: "input", style: "min-width:160px" });
    const xAxisModeSel = App.el("select", { class: "input", style: "min-width:90px" },
      App.el("option", { value: "date" }, "时间"),
      App.el("option", { value: "batchId" }, "批次号"),
      App.el("option", { value: "sequence" }, "序号"));
    xAxisModeSel.value = st.xAxisMode || "date";
    const focusSel = buildBatchFocusSelector(st.product, st.stage, () => App.render(), st.supplier);

    function rebuildMetricSel() {
      metricSel.innerHTML = "";
      const mets = metricsFor();
      if (!st.metric || !mets.includes(st.metric)) {
        const specd = mets.find(m => App.lookupSpec(st.product, st.stage, m, st.supplier));
        st.metric = specd || mets[0] || null;
      }
      for (const m of mets) metricSel.append(App.el("option", { value: m }, m + (S.units.get(m) ? `（${S.units.get(m)}）` : "")));
      metricSel.value = st.metric || "";
    }
    rebuildMetricSel();
    metricSel.addEventListener("change", () => { st.metric = metricSel.value; App.render(); });
    xAxisModeSel.addEventListener("change", () => { st.xAxisMode = xAxisModeSel.value; App.render(); });

    body.append(App.el("div", { class: "toolbar" },
      App.el("span", { class: "small", style: "font-weight:600; color:var(--ink-2)" }, "指标"), metricSel,
      App.el("span", { class: "small", style: "font-weight:600; color:var(--ink-2); margin-left:8px" }, "横坐标"), xAxisModeSel,
      App.el("span", { class: "small", style: "font-weight:600; color:var(--ink-2); margin-left:8px" }, "批次聚焦"), focusSel));

    const fb = focusBatch();
    if (fb) {
      const card = renderFocusBatchCard(fb);
      if (card) body.append(card);
    }

    if (!st.metric) { body.append(App.el("div", { class: "empty" }, "该产品/工序暂无数值型指标数据")); return; }
    const spec = specFor();
    const pts = points();
    const vals = pts.map(p => p.v);
    const unit = (spec && spec.unit) || S.units.get(st.metric) || "";

    const judgedPts = pts.map(p => ({ p, j: App.judgeVal(p.v, spec) })).filter(x => x.j !== null);
    const okN = judgedPts.filter(x => x.j).length;
    const m = vals.length ? mean(vals) : 0, sd = vals.length > 1 ? std(vals) : 0;
    let cpk = null;
    if (spec && vals.length > 1 && sd > 0) {
      const cpu = spec.upper != null ? (spec.upper - m) / (3 * sd) : null;
      const cpl = spec.lower != null ? (m - spec.lower) / (3 * sd) : null;
      cpk = cpu != null && cpl != null ? Math.min(cpu, cpl) : (cpu ?? cpl);
    }
    const med = vals.length ? quantile(vals, .5) : 0;
    const q1 = vals.length ? quantile(vals, .25) : 0, q3 = vals.length ? quantile(vals, .75) : 0;
    const mn = vals.length ? Math.min(...vals) : 0, mx = vals.length ? Math.max(...vals) : 0;
    const cv = m !== 0 ? sd / Math.abs(m) * 100 : 0;
    let cap = null;
    if (spec && (spec.lower != null || spec.upper != null) && sd > 0) {
      const USL = spec.upper, LSL = spec.lower;
      const cpu2 = USL != null ? (USL - m) / (3 * sd) : null;
      const cpl2 = LSL != null ? (m - LSL) / (3 * sd) : null;
      const cpk2 = cpu2 != null && cpl2 != null ? Math.min(cpu2, cpl2) : (cpu2 != null ? cpu2 : cpl2);
      const cp2 = (USL != null && LSL != null) ? (USL - LSL) / (6 * sd) : null;
      cap = { cp: cp2, cpk: cpk2, pp: cp2, ppk: cpk2 };
    }

    const ordered = pts.slice().sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date);
      return a.b.id.localeCompare(b.b.id);
    });
    const allHaveDates = ordered.length > 0 && ordered.every(p => p.date);

    const qMode = st.xAxisMode || "date";
    let xLabels, trendXAxis, xValGetter;
    if (qMode === "date") {
      xLabels = ordered.map(p => p.date || p.b.id);
      if (allHaveDates) { trendXAxis = { type: "time", axisLabel: { hideOverlap: true } }; xValGetter = (p) => p.date; }
      else { trendXAxis = { type: "category", data: xLabels, axisLabel: { hideOverlap: true, rotate: xLabels.length > 20 ? 35 : 0, fontSize: 10, interval: Math.max(0, Math.ceil(xLabels.length / 16) - 1) } }; xValGetter = (p) => p.b.id; }
    } else if (qMode === "batchId") {
      xLabels = ordered.map(p => p.b.id);
      trendXAxis = { type: "category", data: xLabels, axisLabel: { hideOverlap: true, rotate: xLabels.length > 20 ? 35 : 0, fontSize: 10, interval: Math.max(0, Math.ceil(xLabels.length / 16) - 1) } };
      xValGetter = (p) => p.b.id;
    } else {
      xLabels = ordered.map((_, i) => String(i + 1));
      trendXAxis = { type: "category", data: xLabels, axisLabel: { hideOverlap: true, fontSize: 10 } };
      xValGetter = (p, i) => i + 1;
    }

    const trendDom = App.el("div", { class: "chart tall", style: "height:360px" });

    const histDom = App.el("div", { class: "chart" });
    const normDom = App.el("div", { class: "chart" });
    const capDom = App.el("div", { class: "chart", style: "height:auto; min-height:280px" });
    const boxDom = App.el("div", { class: "chart" });
    const paretoDom = App.el("div", { class: "chart", style: "height:300px" });

    const fmtM = v => App.fmtMetric(st.metric, v);
    const passRateVal = judgedPts.length ? okN / judgedPts.length * 100 : null;
    const passRate = passRateVal != null ? passRateVal.toFixed(1) + "%" : "—";
    const passCount = judgedPts.length ? `(${okN}/${judgedPts.length})` : "";
    const cpkVal = cap && cap.cpk != null ? cap.cpk : null;
    const cpkStr = cpkVal != null ? cpkVal.toFixed(2) : "—";

    // 生效规格：系统规格 + 用户自定义规则
    const custom = MESControl.get(st.product, st.stage, st.metric);
    const effectiveSpec = custom
      ? { ...(spec || {}), type: custom.type, lower: custom.lower != null ? custom.lower : (spec ? spec.lower : null), upper: custom.upper != null ? custom.upper : (spec ? spec.upper : null), target: custom.target != null ? custom.target : (spec ? spec.target : null), raw: describeLimit(custom), isCustom: true }
      : spec;
    const hasControlLimit = effectiveSpec && (effectiveSpec.lower != null || effectiveSpec.upper != null || effectiveSpec.target != null);

    const isPending = effectiveSpec && effectiveSpec.rule === "pending";
    // 判异检测：只在有控制限/规格且样本量足够时执行，避免无规格或小样本误报
    const anomalies = (!isPending && hasControlLimit && vals.length > 1 && sd > 0) ? MESControl.detectAnomalies(vals, m, sd) : { rules: [], violationIdx: new Set() };
    const anomPill = isPending
      ? App.el("span", { class: "pill info" }, "指标待定")
      : (anomalies.rules.length
          ? App.el("span", { class: "pill bad" }, `⚠ 检出 ${anomalies.rules.length} 类异常`)
          : App.el("span", { class: "pill ok" }, vals.length < 20 ? "✓ 样本量不足 20，暂不判异" : "✓ 过程受控"));

    const statStrip = App.el("div", { class: "stat-strip" });
    const stripItems = [
      [String(vals.length), "样本量", null],
      [fmtM(m), "均值", null],
      [fmtM(sd), "标准差", null],
      [`${fmtM(mn)} ~ ${fmtM(mx)}`, "极差", null],
      [passRate, "合格率" + (passCount ? " " + passCount : ""), passRateVal != null && passRateVal < 80 ? "#dc2626" : null],
      [cpkStr, "Cpk", cpkVal != null && cpkVal < 1.0 ? "#dc2626" : null],
    ];
    for (const [val, label, color] of stripItems) {
      statStrip.append(App.el("div", { class: "st" },
        App.el("div", { class: "v", style: color ? "color:" + color : "" }, val),
        App.el("div", { class: "l" }, label)));
    }

    body.append(
      statStrip,
      App.el("div", { class: "card", style: "margin-bottom:16px" },
        App.el("div", { class: "card-head" },
          App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "activity" }), `${st.product} · ${st.stage} · ${st.metric} 趋势控制图`),
          App.el("div", { class: "muted small", style: "display:flex; gap:10px; align-items:center" },
            allHaveDates ? null : App.el("span", { class: "pill warn" }, "未填写日期，按批号排序"),
            App.el("span", {}, effectiveSpec ? (effectiveSpec.rule === "pending" ? "规格：待定" : `规格：${effectiveSpec.raw}`) : "无规格标准"),
            anomPill)),
        buildLimitsToolbar(st.product, st.stage, st.metric, () => App.render()),
        trendDom),
      App.el("div", { class: "grid", style: "grid-template-columns: 1fr 1fr" },
        App.el("div", { class: "card" }, App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "bar-chart-horizontal" }), "分布直方图")), histDom),
        App.el("div", { class: "card" }, App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "trending-up" }), "正态概率图")), normDom)),
      App.el("div", { class: "grid", style: "grid-template-columns: 1fr 1fr; margin-top:16px" },
        App.el("div", { class: "card" }, App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "gauge" }), "过程能力分析")), capDom),
        App.el("div", { class: "card" }, App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "git-compare" }), "工序间对比（箱线图）")), boxDom)),
      App.el("div", { class: "card", style: "margin-top:16px" },
        App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "alert-triangle" }), "缺陷分析（按指标 Pareto）")),
        paretoDom),
    );

    // 异常批次清单（批次级）：只列出超出规格或触发了 SPC 规则的批次
    const badPts = ordered.map((p, i) => ({ p, i, j: App.judgeVal(p.v, effectiveSpec), isAnom: anomalies.violationIdx.has(i) }))
      .filter(x => x.j === false || x.isAnom);
    if (badPts.length) {
      const list = App.el("div", { class: "anomaly-list" });
      for (const x of badPts.slice(0, 20)) {
        const reason = x.j === false ? "超出规格" : (x.isAnom ? "统计模式异常" : "");
        list.append(App.el("div", { class: "anomaly-item" },
          App.el("button", { class: "btn sm", onclick: () => { st.focusBatch = x.p.b.id; App.render(); } }, "聚焦"),
          App.el("button", { class: "btn sm", onclick: () => App.openBatchDrawer(x.p.b.id) }, "详情"),
          App.el("span", { class: "ai-rule" + (x.j === false ? " bad" : " warn") }, x.p.b.id),
          App.el("div", { class: "ai-desc" }, `${st.metric} = ${fmtM(x.p.v)} ${unit} · ${reason}${x.p.date ? " · " + x.p.date : ""}`)));
      }
      body.append(App.el("div", { class: "card", style: "margin-top:16px" },
        App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "list" }), "异常/不合格批次明细")),
        App.el("div", { class: "card-body" }, list)));
    }

    const specLines = [];
    const markAreaData = [];
    if (effectiveSpec) {
      const c = custom ? "#2563eb" : "#dc2626";
      if (effectiveSpec.lower != null) specLines.push({ yAxis: effectiveSpec.lower, lineStyle: { color: c, type: "dashed" }, label: { formatter: `下限 ${effectiveSpec.lower}`, position: "insideStartTop", fontSize: 10, color: c } });
      if (effectiveSpec.upper != null) specLines.push({ yAxis: effectiveSpec.upper, lineStyle: { color: c, type: "dashed" }, label: { formatter: `上限 ${effectiveSpec.upper}`, position: "insideStartBottom", fontSize: 10, color: c } });
      if (effectiveSpec.lower != null && effectiveSpec.upper != null) markAreaData.push([{ yAxis: effectiveSpec.lower, itemStyle: { color: custom ? "rgba(37,99,235,.07)" : "rgba(22,163,74,.07)" } }, { yAxis: effectiveSpec.upper }]);
    }
    specLines.push({ yAxis: +m.toFixed(6), lineStyle: { color: "#2563eb", type: "solid", width: 1.5 }, silent: true, label: { formatter: `均值 ${App.fmtMetric(st.metric, m)}`, position: "insideEndTop", fontSize: 9, color: "#2563eb" } });
    const ctrlTgt = effectiveSpec && effectiveSpec.target != null ? effectiveSpec.target : null;
    if (ctrlTgt != null) specLines.push({ yAxis: +ctrlTgt.toFixed(6), lineStyle: { color: "#0d9488", type: "dotted", width: 1.2 }, silent: true, label: { formatter: `中值 ${ctrlTgt}`, position: "insideEndBottom", fontSize: 9, color: "#0d9488" } });
    const trendYRange = axisRange(vals, [effectiveSpec && effectiveSpec.lower, effectiveSpec && effectiveSpec.upper, ctrlTgt, m].filter(v => v != null), 0.08);

    const trendSeriesData = ordered.map((p, i) => {
      const j = App.judgeVal(p.v, effectiveSpec);
      let color = "#94a3b8";
      if (j === false) color = "#dc2626";
      else if (j === true) color = "#2563eb";
      const isAnom = anomalies.violationIdx.has(i);
      return {
        value: [xValGetter(p, i), p.v], bid: p.b.id, j, label: p.b.id,
        itemStyle: { color },
        markPoint: isAnom ? { symbol: "circle", symbolSize: 14, itemStyle: { color: "transparent", borderColor: "#f59e0b", borderWidth: 3 }, label: { show: false } } : undefined,
      };
    });

    const trendChart = App.makeChart(trendDom, {
      grid: { left: 62, right: 28, top: 44, bottom: 56 },
      tooltip: { trigger: "item", formatter: p => {
        const d = p.data; const yVal = d.value[1];
        return `<b style="font-family:monospace">${d.bid}</b><br/>${st.metric} = <b>${App.fmtMetric(st.metric, yVal)}</b> ${unit}` +
          (d.j === false ? `<br/><span style="color:#dc2626">超出规格</span>` : d.j === true ? `<br/><span style="color:#16a34a">合格</span>` : "");
      } },
      toolbox: { feature: { saveAsImage: {} }, right: 8, top: 0 },
      xAxis: trendXAxis,
      yAxis: { type: "value", name: unit, min: trendYRange.min, max: trendYRange.max, axisLabel: { formatter: axisLabelFormatter(trendYRange.max - trendYRange.min, st.metric) }, splitLine: { lineStyle: { color: "#eef2f6" } } },
      dataZoom: [{ type: "slider", height: 18, bottom: 10, start: 0, end: xLabels.length > 30 ? 50 : 100 }, { type: "inside" }],
      series: [{ name: st.metric, type: "line", showSymbol: true, symbolSize: 7, connectNulls: false, lineStyle: { color: "#94a3b8", width: 1 }, data: trendSeriesData, markLine: { silent: true, symbol: "none", data: specLines }, markArea: { silent: true, data: markAreaData } }],
    });
    trendChart.on("click", p => { if (p.data && p.data.bid) { st.focusBatch = p.data.bid; App.openBatchDrawer(p.data.bid); } });

    if (vals.length >= 3) {
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const nBins = Math.min(18, Math.max(5, Math.ceil(Math.sqrt(vals.length))));
      const step = (hi - lo) / nBins || 1;
      const bins = Array.from({ length: nBins }, (_, i) => ({ x0: lo + i * step, x1: lo + (i + 1) * step, n: 0 }));
      for (const v of vals) { const i = Math.min(nBins - 1, Math.floor((v - lo) / step)); bins[i].n++; }
      const histMarkArea = [];
      if (effectiveSpec && effectiveSpec.lower != null && effectiveSpec.upper != null) histMarkArea.push([{ xAxis: effectiveSpec.lower, itemStyle: { color: custom ? "rgba(37,99,235,.08)" : "rgba(22,163,74,.08)" } }, { xAxis: effectiveSpec.upper }]);
      const histMarkLine = [
        ...(effectiveSpec && effectiveSpec.lower != null ? [{ xAxis: effectiveSpec.lower, lineStyle: { color: custom ? "#2563eb" : "#dc2626", type: "dashed" }, label: { formatter: "下限", fontSize: 10, color: custom ? "#2563eb" : "#dc2626" } }] : []),
        ...(effectiveSpec && effectiveSpec.upper != null ? [{ xAxis: effectiveSpec.upper, lineStyle: { color: custom ? "#2563eb" : "#dc2626", type: "dashed" }, label: { formatter: "上限", fontSize: 10, color: custom ? "#2563eb" : "#dc2626" } }] : []),
        { xAxis: m, lineStyle: { color: "#2563eb" }, label: { formatter: "均值", fontSize: 10, color: "#2563eb" } },
      ];
      const histXRange = axisRange(vals, [effectiveSpec && effectiveSpec.lower, effectiveSpec && effectiveSpec.upper, ctrlTgt, m].filter(v => v != null), 0.05);
      const histXFmt = axisLabelFormatter(histXRange.max - histXRange.min, st.metric);
      App.makeChart(histDom, {
        grid: { left: 44, right: 20, top: 30, bottom: 40 },
        tooltip: { trigger: "item", formatter: p => `${App.fmt(p.data.value[0], 3)} ~ ${App.fmt(p.data.value[1], 3)}：<b>${p.data.value[2]}</b> 批` },
        xAxis: { type: "value", min: histXRange.min, max: histXRange.max, axisLabel: { formatter: histXFmt, fontSize: 10 } },
        yAxis: { type: "value", minInterval: 1, name: "批次" },
        toolbox: { feature: { saveAsImage: {} }, right: 10, top: 0 },
        series: [{ type: "bar", barWidth: "92%", itemStyle: { color: "#0d9488", borderRadius: [3, 3, 0, 0] }, data: bins.map(bn => ({ value: [bn.x0, bn.x1, bn.n] })), markLine: { silent: true, symbol: "none", data: histMarkLine }, markArea: { silent: true, data: histMarkArea } }],
      });
    } else { histDom.append(App.el("div", { class: "empty" }, "数据点不足，无法绘制分布")); }

    const boxStages = [], boxData = [], scatterData = [];
    for (const s of App.STAGES) {
      const vs = [];
      for (const b of App.S.data.batches) {
        if (b.product !== st.product || b.stage !== s) continue;
        const v = (b.metrics || {})[st.metric];
        if (typeof v === "number") vs.push(v);
      }
      if (vs.length >= 2) {
        boxStages.push(s);
        boxData.push([Math.min(...vs), quantile(vs, .25), quantile(vs, .5), quantile(vs, .75), Math.max(...vs)]);
        vs.forEach(v => scatterData.push([boxStages.length - 1, v]));
      }
    }
    if (boxData.length >= 2) {
      const boxLines = [];
      if (effectiveSpec && effectiveSpec.lower != null) boxLines.push({ yAxis: effectiveSpec.lower, lineStyle: { color: custom ? "#2563eb" : "#dc2626", type: "dashed" }, label: { position: "middle", formatter: `下限${custom ? "（自定义）" : ""} ${effectiveSpec.lower}`, fontSize: 9, color: custom ? "#2563eb" : "#dc2626", distance: 8 } });
      if (effectiveSpec && effectiveSpec.upper != null) boxLines.push({ yAxis: effectiveSpec.upper, lineStyle: { color: custom ? "#2563eb" : "#dc2626", type: "dashed" }, label: { position: "middle", formatter: `上限${custom ? "（自定义）" : ""} ${effectiveSpec.upper}`, fontSize: 9, color: custom ? "#2563eb" : "#dc2626", distance: 8 } });
      const boxYValues = boxData.flat().concat(scatterData.map(d => d[1]));
      const boxYRange = axisRange(boxYValues, [effectiveSpec && effectiveSpec.lower, effectiveSpec && effectiveSpec.upper].filter(v => v != null), 0.08);
      App.makeChart(boxDom, {
        grid: { left: 56, right: 20, top: 30, bottom: 30 },
        tooltip: { trigger: "item" },
        xAxis: { type: "category", data: boxStages },
        yAxis: { type: "value", name: unit, min: boxYRange.min, max: boxYRange.max, axisLabel: { formatter: axisLabelFormatter(boxYRange.max - boxYRange.min, st.metric) } },
        toolbox: { feature: { saveAsImage: {} }, right: 10, top: 0 },
        series: [
          { type: "boxplot", data: boxData, itemStyle: { color: "rgba(37,99,235,.18)", borderColor: "#2563eb" }, markLine: boxLines.length ? { silent: true, symbol: "none", symbolSize: 0, data: boxLines } : undefined },
          { type: "scatter", symbolSize: 4, itemStyle: { color: "rgba(13,148,136,.55)" }, data: scatterData },
        ],
      });
    } else { boxDom.append(App.el("div", { class: "empty" }, "各工序数据不足以对比")); }

    if (vals.length >= 3) {
      const sorted = [...vals].sort((a, b) => a - b);
      const Nn = sorted.length;
      const ptsNQ = sorted.map((v, i) => [probit((i + 0.5) / Nn), v]);
      const zMin = ptsNQ[0][0], zMax = ptsNQ[Nn - 1][0];
      App.makeChart(normDom, {
        grid: { left: 56, right: 20, top: 30, bottom: 44 },
        tooltip: { trigger: "item", formatter: p => p.seriesName === "样本" ? `z=${p.data[0].toFixed(2)}　值=<b>${fmtM(p.data[1])}</b>` : "" },
        legend: { data: ["样本", "正态参考线"], top: 0, textStyle: { fontSize: 11 } },
        xAxis: { type: "value", name: "分位数 z", nameLocation: "middle", nameGap: 26, axisLabel: { fontSize: 10 } },
        yAxis: { type: "value", name: unit, scale: true, axisLabel: { formatter: axisLabelFormatter(Math.max(...vals) - Math.min(...vals) || 1, st.metric), fontSize: 10 } },
        toolbox: { feature: { saveAsImage: {} }, right: 10, top: 0 },
        series: [
          { name: "样本", type: "scatter", symbolSize: 6, itemStyle: { color: "#2563eb" }, data: ptsNQ },
          { name: "正态参考线", type: "line", symbol: "none", lineStyle: { color: "#dc2626", type: "dashed", width: 1.5 }, data: [[zMin, m + sd * zMin], [zMax, m + sd * zMax]] },
        ],
      });
    } else { normDom.append(App.el("div", { class: "empty" }, "数据点不足，无法绘制正态概率图")); }

    if (cap) {
      const badge = capBadge(cap.cpk);
      const USL = effectiveSpec ? effectiveSpec.upper : null;
      const LSL = effectiveSpec ? effectiveSpec.lower : null;
      const tolWidth = (USL != null && LSL != null) ? USL - LSL : null;
      const spread6sd = 6 * sd;
      const capRows = [
        ["Cp", cap.cp != null ? cap.cp.toFixed(2) : "—", "Pp", cap.pp != null ? cap.pp.toFixed(2) : "—"],
        ["Cpk", cap.cpk != null ? cap.cpk.toFixed(2) : "—", "Ppk", cap.ppk != null ? cap.ppk.toFixed(2) : "—"],
        ["σ (整体)", fmtM(sd), "6σ 范围", fmtM(spread6sd)],
        ["均值", fmtM(m), "中心偏移", (tolWidth != null) ? fmtM(m - (USL + LSL) / 2) : "—"],
        ["上限 USL", USL != null ? fmtM(USL) : "—", "下限 LSL", LSL != null ? fmtM(LSL) : "—"],
        ["公差带宽度", tolWidth != null ? fmtM(tolWidth) : "—", "合格率", passRateVal != null ? passRateVal.toFixed(1) + "%" : "—"],
      ];
      const capTable = App.el("div", { class: "kv-table" });
      for (const [k1, v1, k2, v2] of capRows) {
        capTable.append(
          App.el("div", { class: "kv" }, App.el("span", { class: "k" }, k1), App.el("span", { class: "v" }, v1)),
          App.el("div", { class: "kv" }, App.el("span", { class: "k" }, k2), App.el("span", { class: "v" }, v2)));
      }
      capDom.append(
        App.el("div", { style: "padding:12px 16px 0" }, capTable),
        badge ? App.el("div", { style: "padding:8px 16px 0" }, App.el("span", { class: `cap-pill ${badge.cls}` }, badge.text)) : null,
        App.el("div", { class: "muted small", style: "padding:8px 16px; line-height:1.5" },
          "Cp/Cpk 基于子组内标准差评估过程能力，Pp/Ppk 为整体性能；",
          "Cpk≥1.33 视为过程能力充足，≥1.67 为优秀。"));
    } else {
      const pendingNote = spec && spec.rule === "pending" ? "指标规格待定，暂不计算能力指数" : "缺少规格上下限，无法计算能力指数";
      capDom.append(App.el("div", { class: "empty" }, pendingNote));
    }

    const defectList = [];
    for (const mt of metricsFor()) {
      let cnt = 0, tot = 0;
      for (const b of S.data.batches) {
        if (b.product !== st.product || b.stage !== st.stage) continue;
        const v = (b.metrics || {})[mt];
        if (typeof v !== "number") continue;
        tot++;
        const j = App.judgeVal(v, App.effectiveSpec(b, mt) || null);
        if (j === false) cnt++;
      }
      if (tot > 0) defectList.push({ mt, rate: cnt / tot });
    }
    defectList.sort((a, b) => b.rate - a.rate);
    if (defectList.length) {
      const top = defectList.slice(0, 12);
      const cum = []; let run = 0;
      for (const d of top) { run += d.rate; cum.push(+(run * 100).toFixed(1)); }
      App.makeChart(paretoDom, {
        grid: { left: 56, right: 56, top: 30, bottom: 64 },
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        legend: { data: ["缺陷率", "累计%"], top: 0, textStyle: { fontSize: 11 } },
        xAxis: { type: "category", data: top.map(d => d.mt), axisLabel: { rotate: top.length > 6 ? 35 : 0, fontSize: 10 } },
        yAxis: [
          { type: "value", name: "缺陷率", axisLabel: { formatter: v => (v * 100).toFixed(0) + "%" }, max: 1 },
          { type: "value", name: "累计%", min: 0, max: 100, axisLabel: { formatter: "{value}%" }, splitLine: { show: false } },
        ],
        toolbox: { feature: { saveAsImage: {} }, right: 10, top: 0 },
        series: [
          { name: "缺陷率", type: "bar", data: top.map(d => +d.rate.toFixed(4)), itemStyle: { color: "#ef4444", borderRadius: [3, 3, 0, 0] }, label: { show: true, position: "top", fontSize: 10, formatter: p => (p.value * 100).toFixed(1) + "%" } },
          { name: "累计%", type: "line", yAxisIndex: 1, data: cum, symbolSize: 6, lineStyle: { color: "#1e293b", width: 2 }, itemStyle: { color: "#1e293b" } },
        ],
      });
    } else { paretoDom.append(App.el("div", { class: "empty" }, "无可用指标")); }

    App.refreshIcons();
  }

  /* ===================== 一键洞察（qclaw：硅碳负极专项、批次级） ===================== */
  function drawInsight(body) {
    const { S } = App;

    // 若当前有选中的供方，洞察范围限定在该供方；否则为全部
    const batches = S.data.batches.filter(b => supplierFilter(b));

    // 1. 整体合格率（按批次自身供方规格判定）
    let judged = 0, ok = 0;
    for (const b of batches) for (const [k, v] of Object.entries(b.metrics || {})) { const sp = App.effectiveSpec(b, k); const j = App.judgeVal(v, sp); if (j !== null) { judged++; if (j) ok++; } }
    const passRate = judged ? ok / judged * 100 : null;

    // 2. 工序缺陷率
    const stageStat = App.STAGES.map(s => { let t = 0, f = 0; for (const b of batches) { if (b.stage !== s) continue; for (const [k, v] of Object.entries(b.metrics || {})) { const sp = App.effectiveSpec(b, k); const j = App.judgeVal(v, sp); if (j !== null) { t++; if (!j) f++; } } } return { s, t, f, rate: t ? f / t : 0 }; }).filter(x => x.t > 0);
    stageStat.sort((a, b) => b.rate - a.rate);
    const worstStage = stageStat[0];

    // 3. 首要不良项
    const defMap = new Map();
    for (const b of batches) for (const k of (b.fails || [])) defMap.set(k, (defMap.get(k) || 0) + 1);
    const topDefects = [...defMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    // 4. 过程能力达标率（仍按每行规格分别计算，若选中了供方只统计该供方规格）
    let capBad = 0, capTotal = 0;
    for (const sp of S.data.specs) {
      if (st.supplier && sp.supplier && !sp.suppliers?.includes(st.supplier)) continue;
      const vs = []; for (const b of batches) { if (b.product !== sp.product || b.stage !== sp.stage) continue; const v = b.metrics[sp.metric]; if (typeof v === "number") vs.push(v); }
      if (vs.length < 2) continue; const mm = mean(vs), sd2 = std(vs); if (sd2 <= 0) continue;
      const cpu = sp.upper != null ? (sp.upper - mm) / (3 * sd2) : null;
      const cpl = sp.lower != null ? (mm - sp.lower) / (3 * sd2) : null;
      const cpk = cpu != null && cpl != null ? Math.min(cpu, cpl) : (cpu ?? cpl);
      if (cpk == null) continue; capTotal++; if (cpk < 1.33) capBad++;
    }

    const cards = [
      { icon: "check-circle-2", title: "整体合格率", val: passRate != null ? passRate.toFixed(1) + "%" : "—", desc: judged ? `基于 ${judged} 条带规格判定（合格 ${ok}）` : "无规格判定数据" },
      { icon: "alert-triangle", title: "最差工序", val: worstStage ? worstStage.s : "—", desc: worstStage ? `缺陷率 ${(worstStage.rate * 100).toFixed(1)}%（${worstStage.f}/${worstStage.t}）` : "无数据" },
      { icon: "bar-chart", title: "首要不良项", val: topDefects.length ? topDefects[0][0] : "—", desc: topDefects.length ? `发生 ${topDefects[0][1]} 批，占不良首位` : "无不合格记录" },
      { icon: "gauge", title: "过程能力达标率", val: capTotal ? ((capTotal - capBad) / capTotal * 100).toFixed(0) + "%" : "—", desc: capTotal ? `Cpk≥1.33：${capTotal - capBad}/${capTotal} 项规格` : "无规格数据" },
    ];
    const grid = App.el("div", { class: "insight-grid" });
    for (const c of cards) grid.append(App.el("div", { class: "insight-card" }, App.el("h4", {}, App.el("i", { "data-lucide": c.icon }), c.title), App.el("div", { class: "iv" }, c.val), App.el("div", { class: "it" }, c.desc)));

    // 硅碳负极专项：关键指标异常批次
    const criticalCards = App.el("div", { class: "grid", style: "grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:16px; margin-top:16px" });
    for (const metric of ["磁性总量", "D50", "水分"]) {
      const rows = batchesByCriticalMetric(metric).slice(0, 5);
      criticalCards.append(App.el("div", { class: "card" },
        App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "flame" }), `${metric} 异常/逼近批次 Top5`)),
        App.el("div", { class: "card-body" }, rows.length
          ? App.el("div", { class: "anomaly-list" }, ...rows.map(r => App.el("div", { class: "anomaly-item" },
            App.el("button", { class: "btn sm", onclick: () => { st.product = r.b.product; st.stage = r.b.stage; st.focusBatch = r.b.id; st.tab = "trend"; App.render(); } }, "定位"),
            App.el("span", { class: "ai-rule" + (r.j === false ? " bad" : "") }, r.b.id),
            App.el("div", { class: "ai-desc" }, `${r.b.stage} · ${App.fmtMetric(metric, r.v)}${(r.sp && r.sp.unit) || S.units.get(metric) || ""} · ${r.j === false ? "不合格" : (r.deviation != null && r.deviation > 0.8 ? "逼近边界" : "正常")}`))))
          : App.el("div", { class: "empty" }, "无数据"))));
    }

    // 综合风险 Top 5 批次
    const risks = allBatchRisks().slice(0, 5);
    const riskCard = App.el("div", { class: "card", style: "margin-top:16px" },
      App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "shield-alert" }), "综合风险批次 Top 5（硅碳负极关键指标 + 下游传递）")),
      App.el("div", { class: "card-body" }, risks.length
        ? App.el("div", { class: "anomaly-list" }, ...risks.map(r => App.el("div", { class: "anomaly-item" },
          App.el("button", { class: "btn sm", onclick: () => { st.product = r.b.product; st.stage = r.b.stage; st.focusBatch = r.b.id; st.tab = "trend"; App.render(); } }, "聚焦"),
          App.el("span", { class: "ai-rule" + (r.score >= 60 ? " bad" : r.score >= 30 ? " warn" : "") }, r.b.id),
          App.el("div", { class: "ai-desc" }, `${r.b.stage} · 风险分 ${r.score} · ${r.reasons.join("；")}`))))
        : App.el("div", { class: "empty" }, "未发现风险批次")));

    // 工序传递风险
    const passRisk = downstreamPassRisk();
    const passRiskCard = App.el("div", { class: "card", style: "margin-top:16px" },
      App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "arrow-right-left" }), "工序传递风险（上游合格 → 下游因同指标不合格）")),
      App.el("div", { class: "card-body" }, passRisk.length
        ? App.el("div", { class: "anomaly-list" }, ...passRisk.map(c => App.el("div", { class: "anomaly-item" },
          App.el("button", { class: "btn sm", onclick: () => { st.product = c.downstream.product; st.stage = c.downstream.stage; st.metric = c.metric; st.focusBatch = c.downstream.id; st.tab = "rules"; App.render(); } }, "分析"),
          App.el("span", { class: "ai-rule" }, c.metric),
          App.el("div", { class: "ai-desc" }, `下游 ${c.downstream.id}(${c.downstream.stage}) 因 ${c.metric} 不合格；上游同指标已异常：${c.upstreamBad.map(p => p.id).join("、")}`))))
        : App.el("div", { class: "empty" }, "未发现明显工序传递风险")));

    body.append(
      App.el("div", { class: "card", style: "margin-bottom:16px" },
        App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "sparkles" }), "一键质量洞察（自动分析）")),
        App.el("div", { class: "card-body" }, grid)),
      criticalCards,
      riskCard,
      passRiskCard,
      App.el("div", { class: "card", style: "margin-top:16px" },
        App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "list" }), "不良项排行（Top 5）")),
        App.el("div", { class: "card-body" }, topDefects.length
          ? App.el("div", { class: "anomaly-list" }, ...topDefects.map(([k, n]) => App.el("div", { class: "anomaly-item" }, App.el("span", { class: "ai-rule" }, k), App.el("div", { class: "ai-desc" }, `${n} 批不合格`))))
          : App.el("div", { class: "empty" }, "无不合格记录"))));
    App.refreshIcons();
  }

  /* ===================== 改进报告（rohoon-6sigma 8D：具体批次级） ===================== */
  function drawReport(body) {
    const { S } = App;
    const focusSel = buildBatchFocusSelector(st.product, st.stage, () => App.render(), st.supplier);
    const fb = focusBatch();

    // 缺陷选择：优先用聚焦批次的不合格项，否则用全局缺陷
    const defectMap = new Map();
    if (fb) {
      for (const k of (fb.fails || [])) defectMap.set(k, 1);
    }
    if (!defectMap.size) {
      for (const b of S.data.batches) {
        if (b.product !== st.product || b.stage !== st.stage) continue;
        if (!supplierFilter(b)) continue;
        for (const k of (b.fails || [])) defectMap.set(k, (defectMap.get(k) || 0) + 1);
      }
    }
    const defectList = [...defectMap.entries()].sort((a, b) => b[1] - a[1]);
    const sel = App.el("select", { class: "input", style: "min-width:200px" });
    if (!defectList.length) sel.append(App.el("option", { value: "" }, "暂无不合格项"));
    for (const [k, n] of defectList) sel.append(App.el("option", { value: k }, fb ? `${k}` : `${k}（${n}）`));
    if (!st.reportDefect || !defectMap.has(st.reportDefect)) st.reportDefect = defectList.length ? defectList[0][0] : null;
    sel.value = st.reportDefect || "";
    sel.addEventListener("change", () => { st.reportDefect = sel.value; App.render(); });

    body.append(App.el("div", { class: "toolbar" },
      App.el("span", { class: "small", style: "font-weight:600;color:var(--ink-2)" }, "批次聚焦"), focusSel,
      App.el("span", { class: "small", style: "font-weight:600;color:var(--ink-2);margin-left:8px" }, "缺陷"), sel));

    const dk = fb ? `report|${fb.id}|${st.reportDefect || ""}` : `${st.product}|${st.stage}|${st.reportDefect}`;
    const custom = App.getCustom(dk);
    const spec = st.reportDefect
      ? (fb ? App.effectiveSpec(fb, st.reportDefect) : App.lookupSpec(st.product, st.stage, st.reportDefect, st.supplier))
      : null;

    let defectCount = 0, totalB = 0, vs = [], targetBatches = [];
    if (fb) {
      targetBatches = [fb];
      defectCount = (fb.fails || []).includes(st.reportDefect) ? 1 : 0;
      totalB = 1;
      const v = fb.metrics[st.reportDefect];
      if (typeof v === "number") vs.push(v);
    } else {
      targetBatches = S.data.batches.filter(b => b.product === st.product && b.stage === st.stage && supplierFilter(b));
      totalB = targetBatches.length;
      for (const b of targetBatches) {
        if ((b.fails || []).includes(st.reportDefect)) defectCount++;
        const v = b.metrics[st.reportDefect];
        if (typeof v === "number") vs.push(v);
      }
    }

    let cpkStr = "—";
    if (vs.length > 1) { const mm = mean(vs), sd2 = std(vs); if (sd2 > 0) { const cpu = spec && spec.upper != null ? (spec.upper - mm) / (3 * sd2) : null; const cpl = spec && spec.lower != null ? (mm - spec.lower) / (3 * sd2) : null; const cpk = cpu != null && cpl != null ? Math.min(cpu, cpl) : (cpu ?? cpl); if (cpk != null) cpkStr = cpk.toFixed(2); } }

    const parents = fb ? parentBatches(fb) : [];
    const parentInfo = parents.length ? parents.map(p => `${p.id}(${p.stage})`).join("、") : "无";
    const sampleValue = vs.length ? App.fmtMetric(st.reportDefect, vs[0]) : "—";

    const defaults = [
      ["D1 成立小组", "质量 / 工艺 / 生产 / 设备相关成员，由质量负责人牵头。"],
      ["D2 问题描述", fb
        ? `聚焦批次 ${fb.id}（${fb.product} / ${fb.stage}）指标「${st.reportDefect || "—"}」不合格：实测 ${sampleValue}${spec ? spec.unit || "" : ""}，规格 ${spec ? spec.raw : "无"}。上游批次：${parentInfo}。`
        : `产品「${st.product}」工序「${st.stage}」指标「${st.reportDefect || "—"}」不合格：${defectCount} 批，占该工序 ${totalB ? ((defectCount / totalB) * 100).toFixed(1) : "0"}%。规格：${spec ? spec.raw : "无"}。`],
      ["D3 临时措施", fb ? `立即隔离 ${fb.id}，暂停该批向下工序流转；同步复核同设备/同供方相邻批次。` : "隔离 / 标识不合格批次，通知下游暂停使用该批；加强出货检验。"],
      ["D4 根因分析", `结合批次级鱼骨图（4M1E）与过程能力（Cpk=${cpkStr}）定位关键因子；重点关注上游${parentInfo}是否携带同指标缺陷。`],
      ["D5 永久对策", "针对关键因子修订工艺参数 / 来料标准 / 设备点检；更新控制计划。"],
      ["D6 验证效果", "重新收集 20 批验证 Cpk≥1.33、缺陷率下降。"],
      ["D7 预防再发", "将对策纳入 SOP 与培训；纳入 SPC 监控。"],
      ["D8 团队表彰", "固化经验，归档本报告。"],
    ];
    const tas = [];
    const doc = App.el("div", { class: "report-doc" });
    doc.append(App.el("h3", {}, fb ? `8D 改进报告 — ${fb.id} · ${st.reportDefect || "缺陷"}` : `8D 改进报告 — ${st.reportDefect || "缺陷"}（${st.product} / ${st.stage}）`));
    doc.append(App.el("div", { style: "display:flex;gap:18px;flex-wrap:wrap;margin:8px 0 4px" },
      App.el("div", {}, App.el("b", {}, "Cpk："), cpkStr),
      App.el("div", {}, App.el("b", {}, "不合格批："), String(defectCount)),
      App.el("div", {}, App.el("b", {}, "规格："), spec ? spec.raw : "无"),
      fb ? App.el("div", {}, App.el("b", {}, "上游："), parentInfo) : null,
      App.el("div", {}, App.el("b", {}, "生成："), new Date().toLocaleDateString("zh-CN"))));
    for (const [k, v] of defaults) {
      const val = (custom.report && custom.report[k]) || v;
      const ta = App.el("textarea", {}, val);
      ta.addEventListener("change", () => { const c = App.getCustom(dk); c.report = c.report || {}; c.report[k] = ta.value; App.setCustom(dk, c); });
      tas.push(ta);
      doc.append(App.el("div", { class: "d-item" }, App.el("div", { class: "d-k" }, k), ta));
    }
    const exportBtn = App.el("button", { class: "btn primary", style: "margin-top:14px" }, App.el("i", { "data-lucide": "download" }), "导出报告（HTML）");
    exportBtn.addEventListener("click", () => {
      const items = defaults.map(([k], i) => [k, tas[i].value]);
      exportReportHTML(st, items, cpkStr, spec, defectCount, totalB, fb, parentInfo);
    });

    body.append(
      App.el("div", { class: "card", style: "margin-bottom:16px" },
        App.el("div", { class: "card-head" },
          App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "file-text" }), "改进报告生成（六西格玛 8D）"),
          App.el("div", { class: "muted small", style: "display:flex;gap:10px;align-items:center" },
            defectList.length ? `不合格项 ${defectList.length}` : "无",
            App.el("span", {}, "缺陷"), sel)),
        App.el("div", { class: "card-body" }, doc, exportBtn)));
    App.refreshIcons();
  }

  function exportReportHTML(st, items, cpkStr, spec, defectCount, totalB, fb, parentInfo) {
    const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    let html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>8D改进报告</title>`;
    html += `<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;max-width:840px;margin:24px auto;padding:0 20px;color:#1e293b;line-height:1.7}h1{color:#1e293b}table{width:100%;border-collapse:collapse;margin:12px 0}td,th{border:1px solid #e2e8f0;padding:9px}th{background:#eff6ff;text-align:left;width:130px}.k{font-weight:700;color:#2563eb}.meta{color:#64748b;font-size:13px}</style></head><body>`;
    html += `<h1>8D 改进报告 — ${fb ? esc(fb.id) + " · " : ""}${esc(st.reportDefect || "缺陷")}（${esc(fb ? fb.product : st.product)} / ${esc(fb ? fb.stage : st.stage)}）</h1>`;
    html += `<p class="meta">Cpk：${esc(cpkStr)} · 不合格批：${defectCount} · 规格：${spec ? esc(spec.raw) : "无"}${fb ? " · 上游：" + esc(parentInfo) : ""} · 生成：${new Date().toLocaleDateString("zh-CN")}</p>`;
    html += `<table>`;
    for (const [k, v] of items) html += `<tr><th class="k">${esc(k)}</th><td>${esc(v).replace(/\n/g, "<br>")}</td></tr>`;
    html += `</table><p style="margin-top:24px;color:#94a3b8;font-size:12px">由多孔碳 MES 离线平台生成 · 本报告随迁移包归档</p></body></html>`;
    App.download(`8D报告-${fb ? fb.id + "-" : ""}${st.reportDefect || "缺陷"}-${new Date().toISOString().slice(0, 10)}.html`, html, "text/html");
    App.toast("已导出 8D 改进报告 HTML", "ok");
  }

  return { render };
})();
