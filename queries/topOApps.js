/**
 * Top OApps Query
 * Ordered by total packets received
 */
export const TOP_OAPPS_QUERY = `
  query TopOApps($limit: Int, $minPackets: numeric!) {
    OAppStats(
      order_by: { totalPacketsReceived: desc }
      limit: $limit
      where: { totalPacketsReceived: { _gte: $minPackets } }
    ) {
      id
      localEid
      address
      totalPacketsReceived
      lastPacketBlock
      lastPacketTimestamp
    }
  }
`;
