import {
  DefaultReceiveLibrary,
  DefaultReceiveLibraryVersion,
  DefaultUlnConfig,
  DefaultUlnConfigVersion,
  OApp,
  OAppEidPacketStats,
  OAppReceiveLibrary,
  OAppReceiveLibraryVersion,
  OAppPeer,
  OAppPeerVersion,
  OAppRateLimiter,
  OAppRateLimiterVersion,
  OAppRateLimit,
  OAppRateLimitVersion,
  OAppSecurityConfig,
  OAppUlnConfig,
  OAppUlnConfigVersion,
  PacketDelivered as PacketDeliveredEntity,
  EndpointV2,
  ReceiveUln302,
  OAppOFT,
  handlerContext,
} from "generated";
import {
  getTrackedReceiveLibraryAddress,
  resolveLocalEid,
} from "./localChainRegistry";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Sentinel Values in LayerZero UlnConfig
 *
 * These special values distinguish between "inherit from default" (0) and "explicitly set to zero" (sentinel).
 *
 * | Field              | Type   | Meaning of 0 (DEFAULT)          | Meaning of max_value (NIL)                    |
 * |--------------------|--------|---------------------------------|-----------------------------------------------|
 * | requiredDVNCount   | uint8  | Inherit the default setting     | 255: Override to zero required DVNs           |
 * | optionalDVNCount   | uint8  | Inherit the default setting     | 255: Override to zero optional DVNs           |
 * | confirmations      | uint64 | Inherit the default setting     | 2^64-1: Override to zero confirmations        |
 *
 * Example: If OApp sets requiredDVNCount = 255 with empty requiredDVNs array,
 * the system will require zero DVNs from the required list (not inherit from defaults).
 * If they had set it to 0, it would have inherited the default configuration.
 */
const SENTINEL_REQUIRED_DVN_COUNT = 255;
const SENTINEL_OPTIONAL_DVN_COUNT = 255;
const SENTINEL_CONFIRMATIONS = 18446744073709551615n; // 2^64 - 1

const FALLBACK_FIELD_ORDER = [
  "receiveLibrary",
  "confirmations",
  "requiredDVNCount",
  "requiredDVNs",
  "optionalDVNCount",
  "optionalDVNs",
  "optionalDVNThreshold",
] as const;

type FallbackField = (typeof FALLBACK_FIELD_ORDER)[number];

const normalizeAddress = (
  value: string | undefined | null,
): string | undefined => (value ? value.toLowerCase() : undefined);

const isZeroAddress = (value: string | undefined | null): boolean =>
  value !== undefined &&
  value !== null &&
  value.toLowerCase() === ZERO_ADDRESS;

type NormalizedConfig = {
  confirmations?: bigint;
  requiredDVNCount?: number;
  optionalDVNCount?: number;
  optionalDVNThreshold?: number;
  requiredDVNs: string[];
  optionalDVNs: string[];
  hasValues: boolean;
};

type ConfigComparable = {
  confirmations?: bigint;
  requiredDVNCount: number;
  optionalDVNCount: number;
  optionalDVNThreshold: number;
  requiredDVNs: string[];
  optionalDVNs: string[];
  usesSentinel: boolean;
};

type MergeResult = {
  effectiveReceiveLibrary?: string;
  effectiveConfirmations?: bigint;
  effectiveRequiredDVNCount?: number;
  effectiveOptionalDVNCount: number;
  effectiveOptionalDVNThreshold?: number;
  effectiveRequiredDVNs: string[];
  effectiveOptionalDVNs: string[];
  usesRequiredDVNSentinel: boolean;
  isConfigTracked: boolean;
  fallbackFieldSet: Set<FallbackField>;
  comparable: ConfigComparable;
};

type ComputeEffectiveConfigArgs = {
  context: handlerContext;
  chainId: number;
  localEid: bigint;
  oappId: string;
  oappAddress: string;
  eid: bigint;
  blockNumber: bigint;
  blockTimestamp: bigint;
  eventId: string;
  transactionHash: string;
};

