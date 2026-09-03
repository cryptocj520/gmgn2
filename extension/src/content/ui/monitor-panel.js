import { LIMITS } from "../../shared/constants.js";
import { formatClock, shortAddress } from "../../shared/token.js";
import { PANEL_STYLES } from "./panel-styles.js";

export class MonitorPanel {
  constructor(engine) {
    this.engine = engine;
    this.elements = {};
    this.expanded = true;
    this.settingsOpen = false;
    this.toastTimer = 0;
    this.retentionSaveTimer = 0;
    this.connectionSaveTimer = 0;
    this.alertRankSaveTimer = 0;
    this.lastFreshKey = "";
    this.originalTitle = document.title;
    this.titleTimer = 0;
  }

  mount(parent) {
    const host = document.createElement("div");
    host.id = "gmgn-monitor-extension-root";
    parent.appendChild(host);
    this.shadow = host.attachShadow({ mode: "open" });
    this.shadow.innerHTML = `<style>${PANEL_STYLES}</style>${this.template()}`;
    this.captureElements();
    this.bindEvents();
    this.unsubscribe = this.engine.subscribe((state) => this.render(state));
  }

  template() {
    return `
      <button class="launcher" id="launcher" type="button" title="打开 GMGN 热门监控"><span class="launcher-icon">♪</span><span class="launcher-badge" id="launcherBadge">0</span></button>
      <section class="panel" id="panel" aria-label="GMGN 热门币监控">
        <header class="header">
          <span class="brand-mark"></span>
          <div class="title-wrap"><div class="title">GMGN 热门监控</div><div class="subtitle"><span class="status-dot" id="statusDot"></span><span id="statusText">正在准备</span></div></div>
          <button class="icon-button" id="settingsButton" type="button" title="设置">⚙</button>
          <button class="icon-button" id="collapseButton" type="button" title="收起">×</button>
        </header>
        <div class="toolbar"><div class="primary-row">
          <button class="primary" id="startButton" type="button"><span id="startIcon">▶</span><span id="startLabel">开始监控</span></button>
          <div class="sound-wrap" title="声音提醒"><span class="sound-label">声音</span><label class="switch"><input id="soundToggle" type="checkbox"><span class="switch-track"></span></label></div>
          <button class="secondary" id="testSoundButton" type="button" title="试听提醒音">♪</button>
        </div></div>
        <div class="stats">
          <div class="stat"><span class="stat-value" id="seenValue">0</span><span class="stat-label">本地币种</span></div>
          <div class="stat"><span class="stat-value" id="currentValue">0</span><span class="stat-label">当前榜单</span></div>
          <div class="stat"><span class="stat-value hot" id="newValue">0</span><span class="stat-label">本次提醒</span></div>
          <div class="stat"><span class="stat-value" id="scanValue">--:--</span><span class="stat-label">最近扫描</span></div>
        </div>
        <div class="content"><div class="section-head"><span class="section-title">提醒记录</span><span class="section-count" id="eventCount">0 条</span></div><div class="events" id="events"></div></div>
        <footer class="footer"><span class="footer-state"></span><span>全局合约去重 · 跟随当前筛选</span><span class="footer-spacer"></span><span class="version">v0.6.1</span></footer>
        <aside class="settings" id="settingsPanel">
          <h2 class="settings-title">监控设置</h2>
          ${this.toggleSetting("autoStartToggle", "打开页面自动监控", "首次榜单仍会静默建立基线")}
          ${this.toggleSetting("desktopToggle", "桌面通知", "声音以外再显示系统通知")}
          ${this.toggleSetting("autoRefreshToggle", "连接超时自动刷新", "读取 GMGN 底部连接状态")}
          <div class="setting-row"><div class="setting-main"><div class="setting-name">成交额提醒名次</div><div class="setting-note">仅首次发现且进入前 N 名</div></div><input class="number-input" id="alertTopN" type="number" min="1" max="100" step="1" aria-label="成交额提醒前几名"><span class="unit">名</span></div>
          <div class="setting-row"><div class="setting-main"><div class="setting-name">扫描间隔</div><div class="setting-note">页面变化也会触发扫描</div></div><select id="intervalSelect" aria-label="扫描间隔"><option value="5">5 秒</option><option value="10">10 秒</option><option value="20">20 秒</option><option value="30">30 秒</option><option value="60">60 秒</option></select></div>
          <div class="setting-row"><div class="setting-main"><div class="setting-name">连接异常等待</div><div class="setting-note">持续异常后才自动刷新</div></div><input class="number-input" id="connectionTimeoutSeconds" type="number" min="10" max="300" step="5" aria-label="连接异常等待秒数"><span class="unit">秒</span></div>
          <div class="setting-row"><div class="setting-main"><div class="setting-name">缺席记录保留</div><div class="setting-note">连续未出现后自动删除</div></div><input class="number-input" id="retentionDays" type="number" min="1" max="365" step="1" aria-label="缺席记录保留天数"><span class="unit">天</span></div>
          <div class="data-actions"><button class="action-button" id="exportButton" type="button">导出记录</button><button class="action-button danger" id="clearButton" type="button">清空记录</button></div>
        </aside>
        <div class="toast" id="toast"></div>
      </section>`;
  }

