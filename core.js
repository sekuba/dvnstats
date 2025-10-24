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
 * Creates a normalized OApp ID from chain ID and address
 */
export function makeOAppId(chainId, address) {
  if (!chainId) {
    throw new Error("Chain ID is required.");
  }

  const normalized = normalizeAddress(address);
  return `${chainId}_${normalized}`;
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
    throw new Error("OApp ID must follow 'chainId_address' format.");
  }

  const chainId = parts[0]?.trim();
  const address = normalizeAddress(parts[1]);

  if (!chainId) {
    throw new Error("OApp ID must include a chainId.");
  }

  return `${chainId}_${address}`;
}

/**
 * Manages LayerZero chain metadata, EID mappings, and DVN information
 */
export class ChainMetadata {
  constructor() {
    this.eidToChainId = new Map();
    this.chainIdToEid = new Map();
    this.nativeChainLabels = new Map();
    this.eidLabels = new Map();
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
      "[ChainMetadata] No metadata found; chain names will not be resolved",
    );
    this.loaded = true;
  }

  hydrate(data) {
    if (!data || typeof data !== "object") {
      console.warn("[ChainMetadata] Invalid data format");
      return;
    }

    // Check for simplified format {native: {...}, eid: {...}}
    const nativeTable = data.native;
    const eidTable = data.eid;

    if (nativeTable || eidTable) {
      if (nativeTable && typeof nativeTable === "object") {
        Object.entries(nativeTable).forEach(([id, label]) => {
          if (label) {
            this.nativeChainLabels.set(String(id), String(label));
          }
        });
      }
      if (eidTable && typeof eidTable === "object") {
        Object.entries(eidTable).forEach(([id, label]) => {
          if (label) {
            this.eidLabels.set(String(id), String(label));
          }
        });
      }
      console.log("[ChainMetadata] Loaded simplified format (labels only, no EID-to-chainId mappings)");
      return;
    }

    // Full LayerZero format
    let processedChains = 0;
    let processedDeployments = 0;

    Object.entries(data).forEach(([key, entry]) => {
      if (!entry || typeof entry !== "object") {
        return;
      }

      const baseLabel = this.deriveChainLabel(entry, key);
      const chainDetails = entry.chainDetails || {};
      const nativeId = chainDetails.nativeChainId;

      if (nativeId !== undefined && nativeId !== null) {
        const nativeIdStr = String(nativeId);
        this.nativeChainLabels.set(nativeIdStr, baseLabel);
        processedChains++;

        // Store DVN metadata for this chain
        if (entry.dvns && typeof entry.dvns === "object") {
          Object.entries(entry.dvns).forEach(([address, info]) => {
            if (!address) return;

            const lowerAddress = String(address).toLowerCase();
            const name =
              info?.canonicalName || info?.name || info?.id || address;
            this.dvnLookup.set(`${nativeIdStr}:${lowerAddress}`, name);
          });
        }
      }

      // Store EID mappings
      if (Array.isArray(entry.deployments)) {
        entry.deployments.forEach((deployment) => {
          if (!deployment || !deployment.eid) {
            return;
          }

          const eid = String(deployment.eid);
          const chainId = String(nativeId);

          this.eidToChainId.set(eid, chainId);
          this.chainIdToEid.set(chainId, eid);
          processedDeployments++;

          const stage =
            deployment.stage && deployment.stage !== "mainnet"
              ? ` (${deployment.stage})`
              : "";
          this.eidLabels.set(eid, `${baseLabel}${stage}`);
        });
      }
    });

    console.log(
      `[ChainMetadata] Processed ${processedChains} chains, ${processedDeployments} deployments, ${this.eidToChainId.size} EID mappings`,
    );
  }

  deriveChainLabel(entry, fallbackKey) {
    const details = entry.chainDetails || {};
    return (
      details.shortName || details.name || entry.chainKey || fallbackKey
    );
  }

  resolveChainId(eid) {
    const result = this.eidToChainId.get(String(eid)) || null;
    if (!result && eid) {
      console.debug(`[ChainMetadata] No chainId for EID ${eid} (map size: ${this.eidToChainId.size})`);
    }
    return result;
  }

  resolveEid(chainId) {
    return this.chainIdToEid.get(String(chainId)) || null;
  }

  getChainLabel(chainId, preference = "native") {
    const key = String(chainId);

    if (preference === "native") {
      return this.nativeChainLabels.get(key) || this.eidLabels.get(key) || null;
    }

    if (preference === "eid") {
      return this.eidLabels.get(key) || this.nativeChainLabels.get(key) || null;
    }

    return this.nativeChainLabels.get(key) || this.eidLabels.get(key) || null;
  }

  getChainInfo(value, preference = "auto") {
    const key = String(value);

    const getNativeEntry = () => {
      const label = this.nativeChainLabels.get(key);
      return label
        ? {
            primary: label,
            secondary: `chainId ${key}`,
            copyValue: key,
          }
        : null;
    };

    const getEidEntry = () => {
      const label = this.eidLabels.get(key);
      return label
        ? {
            primary: label,
            secondary: `eid ${key}`,
            copyValue: key,
          }
        : null;
    };

    if (preference === "native") {
      return getNativeEntry() || getEidEntry();
    }
    if (preference === "eid") {
      return getEidEntry() || getNativeEntry();
    }
    return getNativeEntry() || getEidEntry();
  }

  resolveDvnName(address, chainId) {
    if (!address || !chainId) return address;

    const lowerAddress = String(address).toLowerCase();
    const key = `${chainId}:${lowerAddress}`;

    return this.dvnLookup.get(key) || address;
  }
}

