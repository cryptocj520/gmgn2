import { GROK } from "../shared/constants.js";
import {
  normalizeAiConfig,
  permissionPatternForBaseUrl,
  publicAiConfig,
  reuseSavedApiKey,
} from "../shared/grok-config.js";

export class NarrativeCoordinator {
  constructor(repository, service, aiConfigStore) {
    this.repository = repository;
    this.service = service;
    this.aiConfigStore = aiConfigStore;
    this.processingQueues = Array.from(
      { length: GROK.MAX_CONCURRENT_ANALYSES },
      () => Promise.resolve(),
    );
    this.nextQueue = 0;
  }

  async queueAlerts(tokens, settings) {
    if (!settings.narrativeEnabled || !tokens.length) return this.repository.getSummary();
    if (!await this.aiConfigStore.isConfigured()) return this.repository.markNarrativesWaitingForKey(tokens);
    const publicConfig = await this.aiConfigStore.getPublic();
    if (!await this.hasAiPermission(publicConfig.grokBaseUrl)) {
      return this.repository.markNarrativesWaitingForKey(tokens);
    }
    const queued = await this.repository.queueNarratives(tokens);
    queued.jobIds.forEach((jobId) => this.schedule(jobId));
    return queued.summary;
  }

  async testApiKey(input = {}) {
    const saved = await this.aiConfigStore.get();
    const apiKey = reuseSavedApiKey(saved, input.grokBaseUrl || saved.grokBaseUrl, input.apiKey);
    const config = normalizeAiConfig({
      ...saved,
      ...input,
      apiKey,
    });
    await this.ensureAiPermission(config.grokBaseUrl);
    const result = await this.service.validateApiKey(config);
    return { ...await this.integrationStatus(saved), testSearch: result.search || null };
  }

  async saveAiConfig(input = {}) {
    const apiKey = String(input.apiKey || "").trim();
    if (apiKey && apiKey.length < 8) throw new Error("API Key 格式不完整");
    const saved = await this.aiConfigStore.save({
      grokBaseUrl: input.grokBaseUrl,
      grokModel: input.grokModel,
      apiMode: input.apiMode || input.grokApiMode,
      authType: input.authType,
      enableWebSearch: input.enableWebSearch,
      enableXSearch: input.enableXSearch,
      timeoutSeconds: input.timeoutSeconds,
      apiKey,
    });
    await this.ensureAiPermission(saved.grokBaseUrl);
    await this.repository.setGrokConfigured(true, {
      grokModel: saved.grokModel,
      grokBaseUrl: saved.grokBaseUrl,
    });
    if (await this.hasAiPermission(saved.grokBaseUrl)) await this.resumeWaitingNarratives();
    return this.integrationStatus(saved);
  }

  async retryNarrative(tokenId, detectedAt) {
    const event = await this.repository.getNarrativeEvent(tokenId, detectedAt);
    if (!event) throw new Error("找不到对应提醒记录");
    if (!await this.aiConfigStore.isConfigured()) return this.repository.markNarrativesWaitingForKey([event]);
    const publicConfig = await this.aiConfigStore.getPublic();
    if (!await this.hasAiPermission(publicConfig.grokBaseUrl)) {
      throw new Error("请先保存配置并允许访问 AI 地址");
    }
    const queued = await this.repository.queueNarratives([event]);
    queued.jobIds.forEach((jobId) => this.schedule(jobId));
    return queued.summary;
  }

  async queueManual(token) {
    if (!token?.id || !token?.address) throw new Error("缺少合约信息，无法分析");
    if (!await this.aiConfigStore.isConfigured()) throw new Error("尚未配置 API Key");
    const publicConfig = await this.aiConfigStore.getPublic();
    if (!await this.hasAiPermission(publicConfig.grokBaseUrl)) {
      throw new Error("请先保存配置并允许访问 AI 地址");
    }
    const event = await this.repository.createManualNarrativeEvent(token);
    const queued = await this.repository.queueNarratives([event]);
    queued.jobIds.forEach((jobId) => this.schedule(jobId));
    const queuedEvent = queued.summary.recentEvents.find((item) =>
      item.id === event.id && item.detectedAt === event.detectedAt
    );
    return { event: queuedEvent || event, summary: queued.summary };
  }

