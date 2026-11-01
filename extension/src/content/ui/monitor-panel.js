import { LIMITS } from "../../shared/constants.js";
import { formatClock, formatMonthDayClock, shortAddress } from "../../shared/token.js";
import { PanelLayoutController } from "./panel-layout-controller.js";
import { PANEL_STYLES } from "./panel-styles.js";

// 置信度等级 -> 显示文字，列表标签和详情页共用一份
const CONFIDENCE_LABELS = { high: "高置信度", medium: "中置信度", low: "低置信度" };
const NARRATIVE_IN_PROGRESS = new Set(["queued", "retrying"]);

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
    this.selectedEventKey = "";
    this.listView = "events";
    this.menuEvent = null;
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
    this.layout = new PanelLayoutController({
      panel: this.elements.panel,
      dragHandle: this.elements.panelHeader,
      shrinkButton: this.elements.shrinkPanelButton,
      growButton: this.elements.growPanelButton,
      onChange: (patch) => this.savePanelLayout(patch),
    });
    this.bindEvents();
    this.unsubscribe = this.engine.subscribe((state) => this.render(state));
  }

  template() {
    return `
      <button class="launcher" id="launcher" type="button" title="打开 GMGN 热门监控"><span class="launcher-icon">♪</span><span class="launcher-badge" id="launcherBadge">0</span></button>
      <section class="panel" id="panel" aria-label="GMGN 热门币监控">
        <header class="header" id="panelHeader" tabindex="0" aria-label="悬浮面板，可拖动或使用方向键移动">
          <span class="brand-mark"></span>
          <div class="title-wrap"><div class="title">GMGN 热门监控</div><div class="subtitle"><span class="status-dot" id="statusDot"></span><span id="statusText">正在准备</span></div></div>
          <button class="icon-button size-button" id="shrinkPanelButton" type="button" title="缩小面板">−</button>
          <button class="icon-button size-button" id="growPanelButton" type="button" title="放大面板">+</button>
          <button class="icon-button" id="settingsButton" type="button" title="设置">⚙</button>
          <button class="icon-button" id="collapseButton" type="button" title="隐藏面板（监控继续运行）">×</button>
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
        <div class="content"><div class="section-head"><div class="list-tabs" role="tablist"><button class="list-tab active" id="eventsTab" type="button" role="tab">提醒记录</button><button class="list-tab" id="favoritesTab" type="button" role="tab">关注</button><button class="list-tab" id="confidenceTab" type="button" role="tab">置信度 0</button></div><span class="section-count" id="eventCount">0 条</span></div><div class="events" id="events"></div></div>
        <div class="row-menu" id="rowMenu" role="menu"><button type="button" role="menuitem" data-action="copy">复制地址</button><button type="button" role="menuitem" data-action="open">打开代币页</button><button type="button" role="menuitem" data-action="analyze">分析代币</button><button type="button" role="menuitem" data-action="favorite" id="rowMenuFavorite">关注</button></div>
        <footer class="footer"><span class="footer-state"></span><span>首次进入提醒名次 · 跟随当前筛选</span><span class="footer-spacer"></span><span class="version">v0.14.0</span></footer>
        <aside class="settings" id="settingsPanel">
          <h2 class="settings-title">监控设置</h2>
          ${this.toggleSetting("autoStartToggle", "打开页面自动监控", "首次榜单仍会静默建立基线")}
          ${this.toggleSetting("desktopToggle", "桌面通知", "声音以外再显示系统通知")}
          ${this.toggleSetting("autoRefreshToggle", "连接超时自动刷新", "读取 GMGN 底部连接状态")}
          ${this.toggleSetting("narrativeToggle", "自动叙事分析", "报警后调用 Grok 分析")}
          <div class="setting-row"><div class="setting-main"><div class="setting-name">Grok API</div><div class="setting-note">在扩展弹窗中配置接口和密钥</div></div><span class="api-state" id="narrativeApiState">未配置</span></div>
          <button class="action-button manual-analysis" id="manualNarrativeButton" type="button">手动分析当前榜首</button>
          <div class="ca-action">
            <label for="manualCaAddress">分析指定 CA</label>
            <input id="manualCaAddress" type="text" placeholder="合约地址，沿用当前热门榜页面的链" autocomplete="off" spellcheck="false">
            <button class="action-button manual-analysis" id="manualCaNarrative" type="button">分析该 CA</button>
          </div>
          <div class="setting-row"><div class="setting-main"><div class="setting-name">成交额提醒名次</div><div class="setting-note">首次进入前 N 名时提醒</div></div><input class="number-input" id="alertTopN" type="number" min="1" max="100" step="1" aria-label="成交额提醒前几名"><span class="unit">名</span></div>
          <div class="setting-row"><div class="setting-main"><div class="setting-name">扫描间隔</div><div class="setting-note">页面变化也会触发扫描</div></div><select id="intervalSelect" aria-label="扫描间隔"><option value="5">5 秒</option><option value="10">10 秒</option><option value="20">20 秒</option><option value="30">30 秒</option><option value="60">60 秒</option></select></div>
          <div class="setting-row"><div class="setting-main"><div class="setting-name">连接异常等待</div><div class="setting-note">持续异常后才自动刷新</div></div><input class="number-input" id="connectionTimeoutSeconds" type="number" min="10" max="300" step="5" aria-label="连接异常等待秒数"><span class="unit">秒</span></div>
          <div class="setting-row"><div class="setting-main"><div class="setting-name">缺席记录保留</div><div class="setting-note">连续未出现后自动删除</div></div><input class="number-input" id="retentionDays" type="number" min="1" max="365" step="1" aria-label="缺席记录保留天数"><span class="unit">天</span></div>
          <div class="data-actions"><button class="action-button" id="exportButton" type="button">导出记录</button><button class="action-button danger" id="clearButton" type="button">清空记录</button></div>
        </aside>
        <aside class="narrative-detail" id="narrativeDetail">
          <div class="detail-head"><button class="icon-button" id="detailBack" type="button" title="返回提醒列表">←</button><div><strong id="detailSymbol">--</strong><span id="detailMeta">--</span></div><a id="detailTokenLink" target="_blank" rel="noopener noreferrer" title="打开 GMGN 代币页">↗</a></div>
          <div class="detail-scroll">
            <div class="detail-status" id="detailStatus"></div>
            <div id="detailContent">
              <div class="detail-intro"><div class="detail-kicker"><span id="detailConfidence">--</span><span id="detailAnalyzedAt">--</span></div><h2 id="detailTitle">--</h2><p id="detailSummary"></p><div class="tag-list" id="detailTags"></div></div>
              <section class="detail-section story-section"><h3>故事背景</h3><p class="narrative-copy" id="detailNarrative"></p><div class="story-grid"><div><h4>关键人物 / 事件</h4><p id="detailStoryPeople"></p></div><div><h4>为什么现在走热</h4><p id="detailStoryWhyNow"></p></div></div><div class="timeline" id="detailStoryTimeline"></div></section>
              <section class="detail-section sentiment-section"><div class="sentiment-heading"><h3>X 上的真实舆情</h3><span id="detailXSearchStatus">--</span></div><p class="x-overview" id="detailXOverview"></p><div class="sentiment-grid"><div><h4>正面观点</h4><div id="detailPositive"></div></div><div class="negative-column"><h4>负面观点</h4><div id="detailNegative"></div></div></div></section>
              <section class="detail-section verification-section"><h3>哪些可信，哪些只是说法</h3><div class="verification-grid"><div><h4>已确认</h4><ul id="detailConfirmed"></ul></div><div><h4>项目方自述</h4><ul id="detailClaims"></ul></div><div><h4>仍未确认</h4><ul id="detailUnknowns"></ul></div></div></section>
              <section class="detail-section potential-section"><div class="potential-heading"><h3>故事能否延续</h3><span id="detailOutlook">观察项</span></div><div class="potential-grid"><div><h4>延续条件</h4><ul id="detailCatalysts"></ul></div><div><h4>破坏故事的信号</h4><ul id="detailInvalidations"></ul></div><div><h4>下一步看什么</h4><ul id="detailWatchItems"></ul></div></div></section>
              <section class="detail-section market-section"><h3>市场背景</h3><p class="narrative-copy" id="detailMarketContext"></p></section>
              <section class="detail-section risk-section"><h3>交易风险（次要参考）</h3><ul id="detailRisks"></ul></section>
              <section class="detail-section"><h3>信息来源</h3><div class="source-list" id="detailSources"></div></section>
            </div>
            <button class="action-button" id="retryNarrative" type="button">重新分析</button>
          </div>
        </aside>
        <div class="recent-confirm" id="recentConfirm" hidden><div id="recentConfirmText"></div><div class="recent-actions"><button class="action-button" id="recentView" type="button">查看已有分析</button><button class="action-button" id="recentForce" type="button">仍然重新分析</button><button class="action-button" id="recentCancel" type="button">取消</button></div></div>
        <div class="toast" id="toast"></div>
      </section>`;
  }

  toggleSetting(id, name, note) {
    return `<div class="setting-row"><div class="setting-main"><div class="setting-name">${name}</div><div class="setting-note">${note}</div></div><label class="switch"><input id="${id}" type="checkbox"><span class="switch-track"></span></label></div>`;
  }

  captureElements() {
    const ids = [
      "launcher", "launcherBadge", "panel", "panelHeader", "statusDot", "statusText", "settingsButton",
      "shrinkPanelButton", "growPanelButton", "collapseButton", "settingsPanel", "startButton", "startIcon", "startLabel", "soundToggle",
      "testSoundButton", "seenValue", "currentValue", "newValue", "scanValue", "eventCount",
      "events", "autoStartToggle", "desktopToggle", "autoRefreshToggle", "narrativeToggle", "intervalSelect",
      "connectionTimeoutSeconds", "retentionDays", "alertTopN",
      "narrativeApiState", "exportButton", "clearButton", "toast", "narrativeDetail", "detailBack",
      "detailSymbol", "detailMeta", "detailTokenLink", "detailStatus", "detailContent", "detailConfidence",
      "detailAnalyzedAt", "detailTitle", "detailSummary", "detailTags", "detailNarrative",
      "detailOutlook", "detailCatalysts", "detailInvalidations", "detailWatchItems",
      "detailXSearchStatus", "detailXOverview", "detailPositive", "detailNegative",
      "detailStoryPeople", "detailStoryWhyNow", "detailStoryTimeline", "detailMarketContext",
      "detailConfirmed", "detailClaims", "detailUnknowns",
      "detailRisks", "detailSources", "retryNarrative", "manualNarrativeButton",
      "manualCaAddress", "manualCaNarrative", "eventsTab", "favoritesTab", "confidenceTab", "rowMenu", "rowMenuFavorite",
      "recentConfirm", "recentConfirmText", "recentView", "recentForce", "recentCancel",
    ];
    this.elements = Object.fromEntries(ids.map((id) => [id, this.shadow.getElementById(id)]));
  }

  bindEvents() {
    this.elements.launcher.addEventListener("click", () => this.setExpanded(true));
    this.elements.collapseButton.addEventListener("click", () => this.setExpanded(false));
    this.elements.settingsButton.addEventListener("click", () => {
      if (this.selectedEventKey) this.closeNarrative();
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
    this.bindSetting("narrativeToggle", "narrativeEnabled");
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
    this.elements.detailBack.addEventListener("click", () => this.closeNarrative());
    this.elements.retryNarrative.addEventListener("click", () => this.retrySelectedNarrative());
    this.elements.manualNarrativeButton.addEventListener("click", () => this.analyzeTopToken());
    this.elements.manualCaNarrative.addEventListener("click", () => this.analyzeManualCa());
    this.elements.manualCaAddress.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.analyzeManualCa();
    });
    this.elements.eventsTab.addEventListener("click", () => this.setListView("events"));
    this.elements.favoritesTab.addEventListener("click", () => this.setListView("favorites"));
    this.elements.confidenceTab.addEventListener("click", () => this.setListView("confidence"));
    this.bindRowMenu();
  }

  // 每行只留一个“⋯”入口，具体操作集中在这一个浮动菜单里
  bindRowMenu() {
    const actions = {
      copy: (event) => this.copyTokenAddress(event),
      open: (event) => this.openTokenPage(event),
      analyze: (event) => this.analyzeEventToken(event),
      favorite: (event) => this.toggleFavorite(event),
    };
    this.elements.rowMenu.addEventListener("click", (domEvent) => {
      const action = actions[domEvent.target.closest("[data-action]")?.dataset.action];
      const event = this.menuEvent;
      this.closeRowMenu();
      if (action && event) action(event);
    });
    // 点击菜单以外的地方、按 Esc 或滚动列表时收起菜单
    this.shadow.addEventListener("pointerdown", (domEvent) => {
      const path = domEvent.composedPath();
      if (!path.includes(this.elements.rowMenu) && !path.some((node) => node.classList?.contains("row-more"))) {
        this.closeRowMenu();
      }
    });
    this.shadow.addEventListener("keydown", (domEvent) => {
      if (domEvent.key === "Escape") this.closeRowMenu();
    });
    this.elements.events.addEventListener("scroll", () => this.closeRowMenu());
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
    const listItems = this.listItems(state);
    this.elements.eventCount.textContent = `${listItems.length} 条`;
    this.elements.favoritesTab.textContent = state.favorites.length ? `关注 ${state.favorites.length}` : "关注";
    this.elements.confidenceTab.textContent = `置信度 ${state.confidenceGroup.length}`;
    this.elements.startButton.classList.toggle("stop", state.running);
    this.elements.startIcon.textContent = state.running ? "■" : "▶";
    this.elements.startLabel.textContent = state.running ? "停止监控" : "开始监控";
    this.elements.launcherBadge.textContent = state.sessionNew > 99 ? "99+" : String(state.sessionNew);
    this.elements.launcherBadge.classList.toggle("show", state.sessionNew > 0);
    this.renderSettings(state.settings);
    this.favoriteIds = new Set(state.favorites.map((item) => item.id));
    this.renderEvents(listItems);
    this.renderIntegration(state.integrations);
    this.refreshSelectedNarrative(state.events);
    this.handleFresh(state.lastFresh);
    if (state.error) this.showToast(state.error, true);
  }

  renderSettings(settings) {
    if (!settings) return;
    this.elements.soundToggle.checked = settings.sound;
    this.elements.autoStartToggle.checked = settings.autoStart;
    this.elements.desktopToggle.checked = settings.desktopNotifications;
    this.elements.autoRefreshToggle.checked = settings.autoRefreshOnStall;
    this.elements.narrativeToggle.checked = settings.narrativeEnabled;
    this.elements.intervalSelect.value = String(settings.intervalSeconds);
    this.layout.apply(settings);
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

  savePanelLayout(patch) {
    return this.engine.updateSettings(patch)
      .catch((error) => this.showToast(error.message || "面板布局保存失败", true));
  }

  // 关注列表优先显示该代币最近一条提醒（带叙事和行情），提醒已被清理时退回关注时保存的基本信息
  listItems(state) {
    if (this.listView === "events") return state.events.slice(0, LIMITS.PANEL_EVENTS);
    const latestById = new Map();
    state.events.forEach((event) => {
      if (!latestById.has(event.id)) latestById.set(event.id, event);
    });
    if (this.listView === "favorites") return state.favorites.map((favorite) =>
      latestById.get(favorite.id) || { ...favorite, detectedAt: favorite.favoritedAt, favoriteOnly: true }
    );
    return state.confidenceGroup.map((item) => {
      const event = latestById.get(item.id);
      return event ? { ...event, narrative: NARRATIVE_IN_PROGRESS.has(event.narrative?.status) ? event.narrative : item.narrative }
        : { ...item, detectedAt: item.analyzedAt, favoriteOnly: true };
    });
  }

  setListView(view) {
    this.listView = view;
    this.closeRowMenu();
    this.elements.eventsTab.classList.toggle("active", view === "events");
    this.elements.favoritesTab.classList.toggle("active", view === "favorites");
    this.elements.confidenceTab.classList.toggle("active", view === "confidence");
    this.render(this.engine.getState());
  }

  renderEvents(events) {
    this.elements.events.replaceChildren();
    if (!events.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      const text = {
        favorites: "暂无关注，可在提醒的 ⋯ 菜单里添加",
        confidence: "暂无中高置信度代币，分析完成后会自动加入",
        events: "暂无提醒",
      }[this.listView];
      empty.innerHTML = `<div><span class="empty-glyph">◎</span><span>${text}</span></div>`;
      this.elements.events.appendChild(empty);
      return;
    }
    events.forEach((event) => this.elements.events.appendChild(this.createEvent(event)));
  }

  createEvent(event) {
    const row = document.createElement("div");
    row.className = "event";

    const openButton = document.createElement("button");
    openButton.className = "event-open";
    openButton.type = "button";
    openButton.setAttribute("aria-label", `查看 ${event.symbol || "未知代币"} 的叙事分析`);
    openButton.addEventListener("click", () => this.openNarrative(event));

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
    chain.textContent = event.manual ? `${event.chain} · 手动` : event.chain;
    const confidenceBadge = this.confidenceBadge(event.narrative);
    if (confidenceBadge) nameLine.append(confidenceBadge);
    nameLine.append(symbol, chain);
    if (this.favoriteIds?.has(event.id)) {
      const star = document.createElement("span");
      star.className = "favorite-mark";
      star.title = "已关注";
      star.textContent = "★";
      nameLine.appendChild(star);
    }
    const meta = document.createElement("span");
    meta.className = "event-meta";
    meta.textContent = this.narrativePreview(event);
    if (event.narrative?.status) meta.classList.add(`narrative-${event.narrative.status}`);
    main.append(nameLine, meta);

    const side = document.createElement("span");
    side.className = "event-side";
    const marketCap = document.createElement("span");
    marketCap.className = "market-cap";
    marketCap.textContent = event.marketCap || "--";
    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = formatMonthDayClock(event.detectedAt || event.firstSeen);
    side.append(marketCap, time);

    const moreButton = document.createElement("button");
    moreButton.className = "row-more";
    moreButton.type = "button";
    moreButton.title = "更多操作";
    moreButton.setAttribute("aria-label", `${event.symbol || "该代币"} 的更多操作`);
    moreButton.setAttribute("aria-haspopup", "menu");
    moreButton.textContent = "⋯";
    moreButton.addEventListener("click", () => this.toggleRowMenu(event, moreButton));

    openButton.append(image, main, side);
    row.append(openButton, moreButton);
    return row;
  }

  toggleRowMenu(event, button) {
    const sameRow = this.menuEvent?.id === event.id && this.menuEvent?.detectedAt === event.detectedAt;
    if (sameRow) {
      this.closeRowMenu();
      return;
    }
    this.menuEvent = event;
    this.elements.rowMenuFavorite.textContent = this.favoriteIds?.has(event.id) ? "取消关注" : "关注";
    const menu = this.elements.rowMenu;
    menu.classList.add("show");
    // 菜单贴着按钮右侧对齐弹出；靠近面板底部时改为向上弹，避免被面板裁掉
    const panelRect = this.elements.panel.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const openUp = buttonRect.bottom + menu.offsetHeight > panelRect.bottom - 8;
    const top = openUp ? buttonRect.top - menu.offsetHeight : buttonRect.bottom;
    menu.style.top = `${Math.max(8, top - panelRect.top)}px`;
    menu.style.right = `${Math.max(8, panelRect.right - buttonRect.right)}px`;
  }

  // 分析完成后才显示置信度标签；未分析或分析失败时不显示
  confidenceBadge(narrative) {
    if (narrative?.status !== "ready" || !narrative.analysis) return null;
    const level = CONFIDENCE_LABELS[narrative.analysis.confidence] ? narrative.analysis.confidence : "low";
    const badge = document.createElement("span");
    badge.className = "confidence-badge";
    badge.dataset.level = level;
    badge.textContent = CONFIDENCE_LABELS[level];
    return badge;
  }

  closeRowMenu() {
    this.menuEvent = null;
    this.elements.rowMenu.classList.remove("show");
  }

  tokenAddress(event) {
    return event.address || String(event.id || "").split(":").slice(1).join(":");
  }

  async copyTokenAddress(event) {
    const address = this.tokenAddress(event);
    if (!address) {
      this.showToast("该提醒没有可复制的代币地址", true);
      return;
    }
    try {
      await this.writeClipboard(address);
      this.showToast("代币地址已复制");
    } catch (_) {
      this.showToast("复制失败，请检查浏览器剪贴板权限", true);
    }
  }

  // 新标签页打开，避免当前热门榜页面跳走后监控暂停
  openTokenPage(event) {
    if (!event.url) {
      this.showToast("该代币没有可打开的页面地址", true);
      return;
    }
    window.open(event.url, "_blank", "noopener,noreferrer");
  }

  // 有提醒记录就对这条记录重新排队，结果写回原记录；只剩关注信息时按 CA 分析
  async analyzeEventToken(event, force = false) {
    if (NARRATIVE_IN_PROGRESS.has(event.narrative?.status)) {
      this.openNarrative(event);
      this.showToast("该代币正在分析中");
      return;
    }
    try {
      const result = event.favoriteOnly
        ? await this.engine.analyzeContract(this.tokenAddress(event), force)
        : await this.engine.retryNarrative(event.id, event.detectedAt, force);
      if (result.recentAnalysis) {
        this.showRecentConfirmation(result.recentAnalysis, () => this.analyzeEventToken(event, true));
        return;
      }
      this.openNarrative(result.event || event);
      this.showToast(result.alreadyInProgress ? "该代币正在分析中" : "已提交代币分析");
    } catch (error) {
      this.showToast(error.message || "提交分析失败", true);
    }
  }

  async toggleFavorite(event) {
    try {
      const favorited = await this.engine.toggleFavorite({ ...event, address: this.tokenAddress(event) });
      this.showToast(favorited ? `已关注 ${event.symbol || "该代币"}` : "已取消关注");
    } catch (error) {
      this.showToast(error.message || "关注失败", true);
    }
  }

  async writeClipboard(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch (_) {
        // 浏览器拒绝新接口时，继续尝试兼容复制方式。
      }
    }

    const input = document.createElement("textarea");
    input.value = value;
    input.readOnly = true;
    input.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    this.shadow.appendChild(input);
    let copied = false;
    try {
      input.select();
      copied = document.execCommand("copy");
    } finally {
      input.remove();
    }
    if (!copied) throw new Error("浏览器拒绝复制操作");
  }

  narrativePreview(event) {
    const states = {
      queued: "Grok 分析排队中…",
      retrying: "Grok 分析重试中…",
      waiting_key: "等待 AI 配置或授权",
      cancelled: "自动叙事分析已关闭",
      failed: "叙事分析失败 · 点击查看",
    };
    if (event.narrative?.status === "ready") return event.narrative.analysis?.title || "叙事分析已完成";
    return states[event.narrative?.status] ||
      [event.name !== event.symbol ? event.name : "", event.age, shortAddress(event.address)].filter(Boolean).join(" · ");
  }

  renderIntegration(integration) {
    if (!integration) return;
    this.integration = integration;
    this.elements.narrativeApiState.textContent = integration.grokConfigured ? "已配置" : "未配置";
    this.elements.narrativeApiState.classList.toggle("ready", integration.grokConfigured);
  }

  openNarrative(event) {
    this.selectedEventKey = `${event.id}:${event.detectedAt}`;
    this.settingsOpen = false;
    this.elements.settingsPanel.classList.remove("show");
    this.elements.narrativeDetail.classList.add("show");
    this.renderNarrativeDetail(event);
  }

  closeNarrative() {
    this.selectedEventKey = "";
    this.elements.narrativeDetail.classList.remove("show");
  }

  refreshSelectedNarrative(events) {
    if (!this.selectedEventKey) return;
    const event = events.find((item) => `${item.id}:${item.detectedAt}` === this.selectedEventKey);
    if (event) this.renderNarrativeDetail(event);
  }

  renderNarrativeDetail(event) {
    this.selectedEvent = event;
    this.elements.detailSymbol.textContent = event.symbol || "未知代币";
    const mode = event.manual ? "手动分析 · " : "";
    this.elements.detailMeta.textContent = `${mode}${event.chain.toUpperCase()} · 第 ${event.rank || "--"} 名 · ${event.volumePeriod || "--"}成交额 ${event.volume || "--"}`;
    this.elements.detailTokenLink.href = event.url;
    const narrative = event.narrative;
    const statusText = {
      queued: "Grok 正在搜索公开资料并生成叙事分析…",
      retrying: "首次请求失败，正在进行最后一次重试…",
      waiting_key: "尚未完成 AI 配置或未授权访问接口。保存配置后可手动重新分析本条提醒。",
      cancelled: narrative?.error || "自动叙事分析已关闭",
      failed: narrative?.error || "叙事分析失败",
    };
    const ready = narrative?.status === "ready" && Boolean(narrative.analysis);
    this.elements.detailStatus.textContent = ready ? "" : statusText[narrative?.status] || "本条提醒暂无叙事分析";
    this.elements.detailStatus.className = `detail-status ${narrative?.status || "idle"}`;
    this.elements.detailContent.hidden = !ready;
    const canRetry = ["ready", "failed", "cancelled"].includes(narrative?.status) ||
      (narrative?.status === "waiting_key" && this.integration?.grokConfigured);
    this.elements.retryNarrative.hidden = !canRetry;
    if (!ready) return;

    const analysis = narrative.analysis;
    this.elements.detailConfidence.textContent = CONFIDENCE_LABELS[analysis.confidence] || "低置信度";
    this.elements.detailConfidence.dataset.level = analysis.confidence || "low";
    this.elements.detailAnalyzedAt.textContent = `分析于 ${formatClock(analysis.analyzedAt)}`;
    this.elements.detailTitle.textContent = analysis.title;
    this.elements.detailSummary.textContent = analysis.summary;
    this.renderStory(analysis.story || { origin: analysis.narrative });
    this.renderXSentiment(analysis.xSentiment || {});
    this.renderVerification(analysis.verification || {});
    this.renderContinuation(analysis.continuation || {});
    this.elements.detailMarketContext.textContent = analysis.marketContext || "暂无需要补充的市场背景";
    this.renderTags(analysis.tags || []);
    this.renderRisks(analysis.risks || []);
    this.renderSources(analysis.sources || []);
  }

  renderTags(tags) {
    this.elements.detailTags.replaceChildren(...tags.map((tag) => {
      const span = document.createElement("span");
      span.textContent = tag;
      return span;
    }));
  }

  renderStory(story) {
    this.elements.detailNarrative.textContent = story.origin || "尚未找到可验证的故事来源";
    this.elements.detailStoryPeople.textContent = story.keyPeopleOrEvent || "暂无可验证信息";
    this.elements.detailStoryWhyNow.textContent = story.whyNow || "尚不清楚为何此刻走热";
    const timeline = (story.timeline || []).map((item) => {
      const row = document.createElement("div");
      row.className = "timeline-row";
      const time = document.createElement("span");
      time.textContent = item.time || "时间未知";
      const event = document.createElement("p");
      event.textContent = item.event;
      row.append(time, event);
      if (item.url) row.appendChild(this.sourceLink(item.url, "来源 ↗"));
      return row;
    });
    this.elements.detailStoryTimeline.replaceChildren(...timeline);
  }

  renderXSentiment(sentiment) {
    const statuses = { verified: "已核对原帖", partial: "部分核对", unavailable: "未完成 X 检索" };
    this.elements.detailXSearchStatus.textContent = statuses[sentiment.searchStatus] || statuses.unavailable;
    this.elements.detailXSearchStatus.dataset.level = sentiment.searchStatus || "unavailable";
    this.elements.detailXOverview.textContent = sentiment.overview || "没有找到可验证的 X 舆情";
    this.renderXPosts(this.elements.detailPositive, sentiment.positive || [], "未找到带原帖链接的正面观点");
    this.renderXPosts(this.elements.detailNegative, sentiment.negative || [], "未找到带原帖链接的负面观点");
  }

  renderXPosts(container, posts, emptyText) {
    if (!posts.length) {
      const empty = document.createElement("p");
      empty.className = "x-empty";
      empty.textContent = emptyText;
      container.replaceChildren(empty);
      return;
    }
    container.replaceChildren(...posts.map((post) => {
      const row = document.createElement("article");
      row.className = "x-post";
      const author = document.createElement("strong");
      author.textContent = [post.author, post.handle].filter(Boolean).join(" ");
      const view = document.createElement("p");
      view.textContent = post.view;
      const quote = document.createElement("blockquote");
      quote.textContent = post.quote ? `“${post.quote}”` : "未提供可核对短引";
      row.append(author, view, quote, this.sourceLink(post.url, post.engagement ? `${post.engagement} · 原帖 ↗` : "查看原帖 ↗"));
      return row;
    }));
  }

  renderVerification(verification) {
    this.renderTextList(this.elements.detailConfirmed, verification.confirmed || []);
    this.renderTextList(this.elements.detailClaims, verification.projectClaims || []);
    this.renderTextList(this.elements.detailUnknowns, verification.unknowns || []);
  }

  renderContinuation(continuation) {
    this.renderTextList(this.elements.detailCatalysts, continuation.bullCase || []);
    this.renderTextList(this.elements.detailInvalidations, continuation.bearCase || []);
    this.renderTextList(this.elements.detailWatchItems, continuation.watchNext || []);
  }

  renderTextList(container, values) {
    container.replaceChildren(...values.map((value) => {
      const item = document.createElement("li");
      item.textContent = value;
      return item;
    }));
  }

  renderRisks(risks) {
    this.elements.detailRisks.replaceChildren(...risks.map((risk) => {
      const item = document.createElement("li");
      item.textContent = risk;
      return item;
    }));
  }

  renderSources(sources) {
    this.elements.detailSources.replaceChildren(...sources.map((url, index) =>
      this.sourceLink(url, `来源 ${index + 1} ↗`)
    ));
  }

  sourceLink(url, label) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label;
    return link;
  }

  async retrySelectedNarrative(force = false, selectedEvent = this.selectedEvent) {
    if (!selectedEvent) return;
    this.elements.retryNarrative.disabled = true;
    try {
      const result = selectedEvent.favoriteOnly
        ? await this.engine.analyzeContract(this.tokenAddress(selectedEvent), force)
        : await this.engine.retryNarrative(selectedEvent.id, selectedEvent.detectedAt, force);
      if (result.recentAnalysis) {
        this.showRecentConfirmation(result.recentAnalysis, () => this.retrySelectedNarrative(true, selectedEvent));
        return;
      }
      if (result.event) this.openNarrative(result.event);
      this.showToast(result.alreadyInProgress ? "该代币正在分析中" : "叙事分析已重新排队");
    } catch (error) {
      this.showToast(error.message || "重新分析失败", true);
    } finally {
      this.elements.retryNarrative.disabled = false;
    }
  }

  setNarrativeActionsDisabled(disabled) {
    this.elements.manualNarrativeButton.disabled = disabled;
    this.elements.manualCaNarrative.disabled = disabled;
    this.elements.manualCaAddress.disabled = disabled;
  }

  async analyzeTopToken(force = false, selectedToken = null) {
    this.setNarrativeActionsDisabled(true);
    try {
      const result = await this.engine.analyzeTopToken(force, selectedToken);
      if (result.recentAnalysis) {
        this.showRecentConfirmation(result.recentAnalysis, () => this.analyzeTopToken(true, result.requestToken));
        return;
      }
      this.settingsOpen = false;
      this.elements.settingsPanel.classList.remove("show");
      this.openNarrative(result.event);
      this.showToast(result.alreadyInProgress ? "该代币正在分析中" : "已提交当前榜首分析");
    } catch (error) {
      this.showToast(error.message || "手动分析失败", true);
    } finally {
      this.setNarrativeActionsDisabled(false);
    }
  }

  async analyzeManualCa(force = false, address = this.elements.manualCaAddress.value) {
    this.setNarrativeActionsDisabled(true);
    try {
      const result = await this.engine.analyzeContract(address, force);
      if (result.recentAnalysis) {
        this.showRecentConfirmation(result.recentAnalysis, () => this.analyzeManualCa(true, address));
        return;
      }
      this.settingsOpen = false;
      this.elements.settingsPanel.classList.remove("show");
      this.openNarrative(result.event);
      this.showToast(result.alreadyInProgress ? "该代币正在分析中" : "已提交指定 CA 分析");
    } catch (error) {
      this.showToast(error.message || "手动分析失败", true);
    } finally {
      this.setNarrativeActionsDisabled(false);
    }
  }

  handleFresh(fresh) {
    if (!fresh.length) return;
    const key = fresh.map((token) => `${token.id}:${token.detectedAt}`).join("|");
    if (key === this.lastFreshKey) return;
    this.lastFreshKey = key;
    this.flashTitle(fresh.length);
  }

  showRecentConfirmation(recent, submit) {
    const event = recent.event;
    const hours = Math.max(0, Math.floor(recent.ageMs / 3600000));
    const age = hours ? `${hours} 小时前` : "不到 1 小时前";
    const name = event.symbol || event.name || event.address || "该代币";
    this.elements.recentConfirmText.textContent = `${recent.sameName ? "同名代币 " : ""}${name} ${age}已分析过`;
    this.elements.recentConfirm.hidden = false;
    this.elements.recentView.onclick = () => {
      this.elements.recentConfirm.hidden = true;
      this.openNarrative(event);
    };
    this.elements.recentForce.onclick = () => {
      this.elements.recentConfirm.hidden = true;
      submit();
    };
    this.elements.recentCancel.onclick = () => {
      this.elements.recentConfirm.hidden = true;
    };
  }

  flashTitle(count) {
    clearInterval(this.titleTimer);
    let ticks = 0;
    this.titleTimer = setInterval(() => {
      document.title = ticks % 2 ? this.originalTitle : `【${count} 个排名提醒】GMGN`;
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
      this.closeNarrative();
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
