import { FOMO } from "./constants.js";

export function normalizeWalletCode(code) {
  const raw = String(code || "").trim().toLowerCase();
  if (!raw || raw === "0x0") return "0x";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

export function isFomoWalletCode(code) {
  return normalizeWalletCode(code) === FOMO.WALLET_CODE;
}
