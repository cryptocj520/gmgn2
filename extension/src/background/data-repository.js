import { DATA_SCHEMA_VERSION, DEFAULT_SETTINGS, LIMITS, STORAGE_KEYS } from "../shared/constants.js";
import { applyScanToState, createDataState } from "../shared/scan-state.js";

export class DataRepository {
  constructor(storageArea = chrome.storage.local) {
    this.storage = storageArea;
    this.data = createDataState();
    this.settings = { ...DEFAULT_SETTINGS };
    this.requiresBaseline = true;
    this.ready = null;
    this.writeQueue = Promise.resolve();
  }

  initialize() {
    this.ready ||= this.load();
    return this.ready;
  }

  async load() {
    const stored = await this.storage.get([STORAGE_KEYS.DATA, STORAGE_KEYS.SETTINGS]);
    const storedData = stored[STORAGE_KEYS.DATA];
    this.requiresBaseline = !storedData ||
      storedData.schemaVersion !== DATA_SCHEMA_VERSION ||
      Object.keys(storedData.tokens || {}).length === 0;
    this.data = storedData || createDataState();
    this.settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.SETTINGS] || {}) };
  }

  async getBootstrap() {
    await this.initialize();
    return {
      settings: { ...this.settings },
      summary: this.getSummary(),
    };
  }

  async processScan(tokens, options = {}) {
    await this.initialize();
    const operation = async () => {
      const result = applyScanToState(this.data, tokens, {
        baseline: options.baseline,
        completeSnapshot: options.completeSnapshot,
        now: Date.now(),
        maxEvents: LIMITS.MAX_EVENTS,
        retentionDays: this.settings.retentionDays,
        alertTopN: this.settings.alertTopN,
      });
      this.data = result.state;
      if (options.baseline && options.completeSnapshot && tokens.length) this.requiresBaseline = false;
      await this.storage.set({ [STORAGE_KEYS.DATA]: this.data });
      return result.report;
    };
    this.writeQueue = this.writeQueue.then(operation, operation);
    return this.writeQueue;
  }

  async updateSettings(patch) {
    await this.initialize();
    const allowed = Object.keys(DEFAULT_SETTINGS).reduce((next, key) => {
      if (Object.hasOwn(patch, key)) next[key] = patch[key];
      return next;
    }, {});
    if (Object.hasOwn(allowed, "retentionDays")) {
      const days = Number.parseInt(allowed.retentionDays, 10);
      allowed.retentionDays = Math.min(
        LIMITS.MAX_RETENTION_DAYS,
        Math.max(LIMITS.MIN_RETENTION_DAYS, Number.isFinite(days) ? days : DEFAULT_SETTINGS.retentionDays),
      );
    }
    if (Object.hasOwn(allowed, "connectionTimeoutSeconds")) {
      const seconds = Number.parseInt(allowed.connectionTimeoutSeconds, 10);
      allowed.connectionTimeoutSeconds = Math.min(
        LIMITS.MAX_CONNECTION_TIMEOUT_SECONDS,
        Math.max(
          LIMITS.MIN_CONNECTION_TIMEOUT_SECONDS,
          Number.isFinite(seconds) ? seconds : DEFAULT_SETTINGS.connectionTimeoutSeconds,
        ),
      );
    }
    if (Object.hasOwn(allowed, "alertTopN")) {
      const rank = Number.parseInt(allowed.alertTopN, 10);
      allowed.alertTopN = Math.min(
        LIMITS.MAX_ALERT_TOP_N,
        Math.max(LIMITS.MIN_ALERT_TOP_N, Number.isFinite(rank) ? rank : DEFAULT_SETTINGS.alertTopN),
      );
    }
    this.settings = { ...this.settings, ...allowed };
    await this.storage.set({ [STORAGE_KEYS.SETTINGS]: this.settings });
    return { ...this.settings };
  }

  async clearData() {
    await this.initialize();
    this.data = createDataState();
    this.requiresBaseline = true;
    await this.storage.set({ [STORAGE_KEYS.DATA]: this.data });
    return this.getSummary();
  }

  async getExportData() {
    await this.initialize();
    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: this.data.schemaVersion,
      settings: { ...this.settings },
      tokens: Object.values(this.data.tokens),
      events: [...this.data.events],
    };
  }

  getSummary() {
    return {
      totalSeen: Object.keys(this.data.tokens).length,
      recentEvents: this.data.events.slice(0, LIMITS.PANEL_EVENTS),
      updatedAt: this.data.updatedAt,
      requiresBaseline: this.requiresBaseline,
    };
  }
}
