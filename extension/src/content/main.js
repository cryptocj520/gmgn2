import { GmgnTrendAdapter } from "./adapters/gmgn-trend-adapter.js";
import { MonitorEngine } from "./core/monitor-engine.js";
import { ConnectionWatchdog } from "./core/connection-watchdog.js";
import { ExtensionGateway } from "./extension-gateway.js";
import { MonitorPanel } from "./ui/monitor-panel.js";
import { MESSAGE, MESSAGE_TARGET } from "../shared/constants.js";

if (window.top === window.self && !document.getElementById("gmgn-monitor-extension-root")) {
  const engine = new MonitorEngine({
    source: new GmgnTrendAdapter(),
    gateway: new ExtensionGateway(),
    watchdog: new ConnectionWatchdog(),
  });
  const panel = new MonitorPanel(engine);
  panel.mount(document.documentElement);
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== MESSAGE_TARGET.CONTENT || message.type !== MESSAGE.GET_CURRENT_TOP_TOKEN) {
      return false;
    }
    engine.getCurrentTopToken()
      .then((token) => sendResponse({ ok: true, token }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "读取榜首代币失败" }));
    return true;
  });
  engine.initialize().catch((error) => engine.fail(error));
}