  toggleSetting(id, name, note) {
    return `<div class="setting-row"><div class="setting-main"><div class="setting-name">${name}</div><div class="setting-note">${note}</div></div><label class="switch"><input id="${id}" type="checkbox"><span class="switch-track"></span></label></div>`;
  }

  captureElements() {
    const ids = [
      "launcher", "launcherBadge", "panel", "statusDot", "statusText", "settingsButton",
      "collapseButton", "settingsPanel", "startButton", "startIcon", "startLabel", "soundToggle",
      "testSoundButton", "seenValue", "currentValue", "newValue", "scanValue", "eventCount",
      "events", "autoStartToggle", "desktopToggle", "autoRefreshToggle", "intervalSelect",
      "connectionTimeoutSeconds", "retentionDays", "alertTopN",
      "exportButton", "clearButton", "toast",
    ];
    this.elements = Object.fromEntries(ids.map((id) => [id, this.shadow.getElementById(id)]));
  }

  bindEvents() {
    this.elements.launcher.addEventListener("click", () => this.setExpanded(true));
    this.elements.collapseButton.addEventListener("click", () => this.setExpanded(false));
    this.elements.settingsButton.addEventListener("click", () => {
      this.settingsOpen = !this.settingsOpen;
      this.elements.settingsPanel.classList.toggle("show", this.settingsOpen);
    });
    this.elements.startButton.addEventListener("click", () => {
      const action = this.engine.getState().running ? this.engine.stop() : this.engine.start();
      Promise.resolve(action).catch((error) => this.showToast(error.message, true));
    });
    this.bindSetting("soundToggle", "sound");
    this.bindSetting("autoStartToggle", "autoStart");
    this.bindSetting("desktopToggle", "desktopNotifications");
    this.bindSetting("autoRefreshToggle", "autoRefreshOnStall");
    this.elements.intervalSelect.addEventListener("change", () => {
      this.engine.updateSettings({ intervalSeconds: Number(this.elements.intervalSelect.value) })
        .then(() => this.showToast("扫描间隔已更新"))
        .catch((error) => this.showToast(error.message, true));
    });
    this.elements.retentionDays.addEventListener("input", () => {
      clearTimeout(this.retentionSaveTimer);
      const value = Number(this.elements.retentionDays.value);
      if (!Number.isFinite(value)) return;
      this.retentionSaveTimer = setTimeout(() => {
        this.engine.updateSettings({ retentionDays: value })
          .then(() => this.showToast("保留时间已更新"))
          .catch((error) => this.showToast(error.message, true));
      }, 350);
    });
    this.elements.connectionTimeoutSeconds.addEventListener("input", () => {
      clearTimeout(this.connectionSaveTimer);
      const value = Number(this.elements.connectionTimeoutSeconds.value);
      if (!Number.isFinite(value)) return;
      this.connectionSaveTimer = setTimeout(() => {
        this.engine.updateSettings({ connectionTimeoutSeconds: value })
          .then(() => this.showToast("连接等待时间已更新"))
          .catch((error) => this.showToast(error.message, true));
      }, 350);
    });
    this.elements.alertTopN.addEventListener("input", () => {
      clearTimeout(this.alertRankSaveTimer);
      const value = Number(this.elements.alertTopN.value);
      if (!Number.isFinite(value)) return;
      this.alertRankSaveTimer = setTimeout(() => {
        this.engine.updateSettings({ alertTopN: value })
          .then(() => this.showToast("提醒名次已更新"))
          .catch((error) => this.showToast(error.message, true));
      }, 350);
    });
    this.elements.testSoundButton.addEventListener("click", () => {
      this.engine.testSound()
        .then(() => this.showToast("提醒音正常"))
        .catch((error) => this.showToast(error.message, true));
    });
    this.elements.exportButton.addEventListener("click", () => this.exportData());
    this.elements.clearButton.addEventListener("click", () => this.clearData());
  }

  bindSetting(elementId, key) {
    this.elements[elementId].addEventListener("change", () => {
      this.engine.updateSettings({ [key]: this.elements[elementId].checked })
        .catch((error) => this.showToast(error.message, true));
    });
  }

  render(state) {
    this.elements.statusText.textContent = state.statusText;
    this.elements.statusDot.className = `status-dot ${state.status}`;
    this.elements.seenValue.textContent = String(state.totalSeen);
    this.elements.currentValue.textContent = String(state.currentCount);
    this.elements.newValue.textContent = String(state.sessionNew);
    this.elements.scanValue.textContent = state.lastScanAt ? formatClock(state.lastScanAt).slice(0, 5) : "--:--";
    this.elements.eventCount.textContent = `${state.events.length} 条`;
    this.elements.startButton.classList.toggle("stop", state.running);
    this.elements.startIcon.textContent = state.running ? "■" : "▶";
    this.elements.startLabel.textContent = state.running ? "停止监控" : "开始监控";
    this.elements.launcherBadge.textContent = state.sessionNew > 99 ? "99+" : String(state.sessionNew);
    this.elements.launcherBadge.classList.toggle("show", state.sessionNew > 0);
    this.renderSettings(state.settings);
    this.renderEvents(state.events.slice(0, LIMITS.PANEL_EVENTS));
    this.handleFresh(state.lastFresh);
    if (state.error) this.showToast(state.error, true);
  }

