/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
  DefaultReceiveLibrary,
  DefaultUlnConfig,
  EndpointV2,
  OApp,
  OAppEidPacketStats,
  OAppSecurityConfig,
  PacketDelivered as PacketDeliveredEntity,
  ReceiveUln302,
  handlerContext,
} from "generated";

const normalizeAddress = (
  value: string | undefined | null,
): string | undefined => (value ? value.toLowerCase() : undefined);

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

const makeStatsId = (oappId: string, srcEid: bigint): string =>
  `${oappId}_${srcEid.toString()}`;

const toBigInt = (value: number): bigint => BigInt(value);

type EnsureSecurityConfigArgs = {
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

const ensureSecurityConfig = async ({
  context,
  chainId,
  chainIdBigInt,
  oappId,
  oappAddress,
  eid,
  blockNumber,
  blockTimestamp,
  eventId,
}: EnsureSecurityConfigArgs): Promise<OAppSecurityConfig | undefined> => {
  const configId = makeSecurityConfigId(oappId, eid);
  const existingConfig = await context.OAppSecurityConfig.get(configId);
  if (existingConfig) {
    return existingConfig;
  }

  const defaultKey = makeDefaultScopedId(chainId, eid);
  const defaultLibrary = await context.DefaultReceiveLibrary.get(defaultKey);
  const defaultConfig = await context.DefaultUlnConfig.get(defaultKey);

  const defaultRequired = defaultConfig?.requiredDVNs ?? [];
  const defaultOptional = defaultConfig?.optionalDVNs ?? [];

  const entity: OAppSecurityConfig = {
    id: configId,
    oappId,
    chainId: chainIdBigInt,
    oapp: oappAddress,
    eid,
    receiveLibrary: normalizeAddress(defaultLibrary?.library),
    configConfirmations: defaultConfig?.confirmations,
    configRequiredDVNCount: defaultConfig?.requiredDVNCount,
    configOptionalDVNCount: defaultConfig?.optionalDVNCount,
    configOptionalDVNThreshold: defaultConfig?.optionalDVNThreshold,
    configRequiredDVNs: defaultRequired.map(
      addr => normalizeAddress(addr) ?? addr.toLowerCase(),
    ),
    configOptionalDVNs: defaultOptional.map(
      addr => normalizeAddress(addr) ?? addr.toLowerCase(),
    ),
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: blockTimestamp,
    lastUpdatedByEventId: eventId,
  };

  context.OAppSecurityConfig.set(entity);
  return entity;
};

EndpointV2.DefaultReceiveLibrarySet.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const chainIdBigInt = BigInt(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const id = makeDefaultScopedId(event.chainId, event.params.eid);

  const normalizedLibrary =
    normalizeAddress(event.params.newLib) ?? event.params.newLib.toLowerCase();

  const entity: DefaultReceiveLibrary = {
    id,
    chainId: chainIdBigInt,
    eid: event.params.eid,
    library: normalizedLibrary,
    blockNumber,
    blockTimestamp,
  };

  context.DefaultReceiveLibrary.set(entity);
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
    const entity: DefaultUlnConfig = {
      id,
      chainId: chainIdBigInt,
      eid,
      confirmations,
      requiredDVNCount: Number(requiredDVNCount),
      optionalDVNCount: Number(optionalDVNCount),
      optionalDVNThreshold: Number(optionalDVNThreshold),
      requiredDVNs: requiredDVNs.map(
        addr => normalizeAddress(addr) ?? addr.toLowerCase(),
      ),
      optionalDVNs: optionalDVNs.map(
        addr => normalizeAddress(addr) ?? addr.toLowerCase(),
      ),
      blockNumber,
      blockTimestamp,
    };

    context.DefaultUlnConfig.set(entity);
  }
});

