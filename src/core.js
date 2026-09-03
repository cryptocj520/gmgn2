(function initGMGNMonitorCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GMGNMonitorCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
  "use strict";

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function parseTokenHref(href, baseUrl = "https://gmgn.ai") {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, baseUrl);
    } catch (_) {
      return null;
    }

    const match = url.pathname.match(/^\/([^/]+)\/token\/([^/?#]+)/i);
    if (!match) return null;

    const chain = decodeURIComponent(match[1]).toLowerCase();
    const address = decodeURIComponent(match[2]);
    const normalizedAddress = address.startsWith("0x") ? address.toLowerCase() : address;
    return {
      chain,
      address,
      id: `${chain}:${normalizedAddress}`,
      url: `${url.origin}/${chain}/token/${encodeURIComponent(address)}`,
    };
  }

  function buildMetrics(headers, cells) {
    const result = {};
    const size = Math.min(headers.length, cells.length);
    for (let index = 0; index < size; index += 1) {
      const key = normalizeText(headers[index]);
      if (key) result[key] = normalizeText(cells[index]);
    }
    return result;
  }

  function findMetric(metrics, include, exclude = []) {
    const keys = Object.keys(metrics || {});
    const key = keys.find((candidate) => {
      const compact = candidate.replace(/\s+/g, "");
      return include.every((part) => compact.includes(part)) &&
        exclude.every((part) => !compact.includes(part));
    });
    return key ? metrics[key] : "";
  }

  function splitNewTokens(tokens, seenKeys) {
    const fresh = [];
    const known = [];
    for (const token of tokens) {
      (seenKeys.has(token.id) ? known : fresh).push(token);
    }
    return { fresh, known };
  }

  function formatClock(value) {
    if (!value) return "--:--:--";
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(value));
  }

  return {
    buildMetrics,
    findMetric,
    formatClock,
    normalizeText,
    parseTokenHref,
    splitNewTokens,
  };
});
