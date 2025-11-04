/**
 * MetricsUtils - Centralized utilities for metric calculations
 *
 * This module provides consistent metric calculation logic across the dashboard,
 * eliminating duplicated packet and route metric calculations.
 */

import { coerceToNumber } from "./NumberUtils.js";

/**
 * Calculates the total packet count from an array of route statistics.
 * Safely handles null/undefined values and non-finite numbers.
 *
 * @param {Array} routeStats - Array of route stat objects with packetCount property
 * @returns {number} The total packet count across all routes
 *
 * @example
 * const stats = [
 *   { packetCount: 100 },
 *   { packetCount: "200" },
 *   { packetCount: null }
 * ];
 * calculateTotalRoutePackets(stats)  // Returns 300
 */
export function calculateTotalRoutePackets(routeStats) {
  if (!Array.isArray(routeStats)) {
    return 0;
  }

  return routeStats.reduce((acc, stat) => {
    const value = coerceToNumber(stat?.packetCount);
    return acc + (value > 0 ? value : 0);
  }, 0);
}

/**
 * Calculates the packet share (ratio) for a given count relative to a total.
 *
 * @param {number|string} packetCount - The packet count for this route
 * @param {number} totalPackets - The total packet count across all routes
 * @returns {number} The share as a decimal between 0 and 1
 *
 * @example
 * calculatePacketShare(50, 200)   // Returns 0.25
 * calculatePacketShare(0, 100)    // Returns 0
 * calculatePacketShare(100, 0)    // Returns 0 (handles division by zero)
 */
export function calculatePacketShare(packetCount, totalPackets) {
  const count = coerceToNumber(packetCount);
  const total = coerceToNumber(totalPackets);

  if (total <= 0 || count <= 0) {
    return 0;
  }

  return count / total;
}

/**
 * Calculates the packet percentage for a given count relative to a total.
 *
 * @param {number|string} packetCount - The packet count for this route
 * @param {number} totalPackets - The total packet count across all routes
 * @returns {number} The percentage as a number between 0 and 100
 *
 * @example
 * calculatePacketPercent(50, 200)  // Returns 25
 * calculatePacketPercent(0, 100)   // Returns 0
 */
export function calculatePacketPercent(packetCount, totalPackets) {
  const share = calculatePacketShare(packetCount, totalPackets);
  return share > 0 ? share * 100 : 0;
}

/**
 * Enriches an array of route statistics with calculated share and percent values.
 * Mutates the input array by adding 'share' and 'percent' properties to each stat.
 *
 * @param {Array} routeStats - Array of route stat objects with packetCount property
 * @returns {Array} The same array with added share and percent properties
 *
 * @example
 * const stats = [
 *   { srcEid: "30101", packetCount: 100 },
 *   { srcEid: "30102", packetCount: 200 }
 * ];
 * enrichRouteStatsWithShares(stats);
 * // stats[0] now has: { ..., share: 0.333, percent: 33.3 }
 * // stats[1] now has: { ..., share: 0.666, percent: 66.6 }
 */
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

/**
 * Creates a route statistics map from raw route data.
 * Normalizes packet counts and calculates shares/percentages.
 *
 * @param {Array} routeStatsRaw - Raw route statistics array
 * @param {Function} normalizeKey - Function to normalize the EID key
 * @returns {Object} Object with routeStatsMap and totalRoutePackets
 *
 * @example
 * const raw = [
 *   { srcEid: "30101", packetCount: "100" },
 *   { eid: "30102", packetCount: 200 }
 * ];
 * const { routeStatsMap, totalRoutePackets } = createRouteStatsMap(
 *   raw,
 *   (eid) => String(eid)
 * );
 * // routeStatsMap is a Map with normalized keys
 * // totalRoutePackets is 300
 */
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
      lastPacketBlock:
        stat?.lastPacketBlock !== undefined && stat?.lastPacketBlock !== null
          ? Number(stat.lastPacketBlock)
          : null,
      lastPacketTimestamp:
        stat?.lastPacketTimestamp !== undefined && stat?.lastPacketTimestamp !== null
          ? Number(stat.lastPacketTimestamp)
          : null,
    });
  });

  return { routeStatsMap, totalRoutePackets };
}
