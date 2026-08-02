/* ============================================================
 * 多孔碳 MES 数据追溯平台 - 核心
 * 状态管理 / 数据合并 / 品质判定 / 路由 / 批次抽屉 / 全局搜索
 * 纯静态、离线可用（file:// 直接打开）
 * ============================================================ */
"use strict";

window.Views = window.Views || {};

const App = (() => {

  /* ---------- 常量 ---------- */
  const STAGES = ["原料来料", "细碎", "分级", "除磁", "混料"];
  const VERDICT_CLASS = { "合格": "ok", "不合格": "bad", "未检": "none" };
  const STAGE_COLOR = { "原料来料": "#8b5cf6", "细碎": "#2563eb", "分级": "#0d9488", "除磁": "#d97706", "混料": "#e11d48" };
  const LS_MANUAL = "mes-manual-v1";
  const LS_IMPORTED = "mes-imported-v1";
  const LS_THEME = "mes-theme-v1";
  const LS_CUSTOM = "mes-custom-v1";     // 鱼骨图原因标注 / 改进报告备注等用户自定义内容
  const LS_CTL = "mes.controlLimits.v1"; // 与 MESControl 共用键

  /* 工序录入/导出字段定义（与优化版工作簿列结构一致） */
  const STAGE_FIELDS = {
    "原料来料": {
      dateLabel: "来料日期",
      weights: [["来料数量", "kg"], ["初始重量", "g"], ["20目上", "g"], ["20~35目", "g"], ["35~50目", "g"], ["50~80目", "g"], ["80目下", "g"]],
      metrics: ["供方名称", "振实", "比表面积", "孔容", "孔径", "微孔率", "灰分", "挥发分", "水分", "氧含量", "pH", "磁性总量"],
    },
    "细碎": {
      dateLabel: "加工日期",
      weights: [["投料重量", "kg"], ["出料重量", "kg"], ["产能", "kg/h"]],
      metrics: ["Dmin", "D10", "D50", "D90", "D99", "Dmax", "振实", "松装", "比表面积", "孔容", "孔径", "微孔率", "水分", "磁性总量"],
    },
    "分级": {
      dateLabel: "加工日期",
      weights: [["产出重量", "kg"], ["F3重量", "kg"], ["收率", "%"], ["产能", "kg/h"]],
      metrics: ["Dmin", "D10", "D50", "D90", "D99", "Dmax", "比表面积", "孔容", "孔径", "微孔率", "磁性总量", "水分"],
    },
    "除磁": {
      dateLabel: "加工日期",
      weights: [["出料重量", "kg"], ["励磁物重量", "g"], ["收率", "%"]],
      metrics: ["Dmin", "D10", "D50", "D90", "D99", "Dmax", "水分", "磁性总量"],
    },
    "混料": {
      dateLabel: "混料日期",
      weights: [["产出重量", "kg"], ["收率", "%"]],
      metrics: ["Dmin", "D10", "D50", "D90", "D99", "Dmax", "比表面积", "孔容", "孔径", "微孔率", "磁性总量", "振实", "松装", "真密度", "灰分", "挥发分", "水分", "pH"],
    },
  };
  const TEXT_METRICS = new Set(["供方名称", "设备号"]);
  const METRIC_ORDER = ["Dmin", "D10", "D50", "D90", "D99", "Dmax", "振实", "松装", "真密度", "比表面积",
    "孔容", "孔径", "微孔率", "磁性总量", "水分", "灰分", "挥发分", "氧含量", "pH"];

  /* ---------- 状态 ---------- */
  const S = {
    base: null,            // 基础数据集（内置或导入）
    baseLabel: "",
    importedInfo: null,    // {name, time}
    manual: [],            // 手动录入批次
    data: null,            // 合并计算后的模型
    byId: new Map(),
    parentsOf: new Map(),
    childrenOf: new Map(),
    specIdx: new Map(),    // "product|stage|metric" -> spec
    units: new Map(),      // metric -> unit
    view: "dashboard",
    product: "全部",
    charts: [],
    theme: "light",
    customRules: {},   // { "<defectKey>": { causes:{人:"",机:"",料:"",法:"",环:""}, note:"" } }
    binding: null,      // { fileName, time } 绑定/最近使用的 Excel 数据源
  };

  const NAV = [
    { id: "dashboard", name: "总览看板", icon: "layout-dashboard" },
    { id: "batches",   name: "批次数据", icon: "database" },
    { id: "trace",     name: "批次追溯", icon: "workflow" },
    { id: "quality",   name: "质量分析", icon: "flask-conical" },
    { id: "specs",     name: "规格与检验", icon: "clipboard-list" },
    { id: "data",      name: "数据管理", icon: "hard-drive-upload" },
  ];

  /* ---------- 工具 ---------- */
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "style") n.style.cssText = v;
      else n.setAttribute(k, v);
    }
    for (const c of children.flat(9)) {
      if (c == null) continue;
      n.append(c.nodeType ? c : document.createTextNode(c));
    }
    return n;
  }
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  function fmt(v, d = 4) {
    if (v == null || v === "") return "—";
    if (typeof v !== "number") return String(v);
    if (!isFinite(v)) return "—";
    const r = Math.round(v * 10 ** d) / 10 ** d;
    return String(r);
  }
  const fmtPct = v => (typeof v === "number" && isFinite(v)) ? (v * 100).toFixed(2) + "%" : "—";
  const round4 = v => Math.round(v * 10000) / 10000;

  /* 检测项目的精度规则（按用户要求）
   * 重量kg → 整数位
   * 振实 → 3 位有效数字
   * 比表面积 → 整数位
   * 孔容 / 孔径 → 3 位有效数字
   * 微孔率 / 灰分 / 挥发分 / 水分 / 氧含量 / pH → 2 位有效数字
   * 磁性总量 → 3 位有效数字
   */
  const METRIC_FMT = {
    "重量kg": "int", "重量": "int", "来料数量": "int",
    "振实": 3,
    "比表面积": "int",
    "孔容": 3,
    "孔径": 3,
    "微孔率": 2,
    "灰分": 2,
    "挥发分": 2,
    "水分": 2,
    "氧含量": 2,
    "pH": 2,
    "磁性总量": 3,
  };
  function fmtSig(v, sig) {
    if (v == null || v === "" || typeof v !== "number" || !isFinite(v)) return "—";
    if (sig === "int") return String(Math.round(v));
    // sig 位有效数字
    if (v === 0) return "0";
    return String(parseFloat(v.toPrecision(sig)));
  }
  function fmtMetric(metric, v) {
    if (metric == null) return fmtPct(v);  // 收率
    // 兼容带单位的 metric 名（去掉括号内容）
    const key = String(metric).replace(/[(（].*$/, "").trim();
    if (key === "收率" || /收率/.test(key)) return fmtPct(v);
    const rule = METRIC_FMT[key];
    if (rule) return fmtSig(v, rule);
    return fmt(v, 4);
  }
  /* 从规格原文或指标名中推断单位 */
  // 统一输出普通数字写法（m2/g、cm3/g），由 renderUnit + .unit-sup 做视觉上的标，
  // 避免 Unicode 上标字符 ²/³ 在不同字体间 fallback 导致视觉不一致
  function normalizeUnit(u) {
    if (!u) return "";
    const map = {
      "cm3/g": "cm3/g", "cm^3/g": "cm3/g",
      "m2/g": "m2/g", "m^2/g": "m2/g",
      "um": "μm",
      "g/cm3": "g/cm3", "g/cm^3": "g/cm3",
    };
    const key = String(u).trim().toLowerCase().replace(/\s+/g, "");
    return map[key] || String(u).trim().replace(/²/g, "2").replace(/³/g, "3");
  }
  function extractUnit(raw, metric) {
    if (!raw && !metric) return "";
    if (!raw) {
      const m = String(metric || "").match(/[（(]([^)）]+)[)）]$/);
      return m ? normalizeUnit(m[1]) : "";
    }
    let s = String(raw).trim();
    // 去掉开头比较符号（如 ≥4μm 中的 ≥）
    s = s.replace(/^[≥≤><]\s*/, "");
    // 去掉开头数值范围（如 0.79±0.03、8±1、0.79~0.82）
    s = s.replace(/^\d+(?:\.\d+)?\s*[±+\-～~—]\s*\d+(?:\.\d+)?/, "");
    // 去掉开头单个数值（如 4μm 中的 4、85% 中的 85）
    s = s.replace(/^\d+(?:\.\d+)?/, "");
    // 去掉括号与空白
    s = s.replace(/[()\[\]\s]/g, "");
    if (!s && metric) {
      const m = String(metric).match(/[（(]([^)）]+)[)）]$/);
      if (m) s = m[1];
    }
    return normalizeUnit(s);
  }
  function refreshIcons() { if (window.lucide) lucide.createIcons(); }
  function download(name, content, mime = "text/plain") {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ";charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function toast(msg, type = "ok") {
    const icons = { ok: "check-circle-2", err: "alert-circle", warn: "alert-triangle" };
    const t = el("div", { class: `toast ${type}` }, el("i", { "data-lucide": icons[type] || "info" }), el("span", {}, msg));
    $("#toastRoot").append(t); refreshIcons();
    // 使用 GSAP 动效；若不可用则回退到 CSS
    if (window.MESAnimate) MESAnimate.toastIn(t);
    setTimeout(() => {
      if (window.MESAnimate) MESAnimate.toastOut(t, () => t.remove());
      else { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 320); }
    }, 3200);
  }
  function coreOf(id) { const m = String(id || "").match(/\d{6,}/); return m ? m[0] : null; }
  function baseOf(id) { return String(id || "").trim().replace(/(-F)?-\d+$/, ""); }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  function verdictPill(v) { return el("span", { class: `pill ${VERDICT_CLASS[v] || "none"}` }, v || "未检"); }

  /* ---------- 判定 ---------- */
  function judgeVal(v, spec) {
    if (typeof v !== "number" || !isFinite(v) || !spec) return null;
    if (spec.rule === "pending") return null; // 待定指标不参与判定
    if (spec.lower == null && spec.upper == null) return null;
    if (spec.lower != null && v < spec.lower - 1e-12) return false;
    if (spec.upper != null && v > spec.upper + 1e-12) return false;
    return true;
  }
  function supplierOf(b) {
    // 供方可能存于批次顶层 supplier 字段（导入数据）或 metrics["供方名称"]（手动录入）
    const s = b.supplier || (b.metrics || {})["供方名称"];
    return s ? String(s).trim() : "";
  }
  function batchSupplier(b) {
    // 原料来料批次直接取供方名称；下游批次沿追溯链找到上游原料来料批次的供方
    const direct = supplierOf(b);
    if (direct) return direct;
    const seen = new Set();
    const queue = [b.id];
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const pid of (S.parentsOf.get(id) || [])) {
        const pb = S.byId.get(pid);
        if (!pb) continue;
        if (pb.stage === "原料来料") {
          const s = supplierOf(pb);
          if (s) return s;
        }
        queue.push(pid);
      }
    }
    return "";
  }

  /* ---------- 设备号转换（从批号中提取设备号） ---------- */
  // 批号中含 S1/S2 → 除磁设备 S001/S002
  // S3-S6 → 粉碎设备 S003-S006
  // S7/S8 → 分级设备 J001/J002
  // S9/SA → 混料设备 M001/M002
  const DEVICE_MAP = {
    "S1": { code: "S001", category: "除磁", name: "除磁" },
    "S2": { code: "S002", category: "除磁", name: "除磁" },
    "S3": { code: "S003", category: "粉碎", name: "粉碎" },
    "S4": { code: "S004", category: "粉碎", name: "粉碎" },
    "S5": { code: "S005", category: "粉碎", name: "粉碎" },
    "S6": { code: "S006", category: "粉碎", name: "粉碎" },
    "S7": { code: "J001", category: "分级", name: "分级" },
    "S8": { code: "J002", category: "分级", name: "分级" },
    "S9": { code: "M001", category: "混料", name: "混料" },
    "SA": { code: "M002", category: "混料", name: "混料" },
  };
  const DEVICE_LIST = Object.entries(DEVICE_MAP).map(([raw, info]) => ({ raw, ...info }));
  function batchDevice(b) {
    const id = typeof b === "string" ? b : (b && b.id) || "";
    const m = id.match(/S([0-9A])(?![0-9A-Za-z])/i);
    if (!m) return null;
    const key = "S" + m[1].toUpperCase();
    return DEVICE_MAP[key] ? { ...DEVICE_MAP[key], raw: key } : null;
  }
  function lookupSpec(product, stage, metric, supplier) {
    if (!product || !stage || !metric) return null;
    const s = (supplier || "").trim();
    return S.specIdx.get(`${product}|${stage}|${s}|${metric}`)
      || S.specIdx.get(`${product}|${stage}||${metric}`)
      || null;
  }
  function effectiveSpec(b, metric) {
    const supplier = batchSupplier(b);
    return lookupSpec(b.product, b.stage, metric, supplier);
  }
  function computeVerdict(b) {
    const fails = []; let judged = 0;
    for (const [k, v] of Object.entries(b.metrics || {})) {
      const sp = effectiveSpec(b, k);
      const j = judgeVal(v, sp);
      if (j === false) fails.push(k);
      if (j !== null) judged++;
    }
    b.fails = fails;
    b.verdict = fails.length ? "不合格" : (judged ? "合格" : "未检");
  }

  /* ---------- 数据装配 ---------- */
  function rebuild() {
    const base = S.base;
    // 深拷贝，避免手工数据污染内置数据
    const data = JSON.parse(JSON.stringify(base));
    const byId = new Map(data.batches.map(b => [b.id, b]));

    // 来料检验派生：当 data.inspection 为空或不存在时，
    // 从原料来料批次自动派生出对应的检验记录（每个投料批号 + 固定的 11 个检测项）
    if (!Array.isArray(data.inspection) || data.inspection.length === 0) {
      const insp = [];
      const FIXED_METRICS = ["振实", "比表面积", "孔容", "孔径", "微孔率", "灰分", "挥发分", "水分", "氧含量", "pH", "磁性总量"];
      for (const b of (data.batches || [])) {
        if (b.stage !== "原料来料") continue;
        const m = b.metrics || {};
        // 仅保留固定的 11 个检测项目（其他列忽略）
        const recMetrics = {};
        for (const k of FIXED_METRICS) recMetrics[k] = m[k] != null ? m[k] : null;
        const w = m["来料数量"] ?? m["来料重量"] ?? null;
        const date = b.date || null;
        insp.push({
          date, lot: b.id, weight: w, sampleDate: date,
          inspectBatch: b.id, metrics: recMetrics,
          verdict: "未检", fails: [],
        });
      }
      data.inspection = insp;
    }

    // 合并手动录入
    const danglingParents = [];
    for (const m of S.manual) {
      let b = byId.get(m.id);
      if (b) {
        Object.assign(b.metrics, m.metrics);
        Object.assign(b.weights, m.weights);
        if (m.date) b.date = m.date;
        if (m.remark) b.remark = [b.remark, m.remark].filter(Boolean).join("；").slice(0, 200);
        b.records.push({ date: m.date || undefined, metrics: { ...m.metrics }, weights: { ...m.weights } });
        b.recordCount = b.records.length;
        b.manualTouched = true;
      } else {
        b = {
          id: m.id, stage: m.stage, product: m.product,
          base: baseOf(m.id), core: coreOf(m.id),
          records: [{ date: m.date || undefined, metrics: { ...m.metrics }, weights: { ...m.weights } }],
          metrics: { ...m.metrics }, weights: { ...m.weights },
          date: m.date || null, remark: m.remark || "", recordCount: 1, manual: true,
        };
        data.batches.push(b); byId.set(b.id, b);
      }
      const seen = new Set(data.edges.map(e => `${e.from}|||${e.to}`));
      for (const p of m.parents || []) {
        if (p === m.id) continue;
        if (!byId.has(p)) { danglingParents.push(p); continue; }
        if (!seen.has(`${p}|||${m.id}`)) { data.edges.push({ from: p, to: m.id, source: "manual" }); seen.add(`${p}|||${m.id}`); }
      }
    }
    data.meta.batchCount = data.batches.length;
    data.meta.edgeCount = data.edges.length;
    data.meta.manualCount = S.manual.length;
    data.meta.danglingParents = danglingParents;

    // 索引（规格表同时兼容中文键「产品类型/工序/指标/下限/上限/目标值」与英文键，导入数据亦可）
    S.data = data; S.byId = byId;
    S.specIdx = new Map(); S.units = new Map();
    const pick = (o, en, zh) => (o[en] != null ? o[en] : o[zh]);
    const toNum = v => {
      if (v == null || v === "" || v === "—" || v === "-") return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    };
    const splitSupplier = v => {
      const s = String(v || "").trim();
      if (!s) return [""];
      return [...new Set(s.split(/[,，、]/).map(x => x.trim()).filter(Boolean))];
    };
    for (const raw of (data.specs || [])) {
      const lo = toNum(pick(raw, "lower", "下限"));
      const hi = toNum(pick(raw, "upper", "上限"));
      const tg = toNum(pick(raw, "target", "目标值"));
      const rule = pick(raw, "rule", "判定规则") || null;
      // 生成人类可读的规格描述字符串（用于批次详情弹窗"规格"列）
      let rawDesc = "—";
      if (rule === "pending" || String(rule).trim() === "待定") rawDesc = "待定";
      else if (lo != null && hi != null) rawDesc = `${lo} ~ ${hi}`;
      else if (lo != null) rawDesc = `≥ ${lo}`;
      else if (hi != null) rawDesc = `≤ ${hi}`;
      // 用户要求：规格只显示范围值（lo ~ hi），不显示目标值
      const suppliers = Array.isArray(raw.supplier)
        ? [...new Set(raw.supplier.map(String).map(s => s.trim()).filter(Boolean))]
        : splitSupplier(pick(raw, "supplier", "供方") || pick(raw, "supplier", "供方名称"));
      const spBase = {
        product: pick(raw, "product", "产品类型"),
        stage: pick(raw, "stage", "工序"),
        metric: pick(raw, "metric", "指标"),
        unit: pick(raw, "unit", "单位") || extractUnit(pick(raw, "raw", "规格原文"), pick(raw, "metric", "指标")) || null,
        lower: rule === "pending" ? null : lo,
        upper: rule === "pending" ? null : hi,
        target: rule === "pending" ? null : tg,
        rule: rule,
        raw: rawDesc,
      };
      if (!spBase.product || !spBase.stage || !spBase.metric) continue;
      // 保存原始供方列表，便于导出/展示时合并回"GY、XT"
      spBase.suppliers = suppliers.length ? suppliers : [""];
      spBase.supplier = suppliers.length === 1 ? suppliers[0] : "";
      for (const s of (suppliers.length ? suppliers : [""])) {
        const sp = { ...spBase, supplier: s };
        S.specIdx.set(`${sp.product}|${sp.stage}|${s}|${sp.metric}`, sp);
      }
      if (spBase.unit && !S.units.has(spBase.metric)) S.units.set(spBase.metric, spBase.unit);
    }
    for (const b of data.batches) computeVerdict(b);
    // 来料检验记录自动判定：当 Excel 判定列缺失或为"未检"时，按规格标准重新判定
    for (const rec of (data.inspection || [])) {
      if (rec.verdict && rec.verdict !== "未检") continue;
      const lot = rec.lot || rec.inspectBatch;
      const fb = lot ? byId.get(lot) : null;
      const product = fb ? fb.product : (data.batches.find(b => b.product)?.product || "树脂基");
      const supplier = (fb && fb.stage === "原料来料" && (fb.metrics || {})["供方名称"])
        ? String(fb.metrics["供方名称"]).trim() : "";
      const fails = [];
      let judged = 0;
      for (const [k, v] of Object.entries(rec.metrics || {})) {
        if (typeof v !== "number" || !isFinite(v)) continue;
        const sp = lookupSpec(product, "原料来料", k, supplier);
        const j = judgeVal(v, sp);
        if (j === false) fails.push(k);
        if (j !== null) judged++;
      }
      rec.fails = fails;
      rec.verdict = fails.length ? "不合格" : (judged ? "合格" : "未检");
    }
    S.parentsOf = new Map(); S.childrenOf = new Map();
    for (const e of data.edges) {
      if (!S.parentsOf.has(e.to)) S.parentsOf.set(e.to, []);
      if (!S.childrenOf.has(e.from)) S.childrenOf.set(e.from, []);
      S.parentsOf.get(e.to).push(e.from);
      S.childrenOf.get(e.from).push(e.to);
    }
    updateChrome();
    render();
    if (danglingParents.length) toast(`有 ${danglingParents.length} 个来源批号不存在，已跳过关联`, "warn");
  }

  /* ---------- 过滤 ---------- */
  function byProduct(list) { return S.product === "全部" ? list : list.filter(b => b.product === S.product); }
  function stageShort(st) { return st; }

  // 批次数量展示：只显示当前批次的产出/来料数量，不组合投料→出料
  function qtyText(b) {
    const w = b.weights || {};
    const f = v => (typeof v === "number") ? fmtMetric("重量", v) : null;
    const qty = (() => {
      switch (b.stage) {
        case "原料来料": return w["来料数量"] ?? w["来料重量"];
        case "细碎": return w["出料重量"];
        case "分级": return w["产出重量"];
        case "除磁": return w["出料重量"];
        case "混料": return w["产出重量"];
        default: return null;
      }
    })();
    return f(qty) ? f(qty) + " kg" : "—";
  }
  function yieldOf(b) {
    const w = b.weights || {};
    if (typeof w["收率"] === "number") return w["收率"];
    if (b.stage === "细碎" && typeof w["投料重量"] === "number" && w["投料重量"] > 0 && typeof w["出料重量"] === "number")
      return w["出料重量"] / w["投料重量"];
    return null;
  }
  const cmpBatch = (a, b) => ((b.date || "").localeCompare(a.date || "")) || a.id.localeCompare(b.id);

  /* ---------- 框架 / 路由 ---------- */
  function disposeCharts() { S.charts.forEach(c => { try { c.dispose(); } catch (e) { } }); S.charts = []; }
  function makeChart(dom, option) {
    const initChart = () => {
      const c = echarts.init(dom, null, { renderer: "canvas" });
      c.setOption(option);
      S.charts.push(c);
      return c;
    };
    const rect = dom.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      // 容器尚未完成布局（如全局切片器展开/折叠瞬间），延迟到下一帧再初始化
      requestAnimationFrame(initChart);
      return null;
    }
    return initChart();
  }
  function resizeCharts() { S.charts.forEach(c => { try { c.resize(); } catch (e) { } }); }
  function setView(v) {
    S.view = v;
    $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === v));
    const nav = NAV.find(n => n.id === v);
    $("#pageTitle").textContent = nav ? nav.name : "";
    render();
  }
  function render() {
    disposeCharts();
    const view = $("#view");
    view.innerHTML = "";
    (Views[S.view] || Views.dashboard).render(view);
    refreshIcons();
    // 动效：仅在 GSAP 可用时启用（不影响性能）
    if (window.MESAnimate) {
      MESAnimate.viewCards(view);
      MESAnimate.btnHover(view);
      MESAnimate.search(view);
      MESAnimate.refresh(view);
    }
    view.scrollTop = 0;
    // 部分视图在初始化时容器可能尚未完成布局，延迟一次 resize 确保图表尺寸正确
    requestAnimationFrame(() => requestAnimationFrame(() => resizeCharts()));
  }

  function updateChrome() {
    const m = S.data.meta;
    const src = S.importedInfo ? `导入：${S.importedInfo.name}` : "内置数据";
    $("#sideFoot").innerHTML =
      `<div><span class="dot"></span>${esc(src)}</div>` +
      `<div>批次 ${m.batchCount} · 关系 ${m.edgeCount}</div>` +
      (m.manualCount ? `<div>手动录入 ${m.manualCount} 条</div>` : "") +
      (S.binding ? `<div>已绑定数据源：${esc(S.binding.fileName)}</div>` : "") +
      `<div style="margin-top:4px">离线模式 · 整包可转移</div>`;
  }

  /* ---------- 批次详情抽屉 ---------- */
  let drawerEls = null;
  function closeDrawer() { if (drawerEls) { drawerEls.mask.remove(); drawerEls.panel.remove(); drawerEls = null; } }
  function openBatchDrawer(id) {
    const b = S.byId.get(id);
    if (!b) { toast(`未找到批次 ${id}`, "err"); return; }
    closeDrawer();
    const mask = el("div", { class: "drawer-mask open", onclick: closeDrawer });
    const panel = el("div", { class: "drawer" });

    const parents = S.parentsOf.get(id) || [];
    const children = S.childrenOf.get(id) || [];

    /* 指标表 */
    const metricRows = Object.entries(b.metrics || {}).map(([k, v]) => {
      const sp = effectiveSpec(b, k);
      const j = judgeVal(v, sp);
      const unit = (sp && sp.unit) || S.units.get(k) || "";
      return el("tr", {},
        el("td", {}, k),
        el("td", { class: "num" }, typeof v === "number" ? fmtMetric(k, v) : String(v)),
        el("td", { class: "muted small" }, unit),
        el("td", { class: "muted small" }, sp ? sp.raw : "—"),
        el("td", {}, j == null ? el("span", { class: "pill none" }, "—") : j ? el("span", { class: "pill ok" }, "合格") : el("span", { class: "pill bad" }, "不合格")),
      );
    });

    const weightRows = Object.entries(b.weights || {})
      .filter(([k]) => k !== "初始重量")
      .map(([k, v]) =>
        el("tr", {}, el("td", {}, k), el("td", { class: "num ctr" }, k === "收率" ? fmtPct(v) : fmtMetric(k, v))));

    const chipOf = (cid, isRoot) => {
      const cb = S.byId.get(cid);
      return el("span", {
        class: `chip${isRoot ? " root" : ""}${cb && cb.verdict === "不合格" ? " bad" : ""}`,
        title: cb ? `${cb.stage} · ${cb.verdict}` : "批次不存在",
        onclick: () => openBatchDrawer(cid),
      }, cid);
    };

    panel.append(
      el("div", { class: "drawer-head" },
        el("div", {},
          el("div", { class: "drawer-title" }, b.id),
          el("div", { class: "drawer-sub" },
            el("span", { class: "pill info" }, b.stage),
            el("span", { class: "pill info" }, b.product),
            verdictPill(b.verdict),
            b.manual ? el("span", { class: "pill warn" }, "手动录入") : null,
            b.manualTouched ? el("span", { class: "pill warn" }, "含补录数据") : null,
          ),
        ),
        el("button", { class: "drawer-close", onclick: closeDrawer }, el("i", { "data-lucide": "x" })),
      ),
      el("div", { class: "drawer-body" },
        el("div", { class: "drawer-sec" },
          el("h4", {}, el("i", { "data-lucide": "info" }), "基本信息"),
          el("dl", { class: "kv" },
            el("dt", {}, "加工日期"), el("dd", {}, b.date || "—"),
            el("dt", {}, "记录次数"), el("dd", {}, String(b.recordCount || 1)),
            el("dt", {}, "不合格项"), el("dd", {}, (b.fails || []).length ? b.fails.join("、") : "—"),
            el("dt", {}, "备注"), el("dd", {}, b.remark || "—"),
          ),
        ),
        weightRows.length ? el("div", { class: "drawer-sec" },
          el("h4", {}, el("i", { "data-lucide": "scale" }), "重量 / 收率"),
          el("div", { class: "tbl-wrap" }, el("table", { class: "tbl" },
            el("thead", {}, el("tr", {}, el("th", {}, "项目"), el("th", { class: "ctr" }, "数值"))),
            el("tbody", {}, weightRows))),
        ) : null,
        metricRows.length ? el("div", { class: "drawer-sec" },
          el("h4", {}, el("i", { "data-lucide": "flask-conical" }), `检测指标（${metricRows.length}）`),
          el("div", { class: "tbl-wrap" }, el("table", { class: "tbl" },
            el("thead", {}, el("tr", {}, el("th", {}, "指标"), el("th", {}, "数值"), el("th", {}, "单位"), el("th", {}, "规格"), el("th", {}, "判定"))),
            el("tbody", {}, metricRows))),
        ) : null,
        el("div", { class: "drawer-sec" },
          el("h4", {}, el("i", { "data-lucide": "arrow-up-from-line" }), `上游来源（${parents.length}）`),
          parents.length ? el("div", {}, parents.map(p => chipOf(p))) : el("div", { class: "muted small" }, "无（链路的起点）"),
        ),
        el("div", { class: "drawer-sec" },
          el("h4", {}, el("i", { "data-lucide": "arrow-down-to-line" }), `下游去向（${children.length}）`),
          children.length ? el("div", {}, children.map(c => chipOf(c))) : el("div", { class: "muted small" }, "无（链路的终点）"),
        ),
      ),
      el("div", { class: "drawer-foot" },
        el("button", {
          class: "btn primary", onclick: () => {
            closeDrawer();
            if (Views.trace && Views.trace.focus) Views.trace.focus(b.id);
            setView("trace");
          }
        }, el("i", { "data-lucide": "workflow" }), "在追溯图中查看"),
        el("button", { class: "btn", onclick: closeDrawer }, "关闭"),
      ),
    );
    document.body.append(mask, panel);
    requestAnimationFrame(() => panel.classList.add("open"));
    refreshIcons();
    drawerEls = { mask, panel };
  }

  /* ---------- 全局搜索 ---------- */
  function initSearch() {
    const input = $("#globalSearch"), drop = $("#searchDrop");
    const doSearch = () => {
      const q = input.value.trim().toUpperCase();
      drop.innerHTML = "";
      if (!q) { drop.classList.remove("open"); return; }
      const hits = [];
      for (const b of S.data.batches) {
        if (b.id.toUpperCase().includes(q)) { hits.push(b); if (hits.length >= 12) break; }
      }
      if (!hits.length) { drop.classList.remove("open"); return; }
      for (const b of hits) {
        drop.append(el("div", {
          class: "search-opt",
          onclick: () => { drop.classList.remove("open"); input.value = ""; openBatchDrawer(b.id); },
        },
          el("span", { class: "bid" }, b.id),
          el("span", { class: "meta" }, `${b.stage} · ${b.verdict}`),
        ));
      }
      drop.classList.add("open");
    };
    input.addEventListener("input", debounce(doSearch, 160));
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { const first = drop.querySelector(".search-opt"); if (first) first.click(); }
      if (e.key === "Escape") { drop.classList.remove("open"); input.blur(); }
    });
    document.addEventListener("click", e => { if (!$("#searchWrap").contains(e.target)) drop.classList.remove("open"); });
  }

  /* ---------- 持久化 ---------- */
  function persistManual() {
    try { localStorage.setItem(LS_MANUAL, JSON.stringify(S.manual)); }
    catch (e) { toast("手动数据保存到本地存储失败（空间不足）", "err"); }
  }
  function persistImported() {
    try {
      if (S.importedInfo) localStorage.setItem(LS_IMPORTED, JSON.stringify({ ...S.importedInfo, model: S.base }));
      else localStorage.removeItem(LS_IMPORTED);
    } catch (e) { toast("导入数据超出本地存储容量，本次会话有效，刷新后恢复内置数据", "warn"); }
  }
  function loadPersisted() {
    try { S.manual = JSON.parse(localStorage.getItem(LS_MANUAL) || "[]"); } catch (e) { S.manual = []; }
    S.base = window.MES_DATA;
    S.baseLabel = "内置数据";
    try {
      const imp = JSON.parse(localStorage.getItem(LS_IMPORTED) || "null");
      if (imp && imp.model && imp.model.batches) {
        // 内置数据(mes-data.js)如果比本地缓存新（换电脑/重新生成过数据文件），优先用内置数据，
        // 这样用户替换 web/data/mes-data.js 后，即使这台电脑有旧缓存也会自动使用最新数据
        const builtAt = (window.MES_DATA && window.MES_DATA.meta && window.MES_DATA.meta.generatedAt) || "";
        const cachedAt = (imp.model && imp.model.meta && imp.model.meta.generatedAt) || "";
        if (builtAt && cachedAt && builtAt > cachedAt) {
          S.base = window.MES_DATA;
          S.importedInfo = null;
          try { localStorage.removeItem(LS_IMPORTED); } catch (e) { }
        } else {
          S.base = imp.model;
          S.importedInfo = { name: imp.name, time: imp.time };
        }
      }
    } catch (e) { }
    try { S.theme = localStorage.getItem(LS_THEME) || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); } catch (e) { S.theme = "light"; }
    try { S.customRules = JSON.parse(localStorage.getItem(LS_CUSTOM) || "{}") || {}; } catch (e) { S.customRules = {}; }
    try { S.binding = JSON.parse(localStorage.getItem("mes-binding-v1") || "null"); } catch (e) { S.binding = null; }
  }

  /* ---------- 云端数据（Cloudflare Pages Functions + KV） ----------
   * 打开网页时尝试读取 /api/data；若云端数据比当前本地/内置数据新，则使用云端数据。
   * 这样任何人在任何电脑导入并同步到云端后，所有人打开网页都会看到最新数据。
   */
  async function loadRemoteData() {
    try {
      const res = await fetch("api/data", { cache: "no-store" });
      if (!res.ok) return false;
      const remote = await res.json();
      if (!remote || !remote.meta || !remote.batches) return false;
      const remoteAt = remote.meta.generatedAt || "";
      const localAt = (S.base && S.base.meta && S.base.meta.generatedAt) || "";
      if (!remoteAt) return false;
      if (remoteAt > localAt) {
        S.base = remote;
        S.importedInfo = { name: "云端数据", time: remote.meta.generatedLabel || "" };
        S.baseLabel = "云端数据";
        try { localStorage.setItem(LS_IMPORTED, JSON.stringify({ name: "云端数据", time: remote.meta.generatedLabel || "", model: remote })); } catch (e) { }
        rebuild();
      }
      return true;
    } catch (e) {
      // 离线/未配置 Functions 时静默失败，继续用本地/内置数据
      return false;
    }
  }

  /* ---------- 主题 ---------- */
  function applyTheme(t) {
    S.theme = t;
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem(LS_THEME, t); } catch (e) { }
    // 通知各图表重绘（暗色下配色/网格需刷新）
    if (S.data) setTimeout(() => { try { render(); } catch (e) { } }, 0);
  }
  function toggleTheme() { applyTheme(S.theme === "dark" ? "light" : "dark"); }

  /* ---------- 自定义规则（鱼骨原因 / 报告备注）—— 随迁移包转移 ---------- */
  function getCustom(key) { return S.customRules[key] || { causes: {}, note: "" }; }
  function setCustom(key, obj) {
    S.customRules[key] = Object.assign({ causes: {}, note: "" }, obj);
    try { localStorage.setItem(LS_CUSTOM, JSON.stringify(S.customRules)); } catch (e) { }
  }

  /* ---------- 迁移包（实现"不受设备限制、自由转移"） ----------
   * 浏览器 file:// 无法自动读写同目录文件，故采用"导出/导入一个自包含 JSON 包"：
   *   包内含手动录入、导入的数据源模型、主题、自定义规则、控制限、绑定信息，
   *   整文件夹 + 该包一起拷贝到任意设备，双击 index.html 后"导入迁移包"即可完整恢复。
   */
  function exportPackage() {
    const pkg = {
      kind: "mes-migration-package",
      version: 1,
      exportedAt: new Date().toISOString(),
      manual: S.manual,
      importedInfo: S.importedInfo,
      base: (S.importedInfo && S.base !== window.MES_DATA) ? S.base : (S.importedInfo ? S.base : null),
      theme: S.theme,
      customRules: S.customRules,
      binding: S.binding,
      controlLimits: (() => { try { return JSON.parse(localStorage.getItem(LS_CTL) || "{}"); } catch (e) { return {}; } })(),
    };
    App.download(`MES迁移包-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(pkg, null, 2), "application/json");
    toast("已导出迁移包：与 web 文件夹一起拷贝即可自由转移到其他设备", "ok", 6000);
  }
  function importPackage(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const pkg = JSON.parse(e.target.result);
        if (pkg.kind !== "mes-migration-package") { toast("不是有效的 MES 迁移包", "err"); return; }
        if (Array.isArray(pkg.manual)) S.manual = pkg.manual;
        if (pkg.theme) S.theme = pkg.theme;
        if (pkg.customRules) S.customRules = pkg.customRules;
        if (pkg.binding) S.binding = pkg.binding;
        if (pkg.controlLimits) try { localStorage.setItem(LS_CTL, JSON.stringify(pkg.controlLimits)); } catch (e) { }
        if (pkg.base && pkg.base.batches) {
          S.base = pkg.base;
          S.importedInfo = pkg.importedInfo || { name: "迁移包数据源", time: new Date().toLocaleString("zh-CN") };
          try { localStorage.setItem(LS_IMPORTED, JSON.stringify({ ...S.importedInfo, model: S.base })); } catch (e) { }
        } else if (pkg.importedInfo == null) {
          S.base = window.MES_DATA; S.importedInfo = null;
          try { localStorage.removeItem(LS_IMPORTED); } catch (e) { }
        }
        try { localStorage.setItem(LS_MANUAL, JSON.stringify(S.manual)); } catch (e) { }
        try { localStorage.setItem(LS_CUSTOM, JSON.stringify(S.customRules)); } catch (e) { }
        applyTheme(S.theme);
        rebuild();
        toast("迁移包已导入，数据与配置已恢复", "ok", 6000);
      } catch (err) {
        console.error(err);
        toast(`迁移包解析失败：${err.message}`, "err");
      }
    };
    reader.onerror = () => toast("读取迁移包失败", "err");
    reader.readAsText(file);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    loadPersisted();
    document.documentElement.setAttribute("data-theme", S.theme);

    // 导航
    const nav = $("#nav");
    for (const n of NAV) {
      nav.append(el("button", { class: "nav-item", "data-view": n.id, onclick: () => setView(n.id) },
        el("i", { "data-lucide": n.icon }), el("span", {}, n.name)));
    }
    // 顶部基体切换：更新 S.product 并触发整页重渲染
    // 联动重置 quality 模块的过滤状态（metric / supplier / focusBatch），避免旧指标残留
    const seg = $("#productSeg");
    seg.innerHTML = "";
    for (const p of ["全部", ...(S.base.meta.products || [])]) {
      const btn = el("button", { class: p === S.product ? "active" : "", onclick: ev => {
        S.product = p;
        // 重置 quality 模块内部的过滤状态，让它跟着 S.product 走
        if (window.App && App.S && App.S.quality) {
          App.S.quality.metric = null;
          App.S.quality.supplier = "";
          App.S.quality.focusBatch = null;
          App.S.quality.fbDefect = null;
          App.S.quality.reportDefect = null;
        }
        $$("#productSeg button").forEach(x => x.classList.toggle("active", x === ev.currentTarget));
        render();
      } }, p);
      seg.append(btn);
    }
    initSearch();
    // 主题切换
    const themeBtn = $("#themeToggle");
    if (themeBtn) {
      const syncIcon = () => {
        const i = themeBtn.querySelector("i");
        if (i) { i.setAttribute("data-lucide", S.theme === "dark" ? "sun" : "moon"); }
        themeBtn.title = S.theme === "dark" ? "切换为亮色主题" : "切换为暗色主题";
        refreshIcons();
      };
      syncIcon();
      themeBtn.addEventListener("click", () => { toggleTheme(); syncIcon(); });
    }
    window.addEventListener("resize", debounce(() => S.charts.forEach(c => c.resize()), 150));
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });
    // 侧栏项入场动画
    if (window.MESAnimate) {
      const navItems = nav.querySelectorAll(".nav-item");
      gsap.from(navItems, { x: -16, autoAlpha: 0, duration: 0.4, ease: "power3.out", stagger: { each: 0.04 } });
      gsap.from(".brand, #productSeg, #sideFoot", { y: 10, autoAlpha: 0, duration: 0.45, ease: "power3.out", stagger: 0.08 });
      MESAnimate.topbar($(".topbar"));
    }
    rebuild();
    setView("dashboard");
    // 异步拉取云端数据（若有且更新则替换本地；离线时静默）
    loadRemoteData();
    // 首屏渲染完成后移除 bootLoader（用两帧 + 兜底超时，避免被卡帧挡住）
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const boot = document.getElementById("bootLoader");
      if (boot) {
        boot.classList.add("is-hide");
        setTimeout(() => boot.classList.add("is-gone"), 400);
      }
    }));
    setTimeout(() => {
      const boot = document.getElementById("bootLoader");
      if (boot && !boot.classList.contains("is-gone")) {
        boot.classList.add("is-hide");
        setTimeout(() => boot.classList.add("is-gone"), 400);
      }
    }, 1500);
  }

  return {
    init, rebuild, setView, render, openBatchDrawer, closeDrawer, makeChart, disposeCharts, resizeCharts,
    persistManual, persistImported,
    applyTheme, toggleTheme, getCustom, setCustom, exportPackage, importPackage,
    S, STAGES, STAGE_FIELDS, TEXT_METRICS, METRIC_ORDER, STAGE_COLOR,
    el, $, $$, esc, fmt, fmtPct, fmtMetric, round4, isDate, toast, download, refreshIcons, extractUnit,
    byProduct, qtyText, yieldOf, cmpBatch, verdictPill, judgeVal, coreOf, baseOf, debounce,
    batchSupplier, lookupSpec, effectiveSpec, batchDevice, DEVICE_LIST,
    LS_MANUAL, LS_IMPORTED,
  };
})();
