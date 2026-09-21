import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAnalysisConfig, publicAnalysisConfig, saveAnalysisConfig } from "./config-store.mjs";
import { analyzeToken, AnalysisError } from "./grok-analyzer.mjs";

const bridgeDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(bridgeDirectory, "..");
const tokenPath = resolve(bridgeDirectory, ".bridge-token");
const logDirectory = resolve(projectDirectory, "logs");
const logPath = resolve(logDirectory, "bridge.log");
const usageLogPath = resolve(logDirectory, "bridge-usage.log");
const host = process.env.GMGN_BRIDGE_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.GMGN_BRIDGE_PORT || "18761", 10);
const maxBodyBytes = 1024 * 1024;
const staticFiles = new Map([
  ["/", ["dashboard.html", "text/html; charset=utf-8"]],
  ["/dashboard.css", ["dashboard.css", "text/css; charset=utf-8"]],
  ["/dashboard.js", ["dashboard.js", "text/javascript; charset=utf-8"]],
]);

const bridgeToken = await loadBridgeToken();
await mkdir(logDirectory, { recursive: true });

const server = createServer(async (request, response) => {
  setCorsHeaders(request, response);
  if (request.method === "OPTIONS") {
    await log("DEBUG", "收到浏览器预检", {
      origin: request.headers.origin || "",
      requestedHeaders: request.headers["access-control-request-headers"] || "",
      privateNetwork: request.headers["access-control-request-private-network"] === "true",
    });
    response.writeHead(isAllowedOrigin(request.headers.origin) ? 204 : 403);
    response.end();
    return;
  }

  if (request.method === "GET" && staticFiles.has(request.url)) {
    const [filename, contentType] = staticFiles.get(request.url);
    return serveStatic(response, filename, contentType);
  }

  if (request.url === "/config" && request.method === "GET") {
    return writeJson(response, 200, publicAnalysisConfig(await loadAnalysisConfig()));
  }

  if (request.url === "/pairing-token" && request.method === "GET") {
    if (!isDashboardOrigin(request)) return writeJson(response, 403, { error: "只允许本地设置页面读取配对令牌" });
    return writeJson(response, 200, { token: bridgeToken });
  }

  if (request.url === "/config" && request.method === "POST") {
    if (!isDashboardOrigin(request) && !isAuthorized(request)) {
      return writeJson(response, 403, { error: "只允许本地设置页面或已配对插件保存配置" });
    }
    try {
      const config = await saveAnalysisConfig(JSON.parse(await readRequestBody(request)));
      await log("INFO", "本地分析配置已保存", {
        origin: new URL(config.grokBaseUrl).origin,
        model: config.grokModel,
        apiMode: config.apiMode,
      });
      return writeJson(response, 200, config);
    } catch (error) {
      return writeJson(response, 400, { error: error?.message || "保存分析配置失败" });
    }
  }

  if (request.method === "GET" && request.url === "/health") {
    if (!isAuthorized(request)) return writeJson(response, 401, { error: "桥接令牌无效" });
    return writeJson(response, 200, { ok: true, service: "gmgn-local-analyzer" });
  }

  if (request.method === "GET" && request.url === "/analysis-status") {
    if (!isAuthorized(request)) return writeJson(response, 401, { error: "桥接令牌无效" });
    return writeJson(response, 200, publicAnalysisConfig(await loadAnalysisConfig()));
  }

  if (request.method === "POST" && request.url === "/analyze") {
    if (!isAuthorized(request)) return writeJson(response, 401, { error: "桥接令牌无效" });
    const startedAt = Date.now();
    let config = null;
    try {
      const payload = JSON.parse(await readRequestBody(request));
      if (!payload.token?.address || !payload.token?.chain) throw new AnalysisError("代币信息不完整", 400);
      config = await loadAnalysisConfig();
      const result = await analyzeToken(payload.token, config);
      await logUsage({ config, usage: result.usage, success: true });
      await log("INFO", "本地 AI 分析完成", {
        model: config.grokModel,
        apiMode: config.apiMode,
        durationMs: Date.now() - startedAt,
      });
      return writeJson(response, 200, { analysis: result.analysis });
    } catch (error) {
      const status = error instanceof AnalysisError ? error.status : 500;
      await logUsage({ config, usage: error?.usage || null, success: false, errorType: `${status}:${error?.name || "Error"}` });
      await log("ERROR", "本地 AI 分析失败", {
        status,
        message: error?.message || "分析失败",
        durationMs: Date.now() - startedAt,
      });
      return writeJson(response, status, { error: error?.message || "本地 AI 分析失败" });
    }
  }

  writeJson(response, 404, { error: "本地分析服务路径不存在" });
});

server.listen(port, host, async () => {
  await log("INFO", "本地分析服务已启动", { host, port });
  console.log(`GMGN 本地分析服务已启动：http://${host}:${port}`);
  console.log(`配对令牌：${bridgeToken}`);
  console.log("请在浏览器打开上面的地址配置 AI；配对令牌只需填写到插件中。");
});

server.on("error", async (error) => {
  await log("ERROR", "本地桥接启动失败", { message: error.message });
  console.error(`本地分析服务启动失败：${error.message}`);
  process.exitCode = 1;
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

async function loadBridgeToken() {
  const configured = String(process.env.GMGN_BRIDGE_TOKEN || "").trim();
  if (configured.length >= 16) return configured;
  try {
    const stored = (await readFile(tokenPath, "utf8")).trim();
    if (stored.length >= 16) return stored;
  } catch (_) {
    // 首次启动时生成新的随机令牌。
  }
  const generated = randomBytes(24).toString("base64url");
  await writeFile(tokenPath, `${generated}\n`, { mode: 0o600 });
  return generated;
}

function isAuthorized(request) {
  const supplied = String(request.headers["x-gmgn-bridge-token"] || "");
  const expected = Buffer.from(bridgeToken);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return origin.startsWith("chrome-extension://") ||
    origin === "http://127.0.0.1:4173" ||
    origin === "http://localhost:4173";
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (isAllowedOrigin(origin) && origin) response.setHeader("Access-Control-Allow-Origin", origin);
  if (request.headers["access-control-request-private-network"] === "true") {
    response.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-GMGN-Bridge-Token");
  response.setHeader("Access-Control-Max-Age", "600");
}

function isDashboardOrigin(request) {
  const origin = request.headers.origin;
  return !origin || origin === `http://${host}:${port}` || origin === `http://localhost:${port}`;
}

async function serveStatic(response, filename, contentType) {
  try {
    const body = await readFile(resolve(bridgeDirectory, filename));
    response.statusCode = 200;
    response.setHeader("Content-Type", contentType);
    response.setHeader("Cache-Control", "no-store");
    response.end(body);
  } catch (_) {
    writeJson(response, 404, { error: "本地页面文件不存在" });
  }
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        rejectBody(new Error("桥接请求体超过 1MB 限制"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", rejectBody);
  });
}

function writeJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

async function log(level, message, fields = {}) {
  const record = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  await appendFile(logPath, `${record}\n`, "utf8").catch(() => undefined);
}

async function logUsage({ config, usage, success, errorType = "" }) {
  const record = {
    time: new Date().toISOString(),
    project: "gmgn2",
    script: "bridge/server.mjs",
    provider: config ? new URL(config.grokBaseUrl).origin : "unknown",
    model: config?.grokModel || "unknown",
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    success,
    errorType,
    usageStatus: usage ? "中转已返回 usage" : "中转未返回 usage，无法精确统计",
  };
  await appendFile(usageLogPath, `${JSON.stringify(record)}\n`, "utf8").catch(() => undefined);
}
