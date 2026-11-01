import { FOMO, FOMO_EXCLUDED_ADDRESSES, FOMO_STATUS } from "./constants.js";
import { isFomoWalletCode, normalizeWalletCode } from "./fingerprint.js";
import { createRobinhoodRpc } from "./rpc.js";

export function isRobinhoodToken(token) {
  return String(token?.chain || "").trim().toLowerCase() === FOMO.CHAIN;
}

export function topicAddress(topic) {
  if (!topic || String(topic).length < 42) return "";
  return `0x${String(topic).slice(-40).toLowerCase()}`;
}

export function transferAmount(log) {
  const data = String(log?.data || "0x").replace(/^0x/i, "");
  if (!data) return 0n;
  try {
    return BigInt(`0x${data}`);
  } catch (_) {
    return 0n;
  }
}

export function holdersFromTransfers(logs) {
  const balances = new Map();
  const bump = (address, delta) => {
    if (!address || FOMO_EXCLUDED_ADDRESSES.includes(address)) return;
    balances.set(address, (balances.get(address) || 0n) + delta);
  };
  logs.forEach((log) => {
    const amount = transferAmount(log);
    if (!amount) return;
    bump(topicAddress(log.topics?.[1]), -amount);
    bump(topicAddress(log.topics?.[2]), amount);
  });
  return [...balances.entries()]
    .filter(([, balance]) => balance > 0n)
    .sort((left, right) => (left[1] === right[1] ? 0 : left[1] > right[1] ? -1 : 1))
    .map(([address]) => address);
}

export function formatFomoShareLabel({ fomoCount = 0, walletCount = 0, truncated = false, failed = 0, live = false } = {}) {
  if (!walletCount) return "FOMO 无法统计";
  const percent = (fomoCount / walletCount) * 100;
  const shown = Math.abs(percent - Math.round(percent)) < 0.05
    ? String(Math.round(percent))
    : percent.toFixed(1);
  const notes = [];
  if (truncated) notes.push("已截断");
  if (failed) notes.push(`${failed} 个查询失败`);
  const extra = notes.length ? `，${notes.join("，")}` : "";
  const liveMark = live ? " · 跟着刷" : "";
  return `FOMO 持仓 ${shown}%（${fomoCount}/${walletCount}${extra}）${liveMark}`;
}

async function mapPool(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) || 0 }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function collectHolders(tokenAddress, rpc) {
  const latest = await rpc.getBlockNumber();
  const start = Math.max(0, latest - FOMO.LOOKBACK_BLOCKS);
  const logs = [];
  let truncated = false;
  let firstChunkHasLogs = false;
  for (let fromBlock = start; fromBlock <= latest; fromBlock += FOMO.LOG_CHUNK_BLOCKS) {
    const toBlock = Math.min(latest, fromBlock + FOMO.LOG_CHUNK_BLOCKS - 1);
    let chunk = [];
    try {
      chunk = await rpc.getLogs(tokenAddress, fromBlock, toBlock);
    } catch (_) {
      truncated = true;
      continue;
    }
    if (fromBlock === start && chunk.length) firstChunkHasLogs = true;
    logs.push(...chunk);
    if (logs.length >= FOMO.MAX_LOGS) {
      truncated = true;
      break;
    }
  }
  if (start > 0 && firstChunkHasLogs) truncated = true;
  const holders = holdersFromTransfers(logs);
  const capped = holders.length > FOMO.MAX_WALLETS;
  return {
    addresses: holders.slice(0, FOMO.MAX_WALLETS),
    truncated: truncated || capped,
    holderCount: holders.length,
  };
}

export async function measureFomoShare(tokenAddress, rpc = createRobinhoodRpc()) {
  const address = String(tokenAddress || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return {
      status: FOMO_STATUS.UNAVAILABLE,
      label: "FOMO 未检测",
      detail: "代币地址不是 Robinhood 合约",
      fomoCount: 0,
      walletCount: 0,
      percent: null,
      kind: "holders",
    };
  }

  const collected = await collectHolders(address, rpc);
  if (!collected.addresses.length) {
    return {
      status: FOMO_STATUS.UNAVAILABLE,
      label: "FOMO 无法统计",
      detail: "回看窗口内没有余额大于 0 的个人钱包",
      fomoCount: 0,
      walletCount: 0,
      percent: null,
      kind: "holders",
    };
  }

  const codes = await mapPool(collected.addresses, FOMO.CODE_CONCURRENCY, async (wallet) => {
    try {
      return { wallet, code: await rpc.getCode(wallet), ok: true };
    } catch (error) {
      return { wallet, error: error.message, ok: false };
    }
  });

  let fomoCount = 0;
  let walletCount = 0;
  let failed = 0;
  codes.forEach((item) => {
    if (!item.ok) {
      failed += 1;
      return;
    }
    if (isFomoWalletCode(item.code)) {
      fomoCount += 1;
      walletCount += 1;
      return;
    }
    if (normalizeWalletCode(item.code) === "0x") walletCount += 1;
  });

  if (!walletCount && failed) {
    return {
      status: FOMO_STATUS.UNAVAILABLE,
      label: "FOMO 未检测",
      detail: "Robinhood 节点查询钱包代码失败",
      fomoCount: 0,
      walletCount: 0,
      percent: null,
      kind: "holders",
    };
  }

  if (!walletCount) {
    return {
      status: FOMO_STATUS.UNAVAILABLE,
      label: "FOMO 无法统计",
      detail: "持有人地址都不是个人钱包",
      fomoCount: 0,
      walletCount: 0,
      percent: null,
      kind: "holders",
    };
  }

  return {
    status: FOMO_STATUS.READY,
    label: formatFomoShareLabel({
      fomoCount,
      walletCount,
      truncated: collected.truncated,
      failed,
    }),
    detail: "按回看窗口内余额大于 0 的个人钱包统计。已截断表示没扫全历史，或持有人多于可查询上限。",
    fomoCount,
    walletCount,
    truncated: collected.truncated,
    failed,
    kind: "holders",
    percent: (fomoCount / walletCount) * 100,
  };
}