const uniqueNormalizedAddresses = (
  input: readonly string[] | undefined,
): string[] => {
  if (!input || input.length === 0) return [];
  const seen = new Set<string>();
  for (const value of input) {
    const normalized = normalizeAddress(value);
    if (!normalized || isZeroAddress(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
  }
  return Array.from(seen).sort();
};

/**
 * Validates UlnConfig for consistency and logs any issues.
 * Returns true if validation passes, false if issues were found.
 */
const validateUlnConfig = (
  context: handlerContext,
  config: {
    requiredDVNCount?: number;
    optionalDVNCount?: number;
    optionalDVNThreshold?: number;
    requiredDVNs: string[];
    optionalDVNs: string[];
  },
  source: string,
  chainId: number,
  eid: bigint,
): boolean => {
  let isValid = true;

  // Log sentinel value usage (informational)
  if (config.requiredDVNCount === SENTINEL_REQUIRED_DVN_COUNT) {
    context.log.debug(
      `UlnConfig using sentinel: requiredDVNCount=255 (NIL) in ${source}`,
      {
        chainId,
        eid: eid.toString(),
      },
    );
  }
  if (config.optionalDVNCount === SENTINEL_OPTIONAL_DVN_COUNT) {
    context.log.debug(
      `UlnConfig using sentinel: optionalDVNCount=255 (NIL) in ${source}`,
      {
        chainId,
        eid: eid.toString(),
      },
    );
  }

  // Validate requiredDVNCount vs requiredDVNs.length (except sentinel)
  if (
    config.requiredDVNCount !== undefined &&
    config.requiredDVNCount !== SENTINEL_REQUIRED_DVN_COUNT &&
    config.requiredDVNCount > 0 &&
    config.requiredDVNs.length > 0 &&
    config.requiredDVNCount !== config.requiredDVNs.length
  ) {
    context.log.warn(
      `UlnConfig validation: requiredDVNCount mismatch in ${source}`,
      {
        chainId,
        eid: eid.toString(),
        requiredDVNCount: config.requiredDVNCount,
        requiredDVNsLength: config.requiredDVNs.length,
        requiredDVNs: config.requiredDVNs,
      },
    );
    isValid = false;
  }

  // Validate optionalDVNCount vs optionalDVNs.length (except sentinel)
  if (
    config.optionalDVNCount !== undefined &&
    config.optionalDVNCount !== SENTINEL_OPTIONAL_DVN_COUNT &&
    config.optionalDVNCount > 0 &&
    config.optionalDVNs.length > 0 &&
    config.optionalDVNCount !== config.optionalDVNs.length
  ) {
    context.log.warn(
      `UlnConfig validation: optionalDVNCount mismatch in ${source}`,
      {
        chainId,
        eid: eid.toString(),
        optionalDVNCount: config.optionalDVNCount,
        optionalDVNsLength: config.optionalDVNs.length,
        optionalDVNs: config.optionalDVNs,
      },
    );
    isValid = false;
  }

  // Validate optionalDVNThreshold <= optionalDVNCount
  if (
    config.optionalDVNThreshold !== undefined &&
    config.optionalDVNCount !== undefined &&
    config.optionalDVNThreshold > config.optionalDVNCount
  ) {
    context.log.warn(
      `UlnConfig validation: optionalDVNThreshold exceeds optionalDVNCount in ${source}`,
      {
        chainId,
        eid: eid.toString(),
        optionalDVNThreshold: config.optionalDVNThreshold,
        optionalDVNCount: config.optionalDVNCount,
      },
    );
    isValid = false;
  }

  return isValid;
};

/**
 * Checks for zero address in DVN arrays and logs if found.
 * Zero addresses are filtered out but this indicates potential misconfiguration.
 */
const checkForZeroAddresses = (
  context: handlerContext,
  addresses: readonly string[],
  source: string,
  chainId: number,
  eid: bigint,
  dvnType: "required" | "optional",
): void => {
  for (const address of addresses) {
    if (isZeroAddress(address)) {
      context.log.warn(
        `Zero address detected in ${dvnType} DVNs for ${source}`,
        {
          chainId,
          eid: eid.toString(),
          dvnType,
          originalAddress: address,
        },
      );
    }
  }
};

const emptyNormalizedConfig = (): NormalizedConfig => ({
  confirmations: undefined,
  requiredDVNCount: undefined,
  optionalDVNCount: undefined,
  optionalDVNThreshold: undefined,
  requiredDVNs: [],
  optionalDVNs: [],
  hasValues: false,
});

const createNormalizedConfig = (
  input?:
    | {
        confirmations?: bigint | null;
        requiredDVNCount?: number | null;
        optionalDVNCount?: number | null;
        optionalDVNThreshold?: number | null;
        requiredDVNs?: readonly string[] | null;
        optionalDVNs?: readonly string[] | null;
      }
    | null,
): NormalizedConfig => {
  if (!input) return emptyNormalizedConfig();

  const confirmations =
    input.confirmations !== undefined && input.confirmations !== null
      ? BigInt(input.confirmations)
      : undefined;
  const requiredDVNCount =
    input.requiredDVNCount !== undefined && input.requiredDVNCount !== null
      ? Number(input.requiredDVNCount)
      : undefined;
  const optionalDVNCount =
    input.optionalDVNCount !== undefined && input.optionalDVNCount !== null
      ? Number(input.optionalDVNCount)
      : undefined;
  const optionalDVNThreshold =
    input.optionalDVNThreshold !== undefined &&
    input.optionalDVNThreshold !== null
      ? Number(input.optionalDVNThreshold)
      : undefined;

  const requiredDVNs = uniqueNormalizedAddresses(input.requiredDVNs ?? []);
  const optionalDVNs = uniqueNormalizedAddresses(input.optionalDVNs ?? []);

  // A config "has values" if any field is explicitly set (including sentinel values)
  // 0/undefined means "inherit from default" and doesn't count as having a value
  const hasValues =
    (confirmations !== undefined && confirmations !== 0n) ||
    (requiredDVNCount !== undefined &&
      (requiredDVNCount > 0 || requiredDVNCount === SENTINEL_REQUIRED_DVN_COUNT)) ||
    (optionalDVNCount !== undefined &&
      (optionalDVNCount > 0 || optionalDVNCount === SENTINEL_OPTIONAL_DVN_COUNT)) ||
    (optionalDVNThreshold !== undefined && optionalDVNThreshold > 0) ||
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
};

const makeEventId = (
  localEid: bigint,
  blockNumber: number,
  logIndex: number,
): string => `${localEid.toString()}_${blockNumber}_${logIndex}`;

const makeDefaultScopedId = (localEid: bigint, eid: bigint): string =>
  `${localEid.toString()}_${eid.toString()}`;

const makeOAppId = (localEid: bigint, address: string): string =>
  `${localEid.toString()}_${address}`;

const makeSecurityConfigId = (oappId: string, eid: bigint): string =>
  `${oappId}_${eid.toString()}`;

const toBigInt = (value: number | bigint): bigint => BigInt(value);

const getTrackedReceiveLibrary = (localEid: bigint): string | undefined =>
  getTrackedReceiveLibraryAddress(localEid);

const isTrackedReceiveLibrary = (
  localEid: bigint,
  library?: string,
): boolean => {
  if (!library) return false;
  const tracked = getTrackedReceiveLibrary(localEid);
  return tracked !== undefined && tracked === library;
};

const emptyConfigComparable = (): ConfigComparable => ({
  confirmations: undefined,
  requiredDVNCount: 0,
  optionalDVNCount: 0,
  optionalDVNThreshold: 0,
  requiredDVNs: [],
  optionalDVNs: [],
  usesSentinel: false,
});

const formatFallbackFields = (fields: Set<FallbackField>): string[] => {
  const result: string[] = [];
  for (const field of FALLBACK_FIELD_ORDER) {
    if (fields.has(field)) {
      result.push(field);
    }
  }
  return result;
};

const arraysEqual = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const configsAreEqual = (a: ConfigComparable, b: ConfigComparable): boolean =>
  a.usesSentinel === b.usesSentinel &&
  a.requiredDVNCount === b.requiredDVNCount &&
  a.optionalDVNCount === b.optionalDVNCount &&
  a.optionalDVNThreshold === b.optionalDVNThreshold &&
  arraysEqual(a.requiredDVNs, b.requiredDVNs) &&
  arraysEqual(a.optionalDVNs, b.optionalDVNs) &&
  ((a.confirmations === undefined && b.confirmations === undefined) ||
    (a.confirmations !== undefined &&
      b.confirmations !== undefined &&
      a.confirmations === b.confirmations));

const mergeSecurityConfig = (
  context: handlerContext | undefined,
  localEid: bigint,
  eid: bigint,
  oappId: string | undefined,
  defaults: {
    library?: string;
    config: NormalizedConfig;
  },
  overrides?: {
    library?: string;
    config: NormalizedConfig;
  },
): MergeResult => {
  const fallbackFields = new Set<FallbackField>();

  const defaultLibrary = defaults.library
    ? normalizeAddress(defaults.library)
    : undefined;
  const overrideLibrary = overrides?.library
    ? normalizeAddress(overrides.library)
    : undefined;

  let effectiveReceiveLibrary: string | undefined;
  if (overrideLibrary && !isZeroAddress(overrideLibrary)) {
    effectiveReceiveLibrary = overrideLibrary;
  } else if (defaultLibrary && !isZeroAddress(defaultLibrary)) {
    effectiveReceiveLibrary = defaultLibrary;
    if (!overrideLibrary || isZeroAddress(overrideLibrary)) {
      fallbackFields.add("receiveLibrary");
    }
  } else if (overrideLibrary) {
    effectiveReceiveLibrary = overrideLibrary;
  } else {
    effectiveReceiveLibrary = undefined;
  }

  const isConfigTracked = isTrackedReceiveLibrary(
    localEid,
    effectiveReceiveLibrary,
  );

  if (!isConfigTracked) {
    return {
      effectiveReceiveLibrary,
      effectiveConfirmations: undefined,
      effectiveRequiredDVNCount: undefined,
      effectiveOptionalDVNCount: 0,
      effectiveOptionalDVNThreshold: undefined,
      effectiveRequiredDVNs: [],
      effectiveOptionalDVNs: [],
      usesRequiredDVNSentinel: false,
      isConfigTracked: false,
      fallbackFieldSet: fallbackFields,
      comparable: emptyConfigComparable(),
    };
  }

  const defaultConfig = defaults.config ?? emptyNormalizedConfig();
  const overrideConfig = overrides?.config ?? emptyNormalizedConfig();

  const overrideHasConfig = overrideConfig.hasValues;

  const overrideConfirmations = overrideConfig.confirmations;
  const defaultConfirmations = defaultConfig.confirmations;
  let effectiveConfirmations: bigint | undefined;
  if (
    overrideConfirmations !== undefined &&
    overrideConfirmations !== 0n
  ) {
    // Sentinel value means explicitly set to zero confirmations
    effectiveConfirmations =
      overrideConfirmations === SENTINEL_CONFIRMATIONS
        ? 0n
        : overrideConfirmations;
  } else if (defaultConfirmations !== undefined) {
    // Sentinel value in default also means zero confirmations
    effectiveConfirmations =
      defaultConfirmations === SENTINEL_CONFIRMATIONS
        ? 0n
        : defaultConfirmations;
    if (
      overrideHasConfig &&
      (overrideConfirmations === undefined || overrideConfirmations === 0n)
    ) {
      fallbackFields.add("confirmations");
    }
  } else {
    effectiveConfirmations = undefined;
  }

  const overrideRequiredCount = overrideConfig.requiredDVNCount;
  const defaultRequiredCount = defaultConfig.requiredDVNCount;
  let rawRequiredCount: number | undefined;
  if (
    overrideRequiredCount !== undefined &&
    (overrideRequiredCount > 0 ||
      overrideRequiredCount === SENTINEL_REQUIRED_DVN_COUNT)
  ) {
    rawRequiredCount = overrideRequiredCount;
  } else if (defaultRequiredCount !== undefined) {
    rawRequiredCount = defaultRequiredCount;
    if (
      overrideHasConfig &&
      (overrideRequiredCount === undefined ||
        overrideRequiredCount === 0)
    ) {
      fallbackFields.add("requiredDVNCount");
    }
  }

  const overrideOptionalCount = overrideConfig.optionalDVNCount;
  const defaultOptionalCount = defaultConfig.optionalDVNCount;
  let rawOptionalCount: number | undefined;
  if (
    overrideOptionalCount !== undefined &&
    (overrideOptionalCount > 0 ||
      overrideOptionalCount === SENTINEL_OPTIONAL_DVN_COUNT)
  ) {
    // Sentinel value means explicitly set to zero optional DVNs
    rawOptionalCount =
      overrideOptionalCount === SENTINEL_OPTIONAL_DVN_COUNT
        ? 0
        : overrideOptionalCount;
  } else if (defaultOptionalCount !== undefined) {
    // Sentinel value in default also means zero optional DVNs
    rawOptionalCount =
      defaultOptionalCount === SENTINEL_OPTIONAL_DVN_COUNT
        ? 0
        : defaultOptionalCount;
    if (
      overrideHasConfig &&
      (overrideOptionalCount === undefined || overrideOptionalCount === 0)
    ) {
      fallbackFields.add("optionalDVNCount");
    }
  }

  const overrideOptionalThreshold = overrideConfig.optionalDVNThreshold;
  const defaultOptionalThreshold = defaultConfig.optionalDVNThreshold;
  let effectiveOptionalDVNThreshold: number | undefined;
  if (
    overrideOptionalThreshold !== undefined &&
    overrideOptionalThreshold > 0
  ) {
    effectiveOptionalDVNThreshold = overrideOptionalThreshold;
  } else if (defaultOptionalThreshold !== undefined) {
    effectiveOptionalDVNThreshold = defaultOptionalThreshold;
    if (
      overrideHasConfig &&
      (overrideOptionalThreshold === undefined ||
        overrideOptionalThreshold === 0)
    ) {
      fallbackFields.add("optionalDVNThreshold");
    }
  }

  const overrideRequiredDVNs = overrideConfig.requiredDVNs;
  const defaultRequiredDVNs = defaultConfig.requiredDVNs;
  const usesRequiredDVNSentinel =
    rawRequiredCount === SENTINEL_REQUIRED_DVN_COUNT;

  let effectiveRequiredDVNs: string[] = [];
  if (usesRequiredDVNSentinel) {
    effectiveRequiredDVNs = [];
  } else if (overrideRequiredDVNs.length > 0) {
    effectiveRequiredDVNs = overrideRequiredDVNs;
  } else if (
    defaultRequiredDVNs.length > 0 ||
    (defaultRequiredCount !== undefined && defaultRequiredCount > 0)
  ) {
    effectiveRequiredDVNs = defaultRequiredDVNs;
    if (overrideHasConfig && overrideRequiredDVNs.length === 0) {
      fallbackFields.add("requiredDVNs");
    }
  }

  const overrideOptionalDVNs = overrideConfig.optionalDVNs;
  const defaultOptionalDVNs = defaultConfig.optionalDVNs;
  let effectiveOptionalDVNs: string[] = [];
  if (overrideOptionalDVNs.length > 0) {
    effectiveOptionalDVNs = overrideOptionalDVNs;
  } else if (
    defaultOptionalDVNs.length > 0 ||
    (defaultOptionalCount !== undefined && defaultOptionalCount > 0)
  ) {
    effectiveOptionalDVNs = defaultOptionalDVNs;
    if (overrideHasConfig && overrideOptionalDVNs.length === 0) {
      fallbackFields.add("optionalDVNs");
    }
  }

  let effectiveRequiredDVNCount: number | undefined;
  if (usesRequiredDVNSentinel) {
    effectiveRequiredDVNCount = 0;
  } else if (effectiveRequiredDVNs.length > 0) {
    effectiveRequiredDVNCount = effectiveRequiredDVNs.length;
  } else if (rawRequiredCount !== undefined) {
    effectiveRequiredDVNCount = rawRequiredCount;
  } else {
    effectiveRequiredDVNCount = undefined;
  }

  let effectiveOptionalDVNCount: number = effectiveOptionalDVNs.length;
  if (effectiveOptionalDVNCount === 0 && rawOptionalCount !== undefined) {
    effectiveOptionalDVNCount = rawOptionalCount;
  }

  // Cap threshold to count if misconfigured
  if (
    effectiveOptionalDVNThreshold !== undefined &&
    effectiveOptionalDVNCount >= 0
  ) {
    if (effectiveOptionalDVNThreshold > effectiveOptionalDVNCount) {
      const originalThreshold = effectiveOptionalDVNThreshold;
      effectiveOptionalDVNThreshold = effectiveOptionalDVNCount;

      if (context) {
        context.log.warn(
          "UlnConfig auto-correction: optionalDVNThreshold capped to optionalDVNCount",
          {
            localEid: localEid.toString(),
            eid: eid.toString(),
            oappId: oappId ?? "default",
            originalThreshold,
            cappedThreshold: effectiveOptionalDVNThreshold,
            optionalDVNCount: effectiveOptionalDVNCount,
          },
        );
      }
    }
  }

  const comparable: ConfigComparable = {
    confirmations: effectiveConfirmations,
    requiredDVNCount:
      effectiveRequiredDVNCount !== undefined
        ? effectiveRequiredDVNCount
        : 0,
    optionalDVNCount: effectiveOptionalDVNCount,
    optionalDVNThreshold:
      effectiveOptionalDVNThreshold !== undefined
        ? effectiveOptionalDVNThreshold
        : 0,
    requiredDVNs: effectiveRequiredDVNs,
    optionalDVNs: effectiveOptionalDVNs,
    usesSentinel: usesRequiredDVNSentinel,
  };

  return {
    effectiveReceiveLibrary,
    effectiveConfirmations,
    effectiveRequiredDVNCount,
    effectiveOptionalDVNCount,
    effectiveOptionalDVNThreshold,
    effectiveRequiredDVNs,
    effectiveOptionalDVNs,
    usesRequiredDVNSentinel,
    isConfigTracked: true,
    fallbackFieldSet: fallbackFields,
    comparable,
  };
};

const computeAndPersistEffectiveConfig = async ({
  context,
  chainId,
  localEid,
  oappId,
  oappAddress,
  eid,
  blockNumber,
  blockTimestamp,
  eventId,
  transactionHash,
}: ComputeEffectiveConfigArgs): Promise<OAppSecurityConfig> => {
  const defaultKey = makeDefaultScopedId(localEid, eid);
  const configId = makeSecurityConfigId(oappId, eid);

  const [
    defaultLibrary,
    defaultConfig,
    libraryOverride,
    configOverride,
    existingConfig,
    peerState,
  ] = await Promise.all([
    context.DefaultReceiveLibrary.get(defaultKey),
    context.DefaultUlnConfig.get(defaultKey),
    context.OAppReceiveLibrary.get(configId),
    context.OAppUlnConfig.get(configId),
    context.OAppSecurityConfig.get(configId),
    context.OAppPeer.get(configId),
  ]);

  const defaults = {
    library: defaultLibrary?.library,
    config: createNormalizedConfig(
      defaultConfig
        ? {
            confirmations: defaultConfig.confirmations,
            requiredDVNCount: defaultConfig.requiredDVNCount ?? undefined,
            optionalDVNCount: defaultConfig.optionalDVNCount ?? undefined,
            optionalDVNThreshold:
              defaultConfig.optionalDVNThreshold ?? undefined,
            requiredDVNs: defaultConfig.requiredDVNs,
            optionalDVNs: defaultConfig.optionalDVNs,
          }
        : undefined,
    ),
  };

  const overrides = {
    library: libraryOverride?.library,
    config: createNormalizedConfig(
      configOverride
        ? {
            confirmations: configOverride.confirmations,
            requiredDVNCount: configOverride.requiredDVNCount ?? undefined,
            optionalDVNCount: configOverride.optionalDVNCount ?? undefined,
            optionalDVNThreshold:
              configOverride.optionalDVNThreshold ?? undefined,
            requiredDVNs: configOverride.requiredDVNs,
            optionalDVNs: configOverride.optionalDVNs,
          }
        : undefined,
    ),
  };

  const defaultResolved = mergeSecurityConfig(
    context,
    localEid,
    eid,
    undefined,
    defaults,
  );
  const resolved = mergeSecurityConfig(
    context,
    localEid,
    eid,
    oappId,
    defaults,
    overrides,
  );

  const usesDefaultLibrary =
    resolved.effectiveReceiveLibrary ===
    defaultResolved.effectiveReceiveLibrary;
  const usesDefaultConfig =
    resolved.isConfigTracked &&
    defaultResolved.isConfigTracked &&
    configsAreEqual(resolved.comparable, defaultResolved.comparable);

  const derivedPeer = existingConfig?.peer ?? peerState?.peer;
  const derivedPeerBlock =
    existingConfig?.peerLastUpdatedBlock ?? peerState?.lastUpdatedBlock;
  const derivedPeerTimestamp =
    existingConfig?.peerLastUpdatedTimestamp ?? peerState?.lastUpdatedTimestamp;
  const derivedPeerEventId =
    existingConfig?.peerLastUpdatedEventId ?? peerState?.lastUpdatedByEventId;
  const derivedPeerTxHash =
    existingConfig?.peerTransactionHash ?? peerState?.transactionHash;

  const entity: OAppSecurityConfig = {
    id: configId,
    oappId,
    localEid,
    oapp: oappAddress,
    eid,
    effectiveReceiveLibrary: resolved.effectiveReceiveLibrary,
    effectiveConfirmations: resolved.effectiveConfirmations,
    effectiveRequiredDVNCount: resolved.effectiveRequiredDVNCount,
    effectiveOptionalDVNCount: resolved.effectiveOptionalDVNCount,
    effectiveOptionalDVNThreshold: resolved.effectiveOptionalDVNThreshold,
    effectiveRequiredDVNs: resolved.effectiveRequiredDVNs,
    effectiveOptionalDVNs: resolved.effectiveOptionalDVNs,
    isConfigTracked: resolved.isConfigTracked,
    usesDefaultLibrary,
    usesDefaultConfig,
    usesRequiredDVNSentinel: resolved.usesRequiredDVNSentinel,
    fallbackFields: formatFallbackFields(resolved.fallbackFieldSet),
    defaultLibraryVersionId: defaultLibrary?.lastUpdatedByEventId,
    defaultConfigVersionId: defaultConfig?.lastUpdatedByEventId,
    libraryOverrideVersionId: libraryOverride?.lastUpdatedByEventId,
    configOverrideVersionId: configOverride?.lastUpdatedByEventId,
    lastComputedTransactionHash: transactionHash,
    lastComputedBlock: blockNumber,
    lastComputedTimestamp: blockTimestamp,
    lastComputedByEventId: eventId,
    peer: derivedPeer,
    peerLastUpdatedBlock: derivedPeerBlock,
    peerLastUpdatedTimestamp: derivedPeerTimestamp,
    peerLastUpdatedEventId: derivedPeerEventId,
    peerTransactionHash: derivedPeerTxHash,
  };

  context.OAppSecurityConfig.set(entity);
  return entity;
};

const recomputeSecurityConfigsForScope = async (
  context: handlerContext,
  chainId: number,
  localEid: bigint,
  eid: bigint,
  blockNumber: bigint,
  blockTimestamp: bigint,
  eventId: string,
  transactionHash: string,
) => {
  try {
    const configsForChain =
      await context.OAppSecurityConfig.getWhere.localEid.eq(localEid);
    if (!configsForChain || configsForChain.length === 0) {
      context.log.debug("No configs found for chain during recomputation", {
        chainId,
        localEid: localEid.toString(),
        eid: eid.toString(),
      });
      return;
    }

    // Filter by eid in memory (performance note: could be optimized with compound query)
    const configsForEid = configsForChain.filter(config => config.eid === eid);

    if (configsForEid.length > 0) {
      context.log.debug("Recomputing security configs for scope", {
        chainId,
        localEid: localEid.toString(),
        eid: eid.toString(),
        configCount: configsForEid.length,
      });
    }

    for (const config of configsForEid) {
      try {
        await computeAndPersistEffectiveConfig({
          context,
          chainId,
          localEid,
          oappId: config.oappId,
          oappAddress: config.oapp,
          eid,
          blockNumber,
          blockTimestamp,
          eventId,
          transactionHash,
        });
      } catch (error) {
        context.log.error(
          "Failed to recompute security config for OApp",
          error instanceof Error
            ? error
            : new Error(String(error)),
        );
      context.log.error("Config recomputation context", {
        chainId,
        localEid: localEid.toString(),
        eid: eid.toString(),
        oappId: config.oappId,
        oappAddress: config.oapp,
      });
        // Continue processing other configs
      }
    }
  } catch (error) {
    context.log.error(
      "Failed to recompute security configs for scope",
      error instanceof Error ? error : new Error(String(error)),
    );
    context.log.error("Recomputation scope context", {
      chainId,
      localEid: localEid.toString(),
      eid: eid.toString(),
      eventId,
    });
    // Re-throw to propagate critical errors
    throw error;
  }
};

EndpointV2.DefaultReceiveLibrarySet.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const localEid = resolveLocalEid(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const transactionHash = event.transaction.hash;
  const eventId = makeEventId(localEid, event.block.number, event.logIndex);
  const id = makeDefaultScopedId(localEid, event.params.eid);
  const normalizedLibrary = normalizeAddress(event.params.newLib);
  if (!normalizedLibrary) {
    context.log.warn("DefaultReceiveLibrarySet missing newLib", {
      chainId: event.chainId,
      localEid: localEid.toString(),
      eid: event.params.eid,
      rawValue: event.params.newLib,
      eventId,
      transactionHash,
    });
    return;
  }

  const entity: DefaultReceiveLibrary = {
    id,
    localEid,
    eid: event.params.eid,
    library: normalizedLibrary,
    transactionHash,
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: blockTimestamp,
    lastUpdatedByEventId: eventId,
  };
  context.DefaultReceiveLibrary.set(entity);

  const version: DefaultReceiveLibraryVersion = {
    id: eventId,
    localEid,
    eid: event.params.eid,
    library: normalizedLibrary,
    blockNumber,
    blockTimestamp,
    eventId,
    transactionHash,
  };
  context.DefaultReceiveLibraryVersion.set(version);

  await recomputeSecurityConfigsForScope(
    context,
    event.chainId,
    localEid,
    event.params.eid,
    blockNumber,
    blockTimestamp,
    eventId,
    transactionHash,
  );
});

ReceiveUln302.DefaultUlnConfigsSet.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const localEid = resolveLocalEid(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const transactionHash = event.transaction.hash;

  for (const [eid, config] of event.params.params) {
    // Use destructuring for better readability and type safety
    const [
      confirmations,
      requiredDVNCount,
      optionalDVNCount,
      optionalDVNThreshold,
      requiredDVNs,
      optionalDVNs,
    ] = config;

    // Check for zero addresses before normalization
    checkForZeroAddresses(
      context,
      requiredDVNs,
      "DefaultUlnConfigsSet",
      event.chainId,
      eid,
      "required",
    );
    checkForZeroAddresses(
      context,
      optionalDVNs,
      "DefaultUlnConfigsSet",
      event.chainId,
      eid,
      "optional",
    );

    const id = makeDefaultScopedId(localEid, eid);
    const normalizedRequired = uniqueNormalizedAddresses(requiredDVNs);
    const normalizedOptional = uniqueNormalizedAddresses(optionalDVNs);

    const eventId = makeEventId(localEid, event.block.number, event.logIndex);
    const entity: DefaultUlnConfig = {
      id,
      localEid,
      eid,
      confirmations: BigInt(confirmations),
      requiredDVNCount: Number(requiredDVNCount),
      optionalDVNCount: Number(optionalDVNCount),
      optionalDVNThreshold: Number(optionalDVNThreshold),
      requiredDVNs: normalizedRequired,
      optionalDVNs: normalizedOptional,
      transactionHash,
      lastUpdatedBlock: blockNumber,
      lastUpdatedTimestamp: blockTimestamp,
      lastUpdatedByEventId: eventId,
    };

    // Validate config before storing
    validateUlnConfig(
      context,
      {
        requiredDVNCount: entity.requiredDVNCount,
        optionalDVNCount: entity.optionalDVNCount,
        optionalDVNThreshold: entity.optionalDVNThreshold,
        requiredDVNs: entity.requiredDVNs,
        optionalDVNs: entity.optionalDVNs,
      },
      "DefaultUlnConfigsSet",
      event.chainId,
      eid,
    );

    context.DefaultUlnConfig.set(entity);

    // Note: DefaultUlnConfigVersion uses composite ID (eventId_eid) because
    // DefaultUlnConfigsSet event can set multiple configs in one transaction.
    // This differs from other Version entities which use simple eventId because
    // their events only affect one config per event.
    const versionId = `${eventId}_${eid.toString()}`;
    const version: DefaultUlnConfigVersion = {
      id: versionId,
      localEid,
      eid,
      confirmations: BigInt(confirmations),
      requiredDVNCount: Number(requiredDVNCount),
      optionalDVNCount: Number(optionalDVNCount),
      optionalDVNThreshold: Number(optionalDVNThreshold),
      requiredDVNs: normalizedRequired,
      optionalDVNs: normalizedOptional,
      blockNumber,
      blockTimestamp,
      eventId,
      transactionHash,
    };
    context.DefaultUlnConfigVersion.set(version);

    await recomputeSecurityConfigsForScope(
      context,
      event.chainId,
      localEid,
      eid,
      blockNumber,
      blockTimestamp,
      eventId,
      transactionHash,
    );
  }
});

