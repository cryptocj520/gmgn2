import { DATA_SCHEMA_VERSION, DEFAULT_SETTINGS, LIMITS, STORAGE_KEYS } from "../shared/constants.js";
import { applyScanToState, createDataState } from "../shared/scan-state.js";
import {
  normalizeBridgeBaseUrl,
  normalizeGrokApiMode,
  normalizeGrokBaseUrl,
  normalizeGrokModel,
} from "../shared/grok-config.js";
import { normalizePanelPosition, normalizePanelSize } from "../shared/panel-preferences.js";

export class DataRepository {
  constructor(storageArea = chrome.storage.local) {
    this.storage = storageArea;
    this.data = createDataState();
    this.settings = { ...DEFAULT_SETTINGS };
    this.integrations = {
      grokConfigured: false,
      grokModel: DEFAULT_SETTINGS.grokModel,
      grokBaseUrl: DEFAULT_SETTINGS.grokBaseUrl,
      bridgeConfigured: false,
      bridgeBaseUrl: DEFAULT_SETTINGS.bridgeBaseUrl,
    };
    this.requiresBaseline = true;
    this.ready = null;
    this.writeQueue = Promise.resolve();
  }

  initialize() {
    this.ready ||= this.load();
    return this.ready;
  }

  async load() {
    const stored = await this.storage.get([
      STORAGE_KEYS.DATA,
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.INTEGRATIONS,
    ]);
    const storedData = stored[STORAGE_KEYS.DATA];
    this.requiresBaseline = !storedData ||
      storedData.schemaVersion !== DATA_SCHEMA_VERSION ||
      Object.keys(storedData.tokens || {}).length === 0;
    this.data = {
      ...createDataState(),
      ...(storedData || {}),
      tokens: storedData?.tokens || {},
      events: storedData?.events || [],
      narrativeJobs: storedData?.narrativeJobs || {},
    };
    this.settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.SETTINGS] || {}) };
    try {
      this.settings.grokBaseUrl = normalizeGrokBaseUrl(this.settings.grokBaseUrl);
      this.settings.grokModel = normalizeGrokModel(this.settings.grokModel);
      this.settings.grokApiMode = normalizeGrokApiMode(this.settings.grokApiMode);
      this.settings.bridgeBaseUrl = normalizeBridgeBaseUrl(this.settings.bridgeBaseUrl);
    } catch (_) {
      this.settings.grokBaseUrl = DEFAULT_SETTINGS.grokBaseUrl;
      this.settings.grokModel = DEFAULT_SETTINGS.grokModel;
      this.settings.grokApiMode = DEFAULT_SETTINGS.grokApiMode;
      this.settings.bridgeBaseUrl = DEFAULT_SETTINGS.bridgeBaseUrl;
    }
    this.settings.panelSize = normalizePanelSize(this.settings.panelSize);
    this.settings.panelPosition = normalizePanelPosition(this.settings.panelPosition);
    this.integrations = {
      grokConfigured: Boolean(stored[STORAGE_KEYS.INTEGRATIONS]?.grokConfigured),
      grokModel: this.settings.grokModel,
      grokBaseUrl: this.settings.grokBaseUrl,
      bridgeConfigured: Boolean(stored[STORAGE_KEYS.INTEGRATIONS]?.bridgeConfigured),
      bridgeBaseUrl: this.settings.bridgeBaseUrl,
    };
  }

  async getBootstrap() {
    await this.initialize();
    return {
      settings: { ...this.settings },
      summary: this.getSummary(),
      integrations: this.getIntegrationStatus(),
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
    if (Object.hasOwn(allowed, "grokBaseUrl")) {
      allowed.grokBaseUrl = normalizeGrokBaseUrl(allowed.grokBaseUrl);
    }
    if (Object.hasOwn(allowed, "grokModel")) {
      allowed.grokModel = normalizeGrokModel(allowed.grokModel);
    }
    if (Object.hasOwn(allowed, "grokApiMode")) {
      allowed.grokApiMode = normalizeGrokApiMode(allowed.grokApiMode);
    }
    if (Object.hasOwn(allowed, "bridgeBaseUrl")) {
      allowed.bridgeBaseUrl = normalizeBridgeBaseUrl(allowed.bridgeBaseUrl);
    }
    if (Object.hasOwn(allowed, "panelSize")) {
      allowed.panelSize = normalizePanelSize(allowed.panelSize);
    }
    if (Object.hasOwn(allowed, "panelPosition")) {
      allowed.panelPosition = normalizePanelPosition(allowed.panelPosition);
    }
    this.settings = { ...this.settings, ...allowed };
    this.integrations = {
      ...this.integrations,
      grokModel: this.settings.grokModel,
      grokBaseUrl: this.settings.grokBaseUrl,
      bridgeBaseUrl: this.settings.bridgeBaseUrl,
    };
    await this.storage.set({
      [STORAGE_KEYS.SETTINGS]: this.settings,
      [STORAGE_KEYS.INTEGRATIONS]: this.integrations,
    });
    return { ...this.settings };
  }

  async clearData() {
    await this.initialize();
    this.data = createDataState();
    this.requiresBaseline = true;
    await this.storage.set({ [STORAGE_KEYS.DATA]: this.data });
    return this.getSummary();
  }

  async setGrokConfigured(configured) {
    await this.initialize();
    this.integrations = { ...this.integrations, grokConfigured: Boolean(configured) };
    await this.storage.set({ [STORAGE_KEYS.INTEGRATIONS]: this.integrations });
    return { ...this.integrations };
  }

  async setBridgeConfigured(configured) {
    await this.initialize();
    this.integrations = { ...this.integrations, bridgeConfigured: Boolean(configured) };
    await this.storage.set({ [STORAGE_KEYS.INTEGRATIONS]: this.integrations });
    return { ...this.integrations };
  }

  async queueNarratives(tokens) {
    await this.initialize();
    return this.runDataWrite(() => {
      const now = Date.now();
      const jobs = { ...this.data.narrativeJobs };
      const jobIds = [];
      const jobByToken = new Map();
      const existingJobByToken = new Map(Object.values(jobs).map((job) => [
        `${job.token.id}:${job.token.detectedAt}`,
        job.jobId,
      ]));

      tokens.forEach((token, index) => {
        const tokenKey = `${token.id}:${token.detectedAt}`;
        const existingJobId = existingJobByToken.get(tokenKey);
        if (existingJobId) {
          jobIds.push(existingJobId);
          jobByToken.set(tokenKey, existingJobId);
          return;
        }
        const jobId = `${now}-${index}-${token.id}`;
        jobs[jobId] = { jobId, token, attempts: 0, status: "queued", leaseUntil: 0, createdAt: now };
        jobIds.push(jobId);
        jobByToken.set(tokenKey, jobId);
        existingJobByToken.set(tokenKey, jobId);
      });

      const events = this.data.events.map((event) => {
        const jobId = jobByToken.get(`${event.id}:${event.detectedAt}`);
        return jobId
          ? { ...event, narrative: { status: "queued", jobId, updatedAt: now } }
          : event;
      });
      this.data = { ...this.data, events, narrativeJobs: jobs, updatedAt: now };
      return { jobIds, summary: this.getSummary() };
    });
  }

  async createManualNarrativeEvent(token) {
    await this.initialize();
    return this.runDataWrite(() => {
      const now = Date.now();
      const event = { ...token, detectedAt: now, manual: true };
      this.data = {
        ...this.data,
        events: [event, ...this.data.events].slice(0, LIMITS.MAX_EVENTS),
        updatedAt: now,
      };
      return event;
    });
  }

  async markNarrativesWaitingForKey(tokens) {
    await this.initialize();
    return this.runDataWrite(() => {
      const now = Date.now();
      const targets = new Set(tokens.map((token) => `${token.id}:${token.detectedAt}`));
      const events = this.data.events.map((event) => targets.has(`${event.id}:${event.detectedAt}`)
        ? { ...event, narrative: { status: "waiting_key", updatedAt: now } }
        : event
      );
      this.data = { ...this.data, events, updatedAt: now };
      return this.getSummary();
    });
  }

  async getNarrativeJob(jobId) {
    await this.initialize();
    return this.data.narrativeJobs[jobId] || null;
  }

  async getNarrativeJobs() {
    await this.initialize();
    return Object.values(this.data.narrativeJobs);
  }

  async getWaitingNarrativeEvents() {
    await this.initialize();
    return this.data.events.filter((event) => event.narrative?.status === "waiting_key");
  }

  async claimNarrativeJob(jobId, leaseMs, now = Date.now()) {
    await this.initialize();
    return this.runDataWrite(() => {
      const job = this.data.narrativeJobs[jobId];
      if (!job) return { claimed: false, job: null, retryAt: 0 };
      const active = Object.values(this.data.narrativeJobs).find((candidate) =>
        candidate.status === "processing" && Number(candidate.leaseUntil) > now
      );
      if (active) return { claimed: false, job, retryAt: Number(active.leaseUntil) };

      const updatedJob = {
        ...job,
        status: "processing",
        leaseUntil: now + leaseMs,
        startedAt: now,
      };
      this.data = {
        ...this.data,
        narrativeJobs: { ...this.data.narrativeJobs, [jobId]: updatedJob },
        updatedAt: now,
      };
      return { claimed: true, job: updatedJob, retryAt: 0 };
    });
  }

  async getNarrativeEvent(tokenId, detectedAt) {
    await this.initialize();
    return this.data.events.find((event) => event.id === tokenId && event.detectedAt === detectedAt) || null;
  }

  async retryNarrativeJob(jobId, errorMessage) {
    await this.initialize();
    return this.runDataWrite(() => {
      const job = this.data.narrativeJobs[jobId];
      if (!job) return null;
      const updatedJob = {
        ...job,
        attempts: job.attempts + 1,
        status: "queued",
        leaseUntil: 0,
        lastError: errorMessage,
      };
      const narrativeJobs = { ...this.data.narrativeJobs, [jobId]: updatedJob };
      const events = this.updateEventNarrative(job, {
        status: "retrying",
        jobId,
        error: errorMessage,
        updatedAt: Date.now(),
      });
      this.data = { ...this.data, events, narrativeJobs, updatedAt: Date.now() };
      return updatedJob;
    });
  }

  async completeNarrativeJob(jobId, analysis) {
    await this.initialize();
    return this.runDataWrite(() => {
      const job = this.data.narrativeJobs[jobId];
      if (!job) return this.getSummary();
      const narrative = { status: "ready", analysis, updatedAt: Date.now() };
      const events = this.updateEventNarrative(job, narrative);
      const tokens = this.data.tokens[job.token.id]
        ? {
            ...this.data.tokens,
            [job.token.id]: { ...this.data.tokens[job.token.id], narrative },
          }
        : this.data.tokens;
      const narrativeJobs = { ...this.data.narrativeJobs };
      delete narrativeJobs[jobId];
      this.data = { ...this.data, events, tokens, narrativeJobs, updatedAt: Date.now() };
      return this.getSummary();
    });
  }

  async failNarrativeJob(jobId, errorMessage) {
    await this.initialize();
    return this.runDataWrite(() => {
      const job = this.data.narrativeJobs[jobId];
      if (!job) return this.getSummary();
      const events = this.updateEventNarrative(job, {
        status: "failed",
        error: errorMessage,
        updatedAt: Date.now(),
      });
      const narrativeJobs = { ...this.data.narrativeJobs };
      delete narrativeJobs[jobId];
      this.data = { ...this.data, events, narrativeJobs, updatedAt: Date.now() };
      return this.getSummary();
    });
  }

  async cancelNarrativeJobs(reason = "自动叙事分析已关闭") {
    await this.initialize();
    return this.runDataWrite(() => {
      const pendingIds = new Set(Object.values(this.data.narrativeJobs).map((job) => job.token.id));
      const events = this.data.events.map((event) => pendingIds.has(event.id)
        ? { ...event, narrative: { status: "cancelled", error: reason, updatedAt: Date.now() } }
        : event
      );
      this.data = { ...this.data, events, narrativeJobs: {}, updatedAt: Date.now() };
      return this.getSummary();
    });
  }

  updateEventNarrative(job, narrative) {
    return this.data.events.map((event) =>
      event.id === job.token.id && event.detectedAt === job.token.detectedAt
        ? { ...event, narrative }
        : event
    );
  }

  runDataWrite(operation) {
    const task = async () => {
      const result = operation();
      await this.storage.set({ [STORAGE_KEYS.DATA]: this.data });
      return result;
    };
    this.writeQueue = this.writeQueue.then(task, task);
    return this.writeQueue;
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

  getIntegrationStatus() {
    return { ...this.integrations };
  }
}
