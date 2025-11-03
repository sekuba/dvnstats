import { isZeroAddress, normalizeKey } from "./core.js";
import { getTrackedReceiveLibrary } from "./trackedLibraries.js";
import { APP_CONFIG } from "./config.js";

const SYNTHETIC_ID_PREFIX = "synthetic:";

const FALLBACK_FIELD_ORDER = [
  "receiveLibrary",
  "confirmations",
  "requiredDVNCount",
  "requiredDVNs",
  "optionalDVNCount",
  "optionalDVNs",
  "optionalDVNThreshold",
];

const REQUIRED_DVN_SENTINEL = APP_CONFIG.SENTINEL_VALUES.REQUIRED_DVN_SENTINEL;

export function resolveOAppSecurityConfigs({
  oappId,
  localEid,
  oappAddress,
  securityConfigs = [],
  defaultReceiveLibraries = [],
  defaultUlnConfigs = [],
  oappPeers = [],
  oappReceiveLibraries = [],
  oappUlnConfigs = [],
  routeStats = [],
}) {
  const trackedReceiveLibrary = getTrackedReceiveLibrary(localEid);
  const securityByEid = buildMap(securityConfigs, (row) => normalizeKey(row.eid));
  const peerByEid = buildMap(oappPeers, (row) => normalizeKey(row.eid));
  const defaultLibraryByEid = buildMap(defaultReceiveLibraries, (row) => normalizeKey(row.eid));
  const defaultConfigByEid = buildMap(defaultUlnConfigs, (row) => normalizeKey(row.eid));
  const libraryOverrideByEid = buildMap(oappReceiveLibraries, (row) => normalizeKey(row.eid));
  const configOverrideByEid = buildMap(oappUlnConfigs, (row) => normalizeKey(row.eid));
  const routeStatsEids = new Set(routeStats.map((row) => normalizeKey(row.srcEid || row.eid)));

  const candidateEids = new Set([
    ...securityByEid.keys(),
    ...peerByEid.keys(),
    ...defaultLibraryByEid.keys(),
    ...defaultConfigByEid.keys(),
    ...libraryOverrideByEid.keys(),
    ...configOverrideByEid.keys(),
    ...routeStatsEids.values(),
  ]);

  const resolvedRows = [];
  let syntheticCount = 0;
  let implicitBlocks = 0;
  let explicitBlocks = 0;

  for (const eid of candidateEids) {
    if (!eid) continue;

    const existing = securityByEid.get(eid);
    if (existing) {
      const peerRecord = peerByEid.get(eid);
      const peerStateHint = derivePeerStateHint(existing, peerRecord, false);
      const enriched = {
        ...existing,
        sourceType: "materialized",
        synthetic: false,
        peerStateHint,
      };
      if (peerStateHint === "explicit-blocked") {
        explicitBlocks += 1;
      } else if (peerStateHint === "implicit-blocked") {
        implicitBlocks += 1;
      }
      resolvedRows.push(enriched);
      continue;
    }

    const defaultLibrary = defaultLibraryByEid.get(eid);
    const defaultConfig = defaultConfigByEid.get(eid);
    const overrideLibrary = libraryOverrideByEid.get(eid);
    const overrideConfig = configOverrideByEid.get(eid);
    const peerRecord = peerByEid.get(eid);

    const syntheticRow = buildSyntheticRow({
      eid,
      localEid,
      oappId,
      oappAddress,
      trackedReceiveLibrary,
      defaultLibrary,
      defaultConfig,
      overrideLibrary,
      overrideConfig,
      peerRecord,
    });

    if (!syntheticRow) {
      continue;
    }

    syntheticCount += 1;
    if (syntheticRow.peerStateHint === "implicit-blocked") {
      implicitBlocks += 1;
    } else if (syntheticRow.peerStateHint === "explicit-blocked") {
      explicitBlocks += 1;
    }

    resolvedRows.push(syntheticRow);
  }

  resolvedRows.sort((a, b) => {
    const aEid = BigIntSafe(a.eid);
    const bEid = BigIntSafe(b.eid);
    if (aEid !== null && bEid !== null) {
      return aEid < bEid ? -1 : aEid > bEid ? 1 : 0;
    }
    return String(a.eid).localeCompare(String(b.eid));
  });

  return {
    rows: resolvedRows,
    summary: {
      totalRoutes: resolvedRows.length,
      syntheticCount,
      implicitBlocks,
      explicitBlocks,
    },
  };
}

