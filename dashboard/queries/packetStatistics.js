export const PACKET_STATISTICS_QUERY = `
  query PacketStatistics($minTimestamp: numeric, $limit: Int) {
    PacketDelivered(
      order_by: { blockTimestamp: desc }
      limit: $limit
      where: { blockTimestamp: { _gte: $minTimestamp } }
    ) {
      id
      localEid
      srcEid
      receiver
      blockTimestamp
      usesDefaultLibrary
      usesDefaultConfig
      effectiveRequiredDVNs
      effectiveOptionalDVNs
      effectiveRequiredDVNCount
      effectiveOptionalDVNCount
      libraryStatus
      isConfigTracked
    }
  }
`;
