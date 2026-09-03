import { MESSAGE, MESSAGE_TARGET } from "../shared/constants.js";

const OFFSCREEN_PATH = "src/offscreen/offscreen.html";

export class AlertService {
  async notify(report, settings, tabId) {
    const actions = [];
    if (settings.sound) actions.push(this.playSound());
    if (settings.desktopNotifications) actions.push(this.showDesktopNotification(report));
    if (Number.isInteger(tabId)) actions.push(this.updateBadge(tabId, report.alerts.length));
    await Promise.allSettled(actions);
  }

  async playSound() {
    await this.ensureOffscreenDocument();
    await chrome.runtime.sendMessage({
      target: MESSAGE_TARGET.OFFSCREEN,
      type: MESSAGE.PLAY_SOUND,
    });
  }

  async showDesktopNotification(report) {
    const first = report.alerts[0];
    const remaining = report.alerts.length - 1;
    const title = report.alerts.length === 1
      ? `发现新币：${first.symbol || "未知代币"}`
      : `发现 ${report.alerts.length} 个前排新币`;
    const message = remaining > 0
      ? `${first.symbol || first.address} 等 ${remaining + 1} 个代币首次进入榜单`
      : `${first.chain.toUpperCase()} · ${first.marketCap || "市值未知"}`;

    await chrome.notifications.create(`gmgn-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
      title,
      message,
      priority: 2,
    });
  }

  async updateBadge(tabId, increment) {
    const current = await chrome.action.getBadgeText({ tabId });
    const count = Math.min(99, (Number.parseInt(current, 10) || 0) + increment);
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#FF6B57" });
    await chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" });
  }

  async ensureOffscreenDocument() {
    const url = chrome.runtime.getURL(OFFSCREEN_PATH);
    const contexts = chrome.runtime.getContexts
      ? await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] })
      : [];
    if (contexts.length) return;

    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["AUDIO_PLAYBACK"],
        justification: "播放用户启用的新代币提醒音",
      });
    } catch (error) {
      if (!String(error?.message).includes("single offscreen")) throw error;
    }
  }
}
