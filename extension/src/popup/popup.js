import { GMGN_URL, MESSAGE, MESSAGE_TARGET } from "../shared/constants.js";
import { formatClock } from "../shared/token.js";
import { normalizeGrokBaseUrl, normalizeGrokModel, permissionPatternForBaseUrl } from "../shared/grok-config.js";

const settingIds = [
  "autoStart",
  "sound",
  "desktopNotifications",
  "autoRefreshOnStall",
  "alertTopN",
  "intervalSeconds",
  "connectionTimeoutSeconds",
  "retentionDays",
  "narrativeEnabled",
  "grokEnableXSearch",
];
const elements = Object.fromEntries([
  ...settingIds,
  "seenCount",
  "eventCount",
  "updatedAt",
  "testSound",
  "openGmgn",
  "message",
  "grokApiKey",
  "grokStatus",
  "grokModel",
  "grokBaseUrl",
  "grokModelInput",
  "toggleKey",
  "saveGrokKey",
  "testGrokKey",
  "clearGrokKey",
].map((id) => [id, document.getElementById(id)]));
let currentSettings = null;

async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({
    target: MESSAGE_TARGET.BACKGROUND,
    type,
    ...payload,
  });
  if (!response?.ok) throw new Error(response?.error || "扩展后台未响应");
  return response.data;
}

function showMessage(text, isError = false) {
  elements.message.textContent = text;
  elements.message.classList.toggle("error", isError);
}

function render(bootstrap) {
  const { settings, summary, integrations } = bootstrap;
  currentSettings = settings;
  elements.autoStart.checked = settings.autoStart;
  elements.sound.checked = settings.sound;
  elements.desktopNotifications.checked = settings.desktopNotifications;
  elements.autoRefreshOnStall.checked = settings.autoRefreshOnStall;
  elements.alertTopN.value = String(settings.alertTopN);
  elements.intervalSeconds.value = String(settings.intervalSeconds);
  elements.connectionTimeoutSeconds.value = String(settings.connectionTimeoutSeconds);
  elements.retentionDays.value = String(settings.retentionDays);
  elements.narrativeEnabled.checked = settings.narrativeEnabled;
  elements.grokEnableXSearch.checked = settings.grokEnableXSearch;
  elements.grokBaseUrl.value = settings.grokBaseUrl;
  elements.grokModelInput.value = settings.grokModel;
  elements.seenCount.textContent = String(summary.totalSeen);
  elements.eventCount.textContent = String(summary.recentEvents.length);
  elements.updatedAt.textContent = summary.updatedAt ? formatClock(summary.updatedAt).slice(0, 5) : "--:--";
  renderIntegration(integrations);
}

function renderIntegration(integration) {
  elements.grokStatus.textContent = integration.grokConfigured ? "已配置" : "未配置";
  elements.grokStatus.classList.toggle("ready", integration.grokConfigured);
  elements.grokModel.textContent = integration.grokModel;
}

settingIds.forEach((id) => {
  elements[id].addEventListener("change", async () => {
    const numericSetting = ["alertTopN", "intervalSeconds", "connectionTimeoutSeconds", "retentionDays"].includes(id);
    const value = numericSetting ? Number(elements[id].value) : elements[id].checked;
    try {
      await request(MESSAGE.UPDATE_SETTINGS, { patch: { [id]: value } });
      showMessage("设置已保存");
    } catch (error) {
      showMessage(error.message, true);
    }
  });
});

elements.testSound.addEventListener("click", async () => {
  try {
    await request(MESSAGE.TEST_SOUND);
    showMessage("提醒音正常");
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => {
      const selected = item === tab;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
    });
    document.querySelectorAll(".pane").forEach((pane) => {
      pane.classList.toggle("active", pane.id === tab.dataset.pane);
    });
  });
});

elements.toggleKey.addEventListener("click", () => {
  const reveal = elements.grokApiKey.type === "password";
  elements.grokApiKey.type = reveal ? "text" : "password";
  elements.toggleKey.textContent = reveal ? "●" : "◉";
});

elements.saveGrokKey.addEventListener("click", async () => {
  const apiKey = elements.grokApiKey.value.trim();
  if (!apiKey) {
    showMessage("请输入 Grok API Key", true);
    return;
  }
  let grokBaseUrl;
  let grokModel;
  try {
    grokBaseUrl = normalizeGrokBaseUrl(elements.grokBaseUrl.value);
    grokModel = normalizeGrokModel(elements.grokModelInput.value);
  } catch (error) {
    showMessage(error.message, true);
    return;
  }

  const officialOrigin = new URL(grokBaseUrl).origin === "https://api.x.ai";
  const permissionRequest = officialOrigin
    ? Promise.resolve(true)
    : chrome.permissions.request({ origins: [permissionPatternForBaseUrl(grokBaseUrl)] });
  elements.saveGrokKey.disabled = true;
  showMessage("正在验证中转地址和密钥…");
  try {
    const granted = await permissionRequest;
    if (!granted) throw new Error("未获得中转 API 域名访问权限");
    const integration = await request(MESSAGE.SAVE_GROK_API_KEY, {
      apiKey,
      grokBaseUrl,
      grokModel,
    });
    currentSettings = { ...currentSettings, grokBaseUrl, grokModel };
    elements.grokApiKey.value = "";
    elements.grokApiKey.type = "password";
    renderIntegration(integration);
    showMessage("Grok API Key 已保存到扩展私有存储");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    elements.saveGrokKey.disabled = false;
  }
});

elements.testGrokKey.addEventListener("click", async () => {
  showMessage("正在验证现有密钥…");
  try {
    const integration = await request(MESSAGE.TEST_GROK_API);
    renderIntegration(integration);
    showMessage("Grok API 连接正常");
  } catch (error) {
    showMessage(error.message, true);
  }
});

elements.clearGrokKey.addEventListener("click", async () => {
  if (!window.confirm("移除已保存的 Grok API Key？等待中的分析将无法继续。")) return;
  try {
    const integration = await request(MESSAGE.CLEAR_GROK_API_KEY);
    const baseUrl = currentSettings?.grokBaseUrl;
    if (baseUrl && new URL(baseUrl).origin !== "https://api.x.ai") {
      await chrome.permissions.remove({ origins: [permissionPatternForBaseUrl(baseUrl)] });
    }
    elements.grokApiKey.value = "";
    renderIntegration(integration);
    showMessage("Grok API Key 已移除");
  } catch (error) {
    showMessage(error.message, true);
  }
});

elements.openGmgn.addEventListener("click", () => chrome.tabs.create({ url: GMGN_URL }));

request(MESSAGE.GET_BOOTSTRAP)
  .then(render)
  .catch((error) => showMessage(error.message, true));
