import { GMGN_URL, MESSAGE, MESSAGE_TARGET } from "../shared/constants.js";
import {
  normalizeAuthType,
  normalizeGrokApiMode,
  normalizeGrokBaseUrl,
  normalizeGrokModel,
  normalizeTimeoutSeconds,
  permissionPatternForBaseUrl,
} from "../shared/grok-config.js";
import { formatClock } from "../shared/token.js";

const settingIds = [
  "autoStart", "sound", "desktopNotifications", "autoRefreshOnStall", "alertTopN",
  "intervalSeconds", "connectionTimeoutSeconds", "retentionDays", "narrativeEnabled",
];
const elements = Object.fromEntries([
  ...settingIds, "seenCount", "eventCount", "updatedAt", "testSound", "openGmgn", "message",
  "analyzerStatus", "grokBaseUrl", "grokModelInput", "grokApiMode", "grokAuthType", "timeoutSeconds",
  "enableWebSearch", "enableXSearch", "grokApiKey", "toggleKey",
  "saveAnalyzer", "testAnalyzer", "manualTopNarrative",
].map((id) => [id, document.getElementById(id)]));
let currentSettings = null;
let currentAiConfig = null;

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
  const { settings, summary, integrations, aiConfig } = bootstrap;
  currentSettings = settings;
  currentAiConfig = aiConfig || integrations;
  for (const id of ["autoStart", "sound", "desktopNotifications", "autoRefreshOnStall", "narrativeEnabled"]) {
    elements[id].checked = settings[id];
  }
  elements.alertTopN.value = String(settings.alertTopN);
  elements.intervalSeconds.value = String(settings.intervalSeconds);
  elements.connectionTimeoutSeconds.value = String(settings.connectionTimeoutSeconds);
  elements.retentionDays.value = String(settings.retentionDays);
  elements.grokBaseUrl.value = currentAiConfig.grokBaseUrl || "";
  elements.grokModelInput.value = currentAiConfig.grokModel || "";
  elements.grokApiMode.value = currentAiConfig.apiMode || "openai-responses";
  elements.grokAuthType.value = currentAiConfig.authType || "auto";
  elements.timeoutSeconds.value = String(currentAiConfig.timeoutSeconds || 180);
  elements.enableWebSearch.checked = currentAiConfig.enableWebSearch !== false;
  elements.enableXSearch.checked = currentAiConfig.enableXSearch !== false;
  elements.seenCount.textContent = String(summary.totalSeen);
  elements.eventCount.textContent = String(summary.recentEvents.length);
  elements.updatedAt.textContent = summary.updatedAt ? formatClock(summary.updatedAt).slice(0, 5) : "--:--";
  renderIntegration(currentAiConfig);
}

