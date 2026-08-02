/* 数据管理 - 手动录入 / Excel 导入 / 数据导出 */
"use strict";
Views.data = (() => {

  const WEIGHT_KEYS = new Set(["投料重量", "出料重量", "产出重量", "来料数量", "来料重量", "初始重量", "F3重量", "励磁物重量", "收率", "产能"]);
  const SRC_COL = { "细碎": "投料批号(来源)", "分级": "细碎批号(来源)", "除磁": "分级批号(来源)", "混料": "来源批号(分级/除磁)" };

  /* ================= 手动录入 ================= */
  const form = { stage: "细碎", product: "树脂基" };

  function renderEntry(card) {
    const { S } = App;
    card.innerHTML = "";
    const products = S.data.meta.products || [];
    if (!products.includes(form.product)) form.product = products[0];

    const grid = App.el("div", { class: "form-grid" });
    const stageSel = App.el("select", { class: "input" }, App.STAGES.map(s => App.el("option", { value: s }, s)));
    stageSel.value = form.stage;
    const prodSel = App.el("select", { class: "input" }, products.map(p => App.el("option", { value: p }, p)));
    prodSel.value = form.product;
    const dateIn = App.el("input", { class: "input", type: "date" });
    const idIn = App.el("input", { class: "input", placeholder: "如 ACQ-4-26070001(GJ)", style: "font-family:var(--mono)" });
    const idHint = App.el("div", { class: "hint" }, "规则：产品码-工序码-日期序号-分桶后缀");
    const parentsIn = App.el("input", { class: "input", list: "parentIds", placeholder: "多个用顿号、逗号分隔，可留空", style: "font-family:var(--mono)" });
    const parentsHint = App.el("div", { class: "hint" });
    const datalist = App.el("datalist", { id: "parentIds" },
      S.data.batches.map(b => App.el("option", { value: b.id }, `${b.stage} · ${b.product}`)));

    grid.append(
      App.el("div", { class: "field" }, App.el("label", {}, "工序 ", App.el("span", { class: "req" }, "*")), stageSel),
      App.el("div", { class: "field" }, App.el("label", {}, "产品 ", App.el("span", { class: "req" }, "*")), prodSel),
      App.el("div", { class: "field" }, App.el("label", {}, "日期"), dateIn),
      App.el("div", { class: "field full" }, App.el("label", {}, "批号 ", App.el("span", { class: "req" }, "*")), idIn, idHint),
      App.el("div", { class: "field full" }, App.el("label", {}, "来源批号（建立追溯关系）"), parentsIn, parentsHint),
    );

    const dynWrap = App.el("div");
    const remarkIn = App.el("textarea", { class: "input", rows: 4, style: "resize:both; width:100%; min-height:80px; font-family:inherit" });

    function fieldNum(label, unit) {
      const inp = App.el("input", { class: "input", type: "number", step: "any" });
      inp.dataset.key = label;
      return App.el("div", { class: "field" },
        App.el("label", {}, label + (unit ? `（${unit}）` : "")),
        App.el("div", { class: "unit-input" }, inp, unit ? App.el("span", { class: "unit" }, unit) : null));
    }

    function rebuildDynamic() {
      dynWrap.innerHTML = "";
      const def = App.STAGE_FIELDS[form.stage];
      const wFields = App.el("div", { class: "form-grid" });
      for (const [k, u] of def.weights) wFields.append(fieldNum(k, u));
      const mFields = App.el("div", { class: "form-grid" });
      for (const k of def.metrics) {
        if (App.TEXT_METRICS.has(k)) {
          const inp = App.el("input", { class: "input" });
          inp.dataset.key = k; inp.dataset.text = "1";
          mFields.append(App.el("div", { class: "field" }, App.el("label", {}, k), inp));
        } else {
          mFields.append(fieldNum(k, S.units.get(k) || ""));
        }
      }
      dynWrap.append(
        App.el("div", { class: "form-section" }, App.el("i", { "data-lucide": "scale" }), "重量 / 产能"),
        wFields,
        App.el("div", { class: "form-section" }, App.el("i", { "data-lucide": "flask-conical" }), "检测指标（按规格自动判定）"),
        mFields,
        App.el("div", { class: "form-section" }, App.el("i", { "data-lucide": "message-square" }), "备注"),
        remarkIn,
      );
      App.refreshIcons();
    }

    function checkId() {
      const v = idIn.value.trim();
      if (!v) { idHint.textContent = "规则：产品码-工序码-日期序号-分桶后缀"; idHint.style.color = "var(--ink-3)"; return; }
      if (App.S.byId.has(v)) { idHint.textContent = "⚠ 批号已存在，保存后将作为「补录数据」合并进该批次"; idHint.style.color = "var(--warn)"; }
      else { idHint.textContent = "✓ 新批次"; idHint.style.color = "var(--ok)"; }
    }
    function checkParents() {
      const ps = parseParents(parentsIn.value);
      if (!ps.length) { parentsHint.textContent = ""; return; }
      const missing = ps.filter(p => !App.S.byId.has(p));
      parentsHint.textContent = missing.length ? `⚠ 未找到：${missing.join("、")}（保存时自动跳过）` : `✓ ${ps.length} 个来源批号均有效`;
      parentsHint.style.color = missing.length ? "var(--warn)" : "var(--ok)";
    }
    function parseParents(s) {
      return [...new Set(String(s || "").split(/[、,，;；\s]+/).map(x => x.trim()).filter(Boolean))];
    }

    idIn.addEventListener("input", App.debounce(checkId, 200));
    parentsIn.addEventListener("input", App.debounce(checkParents, 250));
    stageSel.addEventListener("change", () => { form.stage = stageSel.value; rebuildDynamic(); });
    prodSel.addEventListener("change", () => { form.product = prodSel.value; });

    const saveBtn = App.el("button", { class: "btn primary" }, App.el("i", { "data-lucide": "save" }), "保存批次");
    saveBtn.addEventListener("click", () => {
      const id = idIn.value.trim();
      if (!id) { App.toast("请填写批号", "err"); idIn.focus(); return; }
      const weights = {}, metrics = {};
      dynWrap.querySelectorAll("input[data-key]").forEach(inp => {
        const k = inp.dataset.key, raw = inp.value.trim();
        if (!raw) return;
        if (inp.dataset.text) { metrics[k] = raw; return; }
        let v = parseFloat(raw);
        if (!isFinite(v)) return;
        if (k === "收率") v = v > 3 ? v / 100 : v; // 收率按 % 录入
        if (WEIGHT_KEYS.has(k)) weights[k] = v; else metrics[k] = v;
      });
      if (!Object.keys(weights).length && !Object.keys(metrics).length) {
        App.toast("请至少填写一项重量或检测指标", "err"); return;
      }
      const entry = {
        id, stage: form.stage, product: form.product,
        date: dateIn.value || null,
        parents: parseParents(parentsIn.value),
        weights, metrics,
        remark: remarkIn.value.trim(),
        ts: new Date().toISOString(),
      };
      const merged = App.S.byId.has(id);
      App.S.manual.push(entry);
      App.persistManual();
      App.rebuild();
      App.toast(merged ? `已补录合并到批次 ${id}` : `新批次 ${id} 已保存并自动判定`);
    });

    card.append(
      App.el("div", { class: "card-head" },
        App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "square-pen" }), "手动录入批次"),
        saveBtn),
      App.el("div", { class: "card-body" }, grid, datalist, dynWrap),
    );
    rebuildDynamic();
  }

  /* ================= 手动数据列表 ================= */
  function renderManualList(tbody, countEl) {
    const list = App.S.manual;
    countEl.textContent = `${list.length} 条`;
    tbody.innerHTML = "";
    if (!list.length) {
      tbody.append(App.el("tr", {}, App.el("td", { colspan: 6 }, App.el("div", { class: "empty" }, "暂无手动录入数据"))));
      return;
    }
    list.forEach((m, i) => {
      tbody.append(App.el("tr", {},
        App.el("td", { class: "mono" }, m.id),
        App.el("td", {}, m.stage),
        App.el("td", {}, m.product),
        App.el("td", { class: "mono" }, m.date || "—"),
        App.el("td", { class: "muted small" }, `指标 ${Object.keys(m.metrics).length} · 重量 ${Object.keys(m.weights).length} · 来源 ${(m.parents || []).length}`),
        App.el("td", {}, App.el("button", {
          class: "btn sm danger",
          onclick: () => {
            if (!confirm(`删除手动数据 ${m.id}？`)) return;
            App.S.manual.splice(i, 1);
            App.persistManual(); App.rebuild();
            App.toast("已删除");
          }
        }, App.el("i", { "data-lucide": "trash-2" }), "删除")),
      ));
    });
    App.refreshIcons();
  }

  /* ================= Excel 导入（解析优化版工作簿） ================= */
  function stripUnit(h) { return String(h || "").replace(/[(（].*$/, "").trim(); }
  function numOrNull(v) {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.\-]/g, ""));
    return isFinite(n) ? n : null;
  }
  function dateOrNull(v) {
    if (v == null) return null;
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    return null;
  }

  function parseWorkbook(wb, fileName) {
    const ruleMap = { "区间": "range", "不小于": "ge", "不大于": "le", "待定": "pending" };
    const srcMap = { "同排记录": "row", "序号推断": "core", "手动添加": "manual" };
    const sheets = {};
    for (const name of wb.SheetNames) {
      sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    }
    if (!sheets["规格标准"] || !App.STAGES.some(s => sheets[s])) {
      throw new Error("未找到「规格标准」或工序工作表，请拖入优化版工作簿");
    }

    /* 规格：按表头识别，支持新增「供方」列；同时兼容旧版固定列 */
    const specs = [];
    const specRows = sheets["规格标准"] || [];
    if (specRows.length) {
      const header = specRows[0].map(h => String(h ?? "").trim());
      const find = (...keys) => {
        for (const k of keys) {
          const i = header.findIndex(h => h === k || h.includes(k));
          if (i >= 0) return i;
        }
        return -1;
      };
      let idx = {
        product: find("产品类型", "产品"),
        stage: find("工序"),
        supplier: find("供方", "供方名称", "供应商"),
        metric: find("指标"),
        unit: find("单位"),
        rule: find("判定规则", "规则"),
        lower: find("下限"),
        upper: find("上限"),
        target: find("目标值", "目标"),
        raw: find("规格原文", "规格"),
      };
      // 未识别到表头时，按旧版 9 列固定顺序兼容
      if (idx.product < 0 || idx.stage < 0 || idx.metric < 0) {
        idx = { product: 0, stage: 1, supplier: -1, metric: 2, unit: 3, rule: 4, lower: 5, upper: 6, target: 7, raw: 8 };
      }
      for (const r of specRows.slice(1)) {
        const product = String(r[idx.product] ?? "").trim();
        const stage = String(r[idx.stage] ?? "").trim();
        const metric = String(r[idx.metric] ?? "").trim();
        if (!product || !stage || !metric) continue;
        const lo = numOrNull(idx.lower >= 0 ? r[idx.lower] : null);
        const hi = numOrNull(idx.upper >= 0 ? r[idx.upper] : null);
        const ruleVal = String(r[idx.rule] ?? "").trim();
        const rule = ruleMap[ruleVal] || (ruleVal === "待定" ? "pending" : "range");
        let rawDesc = idx.raw >= 0 ? String(r[idx.raw] ?? "") : "";
        if (!rawDesc) {
          if (rule === "pending") rawDesc = "待定";
          else if (lo != null && hi != null) rawDesc = `${lo} ~ ${hi}`;
          else if (lo != null) rawDesc = `≥ ${lo}`;
          else if (hi != null) rawDesc = `≤ ${hi}`;
        }
        const supplierRaw = idx.supplier >= 0 ? String(r[idx.supplier] ?? "").trim() : "";
        let suppliers;
        if (supplierRaw) {
          suppliers = [...new Set(supplierRaw.split(/[,，、]/).map(x => x.trim()).filter(Boolean))];
        } else {
          suppliers = [""];
        }
        const rawUnit = idx.unit >= 0 ? String(r[idx.unit] ?? "").trim() : "";
        specs.push({
          product, stage, metric,
          supplier: suppliers.length === 1 ? suppliers[0] : "",
          suppliers: suppliers,
          unit: rawUnit || App.extractUnit(rawDesc, metric),
          rule: rule,
          lower: rule === "pending" ? null : lo,
          upper: rule === "pending" ? null : hi,
          target: rule === "pending" ? null : numOrNull(idx.target >= 0 ? r[idx.target] : null),
          raw: rawDesc,
        });
      }
    }

    /* 工序批次 */
    const batches = [], edges = [], products = new Set();
    for (const stage of App.STAGES) {
      const rows = sheets[stage];
      if (!rows || rows.length < 2) continue;
      const head = rows[0].map(h => String(h ?? "").trim());
      for (const r of rows.slice(1)) {
        if (!r[0]) continue;
        const b = { id: String(r[0]).trim(), stage, product: String(r[1] ?? "").trim() || "树脂基", metrics: {}, weights: {}, date: null, remark: "" };
        products.add(b.product);
        head.forEach((h, i) => {
          const v = r[i];
          if (v == null || v === "" || i < 2) return;
          const key = stripUnit(h);
          if (/日期/.test(h)) b.date = b.date || dateOrNull(v);
          else if (h === "供方名称") b.supplier = String(v).trim() || null;
          else if (h === "备注") b.remark = String(v).slice(0, 200);
          else if (/批号|判定|不合格项/.test(h)) { /* skip */ }
          else if (WEIGHT_KEYS.has(key)) { const n = numOrNull(v); if (n != null) b.weights[key] = n; }
          else {
            const n = numOrNull(v);
            b.metrics[key] = n != null ? n : String(v).trim();
          }
        });
        b.base = App.baseOf(b.id); b.core = App.coreOf(b.id);
        b.records = [{ date: b.date || undefined, metrics: { ...b.metrics }, weights: { ...b.weights } }];
        b.recordCount = 1;
        batches.push(b);
      }
    }

    /* 追溯关系 */
    const seen = new Set();
    for (const r of (sheets["追溯关系"] || []).slice(1)) {
      if (!r[0] || !r[2]) continue;
      const key = `${r[0]}|||${r[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: String(r[0]).trim(), to: String(r[2]).trim(), source: srcMap[String(r[4]).trim()] || "row" });
    }

    /* 来料检验：优先读来料检验 sheet；若缺失，则从原料来料批次自动派生一份 */
    const inspection = [];
    const inspRows = sheets["来料检验"];
    if (inspRows && inspRows.length > 1) {
      const head = inspRows[0].map(h => String(h ?? "").trim());
      for (const r of inspRows.slice(1)) {
        if (!r[0] && !r[1] && !r[4]) continue;
        const rec = { date: dateOrNull(r[0]), lot: r[1] ? String(r[1]).trim() : null, weight: numOrNull(r[2]), sampleDate: dateOrNull(r[3]), inspectBatch: r[4] ? String(r[4]).trim() : null, metrics: {}, fails: [] };
        head.forEach((h, i) => {
          if (i < 5) return;
          if (h === "判定") { rec.verdict = String(r[i] ?? "未检").trim() || "未检"; return; }
          if (h === "不合格项") { rec.fails = String(r[i] ?? "").split(/[、,，]/).map(x => x.trim()).filter(Boolean); return; }
          const n = numOrNull(r[i]);
          if (n != null) rec.metrics[stripUnit(h)] = n;
        });
        inspection.push(rec);
      }
    } else {
      // 从原料来料批次派生来料检验（投料批号 + 来料日期 + 来料数量 + 检测项）
      // 仅保留固定的 10 个检测项目，与原始检验单对齐（已删除氧含量）
      const FIXED_METRICS = ["振实", "比表面积", "孔容", "孔径", "微孔率", "灰分", "挥发分", "水分", "pH", "磁性总量"];
      for (const b of batches) {
        if (b.stage !== "原料来料") continue;
        const m = b.metrics || {};
        // 优先匹配固定 10 项；若某项未出现在批次 metrics 中也保留空值
        const recMetrics = {};
        for (const k of FIXED_METRICS) recMetrics[k] = m[k] != null ? m[k] : null;
        // 即使全空也生成（保证记录数与批次数对齐）
        const w = m[stripUnit("来料数量(kg)")] ?? m["来料数量"] ?? m[stripUnit("来料重量(kg)")] ?? m["来料重量"] ?? null;
        inspection.push({
          date: b.date || null,
          lot: b.id,
          weight: w,
          sampleDate: b.date || null,
          inspectBatch: b.id,
          supplier: b.supplier || "",
          metrics: recMetrics,
          verdict: "未检",
          fails: [],
        });
      }
    }

    return {
      meta: { source: fileName, products: [...products], stages: [...App.STAGES], batchCount: batches.length, edgeCount: edges.length },
      specs, batches, edges, inspection,
    };
  }

  /* ================= 文件解密服务（自动调用） ================= */
  // 动态判断 API 地址：
  // - 和 ldDecrypt 同源（部署在 980 端口） → 用相对路径，无跨域
  // - 独立部署（双击 index.html / 其他端口） → 用绝对路径，需要 CORS
  async function getDecryptUrl() {
    // 先尝试相对路径（同源部署）
    try {
      const r = await fetch("/test/ldDecrypt", { method: "HEAD", signal: AbortSignal.timeout(1500) });
      if (r.ok || r.status < 500) return "/test/ldDecrypt";
    } catch (_) { /* 不在同源，继续试 */ }
    return "http://127.0.0.1:980/test/ldDecrypt";
  }
  let _decryptUrl = null;
  async function ensureDecryptUrl() {
    if (_decryptUrl) return _decryptUrl;
    _decryptUrl = await getDecryptUrl();
    return _decryptUrl;
  }

  async function tryDecrypt(file) {
    const url = await ensureDecryptUrl();
    const form = new FormData();
    form.append("file", file);
    form.append("deleteFlag", "0");

    const resp = await fetch(url, { method: "POST", body: form });
    if (!resp.ok) {
      let detail = "";
      try { detail = (await resp.text()).substring(0, 200); } catch (_) { }
      throw new Error(`解密服务返回 ${resp.status}${detail ? "：" + detail : ""}`);
    }
    return await resp.blob();
  }

  async function isEncryptedFile(file) {
    // 快速检测文件头，判断是否疑似加密
    // 正常 xlsx 以 "PK" 开头，xls 以 OLE2 头开头，csv/txt 是 ASCII
    // 加密后这些特征会被破坏
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (head.length < 4) return true;
    const isNormalXlsx = head[0] === 0x50 && head[1] === 0x4B;
    const isNormalXls  = head[0] === 0xD0 && head[1] === 0xCF;
    const isPlainText  = head[0] >= 0x20 && head[0] <= 0x7E;
    return !(isNormalXlsx || isNormalXls || isPlainText);
  }

  function looksLikeExcel(arrayBuffer) {
    // 验证 arrayBuffer 是否包含 Excel 特征
    const head = new Uint8Array(arrayBuffer.slice(0, 4));
    return (head[0] === 0x50 && head[1] === 0x4B) ||
           (head[0] === 0xD0 && head[1] === 0xCF);
  }

  async function importFile(file, importStatusEl) {
    const fileName = file.name;
    if (importStatusEl) setImportStatus(importStatusEl, "checking");

    // 优先：直接解析（未加密 Excel 可离线、无依赖、不受设备限制）
    try {
      const buf = await file.arrayBuffer();
      parseBuffer(buf, fileName, importStatusEl);
      return;
    } catch (directErr) {
      // 直接解析失败 → 多为加密文件，尝试本地解密服务（可选增强，失败不致命）
      const looksEnc = await isEncryptedFile(file).catch(() => true);
      if (!looksEnc) {
        App.toast(`文件解析失败：${directErr.message}`, "err", 8000);
        if (importStatusEl) setImportStatus(importStatusEl, "error", fileName);
        return;
      }
    }

    // 仅当判断为加密文件时才尝试解密服务
    try {
      const blob = await tryDecrypt(file);
      if (blob.size === 0) throw new Error("解密返回空文件");
      const dbuf = await blob.arrayBuffer();
      if (!looksLikeExcel(dbuf)) throw new Error("解密结果不是有效的 Excel 文件");
      parseBuffer(dbuf, fileName, importStatusEl);
    } catch (decryptErr) {
      const msg = decryptErr.message.includes("Failed to fetch")
        ? "无法连接解密服务——本系统以未加密 Excel 为主，无需该服务即可离线使用"
        : decryptErr.message;
      App.toast(`导入失败：${msg}`, "err", 9000);
      if (importStatusEl) setImportStatus(importStatusEl, "error", fileName);
    }
  }

  function parseBuffer(arrayBuffer, fileName, importStatusEl) {
    try {
      const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array", cellDates: true });
      const model = parseWorkbook(wb, fileName);
      App.S.base = model;
      App.S.importedInfo = { name: fileName, time: new Date().toLocaleString("zh-CN") };
      App.S.binding = { fileName, time: new Date().toISOString() };
      try { localStorage.setItem("mes-binding-v1", JSON.stringify(App.S.binding)); } catch (e) { }
      App.persistImported();
      App.rebuild();
      // 成功：完全静默，仅更新状态指示器
      if (importStatusEl) setImportStatus(importStatusEl, "success", fileName);
      // 自动同步到云端（若已部署 Functions + KV）；同步失败不影响本地，仍自动下载 mes-data.js 供手动固化
      syncToCloud(true).then(ok => {
        if (!ok) { try { exportDataJs(); } catch (e) { } }
      });
    } catch (err) {
      console.error(err);
      App.toast(`导入失败：${err.message}`, "err");
      if (importStatusEl) setImportStatus(importStatusEl, "error", fileName);
    }
  }

  /* ================= 导出 ================= */
  /* 同步当前数据到云端（Cloudflare Pages Functions + KV）
   * 成功则所有电脑打开网页都会读到这份数据；失败（离线/未配置）时静默，
   * 数据仍保存在本地 localStorage，可后续手动点击「同步到云端」重试。
   */
  async function syncToCloud(quiet) {
    try {
      const res = await fetch("api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(App.S.data),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.ok) {
        if (!quiet) App.toast("已同步到云端，任何电脑打开网页即为最新数据", "ok", 4000);
        return true;
      }
      if (!quiet) App.toast(`云端同步失败：${(json && json.error) || res.status}，数据仍保留在本机`, "err", 5000);
      return false;
    } catch (e) {
      if (!quiet) App.toast("云端同步失败（离线或未配置），数据仍保留在本机", "err", 5000);
      return false;
    }
  }

  function exportDataJs() {
    const model = JSON.parse(JSON.stringify(App.S.data));
    // 打上生成时间戳，供 loadPersisted 判断「内置数据是否比本地缓存新」
    if (!model.meta) model.meta = {};
    model.meta.generatedAt = new Date().toISOString();
    model.meta.generatedLabel = new Date().toLocaleString("zh-CN");
    const js = "// 本文件由 MES 平台导出：替换 web/data/mes-data.js 后，所有电脑打开网页都会读取此数据\n"
      + "window.MES_DATA = " + JSON.stringify(model) + ";\n";
    App.download("mes-data.js", "\ufeff" + js, "text/javascript");
    App.toast("已生成新数据文件：请替换 web/data/mes-data.js（内含全部数据，换电脑可直接用）", "warn", 5000);
  }

  function exportWorkbook() {
    const { S } = App;
    const wb = XLSX.utils.book_new();
    const ruleText = { range: "区间", ge: "不小于", le: "不大于", pending: "待定" };
    const srcText = { row: "同排记录", core: "序号推断", manual: "手动添加" };

    /* 使用说明 */
    const info = [
      ["多孔碳数据追溯表（MES 平台导出）"],
      [""],
      ["结构：规格标准 / 原料来料 / 细碎 / 分级 / 除磁 / 混料 / 来料检验 / 追溯关系。"],
      [`批次 ${S.data.batches.length} 条、追溯关系 ${S.data.edges.length} 条、规格 ${S.data.specs.length} 条。`],
      [`导出时间 ${new Date().toLocaleString("zh-CN")}`],
      ["本表可再次拖入网页端「数据管理 → 导入」恢复全部分析视图。"],
    ];
    const shInfo = XLSX.utils.aoa_to_sheet(info);
    shInfo["!cols"] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(wb, shInfo, "使用说明");

    /* 规格标准 */
    const specRows = [["产品类型", "工序", "供方", "指标", "单位", "判定规则", "下限", "上限", "目标值", "规格原文"]];
    for (const sp of S.data.specs) {
      const supplierText = (sp.suppliers && sp.suppliers.length)
        ? sp.suppliers.filter(Boolean).join("、")
        : (sp.supplier || "");
      specRows.push([sp.product, sp.stage, supplierText, sp.metric, sp.unit || "", ruleText[sp.rule] || sp.rule, sp.lower, sp.upper, sp.target, sp.raw]);
    }
    const shSpec = XLSX.utils.aoa_to_sheet(specRows);
    shSpec["!cols"] = [{ wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, shSpec, "规格标准");

    /* 工序表 */
    const ID_HEAD = { "原料来料": "投料批号", "细碎": "细碎批号", "分级": "分级批号", "除磁": "除磁批号", "混料": "混料批号" };
    for (const stage of App.STAGES) {
      const def = App.STAGE_FIELDS[stage];
      const unitOf = k => S.units.get(k) || "";
      const head = [ID_HEAD[stage], "产品类型"];
      if (SRC_COL[stage]) head.push(SRC_COL[stage]);
      head.push(def.dateLabel);
      for (const [k, u] of def.weights) head.push(u ? `${k}(${u})` : k);
      for (const m of def.metrics) {
        if (App.TEXT_METRICS.has(m)) { head.push(m); continue; }
        const u = unitOf(m);
        head.push(u ? `${m}(${u})` : m);
      }
      head.push("判定", "不合格项", "备注");
      const rows = [head];
      const list = S.data.batches.filter(b => b.stage === stage).sort(App.cmpBatch);
      for (const b of list) {
        const parents = (S.parentsOf.get(b.id) || []).join("、");
        const r = [b.id, b.product];
        if (SRC_COL[stage]) r.push(parents);
        r.push(b.date || "");
        for (const [k] of def.weights) r.push(b.weights?.[k] ?? null);
        for (const m of def.metrics) r.push(b.metrics?.[m] ?? null);
        r.push(b.verdict, (b.fails || []).join("、"), b.remark || "");
        rows.push(r);
      }
      const sh = XLSX.utils.aoa_to_sheet(rows);
      sh["!cols"] = head.map((h, i) => ({ wch: i === 0 ? 32 : (SRC_COL[stage] === h ? 36 : Math.max(9, h.length * 1.6)) }));
      XLSX.utils.book_append_sheet(wb, sh, stage);
    }

    /* 来料检验 */
    const insp = S.data.inspection || [];
    if (insp.length) {
      const mets = [...new Set(insp.flatMap(r => Object.keys(r.metrics || {})))];
      const head = ["来料日期", "批次号", "重量(kg)", "取样日期", "送检批号", ...mets, "判定", "不合格项"];
      const rows = [head];
      for (const r of insp) {
        rows.push([r.date, r.lot, r.weight, r.sampleDate, r.inspectBatch, ...mets.map(m => r.metrics?.[m] ?? null), r.verdict, (r.fails || []).join("、")]);
      }
      const sh = XLSX.utils.aoa_to_sheet(rows);
      sh["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 9 }, { wch: 12 }, { wch: 30 }, ...mets.map(() => ({ wch: 10 })), { wch: 7 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, sh, "来料检验");
    }

    /* 追溯关系 */
    const eRows = [["父批号", "父工序", "子批号", "子工序", "关系来源"]];
    for (const e of S.data.edges) {
      eRows.push([e.from, S.byId.get(e.from)?.stage || "?", e.to, S.byId.get(e.to)?.stage || "?", srcText[e.source] || e.source]);
    }
    const shE = XLSX.utils.aoa_to_sheet(eRows);
    shE["!cols"] = [{ wch: 34 }, { wch: 9 }, { wch: 34 }, { wch: 9 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, shE, "追溯关系");

    XLSX.writeFile(wb, `多孔碳数据追溯表-导出${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.xlsx`);
    App.toast("Excel 工作簿已导出");
  }

  function resetImported() {
    if (!App.S.importedInfo) return;
    if (!confirm("恢复为内置数据？（手动录入的数据保留）")) return;
    App.S.base = window.MES_DATA;
    App.S.importedInfo = null;
    App.persistImported();
    App.rebuild();
    App.toast("已恢复内置数据");
  }
  function clearManual() {
    if (!App.S.manual.length) { App.toast("没有手动数据", "warn"); return; }
    if (!confirm(`清空全部 ${App.S.manual.length} 条手动录入数据？`)) return;
    App.S.manual = [];
    App.persistManual();
    App.rebuild();
    App.toast("手动数据已清空");
  }

  /* ================= 视图装配 ================= */

  async function checkDecryptStatus(statusEl) {
    try {
      // 直接试 POST（和真实解密相同的请求），验证服务在线
      const url = await ensureDecryptUrl();
      const form = new FormData();
      form.append("deleteFlag", "0");
      const resp = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
      // 任何 HTTP 响应都说明服务可达
      statusEl.className = "ld-status ld-online";
      statusEl.textContent = "服务 ✓ 在线";
    } catch (e) {
      statusEl.className = "ld-status ld-offline";
      statusEl.textContent = "服务 ✗ 不在线";
    }
  }

  /* 文件导入结果状态指示（绿色=成功 / 红色=失败 / 灰色=未上传） */
  function setImportStatus(statusEl, state, fileName) {
    if (!statusEl) return;
    if (state === "success") {
      statusEl.className = "ld-status ld-online";
      statusEl.textContent = `✓ ${fileName || "已读取"}`;
    } else if (state === "error") {
      statusEl.className = "ld-status ld-error";
      statusEl.textContent = `✗ 读取失败${fileName ? "：" + fileName : ""}`;
    } else {
      // idle / checking → 灰色（未上传）
      statusEl.className = "ld-status ld-offline";
      statusEl.textContent = "未上传文件";
    }
  }
function importFromClipboard(text, importStatusEl) {
    let raw = (text || "").trim();
    if (!raw) { App.toast("请先在 Excel 中运行 ExportForMES 宏，然后粘贴到这里。", "warn"); return; }
    const prefix = "MES_IMPORT ";
    if (raw.startsWith(prefix)) raw = raw.substring(prefix.length);
    if (raw.startsWith("MES_IMPORT")) raw = raw.substring("MES_IMPORT".length).trim();
    let json;
    try { json = JSON.parse(raw); } catch (e) {
      App.toast("剪贴板数据格式错误，请确认已运行 ExportForMES 宏。", "err"); return;
    }
    if (importStatusEl) setImportStatus(importStatusEl, "checking");
    try {
      const wb = XLSX.utils.book_new();
      for (const [sn, rows] of Object.entries(json)) {
        if (!Array.isArray(rows) || rows.length === 0) continue;
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sn);
      }
      const model = parseWorkbook(wb, "剪贴板导入");
      App.S.base = model;
      App.S.importedInfo = { name: "剪贴板导入", time: new Date().toLocaleString("zh-CN") };
      App.persistImported();
      App.rebuild();
      const sheetCount = Object.keys(json).length;
      App.toast(`导入成功：${sheetCount} 个工作表，批次 ${model.batches.length} 条、关系 ${model.edges.length} 条`, "info");
      if (importStatusEl) setImportStatus(importStatusEl, "success", "剪贴板导入");
    } catch (err) {
      console.error(err);
      App.toast(`剪贴板解析失败：${err.message}`, "err");
      if (importStatusEl) setImportStatus(importStatusEl, "error", "剪贴板解析");
    }
  }

  function buildClipboardImportCard(importStatus) {
    // 设置 max-height：内容多时给个上限，避免按钮被推出视口
    const pasteArea = App.el("div", {
      class: "paste-target",
      contenteditable: "true",
      style: "min-height:80px;max-height:280px;border:2px dashed var(--line-2);border-radius:8px;padding:12px;font-size:11px;font-family:var(--mono);color:var(--ink-3);outline:none;cursor:text;resize:vertical;overflow-y:auto",
    }, "点击此处后按 Ctrl+V 粘贴 Excel VBA 导出的剪贴板数据");
    pasteArea.addEventListener("focus", () => {
      if (pasteArea.textContent.trim() === "点击此处后按 Ctrl+V 粘贴 Excel VBA 导出的剪贴板数据") {
        pasteArea.textContent = ""; pasteArea.style.color = "var(--ink-1)";
      }
    });
    pasteArea.addEventListener("blur", () => {
      if (!pasteArea.textContent.trim()) {
        pasteArea.textContent = "点击此处后按 Ctrl+V 粘贴 Excel VBA 导出的剪贴板数据";
        pasteArea.style.color = "var(--ink-3)";
      }
    });
    const btn = App.el("button", { class: "btn sm", style: "margin-top:10px; align-self:flex-start" }, "解析并导入");
    btn.addEventListener("click", () => {
      importFromClipboard(pasteArea.textContent, importStatus);
    });
    const hint = App.el("div", { class: "hint small muted", style: "margin-top:8px;line-height:1.6" },
      "1. Excel 打开加密文件 → Alt+F8 → 运行 ExportForMES 宏",
      App.el("br"),
      "2. 回到页面 → 点击上方灰色区域 → Ctrl+V → 点击「解析并导入」",
      App.el("br"),
      "3. 数据通过 Excel 剪贴板传输到网页");
    return App.el("div", { class: "card" },
      App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "clipboard" }), "从 Excel 剪贴板导入")),
      App.el("div", { class: "card-body" }, pasteArea, btn, hint));
  }
  function render(root) {
    const { S } = App;

    const entryCard = App.el("div", { class: "card" });
    renderEntry(entryCard);

    /* 导入卡片 */
    // 支持的格式后缀（SheetJS 兼容的电子表格格式）
    const ACCEPT_FORMATS = ".xlsx,.xlsm,.xlsb,.xls,.csv,.ods,.txt";
    const fileIn = App.el("input", { type: "file", accept: ACCEPT_FORMATS, style: "display:none" });
    const dz = App.el("div", { class: "dropzone" },
      App.el("div", {}, App.el("i", { "data-lucide": "file-spreadsheet" })),
      App.el("div", { class: "dz-title" }, "拖入工作簿文件，或点击选择"),
      App.el("div", { class: "dz-sub" }, "加密文件上传后自动解密解析（离线操作，不上传）"),
      App.el("div", { class: "dz-formats" },
        App.el("span", { class: "fmt-pill" }, ".xlsx"),
        App.el("span", { class: "fmt-pill" }, ".xlsm"),
        App.el("span", { class: "fmt-pill" }, ".xlsb"),
        App.el("span", { class: "fmt-pill" }, ".xls"),
        App.el("span", { class: "fmt-pill" }, ".csv"),
        App.el("span", { class: "fmt-pill" }, ".ods"),
        App.el("span", { class: "fmt-pill" }, ".txt"),
        App.el("span", { class: "fmt-hint" }, "等电子表格文件")));
    // 文件导入结果状态指示（初态：若已有上次导入记录则显示成功，否则显示未上传）
    const importStatus = App.el("span", { class: "ld-status ld-checking" }, "未上传文件");
    setImportStatus(importStatus, S.importedInfo ? "success" : "idle", S.importedInfo ? S.importedInfo.name : null);
    dz.addEventListener("click", () => fileIn.click());
    dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("over"));
    dz.addEventListener("drop", e => {
      e.preventDefault(); dz.classList.remove("over");
      const f = e.dataTransfer.files[0];
      if (f) importFile(f, importStatus);
    });
    fileIn.addEventListener("change", () => {
      if (fileIn.files[0]) importFile(fileIn.files[0], importStatus);
      fileIn.value = "";
    });
    const srcLine = App.el("div", { class: "small", style: "margin-top:10px; color:var(--ink-2)" },
      `当前数据源：${S.importedInfo ? `导入文件 ${S.importedInfo.name}（${S.importedInfo.time}）` : "内置数据（随页面分发）"}`);
    const importCard = App.el("div", { class: "card" },
      App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "upload" }), "从 Excel 导入")),
      App.el("div", { class: "card-body" }, dz, fileIn, importStatus, srcLine,
        App.el("div", { style: "margin-top:10px" },
          App.el("button", { class: "btn sm",
            onclick: () => {
              if (!S.importedInfo) return;
              if (!confirm("恢复为内置数据？（手动录入的数据保留）")) return;
              App.S.base = window.MES_DATA;
              App.S.importedInfo = null;
              App.persistImported();
              App.rebuild();
              setImportStatus(importStatus, "idle");
              // 更新底部"当前数据源"文字
              srcLine.textContent = `当前数据源：内置数据（随页面分发）`;
              App.toast("已恢复内置数据");
            },
            disabled: S.importedInfo ? null : "disabled" },
            App.el("i", { "data-lucide": "rotate-ccw" }), "恢复内置数据"))));

    // ---- 剪贴板导入卡（亦使用同一状态指示器）----
    const clipCard = buildClipboardImportCard(importStatus);

    /* 迁移包输入（隐藏） */
    const migrateFileIn = App.el("input", { type: "file", accept: ".json,application/json", style: "display:none" });
    migrateFileIn.addEventListener("change", () => {
      const f = migrateFileIn.files[0];
      if (f) App.importPackage(f);
      migrateFileIn.value = "";
    });

    /* 导出卡片 */
    const exportCard = App.el("div", { class: "card" },
      App.el("div", { class: "card-head" }, App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "download" }), "导出 / 归档")),
      App.el("div", { class: "card-body", style: "display:flex; flex-direction:column; gap:10px" },
        App.el("div", { class: "grid", style: "grid-template-columns:1fr 1fr; gap:10px" },
          App.el("button", { class: "btn", onclick: () => App.exportPackage() }, App.el("i", { "data-lucide": "package" }), "导出迁移包"),
          App.el("button", { class: "btn", onclick: () => migrateFileIn.click() }, App.el("i", { "data-lucide": "package-import" }), "导入迁移包")),
        App.el("button", { class: "btn", onclick: exportWorkbook }, App.el("i", { "data-lucide": "file-spreadsheet" }), "导出 Excel 工作簿（含手动数据）"),
        App.el("button", { class: "btn", onclick: () => syncToCloud(false) }, App.el("i", { "data-lucide": "cloud-upload" }), "同步到云端（所有电脑生效）"),
        App.el("button", { class: "btn", onclick: exportDataJs }, App.el("i", { "data-lucide": "file-json" }), "下载数据文件 mes-data.js"),
        App.el("div", { class: "hint small muted", style: "line-height:1.7" },
          "· 迁移包（JSON）：含手动录入 + 基础数据 + 主题 + 自定义规则 + 控制限 + 数据源绑定，是真正可任意复制到其他设备、不受浏览器本地存储限制的方案。", App.el("br"),
          "· Excel 工作簿：用于车间继续录入，可再次拖回网页刷新数据。", App.el("br"),
          "· 同步到云端：需站点已部署 Pages Functions + KV 绑定；成功后任何电脑打开网页即为最新数据。", App.el("br"),
          "· mes-data.js：替换 web/data/ 同名文件后，网页打开即是新数据。"),
        App.el("button", { class: "btn danger", onclick: clearManual }, App.el("i", { "data-lucide": "trash-2" }), "清空手动录入数据")));

    /* 手动数据列表 */
    const manualTbody = App.el("tbody");
    const manualCount = App.el("span", { class: "muted small" });
    const manualCard = App.el("div", { class: "card" },
      App.el("div", { class: "card-head" },
        App.el("div", { class: "card-title" }, App.el("i", { "data-lucide": "list-checks" }), "手动录入记录"),
        manualCount),
      App.el("div", { class: "tbl-wrap" },
        App.el("table", { class: "tbl" },
          App.el("thead", {}, App.el("tr", {},
            App.el("th", {}, "批号"), App.el("th", {}, "工序"), App.el("th", {}, "产品"), App.el("th", {}, "日期"), App.el("th", {}, "内容"), App.el("th", {}, "操作"))),
          manualTbody)));

    const leftCol = App.el("div", { class: "grid", style: "gap:16px" }, entryCard, manualCard);
    const rightCol = App.el("div", { class: "grid", style: "gap:16px" }, importCard, clipCard, exportCard);
    root.append(
      App.el("div", { class: "grid", style: "grid-template-columns: 1.5fr 1fr; align-items:start" }, leftCol, rightCol),
      migrateFileIn,
    );
    renderManualList(manualTbody, manualCount);
    App.refreshIcons();
  }

  return { render };
})();
