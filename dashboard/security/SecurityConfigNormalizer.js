import { APP_CONFIG } from "../config.js";
import { isZeroAddress, normalizeKey } from "../core.js";
import { AddressUtils } from "../utils/AddressUtils.js";
import { toString } from "../utils/NumberUtils.js";

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

export function normalizeSecurityConfig({
  eid,
  config,
  peerRecord,
  oappId,
  oappAddress,
  localEid,
  trackedReceiveLibrary,
  defaultLibrary,
  defaultConfig,
  overrideLibrary,
  overrideConfig,
}) {
  const normalizedEid = normalizeKey(config?.eid ?? eid);
  if (!normalizedEid) {
    return null;
  }

  const normalizedLocalEid =
    config?.localEid !== undefined && config?.localEid !== null
      ? toString(config.localEid)
      : toString(localEid);

  if (config) {
    const fallbackSource = Array.isArray(config.fallbackFields) ? config.fallbackFields : [];
    const fallbackFields = orderFallbackFields(new Set(fallbackSource));

    return {
      ...config,
      eid: normalizedEid,
      localEid: normalizedLocalEid,
      oapp: config.oapp ?? oappAddress ?? null,
      oappId: config.oappId ?? oappId ?? null,
      fallbackFields,
      sourceType: config.sourceType || "materialized",
      synthetic: Boolean(config.synthetic),
      peerStateHint: derivePeerStateHint(config, peerRecord, { isSynthetic: false }),
    };
  }

  return createSyntheticSecurityConfig({
    eid: normalizedEid,
    localEid: normalizedLocalEid,
    oappId,
    oappAddress,
    trackedReceiveLibrary,
    defaultLibrary,
    defaultConfig,
    overrideLibrary,
    overrideConfig,
    peerRecord,
  });
}

export function derivePeerStateHint(row, peerRecord, { isSynthetic = false } = {}) {
  if (row?.peerStateHint) {
    return row.peerStateHint;
  }

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

function createSyntheticSecurityConfig({
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
  const syntheticId = `${SYNTHETIC_ID_PREFIX}${oappId}_${eid}`;

  const defaultLibraryAddress = AddressUtils.normalizeSafe(defaultLibrary?.library);
  const overrideLibraryAddress = AddressUtils.normalizeSafe(overrideLibrary?.library);
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

  const overrideCfg = normalizeConfig(overrideConfig);
  const defaultCfg = normalizeConfig(defaultConfig);
  const { effectiveConfig, usesDefaultConfig, usesRequiredDVNSentinel } = resolveConfig({
    isConfigTracked,
    defaultCfg,
    overrideCfg,
    fallbackFields,
  });

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
    peerOappId = `${eid}_${AddressUtils.normalizeSafe(peer)}`;
  }

  const normalizedEntry = {
    id: syntheticId,
    eid,
    localEid,
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

  normalizedEntry.peerStateHint = derivePeerStateHint(normalizedEntry, peerRecord, {
    isSynthetic: true,
  });

  return normalizedEntry;
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
  target.confirmations =
    source.confirmations !== undefined && source.confirmations !== null
      ? source.confirmations
      : null;
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

function dedupeAddresses(addresses) {
  const seen = new Set();
  const result = [];
  for (const address of addresses) {
    if (!address) continue;
    const normalized = AddressUtils.normalizeSafe(address);
    if (!normalized || isZeroAddress(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result.sort();
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
