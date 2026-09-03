// ==UserScript==
// @name         GMGN 热门币监控
// @namespace    local.gmgn.monitor
// @version      0.1.0
// @description  监控 GMGN 热门榜，发现首次出现的代币时发出声音提醒
// @author       Local
// @match        https://gmgn.ai/trend*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function initGMGNMonitorCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GMGNMonitorCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
  "use strict";

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function parseTokenHref(href, baseUrl = "https://gmgn.ai") {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, baseUrl);
    } catch (_) {
      return null;
    }

    const match = url.pathname.match(/^\/([^/]+)\/token\/([^/?#]+)/i);
    if (!match) return null;

    const chain = decodeURIComponent(match[1]).toLowerCase();
    const address = decodeURIComponent(match[2]);
    const normalizedAddress = address.startsWith("0x") ? address.toLowerCase() : address;
    return {
      chain,
      address,
      id: `${chain}:${normalizedAddress}`,
      url: `${url.origin}/${chain}/token/${encodeURIComponent(address)}`,
    };
  }

  function buildMetrics(headers, cells) {
    const result = {};
    const size = Math.min(headers.length, cells.length);
    for (let index = 0; index < size; index += 1) {
      const key = normalizeText(headers[index]);
      if (key) result[key] = normalizeText(cells[index]);
    }
    return result;
  }

  function findMetric(metrics, include, exclude = []) {
    const keys = Object.keys(metrics || {});
    const key = keys.find((candidate) => {
      const compact = candidate.replace(/\s+/g, "");
      return include.every((part) => compact.includes(part)) &&
        exclude.every((part) => !compact.includes(part));
    });
    return key ? metrics[key] : "";
  }

  function splitNewTokens(tokens, seenKeys) {
    const fresh = [];
    const known = [];
    for (const token of tokens) {
      (seenKeys.has(token.id) ? known : fresh).push(token);
    }
    return { fresh, known };
  }

  function formatClock(value) {
    if (!value) return "--:--:--";
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(value));
  }

  return {
    buildMetrics,
    findMetric,
    formatClock,
    normalizeText,
    parseTokenHref,
    splitNewTokens,
  };
});