EndpointV2.ReceiveLibrarySet.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const chainIdBigInt = BigInt(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const receiver =
    normalizeAddress(event.params.receiver) ?? event.params.receiver.toLowerCase();
  const oappId = makeOAppId(event.chainId, receiver);
  const eventId = makeEventId(event.chainId, event.block.number, event.logIndex);

  const oappDefaults: OApp = {
    id: oappId,
    chainId: chainIdBigInt,
    address: receiver,
    totalPacketsReceived: 0n,
    lastPacketBlock: undefined,
    lastPacketTimestamp: undefined,
  };
  await context.OApp.getOrCreate(oappDefaults);

  const existingBase = await ensureSecurityConfig({
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

  const configId = makeSecurityConfigId(oappId, event.params.eid);
  const existing = existingBase ?? (await context.OAppSecurityConfig.get(configId));

  const entity: OAppSecurityConfig = {
    id: configId,
    oappId,
    chainId: chainIdBigInt,
    oapp: receiver,
    eid: event.params.eid,
    receiveLibrary: normalizeAddress(event.params.newLib),
    configConfirmations: existing?.configConfirmations,
    configRequiredDVNCount: existing?.configRequiredDVNCount,
    configOptionalDVNCount: existing?.configOptionalDVNCount,
    configOptionalDVNThreshold: existing?.configOptionalDVNThreshold,
    configRequiredDVNs: existing?.configRequiredDVNs ?? [],
    configOptionalDVNs: existing?.configOptionalDVNs ?? [],
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: blockTimestamp,
    lastUpdatedByEventId: eventId,
  };

  context.OAppSecurityConfig.set(entity);
});

ReceiveUln302.UlnConfigSet.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const chainIdBigInt = BigInt(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const receiver =
    normalizeAddress(event.params.oapp) ?? event.params.oapp.toLowerCase();
  const oappId = makeOAppId(event.chainId, receiver);
  const eventId = makeEventId(event.chainId, event.block.number, event.logIndex);

  const oappDefaults: OApp = {
    id: oappId,
    chainId: chainIdBigInt,
    address: receiver,
    totalPacketsReceived: 0n,
    lastPacketBlock: undefined,
    lastPacketTimestamp: undefined,
  };
  await context.OApp.getOrCreate(oappDefaults);

  const existingBase = await ensureSecurityConfig({
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

  const config = event.params.config;
  const requiredDVNs = config[4].map(
    addr => normalizeAddress(addr) ?? addr.toLowerCase(),
  );
  const optionalDVNs = config[5].map(
    addr => normalizeAddress(addr) ?? addr.toLowerCase(),
  );
  const configId = makeSecurityConfigId(oappId, event.params.eid);
  const existing = existingBase ?? (await context.OAppSecurityConfig.get(configId));

  const entity: OAppSecurityConfig = {
    id: configId,
    oappId,
    chainId: chainIdBigInt,
    oapp: receiver,
    eid: event.params.eid,
    receiveLibrary: existing?.receiveLibrary,
    configConfirmations: config[0],
    configRequiredDVNCount: Number(config[1]),
    configOptionalDVNCount: Number(config[2]),
    configOptionalDVNThreshold: Number(config[3]),
    configRequiredDVNs: requiredDVNs,
    configOptionalDVNs: optionalDVNs,
    lastUpdatedBlock: blockNumber,
    lastUpdatedTimestamp: blockTimestamp,
    lastUpdatedByEventId: eventId,
  };

  context.OAppSecurityConfig.set(entity);
});

EndpointV2.PacketDelivered.handler(async ({ event, context }) => {
  if (context.isPreload) return;

  const [srcEid, sender, nonce] = event.params.origin;
  const chainIdBigInt = BigInt(event.chainId);
  const blockNumber = toBigInt(event.block.number);
  const blockTimestamp = toBigInt(event.block.timestamp);
  const receiver =
    normalizeAddress(event.params.receiver) ?? event.params.receiver.toLowerCase();
  const oappId = makeOAppId(event.chainId, receiver);
  const eventId = makeEventId(event.chainId, event.block.number, event.logIndex);

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

  const statsId = makeStatsId(oappId, srcEid);
  const statsDefaults: OAppEidPacketStats = {
    id: statsId,
    oappId,
    chainId: chainIdBigInt,
    oapp: receiver,
    srcEid,
    packetCount: 0n,
    lastPacketBlock: undefined,
    lastPacketTimestamp: undefined,
  };
  const stats = await context.OAppEidPacketStats.getOrCreate(statsDefaults);

  const updatedStats: OAppEidPacketStats = {
    ...stats,
    packetCount: stats.packetCount + 1n,
    lastPacketBlock: blockNumber,
    lastPacketTimestamp: blockTimestamp,
  };
  context.OAppEidPacketStats.set(updatedStats);

  const securityConfig = await ensureSecurityConfig({
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
    securityConfigId: securityConfig?.id,
    receiveLibrary: securityConfig?.receiveLibrary,
    configConfirmations: securityConfig?.configConfirmations,
    configRequiredDVNCount: securityConfig?.configRequiredDVNCount,
    configOptionalDVNCount: securityConfig?.configOptionalDVNCount,
    configOptionalDVNThreshold: securityConfig?.configOptionalDVNThreshold,
  };

  context.PacketDelivered.set(packetEntity);
});
