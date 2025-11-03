/**
 * OApp Security Config Query
 * Resolves the current security posture for a single OApp
 */
export const OAPP_SECURITY_CONFIG_QUERY = `
  query CurrentSecurityConfig($oappId: String!, $localEid: numeric!) {
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
    DefaultReceiveLibrary(where: { localEid: { _eq: $localEid } }) {
      localEid
      eid
      library
      lastUpdatedByEventId
      lastUpdatedBlock
      lastUpdatedTimestamp
      transactionHash
    }
    DefaultUlnConfig(where: { localEid: { _eq: $localEid } }) {
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
    OAppReceiveLibrary(where: { oappId: { _eq: $oappId } }) {
      oappId
      eid
      library
      lastUpdatedByEventId
      lastUpdatedBlock
      lastUpdatedTimestamp
      transactionHash
    }
    OAppUlnConfig(where: { oappId: { _eq: $oappId } }) {
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
  }
`;
