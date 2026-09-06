import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const configPath = resolve(dirname(fileURLToPath(import.meta.url)), ".analysis-config.json");

const defaults = Object.freeze({
  grokBaseUrl: "http://192.119.105.12:9434/v1",
  grokModel: "grok-4.6",
  apiMode: "responses",
  searchMode: "native",
  enableXSearch: true,
  timeoutSeconds: 90,
  apiKey: "",
});

export async function loadAnalysisConfig() {
  try {
    const stored = JSON.parse(await readFile(configPath, "utf8"));
    return normalizeConfig({ ...defaults, ...stored });
  } catch (_) {
    return { ...defaults };
  }
}

export async function saveAnalysisConfig(input) {
  const current = await loadAnalysisConfig();
  const next = normalizeConfig({
    ...current,
    ...input,
    apiKey: String(input.apiKey || "").trim() || current.apiKey,
  });
  if (!next.apiKey) throw new Error("请输入 XAI_API_KEY");
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return publicAnalysisConfig(next);
}

export function publicAnalysisConfig(config) {
  return {
    configured: Boolean(config.apiKey),
    grokBaseUrl: config.grokBaseUrl,
    grokModel: config.grokModel,
    apiMode: config.apiMode,
    searchMode: config.searchMode,
    enableXSearch: config.enableXSearch,
    timeoutSeconds: config.timeoutSeconds,
  };
}

function normalizeConfig(value) {
  const url = new URL(String(value.grokBaseUrl || defaults.grokBaseUrl).trim());
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("中转地址只支持 HTTP 或 HTTPS");
  if (url.username || url.password || url.search || url.hash) throw new Error("中转地址不能包含认证或查询参数");
  const grokBaseUrl = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  const grokModel = String(value.grokModel || defaults.grokModel).trim();
  if (!grokModel || grokModel.length > 100) throw new Error("模型名称无效");
  const apiMode = ["responses", "chat_completions"].includes(value.apiMode)
    ? value.apiMode
    : defaults.apiMode;
  const searchMode = ["native", "official_tools", "disabled"].includes(value.searchMode)
    ? value.searchMode
    : defaults.searchMode;
  const timeoutSeconds = Math.min(180, Math.max(15, Number(value.timeoutSeconds) || defaults.timeoutSeconds));
  return {
    grokBaseUrl,
    grokModel,
    apiMode,
    searchMode,
    enableXSearch: value.enableXSearch !== false,
    timeoutSeconds,
    apiKey: String(value.apiKey || "").trim(),
  };
}
