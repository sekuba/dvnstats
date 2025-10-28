import { APP_CONFIG } from "./config.js";

const HEX_PREFIX = "0x";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BYTES32_HEX_LENGTH = 64;
const EVM_ADDRESS_HEX_LENGTH = 40;
const HEX_BODY_REGEX = /^[0-9a-f]+$/i;
const HASH_PATTERN = /^0x[a-f0-9]{16,}$/i;

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

  getChainLabel(localEid) {
    return localEid !== undefined && localEid !== null
      ? this.localEidLabels.get(String(localEid)) || null
      : null;
  }

  getChainInfo(localEid) {
    const info = this.localEidDetails.get(String(localEid));
    return info
      ? {
          primary: info.label,
          secondary: `eid ${localEid}`,
          copyValue: String(localEid),
        }
      : null;
  }

  listLocalEndpoints() {
    return Array.from(this.localEidLabels.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  resolveDvnName(address, { localEid } = {}) {
    if (!address) return address;

    const normalized = String(address).toLowerCase();
    if (localEid !== undefined && localEid !== null) {
      const scoped = this.dvnDirectory.get(`local:${localEid}:${normalized}`);
      if (scoped) return scoped;
    }
    return this.dvnDirectory.get(`fallback:${normalized}`) || address;
  }

  resolveDvnNames(addresses, context = {}) {
    return Array.isArray(addresses)
      ? addresses.map((addr) => this.resolveDvnName(addr, context))
      : [];
  }
}

export function normalizeAddress(address) {
  if (address === undefined || address === null) {
    throw new Error("Address required");
  }

  const raw = String(address).trim();
  if (!raw) {
    throw new Error("Address cannot be empty");
  }

  const hasHexPrefix = raw.slice(0, HEX_PREFIX.length).toLowerCase() === HEX_PREFIX;
  if (!hasHexPrefix) {
    return raw;
  }

  const lower = `${HEX_PREFIX}${raw.slice(HEX_PREFIX.length).toLowerCase()}`;
  const hexBody = lower.slice(HEX_PREFIX.length);
  if (!HEX_BODY_REGEX.test(hexBody)) {
    throw new Error(`Invalid hex address: ${address}`);
  }

  if (hexBody.length === BYTES32_HEX_LENGTH) {
    const trimmedHex = hexBody.replace(/^0+/, "");
    if (trimmedHex.length === 0) {
      return ZERO_ADDRESS;
    }
    if (trimmedHex.length <= EVM_ADDRESS_HEX_LENGTH) {
      return `${HEX_PREFIX}${trimmedHex.padStart(EVM_ADDRESS_HEX_LENGTH, "0")}`;
    }
    return lower;
  }

  if (hexBody.length <= EVM_ADDRESS_HEX_LENGTH) {
    return `${HEX_PREFIX}${hexBody.padStart(EVM_ADDRESS_HEX_LENGTH, "0")}`;
  }

  return lower;
}

export function makeOAppId(localEid, address) {
  if (localEid === undefined || localEid === null) throw new Error("localEid required");
  return `${localEid}_${normalizeAddress(address)}`;
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

export function stringifyScalar(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return value ?? "";
}

export function formatTimestampValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  const millis = numeric < 1e12 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;

  return {
    primary: date.toISOString().replace("T", " ").replace("Z", " UTC"),
    secondary: `unix ${value}`,
    copyValue: String(value),
  };
}

export function looksLikeHash(column, value) {
  const lower = column.toLowerCase();
  return (
    lower.includes("hash") ||
    lower.includes("tx") ||
    (typeof value === "string" && HASH_PATTERN.test(value))
  );
}

export function looksLikeTimestampColumn(column) {
  const lower = column.toLowerCase();
  return lower.includes("timestamp") || lower.endsWith("time");
}

export function looksLikeEidColumn(column) {
  const lower = column.toLowerCase();
  if (lower === "eid") {
    return true;
  }
  return lower.endsWith("_eid") || lower.includes("eid_");
}
