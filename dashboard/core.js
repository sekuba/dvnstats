/**
 * Core utilities and data management for the LayerZero Security Config Explorer
 */

import { CONFIG } from "./config.js";

/**
 * GraphQL client for Hasura endpoint
 */
export class GraphQLClient {
  constructor(endpoint = CONFIG.GRAPHQL_ENDPOINT) {
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
      throw new Error(
        `GraphQL request failed: ${response.status} ${response.statusText}`,
      );
    }

    const result = await response.json();

    if (result.errors && result.errors.length > 0) {
      const message = result.errors
        .map((error) => error.message || "Unknown error")
        .join("; ");
      throw new Error(message);
    }

    return result.data;
  }
}

/**
 * Normalizes an Ethereum address to standard format
 * Handles various input formats and ensures consistent output
 */
export function normalizeAddress(address) {
  if (!address) {
    throw new Error("Address is required.");
  }

  let cleaned = String(address).toLowerCase().trim();

  // Add 0x prefix if missing
  if (!cleaned.startsWith("0x")) {
    cleaned = "0x" + cleaned;
  }

  // Remove leading zeros after 0x
  cleaned = cleaned.replace(/^0x0+/, "0x");

  // Handle completely zero address
  if (cleaned === "0x") {
    return null;
  }

  // Pad to 40 characters if shorter
  if (cleaned.length < 42) {
    cleaned = "0x" + cleaned.slice(2).padStart(40, "0");
  }

  // Truncate if longer (handles 32-byte addresses)
  if (cleaned.length > 42) {
    cleaned = "0x" + cleaned.slice(-40);
  }

  // Validate format
  if (!/^0x[0-9a-f]{40}$/.test(cleaned)) {
    throw new Error(`Invalid address format: ${address}`);
  }

  return cleaned;
}

/**
 * Decodes a bytes32 value into a 20-byte address if possible.
 * Returns null when the value cannot be interpreted as an EVM address.
 */
export function bytes32ToAddress(value) {
  if (!value) {
    return null;
  }

  const hex = String(value).toLowerCase().trim();
  if (!hex.startsWith("0x") || hex.length !== 66) {
    return null;
  }

  const body = hex.slice(2);
  if (!/^[0-9a-f]{64}$/.test(body)) {
    return null;
  }

  const addressPart = body.slice(-40);
  if (/^0+$/.test(addressPart)) {
    return null;
  }

  return `0x${addressPart}`;
}

/**
 * Creates a normalized OApp ID from chain ID and address
 */
export function makeOAppId(localEid, address) {
  if (!localEid && localEid !== 0) {
    throw new Error("localEid is required.");
  }

  const normalized = normalizeAddress(address);
  return `${localEid}_${normalized}`;
}

/**
 * Parses and normalizes an OApp ID string
 */
export function normalizeOAppId(value) {
  if (!value) {
    throw new Error("OApp ID is required.");
  }

  const trimmed = String(value).trim();
  const parts = trimmed.split("_");

  if (parts.length !== 2) {
    throw new Error("OApp ID must follow 'localEid_address' format.");
  }

  const localEid = parts[0]?.trim();
  const address = normalizeAddress(parts[1]);

  if (!localEid) {
    throw new Error("OApp ID must include a localEid.");
  }

  return `${localEid}_${address}`;
}

/**
 * Manages LayerZero chain metadata, EID mappings, and DVN information
 */
export class ChainMetadata {
  constructor() {
    this.localEidLabels = new Map();
    this.localEidInfo = new Map();
    this.dvnLookup = new Map();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) {
      return;
    }

    for (const candidate of CONFIG.DATA_SOURCES.CHAIN_METADATA) {
      try {
        const response = await fetch(candidate, { cache: "no-store" });
        if (!response.ok) {
          continue;
        }

        const data = await response.json();
        this.hydrate(data);
        console.info(`[ChainMetadata] Loaded from ${candidate}`);
        this.loaded = true;
        return;
      } catch (error) {
        console.warn(`[ChainMetadata] Failed to load ${candidate}`, error);
      }
    }

