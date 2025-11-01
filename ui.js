/**
 * UI Components for LayerZero Security Config Explorer
 * Handles queries, results rendering, tables, aliases, and user interactions
 */

import { APP_CONFIG } from "./config.js";
import {
  clampInteger,
  formatTimestampValue,
  looksLikeEidColumn,
  looksLikeHash,
  looksLikeTimestampColumn,
  normalizeAddress,
  normalizeOAppId,
  splitOAppId,
  parseOptionalPositiveInt,
  stringifyScalar,
  isZeroAddress,
} from "./core.js";

/**
 * Manages OApp aliases (friendly names for OApp IDs)
 */
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
          Object.entries(data).forEach(([k, v]) => {
            if (v && typeof v === "object" && v.name) {
              this.map.set(String(k), String(v.name));
              if (v.addButton === true) {
                this.buttonMap.set(String(k), String(v.name));
              }
            }
          });
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
          Object.entries(parsed).forEach(([k, v]) => {
            if (!v) {
              this.map.delete(String(k));
            } else if (typeof v === "object" && v.name) {
              this.map.set(String(k), String(v.name));
            }
          });
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

  set(oappId, alias) {
    if (!oappId) return;
    const id = String(oappId);
    const trimmed = alias?.trim();
    trimmed ? this.map.set(id, trimmed) : this.map.delete(id);
    this.persist();
  }

  persist() {
    try {
      const obj = {};
      this.map.forEach((name, oappId) => {
        obj[oappId] = { name, addButton: false };
      });
      localStorage.setItem(this.storageKey, JSON.stringify(obj));
    } catch (error) {
      console.warn("[AliasStore] Failed to persist", error);
    }
  }

  export() {
    const obj = {};
    this.map.forEach((name, oappId) => {
      obj[oappId] = { name, addButton: false };
    });
    const content = JSON.stringify(obj, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "oapp-aliases.json";
    a.click();
    URL.revokeObjectURL(url);
  }
}

/**
 * Manages queries and their execution
 */
export class QueryCoordinator {
  constructor(client, metadata, aliasStore, onResultsUpdate) {
    this.client = client;
    this.chainMetadata = metadata.chain;
    this.aliasStore = aliasStore;
    this.onResultsUpdate = onResultsUpdate;
    this.requestSeq = 0;
    this.latestRequest = 0;
    this.lastPayload = null;
    this.lastQueryKey = null;
    this.lastMetaBase = null;
    this.lastVariables = null;
    this.registry = null;
    this.chainLabelCache = new Map();
    this.dvnLabelCache = new Map();
  }

  getChainDisplayLabel(chainId) {
    if (!chainId && chainId !== 0) {
      return "";
    }

    const key = String(chainId);
    if (this.chainLabelCache.has(key)) {
      return this.chainLabelCache.get(key);
    }

    const chainInfo = this.chainMetadata.getChainInfo(key);
    const display = chainInfo ? `${chainInfo.primary} (${key})` : key;
    this.chainLabelCache.set(key, display);
    return display;
  }

  formatOAppIdCell(oappId) {
    if (!oappId) {
      return this.createFormattedCell(["—"], "");
    }
    const alias = this.aliasStore.get(oappId);
    const lines = alias ? [alias, `ID ${oappId}`] : [oappId];
    return this.createFormattedCell(lines, oappId, { oappId });
  }

  createFormattedCell(lines, copyValue, meta = {}) {
    const normalizedLines = Array.isArray(lines) ? lines : [lines];
    return {
      __formatted: true,
      lines: normalizedLines.map((line) =>
        line === null || line === undefined ? "" : String(line),
      ),
      copyValue,
      meta,
      highlight: meta.highlight || false,
    };
  }

  resolveDvnLabels(addresses, meta, localEidOverride) {
    if (!Array.isArray(addresses) || !addresses.length) {
      return [];
    }

    const candidateLocal =
      localEidOverride !== undefined && localEidOverride !== null
        ? localEidOverride
        : (meta?.localEid ?? meta?.eid ?? null);
    const normalizedAddresses = addresses.filter(Boolean);
    if (!normalizedAddresses.length) {
      return [];
    }

    const localKey =
      candidateLocal !== undefined && candidateLocal !== null && candidateLocal !== ""
        ? String(candidateLocal)
        : "";
    const cacheKey = `${localKey}|${normalizedAddresses.join(",").toLowerCase()}`;
    if (this.dvnLabelCache.has(cacheKey)) {
      return this.dvnLabelCache.get(cacheKey);
    }

    const context = localKey ? { localEid: localKey } : {};
    const labels = this.chainMetadata.resolveDvnNames(normalizedAddresses, context);
    this.dvnLabelCache.set(cacheKey, labels);
    return labels;
  }

