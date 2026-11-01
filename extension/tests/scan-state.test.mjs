import test from "node:test";
import assert from "node:assert/strict";
import { applyScanToState, createDataState } from "../src/shared/scan-state.js";

const DAY = 86_400_000;
const START = 10 * DAY;
const token = (address = "a", extras = {}) => ({
  id: `sol:${address}`, chain: "sol", address, symbol: address, rank: 1, ...extras,
});
const scan = (state, tokens, extras = {}) => applyScanToState(state, tokens, {
  now: START, baseline: false, completeSnapshot: false,
  maxEvents: 3, retentionDays: 7, alertTopN: 5, ...extras,
});

test("基线保存全部币种且不提醒，重复扫描不会重复发现", () => {
  const first = scan(createDataState(), [token(), token("b", { rank: 8 })], { baseline: true });
  assert.equal(first.report.totalSeen, 2);
  assert.equal(first.report.alerts.length, 0);
  assert.equal(first.report.fresh.length, 0);
  const next = scan(first.state, [token()], { now: START + 1000 });
  assert.equal(next.report.fresh.length, 0);
  assert.equal(next.report.alerts.length, 0);
});

test("不同链的同地址视为新币，排名超出范围或缺失仍保存但不提醒", () => {
  const result = scan(createDataState(), [
    token(), token("a", { id: "eth:a", chain: "eth", rank: 5 }),
    token("b", { rank: 6 }), token("c", { rank: undefined }), token("d", { rank: 0 }),
  ]);
  assert.equal(result.report.fresh.length, 5);
  assert.deepEqual(result.report.alerts.map(item => item.id), ["sol:a", "eth:a"]);
  assert.equal(result.report.totalSeen, 5);
});

test("未提醒币种首次进入前 N 名可提醒一次，已提醒币种不会重复提醒", () => {
  const first = scan(createDataState(), [token("a", { rank: 6 })]);
  const next = scan(first.state, [token()], { now: START + 1000 });
  assert.equal(next.report.alerts.length, 1);
  assert.equal(scan(next.state, [token()], { now: START + 2000 }).report.alerts.length, 0);
});

test("最低池子、持有者和市值过滤支持 K/M/B，未通过的新币仍保存", () => {
  const result = scan(createDataState(), [
    token("ok", { liquidity: "$1.5M", holders: "2K", marketCap: "$1B" }),
    token("pool", { liquidity: "$999K", holders: "2K", marketCap: "$1B" }),
    token("holders", { liquidity: "$2M", holders: "999", marketCap: "$1B" }),
    token("cap", { liquidity: "$2M", holders: "2K", marketCap: "$999M" }),
    token("missing"),
  ], { minLiquidity: 1_000_000, minHolders: 1000, minMarketCap: 1_000_000_000 });
  assert.equal(result.report.totalSeen, 5);
  assert.deepEqual(result.report.alerts.map(item => item.address), ["ok"]);
});

test("完整扫描标记首次缺席，持续缺席不改时间，重现清除缺席且不重复提醒", () => {
  const first = scan(createDataState(), [token()], { baseline: true });
  const absent = scan(first.state, [], { completeSnapshot: true, now: START + DAY });
  assert.equal(absent.state.tokens["sol:a"].missingSince, START + DAY);
  const stillAbsent = scan(absent.state, [], { completeSnapshot: true, now: START + 2 * DAY });
  assert.equal(stillAbsent.state.tokens["sol:a"].missingSince, START + DAY);
  const back = scan(stillAbsent.state, [token()], { now: START + 3 * DAY });
  assert.equal(back.state.tokens["sol:a"].missingSince, null);
  assert.equal(back.report.alerts.length, 0);
});

test("缺席保留期边界删除记录，过期重现可重新提醒", () => {
  const first = scan(createDataState(), [token()]);
  const absent = scan(first.state, [], { completeSnapshot: true, now: START + DAY });
  const kept = scan(absent.state, [], { now: START + 8 * DAY - 1 });
  assert.equal(kept.report.totalSeen, 1);
  const expired = scan(kept.state, [], { now: START + 8 * DAY });
  assert.equal(expired.report.removed, 1);
  assert.equal(scan(expired.state, [token()], { now: START + 8 * DAY + 1 }).report.alerts.length, 1);
});

test("没有完整扫描时也按最近出现时间清理，仍出现的币种续期", () => {
  const first = scan(createDataState(), [token(), token("b")], { baseline: true });
  const visible = scan(first.state, [token()], { now: START + 6 * DAY });
  const expired = scan(visible.state, [token()], { now: START + 7 * DAY });
  assert.equal(expired.report.removed, 1);
  assert.deepEqual(Object.keys(expired.state.tokens), ["sol:a"]);
});

test("完全相同扫描和仅抓取时间改变不生成持久化变更", () => {
  const first = scan(createDataState(), [token("a", { capturedAt: START, snapshot: "x".repeat(1800) })]);
  const next = scan(first.state, [token("a", { capturedAt: START + 1000, snapshot: "x".repeat(1800) })], { now: START + 1000 });
  assert.equal(next.changed, false);
  assert.equal(next.state, first.state);
  assert.equal(next.state.tokens["sol:a"].snapshot, undefined);
});

test("事件只保留上限，新事件在前，输入状态不被修改", () => {
  const first = scan(createDataState(), [token("a"), token("b")]);
  const before = structuredClone(first.state);
  const next = scan(first.state, [token("c"), token("d")], { now: START + 1 });
  assert.deepEqual(next.state.events.map(item => item.address), ["d", "c", "b"]);
  assert.deepEqual(first.state, before);
});
