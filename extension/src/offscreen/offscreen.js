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

async function bridgeFetch(message) {
  const target = new URL(String(message.url || ""));
  const allowedPath = target.pathname === "/analyze" ||
    target.pathname === "/analysis-status" ||
    target.pathname === "/config";
  if (!["127.0.0.1", "localhost"].includes(target.hostname) || !allowedPath) {
    throw new Error("隐藏文档只允许访问本机桥接接口");
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("本机桥接协议无效");
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Math.min(200000, Number(message.timeoutMs) || 90000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target.href, {
      method: message.method === "GET" ? "GET" : "POST",
      headers: message.headers || {},
      body: message.method === "GET" ? undefined : String(message.body || ""),
      cache: "no-store",
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

const handlers = Object.freeze({
  [MESSAGE.OFFSCREEN_PING]: async () => ({}),
  [MESSAGE.PLAY_SOUND]: () => playAlert().then(() => ({})),
  [MESSAGE.BRIDGE_FETCH]: bridgeFetch,
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
        ? "本地桥接请求超时"
        : error?.message || "隐藏文档处理失败",
    }));
  return true;
});
