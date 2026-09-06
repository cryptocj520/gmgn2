import { MESSAGE, MESSAGE_TARGET } from "../shared/constants.js";

const OFFSCREEN_PATH = "src/offscreen/offscreen.html";
const READY_ATTEMPTS = 6;
let readinessPromise = null;

export async function ensureOffscreenDocument() {
  readinessPromise ||= ensureReady();
  try {
    await readinessPromise;
  } finally {
    readinessPromise = null;
  }
}

async function ensureReady() {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = chrome.runtime.getContexts
    ? await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] })
    : [];
  if (!contexts.length) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      // AUDIO_PLAYBACK 会在 30 秒无声音后强制关闭，长分析必须使用无时限类型。
      reasons: ["BLOBS"],
      justification: "处理本地桥接响应，并提供新代币提醒音",
    });
  }

  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    try {
      const response = await chrome.runtime.sendMessage({
        target: MESSAGE_TARGET.OFFSCREEN,
        type: MESSAGE.OFFSCREEN_PING,
      });
      if (response?.ok) return;
    } catch (_) {
      // 新建文档的消息监听器可能尚未完成注册，短暂等待后重试。
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("扩展隐藏文档未就绪，请重新加载插件后重试");
}
