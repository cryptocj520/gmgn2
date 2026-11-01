import test from "node:test";
import assert from "node:assert/strict";
import { ConnectionWatchdog } from "../src/content/core/connection-watchdog.js";

test("底部状态栏缺失不会启动刷新倒计时，也会取消已排队刷新", () => {
  let now = 0;
  const watchdog = new ConnectionWatchdog({
    storage: { getItem: () => null, setItem() {} }, clock: () => now,
    isOnline: () => true, reload: () => assert.fail("不应刷新"),
  });
  const settings = { autoRefreshOnStall: true, connectionTimeoutSeconds: 10 };
  const missing = { available: false, healthy: false, status: "Missing" };
  assert.equal(watchdog.check(missing, settings).status, "unavailable");
  now = 20_000;
  assert.equal(watchdog.check(missing, settings).status, "unavailable");
  assert.equal(watchdog.state.unhealthySince, null);
  watchdog.check({ available: true, healthy: false }, settings);
  now = 31_000;
  assert.equal(watchdog.check({ available: true, healthy: false }, settings).status, "reload");
  watchdog.check(missing, settings);
  assert.equal(watchdog.reloadTimer, 0);
});
