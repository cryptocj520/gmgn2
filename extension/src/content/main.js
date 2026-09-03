import { GmgnTrendAdapter } from "./adapters/gmgn-trend-adapter.js";
import { MonitorEngine } from "./core/monitor-engine.js";
import { ConnectionWatchdog } from "./core/connection-watchdog.js";
import { ExtensionGateway } from "./extension-gateway.js";
import { MonitorPanel } from "./ui/monitor-panel.js";

if (window.top === window.self && !document.getElementById("gmgn-monitor-extension-root")) {
  const engine = new MonitorEngine({
    source: new GmgnTrendAdapter(),
    gateway: new ExtensionGateway(),
    watchdog: new ConnectionWatchdog(),
  });
  const panel = new MonitorPanel(engine);
  panel.mount(document.documentElement);
  engine.initialize().catch((error) => engine.fail(error));
}
