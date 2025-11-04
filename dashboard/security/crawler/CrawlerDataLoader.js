import { splitOAppId } from "../../core.js";

const SECURITY_BATCH_QUERY = `
  query GetSecurityConfigBatch($oappIds: [String!]!, $localEids: [numeric!]) {
    origin: OAppSecurityConfig(where: { oappId: { _in: $oappIds } }) {
      id
      oappId
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
    referencing: OAppSecurityConfig(where: { peerOappId: { _in: $oappIds } }) {
      id
      oappId
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
    OAppStats(where: { id: { _in: $oappIds } }) {
      id
      localEid
      address
      totalPacketsReceived
    }
    OAppPeer(where: { oappId: { _in: $oappIds } }) {
      id
      oappId
      eid
      peer
      peerOappId
      fromPacketDelivered
      lastUpdatedBlock
      lastUpdatedTimestamp
      lastUpdatedByEventId
      transactionHash
    }
    OAppRouteStats(where: { oappId: { _in: $oappIds } }) {
      id
      oappId
      srcEid
      packetCount
      lastPacketBlock
      lastPacketTimestamp
    }
    OAppReceiveLibrary(where: { oappId: { _in: $oappIds } }) {
      oappId
      eid
      library
      lastUpdatedByEventId
      lastUpdatedBlock
      lastUpdatedTimestamp
      transactionHash
    }
    OAppUlnConfig(where: { oappId: { _in: $oappIds } }) {
      oappId
      eid
      confirmations
      requiredDVNCount
      optionalDVNCount
      optionalDVNThreshold
      requiredDVNs
      optionalDVNs
      lastUpdatedByEventId
      lastUpdatedBlock
      lastUpdatedTimestamp
      transactionHash
    }
    DefaultReceiveLibrary(where: { localEid: { _in: $localEids } }) {
      localEid
      eid
      library
      lastUpdatedByEventId
      lastUpdatedBlock
      lastUpdatedTimestamp
      transactionHash
    }
    DefaultUlnConfig(where: { localEid: { _in: $localEids } }) {
      localEid
      eid
      confirmations
      requiredDVNCount
      optionalDVNCount
      optionalDVNThreshold
      requiredDVNs
      optionalDVNs
      lastUpdatedByEventId
      lastUpdatedBlock
      lastUpdatedTimestamp
      transactionHash
    }
  }
`;

export class CrawlerDataLoader {
  constructor(client) {
    this.client = client;
  }

  async fetchBatch(oappIds) {
    if (!Array.isArray(oappIds) || oappIds.length === 0) {
      return this.emptyBatch();
    }

    const uniqueIds = Array.from(new Set(oappIds));
    const localEidSet = new Set();
    uniqueIds.forEach((id) => {
      const { localEid } = splitOAppId(id);
      if (localEid === null || localEid === undefined) {
        return;
      }
      const numeric = Number(localEid);
      if (Number.isFinite(numeric)) {
        localEidSet.add(numeric);
      }
    });
    const localEids = Array.from(localEidSet);

    const variables = { oappIds: uniqueIds, localEids };
    const data = await this.client.query(SECURITY_BATCH_QUERY, variables);
    return this.buildMaps(data);
  }

  emptyBatch() {
    return {
      origin: new Map(),
      referencing: new Map(),
      oapps: new Map(),
      peerRecordsByOapp: new Map(),
      defaultLibraries: new Map(),
      defaultConfigs: new Map(),
      oappLibraries: new Map(),
      oappConfigs: new Map(),
      routeStats: new Map(),
    };
  }

  buildMaps(data) {
    if (!data || typeof data !== "object") {
      return this.emptyBatch();
    }

    const originMap = new Map();
    (data.origin || []).forEach((cfg) => {
      const key = String(cfg.oappId);
      if (!originMap.has(key)) originMap.set(key, []);
      originMap.get(key).push(cfg);
    });

    const referencingMap = new Map();
    (data.referencing || []).forEach((cfg) => {
      const key = cfg.peerOappId ? String(cfg.peerOappId) : null;
      if (!key) return;
      if (!referencingMap.has(key)) referencingMap.set(key, []);
      referencingMap.get(key).push(cfg);
    });

    const oappMap = new Map();
    (data.OAppStats || []).forEach((oapp) => {
      oappMap.set(String(oapp.id), oapp);
    });

    const peerRecordsByOapp = new Map();
    (data.OAppPeer || []).forEach((peer) => {
      const oappKey = String(peer.oappId);
      const eidKey = peer.eid !== undefined && peer.eid !== null ? String(peer.eid) : "__unknown__";
      if (!peerRecordsByOapp.has(oappKey)) {
        peerRecordsByOapp.set(oappKey, new Map());
      }
      peerRecordsByOapp.get(oappKey).set(eidKey, peer);
    });

    const defaultLibraryMap = new Map();
    (data.DefaultReceiveLibrary || []).forEach((row) => {
      const key = String(row.localEid);
      if (!defaultLibraryMap.has(key)) defaultLibraryMap.set(key, []);
      defaultLibraryMap.get(key).push(row);
    });

    const defaultConfigMap = new Map();
    (data.DefaultUlnConfig || []).forEach((row) => {
      const key = String(row.localEid);
      if (!defaultConfigMap.has(key)) defaultConfigMap.set(key, []);
      defaultConfigMap.get(key).push(row);
    });

    const oappLibraryMap = new Map();
    (data.OAppReceiveLibrary || []).forEach((row) => {
      const key = String(row.oappId);
      if (!oappLibraryMap.has(key)) oappLibraryMap.set(key, []);
      oappLibraryMap.get(key).push(row);
    });

    const oappConfigMap = new Map();
    (data.OAppUlnConfig || []).forEach((row) => {
      const key = String(row.oappId);
      if (!oappConfigMap.has(key)) oappConfigMap.set(key, []);
      oappConfigMap.get(key).push(row);
    });

    const routeStatsMap = new Map();
    (data.OAppRouteStats || []).forEach((row) => {
      const key = String(row.oappId);
      if (!routeStatsMap.has(key)) routeStatsMap.set(key, []);
      routeStatsMap.get(key).push(row);
    });

    return {
      origin: originMap,
      referencing: referencingMap,
      oapps: oappMap,
      peerRecordsByOapp,
      defaultLibraries: defaultLibraryMap,
      defaultConfigs: defaultConfigMap,
      oappLibraries: oappLibraryMap,
      oappConfigs: oappConfigMap,
      routeStats: routeStatsMap,
    };
  }
}
