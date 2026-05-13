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
const OPTIONAL_DVN_SENTINEL = APP_CONFIG.SENTINEL_VALUES.OPTIONAL_DVN_SENTINEL;
const CONFIRMATIONS_SENTINEL = APP_CONFIG.SENTINEL_VALUES.CONFIRMATIONS_SENTINEL;

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
  let usesDefaultLibrary = false;
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
  } else {
    usesDefaultLibrary = true;
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
  const overrideHasConfig = overrideCfg.hasValues;
  const usesDefaultConfig = !overrideHasConfig;
  let usesSentinel = false;

  const overrideConfirmations = overrideCfg.confirmations;
  const defaultConfirmations = defaultCfg.confirmations;
  if (hasNonZeroConfirmations(overrideConfirmations)) {
    effective.confirmations = normalizeConfirmations(overrideConfirmations);
  } else if (defaultConfirmations !== undefined && defaultConfirmations !== null) {
    effective.confirmations = normalizeConfirmations(defaultConfirmations);
  } else {
    effective.confirmations = null;
  }
  if (overrideHasConfig && !hasNonZeroConfirmations(overrideConfirmations)) {
    fallbackFields.add("confirmations");
  }

  const overrideRequiredCount = overrideCfg.requiredDVNCount;
  const defaultRequiredCount = defaultCfg.requiredDVNCount;
  const overrideUsesRequiredDVNSentinel = overrideRequiredCount === REQUIRED_DVN_SENTINEL;
  let rawRequiredCount = null;
  if (isActiveCount(overrideRequiredCount, REQUIRED_DVN_SENTINEL)) {
    rawRequiredCount = overrideRequiredCount;
  } else if (defaultRequiredCount !== undefined && defaultRequiredCount !== null) {
    rawRequiredCount = defaultRequiredCount;
  }
  if (overrideHasConfig && !isActiveCount(overrideRequiredCount, REQUIRED_DVN_SENTINEL)) {
    fallbackFields.add("requiredDVNCount");
  }

  const overrideOptionalCount = overrideCfg.optionalDVNCount;
  const defaultOptionalCount = defaultCfg.optionalDVNCount;
  const overrideUsesOptionalDVNSentinel = overrideOptionalCount === OPTIONAL_DVN_SENTINEL;
  let rawOptionalCount = null;
  let usesOptionalDVNSentinel = false;
  if (isActiveCount(overrideOptionalCount, OPTIONAL_DVN_SENTINEL)) {
    usesOptionalDVNSentinel = overrideOptionalCount === OPTIONAL_DVN_SENTINEL;
    rawOptionalCount = overrideOptionalCount === OPTIONAL_DVN_SENTINEL ? 0 : overrideOptionalCount;
  } else if (defaultOptionalCount !== undefined && defaultOptionalCount !== null) {
    usesOptionalDVNSentinel = defaultOptionalCount === OPTIONAL_DVN_SENTINEL;
    rawOptionalCount = defaultOptionalCount === OPTIONAL_DVN_SENTINEL ? 0 : defaultOptionalCount;
  }
  if (overrideHasConfig && !isActiveCount(overrideOptionalCount, OPTIONAL_DVN_SENTINEL)) {
    fallbackFields.add("optionalDVNCount");
  }

  const overrideOptionalThreshold = overrideCfg.optionalDVNThreshold;
  const defaultOptionalThreshold = defaultCfg.optionalDVNThreshold;
  if (
    overrideOptionalThreshold !== undefined &&
    overrideOptionalThreshold !== null &&
    overrideOptionalThreshold > 0
  ) {
    effective.optionalDVNThreshold = overrideOptionalThreshold;
  } else if (defaultOptionalThreshold !== undefined && defaultOptionalThreshold !== null) {
    effective.optionalDVNThreshold = defaultOptionalThreshold;
  }
  if (
    overrideHasConfig &&
    !overrideUsesOptionalDVNSentinel &&
    (overrideOptionalThreshold === undefined ||
      overrideOptionalThreshold === null ||
      overrideOptionalThreshold === 0)
  ) {
    fallbackFields.add("optionalDVNThreshold");
  }

  usesSentinel = rawRequiredCount === REQUIRED_DVN_SENTINEL;

  if (usesSentinel) {
    effective.requiredDVNCount = 0;
    effective.requiredDVNs = [];
  } else if (overrideCfg.requiredDVNs.length > 0) {
    effective.requiredDVNs = overrideCfg.requiredDVNs;
    effective.requiredDVNCount = overrideCfg.requiredDVNs.length;
  } else if (
    defaultCfg.requiredDVNs.length > 0 ||
    (defaultRequiredCount !== undefined &&
      defaultRequiredCount !== null &&
      defaultRequiredCount > 0)
  ) {
    effective.requiredDVNs = defaultCfg.requiredDVNs;
    effective.requiredDVNCount =
      defaultCfg.requiredDVNs.length > 0 ? defaultCfg.requiredDVNs.length : rawRequiredCount;
  } else {
    effective.requiredDVNCount = rawRequiredCount;
  }
  if (
    overrideHasConfig &&
    !overrideUsesRequiredDVNSentinel &&
    overrideCfg.requiredDVNs.length === 0
  ) {
    fallbackFields.add("requiredDVNs");
  }

  if (usesOptionalDVNSentinel) {
    effective.optionalDVNs = [];
    effective.optionalDVNCount = 0;
  } else if (overrideCfg.optionalDVNs.length > 0) {
    effective.optionalDVNs = overrideCfg.optionalDVNs;
    effective.optionalDVNCount = overrideCfg.optionalDVNs.length;
  } else if (
    defaultCfg.optionalDVNs.length > 0 ||
    (defaultOptionalCount !== undefined &&
      defaultOptionalCount !== null &&
      defaultOptionalCount > 0)
  ) {
    effective.optionalDVNs = defaultCfg.optionalDVNs;
    effective.optionalDVNCount =
      defaultCfg.optionalDVNs.length > 0 ? defaultCfg.optionalDVNs.length : rawOptionalCount || 0;
  } else {
    effective.optionalDVNCount = rawOptionalCount || 0;
  }
  if (
    overrideHasConfig &&
    !overrideUsesOptionalDVNSentinel &&
    overrideCfg.optionalDVNs.length === 0
  ) {
    fallbackFields.add("optionalDVNs");
  }

  if (
    effective.optionalDVNThreshold !== null &&
    effective.optionalDVNThreshold > effective.optionalDVNCount
  ) {
    effective.optionalDVNThreshold = effective.optionalDVNCount;
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
    hasNonZeroConfirmations(confirmations) ||
    (requiredDVNCount !== null &&
      (requiredDVNCount > 0 || requiredDVNCount === REQUIRED_DVN_SENTINEL)) ||
    (optionalDVNCount !== null &&
      (optionalDVNCount > 0 || optionalDVNCount === OPTIONAL_DVN_SENTINEL)) ||
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

function hasNonZeroConfirmations(value) {
  return value !== undefined && value !== null && String(value) !== "0";
}

function normalizeConfirmations(value) {
  return String(value) === CONFIRMATIONS_SENTINEL ? 0 : value;
}

function isActiveCount(value, sentinel) {
  return value !== undefined && value !== null && (value > 0 || value === sentinel);
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
