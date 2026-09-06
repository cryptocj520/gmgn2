import { GROK } from "../shared/constants.js";
import { normalizeGrokBaseUrl, normalizeGrokModel } from "../shared/grok-config.js";

export class NarrativeCoordinator {
  constructor(repository, service, secretVault) {
    this.repository = repository;
    this.service = service;
    this.secretVault = secretVault;
    this.processingQueue = Promise.resolve();
  }

  async queueAlerts(tokens, settings) {
    if (!settings.narrativeEnabled || !tokens.length) return this.repository.getSummary();
    const apiKey = await this.secretVault.getGrokApiKey();
    if (!apiKey) return this.repository.markNarrativesWaitingForKey(tokens);
    const queued = await this.repository.queueNarratives(tokens);
    queued.jobIds.forEach((jobId) => this.schedule(jobId));
    return queued.summary;
  }

  async validateAndSaveApiKey(apiKey, config = {}) {
    const normalized = String(apiKey || "").trim();
    if (normalized.length < 20) throw new Error("API Key 格式不完整");
    const current = (await this.repository.getBootstrap()).settings;
    const proposed = {
      ...current,
      grokBaseUrl: normalizeGrokBaseUrl(config.grokBaseUrl || current.grokBaseUrl),
      grokModel: normalizeGrokModel(config.grokModel || current.grokModel),
    };
    await this.service.validateApiKey(normalized, proposed);
    await this.repository.updateSettings({
      grokBaseUrl: proposed.grokBaseUrl,
      grokModel: proposed.grokModel,
    });
    await this.secretVault.saveGrokApiKey(normalized);
    const integration = await this.repository.setGrokConfigured(true);
    return integration;
  }

  async clearApiKey() {
    await this.secretVault.clearGrokApiKey();
    return this.repository.setGrokConfigured(false);
  }

  async testApiKey() {
    const apiKey = await this.secretVault.getGrokApiKey();
    if (!apiKey) throw new Error("尚未配置 Grok API Key");
    const { settings } = await this.repository.getBootstrap();
    await this.service.validateApiKey(apiKey, settings);
    return this.repository.getIntegrationStatus();
  }

  async retryNarrative(tokenId, detectedAt) {
    const event = await this.repository.getNarrativeEvent(tokenId, detectedAt);
    if (!event) throw new Error("找不到对应提醒记录");
    const apiKey = await this.secretVault.getGrokApiKey();
    if (!apiKey) return this.repository.markNarrativesWaitingForKey([event]);
    const queued = await this.repository.queueNarratives([event]);
    queued.jobIds.forEach((jobId) => this.schedule(jobId));
    return queued.summary;
  }

  async resume() {
    await this.repository.setGrokConfigured(await this.secretVault.isGrokConfigured());
    const jobs = await this.repository.getNarrativeJobs();
    jobs.forEach((job) => this.schedule(job.jobId));
  }

  schedule(jobId, delayMs = 100) {
    chrome.alarms.create(`${GROK.ALARM_PREFIX}${jobId}`, { when: Date.now() + delayMs });
  }

  handleAlarm(alarm) {
    if (!alarm.name.startsWith(GROK.ALARM_PREFIX)) return Promise.resolve();
    const task = () => this.processJob(alarm.name.slice(GROK.ALARM_PREFIX.length));
    this.processingQueue = this.processingQueue.then(task, task);
    return this.processingQueue;
  }

  async processJob(jobId) {
    const job = await this.repository.getNarrativeJob(jobId);
    if (!job) return;
    const apiKey = await this.secretVault.getGrokApiKey();
    if (!apiKey) {
      await this.repository.failNarrativeJob(jobId, "Grok API Key 已移除");
      return;
    }

    try {
      const { settings } = await this.repository.getBootstrap();
      const analysis = await this.service.analyze(job.token, apiKey, settings);
      await this.repository.completeNarrativeJob(jobId, analysis);
    } catch (error) {
      const canRetry = error.retryable && job.attempts < GROK.MAX_RETRIES;
      if (canRetry) {
        await this.repository.retryNarrativeJob(jobId, error.message);
        this.schedule(jobId, GROK.RETRY_DELAY_MS);
        return;
      }
      console.error("[叙事分析] Grok 分析失败", error);
      await this.repository.failNarrativeJob(jobId, error.message || "Grok 分析失败");
    }
  }
}
