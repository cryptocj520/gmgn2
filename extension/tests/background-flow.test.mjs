import test from "node:test";
import assert from "node:assert/strict";
import { MESSAGE, MESSAGE_TARGET, STORAGE_KEYS } from "../src/shared/constants.js";

test("后台无 AI 配置可以启动，过滤未通过时不创建提醒或分析任务", async t => {
  const previousChrome = globalThis.chrome, previousIndexedDb = globalThis.indexedDB;
  const data = {};
  let handler;
  globalThis.indexedDB = { open() { throw new Error("没有旧密钥库"); } };
  globalThis.chrome = {
    storage: { local: {
      get: async () => structuredClone(data),
      set: async patch => Object.assign(data, structuredClone(patch)),
    } },
    runtime: {
      onMessage: { addListener: listener => { handler = listener; } },
      onInstalled: { addListener() {} },
    },
    alarms: { onAlarm: { addListener() {} }, create() { assert.fail("未配置 AI 不应创建分析闹钟"); } },
    notifications: { onClicked: { addListener() {} }, create() { assert.fail("未开启桌面通知"); } },
  };
  t.after(() => { globalThis.chrome = previousChrome; globalThis.indexedDB = previousIndexedDb; });
  await import("../src/background/service-worker.js");
  await new Promise(setImmediate);
  async function send(type, payload = {}, sender = { url: "https://gmgn.ai/trend?chain=sol" }) {
    const result = await new Promise(resolve => {
      assert.equal(handler({ target: MESSAGE_TARGET.BACKGROUND, type, ...payload }, sender, resolve), true);
    });
    assert.equal(result.ok, true, result.error);
    return result.data;
  }
  const bootstrap = await send(MESSAGE.GET_BOOTSTRAP);
  assert.equal(bootstrap.aiConfig.configured, false);
  assert.equal(bootstrap.aiConfig.grokBaseUrl, "");
  await send(MESSAGE.UPDATE_SETTINGS, { patch: { minLiquidity: 1000, sound: false, desktopNotifications: false } });
  const rejected = await send(MESSAGE.PROCESS_SCAN, { tokens: [{ id: "sol:a", address: "a", chain: "sol", rank: 1, liquidity: "$500" }] });
  assert.equal(rejected.totalSeen, 1);
  assert.equal(rejected.alerts.length, 0);
  assert.equal(rejected.recentEvents.length, 0);
  const accepted = await send(MESSAGE.PROCESS_SCAN, { tokens: [{ id: "sol:b", address: "b", chain: "sol", rank: 1, liquidity: "$2K" }] });
  assert.equal(accepted.alerts.length, 1);
  assert.equal(accepted.recentEvents[0].narrative.status, "waiting_key");
  await send(MESSAGE.GET_BOOTSTRAP, { trendPageActive: true }, { url: "https://gmgn.ai/trend?chain=eth", tab: { active: true } });
  await send(MESSAGE.PROCESS_SCAN, { tokens: [], chain: "sol", trendPageActive: false }, { url: "https://gmgn.ai/trend?chain=sol", tab: { active: false } });
  assert.equal(data[STORAGE_KEYS.LAST_CHAIN], "eth", "旧后台标签的扫描不应覆盖最后使用链");
});