EndpointV2.ReceiveLibrarySet.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const localEid = resolveLocalEid(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const eventId = makeEventId(localEid, event.block.number, event.logIndex);
  const transactionHash = event.transaction.hash;
  const receiver = normalizeAddress(event.params.receiver);
  if (!receiver) {
    context.log.warn("ReceiveLibrarySet missing receiver", {
      chainId: event.chainId,
      localEid: localEid.toString(),
      eid: event.params.eid,
      rawValue: event.params.receiver,
      eventId,
      transactionHash,
    });
    return;
  }
  const oappId = makeOAppId(localEid, receiver);
  const configId = makeSecurityConfigId(oappId, event.params.eid);
  const normalizedLibrary = normalizeAddress(event.params.newLib);
  if (!normalizedLibrary) {
    context.log.warn("ReceiveLibrarySet missing newLib", {
      chainId: event.chainId,
      localEid: localEid.toString(),
      eid: event.params.eid,
      receiver: event.params.receiver,
      rawValue: event.params.newLib,
      eventId,
      transactionHash,
    });
    return;
  }

  const oappDefaults: OApp = {
    id: oappId,
    localEid,
    address: receiver,
    totalPacketsReceived: 0n,
    lastPacketBlock: undefined,
    lastPacketTimestamp: undefined,
  };
  await context.OApp.getOrCreate(oappDefaults);

  const libraryEntity: OAppReceiveLibrary = {
    id: configId,
    oappId,
    localEid,
    oapp: receiver,
    eid: event.params.eid,
    library: normalizedLibrary,
    transactionHash,
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: blockTimestamp,
    lastUpdatedByEventId: eventId,
  };
  context.OAppReceiveLibrary.set(libraryEntity);

  const libraryVersion: OAppReceiveLibraryVersion = {
    id: eventId,
    oappId,
    localEid,
    oapp: receiver,
    eid: event.params.eid,
    library: normalizedLibrary,
    blockNumber,
    blockTimestamp,
    eventId,
    transactionHash,
  };
  context.OAppReceiveLibraryVersion.set(libraryVersion);

  await computeAndPersistEffectiveConfig({
    context,
    chainId: event.chainId,
    localEid,
    oappId,
    oappAddress: receiver,
    eid: event.params.eid,
    blockNumber,
    blockTimestamp,
    eventId,
    transactionHash,
  });
});