  buildQueryRegistry() {
    if (this.registry) {
      return this.registry;
    }

    this.registry = {
      "top-oapps": {
        label: "Top OApps",
        description: "Ordered by total packets received",
        query: `
          query TopOApps($limit: Int, $minPackets: numeric!) {
            OAppStats(
              order_by: { totalPacketsReceived: desc }
              limit: $limit
              where: { totalPacketsReceived: { _gte: $minPackets } }
            ) {
              id
              localEid
              address
              totalPacketsReceived
              lastPacketBlock
              lastPacketTimestamp
            }
          }
        `,
        buildVariables: (card) => {
          const limitInput = card.querySelector('input[name="limit"]');
          const minPacketsInput = card.querySelector('input[name="minPackets"]');

          const rawLimit = limitInput?.value?.trim() ?? "";
          const parsedLimit = parseOptionalPositiveInt(rawLimit);
          const minPackets = clampInteger(minPacketsInput?.value, 0, Number.MAX_SAFE_INTEGER, 0);

          const variables = {
            minPackets: String(minPackets),
          };
          if (Number.isFinite(parsedLimit)) {
            variables.limit = parsedLimit;
          }

          return {
            variables,
            meta: {
              limitLabel: Number.isFinite(parsedLimit) ? `limit=${parsedLimit}` : "limit=∞",
            },
          };
        },
        extractRows: (data) =>
          (data?.OAppStats ?? []).map((row) => {
            const chainDisplay = this.getChainDisplayLabel(row.localEid) || row.localEid || "—";
            return {
              ...row,
              id: this.formatOAppIdCell(row.id),
              localEid: this.createFormattedCell([chainDisplay], row.localEid),
            };
          }),
      },

      "oapp-security-config": {
        label: "OApp Security Config",
        description: "Resolve the current security posture for a single OApp",
        query: `
          query CurrentSecurityConfig($oappId: String!) {
            OAppStats(where: { id: { _eq: $oappId } }) {
              id
              localEid
              address
              totalPacketsReceived
              lastPacketBlock
              lastPacketTimestamp
            }
            OAppPeer(where: { oappId: { _eq: $oappId } }) {
              id
              oappId
              eid
              peer
              peerOappId
              fromPacketDelivered
              lastUpdatedBlock
              lastUpdatedTimestamp
            }
            OAppRouteStats(where: { oappId: { _eq: $oappId } }, order_by: { packetCount: desc }) {
              id
              oappId
              srcEid
              packetCount
              lastPacketBlock
              lastPacketTimestamp
            }
            OAppRateLimiter(where: { oappId: { _eq: $oappId } }) {
              id
              rateLimiter
              lastUpdatedBlock
              lastUpdatedTimestamp
            }
            OAppRateLimit(where: { oappId: { _eq: $oappId } }) {
              id
              dstEid
              limit
              window
              lastUpdatedBlock
              lastUpdatedTimestamp
            }
            OAppSecurityConfig(
              where: { oappId: { _eq: $oappId } }
              order_by: { eid: asc }
            ) {
              id
              eid
              localEid
              oapp
              effectiveReceiveLibrary
              effectiveConfirmations
              effectiveRequiredDVNCount
              effectiveOptionalDVNCount
              effectiveOptionalDVNThreshold
              effectiveRequiredDVNs
              effectiveOptionalDVNs
              libraryStatus
              usesDefaultLibrary
              usesDefaultConfig
              usesRequiredDVNSentinel
              fallbackFields
              defaultLibraryVersionId
              defaultConfigVersionId
              libraryOverrideVersionId
              configOverrideVersionId
              lastComputedBlock
              lastComputedTimestamp
              lastComputedByEventId
              lastComputedTransactionHash
              peer
              peerOappId
              peerTransactionHash
              peerLastUpdatedBlock
              peerLastUpdatedTimestamp
              peerLastUpdatedEventId
            }
          }
        `,
        initialize: ({ card }) => {
          const endpointInput = card.querySelector("[data-chain-input]");
          const chainLabel = card.querySelector("[data-chain-label]");
          const datalist = card.querySelector("[data-chain-datalist]");

          if (datalist) {
            this.populateChainDatalist(datalist);
          }

          if (endpointInput && chainLabel) {
            const updateLabel = () => {
              const localEid = endpointInput.value.trim();
              const display = this.getChainDisplayLabel(localEid);
              chainLabel.textContent = display ? `Chain: ${display}` : "Chain not selected.";
            };
            endpointInput.addEventListener("input", updateLabel);
            updateLabel();
          }

          const idInput = card.querySelector('input[name="oappId"]');
          if (idInput) {
            idInput.addEventListener("blur", () => {
              if (!idInput.value) return;
              try {
                const normalized = normalizeOAppId(idInput.value);
                if (normalized !== idInput.value) {
                  idInput.value = normalized;
                }
              } catch (error) {
                // ignore invalid input on blur
              }
            });
          }
        },
        buildVariables: (card) => {
          const idInput = card.querySelector('input[name="oappId"]');
          const eidInput = card.querySelector('input[name="localEid"]');
          const addressInput = card.querySelector('input[name="oappAddress"]');

          const rawId = idInput?.value?.trim() ?? "";
          let oappId = "";
          let localEid = "";
          let address = "";

          if (rawId) {
            const normalizedId = normalizeOAppId(rawId);
            const parts = normalizedId.split("_");
            localEid = parts[0];
            address = parts[1];
            oappId = normalizedId;
            if (eidInput) {
              eidInput.value = localEid;
              eidInput.dispatchEvent(new Event("input"));
            }
            if (addressInput) {
              addressInput.value = address;
            }
            if (idInput) {
              idInput.value = oappId;
            }
          } else {
            localEid = eidInput?.value?.trim() ?? "";
            address = addressInput?.value?.trim() ?? "";
            if (!localEid || !address) {
              throw new Error("Provide an OApp ID or local EID plus address.");
            }
            address = normalizeAddress(address);
            oappId = `${localEid}_${address}`;
            if (idInput) {
              idInput.value = oappId;
            }
            if (addressInput) {
              addressInput.value = address;
            }
            if (eidInput) {
              eidInput.dispatchEvent(new Event("input"));
            }
          }

          const localLabel = this.getChainDisplayLabel(localEid) || `EID ${localEid}`;
          const summary = `${localLabel} • ${address}`;
          return {
            variables: { oappId },
            meta: {
              limitLabel: `oappId=${oappId}`,
              summary,
              localEid,
              chainLabel: localLabel,
              oappAddress: address,
              resultLabel: `OApp Security Config – ${localLabel}`,
            },
          };
        },
        processResponse: (payload, meta) => {
          const oapp = payload?.data?.OAppStats?.[0] ?? null;
          const configs = payload?.data?.OAppSecurityConfig ?? [];
          const peers = payload?.data?.OAppPeer ?? [];
          const routeStats = payload?.data?.OAppRouteStats ?? [];
          const rateLimiter = payload?.data?.OAppRateLimiter?.[0] ?? null;
          const rateLimits = payload?.data?.OAppRateLimit ?? [];
          const enrichedMeta = { ...meta };

          if (oapp) {
            const localEid = String(oapp.localEid ?? "");
            const chainDisplay =
              this.getChainDisplayLabel(localEid) || enrichedMeta.chainLabel || `EID ${localEid}`;
            enrichedMeta.oappInfo = oapp;
            enrichedMeta.chainLabel = chainDisplay;
            enrichedMeta.localEid = localEid;
            enrichedMeta.summary = enrichedMeta.summary || `${chainDisplay} • ${oapp.address}`;
            enrichedMeta.resultLabel = `OApp Security Config – ${chainDisplay}`;
          }

          // Create peer lookup map
          const peerMap = new Map();
          peers.forEach((peer) => {
            const key = String(peer.eid);
            peerMap.set(key, peer);
          });
          enrichedMeta.peerMap = peerMap;

          // Store route stats, rate limiting info
          enrichedMeta.routeStats = routeStats;
          enrichedMeta.rateLimiter = rateLimiter;
          enrichedMeta.rateLimits = rateLimits;

          const formattedRows = this.formatSecurityConfigRows(configs, enrichedMeta);

          return { rows: formattedRows, meta: enrichedMeta };
        },
      },

      "popular-oapps-window": {
        label: "Hot OApps",
        description: "Rank OApps by packets in a configurable time window",
        query: `
          query PopularOAppsWindow($fromTimestamp: numeric!, $fetchLimit: Int) {
            PacketDelivered(
              where: { blockTimestamp: { _gte: $fromTimestamp } }
              order_by: { blockTimestamp: desc }
              limit: $fetchLimit
            ) {
              id
              oappId
              localEid
              receiver
              blockTimestamp
              blockNumber
              srcEid
            }
          }
        `,
        initialize: ({ card }) => {
          const unitSelect = card.querySelector('select[name="windowUnit"]');
          if (unitSelect && !unitSelect.value) {
            unitSelect.value = "days";
          }
        },
        buildVariables: (card) => {
          const windowValueInput = card.querySelector('input[name="windowValue"]');
          const windowUnitSelect = card.querySelector('select[name="windowUnit"]');
          const resultLimitInput = card.querySelector('input[name="resultLimit"]');
          const fetchLimitInput = card.querySelector('input[name="fetchLimit"]');

          const rawWindowValue = clampInteger(windowValueInput?.value, 1, 365, 7);
          const windowUnit = windowUnitSelect?.value ?? "days";
          const unitSeconds = {
            minutes: 60,
            hours: 3600,
            days: 86400,
          };
          const secondsPerUnit = unitSeconds[windowUnit] ?? unitSeconds.days;
          const windowSeconds = rawWindowValue * secondsPerUnit;
          const nowSeconds = Math.floor(Date.now() / 1000);
          const fromTimestamp = Math.max(nowSeconds - windowSeconds, 0);

          const resultLimit = clampInteger(resultLimitInput?.value, 1, 200, 20);
          const fetchLimitRaw = fetchLimitInput?.value?.trim();
          const fetchLimitParsed = parseOptionalPositiveInt(fetchLimitRaw);
          const fetchLimit =
            Number.isFinite(fetchLimitParsed) && fetchLimitParsed > 0
              ? Math.min(fetchLimitParsed, 200000)
              : null;

          const windowLabel = `${rawWindowValue}${windowUnit.charAt(0)}`;

          return {
            variables: {
              fromTimestamp: String(fromTimestamp),
              ...(fetchLimit ? { fetchLimit } : {}),
            },
            meta: {
              limitLabel: `window=${windowLabel}, top=${resultLimit}, sample=${fetchLimit ?? "∞"}`,
              summary: `Top ${resultLimit} • last ${windowLabel}`,
              windowSeconds,
              windowLabel,
              fromTimestamp,
              nowTimestamp: nowSeconds,
              resultLimit,
              fetchLimit,
            },
          };
        },
        processResponse: (payload, meta) => {
          const packets = payload?.data?.PacketDelivered ?? [];
          const result = this.aggregatePopularOapps(packets, meta);

          return {
            rows: result.rows,
            meta: {
              ...meta,
              summary: result.meta.summary,
              popularOappsSummary: result.meta.popularOappsSummary,
            },
          };
        },
      },

      "web-of-security": {
        label: "Web of Security",
        description: "Crawl or load the security graph for an OApp",
        query: null,
        initialize: ({ card, run }) => {
          const fileInput = card.querySelector('input[name="webFile"]');
          if (fileInput) {
            fileInput.addEventListener("change", () => {
              if (fileInput.files && fileInput.files[0]) {
                run();
              }
            });
          }
        },
        buildVariables: (card) => {
          const seedOAppIdInput = card.querySelector('input[name="seedOAppId"]');
          const depthInput = card.querySelector('input[name="depth"]');
          const fileInput = card.querySelector('input[name="webFile"]');

          const seedOAppId = seedOAppIdInput?.value?.trim();
          const depth = parseInt(depthInput?.value) || 10;
          const file = fileInput?.files?.[0];

          if (!seedOAppId && !file) {
            throw new Error(
              "Please provide a seed OApp ID to crawl or select a web data JSON file to load.",
            );
          }

          const isCrawl = !!seedOAppId;

          if (file && seedOAppIdInput) {
            seedOAppIdInput.value = "";
          }

          return {
            variables: {
              seedOAppId,
              depth,
              file: isCrawl ? null : file,
              isCrawl,
            },
            meta: {
              limitLabel: seedOAppId ? `seed=${seedOAppId}` : "web-of-security",
              summary: seedOAppId || "Web of Security",
            },
          };
        },
        processResponse: async (payload, meta) => {
          const webData = payload?.webData;
          if (!webData) {
            throw new Error("Invalid web data format");
          }

          return {
            rows: [],
            meta: {
              ...meta,
              webData,
              resultLabel: "Web of Security",
              renderMode: "graph",
            },
          };
        },
      },
    };
    return this.registry;
  }

