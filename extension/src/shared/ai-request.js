// 按 chanlun-ai 的方式拼 AI 请求：插件自己填地址和 Key，直接 POST OpenAI 兼容接口。
import { GROK } from "./constants.js";

export function resolveAiEndpoint(baseUrl, protocol) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("请配置 AI 接口地址");
  const suffix = protocol === "openai-responses" ? "/responses" : "/chat/completions";
  if (/\/(chat\/completions|responses)$/i.test(base)) {
    return base.replace(/\/(chat\/completions|responses)$/i, suffix);
  }
  return `${base}${/\/v1$/i.test(base) ? "" : "/v1"}${suffix}`;
}

export function isSearchEnabled(config = {}) {
  return config.enableWebSearch !== false || config.enableXSearch !== false;
}

export function resolveAuthType(config = {}) {
  if (config.authType === "auto" || !config.authType) return "bearer";
  return config.authType;
}

export function buildAiHeaders(config) {
  const headers = { "content-type": "application/json" };
  if (resolveAuthType(config) === "x-api-key") headers["x-api-key"] = config.apiKey;
  else headers.authorization = `Bearer ${config.apiKey}`;
  return headers;
}

export function searchTools(config = {}) {
  return [
    ...(config.enableWebSearch !== false ? [{ type: "web_search" }] : []),
    ...(config.enableXSearch !== false ? [{ type: "x_search" }] : []),
  ];
}

export function buildAiRequest(config, input, maxTokens, options = {}) {
  const protocol = config.apiMode || "openai-responses";
  const model = String(config.grokModel || "").trim();
  const apiKey = String(config.apiKey || "").trim();
  if (!apiKey) throw new Error("请配置 API Key");
  if (!model) throw new Error("请配置模型名称");
  const search = isSearchEnabled(config);
  if (search && protocol !== "openai-responses") {
    throw new Error("Grok 联网检索仅支持 OpenAI Responses 协议，请先切换协议");
  }
  const tools = searchTools(config);
  let body;
  if (protocol === "openai-responses") {
    body = { model, input, max_output_tokens: maxTokens, store: false };
    if (options.jsonSchema) body.text = options.jsonSchema;
    if (search && tools.length) {
      body.stream = true;
      body.tools = tools;
      body.tool_choice = "required";
      body.max_tool_calls = GROK.MAX_TOOL_CALLS;
      body.parallel_tool_calls = true;
    }
  } else {
    body = { model, messages: [{ role: "user", content: input }], max_tokens: maxTokens, stream: false };
    if (options.jsonObject) body.response_format = { type: "json_object" };
  }
  return {
    url: resolveAiEndpoint(config.grokBaseUrl, protocol),
    init: { method: "POST", headers: buildAiHeaders(config), body: JSON.stringify(body) },
  };
}

export function parseAiPayload(raw) {
  const text = String(raw || "");
  if (/^\s*(?:data:|event:)/m.test(text)) return { raw: text };
  try {
    return text ? JSON.parse(text) : {};
  } catch (_) {
    return { raw: text };
  }
}

export function extractAiText(protocol, payload) {
  if (typeof payload?.raw === "string" && /^\s*(?:data:|event:)/m.test(payload.raw)) {
    return extractStreamText(protocol, payload.raw);
  }
  if (payload?.choices?.[0]?.finish_reason === "length" || payload?.stop_reason === "max_tokens"
    || payload?.status === "incomplete") {
    throw new Error("AI 输出达到最大 Token，未完成分析");
  }
  let text = "";
  if (protocol === "openai-responses") {
    text = payload?.output_text || (payload?.output || []).flatMap((item) => item?.content || [])
      .filter((item) => item?.type === "output_text").map((item) => item.text).join("\n");
  } else {
    const content = payload?.choices?.[0]?.message?.content;
    text = Array.isArray(content) ? content.map((item) => item?.text || "").join("\n") : content;
  }
  text = visibleText(text);
  if (!text) throw new Error("AI 返回中没有最终回答（可能只有思考内容）");
  return text;
}