/**
 * Manages DVN (Decentralized Verifier Network) metadata
 */
export class DvnRegistry {
  constructor(client) {
    this.client = client;
    this.lookup = new Map();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) {
      return;
    }

    try {
      const query = `
        query GetDvnMetadata {
          DvnMetadata {
            id
            chainId
            address
            name
          }
        }
      `;

      const data = await this.client.query(query, {});
      const dvnMetadata = data.DvnMetadata || [];

      this.hydrate(dvnMetadata);
      console.log(`[DvnRegistry] Loaded ${dvnMetadata.length} DVN entries`);
      this.loaded = true;
    } catch (error) {
      console.warn("[DvnRegistry] Failed to load DVN metadata", error);
      this.loaded = true;
    }
  }

  hydrate(entries) {
    if (!Array.isArray(entries)) {
      return;
    }

    for (const entry of entries) {
      if (!entry || !entry.address) {
        continue;
      }

      const addressKey = String(entry.address).toLowerCase();
      const chainKey =
        entry.chainId !== undefined && entry.chainId !== null
          ? String(entry.chainId)
          : null;
      const label = entry.name || entry.address;

      if (!addressKey) {
        continue;
      }

      // Store with chain-specific key
      if (chainKey) {
        this.lookup.set(`${chainKey}_${addressKey}`, label);
      }

      // Store with address-only key as fallback
      if (!this.lookup.has(addressKey)) {
        this.lookup.set(addressKey, label);
      }
    }
  }

  resolve(address, chainId = null) {
    if (!address) {
      return address;
    }

    const key = String(address).toLowerCase();

    if (chainId) {
      const chainKey = `${chainId}_${key}`;
      if (this.lookup.has(chainKey)) {
        return this.lookup.get(chainKey);
      }
    }

    return this.lookup.get(key) || address;
  }

  resolveMany(addresses, chainId = null) {
    if (!Array.isArray(addresses)) {
      return [];
    }

    return addresses.map((addr) => this.resolve(addr, chainId));
  }
}

/**
 * Manages OApp chain options (available chains for OApp queries)
 */
export class OAppChainOptions {
  constructor() {
    this.list = [];
    this.map = new Map();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) {
      return;
    }

    try {
      const response = await fetch(CONFIG.DATA_SOURCES.OAPP_CHAINS, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (Array.isArray(data)) {
        this.list = data.map((item) => ({
          id: String(item.id ?? item.chainId ?? ""),
          label: String(item.label ?? item.name ?? item.id ?? ""),
        }));

        this.map = new Map(this.list.map((item) => [item.id, item.label]));
      }

      console.log(`[OAppChainOptions] Loaded ${this.list.length} chains`);
      this.loaded = true;
    } catch (error) {
      console.warn("[OAppChainOptions] Failed to load", error);
      this.loaded = true;
    }
  }

  getLabel(chainId) {
    return this.map.get(String(chainId)) || null;
  }

  getOptions() {
    return this.list;
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

export function looksLikeChainColumn(column) {
  const lower = column.toLowerCase();
  if (lower === "chainid") {
    return true;
  }
  return (
    lower.includes("chainid") ||
    lower.endsWith("_chain_id") ||
    lower.endsWith("_chainid")
  );
}

export function looksLikeEidColumn(column) {
  const lower = column.toLowerCase();
  if (lower === "eid") {
    return true;
  }
  return lower.endsWith("eid") || lower.endsWith("_eid") || lower.includes("eid_");
}

export function chainPreferenceFromColumn(column) {
  if (looksLikeChainColumn(column)) {
    return "native";
  }
  if (looksLikeEidColumn(column)) {
    return "eid";
  }
  return null;
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
