import { SCANNER } from "../../shared/constants.js";
import { buildMinimalCaToken, parseManualContractAddress } from "../../shared/token.js";

const STATUS = Object.freeze({
  IDLE: "idle",
  BASELINING: "baselining",
  RUNNING: "running",
  WAITING: "waiting",
  FOUND: "found",
  ERROR: "error",
  STOPPED: "stopped",
});

export class MonitorEngine {
  constructor({ source, gateway, watchdog = null }) {
    this.source = source;
    this.gateway = gateway;
    this.watchdog = watchdog;
    this.listeners = new Set();
    this.lifetimeCleanups = [];
    this.runtimeCleanups = [];
    this.scanTimer = 0;
    this.fullScanTimer = 0;
    this.debounceTimer = 0;
    this.scanning = false;
    this.mutationIgnoreUntil = 0;
    this.needsBaseline = true;
    this.state = {
      running: false,
      status: STATUS.IDLE,
      statusText: "正在准备",
      settings: null,
      integrations: null,
      totalSeen: 0,
      currentCount: 0,
      sessionNew: 0,
      lastScanAt: 0,
      events: [],
      lastFresh: [],
      error: null,
    };
  }

  async initialize() {
    const bootstrap = await this.gateway.getBootstrap();
    this.needsBaseline = bootstrap.summary.requiresBaseline;
    this.patchState({
      settings: bootstrap.settings,
      integrations: bootstrap.integrations,
      totalSeen: bootstrap.summary.totalSeen,
      events: bootstrap.summary.recentEvents,
      statusText: bootstrap.settings.autoStart ? "正在自动启动" : "待启动",
    });
    this.lifetimeCleanups.push(this.gateway.onSettingsChanged((settings) => this.applyExternalSettings(settings)));
    this.lifetimeCleanups.push(this.gateway.onDataChanged((summary) => this.applyExternalData(summary)));
    this.lifetimeCleanups.push(this.gateway.onIntegrationsChanged((integration) => {
      this.patchState({ integrations: integration });
    }));
    if (bootstrap.settings.autoStart) await this.start();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  getState() {
    return {
      ...this.state,
      settings: this.state.settings ? { ...this.state.settings } : null,
      integrations: this.state.integrations ? { ...this.state.integrations } : null,
      events: [...this.state.events],
      lastFresh: [...this.state.lastFresh],
    };
  }

  async start() {
    if (this.state.running) return;
    this.patchState({
      running: true,
      status: this.needsBaseline ? STATUS.BASELINING : STATUS.RUNNING,
      statusText: this.needsBaseline ? "正在建立完整基线" : "监控中",
    });
    this.runtimeCleanups.push(this.source.observeChanges(() => this.scheduleScan()));
    this.runtimeCleanups.push(this.source.observeVisibility(() => this.tryBackgroundFullScan()));
    this.restartInterval();
    this.restartFullScanInterval();
    await this.scan({ baseline: this.needsBaseline, completeSnapshot: true });
  }

  stop() {
    if (!this.state.running) return;
    this.clearRuntimeHooks();
    this.patchState({ running: false, status: STATUS.STOPPED, statusText: "已停止" });
  }

  async scan(options = {}) {
    const baseline = Boolean(options.baseline || this.needsBaseline);
    const completeSnapshot = Boolean(options.completeSnapshot);
    if ((!this.state.running && !baseline) || this.scanning) return;

    this.scanning = true;
    try {
      const tokens = await this.source.readTokens({ deep: completeSnapshot });
      if (!tokens.length) {
        this.patchState(this.applyHealth({
          currentCount: completeSnapshot ? 0 : this.state.currentCount,
          lastScanAt: Date.now(),
          status: STATUS.WAITING,
          statusText: "等待榜单数据",
        }, this.checkPageHealth()));
        return;
      }

      const report = await this.gateway.processScan(tokens, baseline, completeSnapshot);
      this.needsBaseline = false;
      const alerts = report.alerts || [];
      const patch = {
        currentCount: report.completeSnapshot ? report.currentCount : this.state.currentCount,
        totalSeen: report.totalSeen,
        events: report.recentEvents,
        lastScanAt: report.processedAt,
        lastFresh: alerts,
        status: alerts.length ? STATUS.FOUND : STATUS.RUNNING,
        statusText: alerts.length
          ? `${alerts.length} 个代币首次进入提醒名次`
          : report.removed
            ? `已清理 ${report.removed} 个过期记录`
            : "监控中",
      };
      if (alerts.length) {
        patch.sessionNew = this.state.sessionNew + alerts.length;
        this.gateway.updateBadge(patch.sessionNew).catch(() => undefined);
      }
      this.patchState(this.applyHealth(patch, this.checkPageHealth()));
    } catch (error) {
      console.error("[监控引擎] 扫描失败", error);
      this.patchState(this.applyHealth(
        { status: STATUS.ERROR, statusText: "扫描失败", error: error.message },
        this.checkPageHealth(),
      ));
    } finally {
      this.scanning = false;
      this.mutationIgnoreUntil = Date.now() + 500;
    }
  }

  scheduleScan() {
    if (!this.state.running || this.scanning || Date.now() < this.mutationIgnoreUntil) return;
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.scan(), 900);
  }

