import { GROK, MESSAGE, MESSAGE_TARGET, STORAGE_KEYS } from "../shared/constants.js";
import { buildTrendUrl } from "../shared/gmgn-navigation.js";
import {
  normalizeAuthType,
  normalizeGrokApiMode,
  normalizeGrokBaseUrl,
  normalizeGrokModel,
  normalizeTimeoutSeconds,
  permissionPatternForBaseUrl,
  insecureAiTransportWarning,
} from "../shared/grok-config.js";
import { formatClock, parseManualContractAddress } from "../shared/token.js";

const settingIds = [
  "autoStart", "sound", "desktopNotifications", "autoRefreshOnStall", "alertTopN",
  "intervalSeconds", "connectionTimeoutSeconds", "retentionDays", "narrativeEnabled",
  "maxConcurrentAnalyses", "minLiquidity", "minHolders", "minMarketCap",
];
const elements = Object.fromEntries([
  ...settingIds, "seenCount", "eventCount", "updatedAt", "testSound", "openGmgn", "message", "transportWarning",
  "analyzerStatus", "grokBaseUrl", "grokModelInput", "grokApiMode", "grokAuthType", "timeoutSeconds",
  "enableWebSearch", "enableXSearch", "grokApiKey", "toggleKey",
  "saveAnalyzer", "testAnalyzer", "manualTopNarrative", "manualCaAddress", "manualCaNarrative", "openSettingsTab",
].map((id) => [id, document.getElementById(id)]));
let currentSettings = null;
let currentAiConfig = null;
const recentConfirmations = new Map();
const RECENT_CONFIRMATION_MS = 10000;

function takeRecentConfirmation(button, key) {
  const pending = recentConfirmations.get(button);
  recentConfirmations.delete(button);
  return Boolean(pending && pending.key === key && Date.now() < pending.until);
}

function showRecentAnalysisPrompt(button, key) {
  recentConfirmations.set(button, { key, until: Date.now() + RECENT_CONFIRMATION_MS });
  showMessage(`该代币 ${GROK.RECENT_ANALYSIS_HOURS} 小时内已分析过，结果在 GMGN 面板查看；再点一次将重新分析`);
}

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
  for (const id of ["maxConcurrentAnalyses", "minLiquidity", "minHolders", "minMarketCap"]) {
    elements[id].value = String(settings[id]);
  }
  elements.grokBaseUrl.value = currentAiConfig.grokBaseUrl || "";
  updateTransportWarning();
  elements.grokModelInput.value = currentAiConfig.grokModel || GROK.MODEL;
  elements.grokApiMode.value = currentAiConfig.apiMode || "openai-responses";
  elements.grokAuthType.value = currentAiConfig.authType || "auto";
  elements.timeoutSeconds.value = String(currentAiConfig.timeoutSeconds || GROK.DEFAULT_TIMEOUT_SECONDS);
  elements.enableWebSearch.checked = currentAiConfig.enableWebSearch !== false;
  elements.enableXSearch.checked = currentAiConfig.enableXSearch !== false;
  elements.seenCount.textContent = String(summary.totalSeen);
  elements.eventCount.textContent = String(summary.recentEvents.length);
  elements.updatedAt.textContent = summary.updatedAt ? formatClock(summary.updatedAt).slice(0, 5) : "--:--";
  renderIntegration(currentAiConfig);
}

function updateTransportWarning() {
  const warning = insecureAiTransportWarning(elements.grokBaseUrl.value);
  elements.transportWarning.textContent = warning;
  elements.transportWarning.hidden = !warning;
}

elements.grokBaseUrl.addEventListener("input", updateTransportWarning);

function renderIntegration(integration) {
  currentAiConfig = { ...currentAiConfig, ...integration };
  const configured = Boolean(integration.configured || integration.grokConfigured);
  elements.analyzerStatus.textContent = configured ? "已配置" : "未配置";
  elements.analyzerStatus.classList.toggle("ready", configured);
  elements.grokApiKey.placeholder = configured ? "已保存（不会回显）" : "输入 API Key";
}

