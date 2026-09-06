import { GMGN_URL, MESSAGE, MESSAGE_TARGET } from "../shared/constants.js";
import { normalizeBridgeBaseUrl, permissionPatternForBridgeUrl } from "../shared/grok-config.js";
import { formatClock } from "../shared/token.js";

const settingIds = [
  "autoStart", "sound", "desktopNotifications", "autoRefreshOnStall", "alertTopN",
  "intervalSeconds", "connectionTimeoutSeconds", "retentionDays", "narrativeEnabled",
];
const elements = Object.fromEntries([
  ...settingIds, "seenCount", "eventCount", "updatedAt", "testSound", "openGmgn", "message",
  "analyzerStatus", "bridgeBaseUrl", "bridgeToken", "bridgeStatus", "toggleBridgeToken",
  "saveAnalyzer", "testAnalyzer", "openAnalyzerSettings", "migrateLegacyConfig", "manualTopNarrative",
].map((id) => [id, document.getElementById(id)]));
let currentSettings = null;
let currentIntegration = null;

async function request(type, payload = {}) {
  try {
    const response = await chrome.runtime.sendMessage({
      target: MESSAGE_TARGET.BACKGROUND,
      type,
      ...payload,
    });
    if (!response?.ok) throw new Error(response?.error || "扩展后台未响应");
    return response.data;
  } catch (error) {
    const disconnected = /Receiving end does not exist|Extension context invalidated/i.test(error?.message || "");
    throw new Error(disconnected ? "插件刚刚更新，请关闭并重新打开设置" : error?.message || "扩展后台未响应");
  }
}

function showMessage(text, isError = false) {
  elements.message.textContent = text;
  elements.message.classList.toggle("error", isError);
}

function render(bootstrap) {
  const { settings, summary, integrations } = bootstrap;
  currentSettings = settings;
  currentIntegration = integrations;
  for (const id of ["autoStart", "sound", "desktopNotifications", "autoRefreshOnStall", "narrativeEnabled"]) {
    elements[id].checked = settings[id];
  }
  elements.alertTopN.value = String(settings.alertTopN);
  elements.intervalSeconds.value = String(settings.intervalSeconds);
  elements.connectionTimeoutSeconds.value = String(settings.connectionTimeoutSeconds);
  elements.retentionDays.value = String(settings.retentionDays);
  elements.bridgeBaseUrl.value = settings.bridgeBaseUrl;
  elements.seenCount.textContent = String(summary.totalSeen);
  elements.eventCount.textContent = String(summary.recentEvents.length);
  elements.updatedAt.textContent = summary.updatedAt ? formatClock(summary.updatedAt).slice(0, 5) : "--:--";
  renderIntegration(integrations);
}

function renderIntegration(integration) {
  currentIntegration = integration;
  elements.bridgeStatus.textContent = integration.bridgeConfigured ? "令牌已保存" : "未配对";
  elements.bridgeStatus.classList.toggle("ready", integration.bridgeConfigured);
  elements.bridgeToken.placeholder = integration.bridgeConfigured
    ? "已保存（不会回显）"
    : "运行服务后显示的配对令牌";
  elements.migrateLegacyConfig.hidden = !integration.grokConfigured;
}

settingIds.forEach((id) => {
  elements[id].addEventListener("change", async () => {
    const numeric = ["alertTopN", "intervalSeconds", "connectionTimeoutSeconds", "retentionDays"].includes(id);
    try {
      await request(MESSAGE.UPDATE_SETTINGS, { patch: { [id]: numeric ? Number(elements[id].value) : elements[id].checked } });
      showMessage("设置已保存");
    } catch (error) {
      showMessage(error.message, true);
    }
  });
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => {
      const selected = item === tab;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
    });
    document.querySelectorAll(".pane").forEach((pane) => pane.classList.toggle("active", pane.id === tab.dataset.pane));
  });
});

elements.toggleBridgeToken.addEventListener("click", () => {
  const reveal = elements.bridgeToken.type === "password";
  elements.bridgeToken.type = reveal ? "text" : "password";
  elements.toggleBridgeToken.textContent = reveal ? "●" : "◉";
});

