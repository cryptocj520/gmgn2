import { GROK } from "./constants.js";

export function normalizeGrokBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || GROK.API_BASE_URL).trim());
  } catch (_) {
    throw new Error("GROK_MODELS_BASE_URL 不是有效网址");
  }

  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("中转地址必须使用 HTTPS；本机 localhost 可使用 HTTP");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("中转地址不能包含账号、密码、查询参数或片段");
  }
  const path = url.pathname.replace(/\/+$/, "").replace(/\/(?:models|responses)$/i, "");
  return `${url.origin}${path}`;
}

export function normalizeGrokModel(value) {
  const model = String(value || GROK.MODEL).trim();
  if (!model || model.length > 100 || !/^[A-Za-z0-9._:/-]+$/.test(model)) {
    throw new Error("Grok 模型名称格式无效");
  }
  return model;
}

export function permissionPatternForBaseUrl(baseUrl) {
  return `${new URL(normalizeGrokBaseUrl(baseUrl)).origin}/*`;
}
