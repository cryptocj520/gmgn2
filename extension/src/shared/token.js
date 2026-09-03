export function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function parseTokenHref(href, baseUrl = "https://gmgn.ai") {
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

export function buildMetrics(headers, cells) {
  return headers.slice(0, cells.length).reduce((metrics, header, index) => {
    const key = normalizeText(header);
    if (key) metrics[key] = normalizeText(cells[index]);
    return metrics;
  }, {});
}

export function findMetric(metrics, includes, excludes = []) {
  const key = Object.keys(metrics || {}).find((candidate) => {
    const compact = candidate.replace(/\s+/g, "");
    return includes.every((part) => compact.includes(part)) &&
      excludes.every((part) => !compact.includes(part));
  });
  return key ? metrics[key] : "";
}

export function formatClock(value) {
  if (!value) return "--:--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function shortAddress(address) {
  if (!address || address.length < 12) return address || "";
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}
