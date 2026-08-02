/* 批次数据 - 灵活过滤查询 */
"use strict";
Views.batches = (() => {
  const st = { stage: "全部", verdict: "全部", kw: "", manualOnly: false, sort: "dateDesc", shown: 120 };

  function filtered() {
    const kw = st.kw.trim().toUpperCase();
    let list = App.byProduct(App.S.data.batches);
    if (st.stage !== "全部") list = list.filter(b => b.stage === st.stage);
    if (st.verdict !== "全部") list = list.filter(b => b.verdict === st.verdict);
    if (st.manualOnly) list = list.filter(b => b.manual || b.manualTouched);
    if (kw) list = list.filter(b => b.id.toUpperCase().includes(kw) || (b.remark || "").toUpperCase().includes(kw));
    const arr = [...list];
    if (st.sort === "dateDesc") arr.sort(App.cmpBatch);
    else if (st.sort === "dateAsc") arr.sort((a, b) => App.cmpBatch(b, a));
    else if (st.sort === "idAsc") arr.sort((a, b) => a.id.localeCompare(b.id));
    return arr;
  }

  function exportCsv() {
    const list = filtered();
    const head = ["批号", "工序", "产品", "日期", "数量", "收率", "判定", "不合格项", "备注", "数据来源"];
    const lines = [head.join(",")];
    for (const b of list) {
      const y = App.yieldOf(b);
      const cells = [b.id, b.stage, b.product, b.date || "", App.qtyText(b), y == null ? "" : (y * 100).toFixed(1) + "%",
        b.verdict, (b.fails || []).join("、"), (b.remark || "").replaceAll(",", "，").replaceAll("\n", " "), b.manual ? "手动录入" : (b.manualTouched ? "含补录" : "原始")];
      lines.push(cells.map(c => /[",\n]/.test(c) ? `"${String(c).replaceAll('"', '""')}"` : c).join(","));
    }
    App.download(`批次数据_${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + lines.join("\r\n"), "text/csv");
    App.toast(`已导出 ${list.length} 行`);
  }

  function seg(opts, getCur, onPick) {
    const segEl = App.el("div", { class: "seg" });
    const btns = [];
    for (const o of opts) {
      const btn = App.el("button", { class: o === getCur() ? "active" : "" }, o);
      btn.addEventListener("click", () => { onPick(o); refresh(); rerender(); });
      btns.push({ o, btn });
      segEl.append(btn);
    }
    function refresh() {
      for (const { o, btn } of btns) btn.classList.toggle("active", o === getCur());
    }
    return segEl;
  }

  let listWrap, countEl, moreWrap;
  function rerender() {
    const list = filtered();
    countEl.textContent = `共 ${list.length} 条`;
    const rows = list.slice(0, st.shown).map(b => {
      const y = App.yieldOf(b);
      return App.el("tr", { class: "clickable", onclick: () => App.openBatchDrawer(b.id) },
        App.el("td", { class: "mono" }, b.id),
        App.el("td", {}, b.stage),
        App.el("td", {}, b.product),
        App.el("td", { class: "mono" }, b.date || "—"),
        App.el("td", { class: "mono" }, App.qtyText(b)),
        App.el("td", { class: "mono" }, y == null ? "—" : App.fmtPct(y)),
        App.el("td", {}, App.verdictPill(b.verdict)),
        App.el("td", { class: "small", style: "color:var(--bad)" }, (b.fails || []).join("、")),
        App.el("td", { class: "muted ellipsis", title: b.remark || "" }, b.remark || ""),
        App.el("td", {}, b.manual ? App.el("span", { class: "pill warn" }, "手动") : (b.manualTouched ? App.el("span", { class: "pill warn" }, "补录") : "")),
      );
    });
    listWrap.innerHTML = "";
    if (rows.length) listWrap.append(...rows);
    else listWrap.append(App.el("tr", {}, App.el("td", { colspan: 10 }, App.el("div", { class: "empty" }, "没有符合条件的批次"))));
    moreWrap.innerHTML = "";
    if (list.length > st.shown) {
      moreWrap.append(App.el("button", {
        class: "btn", onclick: () => { st.shown += 200; rerender(); }
      }, `显示更多（剩余 ${list.length - st.shown} 条）`));
    }
    App.refreshIcons();
  }

  function render(root) {
    st.shown = 120;
    const kwInput = App.el("input", { class: "input", placeholder: "批号 / 备注关键词", value: st.kw, style: "width:220px" });
    kwInput.addEventListener("input", App.debounce(() => { st.kw = kwInput.value; st.shown = 120; rerender(); }, 180));
    const manualCk = App.el("input", { type: "checkbox" });
    manualCk.checked = st.manualOnly;
    manualCk.addEventListener("change", () => { st.manualOnly = manualCk.checked; rerender(); });
    const sortSel = App.el("select", { class: "input" },
      App.el("option", { value: "dateDesc" }, "日期 ↓ 最新"),
      App.el("option", { value: "dateAsc" }, "日期 ↑ 最早"),
      App.el("option", { value: "idAsc" }, "批号 A→Z"),
    );
    sortSel.value = st.sort;
    sortSel.addEventListener("change", () => { st.sort = sortSel.value; rerender(); });

    countEl = App.el("span", { class: "muted small" });
    listWrap = App.el("tbody");
    moreWrap = App.el("div", { style: "text-align:center; padding:14px 0 4px" });

    root.append(
      App.el("div", { class: "toolbar" },
        seg(["全部", ...App.STAGES], () => st.stage, v => st.stage = v),
        seg(["全部", "合格", "不合格", "未检"], () => st.verdict, v => st.verdict = v),
        kwInput,
        App.el("label", { class: "check" }, manualCk, "仅看手动/补录"),
        App.el("div", { class: "spacer" }),
        sortSel,
        App.el("button", { class: "btn", onclick: exportCsv }, App.el("i", { "data-lucide": "download" }), "导出 CSV"),
      ),
      App.el("div", { class: "card" },
        App.el("div", { class: "card-head" },
          App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "database" }), "批次台账"),
          countEl),
        App.el("div", { class: "tbl-wrap", style: "max-height: calc(100vh - 270px); overflow-y:auto" },
          App.el("table", { class: "tbl" },
            App.el("thead", {}, App.el("tr", {},
              App.el("th", {}, "批号"), App.el("th", {}, "工序"), App.el("th", {}, "产品"), App.el("th", {}, "日期"),
              App.el("th", {}, "数量"), App.el("th", {}, "收率"), App.el("th", {}, "判定"), App.el("th", {}, "不合格项"),
              App.el("th", {}, "备注"), App.el("th", {}, "来源"))),
            listWrap)),
      ),
      moreWrap,
    );
    rerender();
  }

  return { render };
})();
