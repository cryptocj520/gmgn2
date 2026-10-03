import { FOMO, FOMO_EXCLUDED_ADDRESSES, FOMO_STATUS } from "./constants.js";
import { isFomoWalletCode, normalizeWalletCode } from "./fingerprint.js";
import { createRobinhoodRpc } from "./rpc.js";

export function isRobinhoodToken(token) {
  return String(token?.chain || "").trim().toLowerCase() === FOMO.CHAIN;
}

export function recipientFromTransferLog(log) {
  const topicTo = log?.topics?.[2];
  if (!topicTo || String(topicTo).length < 42) return "";
  return `0x${String(topicTo).slice(-40).toLowerCase()}`;
}

export function formatFomoShareLabel({ fomoCount = 0, walletCount = 0, truncated = false, failed = 0 } = {}) {
  if (!walletCount) return "FOMO 无法统计";
  const percent = (fomoCount / walletCount) * 100;
  const shown = Math.abs(percent - Math.round(percent)) < 0.05
    ? String(Math.round(percent))
    : percent.toFixed(1);
  const notes = [];
  if (truncated) notes.push("已截断");
  if (failed) notes.push(`${failed} 个查询失败`);
  const extra = notes.length ? `，${notes.join("，")}` : "";
  return `FOMO 样本 ${shown}%（${fomoCount}/${walletCount}${extra}）`;
}

function uniqueRecipientsNewestFirst(logs) {
  const addresses = [];
  const seen = new Set();
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const address = recipientFromTransferLog(logs[index]);
    if (!address || FOMO_EXCLUDED_ADDRESSES.includes(address) || seen.has(address)) continue;
    seen.add(address);
    addresses.push(address);
  }
  return addresses;
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

export async function collectTransferRecipients(tokenAddress, rpc) {
  const latest = await rpc.getBlockNumber();
  const start = Math.max(0, latest - FOMO.LOOKBACK_BLOCKS);
  const logs = [];
  for (let fromBlock = start; fromBlock <= latest; fromBlock += FOMO.LOG_CHUNK_BLOCKS) {
    const toBlock = Math.min(latest, fromBlock + FOMO.LOG_CHUNK_BLOCKS - 1);
    const chunk = await rpc.getLogs(tokenAddress, fromBlock, toBlock);
    logs.push(...chunk);
  }
  const unique = uniqueRecipientsNewestFirst(logs);
  return {
    addresses: unique.slice(0, FOMO.MAX_WALLETS),
    truncated: unique.length > FOMO.MAX_WALLETS,
    uniqueCount: unique.length,
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
    };
  }

  const collected = await collectTransferRecipients(address, rpc);
  if (!collected.addresses.length) {
    return {
      status: FOMO_STATUS.UNAVAILABLE,
      label: "FOMO 无法统计",
      detail: "回看窗口内没有可抽样的收款钱包",
      fomoCount: 0,
      walletCount: 0,
      percent: null,
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
    };
  }

  if (!walletCount) {
    return {
      status: FOMO_STATUS.UNAVAILABLE,
      label: "FOMO 无法统计",
      detail: "抽样地址都不是个人钱包",
      fomoCount: 0,
      walletCount: 0,
      percent: null,
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
    detail: "按回看窗口内最近收款钱包抽样，不能代表当前持仓，也不能区分买入、转账和空投。",
    fomoCount,
    walletCount,
    truncated: collected.truncated,
    failed,
    percent: (fomoCount / walletCount) * 100,
  };
}
