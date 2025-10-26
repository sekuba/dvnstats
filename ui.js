/**
 * UI Components for LayerZero Security Config Explorer
 * Handles queries, results rendering, tables, aliases, and user interactions
 */

import { CONFIG } from "./config.js";
import {
  clampInteger,
  parseOptionalPositiveInt,
  stringifyScalar,
  formatTimestampValue,
  looksLikeHash,
  looksLikeTimestampColumn,
  normalizeAddress,
  normalizeOAppId,
  makeOAppId,
  bytes32ToAddress,
  looksLikeEidColumn,
} from "./core.js";

/**
 * Manages OApp aliases (friendly names for OApp IDs)
 */
export class AliasManager {
  constructor(storageKey = CONFIG.STORAGE.OAPP_ALIASES) {
    this.map = new Map();
    this.storageKey = storageKey;
    this.loaded = false;
  }

  async load() {
    if (this.loaded) {
      return;
    }

    this.map.clear();

    // Load from static file
    try {
      const response = await fetch(CONFIG.DATA_SOURCES.OAPP_ALIASES, {
        cache: "no-store",
      });
      if (response.ok) {
        const data = await response.json();
        if (data && typeof data === "object") {
          Object.entries(data).forEach(([key, value]) => {
            if (value) {
              this.map.set(String(key), String(value));
            }
          });
        }
      }
    } catch (error) {
      console.warn("[AliasManager] Failed to load oapp-aliases.json", error);
    }

    // Merge from localStorage
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === "object") {
          Object.entries(parsed).forEach(([key, value]) => {
            if (value) {
              this.map.set(String(key), String(value));
            } else {
              this.map.delete(String(key));
            }
          });
        }
      }
    } catch (error) {
      console.warn("[AliasManager] Failed to restore from localStorage", error);
    }

    this.loaded = true;
    console.log(`[AliasManager] Loaded ${this.map.size} aliases`);
  }

  get(oappId) {
    if (!oappId) return null;
    return this.map.get(String(oappId)) || null;
  }

  set(oappId, alias) {
    if (!oappId) return;

    const normalizedId = String(oappId);
    const normalizedAlias = alias && alias.trim() ? alias.trim() : null;

    if (normalizedAlias) {
      this.map.set(normalizedId, normalizedAlias);
    } else {
      this.map.delete(normalizedId);
    }

    this.persist();
  }

  persist() {
    try {
      const obj = Object.fromEntries(this.map.entries());
      localStorage.setItem(this.storageKey, JSON.stringify(obj));
    } catch (error) {
      console.warn("[AliasManager] Failed to persist", error);
    }
  }

  export() {
    const obj = Object.fromEntries(this.map.entries());
    const content = JSON.stringify(obj, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "oapp-aliases.json";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

/**
 * Manages queries and their execution
 */
export class QueryManager {
  constructor(client, metadata, aliasManager, onResultsUpdate) {
    this.client = client;
    this.chainMetadata = metadata.chain;
    this.aliasManager = aliasManager;
    this.onResultsUpdate = onResultsUpdate;
    this.requestSeq = 0;
    this.latestRequest = 0;
    this.lastPayload = null;
    this.lastQueryKey = null;
    this.lastMetaBase = null;
    this.lastVariables = null;
    this.bootstrapTriggered = false;
  }

  getChainDisplayLabel(chainId) {
    if (!chainId && chainId !== 0) {
      return "";
    }

    const key = String(chainId);

    // Use chain metadata (falls back to eid label)
    const chainInfo = this.chainMetadata.getChainInfo(key);
    if (chainInfo) {
      return `${chainInfo.primary} (${key})`;
    }

    return key;
  }

  formatOAppIdCell(oappId) {
    if (!oappId) {
      return this.createFormattedCell(["—"], "");
    }
    const alias = this.aliasManager.get(oappId);
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
    };
  }

  resolveDvnLabels(addresses, meta, localEidOverride) {
    if (!Array.isArray(addresses) || !addresses.length) {
      return [];
    }

    const candidateLocal =
      localEidOverride !== undefined && localEidOverride !== null
        ? localEidOverride
        : meta?.localEid ?? meta?.eid ?? null;
    const context =
      candidateLocal !== undefined && candidateLocal !== null && candidateLocal !== ""
        ? { localEid: String(candidateLocal) }
        : {};

    return this.chainMetadata.resolveDvnNames(addresses, context);
  }

  buildQueryRegistry() {
    return {
      "top-oapps": {
        label: "Top OApps",
        description: "Ordered by total packets received",
        query: `
          query TopOApps($limit: Int, $minPackets: numeric!) {
            OApp(
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
          const minPackets = clampInteger(
            minPacketsInput?.value,
            0,
            Number.MAX_SAFE_INTEGER,
            0,
          );

          const variables = {
            minPackets: String(minPackets),
          };
          if (Number.isFinite(parsedLimit)) {
            variables.limit = parsedLimit;
          }

          return {
            variables,
            meta: {
              limitLabel: Number.isFinite(parsedLimit)
                ? `limit=${parsedLimit}`
                : "limit=∞",
            },
          };
        },
        extractRows: (data) =>
          (data?.OApp ?? []).map((row) => ({
            ...row,
            id: this.formatOAppIdCell(row.id),
          })),
      },

      "oapp-security-config": {
        label: "OApp Security Config",
        description: "Resolve the current security posture for a single OApp",
        query: `
          query CurrentSecurityConfig($oappId: String!) {
            OApp(where: { id: { _eq: $oappId } }) {
              id
              localEid
              address
              totalPacketsReceived
              lastPacketBlock
              lastPacketTimestamp
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
              isConfigTracked
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
              chainLabel.textContent = display
                ? `Endpoint: ${display}`
                : "Endpoint not selected.";
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

          const localLabel =
            this.getChainDisplayLabel(localEid) || `EID ${localEid}`;
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
          const oapp = payload?.data?.OApp?.[0] ?? null;
          const configs = payload?.data?.OAppSecurityConfig ?? [];
          const enrichedMeta = { ...meta };

          if (oapp) {
            const localEid = String(oapp.localEid ?? "");
            const chainDisplay =
              this.getChainDisplayLabel(localEid) ||
              enrichedMeta.chainLabel ||
              `EID ${localEid}`;
            enrichedMeta.oappInfo = oapp;
            enrichedMeta.chainLabel = chainDisplay;
            enrichedMeta.localEid = localEid;
            enrichedMeta.summary =
              enrichedMeta.summary || `${chainDisplay} • ${oapp.address}`;
            enrichedMeta.resultLabel = `OApp Security Config – ${chainDisplay}`;
          }

          const formattedRows = this.formatSecurityConfigRows(configs, enrichedMeta);

          return { rows: formattedRows, meta: enrichedMeta };
        },
      },

      "popular-oapps-window": {
        label: "Popular OApps (Window)",
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

      const inferredKey = packet.oappId || (packet.localEid && packet.receiver ? `${packet.localEid}_${packet.receiver.toLowerCase()}` : null);
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
      if (packet.srcEid !== undefined && packet.srcEid !== null) group.eids.add(String(packet.srcEid));

      const timestamp = Number(packet.blockTimestamp ?? 0);
      if (Number.isFinite(timestamp)) {
        group.lastTimestamp = Math.max(group.lastTimestamp, timestamp);
        group.firstTimestamp = Math.min(group.firstTimestamp, timestamp);
      }

      const blockNumber = packet.blockNumber !== undefined ? Number(packet.blockNumber) : null;
      if (Number.isFinite(blockNumber) && (group.lastBlock === null || blockNumber > group.lastBlock)) {
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
      const chainDisplay =
        this.getChainDisplayLabel(group.localEid) || group.localEid || "—";
      const address = group.address || (group.oappId.split("_")[1] ?? "—");
      const eids = Array.from(group.eids).sort();

      const chainCell = this.createFormattedCell(
        [chainDisplay, `Local EID ${group.localEid || "—"}`],
        group.localEid,
      );

      const oappCell = this.formatOAppIdCell(group.oappId);
      const addressCell = this.createFormattedCell([address], address);

      const eidLines = [`Count ${eids.length}`];
      const eidCopyValue = eids.join(", ");
      const eidCell = this.createFormattedCell(
        eidLines,
        eidCopyValue || `Count ${eids.length}`,
      );

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
        "Unique EIDs": eidCell,
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
    return rows.map((row) => this.formatSecurityConfigRow(row, meta));
  }

  formatSecurityConfigRow(row, meta) {
    const formatted = {};
    formatted["Source EID"] = String(row.eid ?? "—");
    formatted.Library = this.formatLibraryDescriptor(row);
    formatted["Required DVNs"] = this.formatRequiredDvns(row, meta);
    formatted["Optional DVNs"] = this.formatOptionalDvns(row, meta);
    formatted.Peer = this.formatPeer(row);
    formatted["Peer Updated"] = this.formatPeerUpdate(row);
    formatted.Confirmations = this.formatConfirmations(row);
    formatted.Fallbacks = this.formatFallbackFields(
      row.fallbackFields,
      row.usesDefaultConfig,
    );
    formatted["Last Update"] = this.formatLastComputed(row);

    return formatted;
  }

  formatLibraryDescriptor(row) {
    const address = row.effectiveReceiveLibrary || "—";
    const statusBits = [];
    statusBits.push(row.isConfigTracked ? "tracked" : "untracked");
    if (row.usesDefaultLibrary) {
      statusBits.push("default");
    }
    if (!row.usesDefaultLibrary && row.libraryOverrideVersionId) {
      statusBits.push("override");
    }

    const lines = [address];
    if (statusBits.length) {
      lines.push(statusBits.join(" • "));
    }

    return this.createFormattedCell(lines, address);
  }

  formatRequiredDvns(row, meta) {
    if (row.usesRequiredDVNSentinel) {
      return this.createFormattedCell(["optional-only (sentinel)"]);
    }
    return this.formatDvnSet(
      row.effectiveRequiredDVNs,
      row.effectiveRequiredDVNCount,
      meta,
      row.localEid,
    );
  }

  formatOptionalDvns(row, meta) {
    const count = row.effectiveOptionalDVNCount ?? 0;
    const threshold = row.effectiveOptionalDVNThreshold ?? "—";
    return this.formatDvnSet(
      row.effectiveOptionalDVNs,
      count,
      meta,
      row.localEid,
      [`Threshold ${threshold}`]
    );
  }

  formatDvnSet(addresses, count, meta, localEid, extraLines = []) {
    const addrs = Array.isArray(addresses) ? addresses.filter(Boolean) : [];
    const lines = [`Count ${count ?? addrs.length ?? 0}`, ...extraLines];
    if (addrs.length) {
      lines.push(
        ...this.resolveDvnLabels(
          addrs,
          meta,
          localEid ?? meta?.localEid ?? meta?.eid,
        ),
      );
    }
    return this.createFormattedCell(lines, addrs.join(", ") || String(count));
  }

  derivePeerContext(row) {
    const peerHex = row.peer;
    if (!peerHex) {
      return null;
    }

    const eid = row.eid ?? null;
    const localEid =
      eid !== null && eid !== undefined ? String(eid) : null;
    const endpointLabel =
      localEid !== null
        ? this.getChainDisplayLabel(localEid) || `EID ${localEid}`
        : null;

    let decodedAddress = bytes32ToAddress(peerHex);
    let oappId = null;
    let alias = null;
    let normalizedAddress = null;

    if (decodedAddress && localEid) {
      try {
        normalizedAddress = normalizeAddress(decodedAddress);
        oappId = makeOAppId(localEid, normalizedAddress);
        alias = this.aliasManager.get(oappId);
      } catch (error) {
        console.debug("[QueryManager] Failed to normalize peer address", {
          peerHex,
          decodedAddress,
          error,
        });
        normalizedAddress = decodedAddress;
        oappId = localEid ? makeOAppId(localEid, decodedAddress) : null;
      }
    }

    return {
      peerHex,
      localEid,
      endpointLabel,
      address: normalizedAddress || decodedAddress,
      oappId,
      alias,
      copyValue: oappId || peerHex,
    };
  }

  formatPeer(row) {
    const ctx = this.derivePeerContext(row);
    if (!ctx) {
      return this.createFormattedCell(["—"], "");
    }

    const lines = [];
    if (ctx.alias) {
      lines.push(ctx.alias);
    }
    if (ctx.oappId) {
      lines.push(`ID ${ctx.oappId}`);
      if (ctx.address) {
        lines.push(`Addr ${ctx.address}`);
      }
    } else {
      lines.push(ctx.peerHex);
    }

    if (ctx.endpointLabel) {
      lines.push(ctx.endpointLabel);
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
    const confirmations = row.effectiveConfirmations ?? "—";
    const lines = [String(confirmations)];
    const status = [];
    if (row.usesDefaultConfig) {
      status.push("default config");
    }
    if (status.length) {
      lines.push(status.join(" • "));
    }

    return this.createFormattedCell(lines, String(confirmations));
  }

  formatFallbackFields(fields, usesDefaultConfig) {
    const names = Array.isArray(fields) ? fields : [];
    if (!names.length) {
      if (usesDefaultConfig) {
        return this.createFormattedCell(["default"], "default");
      }
      return this.createFormattedCell(["—"], "");
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
    return this.createFormattedCell(lines, names.join(", "));
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
      const truncated = hashStr.length > 20
        ? `${hashStr.slice(0, 10)}…${hashStr.slice(-6)}`
        : hashStr;
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

    const buildResult = config.buildVariables?.(card) ?? {};
    const variables =
      Object.prototype.hasOwnProperty.call(buildResult, "variables") &&
      buildResult.variables
        ? buildResult.variables
        : buildResult.variables === null
          ? {}
          : buildResult;
    const extraMeta =
      Object.prototype.hasOwnProperty.call(buildResult, "meta") &&
      buildResult.meta
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
        const { SecurityWebCrawler } = await import("./crawler.js");
        this.setStatus(statusEl, "Crawling...", "loading");
        const crawler = new SecurityWebCrawler(
          this.client,
          this.chainMetadata,
        );
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
        const result =
          (await config.processResponse(payload, { ...baseMeta })) || {};
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

  reprocessLastResults() {
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

    if (typeof config.processResponse === "function") {
      const result =
        config.processResponse(this.lastPayload, { ...baseMeta }) || {};
      rows = Array.isArray(result.rows) ? result.rows : [];
      if (result.meta && typeof result.meta === "object") {
        finalMeta = { ...baseMeta, ...result.meta };
      }
    } else if (typeof config.extractRows === "function") {
      rows = config.extractRows(this.lastPayload.data) ?? [];
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
export class ToastManager {
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
    }, CONFIG.UI.TOAST_DURATION);

    this.timers.push(timeout);
    if (this.timers.length > CONFIG.UI.MAX_TOASTS) {
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
export class ResultsRenderer {
  constructor(
    resultsTitle,
    resultsMeta,
    resultsBody,
    copyJsonButton,
    chainMetadata,
    aliasManager,
    toastManager,
  ) {
    this.resultsTitle = resultsTitle;
    this.resultsMeta = resultsMeta;
    this.resultsBody = resultsBody;
    this.copyJsonButton = copyJsonButton;
    this.chainMetadata = chainMetadata;
    this.aliasManager = aliasManager;
    this.toastManager = toastManager;
    this.lastRender = null;
    this.copyFeedbackTimers = new WeakMap();
  }

  render(rows, payload, meta) {
    const metaSnapshot = { ...meta };
    this.lastRender = { rows, payload, meta: metaSnapshot };

    this.copyJsonButton.disabled =
      metaSnapshot.renderMode === "graph" ? false : rows.length === 0;
    this.copyJsonButton.textContent =
      metaSnapshot.renderMode === "graph" ? "Download JSON" : "Copy JSON";

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

  async renderGraph(webData) {
    this.resultsBody.classList.remove("empty");
    this.resultsBody.innerHTML = "";

    const { SecurityGraphRenderer } = await import("./graph.js");
    const renderer = new SecurityGraphRenderer(
      (oappId) => this.aliasManager.get(oappId),
      (chainId) => this.getChainDisplayLabel(chainId),
    );

    const graphContainer = renderer.render(webData);
    this.resultsBody.appendChild(graphContainer);
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
    const { nodes, copyValue, isCopyable, meta } = this.interpretValue(
      column,
      value,
    );

    if (!isCopyable) {
      const fragment = document.createDocumentFragment();
      nodes.forEach((node) => fragment.append(node));
      return fragment;
    }

    const container = document.createElement("div");
    container.className = "copyable";

    const content =
      copyValue ?? nodes.map((node) => node.textContent ?? "").join(" ").trim();
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
        const content =
          line === null || line === undefined || line === "" ? " " : String(line);
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

    if (meta.oappInfo) {
      return this.renderOAppSummary(meta);
    }
    if (meta.popularOappsSummary) {
      return this.renderPopularOappsSummary(meta.popularOappsSummary);
    }
    return null;
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

    const alias = this.aliasManager.get(info.id);
    if (alias) {
      this.appendSummaryRow(list, "OApp Alias", alias);
    }
    this.appendSummaryRow(list, "OApp ID", info.id ?? "");
    const localEid =
      info.localEid !== undefined && info.localEid !== null
        ? String(info.localEid)
        : "—";
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
    if (value === undefined || value === null || value === "") {
      return;
    }
    const dt = document.createElement("dt");
    dt.textContent = label;
    list.appendChild(dt);

    const dd = document.createElement("dd");
    dd.textContent = String(value);
    list.appendChild(dd);
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

  getChainDisplayLabel(chainId) {
    if (!chainId && chainId !== 0) {
      return "";
    }

    const key = String(chainId);
    const chainInfo = this.chainMetadata.getChainInfo(key, "native");
    if (chainInfo) {
      return `${chainInfo.primary} (${key})`;
    }

    return key;
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
      this.toastManager.show("Copied", "success");
    } catch (error) {
      console.error("Copy failed", error);
      this.flashCopyFeedback(target, false);
      this.toastManager.show("Copy failed", "error");
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
      didSucceed ? CONFIG.UI.COPY_FEEDBACK_DURATION : CONFIG.UI.COPY_FEEDBACK_DURATION + 400,
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

    const source =
      this.lastRender?.payload?.data ?? this.lastRender?.rows ?? [];
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
    }, CONFIG.UI.BUTTON_FEEDBACK_DURATION);
  }
}
