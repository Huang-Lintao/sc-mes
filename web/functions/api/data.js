/* 多孔碳 MES · Cloudflare Pages Functions — 云端数据读写接口
 * 部署后自动成为 https://<域名>/api/data 接口
 * - GET  ：返回 KV 里保存的最新数据（无则返回 { ok:false, empty:true }）
 * - POST ：把网页导入的数据保存到 KV（内容为完整 MES_DATA 模型）
 * 需在 Pages 项目「设置 → 函数 → KV 绑定」中绑定：
 *   Name = SC-MES（变量名带连字符，访问用 context.env["SC-MES"]），Value = KV namespace ID
 */
export async function onRequestGet(context) {
  const kv = context.env["SC-MES"];
  const raw = kv ? await kv.get("mes_data") : null;
  if (!raw) {
    return new Response(JSON.stringify({ ok: false, empty: true }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  return new Response(raw, {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestPost(context) {
  const kv = context.env["SC-MES"];
  if (!kv) {
    return new Response(JSON.stringify({ ok: false, error: "KV 未绑定" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const body = await context.request.text();
    if (!body || body.length < 10) {
      return new Response(JSON.stringify({ ok: false, error: "空数据" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    // 校验是合法 JSON
    JSON.parse(body);
    await kv.put("mes_data", body);
    return new Response(JSON.stringify({ ok: true, bytes: body.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}