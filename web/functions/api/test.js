/* 诊断测试 endpoint —— 用来确认 functions 是否被 Cloudflare 识别
 * 访问 https://<域名>/api/test 应该返回 "functions ok"
 * 如果返回 fallback HTML 或 404 → functions 路径错
 * 如果返回 "functions ok" → functions 工作正常，问题在 /api/data
 */
export async function onRequestGet(context) {
  return new Response(JSON.stringify({
    ok: true,
    msg: "functions ok",
    envKeys: Object.keys(context.env || {}),
    kvExists: !!context.env["SC-MES"],
  }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  return new Response(JSON.stringify({
    ok: true,
    msg: "functions POST ok",
    envKeys: Object.keys(context.env || {}),
    kvExists: !!context.env["SC-MES"],
  }), {
    headers: { "Content-Type": "application/json" },
  });
}