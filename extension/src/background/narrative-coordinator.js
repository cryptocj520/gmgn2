import { GROK } from "../shared/constants.js";
import {
  normalizeBridgeBaseUrl,
  permissionPatternForBridgeUrl,
} from "../shared/grok-config.js";

export class NarrativeCoordinator {
  constructor(repository, service, secretVault) {
    this.repository = repository;
    this.service = service;
    this.secretVault = secretVault;
    this.processingQueues = Array.from(
      { length: GROK.MAX_CONCURRENT_ANALYSES },
      () => Promise.resolve(),
    );
    this.nextQueue = 0;
  }

  async queueAlerts(tokens, settings) {
    if (!settings.narrativeEnabled || !tokens.length) return this.repository.getSummary();
    const bridgeToken = await this.secretVault.getBridgeToken();
    if (!bridgeToken) return this.repository.markNarrativesWaitingForKey(tokens);
    const queued = await this.repository.queueNarratives(tokens);
    queued.jobIds.forEach((jobId) => this.schedule(jobId));
    return queued.summary;
  }

  async testApiKey() {
    const { settings } = await this.repository.getBootstrap();
    const bridgeToken = await this.secretVault.getBridgeToken();
    const transportConfig = await this.buildLocalConfig(settings, bridgeToken);
    const analyzer = await this.service.status(transportConfig);
    return { ...this.repository.getIntegrationStatus(), analyzer };
  }

  async saveLocalConnection(config = {}) {
    const current = (await this.repository.getBootstrap()).settings;
    const bridgeBaseUrl = normalizeBridgeBaseUrl(config.bridgeBaseUrl || current.bridgeBaseUrl);
    const bridgeToken = String(config.bridgeToken || "").trim();
    const existingBridgeToken = await this.secretVault.getBridgeToken();
    if (!bridgeToken && !existingBridgeToken) throw new Error("请输入本地分析服务令牌");
    if (bridgeToken && bridgeToken.length < 16) throw new Error("本地分析服务令牌格式不完整");
    await this.repository.updateSettings({ bridgeBaseUrl, bridgeFallbackEnabled: true });
    if (bridgeToken) await this.secretVault.saveBridgeToken(bridgeToken);
    const integration = await this.repository.setBridgeConfigured(true);
    await this.resumeWaitingNarratives();
    return integration;
  }

  async migrateLegacyConfig() {
    const [apiKey, bridgeToken, bootstrap] = await Promise.all([
      this.secretVault.getGrokApiKey(),
      this.secretVault.getBridgeToken(),
      this.repository.getBootstrap(),
    ]);
    if (!apiKey) throw new Error("插件中没有可迁移的旧 API Key");
    const config = await this.buildLocalConfig(bootstrap.settings, bridgeToken);
    const migrated = await this.service.migrate(config, {
      grokBaseUrl: bootstrap.settings.grokBaseUrl,
      grokModel: bootstrap.settings.grokModel,
      apiMode: bootstrap.settings.grokApiMode === "chat_completions" ? "chat_completions" : "responses",
      searchMode: "native",
      enableXSearch: bootstrap.settings.grokEnableXSearch,
      timeoutSeconds: 90,
      apiKey,
    });
    await this.secretVault.clearGrokApiKey();
    await this.repository.setGrokConfigured(false);
    await this.resumeWaitingNarratives();
    return { ...this.repository.getIntegrationStatus(), analyzer: migrated };
  }

  async retryNarrative(tokenId, detectedAt) {
    const event = await this.repository.getNarrativeEvent(tokenId, detectedAt);
    if (!event) throw new Error("找不到对应提醒记录");
    const bridgeToken = await this.secretVault.getBridgeToken();
    if (!bridgeToken) return this.repository.markNarrativesWaitingForKey([event]);
    const queued = await this.repository.queueNarratives([event]);
    queued.jobIds.forEach((jobId) => this.schedule(jobId));
    return queued.summary;
  }

  async queueManual(token) {
    if (!token?.id || !token?.address) throw new Error("当前榜首缺少合约信息，无法分析");
    const bridgeToken = await this.secretVault.getBridgeToken();
    if (!bridgeToken) throw new Error("尚未配置本地分析服务令牌");
    const event = await this.repository.createManualNarrativeEvent(token);
    const queued = await this.repository.queueNarratives([event]);
    queued.jobIds.forEach((jobId) => this.schedule(jobId));
    const queuedEvent = queued.summary.recentEvents.find((item) =>
      item.id === event.id && item.detectedAt === event.detectedAt
    );
    return { event: queuedEvent || event, summary: queued.summary };
  }

  async resume() {
    const [grokConfigured, bridgeConfigured] = await Promise.all([
      this.secretVault.isGrokConfigured(),
      this.secretVault.isBridgeConfigured(),
    ]);
    await this.repository.setGrokConfigured(grokConfigured);
    await this.repository.setBridgeConfigured(bridgeConfigured);
    if (bridgeConfigured) await this.resumeWaitingNarratives();
    const jobs = await this.repository.getNarrativeJobs();
    jobs.forEach((job) => this.schedule(job.jobId));
  }

  async resumeWaitingNarratives() {
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
    const job = await this.repository.getNarrativeJob(jobId);
    if (!job) return;
    const bridgeToken = await this.secretVault.getBridgeToken();
    if (!bridgeToken) {
      await this.repository.failNarrativeJob(jobId, "本地分析服务令牌已移除");
      return;
    }

    try {
      const { settings } = await this.repository.getBootstrap();
      const transportConfig = await this.buildLocalConfig(settings, bridgeToken);
      const analysis = await this.service.analyze(job.token, transportConfig);
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

  async buildLocalConfig(settings, bridgeToken) {
    if (!bridgeToken) throw new Error("尚未配置本地分析服务令牌");
    const bridgeRequestEnabled = await chrome.permissions.contains({
      origins: [permissionPatternForBridgeUrl(settings.bridgeBaseUrl)],
    });
    if (!bridgeRequestEnabled) throw new Error("本地分析服务权限未生效，请重新加载插件");
    return { bridgeBaseUrl: settings.bridgeBaseUrl, bridgeToken };
  }
}