function buildSyntheticRow({
  eid,
  localEid,
  oappId,
  oappAddress,
  trackedReceiveLibrary,
  defaultLibrary,
  defaultConfig,
  overrideLibrary,
  overrideConfig,
  peerRecord,
}) {
  const fallbackFields = new Set();
  const effectiveLocalEid = toString(localEid);
  const normalizedEid = normalizeKey(eid);
  const syntheticId = `${SYNTHETIC_ID_PREFIX}${oappId}_${normalizedEid}`;

  // Determine effective library
  const defaultLibraryAddress = normalizeAddressSafe(defaultLibrary?.library);
  const overrideLibraryAddress = normalizeAddressSafe(overrideLibrary?.library);
  const effectiveReceiveLibrary =
    overrideLibraryAddress && !isZeroAddress(overrideLibraryAddress)
      ? overrideLibraryAddress
      : defaultLibraryAddress && !isZeroAddress(defaultLibraryAddress)
        ? defaultLibraryAddress
        : null;

  let libraryStatus = "none";
  let isConfigTracked = false;
  let usesDefaultLibrary = true;
  if (effectiveReceiveLibrary) {
    if (trackedReceiveLibrary && effectiveReceiveLibrary === trackedReceiveLibrary) {
      libraryStatus = "tracked";
      isConfigTracked = true;
    } else {
      libraryStatus = "unsupported";
    }
  }

  if (overrideLibraryAddress && !isZeroAddress(overrideLibraryAddress)) {
    usesDefaultLibrary = false;
  } else if (effectiveReceiveLibrary) {
    fallbackFields.add("receiveLibrary");
  }

  // Determine effective config (only when tracked)
  const overrideCfg = normalizeConfig(overrideConfig);
  const defaultCfg = normalizeConfig(defaultConfig);
  const { effectiveConfig, usesDefaultConfig, usesRequiredDVNSentinel } = resolveConfig({
    isConfigTracked,
    defaultCfg,
    overrideCfg,
    fallbackFields,
  });

  // Peer interpretation
  let peer = peerRecord?.peer ?? null;
  let peerOappId = peerRecord?.peerOappId ?? null;
  let peerStateHint;

  if (!peerRecord) {
    peer = APP_CONFIG.ADDRESSES.ZERO;
    peerStateHint = "implicit-blocked";
  } else if (isZeroAddress(peer)) {
    peerStateHint = "explicit-blocked";
  } else if (peerRecord.fromPacketDelivered) {
    peerStateHint = "auto-discovered";
  } else {
    peerStateHint = "explicit";
  }

  if (!peerOappId && peer && !isZeroAddress(peer)) {
    peerOappId = `${normalizedEid}_${peer.toLowerCase()}`;
  }

  return {
    id: syntheticId,
    eid: normalizedEid,
    localEid: effectiveLocalEid,
    oapp: oappAddress,
    oappId,
    effectiveReceiveLibrary,
    effectiveConfirmations: effectiveConfig.confirmations,
    effectiveRequiredDVNCount: effectiveConfig.requiredDVNCount,
    effectiveOptionalDVNCount: effectiveConfig.optionalDVNCount,
    effectiveOptionalDVNThreshold: effectiveConfig.optionalDVNThreshold,
    effectiveRequiredDVNs: effectiveConfig.requiredDVNs,
    effectiveOptionalDVNs: effectiveConfig.optionalDVNs,
    libraryStatus,
    isConfigTracked,
    usesDefaultLibrary,
    usesDefaultConfig,
    usesRequiredDVNSentinel,
    fallbackFields: orderFallbackFields(fallbackFields),
    defaultLibraryVersionId: defaultLibrary?.lastUpdatedByEventId ?? null,
    defaultConfigVersionId: defaultConfig?.lastUpdatedByEventId ?? null,
    libraryOverrideVersionId: overrideLibrary?.lastUpdatedByEventId ?? null,
    configOverrideVersionId: overrideConfig?.lastUpdatedByEventId ?? null,
    lastComputedTransactionHash: null,
    lastComputedBlock: null,
    lastComputedTimestamp: null,
    lastComputedByEventId: null,
    peer,
    peerOappId,
    peerLastUpdatedBlock: peerRecord?.lastUpdatedBlock ?? null,
    peerLastUpdatedTimestamp: peerRecord?.lastUpdatedTimestamp ?? null,
    peerLastUpdatedEventId: peerRecord?.lastUpdatedByEventId ?? null,
    peerTransactionHash: peerRecord?.transactionHash ?? null,
    sourceType: "default",
    synthetic: true,
    peerStateHint,
  };
}

function resolveConfig({ isConfigTracked, defaultCfg, overrideCfg, fallbackFields }) {
  if (!isConfigTracked) {
    return {
      effectiveConfig: emptyEffectiveConfig(),
      usesDefaultConfig: false,
      usesRequiredDVNSentinel: false,
    };
  }

  const effective = emptyEffectiveConfig();
  let usesDefaultConfig = true;
  let usesSentinel = false;

  if (overrideCfg.hasValues) {
    usesDefaultConfig = false;
    assignConfig(effective, overrideCfg);
    usesSentinel = overrideCfg.requiredDVNCount === REQUIRED_DVN_SENTINEL;

    // Track which fields originated from defaults
    FALLBACK_FIELD_ORDER.forEach((field) => {
      if (overrideCfg[field] === undefined || overrideCfg[field] === null) {
        fallbackFields.add(field);
      }
    });
  } else {
    assignConfig(effective, defaultCfg);
    usesSentinel = defaultCfg.requiredDVNCount === REQUIRED_DVN_SENTINEL;
    FALLBACK_FIELD_ORDER.forEach((field) => {
      if (defaultCfg[field] !== undefined && defaultCfg[field] !== null) {
        fallbackFields.add(field);
      }
    });
  }

  return {
    effectiveConfig: effective,
    usesDefaultConfig,
    usesRequiredDVNSentinel: usesSentinel,
  };
}

