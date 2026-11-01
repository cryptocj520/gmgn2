import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAiConfig, insecureAiTransportWarning } from "../src/shared/grok-config.js";
import { parseMetricNumber } from "../src/shared/token.js";

test("空配置有效，带密钥却缺地址仍拒绝", () => {
  assert.equal(normalizeAiConfig({}).grokBaseUrl, "");
  assert.throws(() => normalizeAiConfig({ apiKey: "key-without-url" }), /请填写接口地址/);
});

test("公网 HTTP 警告明文传输，本机和局域网或 HTTPS 不警告", () => {
  for (const url of ["http://8.8.8.8/v1", "http://example.com/v1", "http://172.32.0.1/v1", "http://127.example.com/v1"]) {
    assert.match(insecureAiTransportWarning(url), /明文传输/);
  }
  for (const url of ["", "https://example.com", "http://localhost:18645/v1", "http://127.0.0.2", "http://[::1]", "http://10.0.0.2", "http://172.16.0.2", "http://192.168.1.2", "http://[fd00::2]"]) {
    assert.equal(insecureAiTransportWarning(url), "");
  }
});

test("指标数字解析支持单位、千分位、小数和缺失值", () => {
  for (const [value, expected] of [["$1.25K", 1250], ["2.5m", 2500000], ["3B", 3000000000], ["1,234", 1234], ["1.2万", 12000], ["--", null], ["0", 0]]) {
    assert.equal(parseMetricNumber(value), expected);
  }
});