ReceiveUln302.UlnConfigSet.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const localEid = resolveLocalEid(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const eventId = makeEventId(localEid, event.block.number, event.logIndex);
  const transactionHash = event.transaction.hash;
  const receiver = normalizeAddress(event.params.oapp);
  if (!receiver) {
    context.log.warn("UlnConfigSet missing oapp address", {
      chainId: event.chainId,
      localEid: localEid.toString(),
      eid: event.params.eid,
      rawValue: event.params.oapp,
      eventId,
      transactionHash,
    });
    return;
  }
  const oappId = makeOAppId(localEid, receiver);
  const configId = makeSecurityConfigId(oappId, event.params.eid);

  // Use destructuring for better readability and type safety
  const [
    confirmations,
    requiredDVNCount,
    optionalDVNCount,
    optionalDVNThreshold,
    requiredDVNs,
    optionalDVNs,
  ] = event.params.config;

  // Check for zero addresses before normalization
  checkForZeroAddresses(
    context,
    requiredDVNs,
    `UlnConfigSet(${oappId})`,
    event.chainId,
    event.params.eid,
    "required",
  );
  checkForZeroAddresses(
    context,
    optionalDVNs,
    `UlnConfigSet(${oappId})`,
    event.chainId,
    event.params.eid,
    "optional",
  );

  const normalizedRequired = uniqueNormalizedAddresses(requiredDVNs);
  const normalizedOptional = uniqueNormalizedAddresses(optionalDVNs);

  const oappDefaults: OApp = {
    id: oappId,
    localEid,
    address: receiver,
    totalPacketsReceived: 0n,
    lastPacketBlock: undefined,
    lastPacketTimestamp: undefined,
  };
  await context.OApp.getOrCreate(oappDefaults);

  const configEntity: OAppUlnConfig = {
    id: configId,
    oappId,
    localEid,
    oapp: receiver,
    eid: event.params.eid,
    confirmations: BigInt(confirmations),
    requiredDVNCount: Number(requiredDVNCount),
    optionalDVNCount: Number(optionalDVNCount),
    optionalDVNThreshold: Number(optionalDVNThreshold),
    requiredDVNs: normalizedRequired,
    optionalDVNs: normalizedOptional,
    transactionHash,
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: blockTimestamp,
    lastUpdatedByEventId: eventId,
  };

  // Validate config before storing
  validateUlnConfig(
    context,
    {
      requiredDVNCount: configEntity.requiredDVNCount,
      optionalDVNCount: configEntity.optionalDVNCount,
      optionalDVNThreshold: configEntity.optionalDVNThreshold,
      requiredDVNs: configEntity.requiredDVNs,
      optionalDVNs: configEntity.optionalDVNs,
    },
    `UlnConfigSet(${oappId})`,
    event.chainId,
    event.params.eid,
  );

  context.OAppUlnConfig.set(configEntity);

  const configVersion: OAppUlnConfigVersion = {
    id: eventId,
    oappId,
    localEid,
    oapp: receiver,
    eid: event.params.eid,
    confirmations: BigInt(confirmations),
    requiredDVNCount: Number(requiredDVNCount),
    optionalDVNCount: Number(optionalDVNCount),
    optionalDVNThreshold: Number(optionalDVNThreshold),
    requiredDVNs: normalizedRequired,
    optionalDVNs: normalizedOptional,
    blockNumber,
    blockTimestamp,
    eventId,
    transactionHash,
  };
  context.OAppUlnConfigVersion.set(configVersion);

  await computeAndPersistEffectiveConfig({
    context,
    chainId: event.chainId,
    localEid,
    oappId,
    oappAddress: receiver,
    eid: event.params.eid,
    blockNumber,
    blockTimestamp,
    eventId,
    transactionHash,
  });
});

