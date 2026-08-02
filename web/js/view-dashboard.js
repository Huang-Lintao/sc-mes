/* 总览看板 - 右侧可折叠全局切片器 + 趋势控制图 */
"use strict";
Views.dashboard = (() => {

  function kpiCard({ label, value, sub, icon, color }) {
    return App.el("div", { class: "kpi" },
      App.el("div", { class: "k-bar", style: `background:${color}` }),
      App.el("div", { class: "k-label" }, App.el("i", { "data-lucide": icon }), label),
      App.el("div", { class: "k-value", style: `color:${color}` }, value),
      App.el("div", { class: "k-sub" }, sub || ""));
  }

  /* ---------- 全局切片状态 ---------- */
  const st = {
    start: "", end: "",
    stages: new Set(),
    suppliers: new Set(),
    period: "month", // month | week
    yieldStage: "", // 右侧图表显示的收率工序，空表示不显示
    // 控制图自身状态
    ctrl: { product: "", stage: "", metric: "", yMin: "", yMax: "" },
  };

  function resetState() {
    st.start = ""; st.end = "";
    st.stages = new Set(App.STAGES);
    st.suppliers = new Set();
    st.period = "month";
    st.yieldStage = "";
    st.ctrl = { product: "", stage: "", metric: "", yMin: "", yMax: "" };
  }

  /* ---------- 工具函数 ---------- */
  function unique(arr) { return [...new Set(arr)]; }
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
  function weekKey(d) {
    // 月内周数：内部格式 YYYY-MM-Wn（用于排序/分组），周可跨月
    const date = new Date(d + "T00:00:00");
    const thu = new Date(date);
    thu.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    const y = thu.getFullYear();
    const m = thu.getMonth();
    const firstOfMonth = new Date(y, m, 1);
    const firstMon = new Date(firstOfMonth);
    firstMon.setDate(firstOfMonth.getDate() - ((firstOfMonth.getDay() + 6) % 7));
    const diffDays = Math.round((thu - firstMon) / 86400000);
    const wn = Math.floor(diffDays / 7) + 1;
    return `${y}-${String(m + 1).padStart(2, "0")}-W${wn}`;
  }
  // 智能周标签：同年只显示 MM-Wn（如 07-W3），跨年显示 yyMM-Wn（如 2607-W3）
  function formatWeekLabels(keys) {
    if (!keys.length) return [];
    // 检查是否跨年
    const years = new Set(keys.map(k => k.slice(0, 4)));
    if (years.size <= 1) {
      // 同年：去掉年份，只保留 MM-Wn
      return keys.map(k => k.slice(5)); // "2026-07-W3" → "07-W3"
    } else {
      // 跨年：用两位年份缩写 + MM-Wn
      return keys.map(k => k.slice(2)); // "2026-07-W3" → "2607-W3"
    }
  }
  function periodKey(date) { return st.period === "week" ? weekKey(date) : date.slice(0, 7); }
  function inferDateFromId(id) {
    if (!id || typeof id !== "string") return null;
    const m = id.match(/\d{6}/);
    if (!m) return null;
    const s = m[0];
    const yy = parseInt(s.slice(0, 2), 10);
    const mm = parseInt(s.slice(2, 4), 10);
    const dd = parseInt(s.slice(4, 6), 10);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${2000 + yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  function metricOptions() {
    const set = new Set(["收率", "产能", "数量"]);
    for (const b of App.S.data.batches) {
      for (const [k, v] of Object.entries(b.metrics || {})) {
        if (typeof v === "number") set.add(k);
      }
    }
    const order = App.METRIC_ORDER;
    return [...set].sort((a, b) => {
      const ai = order.indexOf(a), bi = order.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }

  function metricsForCtrl(product, stage, batches) {
    const set = new Set();
    for (const b of batches) {
      if (b.product !== product || b.stage !== stage) continue;
      for (const [k, v] of Object.entries(b.metrics || {})) {
        if (typeof v === "number" && !App.TEXT_METRICS.has(k)) set.add(k);
      }
      if (App.yieldOf(b) != null) set.add("收率");
      if (getVal(b, "数量") != null) set.add("数量");
    }
    const order = App.METRIC_ORDER;
    return [...set].sort((a, b) => {
      const ai = order.indexOf(a), bi = order.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }

  function getVal(b, key) {
    if (key === "收率") { const y = App.yieldOf(b); return y == null ? null : y; }
    if (key === "产能") return (b.weights || {})["产能"] ?? null;
    if (key === "数量") {
      const w = b.weights || {};
      const v = b.stage === "原料来料" ? (w["来料数量"] ?? w["来料重量"]) :
        b.stage === "细碎" || b.stage === "除磁" ? w["出料重量"] :
        b.stage === "分级" || b.stage === "混料" ? w["产出重量"] : null;
      return typeof v === "number" ? v : null;
    }
    const v = (b.metrics || {})[key];
    return typeof v === "number" ? v : null;
  }

  function valUnit(key) {
    if (key === "收率") return "%";
    if (key === "产能") return "kg/h";
    if (key === "数量") return "kg";
    return App.S.units.get(key) || "";
  }

  function quantile(a, q) {
    const s = [...a].sort((x, y) => x - y);
    const pos = (s.length - 1) * q, base = Math.floor(pos), rest = pos - base;
    return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
  }

  function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
  function std(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
  }

  /* ---------- 过滤 ---------- */
  function filterBatches(list) {
    const sups = st.suppliers;
    return list.filter(b => {
      if (!st.stages.has(b.stage)) return false;
      const d = b.date || inferDateFromId(b.id);
      if (d && ((st.start && d < st.start) || (st.end && d > st.end))) return false;
      if (sups.size && b.stage === "原料来料") {
        const s = b.supplier || (b.metrics || {})["供方名称"];
        if (s && !sups.has(s)) return false;
      }
      return true;
    });
  }

  /* 供方驱动的链路过滤：当选定供方时，只显示该供方入料之后的下游批次 */
  function filterBySupplierTrace(list) {
    const sups = st.suppliers;
    if (!sups.size) return list;
    // 找出所有匹配供方的原料来料批
    const seedIds = new Set();
    for (const b of list) {
      if (b.stage !== "原料来料") continue;
      const s = b.supplier || (b.metrics || {})["供方名称"];
      if (s && sups.has(s)) seedIds.add(b.id);
    }
    if (!seedIds.size) return list;
    // 下游溯源：从 seed 出发沿 edges 找到所有下游批
    const childByParent = new Map();
    for (const e of (App.S.data.edges || [])) {
      const arr = childByParent.get(e.from) || [];
      arr.push(e.to);
      childByParent.set(e.from, arr);
    }
    const reachable = new Set(seedIds);
    const stack = [...seedIds];
    while (stack.length) {
      const id = stack.pop();
      const children = childByParent.get(id) || [];
      for (const c of children) {
        if (!reachable.has(c)) { reachable.add(c); stack.push(c); }
      }
    }
    return list.filter(b => reachable.has(b.id));
  }

  /* ---------- 渲染 ---------- */
  function render(root) {
    const { S, STAGES, STAGE_COLOR } = App;
    if (!st.stages.size) resetState();

    const allBatches = App.byProduct(S.data.batches);
    const suppliers = unique(allBatches.filter(b => b.stage === "原料来料").map(b => b.supplier || (b.metrics || {})["供方名称"]).filter(Boolean)).sort();
    if (!st.suppliers.size && suppliers.length) st.suppliers = new Set(suppliers);

    const products = unique(allBatches.map(b => b.product)).sort();
    if (!st.ctrl.product || !products.includes(st.ctrl.product)) st.ctrl.product = products[0] || "";
    if (!st.ctrl.stage || !STAGES.includes(st.ctrl.stage)) st.ctrl.stage = STAGES[0] || "";

    function ensureCtrlMetric(batches) {
      const mets = metricsForCtrl(st.ctrl.product, st.ctrl.stage, batches);
      if (!mets.length) { st.ctrl.metric = ""; return; }
      if (st.ctrl.metric && mets.includes(st.ctrl.metric)) return;
      st.ctrl.metric = mets.find(m => !["收率", "产能", "数量"].includes(m)) || mets[0];
    }
    ensureCtrlMetric(allBatches);

    /* ---------- 右侧全局切片器面板 ---------- */
    function buildDateInput(stKey) {
      const wrap = App.el("div", { class: "date-input-wrap", style: "position:relative;width:100%;cursor:pointer" });
      const text = App.el("input", { class: "input", type: "text", placeholder: "年/月/日", value: st[stKey] ? st[stKey].replace(/-/g, "/") : "", style: "width:100%;pointer-events:none;user-select:none" });
      const date = App.el("input", { class: "input", type: "date", value: st[stKey] || "", style: "position:absolute;left:0;top:0;width:100%;height:100%;opacity:0;cursor:pointer;z-index:2" });
      const syncText = () => { text.value = st[stKey] ? st[stKey].replace(/-/g, "/") : ""; };
      date.addEventListener("change", () => { st[stKey] = date.value; syncText(); drawAll(); });
      date.addEventListener("blur", syncText);
      // 点击整片区域都主动唤起日历（Chrome 的透明 date input 只在右侧图标响应原生点击）
      wrap.addEventListener("click", (e) => {
        e.preventDefault();
        try { date.showPicker(); } catch (err) { date.focus(); }
      });
      wrap.append(text, date);
      return wrap;
    }
    const startIn = buildDateInput("start");
    const endIn = buildDateInput("end");

    const stageChecks = App.el("div", { class: "check-wrap" });
    const allStageCk = App.el("input", { type: "checkbox" });
    // 工序全选：三态逻辑（checked/indeterminate/unchecked），与供方全选一致
    allStageCk.addEventListener("click", (e) => {
      if (allStageCk.indeterminate) {
        e.preventDefault();
        STAGES.forEach(s => st.stages.add(s));
        stageCks.forEach(c => { c.checked = true; });
        allStageCk.checked = true; allStageCk.indeterminate = false;
        drawAll();
      }
    });
    allStageCk.addEventListener("change", () => {
      if (allStageCk.checked) {
        STAGES.forEach(s => st.stages.add(s));
      } else {
        STAGES.forEach(s => st.stages.delete(s));
      }
      stageCks.forEach(c => { c.checked = st.stages.has(c.dataset.stage); });
      updateStageChecks();
      drawAll();
    });
    stageChecks.append(App.el("label", { class: "check" }, allStageCk, "全选"));
    const stageCks = [];
    for (const s of STAGES) {
      const ck = App.el("input", { type: "checkbox" });
      ck.dataset.stage = s;
      ck.checked = st.stages.has(s);
      ck.addEventListener("change", () => {
        if (ck.checked) st.stages.add(s); else st.stages.delete(s);
        updateStageChecks();
        drawAll();
      });
      stageCks.push(ck);
      stageChecks.append(App.el("label", { class: "check" }, ck, s));
    }
    function updateStageChecks() {
      const n = st.stages.size;
      const total = STAGES.length;
      if (n === 0) {
        allStageCk.checked = false; allStageCk.indeterminate = false;
      } else if (n === total) {
        allStageCk.checked = true; allStageCk.indeterminate = false;
      } else {
        allStageCk.checked = false; allStageCk.indeterminate = true;
      }
    }
    updateStageChecks();

    const supChecks = App.el("div", { class: "check-wrap" });
    const allSupCk = App.el("input", { type: "checkbox" });
    // 全选切换：用 change 事件（浏览器已自动 toggle 复选框状态）
    // 视觉状态语义：checked=true 表示全部已选；indeterminate=true 表示部分已选
    // 行为：全选 → 全不选；其他（无/部分） → 全选
    allSupCk.addEventListener("click", (e) => {
      // 点击 indeterminate 复选框时浏览器行为不一致，有的转 checked 有的不变。
      // 这里强制干预：indeterminate 状态下应跳到 "全选"
      if (allSupCk.indeterminate) {
        e.preventDefault();
        st.suppliers = new Set(suppliers);
        supCks.forEach(c => { c.checked = true; });
        allSupCk.checked = true; allSupCk.indeterminate = false;
        drawAll();
      }
      // checked/unchecked 状态由浏览器 toggle，我们的 change 处理器负责数据同步
    });
    allSupCk.addEventListener("change", () => {
      // checked=true → 全选；checked=false → 全不选
      st.suppliers = allSupCk.checked ? new Set(suppliers) : new Set();
      supCks.forEach(c => { c.checked = st.suppliers.has(c.dataset.sup); });
      updateSupChecks();
      drawAll();
    });
    supChecks.append(App.el("label", { class: "check" }, allSupCk, "全选"));
    const supCks = [];
    for (const s of suppliers) {
      const ck = App.el("input", { type: "checkbox" });
      ck.dataset.sup = s;
      ck.checked = st.suppliers.has(s);
      ck.addEventListener("change", () => {
        if (ck.checked) st.suppliers.add(s); else st.suppliers.delete(s);
        updateSupChecks();
        drawAll();
      });
      supCks.push(ck);
      supChecks.append(App.el("label", { class: "check" }, ck, s));
    }
    function updateSupChecks() {
      const n = st.suppliers.size;
      const total = suppliers.length;
      if (total === 0 || n === 0) {
        allSupCk.checked = false; allSupCk.indeterminate = false;
      } else if (n === total) {
        allSupCk.checked = true; allSupCk.indeterminate = false;
      } else {
        allSupCk.checked = false; allSupCk.indeterminate = true;
      }
    }
    updateSupChecks();

    const periodSeg = App.el("div", { class: "seg" });
    for (const [v, l] of [["month", "按月"], ["week", "按周"]]) {
      const btn = App.el("button", { class: st.period === v ? "active" : "" }, l);
      btn.addEventListener("click", () => { st.period = v; refreshPeriodSeg(); drawAll(); });
      periodSeg.append(btn);
    }
    function refreshPeriodSeg() {
      [...periodSeg.children].forEach((b, i) => b.classList.toggle("active", (i === 0 ? "month" : "week") === st.period));
    }

    const resetBtn = App.el("button", { class: "btn sm" }, App.el("i", { "data-lucide": "rotate-ccw" }), "重置切片");
    resetBtn.addEventListener("click", () => {
      resetState();
      startIn.value = ""; endIn.value = "";
      [...stageChecks.querySelectorAll("input")].forEach(c => c.checked = true);
      STAGES.forEach(s => st.stages.add(s));
      if (allStageCk) { allStageCk.checked = true; allStageCk.indeterminate = false; }
      st.suppliers = new Set(suppliers);
      supCks.forEach(c => c.checked = true); allSupCk.checked = suppliers.length > 0;
      refreshPeriodSeg();
      if (yieldStageSel) { st.yieldStage = ""; yieldStageSel.value = ""; }
      // 控制图自身切片器也重置
      if (productSel) { st.ctrl.product = products[0] || ""; productSel.value = st.ctrl.product; }
      if (stageSel) { st.ctrl.stage = STAGES[0] || ""; stageSel.value = st.ctrl.stage; }
      if (metricSel) { st.ctrl.metric = opts.find(o => !["收率", "产能", "数量"].includes(o)) || opts[0] || ""; metricSel.value = st.ctrl.metric; }
      if (yMinIn) yMinIn.value = "";
      if (yMaxIn) yMaxIn.value = "";
      drawAll();
    });

    // 面板顶部：当前切片条件摘要（实时显示）
    const filterSummary = App.el("div", { class: "slicer-summary" });
    function refreshSummary() {
      const parts = [];
      // 日期
      if (st.start || st.end) {
        parts.push(App.el("span", { class: "chip" },
          App.el("i", { "data-lucide": "calendar" }),
          `${st.start || "起始"} → ${st.end || "今"}`));
      }
      // 周期
      parts.push(App.el("span", { class: "chip" },
        App.el("i", { "data-lucide": "bar-chart-2" }),
        st.period === "month" ? "按月" : "按周"));
      // 工序
      const selStages = STAGES.filter(s => st.stages.has(s));
      parts.push(App.el("span", { class: "chip" },
        App.el("i", { "data-lucide": "layers" }),
        `工序 ${selStages.length}/${STAGES.length}`));
      // 供方
      if (suppliers.length) {
        parts.push(App.el("span", { class: "chip" },
          App.el("i", { "data-lucide": "truck" }),
          `供方 ${st.suppliers.size}/${suppliers.length}`));
      }
      filterSummary.innerHTML = "";
      parts.forEach(p => filterSummary.append(p));
      App.refreshIcons();
    }

    const slicerBody = App.el("div", { class: "slicer-body" },
      // 当前切片摘要（首屏即可见当前生效的所有过滤）
      App.el("div", { class: "slicer-section", style: "background:linear-gradient(135deg, rgba(37,99,235,.06), rgba(13,148,136,.05));border-radius:8px;padding:10px" },
        App.el("div", { class: "slicer-section-title" },
          App.el("i", { "data-lucide": "list-checks" }), "当前生效"),
        filterSummary),
      App.el("div", { class: "slicer-section" },
        App.el("div", { class: "slicer-section-title" },
          App.el("i", { "data-lucide": "calendar" }), "时间范围"),
        App.el("div", { style: "display:flex; flex-direction:column; gap:8px" },
          App.el("div", { class: "field" }, App.el("label", { style: "font-size:11px; font-weight:400; margin-bottom:4px" }, "开始日期"), startIn),
          App.el("div", { class: "field" }, App.el("label", { style: "font-size:11px; font-weight:400; margin-bottom:4px" }, "结束日期"), endIn))),
      App.el("div", { class: "slicer-section" },
        App.el("div", { class: "slicer-section-title" },
          App.el("i", { "data-lucide": "bar-chart-2" }), "时间粒度"),
        periodSeg),
      App.el("div", { class: "slicer-section" },
        App.el("div", { class: "slicer-section-title" },
          App.el("i", { "data-lucide": "layers" }), `工序  ${App.STAGES ? `(${STAGES.length} 项)` : ""}`),
        stageChecks),
      suppliers.length ? App.el("div", { class: "slicer-section" },
        App.el("div", { class: "slicer-section-title" },
          App.el("i", { "data-lucide": "truck" }), `原料供方  (${suppliers.length} 家)`),
        supChecks) : null);

    refreshSummary();

    const slicerFoot = App.el("div", { class: "slicer-foot" }, resetBtn);

    const slicerHead = App.el("div", { class: "slicer-head" },
      App.el("div", { class: "slicer-title" },
        App.el("i", { "data-lucide": "sliders-horizontal" }),
        App.el("div", {},
          App.el("div", { style: "font-size:13px;font-weight:600" }, "全局切片"),
          App.el("div", { style: "font-size:10px;color:var(--ink-3);font-weight:400" }, "约束所有面板"))));

    const slicerPanel = App.el("div", { class: "slicer-panel collapsed" }, slicerHead, slicerBody, slicerFoot);

    // 浮动把手按钮，折叠时停在主内容区右侧，展开时跟随面板左侧
    const handleBtn = App.el("button", { class: "slicer-handle", title: "展开/收起全局切片器" },
      App.el("i", { "data-lucide": "panel-right-open" }));
    function refreshHandleIcon() {
      const collapsed = slicerPanel.classList.contains("collapsed");
      handleBtn.innerHTML = "";
      handleBtn.append(App.el("i", { "data-lucide": collapsed ? "panel-right-open" : "panel-right-close" }));
      App.refreshIcons();
    }
    handleBtn.addEventListener("click", () => {
      slicerPanel.classList.toggle("collapsed");
      mainContent.classList.toggle("no-slicer", slicerPanel.classList.contains("collapsed"));
      refreshHandleIcon();
      const onEnd = (e) => {
        if (e.propertyName === "transform") {
          slicerPanel.removeEventListener("transitionend", onEnd);
          App.resizeCharts();
          // 动画结束后布局可能仍在 settle，再延迟一次确保尺寸正确
          requestAnimationFrame(() => setTimeout(() => App.resizeCharts(), 60));
        }
      };
      slicerPanel.addEventListener("transitionend", onEnd);
    });

    /* ---------- 主内容区 ---------- */
    const kpiGrid = App.el("div", { class: "kpi-grid" });

    // 左：原料来料数量折线图（按重量累加）
    const incomingCard = App.el("div", { class: "card" },
      App.el("div", { class: "card-head" },
        App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "truck" }), "原料来料"),
        App.el("span", { class: "muted small" }, st.period === "month" ? "按月聚合 · 重量" : "按周聚合 · 重量")));
    const incomingDom = App.el("div", { class: "chart" });
    incomingCard.append(incomingDom);

    // 右：各工序加工重量与收率（双Y轴）
    // 原料来料没有收率，从下拉选项中剔除
    const YIELD_STAGES = STAGES.filter(s => s !== "原料来料");
    const yieldStageSel = App.el("select", { class: "input", style: "width:auto; min-width:64px; max-width:80px; padding:2px 6px; border:1px solid var(--line); border-radius:5px; background:#fff; font-size:12px" });
    yieldStageSel.append(App.el("option", { value: "" }, "全工序"));
    for (const s of YIELD_STAGES) yieldStageSel.append(App.el("option", { value: s }, s));
    yieldStageSel.value = st.yieldStage;
    yieldStageSel.addEventListener("change", () => { st.yieldStage = yieldStageSel.value; drawAll(); });

    const stageTrendCard = App.el("div", { class: "card" },
      App.el("div", { class: "card-head" },
        App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "trending-up" }), "各工序加工重量与收率"),
        App.el("div", { class: "field-row", style: "gap:8px; margin-left:auto; align-items:center" },
          App.el("label", { class: "muted small", style: "white-space:nowrap; font-weight:600; color:var(--ink-2); margin-right:10px" }, "工序收率"), yieldStageSel)));
    const stageTrendDom = App.el("div", { class: "chart" });
    stageTrendCard.append(stageTrendDom);

    // 控制图自身切片器
    const productSel = App.el("select", { class: "input" });
    for (const p of products) productSel.append(App.el("option", { value: p }, p));
    productSel.value = st.ctrl.product;
    productSel.addEventListener("change", () => {
      st.ctrl.product = productSel.value;
      refreshMetricOptions();
      drawAll();
    });

    const stageSel = App.el("select", { class: "input" });
    for (const s of STAGES) stageSel.append(App.el("option", { value: s }, s));
    stageSel.value = st.ctrl.stage;
    stageSel.addEventListener("change", () => {
      st.ctrl.stage = stageSel.value;
      refreshMetricOptions();
      drawAll();
    });

    const metricSel = App.el("select", { class: "input" });
    metricSel.addEventListener("change", () => { st.ctrl.metric = metricSel.value; drawAll(); });

    function refreshMetricOptions() {
      const mets = metricsForCtrl(st.ctrl.product, st.ctrl.stage, allBatches);
      metricSel.innerHTML = "";
      for (const m of mets) metricSel.append(App.el("option", { value: m }, m + (valUnit(m) ? `（${valUnit(m)}）` : "")));
      if (!st.ctrl.metric || !mets.includes(st.ctrl.metric)) {
        st.ctrl.metric = mets.find(m => !["收率", "产能", "数量"].includes(m)) || mets[0] || "";
      }
      metricSel.value = st.ctrl.metric;
    }
    refreshMetricOptions();

    const yMinIn = App.el("input", { class: "input range-input", type: "number", step: "any", placeholder: "自动", value: st.ctrl.yMin });
    const yMaxIn = App.el("input", { class: "input range-input", type: "number", step: "any", placeholder: "自动", value: st.ctrl.yMax });
    yMinIn.addEventListener("change", () => { st.ctrl.yMin = yMinIn.value; drawAll(); });
    yMaxIn.addEventListener("change", () => { st.ctrl.yMax = yMaxIn.value; drawAll(); });

    // 横坐标模式选择器：时间 / 批次号 / 序号
    const xAxisModeSel = App.el("select", { class: "input", style: "min-width:90px" },
      App.el("option", { value: "date" }, "时间"),
      App.el("option", { value: "batchId" }, "批次号"),
      App.el("option", { value: "sequence" }, "序号"));
    xAxisModeSel.value = st.ctrl.xAxisMode || "date";
    xAxisModeSel.addEventListener("change", () => { st.ctrl.xAxisMode = xAxisModeSel.value; drawAll(); });

    const ctrlCard = App.el("div", { class: "card" },
      App.el("div", { class: "card-head" },
        App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "activity" }), "趋势控制图"),
        App.el("div", { class: "ctrl-toolbar" },
          App.el("div", { class: "field-row" }, App.el("label", {}, "产品"), productSel),
          App.el("div", { class: "field-row" }, App.el("label", {}, "工序"), stageSel),
          App.el("div", { class: "field-row" }, App.el("label", {}, "指标"), metricSel),
          App.el("div", { class: "field-row" }, App.el("label", {}, "横坐标"), xAxisModeSel),
          App.el("div", { class: "field-row" }, App.el("label", {}, "Y轴最小"), yMinIn),
          App.el("div", { class: "field-row" }, App.el("label", {}, "Y轴最大"), yMaxIn),
          App.el("span", { class: "muted small" }, "留空则自动适配"))),
      App.el("div", { class: "limits-toolbar" }),  // 自定义控制限 UI 容器（占位）
      App.el("div", { class: "chart tall" }));
    const ctrlDom = ctrlCard.querySelector(".chart.tall");
    // 把占位元素抽出来供后续填充
    const limitsSlot = ctrlCard.querySelector(".limits-toolbar");
    limitsSlot.replaceWith(App.el("div", { id: "ctrlLimitsSlot" }));

    const stageCard = App.el("div", { class: "card" },
      App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "bar-chart-3" }), "各工序批次与合格率")));
    const stageChartDom = App.el("div", { class: "chart" });
    stageCard.append(stageChartDom);

    const failCard = App.el("div", { class: "card" },
      App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "alert-triangle" }), "不合格指标分布 TOP10")));
    const failDom = App.el("div", { class: "chart" });
    failCard.append(failDom);

    const recentBadCard = App.el("div", { class: "card" },
      App.el("div", { class: "card-head" },
        App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "list-x" }), "近期不合格批次"),
        App.el("button", { class: "btn sm", onclick: () => App.setView("batches") }, "查看全部")),
      App.el("div", { class: "tbl-wrap" }, App.el("div", { class: "empty" }, "加载中…")));

    const mainContent = App.el("div", { class: "dashboard-main no-slicer" },
      kpiGrid,
      App.el("div", { class: "grid", style: "grid-template-columns: 1fr 1fr; margin-bottom:16px" },
        incomingCard, stageTrendCard),
      ctrlCard,
      App.el("div", { class: "grid", style: "grid-template-columns: 1fr 1.4fr; margin-top:16px" },
        failCard, recentBadCard));

    const wrap = App.el("div", { class: "dashboard-wrap" }, mainContent, slicerPanel, handleBtn);
    root.append(wrap);

    /* ---------- 图表绘制 ---------- */
    function drawAll() {
      App.disposeCharts();
      // 全局切片：工序 + 日期 + 供方（沿追溯链向所有下游传播）
      const batches = filterBySupplierTrace(filterBatches(allBatches));
      const judged = batches.filter(b => b.verdict !== "未检");
      const ok = batches.filter(b => b.verdict === "合格");
      const bad = batches.filter(b => b.verdict === "不合格").sort(App.cmpBatch);
      const passRate = judged.length ? ok.length / judged.length : null;

      /* KPI */
      const batchIds = new Set(batches.map(b => b.id));
      const filteredEdges = (S.data.edges || []).filter(e => batchIds.has(e.from) && batchIds.has(e.to));
      const filteredInsp = (S.data.inspection || []).filter(r => !r.lot || batchIds.has(r.lot));
      kpiGrid.innerHTML = "";
      kpiGrid.append(
        kpiCard({ label: "批次总数", value: batches.length, sub: `覆盖 ${new Set(batches.map(b => b.stage)).size} 个工序`, icon: "boxes", color: "#2563eb" }),
        kpiCard({ label: "已检合格率", value: passRate == null ? "—" : App.fmtPct(passRate), sub: `${ok.length} 合格 / ${judged.length} 已检`, icon: "badge-check", color: "#16a34a" }),
        kpiCard({ label: "不合格批次", value: bad.length, sub: "点击查看下方明细", icon: "alert-triangle", color: "#dc2626" }),
        kpiCard({ label: "未检批次", value: batches.filter(b => b.verdict === "未检").length, sub: "检测数据待补录", icon: "circle-minus", color: "#64748b" }),
        kpiCard({ label: "追溯关系", value: filteredEdges.length, sub: `总 ${S.data.edges.length} 条关系`, icon: "workflow", color: "#0d9488" }),
        kpiCard({ label: "检验记录", value: filteredInsp.length, sub: `总 ${S.data.inspection.length} 条记录`, icon: "clipboard-check", color: "#7c3aed" }));

      /* 各工序批次与合格率 */
      const stageStats = STAGES.map(stg => {
        const bs = batches.filter(b => b.stage === stg);
        const jd = bs.filter(b => b.verdict !== "未检");
        return { st: stg, n: bs.length, ok: bs.filter(b => b.verdict === "合格").length, bad: bs.filter(b => b.verdict === "不合格").length, rate: jd.length ? bs.filter(b => b.verdict === "合格").length / jd.length : null };
      });
      App.makeChart(stageChartDom, {
        grid: { left: 62, right: 62, top: 40, bottom: 28 },
        tooltip: { trigger: "axis" }, legend: { top: 4, data: ["批次数量", "合格率"] },
        xAxis: { type: "category", data: stageStats.map(s => s.st), axisTick: { alignWithLabel: true } },
        yAxis: [
          { type: "value", name: "批次", minInterval: 1, nameTextStyle: { padding: [0, 0, 8, 0] } },
          { type: "value", name: "合格率", min: 0, max: 1, axisLabel: { formatter: v => Math.round(v * 100) + "%" }, splitLine: { show: false }, nameTextStyle: { padding: [0, 8, 8, 0] } },
        ],
        toolbox: { feature: { saveAsImage: {} }, right: 12, top: 4 },
        series: [
          { name: "批次数量", type: "bar", barWidth: 34, itemStyle: { color: "#2563eb", borderRadius: [4, 4, 0, 0] }, data: stageStats.map(s => s.n) },
          { name: "合格率", type: "line", yAxisIndex: 1, symbolSize: 7, itemStyle: { color: "#16a34a" }, lineStyle: { width: 2.5 }, data: stageStats.map(s => s.rate == null ? null : +(s.rate * 100).toFixed(1) / 100) },
        ],
      });

      /* 原料来料折线图（按来料重量累加） */
      const rawSupAll = batches.filter(b => b.stage === "原料来料");
      const rawSup = rawSupAll.filter(b => {
        const d = b.date || inferDateFromId(b.id);
        return App.isDate(d);
      }).map(b => ({ ...b, _date: b.date || inferDateFromId(b.id) }));
      const sups = unique(rawSup.map(b => b.supplier || (b.metrics || {})["供方名称"]).filter(Boolean)).sort();
      const incomingKeys = [];
      const incomingByKey = new Map();
      for (const b of rawSup) {
        const k = periodKey(b._date);
        if (!incomingByKey.has(k)) { incomingByKey.set(k, { total: 0, bySup: {} }); incomingKeys.push(k); }
        const qty = getVal(b, "数量") || 0;
        incomingByKey.get(k).total += qty;
        const s = b.supplier || (b.metrics || {})["供方名称"] || "未知供方";
        incomingByKey.get(k).bySup[s] = (incomingByKey.get(k).bySup[s] || 0) + qty;
      }
      incomingKeys.sort();
      incomingDom.innerHTML = "";
      if (!incomingKeys.length) {
        incomingDom.append(App.el("div", { class: "empty" }, "当前切片条件下无原料来料数据"));
      } else {
        const incomingSeries = sups.length
          ? sups.map(s => ({
              name: s, type: "line", symbolSize: 6, smooth: true,
              data: incomingKeys.map(k => +(incomingByKey.get(k).bySup[s] || 0).toFixed(2)),
            }))
          : [{ name: "来料数量", type: "line", symbolSize: 6, smooth: true, itemStyle: { color: "#2563eb" }, data: incomingKeys.map(k => +(incomingByKey.get(k).total || 0).toFixed(2)) }];
        const incomingLabels = st.period === "week" ? formatWeekLabels(incomingKeys) : incomingKeys;
        App.makeChart(incomingDom, {
          grid: { left: 72, right: 52, top: 28, bottom: 70 },
          tooltip: { trigger: "axis" },
          legend: { type: "scroll", bottom: 4, itemGap: 12, textStyle: { fontSize: 11 } },
          xAxis: { type: "category", data: incomingLabels, axisLabel: { rotate: incomingLabels.length > 10 ? 35 : 0 } },
          yAxis: { type: "value", name: "重量 (kg)", nameLocation: "middle", nameGap: 48, nameTextStyle: { padding: [0, 0, 8, 0] }, axisLabel: { formatter: v => App.fmt(v, 0) } },
          dataZoom: incomingKeys.length > 14 ? [{ type: "slider", height: 16, bottom: 8 }, { type: "inside" }] : [{ type: "inside" }],
          toolbox: { feature: { saveAsImage: {} }, right: 10, top: 4 },
          series: incomingSeries,
        });
      }

      /* 各工序加工重量与可选工序收率（双Y轴） */
      const dated = batches.filter(b => App.isDate(b.date));
      const keys = [];
      const byKey = new Map();
      for (const b of dated) {
        const k = periodKey(b.date);
        if (!byKey.has(k)) { byKey.set(k, { weight: Object.fromEntries(STAGES.map(s => [s, 0])), yields: new Map() }); keys.push(k); }
        const qty = getVal(b, "数量");
        if (qty != null) byKey.get(k).weight[b.stage] += qty;
        const y = App.yieldOf(b);
        if (y != null) {
          if (!byKey.get(k).yields.has(b.stage)) byKey.get(k).yields.set(b.stage, []);
          byKey.get(k).yields.get(b.stage).push(y);
        }
      }
      keys.sort();
      const showYield = st.yieldStage && STAGES.includes(st.yieldStage) && st.yieldStage !== "原料来料";
      const yieldSeries = showYield ? keys.map(k => {
        const ys = byKey.get(k).yields.get(st.yieldStage) || [];
        return ys.length ? mean(ys) : null;
      }) : [];
      // 选具体工序收率 → 只显示该工序的柱；"不收率" → 显示所有工序
      const stagesToShow = showYield
        ? [st.yieldStage]
        : STAGES.filter(s => st.stages.has(s));
      const legendData = [...stagesToShow];
      const series = stagesToShow.map(stg => ({
        name: stg, type: "bar", stack: "weight", barMaxWidth: 28,
        itemStyle: { color: STAGE_COLOR[stg] },
        data: keys.map(k => byKey.get(k).weight[stg] || 0),
      }));
      if (showYield) {
        legendData.push(st.yieldStage + " 收率");
        series.push({
          name: st.yieldStage + " 收率", type: "line", yAxisIndex: 1, symbolSize: 7,
          lineStyle: { width: 2.5, color: "#f59e0b" }, itemStyle: { color: "#f59e0b" },
          data: yieldSeries,
          label: { show: true, position: "top", fontSize: 10, color: "#f59e0b",
                  formatter: p => p.value == null ? "" : App.fmtPct(p.value) },
        });
      }
      const periodLabels = st.period === "week" ? formatWeekLabels(keys) : keys;
      App.makeChart(stageTrendDom, {
        grid: { left: 72, right: showYield ? 92 : 52, top: 28, bottom: 70 },
        tooltip: {
          trigger: "axis",
          formatter: (params) => {
            // 自定义 tooltip：把所有柱 + 收率线显示出来
            const lines = params.map(p => {
              const v = p.value;
              if (Array.isArray(v)) return null;  // xAxis 是类目轴，value 是数字
              if (p.seriesName && p.seriesName.endsWith(" 收率")) {
                return `${p.marker} ${p.seriesName}: <b>${v == null ? "—" : App.fmtPct(v)}</b>`;
              }
              return `${p.marker} ${p.seriesName}: <b>${App.fmt(v, 1)} kg</b>`;
            }).filter(Boolean);
            return `<b>${params[0].axisValue}</b><br/>` + lines.join("<br/>");
          },
        },
        legend: { type: "scroll", bottom: 4, itemGap: 12, textStyle: { fontSize: 11 }, data: legendData },
        xAxis: { type: "category", data: periodLabels, axisLabel: { rotate: periodLabels.length > 10 ? 35 : 0 } },
        yAxis: [
          { type: "value", name: "重量 (kg)", nameLocation: "middle", nameGap: 48, nameTextStyle: { padding: [0, 0, 8, 0] }, splitLine: { lineStyle: { color: "#eef2f6" } } },
          ...(showYield ? [{ type: "value", name: "收率 (%)", nameLocation: "middle", nameGap: 48, nameTextStyle: { padding: [0, 8, 8, 0] }, min: 0, max: 1, axisLabel: { formatter: v => Math.round(v * 100) + "%" }, splitLine: { show: false } }] : []),
        ],
        dataZoom: keys.length > 14 ? [{ type: "slider", height: 16, bottom: 8 }, { type: "inside" }] : [{ type: "inside" }],
        toolbox: { feature: { saveAsImage: {} }, right: 10, top: 4 },
        series,
      });

      /* 趋势控制图（受全局+自身双重切片器约束） */
      // 趋势控制图直接复用已过滤的 batches（已含供方链路追溯）
      drawCtrlChart(batches);

      /* 不合格指标 TOP */
      const failCnt = new Map();
      for (const b of batches) for (const f of (b.fails || [])) failCnt.set(f, (failCnt.get(f) || 0) + 1);
      const failTop = [...failCnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).reverse();
      failDom.innerHTML = "";
      if (failTop.length) {
        App.makeChart(failDom, {
          grid: { left: 70, right: 30, top: 14, bottom: 26 },
          tooltip: {},
          xAxis: { type: "value", minInterval: 1 },
          yAxis: { type: "category", data: failTop.map(f => f[0]) },
          toolbox: { feature: { saveAsImage: {} }, right: 10, top: 0 },
          series: [{
            type: "bar", barWidth: 16,
            itemStyle: { color: "#dc2626", borderRadius: [0, 4, 4, 0] },
            label: { show: true, position: "right", color: "#475569" },
            data: failTop.map(f => f[1]),
          }],
        });
      } else {
        failDom.append(App.el("div", { class: "empty" }, "当前没有不合格项"));
      }

      /* 近期不合格批次 */
      recentBadCard.querySelector(".tbl-wrap").innerHTML = "";
      const badRows = bad.slice(0, 10).map(b => App.el("tr", { class: "clickable", onclick: () => App.openBatchDrawer(b.id) },
        App.el("td", { class: "mono" }, b.id),
        App.el("td", {}, b.stage),
        App.el("td", {}, b.date || "—"),
        App.el("td", {}, (b.fails || []).map(f => App.el("span", { class: "pill bad", style: "margin-right:4px" }, f))),
        App.el("td", { class: "muted ellipsis" }, b.remark || "")));
      recentBadCard.querySelector(".tbl-wrap").append(
        badRows.length ? App.el("table", { class: "tbl" },
          App.el("thead", {}, App.el("tr", {}, App.el("th", {}, "批号"), App.el("th", {}, "工序"), App.el("th", {}, "日期"), App.el("th", {}, "不合格项"), App.el("th", {}, "备注"))),
          App.el("tbody", {}, badRows))
          : App.el("div", { class: "empty" }, "当前没有不合格批次"));

      // 刷新切片器摘要
      if (typeof refreshSummary === "function") refreshSummary();

      App.refreshIcons();
    }

    // 自定义规格控制限（看板）
    function buildCtrlLimitsBar(product, stage, metric, onChange) {
      const cur = MESControl.get(product, stage, metric);
      const wrap = document.createElement("div");
      wrap.className = "limits-toolbar";
      const curLabel = document.createElement("span");
      curLabel.style.cssText = "color: var(--ink-2); font-weight:600;";
      curLabel.textContent = "当前判定限：";

      const typeSel = document.createElement("select");
      ["none", "range", "ge", "le", "eq"].forEach(v => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = ({"none":"不使用（按系统规格）","range":"区间 [lower, upper]","ge":"下限 ≥ 仅下限","le":"上限 ≤ 仅上限","eq":"等于（目标值）"})[v];
        if (cur && cur.type === v) o.selected = true;
        typeSel.appendChild(o);
      });
      const lowerInp = document.createElement("input");
      lowerInp.type = "number"; lowerInp.step = "any"; lowerInp.placeholder = "下限";
      if (cur && cur.lower != null) lowerInp.value = cur.lower;
      const upperInp = document.createElement("input");
      upperInp.type = "number"; upperInp.step = "any"; upperInp.placeholder = "上限";
      if (cur && cur.upper != null) upperInp.value = cur.upper;
      const targetInp = document.createElement("input");
      targetInp.type = "number"; targetInp.step = "any"; targetInp.placeholder = "目标";
      if (cur && cur.target != null) targetInp.value = cur.target;
      const saveBtn = document.createElement("button");
      saveBtn.className = "lim-save"; saveBtn.textContent = "保存规则";
      const clearBtn = document.createElement("button");
      clearBtn.className = "lim-clear"; clearBtn.textContent = "清除"; clearBtn.title = "清除此规则，使用系统规格";
      const info = document.createElement("span");
      info.className = "lim-info";
      info.textContent = cur && cur.type !== "none" ? describeCustomLimit(cur) : "系统规则：从规格标准读取";

      saveBtn.addEventListener("click", () => {
        const t = typeSel.value;
        MESControl.set(product, stage, metric, {
          type: t,
          lower: t === "le" || t === "eq" ? null : (lowerInp.value === "" ? null : Number(lowerInp.value)),
          upper: t === "ge" || t === "eq" ? null : (upperInp.value === "" ? null : Number(upperInp.value)),
          target: targetInp.value === "" ? null : Number(targetInp.value),
        });
        info.textContent = "已保存，视图已更新";
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

      wrap.append(curLabel, typeSel, lowerInp, document.createTextNode(" ≤ "),
                  upperInp, document.createTextNode(" ≤ "), targetInp,
                  saveBtn, clearBtn, info);
      return wrap;
    }
    function describeCustomLimit(l) {
      if (!l || l.type === "none") return "未设置";
      const parts = [];
      if (l.lower != null) parts.push(`下限 ${l.type === "ge" ? "≥ " : ""}${l.lower}`);
      if (l.upper != null) parts.push(`上限 ${l.type === "le" ? "≤ " : ""}${l.upper}`);
      if (l.target != null) parts.push(`目标 ${l.target}`);
      return parts.join("，");
    }

    function drawCtrlChart(batches) {
      ctrlDom.innerHTML = "";
      const { product, stage, metric, yMin, yMax, xAxisMode = "date" } = st.ctrl;
      // 按当前可见批次的供方自动匹配规格：单一供方用供方专属规格，多供方 fallback 到通用规格
      const suppliers = new Set();
      for (const b of batches) {
        if (b.stage === stage) {
          const s = App.batchSupplier(b);
          if (s) suppliers.add(s);
        }
      }
      const supplier = suppliers.size === 1 ? [...suppliers][0] : "";
      const spec = App.lookupSpec(product, stage, metric, supplier) || null;
      // 填充规格控制限工具栏（按当前 产品|工序|指标 渲染）
      const slot = document.getElementById("ctrlLimitsSlot");
      if (slot) {
        slot.innerHTML = "";
        slot.appendChild(buildCtrlLimitsBar(product, stage, metric, () => drawAll()));
      }
      const pts = [];
      for (const b of batches) {
        if (b.product !== product || b.stage !== stage) continue;
        const v = getVal(b, metric);
        if (v == null) continue;
        pts.push({ b, v, date: b.date || null, id: b.id });
      }
      const ordered = pts.slice().sort((a, b) => {
        if (a.date && b.date) return a.date.localeCompare(b.date);
        return a.id.localeCompare(b.id);
      });
      const rawVals = ordered.map(p => p.v);
      const unit = valUnit(metric);

      if (!ordered.length) {
        ctrlDom.append(App.el("div", { class: "empty" }, `当前全局切片条件下，${product} · ${stage} · ${metric} 没有数据点`));
        return;
      }

      // ====== 横坐标模式：时间 / 批次号 / 序号 ======
      const mode = xAxisMode || "date";
      let xLabels, xAxisCfg, xValGetter;

      if (mode === "date") {
        const allHaveDates = ordered.every(p => p.date);
        xLabels = ordered.map(p => p.date || p.id);
        if (allHaveDates) {
          xAxisCfg = { type: "time", axisLabel: { hideOverlap: true } };
          xValGetter = (p, i) => p.date;
        } else {
          xAxisCfg = { type: "category", data: xLabels, axisLabel: { hideOverlap: true, rotate: xLabels.length > 20 ? 35 : 0, fontSize: 10 } };
          xValGetter = (p, i) => p.id;
        }
      } else if (mode === "batchId") {
        xLabels = ordered.map(p => p.id);
        xAxisCfg = { type: "category", data: xLabels, axisLabel: { hideOverlap: true, rotate: xLabels.length > 20 ? 35 : 0, fontSize: 10, interval: Math.max(0, Math.ceil(xLabels.length / 16) - 1) } };
        xValGetter = (p, i) => p.id;
      } else {
        // sequence: 1, 2, 3, ...
        xLabels = ordered.map((_, i) => String(i + 1));
        xAxisCfg = { type: "category", data: xLabels, axisLabel: { hideOverlap: true, fontSize: 10 } };
        xValGetter = (p, i) => i + 1;
      }

      // ====== 统计量计算（仅用于中值线；控制图保持简洁，SPC 规则/能力分析已移至质量分析模块）======
      const mu = mean(rawVals);
      const cl = mu;                                              // 中心线 = 均值（中值）

      // ====== 规格线（原有逻辑保留）======
      const specLines = [];
      const markAreaData = [];
      if (spec) {
        if (spec.lower != null) specLines.push({ yAxis: spec.lower, lineStyle: { color: "#dc2626", type: "dashed", width: 1.5 }, label: { formatter: `下限 ${spec.lower}`, position: "insideStartTop", fontSize: 9, color: "#dc2626" } });
        if (spec.upper != null) specLines.push({ yAxis: spec.upper, lineStyle: { color: "#dc2626", type: "dashed", width: 1.5 }, label: { formatter: `上限 ${spec.upper}`, position: "insideStartBottom", fontSize: 9, color: "#dc2626" } });
        if (spec.lower != null && spec.upper != null) markAreaData.push([{ yAxis: spec.lower, itemStyle: { color: "rgba(22,163,74,.06)" } }, { yAxis: spec.upper }]);
      }
      // 用户自定义规格控制限（覆盖默认 spec）
      const custom = MESControl.get(product, stage, metric);
      if (custom) {
        specLines.length = 0; markAreaData.length = 0;
        const c = "#2563eb";
        if (custom.lower != null) specLines.push({ yAxis: custom.lower, lineStyle: { color: c, type: "dashed", width: 1.5 }, label: { formatter: `下限 ${custom.lower}`, position: "insideStartTop", fontSize: 9, color: c } });
        if (custom.upper != null) specLines.push({ yAxis: custom.upper, lineStyle: { color: c, type: "dashed", width: 1.5 }, label: { formatter: `上限 ${custom.upper}`, position: "insideStartBottom", fontSize: 9, color: c } });
        if (custom.lower != null && custom.upper != null) markAreaData.push([{ yAxis: custom.lower, itemStyle: { color: "rgba(37,99,235,.06)" } }, { yAxis: custom.upper }]);
      }
      const effectiveSpec = custom
        ? { ...spec, lower: custom.lower != null ? custom.lower : (spec ? spec.lower : null), upper: custom.upper != null ? custom.upper : (spec ? spec.upper : null), target: custom.target != null ? custom.target : (spec ? spec.target : null) }
        : spec;

      // ====== 中值（中心线 = 均值）======
      specLines.push({ yAxis: +cl.toFixed(6), lineStyle: { color: "#2563eb", type: "solid", width: 1.5 }, silent: true, label: { formatter: `均值 ${App.fmtMetric(metric, cl)}`, position: "insideEndTop", fontSize: 9, color: "#2563eb" } });
      const ctrlTarget = effectiveSpec && effectiveSpec.target != null ? effectiveSpec.target : null;
      if (ctrlTarget != null) specLines.push({ yAxis: +ctrlTarget.toFixed(6), lineStyle: { color: "#0d9488", type: "dotted", width: 1.2 }, silent: true, label: { formatter: `中值 ${ctrlTarget}`, position: "insideEndBottom", fontSize: 9, color: "#0d9488" } });

      const yAxisCfg = { type: "value", name: unit, scale: true, splitLine: { lineStyle: { color: "#eef2f6" } } };
      const userHasYRange = (yMin !== "" && !isNaN(+yMin)) || (yMax !== "" && !isNaN(+yMax));
      let ctrlYRange;
      if (!userHasYRange) {
        ctrlYRange = axisRange(rawVals, [effectiveSpec && effectiveSpec.lower, effectiveSpec && effectiveSpec.upper, ctrlTarget, cl].filter(v => v != null), 0.08);
        yAxisCfg.min = ctrlYRange.min;
        yAxisCfg.max = ctrlYRange.max;
      } else {
        ctrlYRange = { min: +yMin || 0, max: +yMax || 1 };
      }
      yAxisCfg.axisLabel = { formatter: axisLabelFormatter(ctrlYRange.max - ctrlYRange.min, metric) };
      if (yMin !== "" && !isNaN(+yMin)) yAxisCfg.min = +yMin;
      if (yMax !== "" && !isNaN(+yMax)) yAxisCfg.max = +yMax;

      // 控制图保持简洁：仅保留规格上下限 + 中值（中心线），不显示 SPC 摘要栏

      const chart = App.makeChart(ctrlDom, {
        grid: { left: 62, right: 28, top: 34, bottom: 56 },
        tooltip: {
          trigger: "item",
          formatter: p => {
            const d = p.data;
            const xVal = d.value[0];
            const yVal = d.value[1];
            return `<b style="font-family:monospace">${d.bid}</b><br/>${xVal}　${metric} = <b>${App.fmtMetric(metric, yVal)}</b> ${unit}` +
              (d.j === false ? `<br/><span style="color:#dc2626">超出规格</span>` : d.j === true ? `<br/><span style="color:#16a34a">合格</span>` : "");
          }
        },
        xAxis: xAxisCfg,
        yAxis: yAxisCfg,
        dataZoom: [{ type: "slider", height: 18, bottom: 10 }, { type: "inside" }],
        toolbox: { feature: { saveAsImage: {} }, right: 8, top: 0 },
        series: [{
          name: metric, type: "line", showSymbol: true, symbolSize: 7, connectNulls: false,
          lineStyle: { color: "#cbd5e1", width: 1.2 },
          data: ordered.map((p, i) => {
            const j = App.judgeVal(p.v, effectiveSpec);
            let color = "#475569";
            if (j === false) color = "#dc2626";
            else if (j === true) color = "#2563eb";
            return { value: [xValGetter(p, i), p.v], bid: p.id, j, itemStyle: { color } };
          }),
          markLine: { silent: true, symbol: "none", data: specLines, lineStyle: { width: 1 } },
          markArea: { silent: true, data: markAreaData },
        }],
      });
      chart.on("click", p => { if (p.data && p.data.bid) App.openBatchDrawer(p.data.bid); });
    }

    drawAll();
  }

  return { render };
})();
