/**
 * Core services and helpers for the LayerZero Security Config Explorer dashboard.
 */

import { APP_CONFIG } from "./config.js";

const EVM_ADDRESS_REGEX = /^0x[0-9a-f]{40}$/;
const BYTES32_REGEX = /^0x[0-9a-f]{64}$/;

/**
 * Minimal GraphQL client targeting the Hasura endpoint that powers the dashboard.
 */
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

/**
 * Fetch JSON with minimal error handling. Returns null on failure.
 */
async function safeJsonFetch(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn(`[Core] Failed to load ${url}`, error);
    return null;
  }
}

/**
 * Stores LayerZero chain metadata, EID mappings, and DVN naming information.
 */
export class ChainDirectory {
  constructor() {
    this.localEidLabels = new Map();
    this.localEidDetails = new Map();
    this.dvnDirectory = new Map();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) {
      return;
    }

    for (const candidate of APP_CONFIG.DATA_SOURCES.CHAIN_METADATA) {
      const data = await safeJsonFetch(candidate);
      if (!data) {
        continue;
      }

      this.hydrate(data);
      console.info(`[ChainDirectory] Loaded chain metadata from ${candidate}`);
      this.loaded = true;
      return;
    }

    console.warn("[ChainDirectory] No metadata source responded; endpoint names unavailable.");
    this.loaded = true;
  }

  hydrate(data) {
    if (!data || typeof data !== "object") {
      console.warn("[ChainDirectory] Invalid metadata payload");
      return;
    }

    let processedDeployments = 0;

    const registerDvns = (localEid, dvns) => {
      if (!localEid || !dvns || typeof dvns !== "object") {
        return;
      }

      Object.entries(dvns).forEach(([address, info]) => {
        if (!address) {
          return;
        }
        const normalized = String(address).toLowerCase();
        const label = info?.canonicalName || info?.name || info?.id || address;

        this.dvnDirectory.set(`local:${localEid}:${normalized}`, label);
        if (!this.dvnDirectory.has(`fallback:${normalized}`)) {
          this.dvnDirectory.set(`fallback:${normalized}`, label);
        }
      });
    };

    Object.entries(data).forEach(([key, chainEntry]) => {
      if (!chainEntry || typeof chainEntry !== "object") {
        return;
      }

      const baseLabel = this.deriveChainLabel(chainEntry, key);
      const deployments = Array.isArray(chainEntry.deployments) ? chainEntry.deployments : [];

      deployments.forEach((deployment) => {
        if (!deployment || deployment.eid === undefined || deployment.eid === null) {
          return;
        }

        const localEid = String(deployment.eid);
        const stageSuffix =
          deployment.stage && deployment.stage !== "mainnet" ? ` (${deployment.stage})` : "";
        const label = `${baseLabel}${stageSuffix}`;

        this.localEidLabels.set(localEid, label);
        this.localEidDetails.set(localEid, {
          label,
          stage: deployment.stage || "mainnet",
          chainKey: chainEntry.chainKey || null,
        });

        registerDvns(localEid, chainEntry.dvns);
        processedDeployments += 1;
      });
    });

    console.log(
      `[ChainDirectory] Registered ${processedDeployments} deployments across ${this.localEidLabels.size} local EIDs`,
    );
  }

  deriveChainLabel(entry, fallbackKey) {
    const details = entry?.chainDetails || {};
    return details.shortName || details.name || entry.chainKey || fallbackKey;
  }

  getChainLabel(localEid) {
    if (localEid === undefined || localEid === null) {
      return null;
    }
    return this.localEidLabels.get(String(localEid)) || null;
  }

  getChainInfo(localEid) {
    const key = String(localEid);
    const info = this.localEidDetails.get(key);

    if (!info) {
      return null;
    }

    return {
      primary: info.label,
      secondary: `eid ${key}`,
      copyValue: key,
    };
  }

  resolveLocalEidInfo(localEid) {
    return this.localEidDetails.get(String(localEid)) || null;
  }

  listLocalEndpoints() {
    return Array.from(this.localEidLabels.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  resolveDvnName(address, { localEid } = {}) {
    if (!address) {
      return address;
    }

    const normalized = String(address).toLowerCase();
    if (localEid !== undefined && localEid !== null) {
      const scopedKey = `local:${localEid}:${normalized}`;
      const scopedMatch = this.dvnDirectory.get(scopedKey);
      if (scopedMatch) {
        return scopedMatch;
      }
    }

    return this.dvnDirectory.get(`fallback:${normalized}`) || address;
  }

  resolveDvnNames(addresses, context = {}) {
    if (!Array.isArray(addresses)) {
      return [];
    }
    return addresses.map((address) => this.resolveDvnName(address, context));
  }
}

export function normalizeAddress(address) {
  if (!address && address !== 0) {
    throw new Error("Address is required.");
  }

  const raw = String(address).trim().toLowerCase();
  if (!raw) {
    throw new Error("Address cannot be empty.");
  }

  const prefixed = raw.startsWith("0x") ? raw : `0x${raw}`;
  const trimmed = prefixed.replace(/^0x0+/, "0x");
  if (trimmed === "0x") {
    return null;
  }

  const body = trimmed.slice(2);
  let normalized;
  if (body.length < 40) {
    normalized = `0x${body.padStart(40, "0")}`;
  } else if (body.length > 40) {
    normalized = `0x${body.slice(-40)}`;
  } else {
    normalized = trimmed;
  }

  if (!EVM_ADDRESS_REGEX.test(normalized)) {
    throw new Error(`Invalid address format: ${address}`);
  }

  return normalized;
}

export function bytes32ToAddress(value) {
  if (!value) {
    return null;
  }

  const hex = String(value).trim().toLowerCase();
  if (!BYTES32_REGEX.test(hex)) {
    return null;
  }

  const tail = hex.slice(-40);
  if (/^0+$/.test(tail)) {
    return null;
  }

  return `0x${tail}`;
}

export function makeOAppId(localEid, address) {
  if (localEid === undefined || localEid === null) {
    throw new Error("localEid is required.");
  }
  const normalizedAddress = normalizeAddress(address);
  return `${localEid}_${normalizedAddress}`;
}

export function normalizeOAppId(value) {
  if (!value) {
    throw new Error("OApp ID is required.");
  }

  const trimmed = String(value).trim();
  const parts = trimmed.split("_");

  if (parts.length !== 2) {
    throw new Error("OApp ID must follow 'localEid_address' format.");
  }

  const [localEidPart, address] = parts;
  if (!localEidPart) {
    throw new Error("OApp ID must include a localEid segment.");
  }

  const normalizedAddress = normalizeAddress(address);
  return `${localEidPart}_${normalizedAddress}`;
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
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const millis = numeric < 1e12 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const iso = date.toISOString().replace("T", " ").replace("Z", " UTC");
  return {
    primary: iso,
    secondary: `unix ${value}`,
    copyValue: String(value),
  };
}

export function looksLikeHash(column, value) {
  const lowerColumn = column.toLowerCase();
  if (lowerColumn.includes("hash") || lowerColumn.includes("tx")) {
    return true;
  }
  return typeof value === "string" && /^0x[a-f0-9]{16,}$/i.test(value);
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
