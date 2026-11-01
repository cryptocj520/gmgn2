import { FOMO } from "./constants.js";

function toHexBlock(value) {
  return `0x${Number(value).toString(16)}`;
}

export async function robinhoodRpc(method, params, timeoutMs = FOMO.TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(FOMO.RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Robinhood 节点查询超时");
    throw new Error("无法连接 Robinhood 节点");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new Error(`Robinhood 节点返回 ${response.status}`);
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    throw new Error("Robinhood 节点返回无法解析");
  }
  if (payload?.error?.message) throw new Error(payload.error.message);
  return payload.result;
}

export async function fetchRobinhoodCode(address) {
  const result = await robinhoodRpc("eth_getCode", [address, "latest"]);
  if (typeof result !== "string") throw new Error("Robinhood 节点没有返回钱包代码");
  return result;
}

export async function fetchLatestBlockNumber() {
  const result = await robinhoodRpc("eth_blockNumber", []);
  const block = Number.parseInt(result, 16);
  if (!Number.isFinite(block)) throw new Error("Robinhood 节点没有返回区块高度");
  return block;
}

export async function fetchTransferLogs(tokenAddress, fromBlock, toBlock) {
  const result = await robinhoodRpc("eth_getLogs", [{
    address: tokenAddress,
    fromBlock: toHexBlock(fromBlock),
    toBlock: toHexBlock(toBlock),
    topics: [FOMO.TRANSFER_TOPIC],
  }], FOMO.LOGS_TIMEOUT_MS);
  if (!Array.isArray(result)) throw new Error("Robinhood 节点没有返回转账日志");
  return result;
}

export function createRobinhoodRpc() {
  return {
    getBlockNumber: fetchLatestBlockNumber,
    getLogs: fetchTransferLogs,
    getCode: fetchRobinhoodCode,
  };
}