EndpointV2.PacketDelivered.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const localEid = resolveLocalEid(event.chainId);

  try {
    const [srcEid, sender, nonce] = event.params.origin;
    const blockNumber = toBigInt(event.block.number);
    const blockTimestamp = toBigInt(event.block.timestamp);
    const eventId = makeEventId(localEid, event.block.number, event.logIndex);
    const transactionHash = event.transaction.hash;
    const receiver = normalizeAddress(event.params.receiver);
    if (!receiver) {
      context.log.error("PacketDelivered missing receiver", {
        chainId: event.chainId,
        localEid: localEid.toString(),
        blockNumber: event.block.number,
        logIndex: event.logIndex,
        rawValue: event.params.receiver,
        eventId,
        transactionHash,
      });
      return;
    }
    const oappId = makeOAppId(localEid, receiver);

    const oappDefaults: OApp = {
      id: oappId,
      localEid,
      address: receiver,
      totalPacketsReceived: 0n,
      lastPacketBlock: undefined,
      lastPacketTimestamp: undefined,
    };
    const oapp = await context.OApp.getOrCreate(oappDefaults);

    const updatedOApp: OApp = {
      ...oapp,
      totalPacketsReceived: oapp.totalPacketsReceived + 1n,
      lastPacketBlock: blockNumber,
      lastPacketTimestamp: blockTimestamp,
    };
    context.OApp.set(updatedOApp);

    const statsId = makeSecurityConfigId(oappId, srcEid);
    const statsDefaults: OAppEidPacketStats = {
      id: statsId,
      oappId,
      localEid,
      oapp: receiver,
      srcEid,
      packetCount: 0n,
      lastPacketBlock: undefined,
      lastPacketTimestamp: undefined,
      lastPacketSecurityConfigId: undefined,
    };
    const stats = await context.OAppEidPacketStats.getOrCreate(statsDefaults);

    const securityConfig = await computeAndPersistEffectiveConfig({
      context,
      chainId: event.chainId,
      localEid,
      oappId,
      oappAddress: receiver,
      eid: srcEid,
      blockNumber,
      blockTimestamp,
      eventId,
      transactionHash,
    });

    const updatedStats: OAppEidPacketStats = {
      ...stats,
      packetCount: stats.packetCount + 1n,
      lastPacketBlock: blockNumber,
      lastPacketTimestamp: blockTimestamp,
      lastPacketSecurityConfigId: securityConfig.id,
    };
    context.OAppEidPacketStats.set(updatedStats);

    const packetEntity: PacketDeliveredEntity = {
      id: eventId,
      localEid,
      blockNumber,
      blockTimestamp,
      receiver,
      srcEid,
      sender,
      nonce,
      oappId,
      securityConfigId: securityConfig.id,
      transactionHash,
      effectiveReceiveLibrary: securityConfig.effectiveReceiveLibrary,
      effectiveConfirmations: securityConfig.effectiveConfirmations,
      effectiveRequiredDVNCount: securityConfig.effectiveRequiredDVNCount,
      effectiveOptionalDVNCount: securityConfig.effectiveOptionalDVNCount,
      effectiveOptionalDVNThreshold: securityConfig.effectiveOptionalDVNThreshold,
      effectiveRequiredDVNs: securityConfig.effectiveRequiredDVNs,
      effectiveOptionalDVNs: securityConfig.effectiveOptionalDVNs,
      isConfigTracked: securityConfig.isConfigTracked,
      usesDefaultLibrary: securityConfig.usesDefaultLibrary,
      usesDefaultConfig: securityConfig.usesDefaultConfig,
      usesRequiredDVNSentinel: securityConfig.usesRequiredDVNSentinel,
      fallbackFields: securityConfig.fallbackFields,
      defaultLibraryVersionId: securityConfig.defaultLibraryVersionId,
      defaultConfigVersionId: securityConfig.defaultConfigVersionId,
      libraryOverrideVersionId: securityConfig.libraryOverrideVersionId,
      configOverrideVersionId: securityConfig.configOverrideVersionId,
    };

    context.PacketDelivered.set(packetEntity);
  } catch (error) {
    context.log.error(
      "Failed to process PacketDelivered event",
      error instanceof Error ? error : new Error(String(error)),
    );
    context.log.error("PacketDelivered event context", {
      chainId: event.chainId,
      blockNumber: event.block.number,
      logIndex: event.logIndex,
      receiver: event.params.receiver,
      localEid: localEid.toString(),
      origin: event.params.origin,
    });
    throw error;
  }
});

