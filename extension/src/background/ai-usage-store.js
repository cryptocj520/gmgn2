import { GROK, STORAGE_KEYS } from "../shared/constants.js";

const MISSING_USAGE = "中转未返回 usage，无法精确统计";

export class AiUsageStore {
  constructor(storageArea = chrome.storage.local) {
    this.storage = storageArea;
  }

  async record({ config, usage, success, errorType = "" }) {
    let providerOrigin = "unknown";
    try {
      providerOrigin = new URL(config?.grokBaseUrl).origin;
    } catch (_) {
      providerOrigin = "unknown";
    }

    const entry = {
      at: new Date().toISOString(),
      project: "gmgn2",
      providerOrigin,
      model: String(config?.grokModel || "unknown"),
      inputTokens: Number.isInteger(usage?.inputTokens) ? usage.inputTokens : null,
      outputTokens: Number.isInteger(usage?.outputTokens) ? usage.outputTokens : null,
      totalTokens: Number.isInteger(usage?.totalTokens) ? usage.totalTokens : null,
      success: Boolean(success),
      errorType: success ? "" : String(errorType || "unknown"),
      usageStatus: usage ? "中转已返回 usage" : MISSING_USAGE,
    };

    const stored = await this.storage.get(STORAGE_KEYS.AI_USAGE);
    const previous = Array.isArray(stored[STORAGE_KEYS.AI_USAGE]?.records)
      ? stored[STORAGE_KEYS.AI_USAGE].records
      : [];
    const records = [...previous, entry].slice(-GROK.MAX_USAGE_RECORDS);
    await this.storage.set({ [STORAGE_KEYS.AI_USAGE]: { records } });
  }
}
