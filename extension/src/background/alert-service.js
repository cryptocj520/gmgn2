import { MESSAGE, MESSAGE_TARGET } from "../shared/constants.js";
import { ensureOffscreenDocument } from "./offscreen-manager.js";
import { buildMinimalCaToken } from "../shared/token.js";
import { normalizeTrendChain } from "../shared/gmgn-navigation.js";

export class AlertService {
  async notify(report, settings, tabId) {
    const actions = [];
    if (settings.sound) actions.push(this.playSound());
    if (settings.desktopNotifications) actions.push(this.showDesktopNotification(report));
    if (Number.isInteger(tabId)) actions.push(this.updateBadge(tabId, report.alerts.length));
    await Promise.allSettled(actions);
  }

  async playSound() {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({
      target: MESSAGE_TARGET.OFFSCREEN,
      type: MESSAGE.PLAY_SOUND,
    });
  }

  async showDesktopNotification(report) {
    const first = report.alerts[0];
    const remaining = report.alerts.length - 1;
    const title = report.alerts.length === 1
      ? `首次进入提醒名次：${first.symbol || "未知代币"}`
      : `${report.alerts.length} 个代币首次进入提醒名次`;
    const message = remaining > 0
      ? `${first.symbol || first.address} 等 ${remaining + 1} 个代币首次进入提醒名次`
      : `${first.chain.toUpperCase()} · ${first.marketCap || "市值未知"}`;

    // 把代币身份保存在通知标识内，后台休眠重启后仍能处理点击。
    const notificationId = `gmgn-token:${encodeURIComponent(first.chain)}:${encodeURIComponent(first.address)}:${Date.now()}`;
    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
      title,
      message,
      priority: 2,
    });
  }

  async handleNotificationClick(notificationId) {
    const match = notificationId.match(/^gmgn-token:([^:]+):([^:]+):\d+$/);
    if (!match) return;
    try {
      const chain = normalizeTrendChain(decodeURIComponent(match[1]));
      if (!chain) return;
      const token = buildMinimalCaToken(chain, decodeURIComponent(match[2]));
      await chrome.tabs.create({ url: token.url });
    } finally {
      await chrome.notifications.clear(notificationId);
    }
  }

  async updateBadge(tabId, increment) {
    const current = await chrome.action.getBadgeText({ tabId });
    const count = Math.min(99, (Number.parseInt(current, 10) || 0) + increment);
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#FF6B57" });
    await chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" });
  }

}
