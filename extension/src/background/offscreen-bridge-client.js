import { MESSAGE, MESSAGE_TARGET } from "../shared/constants.js";
import { ensureOffscreenDocument } from "./offscreen-manager.js";

export class OffscreenBridgeClient {
  async request(url, options, timeoutMs) {
    await ensureOffscreenDocument();
    const result = await chrome.runtime.sendMessage({
      target: MESSAGE_TARGET.OFFSCREEN,
      type: MESSAGE.BRIDGE_FETCH,
      url,
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body || "",
      timeoutMs,
    });
    if (!result?.ok) throw new Error(result?.error || "本地桥接文档未响应");
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  }
}
