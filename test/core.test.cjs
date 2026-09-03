const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildMetrics,
  findMetric,
  normalizeText,
  parseTokenHref,
  splitNewTokens,
} = require("../src/core.js");

test("parses GMGN EVM token links with a stable lowercase identity", () => {
  assert.deepEqual(
    parseTokenHref("/robinhood/token/0xAbCd?foo=1"),
    {
      chain: "robinhood",
      address: "0xAbCd",
      id: "robinhood:0xabcd",
      url: "https://gmgn.ai/robinhood/token/0xAbCd",
    },
  );
});

test("keeps case-sensitive non-EVM addresses intact", () => {
  const parsed = parseTokenHref("https://gmgn.ai/sol/token/AbCDefPump");
  assert.equal(parsed.id, "sol:AbCDefPump");
  assert.equal(parsed.address, "AbCDefPump");
});

test("rejects non-token links", () => {
  assert.equal(parseTokenHref("/trend?chain=robinhood"), null);
  assert.equal(parseTokenHref("not a url", "not a base"), null);
});

test("normalizes table metrics and finds unambiguous market cap", () => {
  const metrics = buildMetrics(
    ["币种 / 时间", " 市值 ", "历史最高市值", "1h 成交额"],
    ["ABC 2m", "$120K", "$300K", "$50K"],
  );
  assert.equal(metrics["市值"], "$120K");
  assert.equal(findMetric(metrics, ["市值"], ["历史最高"]), "$120K");
  assert.equal(findMetric(metrics, ["成交额"]), "$50K");
  assert.equal(normalizeText(" A  \n B "), "A B");
});

test("splits unseen tokens without treating duplicate symbols as identical", () => {
  const tokens = [
    { id: "robinhood:0x1", symbol: "ABC" },
    { id: "robinhood:0x2", symbol: "ABC" },
  ];
  const result = splitNewTokens(tokens, new Set(["robinhood:0x1"]));
  assert.deepEqual(result.known.map((token) => token.id), ["robinhood:0x1"]);
  assert.deepEqual(result.fresh.map((token) => token.id), ["robinhood:0x2"]);
});
