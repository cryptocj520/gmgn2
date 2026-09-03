(async () => {
  try {
    await import(chrome.runtime.getURL("src/content/main.js"));
  } catch (error) {
    console.error("[页面入口] 扩展加载失败", error);
  }
})();
