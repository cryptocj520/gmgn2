export const FOMO_STATUS = Object.freeze({
  RUNNING: "running",
  READY: "ready",
  UNAVAILABLE: "unavailable",
});

export const FOMO = Object.freeze({
  CHAIN: "robinhood",
  CHAIN_ID: 4663,
  RPC_URL: "https://rpc.mainnet.chain.robinhood.com",
  RPC_PERMISSION: "https://rpc.mainnet.chain.robinhood.com/*",
  // EIP-7702 前缀 0xef0100 + Simple7702Account。这是公开资料里 FOMO App 钱包的链上指纹。
  WALLET_CODE: "0xef0100e6cae83bde06e4c305530e199d7217f42808555b",
  IMPLEMENTATION: "0xe6cae83bde06e4c305530e199d7217f42808555b",
  TRANSFER_TOPIC: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  TIMEOUT_MS: 12000,
  LOGS_TIMEOUT_MS: 20000,
  LOOKBACK_BLOCKS: 50000,
  LOG_CHUNK_BLOCKS: 10000,
  MAX_WALLETS: 80,
  CODE_CONCURRENCY: 4,
});

// 池子、路由、Relay、销毁地址不算“人的钱包”，不进入占比分母。
export const FOMO_EXCLUDED_ADDRESSES = Object.freeze([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0x4337084d9e255ff0702461cf8895ce9e3b5ff108",
  "0x4cd00e387622c35bddb9b4c962c136462338bc31",
  "0xccc88a9d1b4ed6b0eaba998850414b24f1c315be",
  "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f",
  "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
  "0x63c1d3e9c646184529c5694630a01c00df171b56",
  "0xf61a305199fa1135d76ffab3752d42f55cbd775a",
  "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  "0x39b38686a19836ac10162c490e4558e120cbbe5f",
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
].map((address) => address.toLowerCase()));