(function runGMGNMonitor() {
  "use strict";

  const Core = globalThis.GMGNMonitorCore;
  const isGMGNTrend = location.hostname === "gmgn.ai" && location.pathname.startsWith("/trend");
  const isDemo = document.documentElement.hasAttribute("data-gmgn-monitor-demo");
  if (!Core || (!isGMGNTrend && !isDemo) || window.top !== window.self) return;
  if (document.getElementById("gmgn-hot-monitor-root")) return;

  const DB_NAME = "gmgn-hot-monitor";
  const SETTINGS_KEY = "gmgn-hot-monitor:settings:v1";
  const DEFAULT_SETTINGS = {
    sound: true,
    interval: 10,
    rebaselineOnFilterChange: true,
    expanded: true,
  };

  class MonitorStore {
    constructor() {
      this.db = null;
    }

    async open() {
      this.db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("tokens")) {
            const tokens = db.createObjectStore("tokens", { keyPath: "id" });
            tokens.createIndex("firstSeen", "firstSeen");
            tokens.createIndex("lastSeen", "lastSeen");
          }
          if (!db.objectStoreNames.contains("events")) {
            const events = db.createObjectStore("events", {
              keyPath: "eventId",
              autoIncrement: true,
            });
            events.createIndex("detectedAt", "detectedAt");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    transaction(storeName, mode, action) {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let result;
        try {
          result = action(store);
        } catch (error) {
          reject(error);
          return;
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("数据库事务已取消"));
      });
    }

    async getAll(storeName) {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    }

    putTokens(tokens) {
      return this.transaction("tokens", "readwrite", (store) => {
        for (const token of tokens) store.put(token);
      });
    }

    addEvents(events) {
      return this.transaction("events", "readwrite", (store) => {
        for (const event of events) store.add(event);
      });
    }

    clear() {
      return Promise.all([
        this.transaction("tokens", "readwrite", (store) => store.clear()),
        this.transaction("events", "readwrite", (store) => store.clear()),
      ]);
    }
  }

  function loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  const settings = loadSettings();
  const store = new MonitorStore();
  const state = {
    running: false,
    scanning: false,
    rebaselining: false,
    needsInitialBaseline: true,
    currentCount: 0,
    sessionNew: 0,
    lastScanAt: 0,
    records: new Map(),
    events: [],
    context: `${location.pathname}${location.search}`,
    observer: null,
    intervalTimer: 0,
    debounceTimer: 0,
    rebaselineTimer: 0,
    audioContext: null,
    originalTitle: document.title,
    titleTimer: 0,
  };

  const host = document.createElement("div");
  host.id = "gmgn-hot-monitor-root";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      button, select, input { font: inherit; letter-spacing: 0; }
      button { border: 0; }
      .launcher {
        position: fixed; right: 14px; top: 84px; z-index: 2147483646;
        width: 44px; height: 44px; display: none; place-items: center;
        border-radius: 8px; border: 1px solid #3d433b; background: #171a17;
        color: #d9f99d; cursor: pointer; box-shadow: 0 10px 30px rgba(0,0,0,.38);
      }
      .launcher.show { display: grid; }
      .launcher-icon { font-size: 20px; line-height: 1; }
      .launcher-badge {
        position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px;
        padding: 0 4px; display: none; place-items: center; border-radius: 9px;
        background: #ff6b57; color: #fff; font: 700 10px/1 -apple-system, sans-serif;
        border: 2px solid #101310;
      }
      .launcher-badge.show { display: grid; }
      .panel {
        position: fixed; z-index: 2147483646; top: 76px; right: 12px;
        width: min(372px, calc(100vw - 24px)); height: min(620px, calc(100vh - 92px));
        display: none; grid-template-rows: auto auto auto 1fr auto;
        color: #f1f4ef; background: #111411; border: 1px solid #343a33;
        border-radius: 8px; overflow: hidden; box-shadow: 0 18px 54px rgba(0,0,0,.52);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
        font-size: 13px; letter-spacing: 0;
      }
      .panel.show { display: grid; }
      .header {
        height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 10px 0 14px;
        border-bottom: 1px solid #2d322c; background: #151815;
      }
      .brand-mark { width: 9px; height: 24px; border-radius: 3px; background: #c9f26b; }
      .title-wrap { min-width: 0; flex: 1; }
      .title { color: #fff; font-size: 14px; font-weight: 700; line-height: 19px; }
      .subtitle { display: flex; align-items: center; gap: 6px; color: #8f998c; font-size: 11px; line-height: 15px; }
      .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #70786d; }
      .status-dot.running { background: #83d86b; box-shadow: 0 0 0 3px rgba(131,216,107,.12); }
      .status-dot.waiting { background: #f0b95b; }
      .status-dot.error { background: #ff6b57; }
      .icon-button {
        width: 30px; height: 30px; display: grid; place-items: center; border-radius: 6px;
        background: transparent; color: #aeb6aa; cursor: pointer; font-size: 16px;
      }
      .icon-button:hover { background: #262b25; color: #fff; }
      .toolbar { padding: 12px 14px; border-bottom: 1px solid #2d322c; }
      .primary-row { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; }
      .primary {
        height: 36px; display: flex; align-items: center; justify-content: center; gap: 7px;
        border-radius: 6px; background: #c9f26b; color: #14200c; font-weight: 750;
        cursor: pointer; padding: 0 13px;
      }
      .primary:hover { background: #d8ff82; }
      .primary.stop { background: #ff765f; color: #240b07; }
      .secondary {
        height: 36px; min-width: 36px; border-radius: 6px; border: 1px solid #3b4239;
        background: #1a1e1a; color: #dce1da; cursor: pointer;
      }
      .secondary:hover { border-color: #687164; background: #242924; }
      .sound-wrap {
        height: 36px; min-width: 58px; display: flex; align-items: center; gap: 7px;
        padding: 0 8px; border: 1px solid #3b4239; border-radius: 6px; background: #1a1e1a;
      }
      .sound-label { color: #c8cec5; font-size: 12px; }
      .switch { position: relative; width: 26px; height: 16px; flex: 0 0 auto; }
      .switch input { position: absolute; opacity: 0; pointer-events: none; }
      .switch-track { position: absolute; inset: 0; border-radius: 8px; background: #50574d; cursor: pointer; }
      .switch-track::after {
        content: ""; position: absolute; width: 12px; height: 12px; top: 2px; left: 2px;
        border-radius: 50%; background: #fff; transition: transform .15s ease;
      }
      .switch input:checked + .switch-track { background: #7aac45; }
      .switch input:checked + .switch-track::after { transform: translateX(10px); }
      .stats {
        display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid #2d322c;
        background: #131613;
      }
      .stat { min-width: 0; padding: 10px 8px; text-align: center; border-right: 1px solid #292e28; }
      .stat:last-child { border-right: 0; }
      .stat-value { display: block; color: #edf1eb; font-size: 15px; font-weight: 720; line-height: 20px; }
      .stat-value.hot { color: #ff8d76; }
      .stat-label { display: block; color: #798276; font-size: 10px; line-height: 15px; }
      .content { min-height: 0; display: grid; grid-template-rows: auto 1fr; }
      .section-head {
        height: 40px; display: flex; align-items: center; padding: 0 14px;
        border-bottom: 1px solid #292e28;
      }
      .section-title { flex: 1; color: #cdd3ca; font-weight: 650; }
      .section-count { color: #7f887c; font-variant-numeric: tabular-nums; }
      .events { min-height: 0; overflow: auto; scrollbar-width: thin; scrollbar-color: #42483f transparent; }
      .empty { height: 100%; min-height: 160px; display: grid; place-items: center; color: #727b70; text-align: center; }
      .empty-glyph { display: block; color: #4e564c; font-size: 24px; margin-bottom: 7px; }
      .event {
        display: grid; grid-template-columns: 36px minmax(0,1fr) auto; gap: 10px;
        align-items: center; min-height: 68px; padding: 9px 12px 9px 14px;
        color: inherit; text-decoration: none; border-bottom: 1px solid #252a24;
      }
      .event:hover { background: #1a1e1a; }
      .token-image {
        width: 36px; height: 36px; display: grid; place-items: center; overflow: hidden;
        border-radius: 6px; background: #2a3028; color: #c9f26b; font-weight: 800;
      }
      .token-image img { width: 100%; height: 100%; object-fit: cover; }
      .event-main { min-width: 0; }
      .event-name { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
      .symbol { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 750; color: #fff; }
      .chain { color: #9da797; font-size: 10px; text-transform: uppercase; }
      .event-meta { margin-top: 4px; color: #828b7f; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .event-side { text-align: right; }
      .market-cap { color: #eabf65; font-size: 12px; font-weight: 650; }
      .event-time { margin-top: 4px; color: #737c70; font-size: 10px; }
      .settings {
        display: none; position: absolute; inset: 52px 0 0; z-index: 3;
        background: #111411; padding: 14px; overflow: auto;
      }
      .settings.show { display: block; }
      .settings-title { margin: 0 0 16px; font-size: 14px; color: #f2f5ef; }
      .setting-row {
        min-height: 52px; display: flex; align-items: center; gap: 12px;
        border-bottom: 1px solid #292e28;
      }
      .setting-main { min-width: 0; flex: 1; }
      .setting-name { color: #dce1da; line-height: 18px; }
      .setting-note { color: #747d71; font-size: 10px; line-height: 15px; }
      select {
        height: 32px; min-width: 78px; padding: 0 26px 0 9px; color: #e5e9e2;
        background: #1c201c; border: 1px solid #3b4239; border-radius: 6px;
      }
      .data-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 18px; }
      .action-button {
        height: 34px; border-radius: 6px; border: 1px solid #3b4239;
        background: #1b1f1b; color: #d8ded5; cursor: pointer;
      }
      .action-button.danger { color: #ff8e7c; border-color: #5b3731; }
      .footer {
        min-height: 35px; display: flex; align-items: center; gap: 7px; padding: 0 14px;
        color: #788175; background: #151815; border-top: 1px solid #2d322c; font-size: 10px;
      }
      .footer-state { width: 6px; height: 6px; border-radius: 50%; background: #c9f26b; }
      .footer-spacer { flex: 1; }
      .version { color: #596157; }
      .toast {
        position: absolute; left: 14px; right: 14px; bottom: 44px; z-index: 5;
        display: none; padding: 9px 11px; border-radius: 6px; color: #edf1eb;
        background: #30372e; border: 1px solid #465043; box-shadow: 0 8px 24px rgba(0,0,0,.3);
      }
      .toast.show { display: block; }
      .toast.error { background: #442620; border-color: #6e3d34; }
      @media (max-width: 520px) {
        .panel { top: 8px; right: 8px; width: calc(100vw - 16px); height: calc(100vh - 16px); }
        .launcher { top: 68px; right: 8px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .switch-track::after { transition: none; }
      }
    </style>
    <button class="launcher" id="launcher" type="button" title="打开 GMGN 热门监控">
      <span class="launcher-icon">♪</span><span class="launcher-badge" id="launcherBadge">0</span>
    </button>
    <section class="panel" id="panel" aria-label="GMGN 热门币监控">
      <header class="header">
        <span class="brand-mark"></span>
        <div class="title-wrap">
          <div class="title">GMGN 热门监控</div>
          <div class="subtitle"><span class="status-dot" id="statusDot"></span><span id="statusText">正在准备</span></div>
        </div>
        <button class="icon-button" id="settingsButton" type="button" title="设置">⚙</button>
        <button class="icon-button" id="collapseButton" type="button" title="收起">×</button>
      </header>
      <div class="toolbar">
        <div class="primary-row">
          <button class="primary" id="startButton" type="button"><span id="startIcon">▶</span><span id="startLabel">开始监控</span></button>
          <div class="sound-wrap" title="声音提醒">
            <span class="sound-label">声音</span>
            <label class="switch"><input id="soundToggle" type="checkbox"><span class="switch-track"></span></label>
          </div>
          <button class="secondary" id="testSoundButton" type="button" title="试听提醒音">♪</button>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><span class="stat-value" id="seenValue">0</span><span class="stat-label">本地币种</span></div>
        <div class="stat"><span class="stat-value" id="currentValue">0</span><span class="stat-label">当前榜单</span></div>
        <div class="stat"><span class="stat-value hot" id="newValue">0</span><span class="stat-label">本次新增</span></div>
        <div class="stat"><span class="stat-value" id="scanValue">--:--</span><span class="stat-label">最近扫描</span></div>
      </div>
      <div class="content">
        <div class="section-head"><span class="section-title">新发现</span><span class="section-count" id="eventCount">0 条</span></div>
        <div class="events" id="events"><div class="empty"><div><span class="empty-glyph">◎</span><span>暂无新发现</span></div></div></div>
      </div>
      <footer class="footer"><span class="footer-state"></span><span>使用 GMGN 当前页面筛选</span><span class="footer-spacer"></span><span class="version">v0.1.0</span></footer>
      <aside class="settings" id="settingsPanel">
        <h2 class="settings-title">监控设置</h2>
        <div class="setting-row">
          <div class="setting-main"><div class="setting-name">扫描间隔</div><div class="setting-note">页面实时变化也会立即触发扫描</div></div>
          <select id="intervalSelect" aria-label="扫描间隔">
            <option value="5">5 秒</option><option value="10">10 秒</option><option value="20">20 秒</option>
            <option value="30">30 秒</option><option value="60">60 秒</option>
          </select>
        </div>
        <div class="setting-row">
          <div class="setting-main"><div class="setting-name">筛选变更时静默建基线</div><div class="setting-note">避免切换周期或筛选后集中误报</div></div>
          <label class="switch"><input id="rebaselineToggle" type="checkbox"><span class="switch-track"></span></label>
        </div>
        <div class="data-actions">
          <button class="action-button" id="exportButton" type="button">导出记录</button>
          <button class="action-button danger" id="resetButton" type="button">清空记录</button>
        </div>
      </aside>
      <div class="toast" id="toast"></div>
    </section>
  `;

  const elements = Object.fromEntries([
    "launcher", "launcherBadge", "panel", "statusDot", "statusText", "settingsButton",
    "collapseButton", "settingsPanel", "startButton", "startIcon", "startLabel", "soundToggle",
    "testSoundButton", "seenValue", "currentValue", "newValue", "scanValue", "eventCount",
    "events", "intervalSelect", "rebaselineToggle", "exportButton", "resetButton", "toast",
  ].map((id) => [id, shadow.getElementById(id)]));

  let toastTimer = 0;

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (_) {
      showToast("设置保存失败", true);
    }
  }

  function showToast(message, error = false) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.className = `toast show${error ? " error" : ""}`;
    toastTimer = setTimeout(() => {
      elements.toast.className = "toast";
    }, 2600);
  }

  function setStatus(text, tone = "") {
    elements.statusText.textContent = text;
    elements.statusDot.className = `status-dot${tone ? ` ${tone}` : ""}`;
  }

  function updateStats() {
    elements.seenValue.textContent = String(state.records.size);
    elements.currentValue.textContent = String(state.currentCount);
    elements.newValue.textContent = String(state.sessionNew);
    elements.scanValue.textContent = state.lastScanAt ? Core.formatClock(state.lastScanAt).slice(0, 5) : "--:--";
    elements.eventCount.textContent = `${state.events.length} 条`;
    elements.launcherBadge.textContent = state.sessionNew > 99 ? "99+" : String(state.sessionNew);
    elements.launcherBadge.classList.toggle("show", state.sessionNew > 0);
  }

  function setExpanded(expanded) {
    settings.expanded = expanded;
    elements.panel.classList.toggle("show", expanded);
    elements.launcher.classList.toggle("show", !expanded);
    if (!expanded) elements.settingsPanel.classList.remove("show");
    saveSettings();
  }

  function renderEvents() {
    elements.events.replaceChildren();
    if (!state.events.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.innerHTML = '<div><span class="empty-glyph">◎</span><span>暂无新发现</span></div>';
      elements.events.appendChild(empty);
      updateStats();
      return;
    }

    for (const event of state.events.slice(0, 100)) {
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
      const eventTime = document.createElement("span");
      eventTime.className = "event-time";
      eventTime.textContent = Core.formatClock(event.detectedAt || event.firstSeen);
      side.append(marketCap, eventTime);

      link.append(image, main, side);
      elements.events.appendChild(link);
    }
    updateStats();
  }

  function shortAddress(address) {
    if (!address || address.length < 12) return address || "";
    return `${address.slice(0, 5)}…${address.slice(-4)}`;
  }

  function selectLeaderboard() {
    const tables = Array.from(document.querySelectorAll("table"));
    return tables
      .map((table) => ({ table, count: table.querySelectorAll('a[href*="/token/"]').length }))
      .sort((left, right) => right.count - left.count)[0]?.table || null;
  }

  function extractCurrentTokens() {
    const table = selectLeaderboard();
    if (!table) return [];
    const headerNodes = table.querySelectorAll("thead th").length
      ? table.querySelectorAll("thead th")
      : table.querySelectorAll("tr:first-child th");
    const headers = Array.from(headerNodes, (node) => Core.normalizeText(node.textContent));
    const found = new Map();

    for (const anchor of table.querySelectorAll('a[href*="/token/"]')) {
      const parsed = Core.parseTokenHref(anchor.getAttribute("href"), location.origin);
      if (!parsed || found.has(parsed.id)) continue;
      const row = anchor.closest("tr");
      if (!row) continue;
      const cells = Array.from(row.querySelectorAll(":scope > td"), (cell) => Core.normalizeText(cell.textContent));
      const metrics = Core.buildMetrics(headers, cells);
      const symbolNode = anchor.querySelector("[title]");
      const symbol = Core.normalizeText(symbolNode?.getAttribute("title")) || parsed.address.slice(0, 10);
      const name = Core.normalizeText(symbolNode?.nextElementSibling?.textContent) || symbol;
      const age = Core.normalizeText(anchor.textContent).match(/\b\d+(?:s|m|h|d|mo|y)\b/i)?.[0] || "";
      const imageNode = anchor.querySelector('img[alt="logo"], img');
      const now = Date.now();

      found.set(parsed.id, {
        ...parsed,
        symbol,
        name,
        age,
        image: imageNode?.currentSrc || imageNode?.src || "",
        marketCap: Core.findMetric(metrics, ["市值"], ["历史最高"]),
        athMarketCap: Core.findMetric(metrics, ["历史最高", "市值"]),
        liquidity: Core.findMetric(metrics, ["池子"]),
        volume: Core.findMetric(metrics, ["成交额"]),
        transactions: Core.findMetric(metrics, ["交易数"]),
        holders: Core.findMetric(metrics, ["持有者"]),
        fees: Core.findMetric(metrics, ["手续费"]),
        metrics,
        snapshot: Core.normalizeText(row.textContent).slice(0, 1800),
        capturedAt: now,
      });
    }
    return Array.from(found.values());
  }

  async function playAlertSound() {
    if (!settings.sound) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("当前浏览器不支持网页声音");
    if (!state.audioContext) state.audioContext = new AudioContextClass();
    if (state.audioContext.state === "suspended") await state.audioContext.resume();
    const context = state.audioContext;
    const start = context.currentTime + 0.02;
    [880, 1175, 1568].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = start + index * 0.13;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.17, at + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.12);
    });
  }

  function flashTitle(count) {
    clearInterval(state.titleTimer);
    let ticks = 0;
    const alertTitle = `【${count} 个新币】GMGN`;
    state.titleTimer = setInterval(() => {
      document.title = ticks % 2 ? state.originalTitle : alertTitle;
      ticks += 1;
      if (ticks >= 8) {
        clearInterval(state.titleTimer);
        document.title = state.originalTitle;
      }
    }, 650);
  }

  async function persistTokens(tokens, baseline) {
    const now = Date.now();
    const records = tokens.map((token) => {
      const prior = state.records.get(token.id);
      return {
        ...prior,
        ...token,
        firstSeen: prior?.firstSeen || now,
        lastSeen: now,
        baseline: prior ? prior.baseline : baseline,
      };
    });
    for (const record of records) state.records.set(record.id, record);
    await store.putTokens(records);
    return records;
  }

  async function scan(options = {}) {
    const baseline = Boolean(options.baseline || state.needsInitialBaseline);
    if (!state.running && !baseline) return;
    if (state.scanning || (state.rebaselining && !options.baseline)) return;

    const nextContext = `${location.pathname}${location.search}`;
    if (state.running && state.context !== nextContext && settings.rebaselineOnFilterChange) {
      state.context = nextContext;
      scheduleRebaseline("页面范围已切换");
      return;
    }

    state.scanning = true;
    try {
      const tokens = extractCurrentTokens();
      state.currentCount = tokens.length;
      state.lastScanAt = Date.now();
      if (!tokens.length) {
        setStatus("等待榜单数据", "waiting");
        updateStats();
        return;
      }

      const seenKeys = new Set(state.records.keys());
      const { fresh } = Core.splitNewTokens(tokens, seenKeys);
      const records = await persistTokens(tokens, baseline);
      state.needsInitialBaseline = false;

      if (baseline) {
        setStatus(state.running ? "监控中" : "基线已建立", state.running ? "running" : "");
        showToast(`已记录 ${records.length} 个当前榜单代币`);
      } else if (fresh.length) {
        const detectedAt = Date.now();
        const events = fresh.map((token) => ({ ...token, detectedAt }));
        await store.addEvents(events);
        state.events = [...events.reverse(), ...state.events].slice(0, 100);
        state.sessionNew += fresh.length;
        renderEvents();
        flashTitle(fresh.length);
        try {
          await playAlertSound();
        } catch (error) {
          showToast(error.message || "声音播放失败，请点击试听", true);
        }
        setStatus(`发现 ${fresh.length} 个新币`, "running");
      } else {
        setStatus("监控中", "running");
      }
      updateStats();
    } catch (error) {
      console.error("[GMGN Monitor] scan failed", error);
      setStatus("扫描失败", "error");
      showToast(error.message || "扫描失败", true);
    } finally {
      state.scanning = false;
    }
  }

  function scheduleScan() {
    if (!state.running || state.rebaselining) return;
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => scan(), 900);
  }

  function restartInterval() {
    clearInterval(state.intervalTimer);
    if (state.running) {
      state.intervalTimer = setInterval(() => scan(), Number(settings.interval) * 1000);
    }
  }

  function scheduleRebaseline(reason) {
    if (!state.running || !settings.rebaselineOnFilterChange) return;
    state.rebaselining = true;
    clearTimeout(state.rebaselineTimer);
    clearTimeout(state.debounceTimer);
    setStatus("正在重建基线", "waiting");
    state.rebaselineTimer = setTimeout(async () => {
      try {
        await scan({ baseline: true, reason });
      } finally {
        state.rebaselining = false;
      }
    }, 1500);
  }

  async function startMonitoring() {
    if (state.running) {
      stopMonitoring();
      return;
    }
    state.running = true;
    state.context = `${location.pathname}${location.search}`;
    elements.startButton.classList.add("stop");
    elements.startIcon.textContent = "■";
    elements.startLabel.textContent = "停止监控";
    setStatus("正在建立基线", "waiting");
    if (settings.sound) {
      try {
        await playAlertSound();
      } catch (_) {
        showToast("浏览器暂未允许声音，可点击试听", true);
      }
    }
    state.observer = new MutationObserver(scheduleScan);
    state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    restartInterval();
    await scan({ baseline: true, reason: "启动" });
  }

  function stopMonitoring() {
    state.running = false;
    state.rebaselining = false;
    clearInterval(state.intervalTimer);
    clearTimeout(state.debounceTimer);
    clearTimeout(state.rebaselineTimer);
    state.observer?.disconnect();
    state.observer = null;
    elements.startButton.classList.remove("stop");
    elements.startIcon.textContent = "▶";
    elements.startLabel.textContent = "开始监控";
    setStatus("已停止");
  }

  async function exportData() {
    try {
      const [tokens, events] = await Promise.all([store.getAll("tokens"), store.getAll("events")]);
      const payload = {
        exportedAt: new Date().toISOString(),
        source: location.href,
        settings: { interval: settings.interval, rebaselineOnFilterChange: settings.rebaselineOnFilterChange },
        tokens,
        events,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `gmgn-monitor-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`已导出 ${tokens.length} 个代币`);
    } catch (error) {
      showToast(error.message || "导出失败", true);
    }
  }

  async function resetData() {
    if (!window.confirm("清空所有本地代币和提醒记录？此操作不可撤销。")) return;
    try {
      await store.clear();
      state.records.clear();
      state.events = [];
      state.sessionNew = 0;
      state.needsInitialBaseline = true;
      renderEvents();
      if (state.running) await scan({ baseline: true, reason: "清空后重建" });
      showToast("本地记录已清空");
    } catch (error) {
      showToast(error.message || "清空失败", true);
    }
  }

  function handlePageControlClick(event) {
    if (!state.running || !settings.rebaselineOnFilterChange) return;
    const control = event.target.closest("button, [role='tab'], [role='option'], [data-testid='trending-filter-toggle']");
    if (!control || !control.closest("main")) return;
    const text = Core.normalizeText(control.textContent);
    if (text === "应用" || ["1m", "5m", "1h", "6h", "24h", "新币", "热门", "热搜"].includes(text)) {
      scheduleRebaseline(text === "应用" ? "筛选已应用" : `已切换 ${text}`);
    }
  }

  elements.startButton.addEventListener("click", startMonitoring);
  elements.collapseButton.addEventListener("click", () => setExpanded(false));
  elements.launcher.addEventListener("click", () => setExpanded(true));
  elements.settingsButton.addEventListener("click", () => {
    elements.settingsPanel.classList.toggle("show");
  });
  elements.soundToggle.addEventListener("change", async () => {
    settings.sound = elements.soundToggle.checked;
    saveSettings();
    if (settings.sound) {
      try {
        await playAlertSound();
        showToast("声音提醒已开启");
      } catch (error) {
        showToast(error.message || "声音开启失败", true);
      }
    } else {
      showToast("声音提醒已关闭");
    }
  });
  elements.testSoundButton.addEventListener("click", async () => {
    try {
      const previous = settings.sound;
      settings.sound = true;
      await playAlertSound();
      settings.sound = previous;
      showToast("提醒音正常");
    } catch (error) {
      showToast(error.message || "声音播放失败", true);
    }
  });
  elements.intervalSelect.addEventListener("change", () => {
    settings.interval = Number(elements.intervalSelect.value);
    saveSettings();
    restartInterval();
    showToast(`扫描间隔已设为 ${settings.interval} 秒`);
  });
  elements.rebaselineToggle.addEventListener("change", () => {
    settings.rebaselineOnFilterChange = elements.rebaselineToggle.checked;
    saveSettings();
  });
  elements.exportButton.addEventListener("click", exportData);
  elements.resetButton.addEventListener("click", resetData);
  document.addEventListener("click", handlePageControlClick, true);

  async function initialize() {
    elements.soundToggle.checked = Boolean(settings.sound);
    elements.intervalSelect.value = String(settings.interval);
    elements.rebaselineToggle.checked = Boolean(settings.rebaselineOnFilterChange);
    setExpanded(Boolean(settings.expanded));
    try {
      await store.open();
      const [tokens, events] = await Promise.all([store.getAll("tokens"), store.getAll("events")]);
      state.records = new Map(tokens.map((token) => [token.id, token]));
      state.events = events.sort((left, right) => (right.detectedAt || 0) - (left.detectedAt || 0)).slice(0, 100);
      renderEvents();
      setStatus("待启动");
    } catch (error) {
      console.error("[GMGN Monitor] database initialization failed", error);
      setStatus("本地数据库不可用", "error");
      showToast("本地数据库初始化失败", true);
      elements.startButton.disabled = true;
    }
  }

  initialize();
})();
