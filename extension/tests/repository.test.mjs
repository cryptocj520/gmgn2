import test from "node:test";
import assert from "node:assert/strict";
import { DataRepository } from "../src/background/data-repository.js";
import { AiConfigStore } from "../src/background/ai-config-store.js";
import { STORAGE_KEYS } from "../src/shared/constants.js";

function storage(initial = {}) {
  const data = structuredClone(initial);
  const writes = [];
  return { data, writes,
    async get(keys) { return Object.fromEntries(keys.map(key => [key, structuredClone(data[key])])); },
    async set(patch) { writes.push(structuredClone(patch)); Object.assign(data, structuredClone(patch)); },
  };
}
const token = { id: "sol:a", chain: "sol", address: "a", symbol: "A", rank: 1 };

test("未配置 AI 时可以启动并读取公开配置", async () => {
  const config = new AiConfigStore(storage());
  assert.equal((await config.getPublic()).grokBaseUrl, "");
  assert.equal(await config.isConfigured(), false);
});

test("相同扫描不重复写存储，旧 schema 已见记录保留且不强制重建基线", async () => {
  const area = storage({ [STORAGE_KEYS.DATA]: {
    schemaVersion: 5, tokens: { [token.id]: { ...token, firstSeen: Date.now(), lastSeen: Date.now(), alertedAt: Date.now() } },
    events: [], narrativeJobs: {}, updatedAt: 1,
  } });
  const repo = new DataRepository(area);
  assert.equal((await repo.getBootstrap()).summary.requiresBaseline, false);
  await repo.processScan([token]);
  const count = area.writes.length;
  await repo.processScan([token]);
  assert.equal(area.writes.length, count);
  assert.equal(repo.data.tokens[token.id].id, "sol:a");
});

test("AI 默认支持两任务并发且同一任务不能重复领取", async () => {
  const repo = new DataRepository(storage());
  const queued = await repo.queueNarratives([0, 1, 2].map(detectedAt => ({ ...token, id: `${token.id}-${detectedAt}`, detectedAt })));
  assert.equal((await repo.claimNarrativeJob(queued.jobIds[0], 1000, 10)).claimed, true);
  assert.equal((await repo.claimNarrativeJob(queued.jobIds[0], 1000, 10)).claimed, false);
  assert.equal((await repo.claimNarrativeJob(queued.jobIds[1], 1000, 10)).claimed, true);
  assert.equal((await repo.claimNarrativeJob(queued.jobIds[2], 1000, 10)).claimed, false);
  await repo.updateSettings({ maxConcurrentAnalyses: 3 });
  assert.equal((await repo.claimNarrativeJob(queued.jobIds[2], 1000, 10)).claimed, true);
});

test("取消新任务不修改同币种已完成的旧分析", async () => {
  const repo = new DataRepository(storage());
  await repo.initialize();
  repo.data.events = [
    { ...token, detectedAt: 1, narrative: { status: "ready", analysis: { story: "旧结果" } } },
    { ...token, detectedAt: 2 },
  ];
  await repo.queueNarratives([{ ...token, detectedAt: 2 }]);
  await repo.cancelNarrativeJobs();
  assert.equal(repo.data.events[0].narrative.status, "ready");
  assert.equal(repo.data.events[1].narrative.status, "cancelled");
});

test("旧记录用最近抓取时间迁移续期，不会因首次发现时间过旧丢失已见身份", async () => {
  const area = storage({ [STORAGE_KEYS.DATA]: {
    schemaVersion: 6, tokens: { [token.id]: {
      ...token, firstSeen: 1, lastAppearedAt: 1, capturedAt: Date.now(), snapshot: "旧行文本", alertedAt: 1,
    } }, events: [], narrativeJobs: {},
  } });
  const repo = new DataRepository(area);
  const result = await repo.processScan([token]);
  assert.equal(result.removed, 0);
  assert.equal(result.alerts.length, 0);
  assert.equal(repo.data.tokens[token.id].firstSeen, 1);
  assert.equal(repo.data.tokens[token.id].snapshot, undefined);
});

test("唤醒队列时仍遵守失败任务的重试等待时间", async () => {
  const repo = new DataRepository(storage());
  const { jobIds } = await repo.queueNarratives([{ ...token, detectedAt: 1 }]);
  const before = Date.now();
  await repo.retryNarrativeJob(jobIds[0], "暂时失败");
  const claim = await repo.claimNarrativeJob(jobIds[0], 1000);
  assert.equal(claim.claimed, false);
  assert.ok(claim.retryAt >= before + 15000);
  assert.equal((await repo.claimNarrativeJob(jobIds[0], 1000, claim.retryAt)).claimed, true);
});
