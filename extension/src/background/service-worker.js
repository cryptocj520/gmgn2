import { AlertService } from "./alert-service.js";
import { DataRepository } from "./data-repository.js";
import { MESSAGE, MESSAGE_TARGET } from "../shared/constants.js";

const repository = new DataRepository();
const alerts = new AlertService();

const handlers = {
  [MESSAGE.GET_BOOTSTRAP]: () => repository.getBootstrap(),
  [MESSAGE.PROCESS_SCAN]: async (message, sender) => {
    const report = await repository.processScan(message.tokens || [], {
      baseline: message.baseline,
      completeSnapshot: message.completeSnapshot,
    });
    if (!report.baseline && report.alerts.length) {
      const { settings } = await repository.getBootstrap();
      await alerts.notify(report, settings, sender.tab?.id);
    }
    return report;
  },
  [MESSAGE.UPDATE_SETTINGS]: (message) => repository.updateSettings(message.patch || {}),
  [MESSAGE.TEST_SOUND]: () => alerts.playSound(),
  [MESSAGE.GET_EXPORT_DATA]: () => repository.getExportData(),
  [MESSAGE.CLEAR_DATA]: () => repository.clearData(),
  [MESSAGE.UPDATE_BADGE]: async (message, sender) => {
    if (!Number.isInteger(sender.tab?.id)) return null;
    const text = message.count ? String(Math.min(99, message.count)) : "";
    await chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#FF6B57" });
    await chrome.action.setBadgeText({ tabId: sender.tab.id, text });
    return null;
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target && message.target !== MESSAGE_TARGET.BACKGROUND) return false;
  const handler = handlers[message?.type];
  if (!handler) return false;

  Promise.resolve(handler(message, sender))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      console.error("[后台] 消息处理失败", error);
      sendResponse({ ok: false, error: error?.message || "后台处理失败" });
    });
  return true;
});

chrome.runtime.onInstalled.addListener(() => repository.initialize());
