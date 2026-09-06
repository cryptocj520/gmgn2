import { GROK } from "./constants.js";

export function normalizeGrokBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || GROK.API_BASE_URL).trim());
  } catch (_) {
    throw new Error("GROK_MODELS_BASE_URL 不是有效网址");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("中转地址只支持 HTTP 或 HTTPS");
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

export function normalizeGrokApiMode(value) {
  const mode = String(value || "auto").trim();
  if (!["auto", "responses", "chat_completions"].includes(mode)) {
    throw new Error("Grok API 接口模式无效");
  }
  return mode;
}

export function normalizeBridgeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || GROK.BRIDGE_BASE_URL).trim());
  } catch (_) {
    throw new Error("本地桥接地址不是有效网址");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("本地桥接地址只支持 HTTP 或 HTTPS");
  }
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("本地桥接只允许使用 127.0.0.1 或 localhost");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("本地桥接地址不能包含账号、密码、查询参数或片段");
  }
  if (url.pathname !== "/") {
    throw new Error("本地桥接地址不能包含路径");
  }
  return url.origin;
}

export function permissionPatternForBaseUrl(baseUrl) {
  const url = new URL(normalizeGrokBaseUrl(baseUrl));
  return `${url.protocol}//${url.hostname}/*`;
}

export function permissionPatternForBridgeUrl(baseUrl) {
  const url = new URL(normalizeBridgeBaseUrl(baseUrl));
  return `${url.protocol}//${url.hostname}/*`;
}
