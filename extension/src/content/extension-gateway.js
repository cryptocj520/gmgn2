import { MESSAGE, MESSAGE_TARGET, STORAGE_KEYS } from "../shared/constants.js";

export class ExtensionGateway {
  async request(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({
      target: MESSAGE_TARGET.BACKGROUND,
      type,
      ...payload,
    });
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

  onSettingsChanged(listener) {
    const handler = (changes, areaName) => {
      const change = changes[STORAGE_KEYS.SETTINGS];
      if (areaName === "local" && change?.newValue) listener(change.newValue);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }
}