function normalizeConfig(input) {
  if (!input) {
    return emptyNormalizedConfig();
  }

  const confirmations = input.confirmations ?? null;
  const requiredDVNCount =
    input.requiredDVNCount !== undefined && input.requiredDVNCount !== null
      ? Number(input.requiredDVNCount)
      : null;
  const optionalDVNCount =
    input.optionalDVNCount !== undefined && input.optionalDVNCount !== null
      ? Number(input.optionalDVNCount)
      : null;
  const optionalDVNThreshold =
    input.optionalDVNThreshold !== undefined && input.optionalDVNThreshold !== null
      ? Number(input.optionalDVNThreshold)
      : null;

  const requiredDVNs = Array.isArray(input.requiredDVNs) ? dedupeAddresses(input.requiredDVNs) : [];
  const optionalDVNs = Array.isArray(input.optionalDVNs) ? dedupeAddresses(input.optionalDVNs) : [];

  const hasValues =
    confirmations !== null ||
    (requiredDVNCount !== null && requiredDVNCount !== 0) ||
    (optionalDVNCount !== null && optionalDVNCount !== 0) ||
    (optionalDVNThreshold !== null && optionalDVNThreshold !== 0) ||
    requiredDVNs.length > 0 ||
    optionalDVNs.length > 0;

  return {
    confirmations,
    requiredDVNCount,
    optionalDVNCount,
    optionalDVNThreshold,
    requiredDVNs,
    optionalDVNs,
    hasValues,
  };
}

function emptyNormalizedConfig() {
  return {
    confirmations: null,
    requiredDVNCount: null,
    optionalDVNCount: null,
    optionalDVNThreshold: null,
    requiredDVNs: [],
    optionalDVNs: [],
    hasValues: false,
  };
}

function emptyEffectiveConfig() {
  return {
    confirmations: null,
    requiredDVNCount: null,
    optionalDVNCount: 0,
    optionalDVNThreshold: null,
    requiredDVNs: [],
    optionalDVNs: [],
  };
}

function assignConfig(target, source) {
  target.confirmations = source.confirmations ?? null;
  target.requiredDVNCount =
    source.requiredDVNCount !== undefined && source.requiredDVNCount !== null
      ? source.requiredDVNCount
      : null;
  target.optionalDVNCount =
    source.optionalDVNCount !== undefined && source.optionalDVNCount !== null
      ? source.optionalDVNCount
      : 0;
  target.optionalDVNThreshold =
    source.optionalDVNThreshold !== undefined && source.optionalDVNThreshold !== null
      ? source.optionalDVNThreshold
      : null;
  target.requiredDVNs = source.requiredDVNs ?? [];
  target.optionalDVNs = source.optionalDVNs ?? [];
}

function buildMap(list, keySelector) {
  const map = new Map();
  if (!Array.isArray(list)) {
    return map;
  }
  for (const item of list) {
    const key = keySelector(item);
    if (!key) continue;
    map.set(key, item);
  }
  return map;
}

function normalizeAddressSafe(address) {
  if (!address) return null;
  return String(address).toLowerCase();
}

function dedupeAddresses(addresses) {
  const seen = new Set();
  const result = [];
  for (const address of addresses) {
    if (!address) continue;
    const normalized = normalizeAddressSafe(address);
    if (!normalized || isZeroAddress(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result.sort();
}

function derivePeerStateHint(row, peerRecord, isSynthetic) {
  if (row?.peerStateHint) return row.peerStateHint;

  const peer = row?.peer ?? peerRecord?.peer ?? null;
  if (!peer) {
    return isSynthetic ? "implicit-blocked" : "not-configured";
  }

  if (isZeroAddress(peer)) {
    if (peerRecord && peerRecord.fromPacketDelivered) {
      return "auto-discovered";
    }
    return peerRecord ? "explicit-blocked" : isSynthetic ? "implicit-blocked" : "explicit-blocked";
  }

  if (peerRecord) {
    return peerRecord.fromPacketDelivered ? "auto-discovered" : "explicit";
  }

  return "not-configured";
}

function BigIntSafe(value) {
  try {
    return value !== undefined && value !== null ? BigInt(value) : null;
  } catch (error) {
    return null;
  }
}

function toString(value) {
  return value === undefined || value === null ? null : String(value);
}

function orderFallbackFields(fallbackSet) {
  const result = [];
  for (const field of FALLBACK_FIELD_ORDER) {
    if (fallbackSet.has(field)) {
      result.push(field);
    }
  }
  return result;
}