elements.saveAnalyzer.addEventListener("click", async () => {
  let bridgeBaseUrl;
  try {
    bridgeBaseUrl = normalizeBridgeBaseUrl(elements.bridgeBaseUrl.value);
  } catch (error) {
    showMessage(error.message, true);
    return;
  }
  const token = elements.bridgeToken.value.trim();
  if (!token && !currentIntegration?.bridgeConfigured) {
    showMessage("请输入本地分析服务令牌", true);
    return;
  }
  elements.saveAnalyzer.disabled = true;
  try {
    const granted = await chrome.permissions.request({ origins: [permissionPatternForBridgeUrl(bridgeBaseUrl)] });
    if (!granted) throw new Error("未获得本地分析地址访问权限");
    await requestLocalNetworkAccess(bridgeBaseUrl);
    const integration = await request(MESSAGE.SAVE_LOCAL_ANALYZER, { bridgeBaseUrl, bridgeToken: token });
    currentSettings = { ...currentSettings, bridgeBaseUrl };
    elements.bridgeToken.value = "";
    renderIntegration(integration);
    showMessage("本地分析连接已保存");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    elements.saveAnalyzer.disabled = false;
  }
});

elements.testAnalyzer.addEventListener("click", async () => {
  showMessage("正在测试本地分析服务…");
  try {
    await requestLocalNetworkAccess(currentSettings.bridgeBaseUrl);
    const integration = await request(MESSAGE.TEST_GROK_API);
    renderIntegration(integration);
    const configured = integration.analyzer?.configured;
    elements.analyzerStatus.textContent = configured ? "可用" : "待配置 API";
    elements.analyzerStatus.classList.toggle("ready", configured);
    showMessage(configured ? "本地分析服务连接正常" : "服务已连接，请打开本地 AI 设置填写 API Key", !configured);
  } catch (error) {
    elements.analyzerStatus.textContent = "连接失败";
    elements.analyzerStatus.classList.remove("ready");
    showMessage(error.message, true);
  }
});

elements.openAnalyzerSettings.addEventListener("click", () => {
  const baseUrl = normalizeBridgeBaseUrl(elements.bridgeBaseUrl.value || currentSettings.bridgeBaseUrl);
  chrome.tabs.create({ url: `${baseUrl}/` });
});

elements.migrateLegacyConfig.addEventListener("click", async () => {
  elements.migrateLegacyConfig.disabled = true;
  showMessage("正在将旧 API 配置迁移到本地服务…");
  try {
    await requestLocalNetworkAccess(currentSettings.bridgeBaseUrl);
    const integration = await request(MESSAGE.MIGRATE_LEGACY_AI_CONFIG);
    renderIntegration(integration);
    elements.analyzerStatus.textContent = "可用";
    elements.analyzerStatus.classList.add("ready");
    showMessage("迁移完成，API Key 已从插件中移除");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    elements.migrateLegacyConfig.disabled = false;
  }
});

elements.manualTopNarrative.addEventListener("click", async () => {
  elements.manualTopNarrative.disabled = true;
  showMessage("正在读取 GMGN 当前榜首…");
  try {
    await requestLocalNetworkAccess(currentSettings.bridgeBaseUrl);
    const tabs = await chrome.tabs.query({ url: "https://gmgn.ai/trend*" });
    const tab = tabs.find((item) => item.active) || tabs[0];
    if (!tab?.id) throw new Error("请先打开 GMGN 热门榜页面");
    let topTokenResponse;
    try {
      topTokenResponse = await chrome.tabs.sendMessage(tab.id, {
        target: MESSAGE_TARGET.CONTENT,
        type: MESSAGE.GET_CURRENT_TOP_TOKEN,
      });
    } catch (error) {
      const disconnected = /Receiving end does not exist|Extension context invalidated/i.test(error?.message || "");
      throw new Error(disconnected ? "GMGN 页面仍在使用旧插件，请刷新该页面后重试" : error.message);
    }
    if (!topTokenResponse?.ok) throw new Error(topTokenResponse?.error || "无法读取当前榜首");
    await request(MESSAGE.MANUAL_NARRATIVE, { token: topTokenResponse.token });
    showMessage(`已发送 ${topTokenResponse.token.symbol || "榜首代币"}，结果将在 GMGN 面板显示`);
  } catch (error) {
    showMessage(error.message || "手动分析失败", true);
  } finally {
    elements.manualTopNarrative.disabled = false;
  }
});

elements.testSound.addEventListener("click", async () => {
  try {
    await request(MESSAGE.TEST_SOUND);
    showMessage("提醒音正常");
  } catch (error) {
    showMessage(error.message, true);
  }
});

elements.openGmgn.addEventListener("click", () => chrome.tabs.create({ url: GMGN_URL }));

async function requestLocalNetworkAccess(baseUrl) {
  try {
    await fetch(`${normalizeBridgeBaseUrl(baseUrl)}/health`, { cache: "no-store" });
  } catch (_) {
    throw new Error("Chrome 未允许插件访问本地分析服务");
  }
}

request(MESSAGE.GET_BOOTSTRAP).then(render).catch((error) => showMessage(error.message, true));