  populateChainDatalist(datalist) {
    datalist.innerHTML = "";
    const options = this.chainMetadata.listLocalEndpoints();
    options.forEach((option) => {
      if (!option || !option.id) return;
      const node = document.createElement("option");
      const display = `${option.label} (${option.id})`;
      node.value = option.id;
      node.label = display;
      node.textContent = display;
      datalist.appendChild(node);
    });
  }

  aggregatePopularOapps(packets, options = {}) {
    const resultLimit = clampInteger(options.resultLimit, 1, 200, 20);
    const windowLabel = options.windowLabel || "";
    const fetchLimit = options.fetchLimit ?? null;

    const groups = new Map();
    packets.forEach((packet) => {
      if (!packet) return;

      const inferredKey =
        packet.oappId ||
        (packet.localEid && packet.receiver
          ? `${packet.localEid}_${packet.receiver.toLowerCase()}`
          : null);
      if (!inferredKey) return;

      const [localPart, addressPart] = inferredKey.split("_");
      const group = groups.get(inferredKey) ?? {
        oappId: inferredKey,
        localEid: localPart || String(packet.localEid ?? ""),
        address: (packet.receiver || addressPart || "").toLowerCase(),
        count: 0,
        eids: new Set(),
        lastTimestamp: 0,
        firstTimestamp: Number.MAX_SAFE_INTEGER,
        lastBlock: null,
      };

      group.count += 1;
      if (packet.srcEid !== undefined && packet.srcEid !== null)
        group.eids.add(String(packet.srcEid));

      const timestamp = Number(packet.blockTimestamp ?? 0);
      if (Number.isFinite(timestamp)) {
        group.lastTimestamp = Math.max(group.lastTimestamp, timestamp);
        group.firstTimestamp = Math.min(group.firstTimestamp, timestamp);
      }

      const blockNumber = packet.blockNumber !== undefined ? Number(packet.blockNumber) : null;
      if (
        Number.isFinite(blockNumber) &&
        (group.lastBlock === null || blockNumber > group.lastBlock)
      ) {
        group.lastBlock = blockNumber;
      }

      groups.set(inferredKey, group);
    });

    const sortedGroups = Array.from(groups.values()).sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return (b.lastTimestamp || 0) - (a.lastTimestamp || 0);
    });

    const limited = sortedGroups.slice(0, resultLimit);
    const rows = limited.map((group, index) => {
      const chainDisplay = this.getChainDisplayLabel(group.localEid) || group.localEid || "—";
      const address = group.address || (group.oappId.split("_")[1] ?? "—");
      const eids = Array.from(group.eids).sort();

      const chainCell = this.createFormattedCell([chainDisplay], group.localEid);

      const oappCell = this.formatOAppIdCell(group.oappId);
      const addressCell = this.createFormattedCell([address], address);

      const eidLines = [`Count ${eids.length}`];
      const eidCopyValue = eids.join(", ");
      const eidCell = this.createFormattedCell(eidLines, eidCopyValue || `Count ${eids.length}`);

      const lastLines = [];
      if (group.lastTimestamp) {
        const ts = formatTimestampValue(group.lastTimestamp);
        if (ts) {
          lastLines.push(ts.primary);
          if (ts.secondary) {
            lastLines.push(ts.secondary);
          }
        }
      }
      if (group.lastBlock !== null && group.lastBlock !== undefined) {
        lastLines.push(`Block ${group.lastBlock}`);
      }
      const lastCell = this.createFormattedCell(
        lastLines.length ? lastLines : ["—"],
        String(group.lastTimestamp ?? ""),
      );

      return {
        Rank: String(index + 1),
        "OApp ID": oappCell,
        Endpoint: chainCell,
        Address: addressCell,
        Packets: String(group.count),
        "Unique incoming EIDs": eidCell,
        "Last Packet": lastCell,
      };
    });

    return {
      rows,
      meta: {
        summary: `Top ${rows.length} • last ${windowLabel || "window"}`,
        popularOappsSummary: {
          windowLabel,
          fromTimestamp: options.fromTimestamp ?? 0,
          toTimestamp: options.nowTimestamp ?? Math.floor(Date.now() / 1000),
          totalOapps: groups.size,
          sampledPackets: packets.length,
          returnedCount: rows.length,
          fetchLimit: fetchLimit ?? "∞",
        },
      },
    };
  }

  formatSecurityConfigRows(rows, meta) {
    // First pass: find most common values for Required DVNs, Optional DVNs, and Fallbacks
    const requiredDvnValues = new Map();
    const optionalDvnValues = new Map();
    const fallbackValues = new Map();

    rows.forEach((row) => {
      // Required DVNs
      const reqKey = row.usesRequiredDVNSentinel
        ? "sentinel"
        : JSON.stringify(row.effectiveRequiredDVNs || []);
      requiredDvnValues.set(reqKey, (requiredDvnValues.get(reqKey) || 0) + 1);

      // Optional DVNs
      const optKey = JSON.stringify({
        dvns: row.effectiveOptionalDVNs || [],
        threshold: row.effectiveOptionalDVNThreshold,
      });
      optionalDvnValues.set(optKey, (optionalDvnValues.get(optKey) || 0) + 1);

      // Fallbacks
      const fallbackKey = JSON.stringify(row.fallbackFields || []);
      fallbackValues.set(fallbackKey, (fallbackValues.get(fallbackKey) || 0) + 1);
    });

    // Find most common values
    const mostCommonRequired = this.findMostCommon(requiredDvnValues);
    const mostCommonOptional = this.findMostCommon(optionalDvnValues);
    const mostCommonFallback = this.findMostCommon(fallbackValues);

    // Second pass: format rows with highlight flags
    return rows.map((row) =>
      this.formatSecurityConfigRow(row, meta, {
        mostCommonRequired,
        mostCommonOptional,
        mostCommonFallback,
      }),
    );
  }

  findMostCommon(valueMap) {
    let maxCount = 0;
    let mostCommon = null;
    valueMap.forEach((count, key) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = key;
      }
    });
    return mostCommon;
  }

  formatSecurityConfigRow(row, meta, commonValues = {}) {
    const formatted = {};
    const chainDisplay = this.getChainDisplayLabel(row.eid) || row.eid || "—";
    formatted["Source EID"] = this.createFormattedCell([chainDisplay], row.eid);
    formatted.Library = this.formatLibraryDescriptor(row);

    // Required DVNs with highlighting
    const reqKey = row.usesRequiredDVNSentinel
      ? "sentinel"
      : JSON.stringify(row.effectiveRequiredDVNs || []);
    const highlightRequired =
      commonValues.mostCommonRequired && reqKey !== commonValues.mostCommonRequired;
    formatted["Required DVNs"] = this.formatRequiredDvns(row, meta, highlightRequired);

    // Optional DVNs with highlighting
    const optKey = JSON.stringify({
      dvns: row.effectiveOptionalDVNs || [],
      threshold: row.effectiveOptionalDVNThreshold,
    });
    const highlightOptional =
      commonValues.mostCommonOptional && optKey !== commonValues.mostCommonOptional;
    formatted["Optional DVNs"] = this.formatOptionalDvns(row, meta, highlightOptional);

    formatted.Peer = this.formatPeer(row, meta.peerMap);
    formatted["Peer Updated"] = this.formatPeerUpdate(row);
    formatted.Confirmations = this.formatConfirmations(row);

    // Fallbacks with highlighting
    const fallbackKey = JSON.stringify(row.fallbackFields || []);
    const highlightFallback =
      commonValues.mostCommonFallback && fallbackKey !== commonValues.mostCommonFallback;
    formatted.Fallbacks = this.formatFallbackFields(
      row.fallbackFields,
      row.usesDefaultConfig,
      row.libraryStatus,
      highlightFallback,
    );

    formatted["Last Update"] = this.formatLastComputed(row);

    return formatted;
  }

  formatLibraryDescriptor(row) {
    const address = row.effectiveReceiveLibrary || "—";
    const statusBits = [];

    // Handle three library states with explanations: "tracked", "unsupported", "none"
    const libraryStatus = row.libraryStatus || "unknown";
    const statusExplanations = {
      tracked: "TRACKED (ULN config available)",
      unsupported: "UNSUPPORTED (no ULN config)",
      none: "NOT CONFIGURED",
      unknown: "UNKNOWN STATUS",
    };
    statusBits.push(statusExplanations[libraryStatus] || libraryStatus);

    // Only show "Uses default library" if there's actually a library resolved
    if (row.usesDefaultLibrary && row.effectiveReceiveLibrary) {
      statusBits.push("Uses default library");
    }
    if (!row.usesDefaultLibrary && row.libraryOverrideVersionId) {
      statusBits.push("Custom override");
    }

    const lines = [address];
    if (statusBits.length) {
      lines.push(statusBits.join(" • "));
    }

    return this.createFormattedCell(lines, address);
  }

  formatRequiredDvns(row, meta, highlight = false) {
    // If no library configured, ULN config is unavailable
    if (row.libraryStatus === "none" || row.libraryStatus === "unsupported") {
      return this.createFormattedCell(["—", "No ULN config"], "", { highlight });
    }

    if (row.usesRequiredDVNSentinel) {
      return this.createFormattedCell(
        ["SENTINEL: 0 required DVNs", "Optional-only quorum"],
        "sentinel",
        { highlight },
      );
    }
    return this.formatDvnSet(
      row.effectiveRequiredDVNs,
      row.effectiveRequiredDVNCount,
      meta,
      row.localEid,
      [],
      highlight,
    );
  }

  formatOptionalDvns(row, meta, highlight = false) {
    // If no library configured, ULN config is unavailable
    if (row.libraryStatus === "none" || row.libraryStatus === "unsupported") {
      return this.createFormattedCell(["—", "No ULN config"], "", { highlight });
    }

    const count = row.effectiveOptionalDVNCount ?? 0;
    const threshold = row.effectiveOptionalDVNThreshold ?? "—";
    return this.formatDvnSet(
      row.effectiveOptionalDVNs,
      count,
      meta,
      row.localEid,
      [`Threshold ${threshold}`],
      highlight,
    );
  }

  formatDvnSet(addresses, count, meta, localEid, extraLines = [], highlight = false) {
    const addrs = Array.isArray(addresses) ? addresses.filter(Boolean) : [];
    const lines = [`Count ${count ?? addrs.length ?? 0}`, ...extraLines];
    if (addrs.length) {
      lines.push(...this.resolveDvnLabels(addrs, meta, localEid ?? meta?.localEid ?? meta?.eid));
    }
    return this.createFormattedCell(lines, addrs.join(", ") || String(count), { highlight });
  }

  derivePeerContext(row) {
    const peerOappId = row.peerOappId ?? null;
    if (!peerOappId) {
      return null;
    }

    const { localEid, address } = splitOAppId(peerOappId);
    const endpointLabel =
      localEid !== null && localEid !== undefined
        ? this.getChainDisplayLabel(localEid) || `EID ${localEid}`
        : null;
    const alias = this.aliasStore.get(peerOappId) ?? null;

    return {
      peerHex: row.peer ?? null,
      localEid,
      endpointLabel,
      address,
      oappId: peerOappId,
      alias,
      copyValue: peerOappId,
    };
  }

  formatPeer(row, peerMap) {
    const ctx = this.derivePeerContext(row);
    const peerData = peerMap?.get(String(row.eid));

    // Determine peer state
    let peerState = "not-configured";
    const isZeroPeer = isZeroAddress(row.peer);

    if (peerData) {
      if (isZeroPeer && !peerData.fromPacketDelivered) {
        peerState = "explicitly-blocked";
      } else if (peerData.fromPacketDelivered) {
        peerState = "auto-discovered";
      } else {
        peerState = "explicitly-set";
      }
    } else if (isZeroPeer) {
      // Zero peer but no OAppPeer record - check if it's in the config at all
      // If peer is set to zero in the config, it's blocked
      peerState = "explicitly-blocked";
    }

    const lines = [];

    // Add peer state indicator
    const stateLabels = {
      "not-configured": "Not configured",
      "auto-discovered": "Auto-discovered",
      "explicitly-set": "Explicitly set",
      "explicitly-blocked": "BLOCKED (zero address)",
    };
    lines.push(stateLabels[peerState]);

    // For blocked peers, don't show the synthetic zero address OApp ID
    if (peerState === "explicitly-blocked") {
      return this.createFormattedCell(lines, "0x0", { highlight: true });
    }

    if (!ctx) {
      return this.createFormattedCell(lines, "");
    }

    if (ctx.alias) {
      lines.push(ctx.alias);
    }
    if (ctx.oappId) {
      lines.push(`ID ${ctx.oappId}`);
    } else if (ctx.peerHex) {
      lines.push(ctx.peerHex);
    }

    const meta =
      ctx.oappId || ctx.localEid
        ? {
            oappId: ctx.oappId ?? undefined,
            localEid: ctx.localEid ?? undefined,
          }
        : undefined;
    return this.createFormattedCell(lines, ctx.copyValue, meta);
  }

  formatPeerUpdate(row) {
    return this.formatUpdateInfo({
      block: row.peerLastUpdatedBlock,
      timestamp: row.peerLastUpdatedTimestamp,
      eventId: row.peerLastUpdatedEventId,
      txHash: row.peerTransactionHash,
    });
  }

  formatConfirmations(row) {
    // If no library configured, ULN config is unavailable
    if (row.libraryStatus === "none" || row.libraryStatus === "unsupported") {
      return this.createFormattedCell(["—", "No ULN config"], "");
    }

    const confirmations = row.effectiveConfirmations ?? "—";
    const lines = [];

    // Check for sentinel value (2^64-1 = 18446744073709551615)
    const CONFIRMATIONS_SENTINEL = "18446744073709551615";
    if (String(confirmations) === CONFIRMATIONS_SENTINEL) {
      lines.push("SENTINEL: 0 confirmations");
      lines.push("Instant finality mode");
    } else {
      lines.push(String(confirmations));
    }

    return this.createFormattedCell(lines, String(confirmations));
  }

  formatFallbackFields(fields, usesDefaultConfig, libraryStatus, highlight = false) {
    // If no library configured, show N/A
    if (libraryStatus === "none" || libraryStatus === "unsupported") {
      return this.createFormattedCell(["—", "No ULN config"], "", { highlight });
    }

    const names = Array.isArray(fields) ? fields : [];
    if (!names.length) {
      if (usesDefaultConfig) {
        return this.createFormattedCell(["All from default"], "default", { highlight });
      }
      return this.createFormattedCell(["None (fully custom)"], "", { highlight });
    }

    const map = {
      receiveLibrary: "library",
      confirmations: "confirmations",
      requiredDVNCount: "required count",
      requiredDVNs: "required dvns",
      optionalDVNCount: "optional count",
      optionalDVNs: "optional dvns",
      optionalDVNThreshold: "optional threshold",
    };

    const lines = names.map((name) => map[name] || name);
    return this.createFormattedCell(lines, names.join(", "), { highlight });
  }

  formatLastComputed(row) {
    return this.formatUpdateInfo({
      block: row.lastComputedBlock,
      timestamp: row.lastComputedTimestamp,
      eventId: row.lastComputedByEventId,
      txHash: row.lastComputedTransactionHash,
    });
  }

  formatUpdateInfo({ block, timestamp, eventId, txHash }) {
    const lines = [];
    if (block !== undefined && block !== null) lines.push(`Block ${block}`);
    if (timestamp !== undefined && timestamp !== null) {
      const ts = formatTimestampValue(timestamp);
      if (ts) lines.push(ts.primary);
    }
    if (eventId) lines.push(eventId);
    if (txHash) {
      const hashStr = String(txHash);
      const truncated =
        hashStr.length > 20 ? `${hashStr.slice(0, 10)}…${hashStr.slice(-6)}` : hashStr;
      lines.push(`Tx ${truncated}`);
    }

    const copyValue = txHash || eventId || lines.join(" | ");
    return this.createFormattedCell(lines.length ? lines : ["—"], copyValue);
  }

  async runQuery(key, card, statusEl) {
    const requestId = ++this.requestSeq;
    this.latestRequest = requestId;

    this.setStatus(statusEl, "Loading…", "loading");

    const registry = this.buildQueryRegistry();
    const config = registry[key];

    if (!config) {
      throw new Error(`Unknown query: ${key}`);
    }

    this.dvnLabelCache.clear();
    this.chainLabelCache.clear();

    const buildResult = config.buildVariables?.(card) ?? {};
    const variables =
      Object.prototype.hasOwnProperty.call(buildResult, "variables") && buildResult.variables
        ? buildResult.variables
        : buildResult.variables === null
          ? {}
          : buildResult;
    const extraMeta =
      Object.prototype.hasOwnProperty.call(buildResult, "meta") && buildResult.meta
        ? buildResult.meta
        : {};

    if (!variables || Object.keys(variables).length === 0) {
      throw new Error("Missing query input.");
    }

    const startedAt = performance.now();

    try {
      let payload;

      // Handle web-of-security crawler
      if (variables.isCrawl) {
        const { SecurityGraphCrawler } = await import("./crawler.js");
        this.setStatus(statusEl, "Crawling...", "loading");
        const crawler = new SecurityGraphCrawler(this.client, this.chainMetadata);
        const webData = await crawler.crawl(variables.seedOAppId, {
          depth: variables.depth,
          onProgress: (status) => this.setStatus(statusEl, status, "loading"),
        });
        payload = { webData };
      } else if (variables.file) {
        const file = variables.file;
        const text = await file.text();
        const webData = JSON.parse(text);
        payload = { webData };
      } else {
        const data = await this.client.query(config.query, variables);
        payload = { data };
      }

      const elapsed = performance.now() - startedAt;
      const baseMeta = {
        elapsed,
        variables,
        requestId,
        label: extraMeta.resultLabel || config.label,
        originalLabel: config.label,
        queryKey: key,
        ...extraMeta,
      };

      let rows = [];
      let finalMeta = { ...baseMeta };

      if (typeof config.processResponse === "function") {
        const result = (await config.processResponse(payload, { ...baseMeta })) || {};
        rows = Array.isArray(result.rows) ? result.rows : [];
        if (result.meta && typeof result.meta === "object") {
          finalMeta = { ...baseMeta, ...result.meta };
        }
      } else if (typeof config.extractRows === "function") {
        rows = config.extractRows(payload.data) ?? [];
      }

      this.lastMetaBase = baseMeta;
      this.lastQueryKey = key;
      this.lastVariables = variables;
      this.lastPayload = payload;

      this.setStatus(
        statusEl,
        finalMeta.renderMode === "graph"
          ? `Loaded web with ${finalMeta.webData?.nodes?.length || 0} nodes in ${elapsed.toFixed(0)} ms`
          : `Fetched ${rows.length} row${rows.length === 1 ? "" : "s"} in ${elapsed.toFixed(0)} ms`,
        "success",
      );

      if (requestId === this.latestRequest) {
        this.onResultsUpdate(rows, payload, finalMeta);
      }

      return rows;
    } catch (error) {
      console.error("Query failed", error);
      this.setStatus(statusEl, error.message, "error");

      if (requestId === this.latestRequest) {
        this.onResultsUpdate([], null, {
          label: extraMeta.resultLabel || config.label,
          error: error.message,
          variables,
          limitLabel: extraMeta.limitLabel,
          summary: extraMeta.summary,
        });
      }
      return [];
    }
  }

  async reprocessLastResults() {
    if (!this.lastPayload || !this.lastMetaBase || !this.lastQueryKey) {
      return;
    }

    const registry = this.buildQueryRegistry();
    const config = registry[this.lastQueryKey];
    if (!config) {
      return;
    }

    const baseMeta = { ...this.lastMetaBase };
    let rows = [];
    let finalMeta = { ...baseMeta };

    try {
      if (typeof config.processResponse === "function") {
        let result = config.processResponse(this.lastPayload, { ...baseMeta }) || {};
        if (result && typeof result.then === "function") {
          result = await result;
        }
        rows = Array.isArray(result.rows) ? result.rows : [];
        if (result?.meta && typeof result.meta === "object") {
          finalMeta = { ...baseMeta, ...result.meta };
        }
      } else if (typeof config.extractRows === "function") {
        rows = config.extractRows(this.lastPayload.data) ?? [];
      }
    } catch (error) {
      console.error("[QueryCoordinator] Failed to reprocess results", error);
      return;
    }

    this.lastMetaBase = baseMeta;
    this.onResultsUpdate(rows, this.lastPayload, finalMeta);
  }

  setStatus(node, text, state) {
    if (!node) return;

    node.textContent = text;
    if (state) {
      node.setAttribute("data-state", state);
    } else {
      node.removeAttribute("data-state");
    }
  }
}

