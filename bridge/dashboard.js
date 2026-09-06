const elements = Object.fromEntries([
  "configForm", "status", "grokBaseUrl", "grokModel", "apiMode", "searchMode",
  "timeoutSeconds", "enableXSearch", "apiKey", "message", "pairingToken", "copyToken",
].map((id) => [id, document.getElementById(id)]));

function showMessage(message, error = false) {
  elements.message.textContent = message;
  elements.message.classList.toggle("error", error);
}

function render(config) {
  elements.grokBaseUrl.value = config.grokBaseUrl;
  elements.grokModel.value = config.grokModel;
  elements.apiMode.value = config.apiMode;
  elements.searchMode.value = config.searchMode;
  elements.timeoutSeconds.value = String(config.timeoutSeconds);
  elements.enableXSearch.checked = config.enableXSearch;
  elements.status.textContent = config.configured ? "已配置" : "未配置";
  elements.status.classList.toggle("ready", config.configured);
  elements.apiKey.placeholder = config.configured ? "已保存（不会回显）" : "请输入 API Key";
}

async function requestConfig(options) {
  const response = await fetch("/config", options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `请求失败（HTTP ${response.status}）`);
  return body;
}

elements.configForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("正在保存…");
  try {
    const config = await requestConfig({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grokBaseUrl: elements.grokBaseUrl.value,
        grokModel: elements.grokModel.value,
        apiMode: elements.apiMode.value,
        searchMode: elements.searchMode.value,
        timeoutSeconds: Number(elements.timeoutSeconds.value),
        enableXSearch: elements.enableXSearch.checked,
        apiKey: elements.apiKey.value,
      }),
    });
    elements.apiKey.value = "";
    render(config);
    showMessage("本地分析配置已保存");
  } catch (error) {
    showMessage(error.message || "保存失败", true);
  }
});

elements.copyToken.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.pairingToken.value);
  showMessage("配对令牌已复制");
});

Promise.all([
  requestConfig(),
  fetch("/pairing-token").then((response) => response.json()),
]).then(([config, pairing]) => {
  render(config);
  elements.pairingToken.value = pairing.token || "";
}).catch((error) => showMessage(error.message, true));
