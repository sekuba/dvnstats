import { APP_CONFIG } from "./config.js";
import { AddressUtils } from "./utils/AddressUtils.js";
import { resolveChainDisplayLabel as _resolveChainDisplayLabel } from "./utils/ChainUtils.js";

export class HasuraClient {
  constructor(endpoint = APP_CONFIG.GRAPHQL_ENDPOINT) {
    this.endpoint = endpoint;
    this.headers = {
      "Content-Type": "application/json",
    };
  }

  async query(query, variables = {}) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const message = payload.errors.map((error) => error.message || "Unknown error").join("; ");
      throw new Error(message);
    }

    return payload.data;
  }
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch (error) {
    console.warn(`[ChainDirectory] Failed to load ${url}`, error);
    return null;
  }
}

export class ChainDirectory {
  constructor() {
    this.localEidLabels = new Map();
    this.localEidDetails = new Map();
    this.dvnDirectory = new Map();
    this.chainLabelCache = new Map();
    this.dvnNameCache = new Map();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;

    for (const source of APP_CONFIG.DATA_SOURCES.CHAIN_METADATA) {
      const data = await fetchJson(source);
      if (data) {
        this.hydrate(data);
        console.info(`[ChainDirectory] Loaded from ${source}`);
        this.loaded = true;
        return;
      }
    }

    console.warn("[ChainDirectory] No metadata source available");
    this.loaded = true;
  }

  hydrate(data) {
    if (!data || typeof data !== "object") return;

    let count = 0;

    this.chainLabelCache.clear();
    this.dvnNameCache.clear();

    Object.entries(data).forEach(([key, chain]) => {
      if (!chain || typeof chain !== "object") return;

      const baseLabel =
        chain?.chainDetails?.shortName || chain?.chainDetails?.name || chain.chainKey || key;
      const deployments = Array.isArray(chain.deployments) ? chain.deployments : [];

      deployments.forEach((dep) => {
        if (dep?.eid === undefined || dep.eid === null) return;

        const eid = String(dep.eid);
        const stage = dep.stage && dep.stage !== "mainnet" ? ` (${dep.stage})` : "";
        const label = `${baseLabel}${stage}`;

        this.localEidLabels.set(eid, label);
        this.localEidDetails.set(eid, {
          label,
          stage: dep.stage || "mainnet",
          chainKey: chain.chainKey || null,
        });

        if (chain.dvns && typeof chain.dvns === "object") {
          Object.entries(chain.dvns).forEach(([addr, info]) => {
            if (!addr) return;
            const normalized = String(addr).toLowerCase();
            const dvnLabel = info?.canonicalName || info?.name || info?.id || addr;
            this.dvnDirectory.set(`local:${eid}:${normalized}`, dvnLabel);
            if (!this.dvnDirectory.has(`fallback:${normalized}`)) {
              this.dvnDirectory.set(`fallback:${normalized}`, dvnLabel);
            }
          });
        }

        count += 1;
      });
    });

    console.log(`[ChainDirectory] Registered ${count} deployments`);
  }

  getChainInfo(localEid) {
    const key = String(localEid);
    if (this.chainLabelCache.has(key)) {
      return this.chainLabelCache.get(key);
    }

    const info = this.localEidDetails.get(key);
    const result = info
      ? {
          primary: info.label,
          secondary: `eid ${localEid}`,
          copyValue: key,
        }
      : null;

    this.chainLabelCache.set(key, result);
    return result;
  }

  getChainDisplayLabel(localEid) {
    if (localEid === undefined || localEid === null || localEid === "") {
      return "";
    }

    const key = String(localEid);
    const info = this.getChainInfo(key);
    if (!info) {
      return key;
    }
    return `${info.primary} (${key})`;
  }

  listLocalEndpoints() {
    return Array.from(this.localEidLabels.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  resolveDvnName(address, { localEid } = {}) {
    if (!address) return address;

    const normalized = String(address).toLowerCase();
    const cacheKey =
      localEid !== undefined && localEid !== null
        ? `${localEid}:${normalized}`
        : `fallback:${normalized}`;
    if (this.dvnNameCache.has(cacheKey)) {
      return this.dvnNameCache.get(cacheKey);
    }

    let resolved = undefined;
    if (localEid !== undefined && localEid !== null) {
      resolved = this.dvnDirectory.get(`local:${localEid}:${normalized}`);
    }
    if (!resolved) {
      resolved = this.dvnDirectory.get(`fallback:${normalized}`) || address;
    }

    this.dvnNameCache.set(cacheKey, resolved);
    return resolved;
  }

  resolveDvnNames(addresses, context = {}) {
    return Array.isArray(addresses)
      ? addresses.map((addr) => this.resolveDvnName(addr, context))
      : [];
  }
}

// Re-exported from ChainUtils for backward compatibility
export function resolveChainDisplayLabel(chainMetadata, chainId) {
  return _resolveChainDisplayLabel(chainMetadata, chainId);
}

// Re-exported from AddressUtils for backward compatibility
export function normalizeAddress(address) {
  return AddressUtils.normalize(address);
}

export function normalizeOAppId(value) {
  if (!value) throw new Error("OApp ID required");

  const trimmed = String(value).trim();
  const separatorIndex = trimmed.indexOf("_");
  if (separatorIndex === -1) throw new Error("OApp ID must be 'localEid_address'");

  const localEid = trimmed.slice(0, separatorIndex);
  if (!localEid) throw new Error("OApp ID must include localEid");

  const address = trimmed.slice(separatorIndex + 1);
  return `${localEid}_${normalizeAddress(address)}`;
}

export function splitOAppId(oappId) {
  if (!oappId) {
    return { localEid: null, address: null };
  }
  const raw = String(oappId);
  const separatorIndex = raw.indexOf("_");
  if (separatorIndex === -1) {
    return { localEid: null, address: raw || null };
  }
  const localEid = raw.slice(0, separatorIndex) || null;
  const address = raw.slice(separatorIndex + 1) || null;
  return { localEid, address };
}

export function normalizeKey(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

export function clampInteger(rawValue, min, max, fallback) {
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isFinite(parsed)) {
    const upper = Number.isFinite(max) ? max : Number.POSITIVE_INFINITY;
    return Math.min(Math.max(parsed, min), upper);
  }
  return fallback;
}

export function parseOptionalPositiveInt(rawValue) {
  if (!rawValue && rawValue !== 0) {
    return Number.NaN;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return Number.NaN;
}

// Re-export formatting functions from centralized formatters
export {
  stringifyScalar,
  formatTimestampValue,
  looksLikeHash,
  looksLikeTimestampColumn,
  looksLikeEidColumn,
  formatInteger,
  formatPercent,
} from "./formatters/valueFormatters.js";

// Re-exported from AddressUtils for backward compatibility
export function isZeroAddress(address) {
  return AddressUtils.isZero(address);
}