OAppOFT.PeerSet.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const localEid = resolveLocalEid(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const eventId = makeEventId(localEid, event.block.number, event.logIndex);
  const transactionHash = event.transaction.hash;
  const oappAddress = normalizeAddress(event.srcAddress);
  if (!oappAddress) {
    context.log.warn("PeerSet missing srcAddress", {
      chainId: event.chainId,
      localEid: localEid.toString(),
      rawValue: event.srcAddress,
      eventId,
      transactionHash,
    });
    return;
  }
  const oappId = makeOAppId(localEid, oappAddress);
  const eid = event.params.eid;
  const configId = makeSecurityConfigId(oappId, eid);
  const peerValue = event.params.peer;

  const oappDefaults: OApp = {
    id: oappId,
    localEid,
    address: oappAddress,
    totalPacketsReceived: 0n,
    lastPacketBlock: undefined,
    lastPacketTimestamp: undefined,
  };
  await context.OApp.getOrCreate(oappDefaults);

  const peerEntity: OAppPeer = {
    id: configId,
    oappId,
    localEid,
    oapp: oappAddress,
    eid,
    peer: peerValue,
    transactionHash,
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: blockTimestamp,
    lastUpdatedByEventId: eventId,
  };
  context.OAppPeer.set(peerEntity);

  const peerVersion: OAppPeerVersion = {
    id: eventId,
    oappId,
    localEid,
    oapp: oappAddress,
    eid,
    peer: peerValue,
    transactionHash,
    blockNumber,
    blockTimestamp,
    eventId,
  };
  context.OAppPeerVersion.set(peerVersion);

  const securityConfig = await computeAndPersistEffectiveConfig({
    context,
    chainId: event.chainId,
    localEid,
    oappId,
    oappAddress,
    eid,
    blockNumber,
    blockTimestamp,
    eventId,
    transactionHash,
  });

  const updatedSecurityConfig: OAppSecurityConfig = {
    ...securityConfig,
    peer: peerValue,
    peerLastUpdatedBlock: blockNumber,
    peerLastUpdatedTimestamp: blockTimestamp,
    peerLastUpdatedEventId: eventId,
    peerTransactionHash: transactionHash,
  };
  context.OAppSecurityConfig.set(updatedSecurityConfig);
}, { wildcard: true });

