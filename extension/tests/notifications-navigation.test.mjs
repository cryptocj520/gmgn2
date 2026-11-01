import test from "node:test";
import assert from "node:assert/strict";
import { AlertService } from "../src/background/alert-service.js";
import { DataRepository } from "../src/background/data-repository.js";
import { STORAGE_KEYS } from "../src/shared/constants.js";
import { buildTrendUrl, trendChainFromUrl } from "../src/shared/gmgn-navigation.js";

test("通知点击打开第一个代币页面并关闭通知，后台重建后仍有效", async t => {
  let createdId;
  const opened = [], cleared = [];
  const previous = globalThis.chrome;
  globalThis.chrome = {
    runtime: { getURL: value => `chrome-extension://test/${value}` },
    notifications: { create: async id => { createdId = id; }, clear: async id => { cleared.push(id); } },
    tabs: { create: async options => { opened.push(options.url); } },
  };
  t.after(() => { globalThis.chrome = previous; });
  await new AlertService().showDesktopNotification({ alerts: [
    { chain: "sol", address: "first", symbol: "FIRST" },
    { chain: "eth", address: "second" },
  ] });
  await new AlertService().handleNotificationClick(createdId);
  assert.deepEqual(opened, ["https://gmgn.ai/sol/token/first"]);
  assert.deepEqual(cleared, [createdId]);
});

test("记住最后使用链且重复记录不写入，没有记录时打开无参数热门页", async () => {
  const data = {}, writes = [];
  const repo = new DataRepository({
    get: async () => structuredClone(data),
    set: async patch => { Object.assign(data, structuredClone(patch)); writes.push(patch); },
  });
  assert.equal(buildTrendUrl(), "https://gmgn.ai/trend");
  await repo.rememberTrendChain(trendChainFromUrl("https://gmgn.ai/trend?chain=sol"));
  await repo.rememberTrendChain("sol");
  assert.equal(writes.length, 1);
  await repo.rememberTrendChain("eth");
  assert.equal(buildTrendUrl(data[STORAGE_KEYS.LAST_CHAIN]), "https://gmgn.ai/trend?chain=eth");
  assert.equal(trendChainFromUrl("https://example.com/trend?chain=sol"), "");
  assert.equal(buildTrendUrl("../../bad"), "https://gmgn.ai/trend");
});
