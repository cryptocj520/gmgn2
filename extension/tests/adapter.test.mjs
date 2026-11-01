import test from "node:test";
import assert from "node:assert/strict";
import { GmgnTrendAdapter } from "../src/content/adapters/gmgn-trend-adapter.js";

test("涨跌幅优先读取表头对应列，忽略市值单元格内的其他百分比", () => {
  const adapter = new GmgnTrendAdapter({}, { origin: "https://gmgn.ai" });
  const anchor = { querySelector: () => null, textContent: "A" };
  const row = {
    getAttribute: () => "0", textContent: "市值 $1M 90% 涨跌幅 -12%",
    querySelectorAll: selector => selector === ":scope > td"
      ? ["A", "$1M 90%", "-12%"].map(textContent => ({ textContent })) : [],
  };
  const result = adapter.extractToken(anchor, row, ["代币", "市值", "24h 涨跌幅"], { id: "sol:a", address: "a", chain: "sol" });
  assert.equal(result.priceChange, "-12%");
});

test("找不到榜单或关键表头时返回明确的结构变化错误", async () => {
  const adapter = new GmgnTrendAdapter({ querySelectorAll: () => [] }, { origin: "https://gmgn.ai" });
  await assert.rejects(adapter.readTokens(), /GMGN 页面结构可能已变化/);
  adapter.findLeaderboard = () => ({});
  adapter.readHeaders = () => ["代币", "市值"];
  await assert.rejects(adapter.readTokens(), /GMGN 页面结构可能已变化.*成交额/);
});