OAppOFT.RateLimiterSet.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const localEid = resolveLocalEid(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const eventId = makeEventId(localEid, event.block.number, event.logIndex);
  const transactionHash = event.transaction.hash;
  const oappAddress = normalizeAddress(event.srcAddress);
  if (!oappAddress) {
    context.log.warn("RateLimiterSet missing srcAddress", {
      chainId: event.chainId,
      localEid: localEid.toString(),
      rawValue: event.srcAddress,
      eventId,
      transactionHash,
    });
    return;
  }
  const oappId = makeOAppId(localEid, oappAddress);
  const normalizedRateLimiter = normalizeAddress(event.params.rateLimiter);

  const oappDefaults: OApp = {
    id: oappId,
    localEid,
    address: oappAddress,
    totalPacketsReceived: 0n,
    lastPacketBlock: undefined,
    lastPacketTimestamp: undefined,
  };
  await context.OApp.getOrCreate(oappDefaults);

  const rateLimiterEntity: OAppRateLimiter = {
    id: oappId,
    oappId,
    localEid,
    oapp: oappAddress,
    rateLimiter: normalizedRateLimiter,
    transactionHash,
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: blockTimestamp,
    lastUpdatedByEventId: eventId,
  };
  context.OAppRateLimiter.set(rateLimiterEntity);

  const rateLimiterVersion: OAppRateLimiterVersion = {
    id: eventId,
    oappId,
    localEid,
    oapp: oappAddress,
    rateLimiter: normalizedRateLimiter,
    transactionHash,
    blockNumber,
    blockTimestamp,
    eventId,
  };
  context.OAppRateLimiterVersion.set(rateLimiterVersion);
}, { wildcard: true });