  checkPageHealth() {
    if (!this.watchdog || !this.state.settings) return { status: "disabled" };
    return this.watchdog.check(this.source.readConnectionHealth(), this.state.settings);
  }

  applyHealth(patch, health) {
    const overrides = {
      offline: { status: STATUS.WAITING, statusText: "网络已断开，等待恢复" },
      pending: {
        status: STATUS.WAITING,
        statusText: `连接异常，${health.remainingSeconds} 秒后刷新`,
      },
      reload: {
        status: STATUS.WAITING,
        statusText: `连接超时，准备刷新（${health.attempt}/${health.maxReloads}）`,
      },
      blocked: {
        status: STATUS.ERROR,
        statusText: `连续刷新 ${health.maxReloads} 次仍未恢复，已锁定自动刷新`,
      },
    };
    return { ...patch, ...(overrides[health.status] || {}) };
  }

  async updateSettings(patch) {
    const settings = await this.gateway.updateSettings(patch);
    this.applyExternalSettings(settings);
    return settings;
  }

  applyExternalSettings(settings) {
    const autoRefreshDisabled = this.state.settings?.autoRefreshOnStall && !settings.autoRefreshOnStall;
    const intervalChanged = this.state.settings?.intervalSeconds !== settings.intervalSeconds;
    this.patchState({ settings });
    if (autoRefreshDisabled) this.watchdog?.resetProtection();
    if (intervalChanged) this.restartInterval();
    if (settings.autoStart && !this.state.running) this.start().catch((error) => this.fail(error));
  }

  applyExternalData(summary) {
    this.patchState({
      totalSeen: summary.totalSeen,
      events: summary.recentEvents,
    });
  }

  testSound() {
    return this.gateway.testSound();
  }

  getExportData() {
    return this.gateway.getExportData();
  }

  retryNarrative(tokenId, detectedAt) {
    return this.gateway.retryNarrative(tokenId, detectedAt);
  }

  async analyzeTopToken() {
    const token = await this.getCurrentTopToken();
    const result = await this.gateway.manualNarrative(token);
    this.patchState({ events: result.summary.recentEvents });
    return result.event;
  }

  async analyzeContract(rawAddress) {
    const address = parseManualContractAddress(rawAddress);
    const pageToken = await this.getCurrentTopToken();
    const token = buildMinimalCaToken(pageToken?.chain, address);
    const result = await this.gateway.manualNarrative(token);
    this.patchState({ events: result.summary.recentEvents });
    return result.event;
  }

  async getCurrentTopToken() {
    const tokens = await this.source.readTokens({ deep: false });
    const token = tokens.reduce((top, item) => {
      if (!top) return item;
      return Number(item.rank) < Number(top.rank) ? item : top;
    }, null);
    if (!token) throw new Error("当前页面没有可分析的榜单代币");
    return token;
  }

  async clearData() {
    const summary = await this.gateway.clearData();
    this.needsBaseline = true;
    this.patchState({
      totalSeen: summary.totalSeen,
      events: summary.recentEvents,
      sessionNew: 0,
      lastFresh: [],
    });
    await this.gateway.updateBadge(0);
    if (this.state.running) await this.scan({ baseline: true, completeSnapshot: true });
  }

  restartInterval() {
    clearInterval(this.scanTimer);
    if (!this.state.running || !this.state.settings) return;
    this.scanTimer = setInterval(
      () => this.scan(),
      Number(this.state.settings.intervalSeconds) * 1000,
    );
  }

  restartFullScanInterval() {
    clearInterval(this.fullScanTimer);
    if (!this.state.running) return;
    this.fullScanTimer = setInterval(
      () => this.tryBackgroundFullScan(),
      SCANNER.FULL_SCAN_INTERVAL_SECONDS * 1000,
    );
  }

  tryBackgroundFullScan() {
    if (!this.state.running || !this.source.canRunBackgroundFullScan()) return;
    this.scan({ completeSnapshot: true }).catch((error) => this.fail(error));
  }

  clearRuntimeHooks() {
    clearInterval(this.scanTimer);
    clearInterval(this.fullScanTimer);
    clearTimeout(this.debounceTimer);
    const runtimeCleanups = this.runtimeCleanups.splice(0);
    runtimeCleanups.forEach((cleanup) => cleanup());
  }

  patchState(patch) {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  fail(error) {
    console.error("[监控引擎] 启动失败", error);
    this.patchState({ status: STATUS.ERROR, statusText: "启动失败", error: error.message });
  }
}
