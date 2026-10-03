import { FOMO, FOMO_STATUS } from "./constants.js";
import { isRobinhoodToken, measureFomoShare } from "./share.js";

export class FomoCoordinator {
  constructor(repository, { measure = measureFomoShare } = {}) {
    this.repository = repository;
    this.measure = measure;
    this.queue = Promise.resolve();
    this.generation = 0;
  }

  async ensurePermission({ openSettings = false } = {}) {
    if (!chrome?.permissions?.contains) return { granted: false };
    const granted = await chrome.permissions.contains({ origins: [FOMO.RPC_PERMISSION] });
    if (!granted && openSettings && chrome.runtime?.openOptionsPage) {
      await chrome.runtime.openOptionsPage();
    }
    return { granted };
  }

  async queueAlerts(tokens, settings) {
    if (!settings?.fomoEnabled || !tokens?.length) return;
    const targets = tokens.filter(isRobinhoodToken);
    if (!targets.length) return;
    const generation = this.generation;
    await this.write(targets, { status: FOMO_STATUS.RUNNING, label: "FOMO 占比检测中…" });
    if (!this.isCurrent(generation)) {
      await this.write(targets, {
        status: FOMO_STATUS.UNAVAILABLE,
        label: "FOMO 已取消",
        detail: "已关闭 FOMO 占比。",
      });
      return;
    }
    this.enqueue(targets, generation);
  }

  async catchUp(settings) {
    if (!settings?.fomoEnabled) return;
    const generation = this.generation;
    const events = await this.repository.listEvents();
    if (generation !== this.generation) return;
    const now = Date.now();
    const due = [];
    const seen = new Set();
    for (const event of events) {
      if (!isRobinhoodToken(event) || event.manual || !event.address) continue;
      const key = `${event.id}:${event.detectedAt}`;
      if (seen.has(key)) continue;
      const status = event.fomo?.status;
      const updatedAt = Number(event.fomo?.updatedAt) || 0;
      const missing = !event.fomo;
      const stuck = status === FOMO_STATUS.RUNNING && now - updatedAt > 45_000;
      if (!missing && !stuck) continue;
      seen.add(key);
      due.push(event);
      if (due.length >= 5) break;
    }
    if (!due.length) return;
    await this.write(due, { status: FOMO_STATUS.RUNNING, label: "FOMO 占比检测中…" });
    if (!this.isCurrent(generation)) {
      await this.write(due, {
        status: FOMO_STATUS.UNAVAILABLE,
        label: "FOMO 已取消",
        detail: "已关闭 FOMO 占比。",
      });
      return;
    }
    this.enqueue(due, generation);
  }

  async resume() {
    const generation = this.generation;
    await this.repository.initialize();
    if (generation !== this.generation) return;
    const pending = await this.pending();
    if (generation !== this.generation) return;
    if (!pending.length) return;
    if (!this.repository.settings.fomoEnabled) {
      await this.write(pending, {
        status: FOMO_STATUS.UNAVAILABLE,
        label: "FOMO 检测中断",
        detail: "后台重启时开关已关闭，或上次检测未写完。",
      });
      return;
    }
    if (!this.isCurrent(generation)) return;
    this.enqueue(pending, generation);
  }

  async cancelPending() {
    this.generation += 1;
    const pending = await this.pending();
    if (!pending.length) return;
    await this.write(pending, {
      status: FOMO_STATUS.UNAVAILABLE,
      label: "FOMO 已取消",
      detail: "已关闭 FOMO 占比。",
    });
  }

  isCurrent(generation) {
    return generation === this.generation && this.repository.settings.fomoEnabled;
  }

  async pending() {
    const events = await this.repository.listEvents();
    return events.filter((event) => event.fomo?.status === FOMO_STATUS.RUNNING);
  }

  enqueue(tokens, generation = this.generation) {
    tokens.forEach((token) => {
      this.queue = this.queue.then(
        () => this.detect(token, generation),
        () => this.detect(token, generation),
      );
    });
  }

  async detect(token, generation = this.generation) {
    if (!this.isCurrent(generation)) return;
    try {
      const share = await this.measure(token.address);
      if (!this.isCurrent(generation)) return;
      await this.write([token], share);
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      await this.write([token], {
        status: FOMO_STATUS.UNAVAILABLE,
        label: "FOMO 未检测",
        detail: error.message || "Robinhood 节点查询失败",
      });
    }
  }

  write(tokens, fomo) {
    return this.repository.patchEvents(tokens, { fomo: { ...fomo, updatedAt: Date.now() } });
  }
}
