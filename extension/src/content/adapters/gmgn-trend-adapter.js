import { LIMITS, SCANNER } from "../../shared/constants.js";
import { buildMetrics, findMetric, normalizeText, parseTokenHref } from "../../shared/token.js";

export class GmgnTrendAdapter {
  constructor(documentRef = document, locationRef = location) {
    this.document = documentRef;
    this.location = locationRef;
  }

  async readTokens(options = {}) {
    const initialTable = this.findLeaderboard();
    if (!initialTable) return [];

    const headers = this.readHeaders(initialTable);
    const tokens = new Map();
    const scroller = this.findScrollContainer(initialTable);
    const shouldCrawl = options.deep &&
      scroller &&
      scroller.scrollHeight > scroller.clientHeight + SCANNER.MIN_SCROLL_DISTANCE;
    if (!shouldCrawl) {
      this.collectRenderedTokens(initialTable, headers, tokens);
      const visibleTokens = Array.from(tokens.values());
      return options.deep
        ? visibleTokens.map((token, index) => ({ ...token, rank: token.rank || index + 1 }))
        : visibleTokens;
    }

    await this.crawlVirtualList(scroller, headers, tokens);
    return Array.from(tokens.values(), (token, index) => ({ ...token, rank: token.rank || index + 1 }));
  }

  readHeaders(table) {
    const nodes = table.querySelectorAll("thead th").length
      ? table.querySelectorAll("thead th")
      : table.querySelectorAll("tr:first-child th");
    return Array.from(nodes, (node) => normalizeText(node.textContent));
  }

  collectRenderedTokens(table, headers, tokens) {
    const anchors = table.querySelectorAll('a[href*="/token/"]');
    Array.from(anchors).forEach((anchor) => {
      const parsed = parseTokenHref(anchor.getAttribute("href"), this.location.origin);
      if (!parsed || tokens.has(parsed.id)) return;
      const row = anchor.closest("tr");
      if (row) tokens.set(parsed.id, this.extractToken(anchor, row, headers, parsed));
    });
  }

