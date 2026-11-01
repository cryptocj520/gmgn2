import { LIMITS, STORAGE_KEYS } from "../shared/constants.js";

// 关注列表单独存放：不受提醒记录的过期清理和“清空记录”影响
export class FavoriteStore {
  constructor(storage) {
    this.storage = storage;
    this.writeQueue = Promise.resolve();
  }

  async list() {
    const stored = await this.storage.get(STORAGE_KEYS.FAVORITES);
    const favorites = stored[STORAGE_KEYS.FAVORITES];
    return Array.isArray(favorites) ? favorites : [];
  }

  // 写入串行执行，连续点击多个代币时不会互相覆盖
  toggle(token) {
    const run = this.writeQueue.then(async () => {
      if (!token?.id || !token?.address) throw new Error("缺少代币信息，无法关注");
      const favorites = await this.list();
      const favorited = !favorites.some((item) => item.id === token.id);
      if (favorited && favorites.length >= LIMITS.MAX_FAVORITES) {
        throw new Error(`关注最多 ${LIMITS.MAX_FAVORITES} 个，请先取消一些`);
      }
      const next = favorited
        ? [favoriteSnapshot(token), ...favorites]
        : favorites.filter((item) => item.id !== token.id);
      await this.storage.set({ [STORAGE_KEYS.FAVORITES]: next });
      return { favorites: next, favorited };
    });
    this.writeQueue = run.catch(() => undefined);
    return run;
  }
}

// 只保存识别和跳转需要的字段，行情和叙事仍以提醒记录为准
function favoriteSnapshot(token) {
  return {
    id: token.id,
    address: token.address,
    chain: token.chain,
    symbol: token.symbol || "",
    name: token.name || "",
    image: token.image || "",
    url: token.url || "",
    favoritedAt: Date.now(),
  };
}
