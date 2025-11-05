import { APP_CONFIG } from "../../config.js";
import { isDefined, isNullish } from "../../utils/NumberUtils.js";

export class AliasStore {
  constructor(storageKey = APP_CONFIG.STORAGE_KEYS.OAPP_ALIASES) {
    this.map = new Map();
    this.buttonMap = new Map();
    this.storageKey = storageKey;
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    this.map.clear();
    this.buttonMap.clear();

    try {
      const response = await fetch(APP_CONFIG.DATA_SOURCES.OAPP_ALIASES, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        if (data && typeof data === "object") {
          this.applyAliasEntries(Object.entries(data));
        }
      }
    } catch (error) {
      console.warn("[AliasStore] Failed to load from file", error);
    }

    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === "object") {
          this.applyAliasEntries(Object.entries(parsed));
        }
      }
    } catch (error) {
      console.warn("[AliasStore] Failed to load from storage", error);
    }

    this.loaded = true;
    console.log(
      `[AliasStore] Loaded ${this.map.size} aliases, ${this.buttonMap.size} quick-crawl buttons`,
    );
  }

  buildSnapshot() {
    const snapshot = {};
    this.map.forEach((name, oappId) => {
      snapshot[oappId] = { name, addButton: this.buttonMap.has(oappId) };
    });
    return snapshot;
  }

  applyAliasEntries(entries) {
    if (!Array.isArray(entries)) return;

    entries.forEach(([rawKey, rawValue]) => {
      if (isNullish(rawKey)) return;

      const key = String(rawKey);
      if (!key) return;

      if (!rawValue) {
        this.map.delete(key);
        this.buttonMap.delete(key);
        return;
      }

      let aliasName = null;
      let addButton = false;

      if (typeof rawValue === "string") {
        aliasName = rawValue;
      } else if (typeof rawValue === "object") {
        aliasName = isDefined(rawValue.name) ? rawValue.name : (rawValue.alias ?? null);
        addButton = rawValue.addButton === true;
      } else {
        return;
      }

      const normalized = isNullish(aliasName) ? "" : String(aliasName).trim();
      if (!normalized) {
        this.map.delete(key);
        this.buttonMap.delete(key);
        return;
      }

      this.map.set(key, normalized);
      if (addButton) {
        this.buttonMap.set(key, normalized);
      } else {
        this.buttonMap.delete(key);
      }
    });
  }

  get(oappId) {
    if (!oappId) return null;
    return this.map.get(String(oappId)) || null;
  }

  getQuickCrawlButtons() {
    return Array.from(this.buttonMap.entries()).map(([oappId, name]) => ({
      oappId,
      name,
    }));
  }

  set(oappId, alias, options = {}) {
    if (!oappId) return false;
    const id = String(oappId);
    const trimmed = isNullish(alias) ? "" : String(alias).trim();

    const hadAlias = this.map.has(id);
    const previousAlias = hadAlias ? this.map.get(id) : null;
    const hadButton = this.buttonMap.has(id);
    const previousButtonLabel = hadButton ? this.buttonMap.get(id) : null;

    let changed = false;

    if (trimmed) {
      if (!hadAlias || previousAlias !== trimmed) {
        this.map.set(id, trimmed);
        changed = true;
      }

      if (hadButton && previousButtonLabel !== trimmed) {
        this.buttonMap.set(id, trimmed);
        changed = true;
      }
    } else {
      if (hadAlias) {
        this.map.delete(id);
        changed = true;
      }

      if (hadButton) {
        this.buttonMap.delete(id);
        changed = true;
      }
    }

    if (changed && options.persist !== false) {
      this.persist();
    }

    return changed;
  }

  setMany(entries) {
    if (!Array.isArray(entries) || !entries.length) return false;

    let changed = false;
    for (const entry of entries) {
      if (!entry || isNullish(entry.oappId)) continue;
      const didChange = this.set(entry.oappId, entry.alias, { persist: false });
      if (didChange) changed = true;
    }

    if (changed) this.persist();

    return changed;
  }

  persist() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.buildSnapshot()));
    } catch (error) {
      console.warn("[AliasStore] Failed to persist", error);
    }
  }

  export() {
    const content = JSON.stringify(this.buildSnapshot(), null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "oapp-aliases.json";
    a.click();
    URL.revokeObjectURL(url);
  }
}
