import { GROK } from "./constants.js";

export const DEFAULT_AI_CONFIG = Object.freeze({
  grokBaseUrl: GROK.API_BASE_URL,
  grokModel: GROK.MODEL,
  apiMode: "openai-responses",
  authType: "auto",
  enableWebSearch: true,
  enableXSearch: true,
  timeoutSeconds: GROK.DEFAULT_TIMEOUT_SECONDS,
});

export function isLoopbackHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0:0:0:0:0:0:0:1";
}

export function normalizeGrokBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("请填写接口地址");
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new Error("接口地址不是有效网址，需要带 http:// 或 https://");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("中转地址只支持 HTTP 或 HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("中转地址不能包含账号、密码、查询参数或片段");
  }
  const path = url.pathname.replace(/\/+$/, "").replace(/\/(?:models|responses|chat\/completions|messages)$/i, "");
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
  const aliases = {
    auto: "openai-responses",
    responses: "openai-responses",
    "openai-responses": "openai-responses",
    chat_completions: "openai-chat",
    "openai-chat": "openai-chat",
  };
  const mode = aliases[String(value || "openai-responses").trim()];
  if (!mode) throw new Error("AI 接口协议无效");
  return mode;
}

export function normalizeAuthType(value) {
  const authType = String(value || "auto").trim() || "auto";
  if (!["auto", "bearer", "x-api-key"].includes(authType)) {
    throw new Error("鉴权方式无效");
  }
  return authType;
}

export function normalizeTimeoutSeconds(value) {
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds)) return GROK.DEFAULT_TIMEOUT_SECONDS;
  return Math.min(
    GROK.MAX_TIMEOUT_SECONDS,
    Math.max(GROK.MIN_TIMEOUT_SECONDS, seconds),
  );
}

export function permissionPatternForBaseUrl(baseUrl) {
  const url = new URL(normalizeGrokBaseUrl(baseUrl));
  // Chrome 主机权限匹配规则不接受端口，授权该主机后覆盖其全部端口。
  return `${url.protocol}//${url.hostname}/*`;
}

export function sameAiOrigin(left, right) {
  try {
    return new URL(normalizeGrokBaseUrl(left)).origin === new URL(normalizeGrokBaseUrl(right)).origin;
  } catch (_) {
    return false;
  }
}

export function reuseSavedApiKey(saved, nextUrl, incomingKey) {
  const typed = String(incomingKey || "").trim();
  if (typed) return typed;
  if (!saved?.apiKey) throw new Error("请输入 API Key");
  if (nextUrl && saved.grokBaseUrl && !sameAiOrigin(saved.grokBaseUrl, nextUrl)) {
    throw new Error("更换接口地址后必须重新输入 API Key");
  }
  return saved.apiKey;
}

export function publicAiConfig(config = {}) {
  return {
    grokBaseUrl: config.grokBaseUrl || DEFAULT_AI_CONFIG.grokBaseUrl,
    grokModel: config.grokModel || DEFAULT_AI_CONFIG.grokModel,
    apiMode: config.apiMode || DEFAULT_AI_CONFIG.apiMode,
    authType: config.authType || DEFAULT_AI_CONFIG.authType,
    enableWebSearch: config.enableWebSearch !== false,
    enableXSearch: config.enableXSearch !== false,
    timeoutSeconds: Number.isFinite(config.timeoutSeconds)
      ? config.timeoutSeconds
      : DEFAULT_AI_CONFIG.timeoutSeconds,
    configured: Boolean(config.apiKey),
  };
}

export function normalizeAiConfig(value = {}, fallback = DEFAULT_AI_CONFIG) {
  const apiKey = String(value.apiKey || "").trim();
  const rawUrl = String(value.grokBaseUrl || "").trim();
  // 有 Key 时必须使用原地址，禁止把旧 Key 配到默认官方 xAI。
  const grokBaseUrl = normalizeGrokBaseUrl(rawUrl || (apiKey ? "" : fallback.grokBaseUrl));
  const next = {
    grokBaseUrl,
    grokModel: normalizeGrokModel(value.grokModel || fallback.grokModel),
    apiMode: normalizeGrokApiMode(value.apiMode || fallback.apiMode),
    authType: normalizeAuthType(value.authType || fallback.authType),
    enableWebSearch: value.enableWebSearch !== false,
    enableXSearch: value.enableXSearch !== false,
    timeoutSeconds: normalizeTimeoutSeconds(value.timeoutSeconds ?? fallback.timeoutSeconds),
    apiKey,
  };
  if ((next.enableWebSearch || next.enableXSearch) && next.apiMode !== "openai-responses") {
    throw new Error("Grok 联网检索仅支持 OpenAI Responses 协议，请先切换协议");
  }
  return next;
}
