import { DEFAULT_SETTINGS, GROK, LIMITS, STORAGE_KEYS } from "../shared/constants.js";
import { normalizeTrendChain } from "../shared/gmgn-navigation.js";
import { applyScanToState, compactTokenRecord, createDataState } from "../shared/scan-state.js";
import { normalizePanelPosition, normalizePanelSize } from "../shared/panel-preferences.js";
import { ConfidenceStore } from "./confidence-store.js";

export class DataRepository {
  constructor(storageArea = chrome.storage.local) {
    this.storage = storageArea;
    this.confidenceStore = new ConfidenceStore(storageArea);
    this.data = createDataState();
    this.settings = { ...DEFAULT_SETTINGS };
    this.integrations = {
      grokConfigured: false,
      grokModel: GROK.MODEL,
      grokBaseUrl: GROK.API_BASE_URL,
    };
    this.requiresBaseline = true;
    this.ready = null;
    this.writeQueue = Promise.resolve();
    this.persistedData = this.data;
    this.lastChain = "";
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
      STORAGE_KEYS.LAST_CHAIN,
    ]);
    const storedData = stored[STORAGE_KEYS.DATA];
    this.lastChain = normalizeTrendChain(stored[STORAGE_KEYS.LAST_CHAIN]);
    this.requiresBaseline = !storedData ||
      Object.keys(storedData.tokens || {}).length === 0;
    this.data = {
      ...createDataState(),
      ...(storedData || {}),
      tokens: Object.fromEntries(Object.entries(storedData?.tokens || {}).map(([id, token]) => [id, {
        ...compactTokenRecord(token),
        // 旧版没有持续更新 lastSeen，迁移时用最近抓取时间，缺失时给一个完整保留期。
        lastSeen: token.lastSeen ?? token.capturedAt ?? Date.now(),
      }])),
      events: storedData?.events || [],
      narrativeJobs: storedData?.narrativeJobs || {},
    };
    this.settings = pickMonitorSettings(stored[STORAGE_KEYS.SETTINGS] || {});
    this.settings.panelSize = normalizePanelSize(this.settings.panelSize);
    this.settings.panelPosition = normalizePanelPosition(this.settings.panelPosition);
    this.integrations = {
      grokConfigured: Boolean(stored[STORAGE_KEYS.INTEGRATIONS]?.grokConfigured),
      grokModel: stored[STORAGE_KEYS.INTEGRATIONS]?.grokModel || GROK.MODEL,
      grokBaseUrl: stored[STORAGE_KEYS.INTEGRATIONS]?.grokBaseUrl || GROK.API_BASE_URL,
    };
    if (storedData) await this.confidenceStore.initialize(this.data.events);
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
      await this.rememberTrendChain(options.chain);
      const result = applyScanToState(this.data, tokens, {
        baseline: options.baseline,
        completeSnapshot: options.completeSnapshot,
        now: Date.now(),
        maxEvents: LIMITS.MAX_EVENTS,
        retentionDays: this.settings.retentionDays,
        alertTopN: this.settings.alertTopN,
        minLiquidity: this.settings.minLiquidity,
        minHolders: this.settings.minHolders,
        minMarketCap: this.settings.minMarketCap,
      });
      this.data = result.state;
      if (options.baseline && tokens.length) this.requiresBaseline = false;
      await this.persistData();
      return result.report;
    };
    this.writeQueue = this.writeQueue.then(operation, operation);
    return this.writeQueue;
  }

  async rememberTrendChain(value) {
    await this.initialize();
    const chain = normalizeTrendChain(value);
    if (!chain || chain === this.lastChain) return;
    await this.storage.set({ [STORAGE_KEYS.LAST_CHAIN]: chain });
    this.lastChain = chain;
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
    if (Object.hasOwn(allowed, "panelSize")) {
      allowed.panelSize = normalizePanelSize(allowed.panelSize);
    }
    if (Object.hasOwn(allowed, "panelPosition")) {
      allowed.panelPosition = normalizePanelPosition(allowed.panelPosition);
    }
    Object.assign(allowed, normalizeExtraSettings(allowed));
    this.settings = { ...this.settings, ...allowed };
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

  async setGrokConfigured(configured, extras = {}) {
    await this.initialize();
    this.integrations = {
      grokConfigured: Boolean(configured),
      grokModel: extras.grokModel || this.integrations.grokModel || GROK.MODEL,
      grokBaseUrl: extras.grokBaseUrl || this.integrations.grokBaseUrl || GROK.API_BASE_URL,
    };
    await this.storage.set({ [STORAGE_KEYS.INTEGRATIONS]: this.integrations });
    return { ...this.integrations };
  }

  async queueNarratives(tokens, { manual = false, checkRecent = false, force = false } = {}) {
    await this.initialize();
    const confidenceGroup = checkRecent && !force ? await this.confidenceStore.list() : [];
    return this.runDataWrite(() => {
      const now = Date.now();
      const jobs = { ...this.data.narrativeJobs };
      const jobIds = [];
      const jobByToken = new Map();
      const existingJobByToken = new Map(Object.values(jobs).map((job) => [job.token.id, job]));
      let selectedEvent = null;
      let alreadyInProgress = false;
      let events = this.data.events;
      if (checkRecent && !force && tokens.length === 1 && !existingJobByToken.has(tokens[0].id)) {
        const recentAnalysis = findRecentAnalysis(tokens[0], events, Object.values(this.data.tokens), confidenceGroup, now);
        if (recentAnalysis) return { recentAnalysis };
      }

      tokens.forEach((token, index) => {
        const existingJob = existingJobByToken.get(token.id);
        if (existingJob) {
          alreadyInProgress = true;
          selectedEvent ||= events.find((item) => item.id === token.id && item.detectedAt === existingJob.token.detectedAt) || existingJob.token;
          return;
        }
        const event = manual ? { ...token, detectedAt: now, manual: true } : token;
        if (manual) events = [event, ...events].slice(0, LIMITS.MAX_EVENTS);
        const tokenKey = `${event.id}:${event.detectedAt}`;
        const jobId = `${now}-${index}-${token.id}`;
        jobs[jobId] = { jobId, token: event, attempts: 0, status: "queued", leaseUntil: 0, createdAt: now };
        jobIds.push(jobId);
        jobByToken.set(tokenKey, jobId);
        existingJobByToken.set(token.id, jobs[jobId]);
        selectedEvent ||= event;
      });

      if (!jobIds.length) return { jobIds, event: selectedEvent, alreadyInProgress, summary: this.getSummary() };
      events = events.map((event) => {
        const jobId = jobByToken.get(`${event.id}:${event.detectedAt}`);
        return jobId
          ? { ...event, narrative: { status: "queued", jobId, updatedAt: now } }
          : event;
      });
      this.data = { ...this.data, events, narrativeJobs: jobs, updatedAt: now };
      selectedEvent = events.find((event) => event.id === selectedEvent?.id && event.detectedAt === selectedEvent?.detectedAt) || selectedEvent;
      return { jobIds, event: selectedEvent, alreadyInProgress, summary: this.getSummary() };
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

  // 手动分析指定 CA 时，用榜单上见过的记录补全名称、链和行情；同一地址出现在多条链时取最近见到的
  async findSeenToken(address) {
    await this.initialize();
    // 已见表里的 0x 地址统一存成小写，查找时同样转小写
    const target = /^0x/i.test(address) ? address.toLowerCase() : address;
    const matches = Object.values(this.data.tokens).filter((token) => token.address === target);
    const latest = matches.sort((left, right) => (right.lastSeen || 0) - (left.lastSeen || 0))[0];
    if (!latest) return null;
    // 去掉已见表自己的记账字段和旧分析结果，只保留代币本身的信息
    const {
      firstSeen, lastSeen, lastAppearedAt, missingSince, baseline, alertedAt, rank, narrative, ...token
    } = latest;
    return token;
  }

  async markNarrativesWaitingForKey(tokens) {
    await this.initialize();
    return this.runDataWrite(() => {
      const now = Date.now();
      const activeIds = new Set(Object.values(this.data.narrativeJobs).map((job) => job.token.id));
      const targets = new Set(tokens.filter((token) => !activeIds.has(token.id)).map((token) => `${token.id}:${token.detectedAt}`));
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

  async getActiveNarrative(tokenId) {
    await this.initialize();
    await this.writeQueue.catch(() => undefined);
    const job = Object.values(this.data.narrativeJobs).find((item) => item.token.id === tokenId);
    if (!job) return null;
    const event = this.data.events.find((item) => item.id === tokenId && item.detectedAt === job.token.detectedAt) || {
      ...job.token, narrative: { status: job.attempts ? "retrying" : "queued", jobId: job.jobId },
    };
    return { event, summary: this.getSummary(), alreadyInProgress: true };
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
      if (Number(job.nextAttemptAt) > now) return { claimed: false, job, retryAt: Number(job.nextAttemptAt) };
      const active = Object.values(this.data.narrativeJobs).filter((candidate) =>
        candidate.status === "processing" && Number(candidate.leaseUntil) > now
      );
      const duplicate = active.find(candidate => candidate.jobId === jobId);
      if (duplicate || active.length >= this.settings.maxConcurrentAnalyses) {
        const retryAt = duplicate ? Number(duplicate.leaseUntil) : Math.min(...active.map(candidate => Number(candidate.leaseUntil)));
        return { claimed: false, job, retryAt };
      }

      const updatedJob = {
        ...job,
        status: "processing",
        leaseUntil: now + leaseMs,
        startedAt: now,
        nextAttemptAt: 0,
      };
      const events = this.updateEventNarrative(updatedJob, {
        status: "processing",
        jobId,
        updatedAt: now,
      });
      this.data = {
        ...this.data,
        events,
        narrativeJobs: { ...this.data.narrativeJobs, [jobId]: updatedJob },
        updatedAt: now,
      };
      return { claimed: true, job: updatedJob, retryAt: 0 };
    });
  }

  async listEvents() {
    await this.initialize();
    return [...this.data.events];
  }

  async patchEvents(tokens, patch) {
    await this.initialize();
    return this.runDataWrite(() => {
      const now = Date.now();
      const keys = new Set((tokens || []).map((token) => `${token.id}:${token.detectedAt}`));
      const events = this.data.events.map((event) => keys.has(`${event.id}:${event.detectedAt}`)
        ? { ...event, ...patch }
        : event
      );
      this.data = { ...this.data, events, updatedAt: now };
      return this.getSummary();
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
        nextAttemptAt: Date.now() + GROK.RETRY_DELAY_MS,
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
    return this.runDataWrite(async () => {
      const job = this.data.narrativeJobs[jobId];
      if (!job) return this.getSummary();
      const narrative = { status: "ready", analysis, updatedAt: Date.now() };
      const events = this.updateEventNarrative(job, narrative);
      const event = events.find((item) => item.id === job.token.id && item.detectedAt === job.token.detectedAt);
      await this.confidenceStore.update({ ...job.token, ...event, ...identifiedName(event || job.token, analysis), narrative });
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

  async parkNarrativeJob(jobId) {
    await this.initialize();
    return this.runDataWrite(() => {
      const job = this.data.narrativeJobs[jobId];
      if (!job) return this.getSummary();
      const events = this.updateEventNarrative(job, {
        status: "waiting_key",
        updatedAt: Date.now(),
      });
      const narrativeJobs = { ...this.data.narrativeJobs };
      delete narrativeJobs[jobId];
      this.data = { ...this.data, events, narrativeJobs, updatedAt: Date.now() };
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
      const pendingIds = new Set(Object.values(this.data.narrativeJobs).map((job) => `${job.token.id}:${job.token.detectedAt}`));
      const events = this.data.events.map((event) => {
        const queued = pendingIds.has(`${event.id}:${event.detectedAt}`) && event.narrative?.status !== "ready";
        const waiting = event.narrative?.status === "waiting_key";
        return queued || waiting
          ? { ...event, narrative: { status: "cancelled", error: reason, updatedAt: Date.now() } }
          : event;
      });
      this.data = { ...this.data, events, narrativeJobs: {}, updatedAt: Date.now() };
      return this.getSummary();
    });
  }

  updateEventNarrative(job, narrative) {
    return this.data.events.map((event) =>
      event.id === job.token.id && event.detectedAt === job.token.detectedAt
        ? { ...event, ...identifiedName(event, narrative.analysis), narrative }
        : event
    );
  }

  runDataWrite(operation) {
    const task = async () => {
      const result = await operation();
      await this.persistData();
      return result;
    };
    this.writeQueue = this.writeQueue.then(task, task);
    return this.writeQueue;
  }

  async persistData() {
    if (this.data === this.persistedData) return;
    const snapshot = this.data;
    await this.storage.set({ [STORAGE_KEYS.DATA]: snapshot });
    this.persistedData = snapshot;
  }

  async getExportData() {
    await this.initialize();
    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: this.data.schemaVersion,
      settings: pickMonitorSettings(this.settings),
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

function findRecentAnalysis(token, events, tokens, confidenceGroup, now) {
  const names = (item) => item.nameUnknown ? [] : [item.symbol, item.name].map((value) => String(value || "").replace(/\s+/g, "").toLowerCase()).filter(Boolean);
  const targetNames = new Set(names(token));
  const candidates = [
    ...events.map((event) => ({ event, snapshot: false })),
    ...tokens.map((event) => ({ event, snapshot: true })),
    ...confidenceGroup.map((event) => ({ event, snapshot: true })),
  ];
  let latest = null;
  for (const candidate of candidates) {
    const event = candidate.event;
    if (event.narrative?.status !== "ready") continue;
    const analyzedAt = Number(event.narrative.analysis?.analyzedAt) || Date.parse(event.narrative.analysis?.analyzedAt) || 0;
    const ageMs = now - analyzedAt;
    if (ageMs < 0 || ageMs > GROK.RECENT_ANALYSIS_HOURS * 3600000) continue;
    const sameId = event.id === token.id;
    if (!sameId && !names(event).some((name) => targetNames.has(name))) continue;
    if (latest && latest.ageMs <= ageMs) continue;
    latest = { event: candidate.snapshot ? { ...event, detectedAt: event.detectedAt || analyzedAt, favoriteOnly: true } : event, ageMs, sameName: !sameId };
  }
  return latest;
}

function pickMonitorSettings(value = {}) {
  const settings = Object.keys(DEFAULT_SETTINGS).reduce((next, key) => {
    next[key] = Object.hasOwn(value, key) ? value[key] : DEFAULT_SETTINGS[key];
    return next;
  }, {});
  return { ...settings, ...normalizeExtraSettings(settings) };
}

function normalizeExtraSettings(value) {
  const rules = {
    maxConcurrentAnalyses: [LIMITS.MIN_CONCURRENT_ANALYSES, LIMITS.MAX_CONCURRENT_ANALYSES, true],
    minLiquidity: [0, Number.MAX_SAFE_INTEGER, false],
    minHolders: [0, Number.MAX_SAFE_INTEGER, true],
    minMarketCap: [0, Number.MAX_SAFE_INTEGER, false],
  };
  const result = {};
  for (const [key, [minimum, maximum, integer]] of Object.entries(rules)) {
    if (!Object.hasOwn(value, key)) continue;
    const number = Number(value[key]);
    const safe = Number.isFinite(number) ? number : DEFAULT_SETTINGS[key];
    result[key] = Math.min(maximum, Math.max(minimum, integer ? Math.floor(safe) : safe));
  }
  return result;
}

// 手动 CA 只有截短地址当名称；分析出真实名称后替换掉，面板上才能看出是哪个币
function identifiedName(event, analysis) {
  const identity = analysis?.tokenIdentity;
  if (!event.nameUnknown || !identity?.name) return {};
  return { name: identity.name, symbol: identity.symbol || identity.name, nameUnknown: false };
}