/**
 * Toast notification system
 */
export class ToastQueue {
  constructor() {
    this.container = null;
    this.timers = [];
  }

  show(message, tone = "neutral") {
    const container = this.ensureContainer();
    const toast = document.createElement("div");
    toast.className = `copy-toast copy-toast-${tone}`;
    toast.textContent = message;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add("visible");
    });

    const timeout = setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => {
        toast.remove();
      }, 220);
    }, APP_CONFIG.FEEDBACK.TOAST_DURATION);

    this.timers.push(timeout);
    if (this.timers.length > APP_CONFIG.FEEDBACK.MAX_TOASTS) {
      const removedTimeout = this.timers.shift();
      if (removedTimeout) {
        clearTimeout(removedTimeout);
      }
    }
  }

  ensureContainer() {
    if (this.container && document.body.contains(this.container)) {
      return this.container;
    }
    const container = document.createElement("div");
    container.className = "copy-toast-container";
    document.body.appendChild(container);
    this.container = container;
    return container;
  }
}

/**
 * Results renderer
 */
export class ResultsView {
  constructor(
    resultsTitle,
    resultsMeta,
    resultsBody,
    copyJsonButton,
    chainMetadata,
    aliasStore,
    toastQueue,
  ) {
    this.resultsTitle = resultsTitle;
    this.resultsMeta = resultsMeta;
    this.resultsBody = resultsBody;
    this.copyJsonButton = copyJsonButton;
    this.chainMetadata = chainMetadata;
    this.aliasStore = aliasStore;
    this.toastQueue = toastQueue;
    this.lastRender = null;
    this.copyFeedbackTimers = new WeakMap();
    this.chainLabelCache = new Map();
  }

