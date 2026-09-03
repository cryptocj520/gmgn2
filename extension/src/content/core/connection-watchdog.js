import { WATCHDOG } from "../../shared/constants.js";

export class ConnectionWatchdog {
  constructor({
    storage = sessionStorage,
    clock = () => Date.now(),
    isOnline = () => navigator.onLine,
    reload = () => location.reload(),
  } = {}) {
    this.storage = storage;
    this.clock = clock;
    this.isOnline = isOnline;
    this.reload = reload;
    this.reloadTimer = 0;
    this.state = this.loadState();
  }

  check(connection, settings) {
    const now = this.clock();
    if (!settings.autoRefreshOnStall) {
      this.resetProtection();
      return { status: "disabled" };
    }

    const historyChanged = this.trimReloadHistory(now);
    const online = this.isOnline();
    const healthy = online && connection.available && connection.healthy;
    if (healthy) {
      const recovered = this.state.unhealthySince != null || this.state.blocked;
      this.state.unhealthySince = null;
      this.state.blocked = false;
      if (recovered || historyChanged) this.saveState();
      return { status: "healthy", connection };
    }

    if (this.state.unhealthySince == null) {
      this.state.unhealthySince = now;
      this.saveState();
    }
    if (!online) return { status: "offline", connection };
    if (this.state.blocked) return { status: "blocked", maxReloads: WATCHDOG.MAX_RELOADS, connection };

    const timeoutMs = settings.connectionTimeoutSeconds * 1000;
    const elapsedMs = now - this.state.unhealthySince;
    if (elapsedMs < timeoutMs) {
      return {
        status: "pending",
        remainingSeconds: Math.ceil((timeoutMs - elapsedMs) / 1000),
        connection,
      };
    }

    if (this.state.reloadHistory.length >= WATCHDOG.MAX_RELOADS) {
      this.state.blocked = true;
      this.saveState();
      return { status: "blocked", maxReloads: WATCHDOG.MAX_RELOADS, connection };
    }

    this.state.reloadHistory.push(now);
    this.state.unhealthySince = now;
    this.saveState();
    this.scheduleReload();
    return {
      status: "reload",
      attempt: this.state.reloadHistory.length,
      maxReloads: WATCHDOG.MAX_RELOADS,
      timeoutSeconds: settings.connectionTimeoutSeconds,
      connection,
    };
  }

  scheduleReload() {
    if (this.reloadTimer) return;
    this.reloadTimer = setTimeout(() => this.reload(), WATCHDOG.RELOAD_DELAY_MS);
  }

  trimReloadHistory(now) {
    const previousLength = this.state.reloadHistory.length;
    const windowMs = WATCHDOG.RELOAD_WINDOW_MINUTES * 60 * 1000;
    this.state.reloadHistory = this.state.reloadHistory.filter((timestamp) => now - timestamp < windowMs);
    return previousLength !== this.state.reloadHistory.length;
  }

  resetProtection() {
    const alreadyReset = this.state.unhealthySince == null &&
      this.state.reloadHistory.length === 0 &&
      !this.state.blocked;
    if (alreadyReset) return;
    clearTimeout(this.reloadTimer);
    this.reloadTimer = 0;
    this.state = {
      unhealthySince: null,
      reloadHistory: [],
      blocked: false,
    };
    this.saveState();
  }

  loadState() {
    try {
      const stored = JSON.parse(this.storage.getItem(WATCHDOG.STORAGE_KEY) || "null");
      if (stored && Array.isArray(stored.reloadHistory)) {
        return {
          unhealthySince: Number.isFinite(stored.unhealthySince) ? stored.unhealthySince : null,
          reloadHistory: stored.reloadHistory,
          blocked: Boolean(stored.blocked),
        };
      }
    } catch (_) {
      // 会话存储不可用时退化为当前页面内存状态。
    }
    return {
      unhealthySince: null,
      reloadHistory: [],
      blocked: false,
    };
  }

  saveState() {
    try {
      this.storage.setItem(WATCHDOG.STORAGE_KEY, JSON.stringify(this.state));
    } catch (_) {
      // 写入失败不影响榜单扫描，只失去跨刷新次数保护。
    }
  }
}