  async resume() {
    const configured = await this.aiConfigStore.isConfigured();
    const publicConfig = await this.aiConfigStore.getPublic();
    await this.repository.setGrokConfigured(configured, {
      grokModel: publicConfig.grokModel,
      grokBaseUrl: publicConfig.grokBaseUrl,
    });
    const allowed = configured && await this.hasAiPermission(publicConfig.grokBaseUrl);
    if (allowed) await this.resumeWaitingNarratives();
    const { settings } = await this.repository.getBootstrap();
    const jobs = await this.repository.getNarrativeJobs();
    if (!allowed) {
      for (const job of jobs) await this.repository.parkNarrativeJob(job.jobId);
      return;
    }
    jobs.forEach((job) => {
      if (settings.narrativeEnabled || job.token?.manual) this.schedule(job.jobId);
    });
  }

  async resumeWaitingNarratives() {
    const { settings } = await this.repository.getBootstrap();
    if (!settings.narrativeEnabled) return;
    const publicConfig = await this.aiConfigStore.getPublic();
    if (!await this.hasAiPermission(publicConfig.grokBaseUrl)) return;
    const waiting = await this.repository.getWaitingNarrativeEvents();
    if (!waiting.length) return;
    const queued = await this.repository.queueNarratives(waiting);
    queued.jobIds.forEach((jobId) => this.schedule(jobId));
  }

  schedule(jobId, delayMs = 100) {
    chrome.alarms.create(`${GROK.ALARM_PREFIX}${jobId}`, { when: Date.now() + delayMs });
  }

  handleAlarm(alarm) {
    if (!alarm.name.startsWith(GROK.ALARM_PREFIX)) return Promise.resolve();
    const task = () => this.processJob(alarm.name.slice(GROK.ALARM_PREFIX.length));
    const queueIndex = this.nextQueue % this.processingQueues.length;
    this.nextQueue += 1;
    this.processingQueues[queueIndex] = this.processingQueues[queueIndex].then(task, task);
    return this.processingQueues[queueIndex];
  }

  async processJob(jobId) {
    const claim = await this.repository.claimNarrativeJob(jobId, GROK.PROCESSING_LEASE_MS);
    if (!claim.job) return;
    if (!claim.claimed) {
      this.schedule(jobId, Math.max(1000, claim.retryAt - Date.now() + 100));
      return;
    }
    const job = claim.job;
    if (!await this.aiConfigStore.isConfigured()) {
      await this.repository.failNarrativeJob(jobId, "API Key 已移除");
      await this.kickQueuedJobs();
      return;
    }

    try {
      const config = await this.aiConfigStore.getRuntimeConfig();
      if (!await this.hasAiPermission(config.grokBaseUrl)) {
        await this.repository.parkNarrativeJob(jobId);
        await this.kickQueuedJobs();
        return;
      }
      const analysis = await this.service.analyze(job.token, config);
      await this.repository.completeNarrativeJob(jobId, analysis);
    } catch (error) {
      const canRetry = error.retryable && job.attempts < GROK.MAX_RETRIES;
      if (canRetry) {
        await this.repository.retryNarrativeJob(jobId, error.message);
        this.schedule(jobId, GROK.RETRY_DELAY_MS);
        await this.kickQueuedJobs();
        return;
      }
      console.error("[叙事分析] Grok 分析失败", error.message || "Grok 分析失败");
      await this.repository.failNarrativeJob(jobId, error.message || "Grok 分析失败");
    }
    await this.kickQueuedJobs();
  }

  async kickQueuedJobs() {
    const jobs = await this.repository.getNarrativeJobs();
    jobs
      .filter((item) => item.status === "queued" || item.status === "retrying")
      .forEach((item) => this.schedule(item.jobId, 100));
  }

  async hasAiPermission(baseUrl) {
    try {
      return await chrome.permissions.contains({
        origins: [permissionPatternForBaseUrl(baseUrl)],
      });
    } catch (_) {
      return false;
    }
  }

  async ensureAiPermission(baseUrl) {
    if (!await this.hasAiPermission(baseUrl)) {
      throw new Error("AI 地址访问权限未生效，请重新保存配置");
    }
  }

  async integrationStatus(config) {
    return {
      ...this.repository.getIntegrationStatus(),
      ...publicAiConfig(config),
    };
  }
}
