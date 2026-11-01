import test from "node:test";
import assert from "node:assert/strict";
import { MonitorEngine } from "../src/content/core/monitor-engine.js";

test("页面前台扫描不请求滚动完整榜单，部分扫描不标记其他币种缺席", async () => {
  let deep, complete;
  const engine = new MonitorEngine({
    source: {
      canRunBackgroundFullScan: () => false,
      readTokens: async options => { deep = options.deep; return [{ id: "sol:a", rank: 1 }]; },
    },
    gateway: { processScan: async (_tokens, _baseline, full) => {
      complete = full;
      return { completeSnapshot: full, totalSeen: 1, currentCount: 1, recentEvents: [], alerts: [], processedAt: 1 };
    } },
  });
  engine.state.running = true;
  await engine.scan({ completeSnapshot: true });
  assert.equal(deep, false);
  assert.equal(complete, false);
});

test("有效但暂空的榜单仍执行过期清理", async () => {
  let scans = 0;
  const engine = new MonitorEngine({
    source: { readTokens: async () => [] },
    gateway: { processScan: async () => {
      scans++;
      return { totalSeen: 0, recentEvents: [], alerts: [], processedAt: 1, removed: 1 };
    } },
  });
  engine.needsBaseline = false;
  engine.state.running = true;
  await engine.scan();
  assert.equal(scans, 1);
  assert.equal(engine.state.totalSeen, 0);
});