export function extractSearchEvidence(payload) {
  const responses = [];
  const items = [];
  if (typeof payload?.raw === "string") {
    for (const block of payload.raw.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") continue;
      let event;
      try { event = JSON.parse(data); } catch (_) { continue; }
      if (event.type === "response.completed" && event.response) responses.push(event.response);
      if (event.type === "response.output_item.done" && event.item) items.push(event.item);
    }
  } else if (payload && typeof payload === "object") {
    responses.push(payload);
  }
  const calls = new Map();
  const usageCounts = { web: 0, x: 0 };
  const sources = new Set();
  const addSource = (value) => {
    const url = typeof value === "string" ? value : value?.url;
    if (typeof url === "string" && /^https?:\/\//i.test(url)) sources.add(url);
  };
  for (const response of responses) {
    for (const [key, type] of [["SERVER_SIDE_TOOL_WEB_SEARCH", "web"], ["SERVER_SIDE_TOOL_X_SEARCH", "x"]]) {
      usageCounts[type] = Math.max(
        usageCounts[type],
        Number(response.server_side_tool_usage?.[key] ?? response.usage?.server_side_tool_usage?.[key]) || 0,
      );
    }
    (response.citations || []).forEach(addSource);
    items.push(...(response.output || []));
  }
  for (const [index, item] of items.entries()) {
    const type = item?.type === "web_search_call" ? "web" : item?.type === "x_search_call" ? "x" : null;
    if (type && item.status !== "failed") calls.set(item.id || `item-${index}`, type);
    for (const content of item?.content || []) {
      for (const annotation of content?.annotations || []) addSource(annotation);
    }
  }
  return {
    webCalls: Math.max(usageCounts.web, [...calls.values()].filter((type) => type === "web").length),
    xCalls: Math.max(usageCounts.x, [...calls.values()].filter((type) => type === "x").length),
    sources: [...sources].slice(0, 30),
  };
}

export function extractUsage(payload) {
  if (typeof payload?.raw === "string") {
    for (const block of payload.raw.split(/\r?\n\r?\n/).reverse()) {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data);
        const usage = event.response?.usage || event.usage;
        if (usage) return usage;
      } catch (_) {
        continue;
      }
    }
    return null;
  }
  return payload?.usage || payload?.response?.usage || null;
}

export function isInterimSearchPlan(text) {
  return /(?:正在|开始|准备)(?:搜索|检索|查询)[^。！？]*[。.!?）)]*\s*$/.test(String(text || "").trim());
}

function visibleText(value) {
  const text = String(value || "").trim();
  if (/<think\b[^>]*>/i.test(text) && !/<\/think\s*>/i.test(text)) return "";
  return text.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "").trim();
}

function extractStreamText(protocol, raw) {
  const chunks = [];
  let completedText = "";
  let truncated = false;
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") continue;
    let event;
    try { event = JSON.parse(data); } catch (_) { continue; }
    if (event.error || event.type === "error") {
      throw new Error(event.error?.message || event.message || "AI 流式请求失败");
    }
    if (protocol === "openai-responses") {
      if (event.type === "response.output_text.delta") chunks.push(event.delta || "");
      else if (event.type === "response.completed" && !chunks.length) {
        completedText = extractAiText(protocol, event.response);
      }
      if (event.type === "response.incomplete") truncated = true;
    } else {
      const delta = event.choices?.[0]?.delta;
      if (typeof delta?.content === "string") chunks.push(delta.content);
      else if (Array.isArray(delta?.content)) chunks.push(delta.content.map((item) => item?.text || "").join(""));
      if (event.choices?.[0]?.message?.content) completedText = event.choices[0].message.content;
      if (event.choices?.[0]?.finish_reason === "length") truncated = true;
    }
  }
  if (truncated) throw new Error("AI 输出达到最大 Token，未完成分析");
  const text = visibleText(chunks.join("")) || visibleText(completedText);
  if (!text) throw new Error("AI 流式响应没有最终回答（可能只有思考内容）");
  return text;
}