    console.warn(
      "[ChainMetadata] No metadata found; endpoint names will not be resolved",
    );
    this.loaded = true;
  }

  hydrate(data) {
    if (!data || typeof data !== "object") {
      console.warn("[ChainMetadata] Invalid data format");
      return;
    }

    let processedDeployments = 0;

    const storeDvn = (localEid, dvns) => {
      if (!localEid || !dvns || typeof dvns !== "object") return;
      Object.entries(dvns).forEach(([address, info]) => {
        if (!address) return;
        const normalized = String(address).toLowerCase();
        const label =
          info?.canonicalName || info?.name || info?.id || address;
        if (!normalized) return;

        this.dvnLookup.set(`local:${localEid}:${normalized}`, label);
        const fallbackKey = `fallback:${normalized}`;
        if (!this.dvnLookup.has(fallbackKey)) {
          this.dvnLookup.set(fallbackKey, label);
        }
      });
    };

    Object.entries(data).forEach(([key, entry]) => {
      if (!entry || typeof entry !== "object") {
        return;
      }

      const baseLabel = this.deriveChainLabel(entry, key);

      if (Array.isArray(entry.deployments)) {
        entry.deployments.forEach((deployment) => {
          if (!deployment || !deployment.eid) {
            return;
          }

          const localEid = String(deployment.eid);
          const stage =
            deployment.stage && deployment.stage !== "mainnet"
              ? ` (${deployment.stage})`
              : "";
          const label = `${baseLabel}${stage}`;

          this.localEidLabels.set(localEid, label);
          this.localEidInfo.set(localEid, {
            label,
            stage: deployment.stage || "mainnet",
            chainKey: entry.chainKey || null,
          });

          storeDvn(localEid, entry.dvns);
          processedDeployments++;
        });
      }
    });

    console.log(
      `[ChainMetadata] Processed ${processedDeployments} deployments, ${this.localEidLabels.size} local EIDs`,
    );
  }

  deriveChainLabel(entry, fallbackKey) {
    const details = entry.chainDetails || {};
    return (
      details.shortName || details.name || entry.chainKey || fallbackKey
    );
  }

  getChainLabel(localEid) {
    if (localEid === undefined || localEid === null) return null;
    return this.localEidLabels.get(String(localEid)) || null;
  }

  getChainInfo(value) {
    const key = String(value);
    const info = this.localEidInfo.get(key);
    return info
      ? {
          primary: info.label,
          secondary: `eid ${key}`,
          copyValue: key,
        }
      : null;
  }

  resolveLocalEidInfo(localEid) {
    return this.localEidInfo.get(String(localEid)) || null;
  }

  listLocalEndpoints() {
    const entries = Array.from(this.localEidLabels.entries()).map(
      ([id, label]) => ({ id, label }),
    );
    return entries.sort((a, b) => a.label.localeCompare(b.label));
  }

  resolveDvnName(address, { localEid } = {}) {
    if (!address) return address;

    const normalized = String(address).toLowerCase();
    if (localEid !== undefined && localEid !== null) {
      const key = `local:${localEid}:${normalized}`;
      const match = this.dvnLookup.get(key);
      if (match) return match;
    }

    return this.dvnLookup.get(`fallback:${normalized}`) || address;
  }

  resolveDvnNames(addresses, context = {}) {
    if (!Array.isArray(addresses)) {
      return [];
    }
    return addresses.map((address) =>
      this.resolveDvnName(address, context),
    );
  }
}

/**
 * Utility functions
 */
export function clampInteger(rawValue, min, max, fallback) {
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isFinite(parsed)) {
    const upper = Number.isFinite(max) ? max : Number.POSITIVE_INFINITY;
    return Math.min(Math.max(parsed, min), upper);
  }
  return fallback;
}

export function parseOptionalPositiveInt(rawValue) {
  if (!rawValue) {
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
  const lower = column.toLowerCase();
  if (lower.includes("hash") || lower.includes("tx")) {
    return true;
  }
  return /^0x[a-fA-F0-9]{16,}$/.test(value);
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
  return lower.endsWith("eid") || lower.endsWith("_eid") || lower.includes("eid_");
}

/**
 * Error boundary wrapper for async operations
 */
export class ErrorBoundary {
  static async wrap(fn, fallback) {
    try {
      return await fn();
    } catch (error) {
      console.error("Error caught:", error);
      if (typeof fallback === "function") {
        return fallback(error);
      }
      return fallback;
    }
  }
}