settingIds.forEach((id) => {
  elements[id].addEventListener("change", async () => {
    const numeric = ["alertTopN", "intervalSeconds", "connectionTimeoutSeconds", "retentionDays",
      "maxConcurrentAnalyses", "minLiquidity", "minHolders", "minMarketCap"].includes(id);
    try {
      currentSettings = await request(MESSAGE.UPDATE_SETTINGS, { patch: { [id]: numeric ? Number(elements[id].value) : elements[id].checked } });
      if (numeric) elements[id].value = String(currentSettings[id]);
      showMessage("设置已保存");
    } catch (error) {
      showMessage(error.message, true);
    }
  });
});

function showPane(paneId) {
  document.querySelectorAll(".tab").forEach((item) => {
    const selected = item.dataset.pane === paneId;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-selected", String(selected));
  });
  document.querySelectorAll(".pane").forEach((pane) => pane.classList.toggle("active", pane.id === paneId));
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => showPane(tab.dataset.pane));
});

if (!chrome.windows || window.innerWidth > 400) document.body.classList.add("is-tab");
if (location.hash === "#narrative") showPane("narrativePane");

elements.openSettingsTab.addEventListener("click", () => {
  chrome.tabs.create({ url: `${chrome.runtime.getURL("src/popup/popup.html")}#narrative` });
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

function setNarrativeActionsDisabled(disabled) {
  elements.manualTopNarrative.disabled = disabled;
  elements.manualCaNarrative.disabled = disabled;
  elements.manualCaAddress.disabled = disabled;
}

async function readCurrentPageTopToken() {
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
  return topTokenResponse.token;
}

elements.manualTopNarrative.addEventListener("click", async () => {
  setNarrativeActionsDisabled(true);
  showMessage("正在读取 GMGN 当前榜首…");
  try {
    const token = await readCurrentPageTopToken();
    const key = token.id;
    const force = takeRecentConfirmation("top", key);
    const { alreadyInProgress, recentAnalysis } = await request(MESSAGE.MANUAL_NARRATIVE, { token, force });
    if (recentAnalysis) {
      showRecentAnalysisPrompt("top", key);
      return;
    }
    showMessage(alreadyInProgress ? "该代币正在分析中，结果将在 GMGN 面板显示" : `已发送 ${token.symbol || "榜首代币"}，结果将在 GMGN 面板显示`);
  } catch (error) {
    showMessage(error.message || "手动分析失败", true);
  } finally {
    setNarrativeActionsDisabled(false);
  }
});

elements.manualCaNarrative.addEventListener("click", async () => {
  let address;
  try {
    address = parseManualContractAddress(elements.manualCaAddress.value);
  } catch (error) {
    showMessage(error.message, true);
    return;
  }
  setNarrativeActionsDisabled(true);
  showMessage("正在提交分析…");
  try {
    // 后台先查本地已见记录，查不到再按地址格式和上次浏览的链定链，不需要打开热门榜
    const force = takeRecentConfirmation("ca", address);
    const { event, alreadyInProgress, recentAnalysis } = await request(MESSAGE.MANUAL_CA_NARRATIVE, { address, force });
    if (recentAnalysis) {
      showRecentAnalysisPrompt("ca", address);
      return;
    }
    showMessage(alreadyInProgress ? "该代币正在分析中，结果将在 GMGN 面板显示" : `已发送 ${event?.symbol || "该合约"}，结果将在 GMGN 面板显示`);
  } catch (error) {
    showMessage(error.message || "手动分析失败", true);
  } finally {
    setNarrativeActionsDisabled(false);
  }
});

elements.manualCaAddress.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  elements.manualCaNarrative.click();
});

elements.testSound.addEventListener("click", async () => {
  try {
    await request(MESSAGE.TEST_SOUND);
    showMessage("提醒音正常");
  } catch (error) {
    showMessage(error.message, true);
  }
});

elements.openGmgn.addEventListener("click", async () => {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.LAST_CHAIN);
    await chrome.tabs.create({ url: buildTrendUrl(stored[STORAGE_KEYS.LAST_CHAIN]) });
  } catch (error) {
    showMessage(error.message || "打开 GMGN 失败", true);
  }
});

request(MESSAGE.GET_BOOTSTRAP).then(render).catch((error) => showMessage(error.message, true));