  render(rows, payload, meta) {
    this.chainLabelCache.clear();
    const metaSnapshot = { ...meta };
    this.lastRender = { rows, payload, meta: metaSnapshot };

    if (this.copyJsonButton) {
      const hideCopyButton = metaSnapshot.originalLabel === "Top OApps";
      this.copyJsonButton.hidden = hideCopyButton;
      if (!hideCopyButton) {
        this.copyJsonButton.disabled =
          metaSnapshot.renderMode === "graph" ? false : rows.length === 0;
        this.copyJsonButton.textContent =
          metaSnapshot.renderMode === "graph" ? "Download JSON" : "Copy JSON";
      }
    }

    const variableHints = this.buildVariableSummary(metaSnapshot.variables);
    const metaParts = [
      metaSnapshot.renderMode === "graph"
        ? `${metaSnapshot.webData?.nodes?.length || 0} nodes, ${metaSnapshot.webData?.edges?.length || 0} edges`
        : `${rows.length} row${rows.length === 1 ? "" : "s"}`,
      metaSnapshot.summary,
      `${Math.round(metaSnapshot.elapsed)} ms`,
      metaSnapshot.limitLabel,
      variableHints,
      new Date().toLocaleTimeString(),
    ].filter(Boolean);

    this.resultsTitle.textContent = metaSnapshot.label || "Results";
    this.resultsMeta.textContent = metaParts.join(" • ");

    if (meta.error) {
      this.renderError(meta);
      return;
    }

    if (metaSnapshot.renderMode === "graph") {
      this.renderGraph(metaSnapshot.webData);
      return;
    }

    const summaryPanel = this.renderSummaryPanel(metaSnapshot);

    if (!rows.length) {
      this.resultsBody.classList.add("empty");
      this.resultsBody.innerHTML = "";
      if (summaryPanel) {
        this.resultsBody.appendChild(summaryPanel);
      }
      const placeholder = document.createElement("div");
      placeholder.className = "placeholder";
      placeholder.innerHTML = `
        <p class="placeholder-title">No rows returned</p>
        <p>Adjust filters or try again.</p>
      `;
      this.resultsBody.appendChild(placeholder);
      return;
    }

    this.resultsBody.classList.remove("empty");
    this.resultsBody.innerHTML = "";

    if (summaryPanel) {
      this.resultsBody.appendChild(summaryPanel);
    }

    const table = this.buildTable(rows);
    const payloadDetails = this.buildPayloadDetails(payload);

    this.resultsBody.appendChild(table);
    this.resultsBody.appendChild(payloadDetails);
  }

