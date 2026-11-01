import test from "node:test";
import assert from "node:assert/strict";
import { DataRepository } from "../src/background/data-repository.js";
import { NarrativeCoordinator } from "../src/background/narrative-coordinator.js";

test("并发满额后的等待任务在空位释放时立即唤醒，不等待整段租约", async t => {
  const previousChrome = globalThis.chrome;
  const alarms = new Map();
  globalThis.chrome = {
    alarms: { create: (name, options) => alarms.set(name, options.when) },
    permissions: { contains: async () => true },
  };
  t.after(() => { globalThis.chrome = previousChrome; });
  const data = {};
  const repo = new DataRepository({
    get: async () => structuredClone(data),
    set: async patch => Object.assign(data, structuredClone(patch)),
  });
  const pending = new Map();
  const coordinator = new NarrativeCoordinator(repo, {
    analyze: token => new Promise(resolve => pending.set(token.id, resolve)),
  }, {
    isConfigured: async () => true,
    getRuntimeConfig: async () => ({ grokBaseUrl: "https://example.com/v1", apiKey: "key" }),
  });
  const queued = await repo.queueNarratives(["a", "b", "c"].map(id => ({ id: `sol:${id}`, detectedAt: 1 })));
  const tasks = queued.jobIds.map(jobId => coordinator.handleAlarm({ name: `gmgn-narrative:${jobId}` }));
  await new Promise(setImmediate);
  assert.equal(pending.size, 2);
  pending.get("sol:a")({ story: "A" });
  await tasks[0];
  const thirdAlarm = alarms.get(`gmgn-narrative:${queued.jobIds[2]}`);
  assert.ok(thirdAlarm <= Date.now() + 1000, "空位释放后必须重新安排等待任务");
  const third = coordinator.handleAlarm({ name: `gmgn-narrative:${queued.jobIds[2]}` });
  await new Promise(setImmediate);
  assert.equal(pending.has("sol:c"), true);
  pending.get("sol:b")({ story: "B" });
  pending.get("sol:c")({ story: "C" });
  await Promise.all([...tasks, third]);
  assert.equal((await repo.getNarrativeJobs()).length, 0);
});
