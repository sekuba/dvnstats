import {
  DefaultReceiveLibrary,
  DefaultReceiveLibraryVersion,
  DefaultUlnConfig,
  DefaultUlnConfigVersion,
  DvnMetadata,
  OApp,
  OAppEidPacketStats,
  OAppReceiveLibrary,
  OAppReceiveLibraryVersion,
  OAppSecurityConfig,
  OAppUlnConfig,
  OAppUlnConfigVersion,
  PacketDelivered as PacketDeliveredEntity,
  EndpointV2,
  ReceiveUln302,
  handlerContext,
} from "generated";
import layerzeroMetadata from "../layerzero.json";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SENTINEL_REQUIRED_DVN_COUNT = 255;
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

const buildChainAwareDvnLookup = (raw: unknown): Map<string, string> => {
  const map = new Map<string, string>();
  if (!raw || typeof raw !== "object") return map;

  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const chainDetails = (value as { chainDetails?: { nativeChainId?: number } }).chainDetails;
    const nativeChainId = chainDetails?.nativeChainId;
    if (typeof nativeChainId !== "number") continue;
    const dvns = (value as Record<string, unknown>).dvns;
    if (!dvns || typeof dvns !== "object") continue;
    for (const [address, details] of Object.entries(
      dvns as Record<string, unknown>,
    )) {
      const normalized = normalizeAddress(address);
      if (!normalized || isZeroAddress(normalized)) continue;
      const info = details as { canonicalName?: string; id?: string; name?: string };
      const name = info.canonicalName ?? info.name ?? info.id;
      if (!name) continue;
      map.set(`${nativeChainId}_${normalized}`, name);
    }
  }

  return map;
};

const DVN_CHAIN_AWARE_LOOKUP = buildChainAwareDvnLookup(layerzeroMetadata);

const getDvnName = (chainId: number, address: string): string | undefined =>
  DVN_CHAIN_AWARE_LOOKUP.get(`${chainId}_${address}`);

const RECEIVE_ULN_302_PER_CHAIN: Record<number, string> = {
  1: "0xc02ab410f0734efa3f14628780e6e695156024c2",
  10: "0x3c4962ff6258dcfcafd23a814237b7d6eb712063",
  56: "0xb217266c3a98c8b2709ee26836c98cf12f6ccec1",
  130: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  137: "0x1322871e4ab09bc7f5717189434f97bbd9546e95",
  324: "0x04830f6decf08dec9ed6c3fcad215245b78a59e1",
  480: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  999: "0x7cacbe439ead55fa1c22790330b12835c6884a91",
  1135: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  1868: "0x364b548d8e6db7ca84aaafa54595919eccf961ea",
  8453: "0xc70ab6f32772f59fbfc23889caf4ba3376c84baf",
  34443: "0xc1b621b18187f74c8f6d52a6f709dd2780c09821",
  42161: "0x7b9e184e07a6ee1ac23eae0fe8d6be2f663f05e6",
  57073: "0x473132bb594caef281c68718f4541f73fe14dc89",
  59144: "0xe22ed54177ce1148c557de74e4873619e6c6b205",
  81457: "0x377530cda84dfb2673bf4d145dcf0c4d7fdcb5b6",
  534352: "0x8363302080e711e0cab978c081b9e69308d49808",
  7777777: "0x57d9775ee8fec31f1b612a06266f599da167d211",
};

const TRACKED_LIBRARY_PER_CHAIN = new Map<number, string>(
  Object.entries(RECEIVE_ULN_302_PER_CHAIN).map(([chainId, address]) => [
    Number(chainId),
    address,
  ]),
);

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
  chainIdBigInt: bigint;
  oappId: string;
  oappAddress: string;
  eid: bigint;
  blockNumber: bigint;
  blockTimestamp: bigint;
  eventId: string;
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