  async renderGraph(webData, centerNodeId = null) {
    this.resultsBody.classList.remove("empty");
    this.resultsBody.innerHTML = "";

    const { SecurityGraphView } = await import("./graph.js");
    const renderer = new SecurityGraphView({
      getOAppAlias: (oappId) => this.aliasStore.get(oappId),
      getChainDisplayLabel: (chainId) => this.getChainDisplayLabel(chainId),
      requestUniformAlias: (ids) => {
        if (!Array.isArray(ids) || !ids.length) {
          return;
        }
        const uniqueIds = Array.from(
          new Set(
            ids.map((id) => (id === null || id === undefined ? null : String(id))).filter(Boolean),
          ),
        );
        if (!uniqueIds.length) {
          return;
        }
        const event = new CustomEvent("alias:rename-all", {
          detail: {
            oappIds: uniqueIds,
            source: "web-of-security",
          },
        });
        document.dispatchEvent(event);
      },
    });

    // Set up recenter callback
    renderer.onRecenter = (newCenterNodeId) => {
      this.renderGraph(webData, newCenterNodeId);
    };

    const graphContainer = renderer.render(webData, { centerNodeId });
    this.resultsBody.appendChild(graphContainer);
  }

  getChainDisplayLabel(chainId) {
    if (!chainId && chainId !== 0) {
      return "";
    }

    const key = String(chainId);
    if (this.chainLabelCache.has(key)) {
      return this.chainLabelCache.get(key);
    }

    const chainInfo = this.chainMetadata.getChainInfo(key);
    const display = chainInfo ? `${chainInfo.primary} (${key})` : key;
    this.chainLabelCache.set(key, display);
    return display;
  }

