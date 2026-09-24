import { MESSAGE, MESSAGE_TARGET } from "../shared/constants.js";
import { ensureOffscreenDocument } from "./offscreen-manager.js";

export class OffscreenAiClient {
  async request(url, options, timeoutMs) {
    await ensureOffscreenDocument();
    const result = await chrome.runtime.sendMessage({
      target: MESSAGE_TARGET.OFFSCREEN,
      type: MESSAGE.AI_FETCH,
      url,
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body || "",
      timeoutMs,
    });
    if (!result?.ok) throw new Error(result?.error || "扩展隐藏文档未响应");
    return new Response(result.body || "", {
      status: result.status,
      statusText: result.statusText,
      headers: {
        "content-type": result.headers?.["content-type"] || "application/json",
      },
    });
  }
}
