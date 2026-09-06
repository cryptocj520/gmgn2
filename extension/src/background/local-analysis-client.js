export class LocalAnalysisClient {
  constructor(transport) {
    this.transport = transport;
  }

  async analyze(token, config) {
    const response = await this.request(`${config.bridgeBaseUrl}/analyze`, {
      method: "POST",
      headers: this.headers(config.bridgeToken),
      body: JSON.stringify({ token }),
    }, 185000);
    const payload = await response.json();
    if (!payload.analysis) throw new Error("本地分析服务未返回分析结果");
    return payload.analysis;
  }

  async status(config) {
    const response = await this.request(`${config.bridgeBaseUrl}/analysis-status`, {
      method: "GET",
      headers: this.headers(config.bridgeToken),
    }, 10000);
    return response.json();
  }

  async migrate(config, legacy) {
    const response = await this.request(`${config.bridgeBaseUrl}/config`, {
      method: "POST",
      headers: this.headers(config.bridgeToken),
      body: JSON.stringify(legacy),
    }, 10000);
    return response.json();
  }

  headers(token) {
    return {
      "Content-Type": "application/json",
      "X-GMGN-Bridge-Token": token,
    };
  }

  async request(url, options, timeoutMs) {
    const response = await this.transport.request(url, options, timeoutMs);
    if (response.ok) return response;
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `本地分析服务请求失败（HTTP ${response.status}）`);
  }
}
