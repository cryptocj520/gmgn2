import { AlertService } from "./alert-service.js";
import { AiConfigStore } from "./ai-config-store.js";
import { AiUsageStore } from "./ai-usage-store.js";
import { DataRepository } from "./data-repository.js";
import { GrokNarrativeService } from "./grok-narrative-service.js";
import { NarrativeCoordinator } from "./narrative-coordinator.js";
import { OffscreenAiClient } from "./offscreen-ai-client.js";
import { SecretVault } from "./secret-vault.js";
import { MESSAGE, MESSAGE_TARGET } from "../shared/constants.js";

const repository = new DataRepository();
const alerts = new AlertService();
const aiConfigStore = new AiConfigStore(chrome.storage.local, new SecretVault());
const narratives = new NarrativeCoordinator(
  repository,
  new GrokNarrativeService(new OffscreenAiClient(), new AiUsageStore()),
  aiConfigStore,
);

const handlers = {
  [MESSAGE.GET_BOOTSTRAP]: async () => {
    const [bootstrap, aiConfig] = await Promise.all([
      repository.getBootstrap(),
      aiConfigStore.getPublic(),
    ]);
    bootstrap.aiConfig = aiConfig;
    bootstrap.integrations = {
      ...bootstrap.integrations,
      grokConfigured: aiConfig.configured,
      grokModel: aiConfig.grokModel,
      grokBaseUrl: aiConfig.grokBaseUrl,
    };
    return bootstrap;
  },
  [MESSAGE.PROCESS_SCAN]: async (message, sender) => {
    const report = await repository.processScan(message.tokens || [], {
      baseline: message.baseline,
      completeSnapshot: message.completeSnapshot,
    });
    if (!report.baseline && report.alerts.length) {
      const { settings } = await repository.getBootstrap();
      await alerts.notify(report, settings, sender.tab?.id);
      const summary = await narratives.queueAlerts(report.alerts, settings);
      report.recentEvents = summary.recentEvents;
    }
    return report;
  },
  [MESSAGE.UPDATE_SETTINGS]: async (message) => {
    const patch = message.patch || {};
    const settings = await repository.updateSettings(patch);
    if (patch.narrativeEnabled === false) await repository.cancelNarrativeJobs();
    return settings;
  },
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
  [MESSAGE.TEST_GROK_API]: (message) => narratives.testApiKey(message),
  [MESSAGE.RETRY_NARRATIVE]: (message) => narratives.retryNarrative(message.tokenId, message.detectedAt),
  [MESSAGE.MANUAL_NARRATIVE]: (message) => narratives.queueManual(message.token),
  [MESSAGE.SAVE_AI_CONFIG]: (message) => narratives.saveAiConfig(message),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target && message.target !== MESSAGE_TARGET.BACKGROUND) return false;
  const handler = handlers[message?.type];
  if (!handler) return false;

  Promise.resolve(handler(message, sender))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      console.error("[后台] 消息处理失败", error?.message || "后台处理失败");
      sendResponse({ ok: false, error: error?.message || "后台处理失败" });
    });
  return true;
});

chrome.runtime.onInstalled.addListener(() => repository.initialize());
chrome.alarms.onAlarm.addListener((alarm) => {
  narratives.handleAlarm(alarm).catch((error) => console.error("[叙事队列] 任务处理失败", error?.message || "任务处理失败"));
});

narratives.resume().catch((error) => console.error("[叙事队列] 恢复任务失败", error?.message || "恢复任务失败"));