OAppOFT.RateLimitsChanged.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const localEid = resolveLocalEid(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const eventId = makeEventId(localEid, event.block.number, event.logIndex);
  const transactionHash = event.transaction.hash;
  const oappAddress = normalizeAddress(event.srcAddress);
  if (!oappAddress) {
    context.log.warn("RateLimitsChanged missing srcAddress", {
      chainId: event.chainId,
      localEid: localEid.toString(),
      rawValue: event.srcAddress,
      eventId,
      transactionHash,
    });
    return;
  }
  const oappId = makeOAppId(localEid, oappAddress);

  const oappDefaults: OApp = {
    id: oappId,
    localEid,
    address: oappAddress,
    totalPacketsReceived: 0n,
    lastPacketBlock: undefined,
    lastPacketTimestamp: undefined,
  };
  await context.OApp.getOrCreate(oappDefaults);

  for (const [rawDstEid, rawLimit, rawWindow] of event.params.rateLimitConfigs) {
    const dstEid = BigInt(rawDstEid);
    const limit = BigInt(rawLimit);
    const window = BigInt(rawWindow);
    const configId = makeSecurityConfigId(oappId, dstEid);
    const versionId = `${eventId}_${dstEid.toString()}`;

    const rateLimitEntity: OAppRateLimit = {
      id: configId,
      oappId,
      localEid,
      oapp: oappAddress,
      dstEid,
      limit,
      window,
      transactionHash,
      lastUpdatedBlock: blockNumber,
      lastUpdatedTimestamp: blockTimestamp,
      lastUpdatedByEventId: eventId,
    };
    context.OAppRateLimit.set(rateLimitEntity);

    const rateLimitVersion: OAppRateLimitVersion = {
      id: versionId,
      oappId,
      localEid,
      oapp: oappAddress,
      dstEid,
      limit,
      window,
      transactionHash,
      blockNumber,
      blockTimestamp,
      eventId,
    };
    context.OAppRateLimitVersion.set(rateLimitVersion);
  }
}, { wildcard: true });
