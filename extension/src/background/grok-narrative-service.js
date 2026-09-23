import {
  AnalysisError,
  analyzeToken,
  httpErrorMessage,
  normalizeUsage,
  sanitizeErrorMessage,
  testAiConnection,
} from "./grok-analyzer.js";

export class GrokNarrativeService {
  constructor(transport, usageStore) {
    this.transport = transport;
    this.usageStore = usageStore;
  }

  async validateApiKey(config) {
    try {
      const result = await testAiConnection(config, (url, options, timeoutMs) => this.request(url, options, timeoutMs));
      await this.recordUsage(config, result.usage, true);
      return result;
    } catch (error) {
      await this.recordUsage(config, error.usage, false, this.errorType(error));
      throw this.toUserError(error, config.apiKey);
    }
  }

  async analyze(token, config) {
    try {
      const result = await this.runAnalysis(token, config);
      await this.recordUsage(config, result.usage, true);
      return result.analysis;
    } catch (error) {
      await this.recordUsage(config, error.usage, false, this.errorType(error));
      throw this.toUserError(error, config.apiKey);
    }
  }

  runAnalysis(token, config) {
    return analyzeToken(token, config, (url, options, timeoutMs) => this.request(url, options, timeoutMs));
  }

  async request(url, options, timeoutMs) {
    try {
      const response = await this.transport.request(url, options, timeoutMs);
      if (response.ok) return response;
      const body = await response.json().catch(() => ({}));
      throw new AnalysisError(
        httpErrorMessage(body, response.status, apiKeyFromHeaders(options.headers)),
        response.status,
        normalizeUsage(body?.usage),
        response.status === 429 || response.status >= 500,
      );
    } catch (error) {
      if (error instanceof AnalysisError) throw error;
      const message = error?.message || "";
      if (error?.name === "AbortError" || /超时/.test(message)) {
        throw new AnalysisError("分析请求超时", 504, null, false);
      }
      if (/failed to fetch|fetch failed|networkerror/i.test(message)) {
        throw new AnalysisError("无法连接 AI 接口，请检查地址和权限", 502, null, false);
      }
      throw new AnalysisError(message || "无法连接 AI 接口，请检查地址和权限", 502, null, false);
    }
  }

  async recordUsage(config, usage, success, errorType = "") {
    if (!this.usageStore) return;
    await this.usageStore.record({
      config,
      usage: normalizeRecordUsage(usage),
      success,
      errorType,
    }).catch(() => undefined);
  }

  errorType(error) {
    const status = Number(error?.status) || 0;
    if (error?.name === "AbortError" || status === 504 || /超时/.test(error?.message || "")) return "timeout";
    if (/格式|JSON|不完整/.test(error?.message || "")) return "format";
    if (status === 401 || status === 403 || status === 429) return String(status);
    if (status >= 500) return "5xx";
    if (status) return String(status);
    return "network";
  }

  toUserError(error, apiKey = "") {
    const status = Number(error?.status) || 0;
    const retryable = status === 429 || (status >= 500 && status !== 504);
    const mapped = new AnalysisError(
      sanitizeErrorMessage(error?.message || httpErrorMessage({}, status, apiKey), apiKey) || "分析失败",
      status,
      error?.usage,
      retryable,
    );
    return mapped;
  }
}

function apiKeyFromHeaders(headers = {}) {
  const auth = String(headers.authorization || headers.Authorization || "");
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  if (bearer) return bearer;
  return String(headers["x-api-key"] || headers["X-Api-Key"] || "").trim();
}

function normalizeRecordUsage(value) {
  return normalizeUsage(value || {});
}