function renderIntegration(integration) {
  currentAiConfig = { ...currentAiConfig, ...integration };
  const configured = Boolean(integration.configured || integration.grokConfigured);
  elements.analyzerStatus.textContent = configured ? "已配置" : "未配置";
  elements.analyzerStatus.classList.toggle("ready", configured);
  elements.grokApiKey.placeholder = configured ? "已保存（不会回显）" : "输入 API Key";
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

elements.toggleKey.addEventListener("click", () => {
  const reveal = elements.grokApiKey.type === "password";
  elements.grokApiKey.type = reveal ? "text" : "password";
  elements.toggleKey.textContent = reveal ? "●" : "◉";
});

elements.saveAnalyzer.addEventListener("click", async () => {
  let grokBaseUrl;
  let grokModel;
  let apiMode;
  let authType;
  let timeoutSeconds;
  try {
    grokBaseUrl = normalizeGrokBaseUrl(elements.grokBaseUrl.value);
    grokModel = normalizeGrokModel(elements.grokModelInput.value);
    apiMode = normalizeGrokApiMode(elements.grokApiMode.value);
    authType = normalizeAuthType(elements.grokAuthType.value);
    timeoutSeconds = normalizeTimeoutSeconds(elements.timeoutSeconds.value);
  } catch (error) {
    showMessage(error.message, true);
    return;
  }
  if ((elements.enableWebSearch.checked || elements.enableXSearch.checked) && apiMode !== "openai-responses") {
    showMessage("Grok 联网检索仅支持 OpenAI Responses 协议，请先切换协议", true);
    return;
  }
  const apiKey = elements.grokApiKey.value.trim();
  if (!apiKey && !currentAiConfig?.configured && !currentAiConfig?.grokConfigured) {
    showMessage("请输入 API Key", true);
    return;
  }
  elements.saveAnalyzer.disabled = true;
  try {
    const granted = await chrome.permissions.request({ origins: [permissionPatternForBaseUrl(grokBaseUrl)] });
    if (!granted) throw new Error("未获得 AI 地址访问权限");
    const integration = await request(MESSAGE.SAVE_AI_CONFIG, {
      grokBaseUrl,
      grokModel,
      apiMode,
      authType,
      timeoutSeconds,
      enableWebSearch: elements.enableWebSearch.checked,
      enableXSearch: elements.enableXSearch.checked,
      apiKey,
    });
    elements.grokApiKey.value = "";
    elements.grokApiKey.type = "password";
    renderIntegration(integration);
    showMessage("AI 配置已保存");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    elements.saveAnalyzer.disabled = false;
  }
});

elements.testAnalyzer.addEventListener("click", async () => {
  let grokBaseUrl;
  let grokModel;
  let apiMode;
  let authType;
  let timeoutSeconds;
  try {
    grokBaseUrl = normalizeGrokBaseUrl(elements.grokBaseUrl.value);
    grokModel = normalizeGrokModel(elements.grokModelInput.value);
    apiMode = normalizeGrokApiMode(elements.grokApiMode.value);
    authType = normalizeAuthType(elements.grokAuthType.value);
    timeoutSeconds = normalizeTimeoutSeconds(elements.timeoutSeconds.value);
  } catch (error) {
    showMessage(error.message, true);
    return;
  }
  if ((elements.enableWebSearch.checked || elements.enableXSearch.checked) && apiMode !== "openai-responses") {
    showMessage("Grok 联网检索仅支持 OpenAI Responses 协议，请先切换协议", true);
    return;
  }
  const apiKey = elements.grokApiKey.value.trim();
  if (!apiKey && !currentAiConfig?.configured && !currentAiConfig?.grokConfigured) {
    showMessage("请输入 API Key", true);
    return;
  }
  showMessage((elements.enableWebSearch.checked || elements.enableXSearch.checked)
    ? "正在测试 AI 连接（含检索，可能需要一两分钟）…"
    : "正在测试 AI 连接…");
  try {
    const granted = await chrome.permissions.request({ origins: [permissionPatternForBaseUrl(grokBaseUrl)] });
    if (!granted) throw new Error("未获得 AI 地址访问权限");
    const integration = await request(MESSAGE.TEST_GROK_API, {
      grokBaseUrl,
      grokModel,
      apiMode,
      authType,
      timeoutSeconds,
      enableWebSearch: elements.enableWebSearch.checked,
      enableXSearch: elements.enableXSearch.checked,
      apiKey,
    });
    renderIntegration(integration);
    const search = integration.testSearch;
    const savedHint = integration.configured ? "" : "（尚未保存，请点击保存配置）";
    showMessage(search
      ? `AI 连接正常：Web ${search.webCalls} 次／X ${search.xCalls} 次${savedHint}`
      : `AI 连接正常${savedHint}`);
  } catch (error) {
    elements.analyzerStatus.textContent = "连接失败";
    elements.analyzerStatus.classList.remove("ready");
    showMessage(error.message, true);
  }
});

elements.manualTopNarrative.addEventListener("click", async () => {
  elements.manualTopNarrative.disabled = true;
  showMessage("正在读取 GMGN 当前榜首…");
  try {
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

request(MESSAGE.GET_BOOTSTRAP).then(render).catch((error) => showMessage(error.message, true));
