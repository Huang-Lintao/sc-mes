/* 批次追溯 - 正向 / 反向全链路 + 多条件检索 */
"use strict";
Views.trace = (() => {
  const st = {
    root: null,
    depth: "all",
    mode: "batch", // "batch" | "filter" | "device"
    filters: { start: "", end: "", stage: "全部", product: "全部", verdict: "全部", supplier: "", keyword: "" },
    results: [],
    searched: false,
    device: { subMode: "processing", deviceCode: "", start: "", end: "", flowRoot: "", showTrace: true },
  };
  const MAX_NODES = 150;
  const KEY_METRICS = ["D50", "比表面积", "孔容", "磁性总量"];
  const VERDICT_CLASS = { "合格": "ok", "不合格": "bad", "未检": "none" };

  function collect(rootId) {
    const { parentsOf, childrenOf } = App.S;
    const maxDepth = st.depth === "1" ? 1 : 99;
    const up = new Map([[rootId, 0]]);
    const down = new Map([[rootId, 0]]);
    let frontier = [rootId];
    for (let d = 1; d <= maxDepth && frontier.length; d++) {
      const next = [];
      for (const id of frontier) for (const p of (parentsOf.get(id) || [])) {
        if (!up.has(p)) { up.set(p, d); next.push(p); }
      }
      frontier = next;
    }
    frontier = [rootId];
    for (let d = 1; d <= maxDepth && frontier.length; d++) {
      const next = [];
      for (const id of frontier) for (const c of (childrenOf.get(id) || [])) {
        if (!down.has(c)) { down.set(c, d); next.push(c); }
      }
      frontier = next;
    }
    const ids = new Set([...up.keys(), ...down.keys()]);
    return { ids, up, down };
  }

  function pickDefaultRoot() {
    const mixes = App.S.data.batches.filter(b => b.stage === "混料" && App.isDate(b.date)).sort(App.cmpBatch);
    return (mixes[0] || App.S.data.batches[App.S.data.batches.length - 1] || {}).id;
  }

  function exportChainCsv(chain) {
    const lines = ["父批号,父工序,子批号,子工序,关系来源"];
    const srcText = { row: "同排记录", core: "序号推断", manual: "手动添加" };
    for (const e of App.S.data.edges) {
      if (!chain.ids.has(e.from) || !chain.ids.has(e.to)) continue;
      const f = App.S.byId.get(e.from), t = App.S.byId.get(e.to);
      lines.push([e.from, f ? f.stage : "?", e.to, t ? t.stage : "?", srcText[e.source] || e.source].join(","));
    }
    App.download(`追溯链_${st.root}.csv`, "\ufeff" + lines.join("\r\n"), "text/csv");
    App.toast("追溯链已导出");
  }

  function fmtISODate(d) {
    if (!d) return "";
    const s = typeof d === "string" ? d : d.toISOString().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  }

  function dateOffset(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  function distinctProducts() {
    return [...new Set(App.S.data.batches.map(b => b.product).filter(Boolean))].sort();
  }

  function distinctSuppliers() {
    return [...new Set(App.S.data.batches.map(b => App.batchSupplier(b)).filter(Boolean))].sort();
  }

  function matchFilter(b, f) {
    if (f.start && (!b.date || b.date < f.start)) return false;
    if (f.end && (!b.date || b.date > f.end)) return false;
    if (f.stage !== "全部" && b.stage !== f.stage) return false;
    if (f.product !== "全部" && b.product !== f.product) return false;
    if (f.verdict !== "全部" && b.verdict !== f.verdict) return false;
    if (f.supplier) {
      const s = App.batchSupplier(b).toLowerCase();
      if (!s.includes(f.supplier.toLowerCase())) return false;
    }
    if (f.keyword) {
      const kw = f.keyword.toLowerCase();
      const parts = [
        b.id, b.stage, b.product, b.date || "", b.remark || "",
        ...Object.keys(b.metrics || {}), ...Object.values(b.metrics || {}).map(String),
        ...Object.keys(b.weights || {}), ...Object.values(b.weights || {}).map(String),
      ];
      if (!parts.some(p => String(p).toLowerCase().includes(kw))) return false;
    }
    return true;
  }

  function keyMetricTags(b) {
    const tags = [];
    for (const m of KEY_METRICS) {
      const v = b.metrics?.[m];
      if (v == null) continue;
      const unit = App.S.units.get(m) || "";
      tags.push(App.el("span", { class: "trace-metric-tag" }, `${m} ${App.fmtMetric(m, v)}${unit ? " " + unit : ""}`));
    }
    return tags.length ? tags : [App.el("span", { class: "muted" }, "—")];
  }

  function render(root) {
    root.innerHTML = "";
    if (!st.root || !App.S.byId.has(st.root)) st.root = pickDefaultRoot();
    const { S, STAGES, STAGE_COLOR } = App;

    /* ---------- 模式切换 ---------- */
    const modeSeg = App.el("div", { class: "seg" });
    const modeBtns = [];
    for (const [v, label] of [["batch", "按批号追溯"], ["filter", "按条件检索"], ["device", "按设备追溯"]]) {
      const btn = App.el("button", { class: st.mode === v ? "active" : "" }, label);
      btn.addEventListener("click", () => { st.mode = v; render(root); });
      modeBtns.push({ v, btn });
      modeSeg.append(btn);
    }

    /* ---------- 按批号 ---------- */
    let batchInput = null;
    if (st.mode === "batch") {
      batchInput = App.el("input", { class: "input", list: "batchIds", value: st.root || "", placeholder: "输入批号后回车", style: "width:260px; font-family:var(--mono)" });
      const datalist = App.el("datalist", { id: "batchIds" },
        S.data.batches.map(b => App.el("option", { value: b.id }, `${b.stage} · ${b.verdict}`)));
      const doFocus = () => {
        const v = batchInput.value.trim();
        if (!v) return;
        if (!S.byId.has(v)) { App.toast(`批号不存在：${v}`, "err"); return; }
        st.root = v; draw();
      };
      batchInput.addEventListener("change", doFocus);
      batchInput.addEventListener("keydown", e => { if (e.key === "Enter") doFocus(); });
      batchInput.appendAfter = datalist;
    }

    /* ---------- 深度 ---------- */
    const depthSeg = App.el("div", { class: "seg" });
    const depthBtns = [];
    for (const [v, label] of [["1", "直接上下游"], ["all", "完整链路"]]) {
      const btn = App.el("button", { class: st.depth === v ? "active" : "" }, label);
      btn.addEventListener("click", () => { st.depth = v; refreshDepthSeg(); draw(); });
      depthBtns.push({ v, btn });
      depthSeg.append(btn);
    }
    function refreshDepthSeg() {
      for (const { v, btn } of depthBtns) btn.classList.toggle("active", st.depth === v);
    }

    /* ---------- 按条件检索面板 ---------- */
    let resultsBody = null, resultsCountEl = null;
    const filterPanel = App.el("div", { class: "trace-search-panel", style: st.mode === "filter" ? "" : "display:none" });
    if (st.mode === "filter") {
      const products = distinctProducts();
      const suppliers = distinctSuppliers();

      const startIn = App.el("input", { class: "input", type: "date", value: st.filters.start });
      const endIn = App.el("input", { class: "input", type: "date", value: st.filters.end });

      const stageSel = App.el("select", { class: "input" }, App.el("option", { value: "全部" }, "全部工序"), ...STAGES.map(s => App.el("option", { value: s }, s)));
      stageSel.value = st.filters.stage;
      const productSel = App.el("select", { class: "input" }, App.el("option", { value: "全部" }, "全部产品"), ...products.map(p => App.el("option", { value: p }, p)));
      productSel.value = st.filters.product;
      const verdictSel = App.el("select", { class: "input" },
        App.el("option", { value: "全部" }, "全部判定"),
        App.el("option", { value: "合格" }, "合格"),
        App.el("option", { value: "不合格" }, "不合格"),
        App.el("option", { value: "未检" }, "未检"));
      verdictSel.value = st.filters.verdict;
      const supplierIn = App.el("input", { class: "input", list: "supplierList", placeholder: "供方关键字", value: st.filters.supplier });
      const supplierList = App.el("datalist", { id: "supplierList" }, suppliers.map(s => App.el("option", { value: s })));
      const keywordIn = App.el("input", { class: "input", placeholder: "批号 / 备注 / 指标关键字", value: st.filters.keyword });

      const quickRow = App.el("div", { class: "trace-quick-dates" });
      const setRange = (s, e) => { startIn.value = s; endIn.value = e; };
      const quicks = [
        ["近7天", () => setRange(dateOffset(7), dateOffset(0))],
        ["近30天", () => setRange(dateOffset(30), dateOffset(0))],
        ["本月", () => { const now = new Date(); setRange(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`, dateOffset(0)); }],
        ["本年", () => { const now = new Date(); setRange(`${now.getFullYear()}-01-01`, dateOffset(0)); }],
        ["清空", () => { startIn.value = ""; endIn.value = ""; stageSel.value = "全部"; productSel.value = "全部"; verdictSel.value = "全部"; supplierIn.value = ""; keywordIn.value = ""; }],
      ];
      for (const [label, fn] of quicks) {
        const btn = App.el("button", { class: "btn sm" }, label);
        btn.addEventListener("click", () => { fn(); runSearch(); });
        quickRow.append(btn);
      }

      const runSearch = () => {
        st.searched = true;
        st.filters = {
          start: startIn.value, end: endIn.value,
          stage: stageSel.value, product: productSel.value, verdict: verdictSel.value,
          supplier: supplierIn.value.trim(), keyword: keywordIn.value.trim(),
        };
        const hits = S.data.batches.filter(b => matchFilter(b, st.filters)).sort(App.cmpBatch);
        st.results = hits.map(b => b.id);
        if (st.results.length && (!st.root || !st.results.includes(st.root))) {
          // 默认以最新一条匹配记录作为追溯根节点，方便立即查看链路
          st.root = st.results[0];
        }
        renderResults();
        draw();
        if (batchInput) batchInput.value = st.root || "";
      };

      filterPanel.append(
        App.el("div", { class: "trace-filter-grid" },
          App.el("label", {}, App.el("span", { class: "trace-filter-label" }, "日期起"), startIn),
          App.el("label", {}, App.el("span", { class: "trace-filter-label" }, "日期止"), endIn),
          App.el("label", {}, App.el("span", { class: "trace-filter-label" }, "工序"), stageSel),
          App.el("label", {}, App.el("span", { class: "trace-filter-label" }, "产品"), productSel),
          App.el("label", {}, App.el("span", { class: "trace-filter-label" }, "判定"), verdictSel),
          App.el("label", {}, App.el("span", { class: "trace-filter-label" }, "供方"), supplierIn, supplierList),
          App.el("label", { class: "trace-filter-wide" }, App.el("span", { class: "trace-filter-label" }, "关键字"), keywordIn),
        ),
        App.el("div", { class: "trace-filter-actions" },
          quickRow,
          App.el("button", { class: "btn primary", onclick: runSearch }, App.el("i", { "data-lucide": "search" }), "检索"),
        ),
      );

      /* ---------- 检索结果 ---------- */
      resultsCountEl = App.el("span", { class: "trace-results-count" });
      resultsBody = App.el("tbody");
      renderResults = () => {
        resultsBody.innerHTML = "";
        selectedHint.textContent = st.root ? `根节点：${st.root}` : "";
        if (!st.searched) {
          resultsBody.append(App.el("tr", {}, App.el("td", { colspan: 9, class: "empty" }, "请设置检索条件后点击「检索」")));
          resultsCountEl.textContent = "";
          return;
        }
        if (!st.results.length) {
          resultsBody.append(App.el("tr", {}, App.el("td", { colspan: 9, class: "empty" }, "未找到匹配记录，请调整检索条件")));
          resultsCountEl.textContent = "共 0 条";
          return;
        }
        resultsCountEl.textContent = `共 ${st.results.length} 条`;
        for (const id of st.results.slice(0, 200)) {
          const b = S.byId.get(id);
          if (!b) continue;
          const tr = App.el("tr", { class: `clickable${id === st.root ? " active" : ""}` });
          tr.append(
            App.el("td", { class: "ctr" }, App.verdictPill(b.verdict)),
            App.el("td", { class: "mono" }, b.id),
            App.el("td", {}, b.stage),
            App.el("td", { class: "mono" }, b.date || "—"),
            App.el("td", {}, App.batchSupplier(b) || "—"),
            App.el("td", {}, b.product || "—"),
            App.el("td", { class: "num" }, App.qtyText(b)),
            App.el("td", {}, ...keyMetricTags(b)),
            App.el("td", { class: "ctr" }, App.el("button", { class: "btn sm primary", onclick: e => { e.stopPropagation(); selectResult(id); } }, "补全链路"))
          );
          tr.addEventListener("click", e => { if (!e.target.closest("button")) selectResult(id); });
          resultsBody.append(tr);
        }
      };
      var renderResults; // hoisted, assigned above

      const selectResult = id => {
        st.root = id;
        st.depth = "all";
        refreshDepthSeg();
        if (batchInput) batchInput.value = id;
        // 高亮当前行
        renderResults();
        draw();
        graphDom.scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
    }

    /* ---------- 按设备追溯面板 ---------- */
    const devicePanel = App.el("div", { class: "trace-device-panel", style: st.mode === "device" ? "" : "display:none" });
    const deviceBody = App.el("div", { class: "device-body" });
    let drawDevice = null;
    if (st.mode === "device") {
      const dv = st.device;

      // 子模式切换
      const subSeg = App.el("div", { class: "seg" });
      for (const [sv, slabel] of [["processing", "设备加工追溯"], ["flow", "物料流转追溯"]]) {
        const btn = App.el("button", { class: dv.subMode === sv ? "active" : "" }, slabel);
        btn.addEventListener("click", () => { dv.subMode = sv; render(root); });
        subSeg.append(btn);
      }

      // 设备选择器
      const devSel = App.el("select", { class: "input", style: "min-width:180px" },
        App.el("option", { value: "" }, "全部设备"),
        ...App.DEVICE_LIST.map(d => App.el("option", { value: d.code, selected: dv.deviceCode === d.code ? "" : null }, `${d.code} · ${d.name}（${d.category}）`)));
      devSel.value = dv.deviceCode;

      // 日期范围
      const dStartIn = App.el("input", { class: "input", type: "date", value: dv.start });
      const dEndIn = App.el("input", { class: "input", type: "date", value: dv.end });

      // 快捷日期
      const quickRow = App.el("div", { class: "trace-quick-dates" });
      const setRange = (s, e) => { dStartIn.value = s; dEndIn.value = e; };
      for (const [label, fn] of [
        ["近7天", () => setRange(dateOffset(7), dateOffset(0))],
        ["近30天", () => setRange(dateOffset(30), dateOffset(0))],
        ["本月", () => { const n = new Date(); setRange(`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-01`, dateOffset(0)); }],
        ["本年", () => { const n = new Date(); setRange(`${n.getFullYear()}-01-01`, dateOffset(0)); }],
        ["清空", () => { setRange("", ""); devSel.value = ""; }],
      ]) {
        const btn = App.el("button", { class: "btn sm" }, label);
        btn.addEventListener("click", () => { fn(); dv.deviceCode = devSel.value; dv.start = dStartIn.value; dv.end = dEndIn.value; drawDevice(); });
        quickRow.append(btn);
      }

      // 物料流转的批号输入
      const flowInput = App.el("input", { class: "input", list: "batchIdsDev", value: dv.flowRoot || "", placeholder: "输入批号查看设备流转", style: "width:260px; font-family:var(--mono)" });
      const flowDatalist = App.el("datalist", { id: "batchIdsDev" },
        S.data.batches.map(b => App.el("option", { value: b.id }, `${b.stage} · ${b.verdict}`)));

      const runDeviceSearch = () => {
        dv.deviceCode = devSel.value;
        dv.start = dStartIn.value;
        dv.end = dEndIn.value;
        drawDevice();
      };
      const runFlow = () => {
        dv.flowRoot = flowInput.value.trim();
        if (dv.flowRoot && !S.byId.has(dv.flowRoot)) { App.toast(`批号不存在：${dv.flowRoot}`, "err"); return; }
        drawDevice();
      };
      flowInput.addEventListener("keydown", e => { if (e.key === "Enter") runFlow(); });

      // 搜索按钮
      const searchBtn = App.el("button", { class: "btn primary", onclick: runDeviceSearch }, App.el("i", { "data-lucide": "search" }), "查询");

      // 显示/隐藏追溯箭头切换按钮（仅设备加工追溯）
      const traceToggle = App.el("button", {
        class: `btn sm ${dv.showTrace ? "primary" : ""}`,
        style: "margin-left:8px",
        onclick: () => {
          dv.showTrace = !dv.showTrace;
          traceToggle.className = `btn sm ${dv.showTrace ? "primary" : ""}`;
          traceToggle.innerHTML = "";
          traceToggle.append(App.el("i", { "data-lucide": dv.showTrace ? "eye" : "eye-off" }), dv.showTrace ? "显示追溯" : "隐藏追溯");
          App.refreshIcons();
          drawDevice();
        }
      }, App.el("i", { "data-lucide": "eye" }), "显示追溯");

      // 组装工具栏
      const devToolbar = App.el("div", { class: "toolbar", style: "margin-bottom:12px" },
        subSeg,
        ...(dv.subMode === "processing"
          ? [App.el("span", { class: "small", style: "font-weight:600;color:var(--ink-2)" }, "设备"), devSel,
             App.el("span", { class: "small", style: "font-weight:600;color:var(--ink-2);margin-left:4px" }, "从"), dStartIn,
             App.el("span", { class: "small", style: "font-weight:600;color:var(--ink-2)" }, "至"), dEndIn,
             searchBtn, traceToggle]
          : [flowInput, flowDatalist, App.el("button", { class: "btn primary", onclick: runFlow }, App.el("i", { "data-lucide": "git-branch" }), "查询流转")]),
      );

      devicePanel.append(devToolbar, quickRow, deviceBody);

      /* ===== 设备加工追溯 / 物料流转追溯 渲染 ===== */
      drawDevice = function() {
        deviceBody.innerHTML = "";

        if (dv.subMode === "processing") {
          /* ---- 设备加工追溯 ---- */
          // 收集所有有设备号的批次，按设备+日期过滤
          let batches = S.data.batches.filter(b => {
            const dev = App.batchDevice(b);
            if (!dev) return false;
            if (dv.deviceCode && dev.code !== dv.deviceCode) return false;
            if (dv.start && (!b.date || b.date < dv.start)) return false;
            if (dv.end && (!b.date || b.date > dv.end)) return false;
            return true;
          }).sort(App.cmpBatch);

          if (!batches.length) {
            deviceBody.append(App.el("div", { class: "empty" }, "该条件下暂无设备加工记录"));
            return;
          }

          // 按设备分组统计
          const byDev = new Map();
          for (const b of batches) {
            const dev = App.batchDevice(b);
            if (!byDev.has(dev.code)) byDev.set(dev.code, { info: dev, batches: [] });
            byDev.get(dev.code).batches.push(b);
          }

          // 统计卡片
          const statStrip = App.el("div", { class: "stat-strip", style: "margin-bottom:16px" },
            App.el("div", { class: "st" }, App.el("div", { class: "v" }, String(byDev.size)), App.el("div", { class: "l" }, "涉及设备")),
            App.el("div", { class: "st" }, App.el("div", { class: "v" }, String(batches.length)), App.el("div", { class: "l" }, "加工批次数")),
            App.el("div", { class: "st" }, App.el("div", { class: "v" }, String(new Set(batches.map(b => b.product).filter(Boolean)).size)), App.el("div", { class: "l" }, "涉及产品")),
            App.el("div", { class: "st" }, App.el("div", { class: "v" }, (() => {
              const dates = batches.map(b => b.date).filter(Boolean).sort();
              return dates.length ? `${dates[0]} ~ ${dates[dates.length-1]}` : "—";
            })()), App.el("div", { class: "l" }, "加工时间范围")),
          );
          deviceBody.append(statStrip);

          // 设备加工时间轴（甘特图）
          const ganttDom = App.el("div", { class: "chart", style: "height:380px; margin-bottom:16px" });
          deviceBody.append(App.el("div", { class: "card" },
            App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "gantt-chart" }), "设备加工时间轴（点击节点查看常驻详情）")),
            ganttDom));

          // 点击图表节点后常驻显示的详情面板
          const detailBody = App.el("div", { style: "padding:12px 16px" }, App.el("div", { style: "color:var(--ink-2);font-size:13px" }, "点击上方图表中的点，可在此处持久查看该日期+设备下的所有批次详情"));
          const detailCard = App.el("div", { class: "card", style: "margin-top:16px;display:none" },
            App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "info" }), "选中批次详情")),
            detailBody);
          deviceBody.append(detailCard);

          // 按设备分行，每行展示该设备加工的批次时间轴
          const devColors = ["#2563eb", "#0d9488", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#06b6d4"];
          const devEntries = [...byDev.entries()];
          // 用户指定的 Y 轴设备顺序：粉碎 → 分级 → 混料；未指定的设备排在末尾
          const DEVICE_Y_ORDER = ["S004", "S006", "J001", "M001", "M002"];
          devEntries.sort(([a], [b]) => {
            const ia = DEVICE_Y_ORDER.indexOf(a);
            const ib = DEVICE_Y_ORDER.indexOf(b);
            if (ia !== -1 && ib !== -1) return ia - ib;
            if (ia !== -1) return -1;
            if (ib !== -1) return 1;
            return a.localeCompare(b);
          });
          const ganttData = [];
          const ganttLinks = [];
          devEntries.forEach(([code, { info, batches: bs }], devIdx) => {
            const color = devColors[devIdx % devColors.length];
            bs.forEach((b, i) => {
              ganttData.push({
                name: b.id,
                value: [devIdx, b.date || "—", b.date || "—", b],
                itemStyle: { color: b.verdict === "不合格" ? "#dc2626" : color },
              });
            });
          });

          // 用散点图模拟甘特图：x=日期序号, y=设备序号
          const allDates = [...new Set(batches.map(b => b.date).filter(Boolean))].sort();
          const dateIdx = new Map(allDates.map((d, i) => [d, i]));
          const scatterData = batches.map(b => {
            const dev = App.batchDevice(b);
            const devIdx = devEntries.findIndex(([c]) => c === dev.code);
            const x = dateIdx.get(b.date) ?? 0;
            const y = devIdx;
            return {
              value: [x, y, b],
              origX: x,
              origY: y,
              itemStyle: { color: b.verdict === "不合格" ? "#dc2626" : devColors[devIdx % devColors.length], borderColor: "#fff", borderWidth: 1.5 },
              symbolSize: 12,
            };
          });

          // 同一天+同一设备出现多批时做轻微径向偏移，避免完全重叠
          const posCount = new Map();
          for (const item of scatterData) {
            const key = `${item.origX}|${item.origY}`;
            const idx = posCount.get(key) || 0;
            posCount.set(key, idx + 1);
            if (idx > 0) {
              const angle = (idx - 1) * (Math.PI / 3);
              const r = 0.12;
              item.value[0] += Math.cos(angle) * r;
              item.value[1] += Math.sin(angle) * r;
            }
          }

          // 同一坐标下的所有批次（用于 tooltip 批量展示）
          const coordBatches = new Map();
          for (const item of scatterData) {
            const key = `${item.origX}|${item.origY}`;
            if (!coordBatches.has(key)) coordBatches.set(key, []);
            coordBatches.get(key).push(item.value[2]);
          }

          // 追溯箭头：父子批次都在当前视图时绘制带箭头的流转线（使用原始坐标）
          const batchPos = new Map();
          for (const item of scatterData) {
            const b = item.value[2];
            batchPos.set(b.id, [item.origX, item.origY]);
          }
          const flowLines = [];
          for (const e of S.data.edges) {
            if (e.from === e.to) continue;
            const from = batchPos.get(e.from);
            const to = batchPos.get(e.to);
            if (!from || !to) continue;
            flowLines.push([{ coord: from }, { coord: to }]);
          }

          const batchTooltip = b => {
            const dev = App.batchDevice(b);
            return `<div style="margin:3px 0;padding:4px 0;border-bottom:1px solid rgba(148,163,184,0.2)"><b style="font-family:monospace">${b.id}</b>　<span style="color:${b.verdict === "不合格" ? "#dc2626" : "#16a34a"}">${b.verdict}</span><br/><span style="color:#64748b">${dev.code} · ${b.stage} · ${b.product} · ${b.date || "—"} · ${App.qtyText(b)}</span></div>`;
          };

          App.makeChart(ganttDom, {
            grid: { left: 90, right: 30, top: 30, bottom: 60, containLabel: false },
            tooltip: {
              formatter: p => {
                const key = `${p.data.origX}|${p.data.origY}`;
                const list = coordBatches.get(key) || [p.data.value[2]];
                return `<div style="max-width:280px;max-height:240px;overflow:auto">${list.map(batchTooltip).join("")}</div>`;
              }
            },
            xAxis: {
              type: "category",
              data: allDates,
              axisLabel: { rotate: 35, fontSize: 9, color: "#64748b", hideOverlap: true },
              axisLine: { lineStyle: { color: "#cbd5e1" } },
              axisTick: { show: false },
              splitLine: { show: true, lineStyle: { color: "#f1f5f9" } },
            },
            yAxis: {
              type: "category",
              data: devEntries.map(([c, { info }]) => `${c} ${info.name}`),
              axisLabel: { fontSize: 10, color: "#64748b", lineHeight: 14 },
              axisLine: { lineStyle: { color: "#cbd5e1" } },
              axisTick: { show: false },
            },
            toolbox: { feature: { saveAsImage: {} }, right: 10, top: 0 },
            series: [
              {
                type: "scatter",
                data: scatterData,
                symbolSize: 12,
                z: 2,
                emphasis: { scale: 1.6, itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,.2)" } },
              },
              ...(dv.showTrace ? [{
                type: "line",
                data: [],
                z: 1,
                silent: true,
                markLine: {
                  symbol: ["none", "arrow"],
                  symbolSize: 8,
                  silent: true,
                  lineStyle: { color: "#64748b", width: 1, opacity: 0.5, curveness: 0.08 },
                  data: flowLines,
                  animation: false,
                },
              }] : []),
            ],
          });

          // 常驻详情面板渲染
          const renderDetail = list => {
            detailCard.style.display = "block";
            detailBody.innerHTML = "";
            const grid = App.el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px" });
            for (const b of list) {
              const dev = App.batchDevice(b);
              const card = App.el("div", { style: "border:1px solid var(--line);border-radius:var(--radius);padding:12px;background:var(--panel);cursor:pointer;transition:box-shadow .15s" },
                App.el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px" },
                  App.el("b", { style: "font-family:var(--mono),monospace;font-size:13px" }, b.id),
                  App.verdictPill(b.verdict)
                ),
                App.el("div", { style: "font-size:12px;color:var(--ink-2);line-height:1.6" },
                  App.el("div", {}, `设备：${dev ? `${dev.code} · ${dev.name}` : "—"}`),
                  App.el("div", {}, `工序：${b.stage}　产品：${b.product || "—"}`),
                  App.el("div", {}, `日期：${b.date || "—"}　数量：${App.qtyText(b)}`),
                  App.el("div", {}, `供方：${App.batchSupplier(b) || "—"}`)
                )
              );
              card.addEventListener("mouseenter", () => { card.style.boxShadow = "var(--shadow-sm)"; });
              card.addEventListener("mouseleave", () => { card.style.boxShadow = "none"; });
              card.addEventListener("click", () => App.openBatchDrawer(b.id));
              grid.append(card);
            }
            detailBody.append(grid);
            App.refreshIcons();
          };

          // 点击图表节点固定显示详情
          const ganttChart = echarts.getInstanceByDom(ganttDom);
          if (ganttChart) {
            ganttChart.on("click", p => {
              if (!p.data) return;
              const key = `${p.data.origX}|${p.data.origY}`;
              const list = coordBatches.get(key) || (p.data.value && [p.data.value[2]]) || [];
              if (list.length) renderDetail(list);
            });
          }

          // 加工明细表
          const tblWrap = App.el("div", { class: "tbl-wrap", style: "max-height:400px" });
          const tbody = App.el("tbody");
          for (const b of batches) {
            const dev = App.batchDevice(b);
            const tr = App.el("tr", { class: "clickable" },
              App.el("td", {}, App.el("span", { class: "mono", style: `color:${devColors[devEntries.findIndex(([c]) => c === dev.code) % devColors.length]}` }, dev.code)),
              App.el("td", {}, dev.name),
              App.el("td", {}, dev.category),
              App.el("td", {}, App.verdictPill(b.verdict)),
              App.el("td", { class: "mono" }, b.id),
              App.el("td", {}, b.stage),
              App.el("td", { class: "mono" }, b.date || "—"),
              App.el("td", {}, App.batchSupplier(b) || "—"),
              App.el("td", {}, b.product || "—"),
              App.el("td", { class: "num" }, App.qtyText(b)),
            );
            tr.addEventListener("click", () => App.openBatchDrawer(b.id));
            tbody.append(tr);
          }
          tblWrap.append(App.el("table", { class: "tbl" },
            App.el("thead", {}, App.el("tr", {},
              App.el("th", {}, "设备号"), App.el("th", {}, "设备名称"), App.el("th", {}, "类别"),
              App.el("th", { class: "ctr" }, "判定"), App.el("th", {}, "批号"), App.el("th", {}, "工序"),
              App.el("th", {}, "日期"), App.el("th", {}, "供方"), App.el("th", {}, "产品"), App.el("th", { class: "ctr" }, "数量"))),
            tbody));
          deviceBody.append(App.el("div", { class: "card", style: "margin-top:16px" },
            App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "list" }), "设备加工明细（点击行查看批次详情）")),
            tblWrap));

        } else {
          /* ---- 物料流转追溯 ---- */
          if (!dv.flowRoot || !S.byId.has(dv.flowRoot)) {
            deviceBody.append(App.el("div", { class: "empty" }, "请输入批号查询物料在各设备间的流转路径"));
            return;
          }

          // 收集完整追溯链
          const chain = collect(dv.flowRoot);
          const ids = [...chain.ids];
          const flowBatches = ids.map(id => S.byId.get(id)).filter(Boolean);

          // 为每个批次提取设备号
          const nodesWithDev = flowBatches.map(b => {
            const dev = App.batchDevice(b);
            return { b, dev, upDepth: chain.up.get(b.id) ?? 99, downDepth: chain.down.get(b.id) ?? 99 };
          });

          // 流转路径图：按工序排列节点，标注设备号
          const presentStages = STAGES.filter(s => flowBatches.some(b => b.stage === s));
          const stageIdx = new Map(presentStages.map((s, i) => [s, i]));
          const byStage = new Map(presentStages.map(s => [s, []]));
          for (const { b, dev } of nodesWithDev) {
            if (byStage.has(b.stage)) byStage.get(b.stage).push({ b, dev });
          }

          // 统计：涉及哪些设备
          const devSet = new Map();
          for (const { b, dev } of nodesWithDev) {
            if (!dev) continue;
            if (!devSet.has(dev.code)) devSet.set(dev.code, { info: dev, count: 0, batches: [] });
            const e = devSet.get(dev.code);
            e.count++;
            e.batches.push(b.id);
          }

          // 设备流转摘要
          const devSummary = App.el("div", { class: "stat-strip", style: "margin-bottom:16px" },
            App.el("div", { class: "st" }, App.el("div", { class: "v" }, String(flowBatches.length)), App.el("div", { class: "l" }, "链路批次")),
            App.el("div", { class: "st" }, App.el("div", { class: "v" }, String(devSet.size)), App.el("div", { class: "l" }, "涉及设备")),
            App.el("div", { class: "st" }, App.el("div", { class: "v" }, String(presentStages.length)), App.el("div", { class: "l" }, "涉及工序")),
            App.el("div", { class: "st" }, App.el("div", { class: "v" }, dv.flowRoot), App.el("div", { class: "l" }, "追溯根节点")),
          );
          deviceBody.append(devSummary);

          // 设备流转图（graph）
          const flowDom = App.el("div", { class: "chart", style: "height:420px; margin-bottom:16px" });
          deviceBody.append(App.el("div", { class: "card" },
            App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "workflow" }), "物料设备流转图（节点标注设备号，点击查看详情）")),
            flowDom));

          // 构建图节点：每个有设备号的批次一个节点，按工序分层
          const devColors2 = ["#2563eb", "#0d9488", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#06b6d4"];
          const devColorMap = new Map();
          let ci = 0;
          for (const code of devSet.keys()) { devColorMap.set(code, devColors2[ci % devColors2.length]); ci++; }

          const graphNodes = [];
          const graphLinks = [];
          const nodeSet = new Set();
          for (const { b, dev } of nodesWithDev) {
            if (!nodeSet.has(b.id)) {
              nodeSet.add(b.id);
              const xi = stageIdx.get(b.stage) ?? 0;
              const stageList = byStage.get(b.stage) || [];
              const yi = stageList.findIndex(x => x.b.id === b.id);
              const yBase = stageList.length > 1 ? (yi - (stageList.length - 1) / 2) * 80 : 0;
              const isRoot = b.id === dv.flowRoot;
              const devColor = dev ? devColorMap.get(dev.code) : "#94a3b8";
              graphNodes.push({
                id: b.id,
                name: b.id,
                x: xi * 220,
                y: yBase,
                symbolSize: isRoot ? 22 : (dev ? 16 : 10),
                itemStyle: {
                  color: isRoot ? "#2563eb" : (b.verdict === "不合格" ? "#dc2626" : devColor),
                  borderColor: "#fff", borderWidth: 2,
                  shadowBlur: isRoot ? 14 : 5,
                  shadowColor: isRoot ? "rgba(37,99,235,.35)" : "rgba(15,23,42,.15)",
                },
                label: {
                  show: true,
                  position: "bottom",
                  distance: 8,
                  fontSize: 9,
                  fontFamily: "var(--mono), monospace",
                  color: "#475569",
                  formatter: () => dev ? `${dev.code}` : b.id.slice(0, 8),
                },
                batch: b,
                dev,
              });
            }
          }
          for (const e of S.data.edges) {
            if (nodeSet.has(e.from) && nodeSet.has(e.to) && e.from !== e.to) {
              graphLinks.push({
                source: e.from, target: e.to,
                lineStyle: { color: e.source === "manual" ? "#d97706" : "#b6c2d2", width: e.source === "manual" ? 1.8 : 1.1, curveness: 0.08 },
              });
            }
          }

          const cw2 = flowDom.clientWidth || 1004;
          const ch2 = flowDom.clientHeight || 420;
          let gxn = Infinity, gxx = -Infinity, gyn = Infinity, gx = -Infinity;
          for (const n of graphNodes) {
            if (n.x < gxn) gxn = n.x; if (n.x > gxx) gxx = n.x;
            if (n.y < gyn) gyn = n.y; if (n.y > gx) gx = n.y;
          }
          const dw = (gxx - gxn) || 220, dh = (gx - gyn) || 80;
          const cRatio = cw2 / ch2, dRatio = dw / dh;
          let fmin = gxn, fmax = gxx, fymin = gyn, fymax = gx;
          if (cRatio > dRatio) { const p = (dh * cRatio - dw) / 2; fmin -= p; fmax += p; }
          else { const p = (dw / cRatio - dh) / 2; fymin -= p; fymax += p; }

          App.makeChart(flowDom, {
            animation: false,
            tooltip: {
              formatter: p => {
                if (p.dataType !== "node") return "";
                const b = p.data.batch;
                const dev = p.data.dev;
                return `<b style="font-family:monospace">${b.id}</b><br/>工序：${b.stage}　产品：${b.product}<br/>日期：${b.date || "—"}　判定：${b.verdict}${dev ? `<br/>设备：${dev.code} · ${dev.name}（${dev.category}）` : "<br/>设备：—"}<br/>供方：${App.batchSupplier(b) || "—"}　数量：${App.qtyText(b)}`;
              }
            },
            xAxis: { min: fmin - (fmax-fmin)*0.05, max: fmax + (fmax-fmin)*0.05, show: false },
            yAxis: { min: fymin - (fymax-fymin)*0.05, max: fymax + (fymax-fymin)*0.05, show: false },
            series: [{
              type: "graph", layout: "none", roam: true, data: graphNodes, links: graphLinks,
              edgeSymbol: ["none", "arrow"], edgeSymbolSize: [0, 9],
              emphasis: { focus: "adjacency", lineStyle: { width: 2.5, color: "#2563eb" } },
              lineStyle: { opacity: 0.85 },
            }],
          });
          const flowChart = echarts.getInstanceByDom(flowDom);
          if (flowChart) flowChart.on("click", p => { if (p.dataType === "node") App.openBatchDrawer(p.data.id); });

          // 设备流转路径表
          const flowTblWrap = App.el("div", { class: "tbl-wrap", style: "max-height:320px" });
          const flowTbody = App.el("tbody");
          // 按工序顺序+日期排序
          const orderedFlow = nodesWithDev
            .filter(x => x.dev)
            .sort((a, b) => (stageIdx.get(a.b.stage) ?? 99) - (stageIdx.get(b.b.stage) ?? 99) || (a.b.date || "").localeCompare(b.b.date || ""));
          for (const { b, dev } of orderedFlow) {
            const tr = App.el("tr", { class: "clickable" },
              App.el("td", {}, STAGES.indexOf(b.stage) >= 0 ? String(STAGES.indexOf(b.stage) + 1) : "—"),
              App.el("td", {}, b.stage),
              App.el("td", {}, App.el("span", { class: "mono", style: `color:${devColorMap.get(dev.code)}` }, dev.code)),
              App.el("td", {}, dev.name),
              App.el("td", { class: "mono" }, b.id),
              App.el("td", { class: "mono" }, b.date || "—"),
              App.el("td", {}, App.verdictPill(b.verdict)),
              App.el("td", {}, b.product || "—"),
              App.el("td", { class: "num" }, App.qtyText(b)),
            );
            tr.addEventListener("click", () => App.openBatchDrawer(b.id));
            flowTbody.append(tr);
          }
          flowTblWrap.append(App.el("table", { class: "tbl" },
            App.el("thead", {}, App.el("tr", {},
              App.el("th", { class: "ctr" }, "序"), App.el("th", {}, "工序"), App.el("th", {}, "设备号"), App.el("th", {}, "设备名称"),
              App.el("th", {}, "批号"), App.el("th", {}, "日期"), App.el("th", { class: "ctr" }, "判定"), App.el("th", {}, "产品"), App.el("th", { class: "ctr" }, "数量"))),
            flowTbody));
          deviceBody.append(App.el("div", { class: "card", style: "margin-top:16px" },
            App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "route" }), "设备流转路径（按工序顺序排列）")),
            flowTblWrap));
        }
        App.refreshIcons();
      };

      drawDevice();
    }

    const statEl = App.el("span", { class: "muted small" });
    const selectedHint = App.el("span", { class: "trace-selected-hint" });
    const statsWrap = App.el("div", { class: "trace-stats" });
    const graphDom = App.el("div", { class: "trace-graph", id: "traceGraph" });
    const summaryWrap = App.el("div", { class: "chain-cols" });

    function dataUrlToBlob(url) {
      const arr = url.split(",");
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) u8arr[n] = bstr.charCodeAt(n);
      return new Blob([u8arr], { type: mime });
    }
    function downloadTraceImage() {
      const chart = graphDom._traceChart;
      if (!chart) return;
      const url = chart.getDataURL({ type: "png", pixelRatio: 4, backgroundColor: "#ffffff", excludeComponents: ["toolbox"] });
      const blob = dataUrlToBlob(url);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `追溯图_${st.root}_${new Date().toISOString().slice(0, 10)}.png`;
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      App.toast("追溯图已下载（300dpi）");
    }

    const isDeviceMode = st.mode === "device";
    const toolbar = App.el("div", { class: "toolbar trace-toolbar" },
      modeSeg,
      ...(st.mode === "batch" && batchInput ? [batchInput, batchInput.appendAfter] : []),
      ...(isDeviceMode ? [] : [depthSeg]),
      ...(isDeviceMode ? [] : [App.el("button", { class: "btn sm", onclick: () => { st.root = pickDefaultRoot(); if (batchInput) batchInput.value = st.root; draw(); } }, "最新混料批")]),
      App.el("div", { class: "spacer" }),
      ...(isDeviceMode ? [] : [selectedHint, statEl]),
      ...(isDeviceMode ? [] : [App.el("button", { class: "btn", onclick: downloadTraceImage }, App.el("i", { "data-lucide": "image-down" }), "下载追溯图")]),
      ...(isDeviceMode ? [] : [App.el("button", { class: "btn", onclick: () => exportChainCsv(collect(st.root)) }, App.el("i", { "data-lucide": "download" }), "导出追溯链")]),
    );

    const resultCard = App.el("div", { class: "card trace-results", style: st.mode === "filter" ? "" : "display:none" },
      App.el("div", { class: "card-head" },
        App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "list" }), "检索结果"),
        resultsCountEl,
      ),
      App.el("div", { class: "tbl-wrap" },
        App.el("table", { class: "tbl" },
          App.el("thead", {}, App.el("tr", {},
            App.el("th", { class: "ctr" }, "判定"),
            App.el("th", {}, "批号"),
            App.el("th", {}, "工序"),
            App.el("th", {}, "日期"),
            App.el("th", {}, "供方"),
            App.el("th", {}, "产品"),
            App.el("th", { class: "ctr" }, "数量"),
            App.el("th", {}, "关键指标"),
            App.el("th", { class: "ctr" }, "操作")
          )),
          resultsBody
        )
      )
    );

    root.append(
      toolbar,
      ...(isDeviceMode ? [devicePanel] : [filterPanel, resultCard,
        App.el("div", { class: "trace-wrap card" },
          statsWrap,
          graphDom,
          App.el("div", { class: "trace-legend" },
            App.el("span", {}, App.el("span", { class: "sw", style: "background:#16a34a" }), "合格"),
            App.el("span", {}, App.el("span", { class: "sw", style: "background:#dc2626" }), "不合格"),
            App.el("span", {}, App.el("span", { class: "sw", style: "background:#94a3b8" }), "未检"),
            App.el("span", {}, App.el("span", { class: "sw", style: "background:#2563eb" }), "当前批")),
        ),
        App.el("div", { class: "card", style: "margin-top:16px" },
          App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "list-tree" }), "链路清单（按工序分组，点击批号查看详情）")),
          App.el("div", { class: "card-body" }, summaryWrap)),
      ]),
    );

    // 如果进入条件检索模式，渲染结果表（首次显示提示）
    if (st.mode === "filter") {
      renderResults();
    }

    function renderStats(chain, idSet) {
      const batches = [...idSet].map(id => S.byId.get(id)).filter(Boolean);
      const stageCounts = {}, verdictCounts = {};
      const suppliers = new Set();
      let totalQty = 0, minDate = "", maxDate = "";
      for (const b of batches) {
        stageCounts[b.stage] = (stageCounts[b.stage] || 0) + 1;
        verdictCounts[b.verdict] = (verdictCounts[b.verdict] || 0) + 1;
        const s = App.batchSupplier(b); if (s) suppliers.add(s);
        const qtxt = App.qtyText(b);
        if (qtxt !== "—") {
          const n = parseFloat(qtxt.replace(/[^0-9.]/g, ""));
          if (isFinite(n)) totalQty += n;
        }
        if (b.date) {
          if (!minDate || b.date < minDate) minDate = b.date;
          if (!maxDate || b.date > maxDate) maxDate = b.date;
        }
      }
      statsWrap.innerHTML = "";
      statsWrap.append(App.el("span", { class: "trace-stat-label" }, `节点 ${batches.length} · 上游 ${chain.up.size - 1} · 下游 ${chain.down.size - 1}`));
      for (const s of STAGES) {
        const c = stageCounts[s];
        if (!c) continue;
        statsWrap.append(App.el("span", { class: "pill info", style: `background:${STAGE_COLOR[s]}22;color:${STAGE_COLOR[s]};border-color:${STAGE_COLOR[s]}44` }, `${s} ${c}`));
      }
      for (const [v, c] of Object.entries(verdictCounts)) {
        statsWrap.append(App.el("span", { class: `pill ${VERDICT_CLASS[v] || "none"}` }, `${v} ${c}`));
      }
      if (suppliers.size) {
        statsWrap.append(App.el("span", { class: "pill info" }, `供方：${[...suppliers].join("、")}`));
      }
      if (minDate && maxDate) {
        statsWrap.append(App.el("span", { class: "muted small" }, `${minDate} ~ ${maxDate}`));
      }
      if (totalQty > 0) {
        statsWrap.append(App.el("span", { class: "muted small" }, `总数量 ${App.fmtMetric("重量", totalQty)} kg`));
      }
    }

    function draw() {
      if (!st.root) return;
      const chain = collect(st.root);
      let ids = [...chain.ids];
      let truncated = false;
      if (ids.length > MAX_NODES) {
        const dist = id => Math.min(chain.up.get(id) ?? 99, chain.down.get(id) ?? 99);
        ids = ids.sort((a, b) => dist(a) - dist(b) || a.localeCompare(b)).slice(0, MAX_NODES);
        if (!ids.includes(st.root)) ids[0] = st.root;
        truncated = true;
      }
      const idSet = new Set(ids);
      const byStage = new Map(STAGES.map(s => [s, []]));
      for (const id of ids) {
        const b = S.byId.get(id);
        if (b) byStage.get(b.stage)?.push(id);
      }
      const presentStages = STAGES.filter(s => (byStage.get(s) || []).length);
      const stageIdx2 = new Map(presentStages.map((s, i) => [s, i]));
      const n2 = [], n2set = new Set();
      const maxPerStage = Math.max(1, ...presentStages.map(s => byStage.get(s).length));
      const cw = graphDom.clientWidth || 1004;
      const ch = graphDom.clientHeight || 540;
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      const LC = isDark
        ? { root: "#60a5fa", n: "#cbd5e1", bad: "#f87171", none: "#64748b" }
        : { root: "#1d4ed8", n: "#334155", bad: "#dc2626", none: "#94a3b8" };
      const padT = 20, padB = 16;
      const plotW = cw;
      const plotH = ch - padT - padB;
      const nStages = presentStages.length || 1;
      const targetWidthRatio = 0.8;
      const X_SPACING = Math.max(250, Math.round((plotW * targetWidthRatio) / Math.max(1, nStages - 1)));
      const effectiveMaxPerStage = Math.max(2, maxPerStage);
      const Y_SPACING = Math.max(60, Math.round((nStages * X_SPACING * plotH) / (effectiveMaxPerStage * plotW) * 1.2));

      for (const stage of presentStages) {
        const list = byStage.get(stage).sort();
        const xi = stageIdx2.get(stage);
        list.forEach((id, i) => {
          const b = S.byId.get(id);
          const isRoot = id === st.root;
          let yBase;
          if (list.length === 1) {
            const singleStages = presentStages.filter(s => byStage.get(s).length === 1);
            const singleIdx = singleStages.indexOf(stage);
            yBase = (singleIdx - (singleStages.length - 1) / 2) * Y_SPACING;
          } else {
            yBase = (i - (list.length - 1) / 2) * Y_SPACING;
          }
          n2.push({
            id, name: id,
            x: xi * X_SPACING,
            y: yBase,
            symbolSize: isRoot ? 18 : 11,
            itemStyle: {
              color: isRoot ? "#2563eb" : (b.verdict === "合格" ? "#16a34a" : b.verdict === "不合格" ? "#dc2626" : "#94a3b8"),
              borderColor: isRoot ? "#1d4ed8" : "#fff", borderWidth: isRoot ? 3 : 2,
              shadowBlur: isRoot ? 14 : 5,
              shadowColor: isRoot ? "rgba(37,99,235,.35)" : "rgba(15,23,42,.18)",
            },
            label: {
              show: ids.length <= 60 || isRoot,
              position: "right",
              distance: 6,
              backgroundColor: "transparent",
              borderColor: "transparent",
              borderWidth: 0,
              padding: 0,
              rich: {
                root: { color: LC.root, fontSize: 10, fontWeight: 700, fontFamily: "var(--mono), monospace" },
                n:    { color: LC.n, fontSize: 9, fontFamily: "var(--mono), monospace" },
                bad:  { color: LC.bad, fontSize: 9, fontWeight: 600, fontFamily: "var(--mono), monospace" },
                none: { color: LC.none, fontSize: 9, fontFamily: "var(--mono), monospace" },
              },
              formatter: p => {
                const name = p.data.name;
                const isR = p.data.id === st.root;
                if (isR) return `{root|${name}}`;
                const verdict = p.data.batch && p.data.batch.verdict;
                if (verdict === "不合格") return `{bad|${name}}`;
                if (verdict === "未检") return `{none|${name}}`;
                return `{n|${name}}`;
              },
            },
            batch: b,
          });
          n2set.add(id);
        });
      }
      const l2 = [];
      for (const e of S.data.edges) {
        if (n2set.has(e.from) && n2set.has(e.to) && e.from !== e.to) {
          l2.push({ source: e.from, target: e.to, lineStyle: { color: e.source === "manual" ? "#d97706" : "#b6c2d2", width: e.source === "manual" ? 1.8 : 1.1, curveness: 0.08 } });
        }
      }
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      for (const n of n2) {
        if (n.x < xMin) xMin = n.x;
        if (n.x > xMax) xMax = n.x;
        if (n.y < yMin) yMin = n.y;
        if (n.y > yMax) yMax = n.y;
      }
      const dataW = xMax - xMin || X_SPACING;
      const dataH = yMax - yMin || Y_SPACING;
      const labelPad = cw * 0.15;
      const effectivePlotW = plotW - labelPad;
      const containerRatio = effectivePlotW / plotH;
      const dataRatio = dataW / dataH;
      let fxMin = xMin, fxMax = xMax, fyMin = yMin, fyMax = yMax;
      if (containerRatio > dataRatio) {
        const pad = (dataH * containerRatio - dataW) / 2;
        fxMin -= pad; fxMax += pad;
      } else {
        const pad = (dataW / containerRatio - dataH) / 2;
        fyMin -= pad; fyMax += pad;
      }
      const centerX = (xMin + xMax) / 2;
      const targetCenterX = cw / 2 - labelPad / 2;
      const shiftX = targetCenterX - centerX;
      fxMin += shiftX; fxMax += shiftX;
      const mx = (fxMax - fxMin) * 0.05, my = (fyMax - fyMin) * 0.05;

      const old = echarts.getInstanceByDom(graphDom);
      if (old) old.dispose();
      const chart = App.makeChart(graphDom, {
        animation: false,
        tooltip: {
          formatter: p => {
            if (p.dataType !== "node") return "";
            const b = p.data.batch;
            const supplier = App.batchSupplier(b) || "—";
            const qty = App.qtyText(b);
            const metricLines = KEY_METRICS.map(m => {
              const v = b.metrics?.[m];
              if (v == null) return null;
              const unit = App.S.units.get(m) || "";
              return `${m}：${App.fmtMetric(m, v)}${unit ? " " + unit : ""}`;
            }).filter(Boolean);
            return `<b style="font-family:monospace">${b.id}</b><br/>工序：${b.stage}　产品：${b.product}<br/>日期：${b.date || "—"}　判定：${b.verdict}<br/>供方：${supplier}　数量：${qty}` +
              (metricLines.length ? `<br/>${metricLines.join("　")}` : "") +
              (b.fails && b.fails.length ? `<br/><span style="color:#dc2626">不合格项：${b.fails.join("、")}</span>` : "");
          }
        },
        xAxis: { min: fxMin - mx, max: fxMax + mx, show: false },
        yAxis: { min: fyMin - my, max: fyMax + my, show: false },
        series: [{
          type: "graph", layout: "none", roam: true, data: n2, links: l2,
          symbolKeepAspect: true,
          edgeSymbol: ["none", "arrow"], edgeSymbolSize: [0, 10],
          emphasis: { focus: "adjacency", lineStyle: { width: 2.5, color: "#2563eb" } },
          lineStyle: { opacity: 0.85 },
        }],
      });
      chart.on("click", p => { if (p.dataType === "node") App.openBatchDrawer(p.data.id); });
      graphDom._traceChart = chart;

      const upCnt = chain.up.size - 1, downCnt = chain.down.size - 1;
      statEl.textContent = `上游 ${upCnt} 批 · 下游 ${downCnt} 批${truncated ? ` · 节点过多已截取前 ${MAX_NODES} 个` : ""}`;
      selectedHint.textContent = `根节点：${st.root}`;
      renderStats(chain, idSet);

      summaryWrap.innerHTML = "";
      for (const stage of presentStages) {
        const list = byStage.get(stage);
        summaryWrap.append(App.el("div", { class: "chain-col" },
          App.el("h5", {}, App.el("span", { style: `display:inline-block;width:8px;height:8px;border-radius:2px;background:${STAGE_COLOR[stage]}` }), `${stage}（${list.length}）`),
          App.el("div", {}, list.map(id => {
            const b = S.byId.get(id);
            const supplier = App.batchSupplier(b);
            return App.el("span", {
              class: `chip${id === st.root ? " root" : ""}${b.verdict === "不合格" ? " bad" : b.verdict === "合格" ? " ok" : ""}`,
              title: `${b.stage} · ${b.verdict}${b.date ? " · " + b.date : ""}${supplier ? " · 供方：" + supplier : ""} · 数量：${App.qtyText(b)}${b.fails?.length ? " · 不合格项：" + b.fails.join("、") : ""}`,
              onclick: () => App.openBatchDrawer(id),
            }, id);
          }))));
      }
      App.refreshIcons();
    }

    if (!isDeviceMode) draw();
  }

  function focus(id) { st.root = id; }
  return { render, focus };
})();
