import { STORAGE_KEYS } from "../shared/constants.js";
import { DEFAULT_AI_CONFIG, normalizeAiConfig, publicAiConfig, reuseSavedApiKey } from "../shared/grok-config.js";

export class AiConfigStore {
  constructor(storageArea = chrome.storage.local, secretVault = null) {
    this.storage = storageArea;
    // SecretVault 只用于读取旧版 IndexedDB 密钥，新配置按你的选择写入 chrome.storage.local。
    this.secretVault = secretVault;
    this.cached = null;
  }

  async get() {
    if (this.cached) return this.cached;
    const stored = await this.storage.get([STORAGE_KEYS.AI_CONFIG, STORAGE_KEYS.SETTINGS]);
    const existing = stored[STORAGE_KEYS.AI_CONFIG];
    if (existing && typeof existing === "object") {
      this.cached = this.safeNormalize(existing);
      return this.cached;
    }

    const settings = stored[STORAGE_KEYS.SETTINGS] || {};
    let legacyKey = "";
    try {
      legacyKey = this.secretVault ? await this.secretVault.getGrokApiKey() : "";
    } catch (_) {
      legacyKey = "";
    }
    const migrated = this.safeNormalize({
      grokBaseUrl: settings.grokBaseUrl,
      grokModel: settings.grokModel,
      apiMode: settings.grokApiMode,
      enableXSearch: settings.grokEnableXSearch,
      apiKey: legacyKey,
    });
    // 旧 Key 没能配到合法地址时，不落盘、不清 IndexedDB，避免只剩官方 xAI 空配置。
    if (legacyKey && !migrated.apiKey) {
      this.cached = migrated;
      return migrated;
    }
    await this.storage.set({ [STORAGE_KEYS.AI_CONFIG]: migrated });
    if (migrated.apiKey && this.secretVault?.clearGrokApiKey) {
      await this.secretVault.clearGrokApiKey().catch(() => undefined);
    }
    this.cached = migrated;
    return migrated;
  }

  async getPublic() {
    return publicAiConfig(await this.get());
  }

  async isConfigured() {
    return Boolean((await this.get()).apiKey);
  }

  async getRuntimeConfig() {
    const config = await this.get();
    if (!config.apiKey) throw new Error("尚未配置 API Key");
    return config;
  }

  async save(input = {}) {
    const current = await this.get();
    const next = normalizeAiConfig({
      ...current,
      ...input,
      apiKey: reuseSavedApiKey(current, input.grokBaseUrl || current.grokBaseUrl, input.apiKey),
    });
    if (!next.apiKey) throw new Error("请输入 API Key");
    await this.storage.set({ [STORAGE_KEYS.AI_CONFIG]: next });
    this.cached = next;
    return next;
  }

  safeNormalize(value) {
    try {
      return normalizeAiConfig(value);
    } catch (_) {
      try {
        return normalizeAiConfig({
          grokBaseUrl: value?.grokBaseUrl,
          grokModel: value?.grokModel,
          apiMode: value?.apiMode,
          authType: value?.authType,
          timeoutSeconds: value?.timeoutSeconds,
          apiKey: value?.apiKey,
          enableWebSearch: false,
          enableXSearch: false,
        });
      } catch (_) {
        return normalizeAiConfig({ apiKey: "" }, DEFAULT_AI_CONFIG);
      }
    }
  }
}
