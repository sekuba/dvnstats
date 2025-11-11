import { coerceToNumber, isDefined } from "./NumberUtils.js";

export function calculateTotalRoutePackets(routeStats) {
  if (!Array.isArray(routeStats)) {
    return 0;
  }

  return routeStats.reduce((acc, stat) => {
    const value = coerceToNumber(stat?.packetCount);
    return acc + (value > 0 ? value : 0);
  }, 0);
}

export function calculatePacketShare(packetCount, totalPackets) {
  const count = coerceToNumber(packetCount);
  const total = coerceToNumber(totalPackets);

  if (total <= 0 || count <= 0) {
    return 0;
  }

  return count / total;
}

export function calculatePacketPercent(packetCount, totalPackets) {
  const share = calculatePacketShare(packetCount, totalPackets);
  return share > 0 ? share * 100 : 0;
}

export function enrichRouteStatsWithShares(routeStats) {
  if (!Array.isArray(routeStats)) {
    return routeStats;
  }

  const totalPackets = calculateTotalRoutePackets(routeStats);

  routeStats.forEach((stat) => {
    const packetCount = coerceToNumber(stat?.packetCount);
    const safeCount = packetCount >= 0 ? packetCount : 0;
    const share = calculatePacketShare(safeCount, totalPackets);

    stat.packetCount = safeCount;
    stat.share = share;
    stat.percent = share > 0 ? share * 100 : 0;
  });

  return routeStats;
}

export function createRouteStatsMap(routeStatsRaw, normalizeKey) {
  if (!Array.isArray(routeStatsRaw)) {
    return { routeStatsMap: new Map(), totalRoutePackets: 0 };
  }

  const totalRoutePackets = calculateTotalRoutePackets(routeStatsRaw);
  const routeStatsMap = new Map();

  routeStatsRaw.forEach((stat) => {
    const key = normalizeKey(stat?.srcEid ?? stat?.eid);
    if (!key) return;

    const packetCount = coerceToNumber(stat?.packetCount);
    const safeCount = packetCount > 0 ? packetCount : 0;
    const share = calculatePacketShare(safeCount, totalRoutePackets);

    routeStatsMap.set(key, {
      srcEid: key,
      packetCount: safeCount,
      share,
      percent: share > 0 ? share * 100 : 0,
      lastPacketBlock: isDefined(stat?.lastPacketBlock) ? Number(stat.lastPacketBlock) : null,
      lastPacketTimestamp: isDefined(stat?.lastPacketTimestamp)
        ? Number(stat.lastPacketTimestamp)
        : null,
    });
  });

  return { routeStatsMap, totalRoutePackets };
}
