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
    const liveDue = [];
    const stuckDue = [];
    const seen = new Set();
    for (const event of events) {
      if (!isRobinhoodToken(event) || event.manual || !event.address) continue;
      const key = `${event.id}:${event.detectedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const status = event.fomo?.status;
      const updatedAt = Number(event.fomo?.updatedAt) || 0;
      if (event.fomo?.live && status !== FOMO_STATUS.RUNNING && now - updatedAt >= FOMO.LIVE_REFRESH_MS) liveDue.push(event);
      else if (event.fomo?.live && status === FOMO_STATUS.RUNNING && now - updatedAt > 45_000) stuckDue.push(event);
      else if (!event.fomo?.live && status === FOMO_STATUS.RUNNING && now - updatedAt > 45_000) stuckDue.push({ ...event, _orphan: true });
      if (liveDue.length + stuckDue.length >= 8) break;
    }
    const orphans = stuckDue.filter((event) => event._orphan);
    const due = [...liveDue, ...stuckDue.filter((event) => !event._orphan)].slice(0, 5);
    if (orphans.length) {
      await this.write(orphans, {
        status: FOMO_STATUS.UNAVAILABLE,
        label: "FOMO 检测中断",
        detail: "未跟随的批量检测已停止，需要时请点刷新。",
      });
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
    const live = pending.filter((event) => event.fomo?.live);
    const rest = pending.filter((event) => !event.fomo?.live);
    if (rest.length) {
      await this.write(rest, {
        status: FOMO_STATUS.UNAVAILABLE,
        label: "FOMO 检测中断",
        detail: "未跟随的批量检测已停止，需要时请点刷新。",
      });
    }
    if (live.length) this.enqueue(live, generation);
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

  async refreshOnce(tokenId, detectedAt) {
    await this.repository.initialize();
    if (!this.repository.settings.fomoEnabled) throw new Error("请先打开 FOMO 占比开关");
    const event = (await this.repository.listEvents())
      .find((item) => item.id === tokenId && item.detectedAt === detectedAt);
    if (!event || !isRobinhoodToken(event)) throw new Error("找不到这条 Robinhood 提醒");
    await this.write([event], {
      ...(event.fomo || {}),
      status: FOMO_STATUS.RUNNING,
      label: "FOMO 占比检测中…",
    });
    this.enqueue([event], this.generation);
    return { status: FOMO_STATUS.RUNNING, label: "FOMO 占比检测中…" };
  }

  async toggleLive(tokenId, detectedAt, live) {
    await this.repository.initialize();
    if (!this.repository.settings.fomoEnabled) throw new Error("请先打开 FOMO 占比开关");
    const event = (await this.repository.listEvents())
      .find((item) => item.id === tokenId && item.detectedAt === detectedAt);
    if (!event || !isRobinhoodToken(event)) throw new Error("找不到这条 Robinhood 提醒");
    const enabled = Boolean(live);
    if (enabled) {
      await this.write([event], {
        ...(event.fomo || {}),
        live: true,
        status: FOMO_STATUS.RUNNING,
        label: "FOMO 占比检测中…",
      });
      this.enqueue([event], this.generation);
    } else {
      await this.write([event], { ...(event.fomo || {}), live: false });
    }
    const latest = (await this.repository.listEvents())
      .find((item) => item.id === tokenId && item.detectedAt === detectedAt);
    return latest?.fomo || null;
  }

  async write(tokens, fomo) {
    const events = await this.repository.listEvents();
    const byKey = new Map(events.map((event) => [`${event.id}:${event.detectedAt}`, event]));
    for (const token of tokens) {
      const previous = byKey.get(`${token.id}:${token.detectedAt}`)?.fomo || {};
      const live = typeof fomo.live === "boolean" ? fomo.live : Boolean(previous.live);
      let label = fomo.label || previous.label || "";
      if (live && (fomo.status || previous.status) === FOMO_STATUS.READY) {
        label = `${String(label).replace(/ · 跟着刷$/, "")} · 跟着刷`;
      }
      if (!live) label = String(label).replace(/ · 跟着刷$/, "");
      await this.repository.patchEvents([token], {
        fomo: {
          ...previous,
          ...fomo,
          live,
          label,
          updatedAt: Date.now(),
        },
      });
    }
  }
}