  renderSettings(settings) {
    if (!settings) return;
    this.elements.soundToggle.checked = settings.sound;
    this.elements.autoStartToggle.checked = settings.autoStart;
    this.elements.desktopToggle.checked = settings.desktopNotifications;
    this.elements.autoRefreshToggle.checked = settings.autoRefreshOnStall;
    this.elements.intervalSelect.value = String(settings.intervalSeconds);
    if (this.shadow.activeElement !== this.elements.connectionTimeoutSeconds) {
      this.elements.connectionTimeoutSeconds.value = String(settings.connectionTimeoutSeconds);
    }
    if (this.shadow.activeElement !== this.elements.alertTopN) {
      this.elements.alertTopN.value = String(settings.alertTopN);
    }
    if (this.shadow.activeElement !== this.elements.retentionDays) {
      this.elements.retentionDays.value = String(settings.retentionDays);
    }
  }

  renderEvents(events) {
    this.elements.events.replaceChildren();
    if (!events.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.innerHTML = '<div><span class="empty-glyph">◎</span><span>暂无提醒</span></div>';
      this.elements.events.appendChild(empty);
      return;
    }
    events.forEach((event) => this.elements.events.appendChild(this.createEvent(event)));
  }

  createEvent(event) {
    const link = document.createElement("a");
    link.className = "event";
    link.href = event.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const image = document.createElement("span");
    image.className = "token-image";
    if (event.image) {
      const img = document.createElement("img");
      img.src = event.image;
      img.alt = "";
      img.loading = "lazy";
      image.appendChild(img);
    } else {
      image.textContent = (event.symbol || "?").slice(0, 1).toUpperCase();
    }

    const main = document.createElement("span");
    main.className = "event-main";
    const nameLine = document.createElement("span");
    nameLine.className = "event-name";
    const symbol = document.createElement("span");
    symbol.className = "symbol";
    symbol.textContent = event.symbol || "未知代币";
    const chain = document.createElement("span");
    chain.className = "chain";
    chain.textContent = event.chain;
    nameLine.append(symbol, chain);
    const meta = document.createElement("span");
    meta.className = "event-meta";
    meta.textContent = [event.name !== event.symbol ? event.name : "", event.age, shortAddress(event.address)].filter(Boolean).join(" · ");
    main.append(nameLine, meta);

    const side = document.createElement("span");
    side.className = "event-side";
    const marketCap = document.createElement("span");
    marketCap.className = "market-cap";
    marketCap.textContent = event.marketCap || "--";
    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = formatClock(event.detectedAt || event.firstSeen);
    side.append(marketCap, time);
    link.append(image, main, side);
    return link;
  }

  handleFresh(fresh) {
    if (!fresh.length) return;
    const key = fresh.map((token) => `${token.id}:${token.detectedAt}`).join("|");
    if (key === this.lastFreshKey) return;
    this.lastFreshKey = key;
    this.flashTitle(fresh.length);
  }

  flashTitle(count) {
    clearInterval(this.titleTimer);
    let ticks = 0;
    this.titleTimer = setInterval(() => {
      document.title = ticks % 2 ? this.originalTitle : `【${count} 个新币】GMGN`;
      ticks += 1;
      if (ticks >= 8) {
        clearInterval(this.titleTimer);
        document.title = this.originalTitle;
      }
    }, 650);
  }

  async exportData() {
    try {
      const data = await this.engine.getExportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `gmgn-monitor-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.showToast(`已导出 ${data.tokens.length} 个代币`);
    } catch (error) {
      this.showToast(error.message || "导出失败", true);
    }
  }

  async clearData() {
    if (!window.confirm("清空扩展保存的所有代币和提醒记录？此操作不可撤销。")) return;
    try {
      await this.engine.clearData();
      this.showToast("本地记录已清空");
    } catch (error) {
      this.showToast(error.message || "清空失败", true);
    }
  }

  setExpanded(expanded) {
    this.expanded = expanded;
    this.elements.panel.classList.toggle("hidden", !expanded);
    this.elements.launcher.classList.toggle("show", !expanded);
    if (!expanded) {
      this.settingsOpen = false;
      this.elements.settingsPanel.classList.remove("show");
    }
  }

  showToast(message, isError = false) {
    clearTimeout(this.toastTimer);
    this.elements.toast.textContent = message;
    this.elements.toast.className = `toast show${isError ? " error" : ""}`;
    this.toastTimer = setTimeout(() => {
      this.elements.toast.className = "toast";
    }, 2600);
  }
}
