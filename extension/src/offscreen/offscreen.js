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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== MESSAGE_TARGET.OFFSCREEN || message.type !== MESSAGE.PLAY_SOUND) return false;
  playAlert()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || "提醒音播放失败" }));
  return true;
});
