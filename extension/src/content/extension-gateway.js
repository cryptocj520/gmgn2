import { GROK, LIMITS, MESSAGE, MESSAGE_TARGET, STORAGE_KEYS } from "../shared/constants.js";

export class ExtensionGateway {
  async request(type, payload = {}) {
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        target: MESSAGE_TARGET.BACKGROUND,
        type,
        ...payload,
      });
    } catch (error) {
      const disconnected = /Receiving end does not exist|Extension context invalidated/i.test(error?.message || "");
      throw new Error(disconnected
        ? "插件刚刚更新，请刷新 GMGN 页面后重试"
        : error?.message || "扩展后台未响应");
    }
    if (!response?.ok) throw new Error(response?.error || "扩展后台未响应");
    return response.data;
  }

  getBootstrap() {
    return this.request(MESSAGE.GET_BOOTSTRAP);
  }

  processScan(tokens, baseline, completeSnapshot) {
    return this.request(MESSAGE.PROCESS_SCAN, { tokens, baseline, completeSnapshot });
  }

  updateSettings(patch) {
    return this.request(MESSAGE.UPDATE_SETTINGS, { patch });
  }

  testSound() {
    return this.request(MESSAGE.TEST_SOUND);
  }

  getExportData() {
    return this.request(MESSAGE.GET_EXPORT_DATA);
  }

  clearData() {
    return this.request(MESSAGE.CLEAR_DATA);
  }

  updateBadge(count) {
    return this.request(MESSAGE.UPDATE_BADGE, { count });
  }

  retryNarrative(tokenId, detectedAt) {
    return this.request(MESSAGE.RETRY_NARRATIVE, { tokenId, detectedAt });
  }

  manualNarrative(token) {
    return this.request(MESSAGE.MANUAL_NARRATIVE, { token });
  }

  onSettingsChanged(listener) {
    const handler = (changes, areaName) => {
      const change = changes[STORAGE_KEYS.SETTINGS];
      if (areaName === "local" && change?.newValue) listener(change.newValue);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  onDataChanged(listener) {
    const handler = (changes, areaName) => {
      const data = changes[STORAGE_KEYS.DATA]?.newValue;
      if (areaName !== "local" || !data) return;
      listener({
        totalSeen: Object.keys(data.tokens || {}).length,
        recentEvents: (data.events || []).slice(0, LIMITS.PANEL_EVENTS),
        updatedAt: data.updatedAt || 0,
      });
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  onIntegrationsChanged(listener) {
    const handler = (changes, areaName) => {
      if (areaName !== "local" || !changes[STORAGE_KEYS.INTEGRATIONS]) return;
      listener(changes[STORAGE_KEYS.INTEGRATIONS].newValue || {
        grokConfigured: false,
        grokModel: GROK.MODEL,
      });
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }
}
