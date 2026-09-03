import { GMGN_URL, MESSAGE, MESSAGE_TARGET } from "../shared/constants.js";
import { formatClock } from "../shared/token.js";

const settingIds = [
  "autoStart",
  "sound",
  "desktopNotifications",
  "autoRefreshOnStall",
  "alertTopN",
  "intervalSeconds",
  "connectionTimeoutSeconds",
  "retentionDays",
];
const elements = Object.fromEntries([
  ...settingIds,
  "seenCount",
  "eventCount",
  "updatedAt",
  "testSound",
  "openGmgn",
  "message",
].map((id) => [id, document.getElementById(id)]));

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
  const { settings, summary } = bootstrap;
  elements.autoStart.checked = settings.autoStart;
  elements.sound.checked = settings.sound;
  elements.desktopNotifications.checked = settings.desktopNotifications;
  elements.autoRefreshOnStall.checked = settings.autoRefreshOnStall;
  elements.alertTopN.value = String(settings.alertTopN);
  elements.intervalSeconds.value = String(settings.intervalSeconds);
  elements.connectionTimeoutSeconds.value = String(settings.connectionTimeoutSeconds);
  elements.retentionDays.value = String(settings.retentionDays);
  elements.seenCount.textContent = String(summary.totalSeen);
  elements.eventCount.textContent = String(summary.recentEvents.length);
  elements.updatedAt.textContent = summary.updatedAt ? formatClock(summary.updatedAt).slice(0, 5) : "--:--";
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

elements.openGmgn.addEventListener("click", () => chrome.tabs.create({ url: GMGN_URL }));

request(MESSAGE.GET_BOOTSTRAP)
  .then(render)
  .catch((error) => showMessage(error.message, true));
