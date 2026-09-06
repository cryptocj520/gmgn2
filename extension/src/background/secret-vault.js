const DATABASE_NAME = "gmgn-monitor-secrets";
const STORE_NAME = "secrets";
const GROK_KEY_ID = "grokApiKey";

export class SecretVault {
  constructor(indexedDb = indexedDB) {
    this.indexedDb = indexedDb;
    this.database = null;
  }

  async open() {
    if (this.database) return this.database;
    this.database = await new Promise((resolve, reject) => {
      const request = this.indexedDb.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.database;
  }

  async saveGrokApiKey(apiKey) {
    await this.put(GROK_KEY_ID, String(apiKey || "").trim());
  }

  getGrokApiKey() {
    return this.get(GROK_KEY_ID);
  }

  clearGrokApiKey() {
    return this.remove(GROK_KEY_ID);
  }

  async isGrokConfigured() {
    return Boolean(await this.getGrokApiKey());
  }

  async get(key) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || "");
      request.onerror = () => reject(request.error);
    });
  }

  async put(key, value) {
    const database = await this.open();
    return this.transaction(database, "readwrite", (store) => store.put(value, key));
  }

  async remove(key) {
    const database = await this.open();
    return this.transaction(database, "readwrite", (store) => store.delete(key));
  }

  transaction(database, mode, action) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      action(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("密钥存储事务已取消"));
    });
  }
}
