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

export function formatMonthDayClock(value) {
  if (!value) return "-- --:--:--";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

export function shortAddress(address) {
  if (!address || address.length < 12) return address || "";
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

export function parseManualContractAddress(raw) {
  const address = String(raw || "").trim();
  if (!address) throw new Error("请输入合约地址");
  if (/\s/.test(address)) throw new Error("合约地址不能包含空格");
  if (address.length < 20 || address.length > 128) throw new Error("合约地址格式不正确");
  if (/^0x/i.test(address)) {
    if (!/^0x[a-fA-F0-9]{40,80}$/.test(address)) throw new Error("合约地址格式不正确");
    return `0x${address.slice(2)}`;
  }
  if (!/^[A-Za-z0-9_.:-]+$/.test(address)) throw new Error("合约地址格式不正确");
  if (/^[0-9_.:-]+$/.test(address)) throw new Error("合约地址格式不正确");
  return address;
}

export function buildMinimalCaToken(chain, address) {
  const parsed = parseTokenHref(`https://gmgn.ai/${encodeURIComponent(String(chain || "").trim())}/token/${encodeURIComponent(address)}`);
  if (!parsed?.chain || !parsed?.address || !parsed?.id) throw new Error("无法读取当前页面的链信息");
  const label = shortAddress(parsed.address) || parsed.address;
  return {
    chain: parsed.chain,
    address: parsed.address,
    id: parsed.id,
    url: parsed.url,
    symbol: label,
    name: label,
  };
}