  findScrollContainer(table) {
    const namedScroller = table.closest(".gmgn-table-scroller, .gmgn-virtuoso");
    if (namedScroller) return namedScroller;

    let candidate = table.parentElement;
    while (candidate && candidate !== this.document.body) {
      const style = getComputedStyle(candidate);
      const scrollable = /auto|scroll/.test(style.overflowY) &&
        candidate.scrollHeight > candidate.clientHeight + SCANNER.MIN_SCROLL_DISTANCE;
      if (scrollable) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }

  async crawlVirtualList(scroller, headers, tokens) {
    const originalTop = scroller.scrollTop;
    const cover = this.createVisualCover(scroller);
    const previousVisibility = scroller.style.visibility;
    if (cover) scroller.style.visibility = "hidden";

    try {
      const step = Math.max(scroller.clientHeight * SCANNER.STEP_RATIO, 240);
      let position = 0;
      let steps = 0;
      while (steps < SCANNER.MAX_SCROLL_STEPS) {
        const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const target = Math.min(position, maxTop);
        scroller.scrollTop = target;
        await this.waitForVirtualRender();
        const table = this.findLeaderboard();
        if (table) this.collectRenderedTokens(table, headers, tokens);
        if (target >= maxTop) break;
        position = target + step;
        steps += 1;
      }
    } finally {
      scroller.scrollTop = originalTop;
      await this.waitForVirtualRender();
      scroller.style.visibility = previousVisibility;
      cover?.remove();
    }
  }

  createVisualCover(scroller) {
    if (this.document.visibilityState !== "visible") return null;
    const rect = scroller.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;

    const cover = scroller.cloneNode(true);
    cover.setAttribute("aria-hidden", "true");
    cover.setAttribute("data-gmgn-monitor-scan-cover", "");
    Object.assign(cover.style, {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      pointerEvents: "none",
      overflow: "hidden",
      zIndex: "2147483000",
    });
    this.document.body.appendChild(cover);
    cover.scrollTop = scroller.scrollTop;
    return cover;
  }

  waitForVirtualRender() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setTimeout(resolve, SCANNER.RENDER_WAIT_MS);
      }));
    });
  }

  extractToken(anchor, row, headers, parsed) {
    const cells = Array.from(
      row.querySelectorAll(":scope > td"),
      (cell) => normalizeText(cell.textContent),
    );
    const metrics = buildMetrics(headers, cells);
    const symbolNode = anchor.querySelector("[title]");
    const symbol = normalizeText(symbolNode?.getAttribute("title")) || parsed.address.slice(0, 10);
    const name = normalizeText(symbolNode?.nextElementSibling?.textContent) || symbol;
    const imageNode = anchor.querySelector('img[alt="logo"], img');
    const itemIndex = Number.parseInt(row.getAttribute("data-item-index") || row.getAttribute("data-index"), 10);
    const volumeHeader = Object.keys(metrics).find((key) =>
      key.replace(/\s+/g, "").includes("成交额")
    ) || "";

    return {
      ...parsed,
      ...(Number.isInteger(itemIndex) ? { rank: itemIndex + 1 } : {}),
      symbol,
      name,
      age: normalizeText(anchor.textContent).match(/\b\d+(?:s|m|h|d|mo|y)\b/i)?.[0] || "",
      image: imageNode?.currentSrc || imageNode?.src || "",
      marketCap: findMetric(metrics, ["市值"], ["历史最高"]),
      athMarketCap: findMetric(metrics, ["历史最高", "市值"]),
      liquidity: findMetric(metrics, ["池子"]),
      volume: findMetric(metrics, ["成交额"]),
      volumePeriod: volumeHeader.match(/(?:^|\s)(1m|5m|1h|6h|24h)/i)?.[1] || "",
      transactions: findMetric(metrics, ["交易数"]),
      holders: findMetric(metrics, ["持有者"]),
      fees: findMetric(metrics, ["手续费"]),
      metrics,
      snapshot: normalizeText(row.textContent).slice(0, LIMITS.SNAPSHOT_LENGTH),
      capturedAt: Date.now(),
    };
  }

  findLeaderboard() {
    return Array.from(this.document.querySelectorAll("table"))
      .map((table) => ({
        table,
        tokenCount: table.querySelectorAll('a[href*="/token/"]').length,
      }))
      .sort((left, right) => right.tokenCount - left.tokenCount)[0]?.table || null;
  }

  readConnectionHealth() {
    const statusRoots = Array.from(this.document.querySelectorAll("footer, [role='contentinfo']"));
    const spans = statusRoots.flatMap((root) => Array.from(root.querySelectorAll("span")));
    const latencyNode = spans.find((node) => /^\d+(?:\.\d+)?\s*MS$/i.test(normalizeText(node.textContent)));
    const container = latencyNode?.parentElement;
    const fpsNode = container && Array.from(container.querySelectorAll(":scope > span"))
      .find((node) => /^\d+(?:\.\d+)?\s*FPS$/i.test(normalizeText(node.textContent)));
    if (!container || !fpsNode) {
      return { available: false, healthy: false, status: "Missing", latencyMs: null, fps: null };
    }

    const directText = Array.from(container.children)
      .map((node) => normalizeText(node.textContent))
      .filter(Boolean);
    const status = directText.find((text) =>
      !/^\d+(?:\.\d+)?\s*(?:MS|FPS)$/i.test(text)
    ) || "Unknown";

    return {
      available: true,
      healthy: status.toLowerCase() === "stable",
      status,
      latencyMs: Number.parseFloat(normalizeText(latencyNode.textContent)),
      fps: Number.parseFloat(normalizeText(fpsNode.textContent)),
    };
  }

  observeChanges(listener) {
    let observedTarget = null;
    const observer = new MutationObserver((records) => {
      const onlyInternalCoverChanges = records.every((record) => {
        const changedNodes = [...record.addedNodes, ...record.removedNodes];
        return changedNodes.length > 0 && changedNodes.every((node) =>
          node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("data-gmgn-monitor-scan-cover")
        );
      });
      if (!onlyInternalCoverChanges) listener();
    });

    const attach = () => {
      const table = this.findLeaderboard();
      const target = table ? this.findScrollContainer(table) || table : null;
      if (!target || target === observedTarget) return;
      observer.disconnect();
      observedTarget = target;
      observer.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    };
    attach();
    const attachTimer = setInterval(attach, SCANNER.OBSERVER_REATTACH_SECONDS * 1000);
    return () => {
      clearInterval(attachTimer);
      observer.disconnect();
    };
  }

  canRunBackgroundFullScan() {
    return this.document.visibilityState === "hidden" || !this.document.hasFocus();
  }

  observeVisibility(listener) {
    const handler = () => listener(this.document.visibilityState);
    const view = this.document.defaultView;
    this.document.addEventListener("visibilitychange", handler);
    view?.addEventListener("blur", handler);
    return () => {
      this.document.removeEventListener("visibilitychange", handler);
      view?.removeEventListener("blur", handler);
    };
  }

}
