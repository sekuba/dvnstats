/**
 * Manages queries and their execution
 */

import { APP_CONFIG } from "../../config.js";
import {
  clampInteger,
  formatTimestampValue,
  isZeroAddress,
  normalizeAddress,
  normalizeOAppId,
  parseOptionalPositiveInt,
  splitOAppId,
  resolveChainDisplayLabel,
} from "../../core.js";
import { resolveOAppSecurityConfigs } from "../../resolver.js";
import { TOP_OAPPS_QUERY } from "../../queries/topOApps.js";
import { OAPP_SECURITY_CONFIG_QUERY } from "../../queries/oappSecurityConfig.js";
import { POPULAR_OAPPS_WINDOW_QUERY } from "../../queries/popularOAppsWindow.js";
import {
  createFormattedCell,
  formatUpdateInfo,
  formatRouteActivityLine,
} from "../../formatters/cellFormatters.js";

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
  }

  getChainDisplayLabel(chainId) {
    return resolveChainDisplayLabel(this.chainMetadata, chainId);
  }

  formatOAppIdCell(oappId) {
    if (!oappId) {
      return createFormattedCell(["—"], "");
    }
    const alias = this.aliasStore.get(oappId);
    const lines = alias ? [alias, `ID ${oappId}`] : [oappId];
    return createFormattedCell(lines, oappId, { oappId });
  }

  resolveDvnLabels(addresses, meta, localEidOverride) {
    if (!Array.isArray(addresses) || !addresses.length) {
      return [];
    }

    const normalizedAddresses = addresses.filter(Boolean);
    if (!normalizedAddresses.length) {
      return [];
    }

    const candidateLocal =
      localEidOverride !== undefined && localEidOverride !== null
        ? localEidOverride
        : (meta?.localEid ?? meta?.eid ?? null);

    const localKey =
      candidateLocal !== undefined && candidateLocal !== null && candidateLocal !== ""
        ? String(candidateLocal)
        : "";

    const context = localKey ? { localEid: localKey } : {};
    return this.chainMetadata.resolveDvnNames(normalizedAddresses, context);
  }

  buildQueryRegistry() {
    if (this.registry) {
      return this.registry;
    }

    // Each buildVariables implementation must return { variables, meta? } to keep runQuery simple.
    this.registry = {
      "top-oapps": {
        label: "Top OApps",
        description: "Ordered by total packets received",
        query: TOP_OAPPS_QUERY,
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
              localEid: createFormattedCell([chainDisplay], row.localEid),
            };
          }),
      },

      "oapp-security-config": {
        label: "OApp Security Config",
        description: "Resolve the current security posture for a single OApp",
        query: OAPP_SECURITY_CONFIG_QUERY,
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
            variables: { oappId, localEid },
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
          const defaultReceiveLibraries = payload?.data?.DefaultReceiveLibrary ?? [];
          const defaultUlnConfigs = payload?.data?.DefaultUlnConfig ?? [];
          const oappReceiveLibraries = payload?.data?.OAppReceiveLibrary ?? [];
          const oappUlnConfigs = payload?.data?.OAppUlnConfig ?? [];
          const enrichedMeta = { ...meta };

          if (oapp) {
            const localEid = String(oapp.localEid ?? "");
            const chainDisplay =
              this.getChainDisplayLabel(localEid) || enrichedMeta.chainLabel || `EID ${localEid}`;
            enrichedMeta.oappInfo = oapp;
            enrichedMeta.oappAddress = oapp.address;
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
          const queryVars = meta?.variables ?? {};
          const derivedLocalEid =
            enrichedMeta.localEid ||
            (queryVars.localEid !== undefined ? String(queryVars.localEid) : null) ||
            (oapp && oapp.localEid !== undefined && oapp.localEid !== null
              ? String(oapp.localEid)
              : null);
          const resolvedOappId = queryVars.oappId || oapp?.id || enrichedMeta.oappInfo?.id || null;
          const resolvedAddress =
            oapp?.address || enrichedMeta.oappAddress || meta?.oappAddress || "";

          let resolvedRows = configs;
          if (resolvedOappId && derivedLocalEid) {
            const resolution = resolveOAppSecurityConfigs({
              oappId: resolvedOappId,
              localEid: derivedLocalEid,
              oappAddress: resolvedAddress,
              securityConfigs: configs,
              defaultReceiveLibraries,
              defaultUlnConfigs,
              oappPeers: peers,
              oappReceiveLibraries,
              oappUlnConfigs,
              routeStats,
            });
            resolvedRows = resolution.rows;
            enrichedMeta.securitySummary = resolution.summary;
          }

          const formattedRows = this.formatSecurityConfigRows(resolvedRows, enrichedMeta);

          return { rows: formattedRows, meta: enrichedMeta };
        },
      },

      "popular-oapps-window": {
        label: "Hot OApps",
        description: "Rank OApps by packets in a configurable time window",
        query: POPULAR_OAPPS_WINDOW_QUERY,
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

      const chainCell = createFormattedCell([chainDisplay], group.localEid);

      const oappCell = this.formatOAppIdCell(group.oappId);
      const addressCell = createFormattedCell([address], address);

      const eidLines = [`Count ${eids.length}`];
      const eidCopyValue = eids.join(", ");
      const eidCell = createFormattedCell(eidLines, eidCopyValue || `Count ${eids.length}`);

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
      const lastCell = createFormattedCell(
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
    const activityData = this.prepareRouteActivity(meta);

    const decorated = rows.map((row) => {
      const blockingReasons = this.identifyBlockingReasons(row, meta);
      const routeActivity = this.getRouteActivityForRow(row, activityData);
      return { row, blockingReasons, activity: routeActivity };
    });

    const nonBlocked = [];
    const blocked = [];

    decorated.forEach((entry) => {
      if (entry.blockingReasons.length === 0) {
        nonBlocked.push(entry);
      } else {
        blocked.push(entry);
      }
    });

    const requiredDvnValues = new Map();
    const optionalDvnValues = new Map();
    const fallbackValues = new Map();

    const nonBlockedWithKeys = nonBlocked.map((entry) => {
      const keys = this.buildHighlightKeys(entry.row);
      requiredDvnValues.set(keys.reqKey, (requiredDvnValues.get(keys.reqKey) || 0) + 1);
      optionalDvnValues.set(keys.optKey, (optionalDvnValues.get(keys.optKey) || 0) + 1);
      fallbackValues.set(keys.fallbackKey, (fallbackValues.get(keys.fallbackKey) || 0) + 1);
      return { ...entry, keys };
    });

    const mostCommonRequired = this.findMostCommon(requiredDvnValues);
    const mostCommonOptional = this.findMostCommon(optionalDvnValues);
    const mostCommonFallback = this.findMostCommon(fallbackValues);

    const formatted = [];

    nonBlockedWithKeys
      .sort((a, b) => {
        const aCount = a.activity.count;
        const bCount = b.activity.count;
        if (aCount !== bCount) {
          return bCount - aCount;
        }
        const aEid = this.bigIntSafe(a.row.eid);
        const bEid = this.bigIntSafe(b.row.eid);
        if (aEid !== null && bEid !== null) {
          return aEid < bEid ? -1 : aEid > bEid ? 1 : 0;
        }
        return String(a.row.eid).localeCompare(String(b.row.eid));
      })
      .forEach(({ row, keys, activity }) => {
        const highlightRequired =
          mostCommonRequired && keys.reqKey !== mostCommonRequired && mostCommonRequired !== null;
        const highlightOptional =
          mostCommonOptional && keys.optKey !== mostCommonOptional && mostCommonOptional !== null;
        const highlightFallback =
          mostCommonFallback &&
          keys.fallbackKey !== mostCommonFallback &&
          mostCommonFallback !== null;

        formatted.push(
          this.formatSecurityConfigRow(row, meta, {
            highlightRequired,
            highlightOptional,
            highlightFallback,
            routeActivity: activity,
            highlightColumns: new Set(),
          }),
        );
      });

    const BLOCK_PRIORITY = [
      "peer-zero-explicit",
      "peer-zero-implicit",
      "required-dead-address",
      "required-dead-lz",
      "default-library-zero",
    ];

    blocked
      .map((entry) => {
        const priorityIndex = entry.blockingReasons.length
          ? BLOCK_PRIORITY.findIndex((type) =>
              entry.blockingReasons.some((reason) => reason.type === type),
            )
          : BLOCK_PRIORITY.length;
        return {
          ...entry,
          priorityIndex: priorityIndex === -1 ? BLOCK_PRIORITY.length : priorityIndex,
        };
      })
      .sort((a, b) => {
        if (a.priorityIndex !== b.priorityIndex) {
          return a.priorityIndex - b.priorityIndex;
        }
        if (a.activity.count !== b.activity.count) {
          return b.activity.count - a.activity.count;
        }
        if (a.blockingReasons.length !== b.blockingReasons.length) {
          return a.blockingReasons.length - b.blockingReasons.length;
        }
        const aEid = this.bigIntSafe(a.row.eid);
        const bEid = this.bigIntSafe(b.row.eid);
        if (aEid !== null && bEid !== null) {
          return aEid < bEid ? -1 : aEid > bEid ? 1 : 0;
        }
        return String(a.row.eid).localeCompare(String(b.row.eid));
      })
      .forEach(({ row, blockingReasons, activity }) => {
        const highlightColumns = new Set(
          blockingReasons.map((reason) => reason.column).filter(Boolean),
        );
        formatted.push(
          this.formatSecurityConfigRow(row, meta, {
            highlightRequired: false,
            highlightOptional: false,
            highlightFallback: false,
            routeActivity: activity,
            highlightColumns,
          }),
        );
      });

    return formatted;
  }

  buildHighlightKeys(row) {
    return {
      reqKey: row.usesRequiredDVNSentinel
        ? "sentinel"
        : JSON.stringify(row.effectiveRequiredDVNs || []),
      optKey: JSON.stringify({
        dvns: row.effectiveOptionalDVNs || [],
        threshold: row.effectiveOptionalDVNThreshold,
      }),
      fallbackKey: JSON.stringify(row.fallbackFields || []),
    };
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

  bigIntSafe(value) {
    try {
      return value !== undefined && value !== null ? BigInt(value) : null;
    } catch (error) {
      return null;
    }
  }

  coerceToNumber(value) {
    if (value === null || value === undefined) {
      return 0;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === "bigint") {
      return Number(value);
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  prepareRouteActivity(meta) {
    const stats = Array.isArray(meta?.routeStats) ? meta.routeStats : [];
    const map = new Map();
    let summed = 0;

    stats.forEach((stat) => {
      const key = stat?.srcEid ?? stat?.eid;
      if (key === undefined || key === null) {
        return;
      }
      const normalizedKey = String(key);
      const count = this.coerceToNumber(stat?.packetCount);
      map.set(normalizedKey, {
        count,
        raw: stat,
      });
      summed += count;
    });

    let totalPackets = this.coerceToNumber(meta?.oappInfo?.totalPacketsReceived);
    if (!(totalPackets > 0)) {
      totalPackets = summed;
    }

    return {
      map,
      totalPackets,
    };
  }

  getRouteActivityForRow(row, activityData) {
    const key = row?.eid ?? null;
    const normalizedKey = key === null || key === undefined ? null : String(key);
    const entry = normalizedKey ? activityData.map.get(normalizedKey) : undefined;
    const count = entry?.count ?? 0;
    const totalPackets = activityData.totalPackets > 0 ? activityData.totalPackets : 0;
    const percentOfTotal = totalPackets > 0 ? count / totalPackets : 0;

    return {
      count,
      percentOfTotal,
      raw: entry?.raw ?? null,
      totalPackets,
    };
  }


  identifyBlockingReasons(row, meta) {
    const reasons = [];
    const seenTypes = new Set();

    const peerMap = meta?.peerMap instanceof Map ? meta.peerMap : null;
    let peerState = row.peerStateHint || null;
    if (!peerState) {
      const peerRecord = peerMap?.get(String(row.eid));
      const isZeroPeer = isZeroAddress(row.peer);
      if (peerRecord) {
        if (isZeroPeer && !peerRecord.fromPacketDelivered) {
          peerState = "explicitly-blocked";
        } else if (peerRecord.fromPacketDelivered) {
          peerState = "auto-discovered";
        } else {
          peerState = "explicitly-set";
        }
      } else if (isZeroPeer) {
        peerState = "explicitly-blocked";
      }
    }

    if (peerState === "explicit-blocked" || peerState === "explicitly-blocked") {
      reasons.push({
        type: "peer-zero-explicit",
        label: "Peer blocked (explicit zero address)",
        column: "Peer",
      });
      seenTypes.add("peer-zero-explicit");
    } else if (peerState === "implicit-blocked") {
      reasons.push({
        type: "peer-zero-implicit",
        label: "Peer assumed blocked (no peer configured)",
        column: "Peer",
      });
      seenTypes.add("peer-zero-implicit");
    }

    const requiredDvns = Array.isArray(row.effectiveRequiredDVNs) ? row.effectiveRequiredDVNs : [];
    const normalizedRequired = requiredDvns
      .map((addr) => String(addr || "").toLowerCase())
      .filter(Boolean);
    const deadAddress = APP_CONFIG.ADDRESSES.DEAD.toLowerCase();

    if (normalizedRequired.includes(deadAddress) && !seenTypes.has("required-dead-address")) {
      reasons.push({
        type: "required-dead-address",
        label: "Required DVN includes 0x…dead sentinel",
        column: "Required DVNs",
      });
      seenTypes.add("required-dead-address");
    }

    if (requiredDvns.length > 0) {
      const contextLocalEid =
        row.localEid ??
        meta?.localEid ??
        (meta?.oappInfo && meta.oappInfo.localEid !== undefined ? meta.oappInfo.localEid : null);
      const resolvedNames = this.chainMetadata.resolveDvnNames(requiredDvns, {
        localEid: contextLocalEid ?? undefined,
      });
      const hasDeadDvnName = resolvedNames.some((name) =>
        typeof name === "string" ? name.toLowerCase().includes("lzdead") : false,
      );
      if (hasDeadDvnName && !seenTypes.has("required-dead-lz")) {
        reasons.push({
          type: "required-dead-lz",
          label: "Required DVN tagged as LZDeadDVN",
          column: "Required DVNs",
        });
        seenTypes.add("required-dead-lz");
      }
    }

    const libraryStatus = row.libraryStatus || "unknown";
    const noLibraryConfigured = !row.effectiveReceiveLibrary;
    const usesDefaultLibrary = row.usesDefaultLibrary !== false;
    const fallbackFields = Array.isArray(row.fallbackFields) ? row.fallbackFields : [];
    const defaultLibraryFallback = fallbackFields.includes("receiveLibrary");

    if (
      noLibraryConfigured &&
      (libraryStatus === "none" || usesDefaultLibrary || defaultLibraryFallback) &&
      !seenTypes.has("default-library-zero")
    ) {
      reasons.push({
        type: "default-library-zero",
        label: "Falling back to zero receive library (route disabled)",
        column: "Library",
      });
      seenTypes.add("default-library-zero");
    }

    return reasons;
  }

  formatSecurityConfigRow(
    row,
    meta,
    {
      highlightRequired = false,
      highlightOptional = false,
      highlightFallback = false,
      routeActivity = null,
      highlightColumns = new Set(),
    } = {},
  ) {
    const formatted = {};
    const chainDisplay = this.getChainDisplayLabel(row.eid) || row.eid || "—";
    formatted["Source EID"] = createFormattedCell([chainDisplay], row.eid);
    formatted.Library = this.formatLibraryDescriptor(row, highlightColumns.has("Library"));

    // Required DVNs with highlighting
    formatted["Required DVNs"] = this.formatRequiredDvns(
      row,
      meta,
      highlightRequired || highlightColumns.has("Required DVNs"),
    );

    // Optional DVNs with highlighting
    formatted["Optional DVNs"] = this.formatOptionalDvns(row, meta, highlightOptional);

    formatted.Peer = this.formatPeer(
      row,
      meta.peerMap,
      highlightColumns.has("Peer"),
      routeActivity,
    );
    formatted["Peer Updated"] = this.formatPeerUpdate(row);
    formatted.Confirmations = this.formatConfirmations(row);

    // Fallbacks with highlighting
    formatted.Fallbacks = this.formatFallbackFields(
      row.fallbackFields,
      row.usesDefaultConfig,
      row.libraryStatus,
      highlightFallback || highlightColumns.has("Fallbacks"),
    );

    formatted["Last Update"] = this.formatLastComputed(row);

    return formatted;
  }

  formatLibraryDescriptor(row, highlight = false) {
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

    return createFormattedCell(lines, address, { highlight });
  }

  formatRequiredDvns(row, meta, highlight = false) {
    // If no library configured, ULN config is unavailable
    if (row.libraryStatus === "none" || row.libraryStatus === "unsupported") {
      return createFormattedCell(["—", "No ULN config"], "", { highlight });
    }

    if (row.usesRequiredDVNSentinel) {
      return createFormattedCell(
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
      return createFormattedCell(["—", "No ULN config"], "", { highlight });
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
    return createFormattedCell(lines, addrs.join(", ") || String(count), { highlight });
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

  formatPeer(row, peerMap, highlight = false, routeActivity = null) {
    const ctx = this.derivePeerContext(row);
    const peerData = peerMap?.get(String(row.eid));
    const isZeroPeer = isZeroAddress(row.peer);

    let peerState = row.peerStateHint || null;
    if (!peerState) {
      if (peerData) {
        if (isZeroPeer && !peerData.fromPacketDelivered) {
          peerState = "explicitly-blocked";
        } else if (peerData.fromPacketDelivered) {
          peerState = "auto-discovered";
        } else {
          peerState = "explicitly-set";
        }
      } else if (isZeroPeer) {
        peerState = "explicitly-blocked";
      } else {
        peerState = "not-configured";
      }
    }

    if (peerState === "explicit") {
      peerState = "explicitly-set";
    }

    const lines = [];
    const stateLabels = {
      "not-configured": "Not configured",
      "auto-discovered": "Auto-discovered",
      "explicitly-set": "",
      "explicitly-blocked": "BLOCKED (zero address)",
      "implicit-blocked": "Assumed blocked (no peer configured)",
    };
    const primaryLabel = stateLabels[peerState] ?? peerState;
    if (primaryLabel) {
      lines.push(primaryLabel);
    }

    const isBlocked = peerState === "explicitly-blocked" || peerState === "implicit-blocked";
    if (peerState === "implicit-blocked") {
      lines.push("LayerZero default; some OApps may still accept traffic.");
    }

    let meterPercent = null;
    if (routeActivity) {
      meterPercent = Math.max(0, Math.min(1, routeActivity.percentOfTotal || 0));
      if (routeActivity.count > 0) {
        lines.push(formatRouteActivityLine(routeActivity));
      } else if (routeActivity.totalPackets > 0) {
        lines.push("0 packets (0%)");
      }
    }

    if (isBlocked) {
      const meta =
        meterPercent && meterPercent > 0 ? { highlight: true, meterPercent } : { highlight: true };
      return createFormattedCell(lines, "0x0", meta);
    }

    if (!ctx) {
      const meta = meterPercent && meterPercent > 0 ? { highlight, meterPercent } : { highlight };
      return createFormattedCell(lines, "", meta);
    }

    if (ctx.alias) {
      lines.push(ctx.alias);
    }
    if (ctx.oappId) {
      lines.push(ctx.oappId);
    } else if (ctx.peerHex) {
      lines.push(ctx.peerHex);
    }

    let meta =
      ctx.oappId || ctx.localEid
        ? {
            oappId: ctx.oappId ?? undefined,
            localEid: ctx.localEid ?? undefined,
            highlight,
          }
        : { highlight };
    if (meterPercent && meterPercent > 0) {
      meta = { ...meta, meterPercent };
    }
    return createFormattedCell(lines, ctx.copyValue, meta);
  }

  formatPeerUpdate(row) {
    return formatUpdateInfo({
      block: row.peerLastUpdatedBlock,
      timestamp: row.peerLastUpdatedTimestamp,
      eventId: row.peerLastUpdatedEventId,
      txHash: row.peerTransactionHash,
    });
  }

  formatConfirmations(row) {
    // If no library configured, ULN config is unavailable
    if (row.libraryStatus === "none" || row.libraryStatus === "unsupported") {
      return createFormattedCell(["—", "No ULN config"], "");
    }

    const confirmations = row.effectiveConfirmations ?? "—";
    const lines = [];

    // Check for sentinel value (2^64-1 = 18446744073709551615)
    const CONFIRMATIONS_SENTINEL = APP_CONFIG.SENTINEL_VALUES.CONFIRMATIONS_SENTINEL;
    if (String(confirmations) === CONFIRMATIONS_SENTINEL) {
      lines.push("SENTINEL: 0 confirmations");
      lines.push("Instant finality mode");
    } else {
      lines.push(String(confirmations));
    }

    return createFormattedCell(lines, String(confirmations));
  }

  formatFallbackFields(fields, usesDefaultConfig, libraryStatus, highlight = false) {
    // If no library configured, show N/A
    if (libraryStatus === "none" || libraryStatus === "unsupported") {
      return createFormattedCell(["—", "No ULN config"], "", { highlight });
    }

    const names = Array.isArray(fields) ? fields : [];
    if (!names.length) {
      if (usesDefaultConfig) {
        return createFormattedCell(["All from default"], "default", { highlight });
      }
      return createFormattedCell(["None (fully custom)"], "", { highlight });
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
    return createFormattedCell(lines, names.join(", "), { highlight });
  }

  formatLastComputed(row) {
    return formatUpdateInfo({
      block: row.lastComputedBlock,
      timestamp: row.lastComputedTimestamp,
      eventId: row.lastComputedByEventId,
      txHash: row.lastComputedTransactionHash,
    });
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

    const buildResult =
      typeof config.buildVariables === "function" ? config.buildVariables(card) : {};
    if (!buildResult || typeof buildResult !== "object") {
      throw new Error("Query builder must return an object with `variables` and optional `meta`.");
    }
    const { variables, meta: extraMeta = {} } = buildResult;

    if (!variables || Object.keys(variables).length === 0) {
      throw new Error("Missing query input.");
    }

    const startedAt = performance.now();

    try {
      let payload;

      // Handle web-of-security crawler
      if (variables.isCrawl) {
        const { SecurityGraphCrawler } = await import("../../crawler.js");
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
