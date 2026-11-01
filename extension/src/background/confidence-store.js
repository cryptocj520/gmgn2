import { CONFIDENCE_GROUP_LEVELS, LIMITS, STORAGE_KEYS } from "../shared/constants.js";

export class ConfidenceStore {
  constructor(storage) {
    this.storage = storage;
    this.writeQueue = Promise.resolve();
  }

  async list() {
    const stored = await this.storage.get([STORAGE_KEYS.CONFIDENCE_GROUP]);
    return Array.isArray(stored[STORAGE_KEYS.CONFIDENCE_GROUP]) ? stored[STORAGE_KEYS.CONFIDENCE_GROUP] : [];
  }

  // 首次初始化只迁移一次，先选每个代币最近的分析，再判断是否达到门槛。
  initialize(events) {
    return this.enqueue(async () => {
      const stored = await this.storage.get([STORAGE_KEYS.CONFIDENCE_GROUP]);
      if (stored[STORAGE_KEYS.CONFIDENCE_GROUP] !== undefined) return;
      const latest = new Map();
      for (const event of events) {
        if (!event.id || event.narrative?.status !== "ready" || !event.narrative.analysis) continue;
        const previous = latest.get(event.id);
        if (!previous || analyzedTime(event) > analyzedTime(previous)) latest.set(event.id, event);
      }
      const items = [...latest.values()].filter(qualifies).map(snapshot);
      await this.storage.set({ [STORAGE_KEYS.CONFIDENCE_GROUP]: sortAndLimit(items) });
    });
  }

  update(token) {
    return this.enqueue(async () => {
      if (!token?.id || !token.address || token.narrative?.status !== "ready") return;
      const items = await this.list();
      const previous = items.find((item) => item.id === token.id);
      if (previous && analyzedTime(previous) > analyzedTime(token)) return;
      const next = items.filter((item) => item.id !== token.id);
      if (qualifies(token)) next.push(snapshot(token));
      await this.storage.set({ [STORAGE_KEYS.CONFIDENCE_GROUP]: sortAndLimit(next) });
    });
  }

  enqueue(operation) {
    const run = this.writeQueue.then(operation, operation);
    this.writeQueue = run.catch(() => undefined);
    return run;
  }
}

function analyzedTime(token) {
  const value = token.analyzedAt ?? token.narrative?.analysis?.analyzedAt ?? token.narrative?.updatedAt ?? 0;
  return Number(value) || Date.parse(value) || 0;
}

function qualifies(token) {
  return Boolean(token.address) && CONFIDENCE_GROUP_LEVELS.includes(token.narrative?.analysis?.confidence);
}

function snapshot(token) {
  return {
    id: token.id, address: token.address, chain: token.chain || "", symbol: token.symbol || "",
    name: token.name || "", image: token.image || "", url: token.url || "", marketCap: token.marketCap, fees: token.fees,
    narrative: token.narrative, analyzedAt: analyzedTime(token),
  };
}

function sortAndLimit(items) {
  return items.sort((a, b) => analyzedTime(b) - analyzedTime(a)).slice(0, LIMITS.MAX_CONFIDENCE_GROUP);
}
