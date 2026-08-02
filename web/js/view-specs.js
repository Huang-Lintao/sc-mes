/* 规格标准 与 来料检验记录 */
"use strict";
Views.specs = (() => {
  const st = { product: null };
  const RULE_TEXT = { range: "区间", ge: "不小于", le: "不大于", pending: "待定" };

  // 从批号里推断日期：批号格式 ACQ-4CS-2603250002GJ，日期位置在第 7-12 位（YYMMDD），其后是 4-5 位序列号
  function dateFromBatchId(id) {
    if (!id) return null;
    const m = String(id).match(/(\d{2})(\d{2})(\d{2})\d{4,}/);
    if (!m) return null;
    const yy = +m[1], mm = +m[2], dd = +m[3];
    if (yy < 20 || yy > 99 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    // 20YY-MM-DD（YY < 50 → 20YY，否则 19YY；保守取 20YY）
    return `20${String(yy).padStart(2, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  // 当批次无 supplier 字段时，从规格标准里查找适用的供方列表（拼接展示）
  function lookupAnySupplier(b) {
    if (!b || !b.product) return null;
    const sups = new Set();
    for (const sp of (App.S.data.specs || [])) {
      const F = (sp.product ?? sp.产品类型 ?? "") === b.product;
      if (!F) continue;
      const list = Array.isArray(sp.suppliers) ? sp.suppliers : (sp.supplier ? [sp.supplier] : []);
      for (const s of list) if (s) sups.add(s);
    }
    return sups.size ? [...sups].join("、") : null;
  }

  function render(root) {
    const { S, STAGES } = App;
    // 跟随顶部"基体"按钮
    st.product = S.product;

    const body = App.el("div");

    root.append(
      App.el("div", { class: "toolbar" },
        App.el("span", { class: "small", style: "font-weight:600; color:var(--ink-2)" }, "基体："), App.el("span", { class: "mono", style: "color:var(--ink-1); font-weight:600; padding: 4px 10px; background: var(--accent-soft); border-radius: 999px;" }, st.product)),
      body,
    );

    function draw() {
      body.innerHTML = "";
      const isAll = !st.product || st.product === "全部";
      const prodOk = p => isAll || p === st.product;
      const prodLabel = isAll ? "全部产品" : st.product;
      // 单位渲染：把 ㎡ 全角符号、²/³ 上标字符全部转普通数字 2/3，
      // 再用 CSS .unit-sup 做成上标，避免浏览器 fallback 到不同字体导致视觉不一致
      const renderUnit = u => {
        if (!u) return "";
        return String(u)
          .replace(/㎡/g, "m2")          // ㎡(U+33A1) → m2
          .replace(/cc\/g/gi, "cm3/g")   // 兼容旧数据 cc/g → cm3/g
          .replace(/²/g, "2")             // 上标2 → 普通2
          .replace(/³/g, "3")             // 上标3 → 普通3
          .split(/([23])/)                // 在 2/3 处拆分
          .map((p, i) => i % 2 === 1
            ? App.el("sup", { class: "unit-sup" }, p)
            : p);
      };
      // 字段名兼容：内置数据用「产品类型/工序/指标/供方」，导入数据用「product/stage/metric/supplier/suppliers」
      const F = sp => ({
        product: sp.product ?? sp.产品类型 ?? "",
        stage: sp.stage ?? sp.工序 ?? "",
        metric: sp.metric ?? sp.指标 ?? "",
        supplier: sp.supplier ?? sp.供方 ?? sp.供应商 ?? sp.厂商 ?? "",
        suppliers: Array.isArray(sp.suppliers) ? sp.suppliers
                 : Array.isArray(sp.供方列表) ? sp.供方列表
                 : (typeof sp.供方 === "string" && sp.供方.includes("、") ? sp.供方.split("、").map(s => s.trim()).filter(Boolean) : null),
        rule: sp.rule ?? sp.判定规则 ?? "",
        lower: sp.lower ?? sp.下限 ?? null,
        upper: sp.upper ?? sp.上限 ?? null,
        target: sp.target ?? sp.目标值 ?? null,
        unit: sp.unit ?? sp.单位 ?? "",
        raw: sp.raw ?? sp.规格原文 ?? "",
      });

      const specCard = App.el("div", { class: "card", style: "margin-bottom:16px" },
        App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "clipboard-list" }), `${prodLabel} · 规格标准`)));
      const specTbl = App.el("table", { class: "tbl" },
        App.el("thead", {}, App.el("tr", {},
          App.el("th", { class: "ctr" }, "工序"), App.el("th", { class: "ctr" }, "供方"), App.el("th", {}, "指标"), App.el("th", {}, "规格原文"), App.el("th", {}, "判定规则"),
          App.el("th", { class: "ctr" }, "下限"), App.el("th", { class: "ctr" }, "上限"), App.el("th", { class: "ctr" }, "目标值"), App.el("th", {}, "单位"))));
      const tb = App.el("tbody");
      const rows = S.data.specs
        .map(F)
        .filter(sp => prodOk(sp.product))
        .sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage)
          || (a.supplier || "").localeCompare(b.supplier || "")
          || a.metric.localeCompare(b.metric));
      let lastStage = null, lastSupplier = null;
      for (const sp of rows) {
        const supplierText = (sp.suppliers && sp.suppliers.length)
          ? sp.suppliers.filter(Boolean).join("、")
          : (sp.supplier || "通用");
        const tr = App.el("tr", {},
          App.el("td", { class: "ctr" }, sp.stage === lastStage ? "" : sp.stage),
          App.el("td", { class: "ctr" }, supplierText || "通用"),
          App.el("td", { style: "font-weight:500" }, sp.metric),
          App.el("td", { class: "mono" }, sp.raw),
          App.el("td", {}, App.el("span", { class: "pill info" }, RULE_TEXT[sp.rule] || sp.rule)),
        App.el("td", { class: "num ctr" }, sp.lower == null ? "—" : App.fmtMetric(sp.metric, sp.lower)),
        App.el("td", { class: "num ctr" }, sp.upper == null ? "—" : App.fmtMetric(sp.metric, sp.upper)),
        App.el("td", { class: "num ctr" }, sp.target == null ? "—" : App.fmtMetric(sp.metric, sp.target)),
          App.el("td", { class: "muted" }, renderUnit(sp.unit || "")));
        if (sp.stage !== lastStage || sp.supplier !== lastSupplier) tr.style.borderTop = "2px solid var(--line)";
        lastStage = sp.stage;
        lastSupplier = sp.supplier;
        tb.append(tr);
      }
      specTbl.append(tb);
      specCard.append(App.el("div", { class: "tbl-wrap" }, specTbl));

      // 数据源：原料来料批次（不再读 S.data.inspection，因为「来料检验」sheet 已并入原料来料）
      const matBatches = (S.data.batches || []).filter(b => b.stage === "原料来料");
      const allCount = matBatches.length;
      // 固定的 10 个检测项目（已删除氧含量，与原料来料 sheet 对齐；缺项以 — 显示）
      const FIXED_METRICS = ["振实", "比表面积", "孔容", "孔径", "微孔率", "灰分", "挥发分", "水分", "pH", "磁性总量"];
      const inspCard = App.el("div", { class: "card" },
        App.el("div", { class: "card-head" },
          App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "clipboard-check" }), `来料检验记录（${isAll ? allCount : "0 / " + allCount}）`),
          App.el("span", { class: "muted small" }, "判定依据上方规格标准自动判定")));
      const head = App.el("tr", {},
        App.el("th", { class: "ctr" }, "来料日期"),
        App.el("th", { class: "ctr" }, "批次号"),
        App.el("th", { class: "ctr" }, "供方名称"),
        App.el("th", { class: "ctr" }, "重量kg"),
        FIXED_METRICS.map(m => App.el("th", { class: "ctr" }, m)),
        App.el("th", { class: "ctr" }, "判定"),
        App.el("th", { class: "ctr" }, "不合格项"));
      const inspTbl = App.el("table", { class: "tbl" }, App.el("thead", {}, head));
      const ib = App.el("tbody");
      let visibleCount = 0;
      for (const b of matBatches) {
        // 跟随顶部基体筛选
        if (!isAll && b.product !== st.product) continue;
        visibleCount++;
        const metrics = b.metrics || {};
        const fails = [];
        let judged = 0;
        // 自动判定：根据上方规格标准
        for (const m of FIXED_METRICS) {
          const v = metrics[m];
          if (typeof v !== "number" || !isFinite(v)) continue;
          const sp = App.effectiveSpec(b, m);
          const j = App.judgeVal(v, sp);
          if (j === false) fails.push(m);
          if (j !== null) judged++;
        }
        const w = b.weights && b.weights["来料数量"];
        // 来料日期：优先 b.date，否则从 id 推断（ACQ-4CS-26050600001GJ → 2026-05-06）
        const date = b.date || dateFromBatchId(b.id) || "—";
        // 供方：优先 b.supplier，否则从规格标准里找通用规格的供方
        const supplier = b.supplier || lookupAnySupplier(b) || "通用";
        ib.append(App.el("tr", {},
          App.el("td", { class: "mono ctr" }, date),
          App.el("td", { class: "mono small ctr" }, b.id || "—"),
          App.el("td", { class: "ctr small" }, supplier),
          App.el("td", { class: "num ctr" }, w != null ? App.fmtMetric("重量", w) : "—"),
          FIXED_METRICS.map(m => {
            const v = metrics[m];
            const fail = fails.includes(m);
            const text = v == null ? "—" : (typeof v === "number" ? App.fmtMetric(m, v) : String(v));
            return App.el("td", { class: "num ctr", style: fail ? "color:var(--bad); font-weight:700" : "" }, text);
          }),
          App.el("td", { class: "ctr" }, App.verdictPill(fails.length ? "不合格" : (judged ? "合格" : "未检"))),
          App.el("td", { class: "small ctr", style: fails.length ? "color:var(--bad); font-weight:600" : "" }, fails.join("、") || "—")));
      }
      // 标题实时反映当前筛后数量
      inspCard.querySelector(".card-title").lastChild.textContent = `来料检验记录（${isAll ? visibleCount : visibleCount + " / " + allCount}）`;
      inspTbl.append(ib);
      inspCard.append(App.el("div", { class: "tbl-wrap" }, visibleCount ? inspTbl : App.el("div", { class: "empty" }, isAll ? "无检验记录" : `「${st.product}」暂无来料检验记录`)));

      body.append(specCard, inspCard);
      App.refreshIcons();
    }

    draw();
  }

  return { render };
})();