const ensureDvnMetadataEntries = async (
  context: handlerContext,
  chainId: number,
  addresses: readonly string[],
): Promise<void> => {
  if (!addresses || addresses.length === 0) return;

  const unique = new Set(
    addresses
      .map(addr => normalizeAddress(addr))
      .filter((addr): addr is string => !!addr && !isZeroAddress(addr)),
  );

  for (const address of unique) {
    const id = `${chainId}_${address}`;
    const existing = await context.DvnMetadata.get(id);
    const name = getDvnName(chainId, address) ?? address;

    if (existing) {
      if (existing.name !== name) {
        context.DvnMetadata.set({ ...existing, name });
      }
      continue;
    }

    const entity: DvnMetadata = {
      id,
      chainId,
      address,
      name,
    };
    context.DvnMetadata.set(entity);
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

  const hasValues =
    (confirmations !== undefined && confirmations !== 0n) ||
    (requiredDVNCount !== undefined &&
      (requiredDVNCount > 0 || requiredDVNCount === SENTINEL_REQUIRED_DVN_COUNT)) ||
    (optionalDVNCount !== undefined && optionalDVNCount > 0) ||
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
  chainId: number,
  blockNumber: number,
  logIndex: number,
): string => `${chainId}_${blockNumber}_${logIndex}`;

const makeDefaultScopedId = (chainId: number, eid: bigint): string =>
  `${chainId}_${eid.toString()}`;

const makeOAppId = (chainId: number, address: string): string =>
  `${chainId}_${address}`;

const makeSecurityConfigId = (oappId: string, eid: bigint): string =>
  `${oappId}_${eid.toString()}`;

const toBigInt = (value: number | bigint): bigint => BigInt(value);

const getTrackedReceiveLibrary = (chainId: number): string | undefined =>
  TRACKED_LIBRARY_PER_CHAIN.get(chainId);

const isTrackedReceiveLibrary = (
  chainId: number,
  library?: string,
): boolean => {
  if (!library) return false;
  const tracked = getTrackedReceiveLibrary(chainId);
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
  chainId: number,
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
    chainId,
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
  const defaultHasConfig = defaultConfig.hasValues;

  const overrideConfirmations = overrideConfig.confirmations;
  const defaultConfirmations = defaultConfig.confirmations;
  let effectiveConfirmations: bigint | undefined;
  if (
    overrideConfirmations !== undefined &&
    overrideConfirmations !== 0n
  ) {
    effectiveConfirmations = overrideConfirmations;
  } else if (defaultConfirmations !== undefined) {
    effectiveConfirmations = defaultConfirmations;
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
  if (overrideOptionalCount !== undefined && overrideOptionalCount > 0) {
    rawOptionalCount = overrideOptionalCount;
  } else if (defaultOptionalCount !== undefined) {
    rawOptionalCount = defaultOptionalCount;
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

  if (
    effectiveOptionalDVNThreshold !== undefined &&
    effectiveOptionalDVNCount >= 0
  ) {
    if (effectiveOptionalDVNThreshold > effectiveOptionalDVNCount) {
      effectiveOptionalDVNThreshold = effectiveOptionalDVNCount;
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
  chainIdBigInt,
  oappId,
  oappAddress,
  eid,
  blockNumber,
  blockTimestamp,
  eventId,
}: ComputeEffectiveConfigArgs): Promise<OAppSecurityConfig> => {
  const defaultKey = makeDefaultScopedId(chainId, eid);
  const configId = makeSecurityConfigId(oappId, eid);

  const [
    defaultLibrary,
    defaultConfig,
    libraryOverride,
    configOverride,
  ] = await Promise.all([
    context.DefaultReceiveLibrary.get(defaultKey),
    context.DefaultUlnConfig.get(defaultKey),
    context.OAppReceiveLibrary.get(configId),
    context.OAppUlnConfig.get(configId),
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

  const defaultResolved = mergeSecurityConfig(chainId, defaults);
  const resolved = mergeSecurityConfig(chainId, defaults, overrides);

  await ensureDvnMetadataEntries(
    context,
    chainId,
    resolved.effectiveRequiredDVNs.concat(resolved.effectiveOptionalDVNs),
  );

  const usesDefaultLibrary =
    resolved.effectiveReceiveLibrary ===
    defaultResolved.effectiveReceiveLibrary;
  const usesDefaultConfig =
    resolved.isConfigTracked &&
    defaultResolved.isConfigTracked &&
    configsAreEqual(resolved.comparable, defaultResolved.comparable);

  const entity: OAppSecurityConfig = {
    id: configId,
    oappId,
    chainId: chainIdBigInt,
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
    lastComputedBlock: blockNumber,
    lastComputedTimestamp: blockTimestamp,
    lastComputedByEventId: eventId,
  };

  context.OAppSecurityConfig.set(entity);
  return entity;
};

const recomputeSecurityConfigsForScope = async (
  context: handlerContext,
  chainId: number,
  chainIdBigInt: bigint,
  eid: bigint,
  blockNumber: bigint,
  blockTimestamp: bigint,
  eventId: string,
) => {
  const configsForChain =
    await context.OAppSecurityConfig.getWhere.chainId.eq(chainIdBigInt);
  if (!configsForChain || configsForChain.length === 0) return;

  for (const config of configsForChain) {
    if (config.eid !== eid) continue;
    await computeAndPersistEffectiveConfig({
      context,
      chainId,
      chainIdBigInt,
      oappId: config.oappId,
      oappAddress: config.oapp,
      eid,
      blockNumber,
      blockTimestamp,
      eventId,
    });
  }
};

EndpointV2.DefaultReceiveLibrarySet.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const chainIdBigInt = BigInt(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const eventId = makeEventId(event.chainId, event.block.number, event.logIndex);
  const id = makeDefaultScopedId(event.chainId, event.params.eid);
  const normalizedLibrary =
    normalizeAddress(event.params.newLib) ?? event.params.newLib.toLowerCase();

  const entity: DefaultReceiveLibrary = {
    id,
    chainId: chainIdBigInt,
    eid: event.params.eid,
    library: normalizedLibrary,
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: blockTimestamp,
    lastUpdatedByEventId: eventId,
  };
  context.DefaultReceiveLibrary.set(entity);

  const version: DefaultReceiveLibraryVersion = {
    id: eventId,
    chainId: chainIdBigInt,
    eid: event.params.eid,
    library: normalizedLibrary,
    blockNumber,
    blockTimestamp,
    eventId,
  };
  context.DefaultReceiveLibraryVersion.set(version);

  await recomputeSecurityConfigsForScope(
    context,
    event.chainId,
    chainIdBigInt,
    event.params.eid,
    blockNumber,
    blockTimestamp,
    eventId,
  );
});

ReceiveUln302.DefaultUlnConfigsSet.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const chainIdBigInt = BigInt(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);

  for (const [eid, config] of event.params.params) {
    const [
      confirmations,
      requiredDVNCount,
      optionalDVNCount,
      optionalDVNThreshold,
      requiredDVNs,
      optionalDVNs,
    ] = config;

    const id = makeDefaultScopedId(event.chainId, eid);
    const normalizedRequired = uniqueNormalizedAddresses(requiredDVNs);
    const normalizedOptional = uniqueNormalizedAddresses(optionalDVNs);

    const eventId = makeEventId(event.chainId, event.block.number, event.logIndex);
    const entity: DefaultUlnConfig = {
      id,
      chainId: chainIdBigInt,
      eid,
      confirmations: BigInt(confirmations),
      requiredDVNCount: Number(requiredDVNCount),
      optionalDVNCount: Number(optionalDVNCount),
      optionalDVNThreshold: Number(optionalDVNThreshold),
      requiredDVNs: normalizedRequired,
      optionalDVNs: normalizedOptional,
      lastUpdatedBlock: blockNumber,
      lastUpdatedTimestamp: blockTimestamp,
      lastUpdatedByEventId: eventId,
    };

    context.DefaultUlnConfig.set(entity);

    const versionId = `${eventId}_${eid.toString()}`;
    const version: DefaultUlnConfigVersion = {
      id: versionId,
      chainId: chainIdBigInt,
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
    };
    context.DefaultUlnConfigVersion.set(version);

    await recomputeSecurityConfigsForScope(
      context,
      event.chainId,
      chainIdBigInt,
      eid,
      blockNumber,
      blockTimestamp,
      eventId,
    );
  }
});

EndpointV2.ReceiveLibrarySet.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const chainIdBigInt = BigInt(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const eventId = makeEventId(event.chainId, event.block.number, event.logIndex);
  const receiver =
    normalizeAddress(event.params.receiver) ?? event.params.receiver.toLowerCase();
  const oappId = makeOAppId(event.chainId, receiver);
  const configId = makeSecurityConfigId(oappId, event.params.eid);
  const normalizedLibrary =
    normalizeAddress(event.params.newLib) ?? event.params.newLib.toLowerCase();

  const oappDefaults: OApp = {
    id: oappId,
    chainId: chainIdBigInt,
    address: receiver,
    totalPacketsReceived: 0n,
    lastPacketBlock: undefined,
    lastPacketTimestamp: undefined,
  };
  await context.OApp.getOrCreate(oappDefaults);

  const libraryEntity: OAppReceiveLibrary = {
    id: configId,
    oappId,
    chainId: chainIdBigInt,
    oapp: receiver,
    eid: event.params.eid,
    library: normalizedLibrary,
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: blockTimestamp,
    lastUpdatedByEventId: eventId,
  };
  context.OAppReceiveLibrary.set(libraryEntity);

  const libraryVersion: OAppReceiveLibraryVersion = {
    id: eventId,
    oappId,
    chainId: chainIdBigInt,
    oapp: receiver,
    eid: event.params.eid,
    library: normalizedLibrary,
    blockNumber,
    blockTimestamp,
    eventId,
  };
  context.OAppReceiveLibraryVersion.set(libraryVersion);

  await computeAndPersistEffectiveConfig({
    context,
    chainId: event.chainId,
    chainIdBigInt,
    oappId,
    oappAddress: receiver,
    eid: event.params.eid,
    blockNumber,
    blockTimestamp,
    eventId,
  });
});

ReceiveUln302.UlnConfigSet.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const chainIdBigInt = BigInt(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const eventId = makeEventId(event.chainId, event.block.number, event.logIndex);
  const receiver =
    normalizeAddress(event.params.oapp) ?? event.params.oapp.toLowerCase();
  const oappId = makeOAppId(event.chainId, receiver);
  const configId = makeSecurityConfigId(oappId, event.params.eid);
  const config = event.params.config;

  const normalizedRequired = uniqueNormalizedAddresses(config[4]);
  const normalizedOptional = uniqueNormalizedAddresses(config[5]);

  const oappDefaults: OApp = {
    id: oappId,
    chainId: chainIdBigInt,
    address: receiver,
    totalPacketsReceived: 0n,
    lastPacketBlock: undefined,
    lastPacketTimestamp: undefined,
  };
  await context.OApp.getOrCreate(oappDefaults);

  const configEntity: OAppUlnConfig = {
    id: configId,
    oappId,
    chainId: chainIdBigInt,
    oapp: receiver,
    eid: event.params.eid,
    confirmations: BigInt(config[0]),
    requiredDVNCount: Number(config[1]),
    optionalDVNCount: Number(config[2]),
    optionalDVNThreshold: Number(config[3]),
    requiredDVNs: normalizedRequired,
    optionalDVNs: normalizedOptional,
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: blockTimestamp,
    lastUpdatedByEventId: eventId,
  };
  context.OAppUlnConfig.set(configEntity);

  const configVersion: OAppUlnConfigVersion = {
    id: eventId,
    oappId,
    chainId: chainIdBigInt,
    oapp: receiver,
    eid: event.params.eid,
    confirmations: BigInt(config[0]),
    requiredDVNCount: Number(config[1]),
    optionalDVNCount: Number(config[2]),
    optionalDVNThreshold: Number(config[3]),
    requiredDVNs: normalizedRequired,
    optionalDVNs: normalizedOptional,
    blockNumber,
    blockTimestamp,
    eventId,
  };
  context.OAppUlnConfigVersion.set(configVersion);

  await computeAndPersistEffectiveConfig({
    context,
    chainId: event.chainId,
    chainIdBigInt,
    oappId,
    oappAddress: receiver,
    eid: event.params.eid,
    blockNumber,
    blockTimestamp,
    eventId,
  });
});

EndpointV2.PacketDelivered.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const [srcEid, sender, nonce] = event.params.origin;
  const chainIdBigInt = BigInt(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const eventId = makeEventId(event.chainId, event.block.number, event.logIndex);
  const receiver =
    normalizeAddress(event.params.receiver) ?? event.params.receiver.toLowerCase();
  const oappId = makeOAppId(event.chainId, receiver);

  const oappDefaults: OApp = {
    id: oappId,
    chainId: chainIdBigInt,
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
    chainId: chainIdBigInt,
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
    chainIdBigInt,
    oappId,
    oappAddress: receiver,
    eid: srcEid,
    blockNumber,
    blockTimestamp,
    eventId,
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
    chainId: chainIdBigInt,
    blockNumber,
    blockTimestamp,
    receiver,
    srcEid,
    sender,
    nonce,
    oappId,
    securityConfigId: securityConfig.id,
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
});
