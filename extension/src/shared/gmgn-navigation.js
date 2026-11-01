import { GMGN_URL } from "./constants.js";

export function normalizeTrendChain(value) {
  const chain = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(chain) ? chain : "";
}

export function trendChainFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== "https://gmgn.ai" || !url.pathname.startsWith("/trend")) return "";
    return normalizeTrendChain(url.searchParams.get("chain"));
  } catch (_) {
    return "";
  }
}

export function buildTrendUrl(value) {
  const chain = normalizeTrendChain(value);
  return chain ? `${GMGN_URL}?chain=${encodeURIComponent(chain)}` : GMGN_URL;
}
