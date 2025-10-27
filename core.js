import { APP_CONFIG } from "./config.js";

const EVM_ADDRESS_REGEX = /^0x[0-9a-f]{40}$/;
const BYTES32_REGEX = /^0x[0-9a-f]{64}$/;
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
  if (!address && address !== 0) throw new Error("Address required");

  const raw = String(address).trim().toLowerCase();
  if (!raw) throw new Error("Address cannot be empty");

  const prefixed = raw.startsWith("0x") ? raw : `0x${raw}`;
  const trimmed = prefixed.replace(/^0x0+/, "0x");
  if (trimmed === "0x") return null;

  const body = trimmed.slice(2);
  const normalized =
    body.length < 40
      ? `0x${body.padStart(40, "0")}`
      : body.length > 40
        ? `0x${body.slice(-40)}`
        : trimmed;

  if (!EVM_ADDRESS_REGEX.test(normalized)) {
    throw new Error(`Invalid address: ${address}`);
  }

  return normalized;
}

export function bytes32ToAddress(value) {
  if (!value) return null;

  const hex = String(value).trim().toLowerCase();
  if (!BYTES32_REGEX.test(hex)) return null;

  const tail = hex.slice(-40);
  return /^0+$/.test(tail) ? null : `0x${tail}`;
}

export function makeOAppId(localEid, address) {
  if (localEid === undefined || localEid === null) throw new Error("localEid required");
  return `${localEid}_${normalizeAddress(address)}`;
}

export function normalizeOAppId(value) {
  if (!value) throw new Error("OApp ID required");

  const parts = String(value).trim().split("_");
  if (parts.length !== 2) throw new Error("OApp ID must be 'localEid_address'");
  if (!parts[0]) throw new Error("OApp ID must include localEid");

  return `${parts[0]}_${normalizeAddress(parts[1])}`;
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
