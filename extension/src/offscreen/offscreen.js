import { MESSAGE, MESSAGE_TARGET } from "../shared/constants.js";
import { playAlertTone } from "../shared/alert-tone.js";

let audioContext = null;

async function playAlert() {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("当前浏览器不支持网页声音");
  audioContext ||= new AudioContextClass();
  if (audioContext.state === "suspended") await audioContext.resume();

  playAlertTone(audioContext);
}

async function aiFetch(message) {
  const target = assertAllowedAiUrl(message.url);
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Math.min(330000, Number(message.timeoutMs) || 180000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target.href, {
      method: message.method === "GET" ? "GET" : "POST",
      headers: message.headers || {},
      body: message.method === "GET" ? undefined : String(message.body || ""),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const responseBody = await response.blob();
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await responseBody.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function assertAllowedAiUrl(href) {
  let target;
  try {
    target = new URL(String(href || ""));
  } catch (_) {
    throw new Error("AI 地址不是有效网址");
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("AI 地址只支持 HTTP 或 HTTPS");
  }
  if (target.username || target.password || target.search || target.hash) {
    throw new Error("AI 地址不能包含账号、密码、查询参数或片段");
  }
  if (!/\/(responses|chat\/completions)$/i.test(target.pathname.replace(/\/+$/, ""))) {
    throw new Error("隐藏文档只允许访问 AI 对话接口");
  }
  return target;
}

const handlers = Object.freeze({
  [MESSAGE.OFFSCREEN_PING]: async () => ({}),
  [MESSAGE.PLAY_SOUND]: () => playAlert().then(() => ({})),
  [MESSAGE.AI_FETCH]: aiFetch,
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== MESSAGE_TARGET.OFFSCREEN) return false;
  const handler = handlers[message.type];
  if (!handler) return false;
  handler(message)
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((error) => sendResponse({
      ok: false,
      error: error?.name === "AbortError"
        ? "分析请求超时"
        : /failed to fetch|fetch failed|networkerror/i.test(error?.message || "")
          ? "无法连接 AI 接口，请检查地址和权限"
          : error?.message || "隐藏文档处理失败",
    }));
  return true;
});