  renderError(meta) {
    this.copyJsonButton.disabled = true;
    this.resultsBody.classList.remove("empty");
    this.resultsBody.innerHTML = "";

    const template = document.getElementById("error-template");
    const node = template.content.cloneNode(true);
    node.querySelector("[data-error-message]").textContent = meta.error;
    this.resultsBody.appendChild(node);
  }

  buildTable(rows) {
    const columnSet = new Set();
    rows.forEach((row) => {
      Object.keys(row || {}).forEach((key) => columnSet.add(key));
    });

    const columns = Array.from(columnSet);
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    columns.forEach((column) => {
      const th = document.createElement("th");
      th.textContent = column;
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      columns.forEach((column) => {
        const td = document.createElement("td");
        td.appendChild(this.renderCell(column, row[column]));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    return table;
  }

  renderCell(column, value) {
    const { nodes, copyValue, isCopyable, meta, highlight } = this.interpretValue(column, value);

    if (!isCopyable) {
      const fragment = document.createDocumentFragment();
      nodes.forEach((node) => fragment.append(node));
      return fragment;
    }

    const container = document.createElement("div");
    container.className = "copyable";
    if (highlight) {
      container.classList.add("cell-variant");
    }

    const content =
      copyValue ??
      nodes
        .map((node) => node.textContent ?? "")
        .join(" ")
        .trim();
    if (content) {
      container.dataset.copyValue = content;
    }

    if (meta && typeof meta === "object") {
      if (meta.oappId) {
        container.dataset.oappId = meta.oappId;
      }
    }

    nodes.forEach((node) => container.append(node));
    return container;
  }

  interpretValue(column, value) {
    const nodes = [];

    if (value && typeof value === "object" && value.__formatted) {
      const lines = Array.isArray(value.lines) ? value.lines : [value.lines ?? ""];
      lines.forEach((line) => {
        const span = document.createElement("span");
        const content = line === null || line === undefined || line === "" ? " " : String(line);
        span.textContent = content;
        nodes.push(span);
      });
      const cleanedLines = lines
        .map((line) => (line === null || line === undefined ? "" : String(line)))
        .filter((line) => line.trim().length > 0);
      const copyValue = value.copyValue ?? cleanedLines.join(" | ");
      return {
        nodes,
        copyValue,
        isCopyable: true,
        meta: value.meta || null,
        highlight: value.highlight || false,
      };
    }

    if (value === null || value === undefined) {
      nodes.push(document.createTextNode("—"));
      return {
        nodes,
        copyValue: "null",
        isCopyable: true,
      };
    }

    if (Array.isArray(value) || (typeof value === "object" && value)) {
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(value, null, 2);
      nodes.push(pre);
      return {
        nodes,
        copyValue: JSON.stringify(value, null, 2),
        isCopyable: true,
      };
    }

    if (looksLikeEidColumn(column)) {
      const chainInfo = this.chainMetadata.getChainInfo(value);
      if (chainInfo) {
        nodes.push(document.createTextNode(chainInfo.primary));
        const secondary = document.createElement("span");
        secondary.className = "cell-secondary";
        secondary.textContent = chainInfo.secondary;
        nodes.push(secondary);
        return {
          nodes,
          copyValue: chainInfo.copyValue,
          isCopyable: true,
        };
      }
    }

    if (looksLikeTimestampColumn(column)) {
      const tsInfo = formatTimestampValue(value);
      if (tsInfo) {
        nodes.push(document.createTextNode(tsInfo.primary));
        const secondary = document.createElement("span");
        secondary.className = "cell-secondary";
        secondary.textContent = tsInfo.secondary;
        nodes.push(secondary);
        return {
          nodes,
          copyValue: tsInfo.copyValue,
          isCopyable: true,
        };
      }
    }

    if (typeof value === "string" && looksLikeHash(column, value)) {
      const code = document.createElement("code");
      code.textContent = value;
      nodes.push(code);
      return {
        nodes,
        copyValue: value,
        isCopyable: true,
      };
    }

    const strValue = stringifyScalar(value);
    nodes.push(document.createTextNode(strValue));
    return {
      nodes,
      copyValue: strValue,
      isCopyable: true,
    };
  }

  buildPayloadDetails(payload) {
    const details = document.createElement("details");
    details.className = "json-dump";

    const summary = document.createElement("summary");
    summary.textContent = "View response payload";
    details.appendChild(summary);

    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(payload, null, 2);
    details.appendChild(pre);

    return details;
  }

  renderSummaryPanel(meta) {
    if (!meta) return null;

    const container = document.createElement("div");
    container.className = "summary-panels";

    // Group OApp-related panels in a row
    const oappPanels = [];
    if (meta.oappInfo) {
      oappPanels.push(this.renderOAppSummary(meta));
    }
    if (meta.routeStats && meta.routeStats.length > 0) {
      oappPanels.push(this.renderRouteStatsSummary(meta.routeStats));
    }
    if (meta.rateLimiter || (meta.rateLimits && meta.rateLimits.length > 0)) {
      oappPanels.push(this.renderRateLimitingSummary(meta));
    }

    // If we have OApp panels, put them in a row
    if (oappPanels.length > 0) {
      const oappRow = document.createElement("div");
      oappRow.className = "summary-panel-row";
      oappPanels.filter(Boolean).forEach((panel) => oappRow.appendChild(panel));
      container.appendChild(oappRow);
    }

    // Popular OApps summary goes on its own row
    if (meta.popularOappsSummary) {
      const popularPanel = this.renderPopularOappsSummary(meta.popularOappsSummary);
      if (popularPanel) {
        const popularRow = document.createElement("div");
        popularRow.className = "summary-panel-row";
        popularRow.appendChild(popularPanel);
        container.appendChild(popularRow);
      }
    }

    return container.children.length > 0 ? container : null;
  }

  renderOAppSummary(meta) {
    const info = meta?.oappInfo;
    if (!info) return null;

    const panel = document.createElement("div");
    panel.className = "summary-panel";

    const heading = document.createElement("h3");
    heading.textContent = "OApp Overview";
    panel.appendChild(heading);

    const list = document.createElement("dl");
    panel.appendChild(list);

    const alias = this.aliasStore.get(info.id);
    if (alias) {
      this.appendSummaryRow(list, "OApp Alias", alias);
    }
    this.appendSummaryRow(list, "OApp ID", info.id ?? "");
    const localEid =
      info.localEid !== undefined && info.localEid !== null ? String(info.localEid) : "—";
    const localLabel = meta.chainLabel || this.getChainDisplayLabel(localEid) || `EID ${localEid}`;
    this.appendSummaryRow(list, "Local EID", `${localLabel}`);
    // Native chain ids removed; local EIDs provide canonical context.
    this.appendSummaryRow(list, "Address", info.address ?? "");
    if (info.totalPacketsReceived !== undefined && info.totalPacketsReceived !== null) {
      this.appendSummaryRow(list, "Total Packets", String(info.totalPacketsReceived));
    }
    if (info.lastPacketBlock !== undefined && info.lastPacketBlock !== null) {
      this.appendSummaryRow(list, "Last Packet Block", String(info.lastPacketBlock));
    }
    if (info.lastPacketTimestamp !== undefined && info.lastPacketTimestamp !== null) {
      const ts = formatTimestampValue(info.lastPacketTimestamp);
      if (ts) {
        this.appendSummaryRow(list, "Last Packet Time", ts.primary);
      }
    }

    return panel;
  }

  renderRouteStatsSummary(routeStats) {
    if (!routeStats || routeStats.length === 0) return null;

    const panel = document.createElement("div");
    panel.className = "summary-panel";

    const heading = document.createElement("h3");
    heading.textContent = "Per-Route Activity";
    panel.appendChild(heading);

    const list = document.createElement("dl");
    panel.appendChild(list);

    this.appendSummaryRow(list, "Total Routes", routeStats.length);

    // Show top 5 routes by packet count
    const topRoutes = routeStats.slice(0, 5);
    topRoutes.forEach((route, idx) => {
      const chainLabel = this.getChainDisplayLabel(route.srcEid) || `EID ${route.srcEid}`;
      this.appendSummaryRow(
        list,
        idx === 0 ? "Top Routes" : " ",
        `${chainLabel}: ${route.packetCount} packets`,
      );
    });

    if (routeStats.length > 5) {
      this.appendSummaryRow(list, " ", `... and ${routeStats.length - 5} more routes`);
    }

    return panel;
  }

  renderRateLimitingSummary(meta) {
    const rateLimiter = meta.rateLimiter;
    const rateLimits = meta.rateLimits || [];

    const panel = document.createElement("div");
    panel.className = "summary-panel";

    const heading = document.createElement("h3");
    heading.textContent = "Rate Limiting (OFT)";
    panel.appendChild(heading);

    const list = document.createElement("dl");
    panel.appendChild(list);

    if (rateLimiter && rateLimiter.rateLimiter) {
      this.appendSummaryRow(list, "Rate Limiter", rateLimiter.rateLimiter);
    } else {
      this.appendSummaryRow(list, "Rate Limiter", "Not configured");
    }

    this.appendSummaryRow(list, "Rate Limits", rateLimits.length);

    if (rateLimits.length > 0) {
      // Show up to 5 rate limits
      const displayLimits = rateLimits.slice(0, 5);
      displayLimits.forEach((limit, idx) => {
        const chainLabel = this.getChainDisplayLabel(limit.dstEid) || `EID ${limit.dstEid}`;
        const windowHours = Number(limit.window) / 3600;
        this.appendSummaryRow(
          list,
          idx === 0 ? "Limits" : " ",
          `${chainLabel}: ${limit.limit} per ${windowHours}h`,
        );
      });

      if (rateLimits.length > 5) {
        this.appendSummaryRow(list, " ", `... and ${rateLimits.length - 5} more limits`);
      }
    }

    return panel;
  }

  renderPopularOappsSummary(summary) {
    if (!summary) return null;

    const panel = document.createElement("div");
    panel.className = "summary-panel";

    const heading = document.createElement("h3");
    heading.textContent = "Window Overview";
    panel.appendChild(heading);

    const list = document.createElement("dl");
    panel.appendChild(list);

    this.appendSummaryRow(list, "Window", summary.windowLabel || "");

    if (summary.fromTimestamp) {
      const fromTs = formatTimestampValue(summary.fromTimestamp);
      if (fromTs) {
        this.appendSummaryRow(list, "From", fromTs.primary);
      }
    }

    if (summary.toTimestamp) {
      const toTs = formatTimestampValue(summary.toTimestamp);
      if (toTs) {
        this.appendSummaryRow(list, "To", toTs.primary);
      }
    }

    this.appendSummaryRow(list, "Packets Scanned", summary.sampledPackets);
    this.appendSummaryRow(list, "Unique OApps", summary.totalOapps);
    this.appendSummaryRow(list, "Results Returned", summary.returnedCount);
    this.appendSummaryRow(list, "Sample Limit", summary.fetchLimit);

    return panel;
  }

  appendSummaryRow(list, label, value) {
    if (!value && value !== 0) return;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    list.append(dt, dd);
  }

  buildVariableSummary(variables = {}) {
    const parts = [];
    if (!variables) {
      return "";
    }
    for (const [key, value] of Object.entries(variables)) {
      if (value === undefined || value === null) {
        continue;
      }
      if (key === "minPackets" && (value === "0" || value === 0)) {
        continue;
      }
      if (key === "fromTimestamp" || key === "nowTimestamp") {
        continue;
      }
      if (key === "oappId") {
        continue;
      }
      parts.push(`${key}=${value}`);
    }
    return parts.join(", ");
  }

  async handleCopyableClick(event) {
    const target = event.target.closest(".copyable");
    if (!target || !this.resultsBody.contains(target)) {
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      return;
    }

    const value = target.dataset.copyValue ?? target.textContent;
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      this.flashCopyFeedback(target, true);
      this.toastQueue.show("Copied", "success");
    } catch (error) {
      console.error("Copy failed", error);
      this.flashCopyFeedback(target, false);
      this.toastQueue.show("Copy failed", "error");
    }
  }

  flashCopyFeedback(element, didSucceed) {
    element.classList.remove("copied", "copy-failed");
    element.classList.add(didSucceed ? "copied" : "copy-failed");

    const existing = this.copyFeedbackTimers.get(element);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(
      () => {
        element.classList.remove("copied", "copy-failed");
        this.copyFeedbackTimers.delete(element);
      },
      didSucceed ? APP_CONFIG.FEEDBACK.COPY_DURATION : APP_CONFIG.FEEDBACK.COPY_DURATION + 400,
    );
    this.copyFeedbackTimers.set(element, timeout);
  }

  async handleCopyJson() {
    const isGraphMode = this.lastRender?.meta?.renderMode === "graph";
    const webData = this.lastRender?.meta?.webData;

    if (isGraphMode && webData) {
      const dataStr = JSON.stringify(webData, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `web-of-security-${webData.seed || "data"}-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.flashButtonFeedback(this.copyJsonButton, "Downloaded!");
      return;
    }

    const source = this.lastRender?.payload?.data ?? this.lastRender?.rows ?? [];
    if (!source || (Array.isArray(source) && !source.length)) {
      return;
    }

    const payload = JSON.stringify(source, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      this.flashButtonFeedback(this.copyJsonButton, "Copied!");
    } catch (error) {
      console.error("Clipboard copy failed", error);
      this.flashButtonFeedback(this.copyJsonButton, "Copy failed");
    }
  }

  flashButtonFeedback(button, label) {
    const original = button.textContent;
    button.textContent = label;
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = this.lastRender?.rows?.length === 0;
    }, APP_CONFIG.FEEDBACK.BUTTON_DURATION);
  }
}
