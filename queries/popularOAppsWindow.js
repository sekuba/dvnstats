export const POPULAR_OAPPS_WINDOW_QUERY = `
  query PopularOAppsWindow($fromTimestamp: numeric!, $fetchLimit: Int) {
    PacketDelivered(
      where: { blockTimestamp: { _gte: $fromTimestamp } }
      order_by: { blockTimestamp: desc }
      limit: $fetchLimit
    ) {
      id
      oappId
      localEid
      receiver
      blockTimestamp
      blockNumber
      srcEid
    }
  }
`;
