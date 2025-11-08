#!/usr/bin/env node

/**
 * Precompute packet statistics from all PacketDelivered records
 * Uses cursor-based pagination and incremental processing for optimal performance
 *
 * Output files: dashboard/data/packet-stats-{lookback}.json
 * Metadata files: dashboard/data/packet-stats-{lookback}.metadata.json
 *
 * Usage:
 *   npm run stats:precompute                         # Full computation, all time
 *   npm run stats:precompute -- --lookback=30d       # Full computation, last 30 days
 *   npm run stats:precompute -- --incremental        # Incremental update (only new records)
 *   npm run stats:precompute -- --lookback=30d --incremental  # Incremental for specific range
 *   npm run stats:precompute -- --batch              # Generate all supported time ranges
 *   npm run stats:precompute -- --batch --incremental  # Batch mode with incremental updates
 *
 * Supported lookback formats:
 *   30d, 90d, 180d  - Days
 *   1m, 3m, 6m      - Months (30 days each)
 *   1y, 2y          - Years (365 days each)
 *   24h, 48h        - Hours
 *
 * Performance improvements:
 *   - Cursor-based pagination (no offset scan penalty)
 *   - Incremental updates (only process new records since last run)
 *   - Expected speedup: 5-10x for full runs, 100-360x for daily incremental updates
 */

const fs = require("fs");
const path = require("path");

const GRAPHQL_ENDPOINT = process.env.GRAPHQL_ENDPOINT || "https://shinken.business/v1/graphql";
const BATCH_SIZE = 100000;
const OUTPUT_DIR = path.join(__dirname, "../dashboard/data");

/**
 * Generate output filename based on lookback parameter
 * Examples: packet-stats-30d.json, packet-stats-1y.json, packet-stats-all.json
 */
function getOutputFilename(lookbackParam) {
  const suffix = lookbackParam || "all";
  return path.join(OUTPUT_DIR, `packet-stats-${suffix}.json`);
}

/**
 * Generate metadata filename based on lookback parameter
 */
function getMetadataFilename(lookbackParam) {
  const suffix = lookbackParam || "all";
  return path.join(OUTPUT_DIR, `packet-stats-${suffix}.metadata.json`);
}

/**
 * Load metadata from previous run
 */
function loadMetadata(lookbackParam) {
  const metadataPath = getMetadataFilename(lookbackParam);
  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    return metadata;
  } catch (error) {
    console.warn(`Warning: Could not read metadata file: ${error.message}`);
    return null;
  }
}

/**
 * Save metadata for next run
 */
function saveMetadata(lookbackParam, metadata) {
  const metadataPath = getMetadataFilename(lookbackParam);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  console.log(`Metadata saved to: ${metadataPath}`);
}

/**
 * Parse lookback parameter (e.g., "1y", "30d", "6m")
 * Returns timestamp (seconds) or null for all time
 */
function parseLookback(lookbackStr) {
  if (!lookbackStr) return null;

  const match = lookbackStr.match(/^(\d+)([hdmy])$/);
  if (!match) {
    throw new Error("Invalid lookback format. Use: 30d, 6m, 1y, 24h");
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  const now = Math.floor(Date.now() / 1000);
  const multipliers = {
    h: 3600, // hours
    d: 86400, // days
    m: 2592000, // months (30 days)
    y: 31536000, // years (365 days)
  };

  return now - value * multipliers[unit];
}

async function fetchPacketBatch(limit, minTimestamp = null, cursor = null) {
  // Build WHERE clause with cursor-based pagination
  const whereConditions = [];

  if (minTimestamp !== null) {
    whereConditions.push(`{ blockTimestamp: { _gte: ${minTimestamp} } }`);
  }

  if (cursor !== null) {
    // Cursor pagination: fetch records before the cursor (blockTimestamp, id)
    whereConditions.push(`{
      _or: [
        { blockTimestamp: { _lt: ${cursor.blockTimestamp} } },
        {
          _and: [
            { blockTimestamp: { _eq: ${cursor.blockTimestamp} } },
            { id: { _lt: "${cursor.id}" } }
          ]
        }
      ]
    }`);
  }

  const whereClause =
    whereConditions.length > 0 ? `where: { _and: [${whereConditions.join(", ")}] }` : "";

  const query = `
    query FetchPackets($limit: Int!) {
      PacketDelivered(
        order_by: [{ blockTimestamp: desc }, { id: desc }]
        limit: $limit
        ${whereClause}
      ) {
        id
        localEid
        srcEid
        blockTimestamp
        usesDefaultLibrary
        usesDefaultConfig
        effectiveRequiredDVNs
        effectiveOptionalDVNs
        effectiveRequiredDVNCount
        effectiveOptionalDVNCount
        effectiveOptionalDVNThreshold
        isConfigTracked
      }
    }
  `;

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { limit } }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data.data.PacketDelivered || [];
}

/**
 * Create hourly buckets for time-series data
 */
function createHourlyBuckets(earliest, latest) {
  const buckets = new Map();
  const startHour = Math.floor(earliest / 3600) * 3600;
  const endHour = Math.floor(latest / 3600) * 3600;

  for (let hour = startHour; hour <= endHour; hour += 3600) {
    buckets.set(hour, { packets: 0, configChanges: 0 });
  }

  return buckets;
}

/**
 * Fetch earliest and latest packet timestamps efficiently
 */
async function fetchTimeRange(minTimestamp = null) {
  let earliestTimestamp;
  let latestTimestamp;

  if (minTimestamp !== null) {
    // If lookback is specified, we already know the time range
    earliestTimestamp = minTimestamp;
    latestTimestamp = Math.floor(Date.now() / 1000);
    console.log("Using lookback time range (no scan needed)");
  } else {
    // For all-time: fetch earliest and latest packets with targeted queries
    console.log("Fetching time range with targeted queries...");

    // Fetch earliest packet
    const earliestQuery = `
      query FetchEarliest {
        PacketDelivered(
          order_by: { blockTimestamp: asc }
          limit: 1
        ) {
          blockTimestamp
        }
      }
    `;

    const earliestResponse = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: earliestQuery }),
    });

    const earliestData = await earliestResponse.json();
    if (earliestData.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(earliestData.errors)}`);
    }

    // Fetch latest packet
    const latestQuery = `
      query FetchLatest {
        PacketDelivered(
          order_by: { blockTimestamp: desc }
          limit: 1
        ) {
          blockTimestamp
        }
      }
    `;

    const latestResponse = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: latestQuery }),
    });

    const latestData = await latestResponse.json();
    if (latestData.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(latestData.errors)}`);
    }

    earliestTimestamp = Number(earliestData.data.PacketDelivered[0]?.blockTimestamp);
    latestTimestamp = Number(latestData.data.PacketDelivered[0]?.blockTimestamp);
  }

  return { earliestTimestamp, latestTimestamp };
}

/**
 * Fetch all config change events (Version entities) and populate hourly buckets
 * Includes all 4 types: DefaultReceiveLibrary, DefaultUlnConfig, OAppReceiveLibrary, OAppUlnConfig
 */
async function fetchConfigChanges(hourlyBuckets, minTimestamp = null) {
  console.log("\nFetching config change events...");

  const versionTypes = [
    "DefaultReceiveLibraryVersion",
    "DefaultUlnConfigVersion",
    "OAppReceiveLibraryVersion",
    "OAppUlnConfigVersion",
  ];

  let totalConfigChanges = 0;

  for (const versionType of versionTypes) {
    // Build WHERE clause with cursor-based pagination
    const whereConditions = [];
    if (minTimestamp !== null) {
      whereConditions.push(`{ blockTimestamp: { _gte: ${minTimestamp} } }`);
    }

    let cursor = null;
    let hasMore = true;
    let typeCount = 0;

    while (hasMore) {
      const cursorConditions = [...whereConditions];
      if (cursor !== null) {
        cursorConditions.push(`{
          _or: [
            { blockTimestamp: { _lt: ${cursor.blockTimestamp} } },
            {
              _and: [
                { blockTimestamp: { _eq: ${cursor.blockTimestamp} } },
                { id: { _lt: "${cursor.id}" } }
              ]
            }
          ]
        }`);
      }

      const whereClause =
        cursorConditions.length > 0 ? `where: { _and: [${cursorConditions.join(", ")}] }` : "";

      const query = `
        query FetchVersions($limit: Int!) {
          ${versionType}(
            order_by: [{ blockTimestamp: desc }, { id: desc }]
            limit: $limit
            ${whereClause}
          ) {
            id
            blockTimestamp
          }
        }
      `;

      const response = await fetch(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { limit: BATCH_SIZE } }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      const versions = data.data[versionType] || [];

      if (versions.length === 0) {
        hasMore = false;
        break;
      }

      // Add to hourly buckets
      for (const version of versions) {
        const timestamp = Number(version.blockTimestamp);
        if (!Number.isNaN(timestamp)) {
          const hourBucket = Math.floor(timestamp / 3600) * 3600;
          const bucket = hourlyBuckets.get(hourBucket);
          if (bucket) {
            bucket.configChanges++;
            typeCount++;
          }
        }
      }

      // Update cursor to last record
      const lastRecord = versions[versions.length - 1];
      cursor = {
        blockTimestamp: Number(lastRecord.blockTimestamp),
        id: lastRecord.id,
      };

      if (versions.length < BATCH_SIZE) {
        hasMore = false;
      }

      await new Promise((resolve) => setImmediate(resolve));
    }

    console.log(`  ${versionType}: ${typeCount.toLocaleString()} changes`);
    totalConfigChanges += typeCount;
  }

  console.log(`Total config changes: ${totalConfigChanges.toLocaleString()}`);
  return totalConfigChanges;
}

/**
 * Merge new statistics with existing statistics for incremental updates
 */
function mergeStatistics(existingStats, newStats) {
  console.log("\nMerging new statistics with existing...");

  // Merge simple counts
  const total = existingStats.total + newStats.total;
  const allDefault = Math.round(
    existingStats.total * (existingStats.allDefaultPercentage / 100) +
      newStats.total * (newStats.allDefaultPercentage / 100),
  );
  const defaultLib = Math.round(
    existingStats.total * (existingStats.defaultLibPercentage / 100) +
      newStats.total * (newStats.defaultLibPercentage / 100),
  );
  const defaultConfig = Math.round(
    existingStats.total * (existingStats.defaultConfigPercentage / 100) +
      newStats.total * (newStats.defaultConfigPercentage / 100),
  );
  const tracked = Math.round(
    existingStats.total * (existingStats.trackedPercentage / 100) +
      newStats.total * (newStats.trackedPercentage / 100),
  );

  // Merge DVN combinations
  const dvnComboMap = new Map();
  for (const combo of existingStats.dvnCombinations) {
    const key = JSON.stringify(combo);
    dvnComboMap.set(key, combo);
  }
  for (const combo of newStats.dvnCombinations) {
    const key = JSON.stringify(combo);
    if (dvnComboMap.has(key)) {
      dvnComboMap.get(key).count += combo.count;
    } else {
      dvnComboMap.set(key, { ...combo });
    }
  }

  // Merge DVN set threshold buckets
  const thresholdMap = new Map();
  for (const bucket of existingStats.dvnSetThresholdBuckets) {
    thresholdMap.set(bucket.dvnSetThreshold, bucket.packetCount);
  }
  for (const bucket of newStats.dvnSetThresholdBuckets) {
    const existing = thresholdMap.get(bucket.dvnSetThreshold) || 0;
    thresholdMap.set(bucket.dvnSetThreshold, existing + bucket.packetCount);
  }

  const dvnSetThresholdBuckets = Array.from(thresholdMap.entries())
    .map(([threshold, packets]) => ({
      dvnSetThreshold: threshold,
      packetCount: packets,
      percentage: (packets / total) * 100,
    }))
    .sort((a, b) => a.dvnSetThreshold - b.dvnSetThreshold);

  // Merge chain breakdown
  const chainMap = new Map();
  for (const chain of existingStats.chainBreakdown) {
    chainMap.set(chain.localEid, chain.packetCount);
  }
  for (const chain of newStats.chainBreakdown) {
    const existing = chainMap.get(chain.localEid) || 0;
    chainMap.set(chain.localEid, existing + chain.packetCount);
  }

  const chainBreakdown = Array.from(chainMap.entries())
    .map(([eid, count]) => ({
      localEid: eid,
      packetCount: count,
      percentage: (count / total) * 100,
    }))
    .sort((a, b) => b.packetCount - a.packetCount);

  // Merge source chain breakdown
  const srcChainMap = new Map();
  for (const chain of existingStats.srcChainBreakdown) {
    srcChainMap.set(chain.srcEid, chain.packetCount);
  }
  for (const chain of newStats.srcChainBreakdown) {
    const existing = srcChainMap.get(chain.srcEid) || 0;
    srcChainMap.set(chain.srcEid, existing + chain.packetCount);
  }

  const srcChainBreakdown = Array.from(srcChainMap.entries())
    .map(([eid, count]) => ({
      srcEid: eid,
      packetCount: count,
      percentage: (count / total) * 100,
    }))
    .sort((a, b) => b.packetCount - a.packetCount);

  // Merge time series data
  const hourlyMap = new Map();
  for (const entry of existingStats.timeSeries.hourly) {
    hourlyMap.set(entry.timestamp, {
      packets: entry.packets,
      configChanges: entry.configChanges,
    });
  }
  for (const entry of newStats.timeSeries.hourly) {
    if (hourlyMap.has(entry.timestamp)) {
      const existing = hourlyMap.get(entry.timestamp);
      existing.packets += entry.packets;
      existing.configChanges += entry.configChanges;
    } else {
      hourlyMap.set(entry.timestamp, {
        packets: entry.packets,
        configChanges: entry.configChanges,
      });
    }
  }

  const hourlyData = Array.from(hourlyMap.entries())
    .map(([timestamp, data]) => ({
      timestamp,
      packets: data.packets,
      configChanges: data.configChanges,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // Recalculate percentages for DVN combinations
  const dvnCombinations = Array.from(dvnComboMap.values())
    .map((combo) => ({
      ...combo,
      percentage: (combo.count / total) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  const totalConfigChanges =
    (existingStats.timeSeries.totalConfigChanges || 0) +
    (newStats.timeSeries.totalConfigChanges || 0);

  // Determine time range
  const earliest = Math.min(
    existingStats.timeRange.earliest || Number.POSITIVE_INFINITY,
    newStats.timeRange.earliest || Number.POSITIVE_INFINITY,
  );
  const latest = Math.max(
    existingStats.timeRange.latest || Number.NEGATIVE_INFINITY,
    newStats.timeRange.latest || Number.NEGATIVE_INFINITY,
  );

  return {
    total,
    computedAt: new Date().toISOString(),
    allDefaultPercentage: (allDefault / total) * 100,
    defaultLibPercentage: (defaultLib / total) * 100,
    defaultConfigPercentage: (defaultConfig / total) * 100,
    trackedPercentage: (tracked / total) * 100,
    dvnCombinations,
    dvnSetThresholdBuckets,
    chainBreakdown,
    srcChainBreakdown,
    timeRange: {
      earliest: earliest === Number.POSITIVE_INFINITY ? null : earliest,
      latest: latest === Number.NEGATIVE_INFINITY ? null : latest,
    },
    timeSeries: {
      hourly: hourlyData,
      totalConfigChanges,
    },
  };
}

/**
 * Process packets incrementally to avoid memory overflow
 */
async function computeStatisticsIncremental(minTimestamp = null) {
  console.log("Computing statistics incrementally...");

  // Initialize accumulators
  let total = 0;
  let allDefault = 0;
  let defaultLibOnly = 0;
  let defaultConfigOnly = 0;
  let tracked = 0;

  const dvnCombos = new Map();
  const dvnSetThresholdCounts = new Map();
  const chainCounts = new Map();
  const srcChainCounts = new Map();

  // Determine time range efficiently
  const { earliestTimestamp, latestTimestamp } = await fetchTimeRange(minTimestamp);

  console.log(
    `Time range: ${new Date(earliestTimestamp * 1000).toISOString()} to ${new Date(latestTimestamp * 1000).toISOString()}`,
  );

  // Create hourly buckets
  const hourlyBuckets = createHourlyBuckets(earliestTimestamp, latestTimestamp);
  console.log(`Created ${hourlyBuckets.size.toLocaleString()} hourly buckets`);

  // Fetch actual config changes (Version events) and populate buckets
  const totalConfigChanges = await fetchConfigChanges(hourlyBuckets, minTimestamp);

  // Process all packets in a single pass
  console.log("\nProcessing packets...");
  let cursor = null;
  let hasMore = true;
  let batchCount = 0;

  while (hasMore) {
    const batch = await fetchPacketBatch(BATCH_SIZE, minTimestamp, cursor);

    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    batchCount++;

    // Process this batch
    for (const packet of batch) {
      total++;

      // All-default configuration
      if (packet.usesDefaultLibrary && packet.usesDefaultConfig) {
        allDefault++;
      }

      if (packet.usesDefaultLibrary) {
        defaultLibOnly++;
      }

      if (packet.usesDefaultConfig) {
        defaultConfigOnly++;
      }

      if (packet.isConfigTracked) {
        tracked++;
      }

      // Compute DVN set threshold based on required and optional DVNs
      const requiredDVNs = Array.isArray(packet.effectiveRequiredDVNs)
        ? packet.effectiveRequiredDVNs
        : [];
      const optionalDVNs = Array.isArray(packet.effectiveOptionalDVNs)
        ? packet.effectiveOptionalDVNs
        : [];

      const requiredCount = packet.effectiveRequiredDVNCount ?? requiredDVNs.length;
      const optionalThreshold = packet.effectiveOptionalDVNThreshold ?? 0;

      let dvnSetThreshold = 0;
      let comboConfig = null;

      // Case 1: Only required DVNs (most common)
      if (requiredCount > 0 && requiredCount < 255 && optionalThreshold === 0) {
        dvnSetThreshold = requiredCount;
        comboConfig = {
          type: "required",
          dvns: requiredDVNs,
        };
      }
      // Case 2: Both required and optional DVNs
      else if (requiredCount > 0 && requiredCount < 255 && optionalThreshold > 0) {
        dvnSetThreshold = requiredCount + optionalThreshold;
        comboConfig = {
          type: "required_and_optional",
          requiredDvns: requiredDVNs,
          optionalDvns: optionalDVNs,
          optionalThreshold,
        };
      }
      // Case 3: Only optional DVNs (required count is sentinel 255)
      else if (requiredCount === 255 && optionalThreshold > 0) {
        dvnSetThreshold = optionalThreshold;
        comboConfig = {
          type: "optional_only",
          optionalDvns: optionalDVNs,
          optionalThreshold,
        };
      }

      // Track DVN set threshold counts
      dvnSetThresholdCounts.set(
        dvnSetThreshold,
        (dvnSetThresholdCounts.get(dvnSetThreshold) || 0) + 1,
      );

      // Track DVN combinations if we have a valid config
      if (comboConfig) {
        const localEid = String(packet.localEid);
        let comboKey;

        if (comboConfig.type === "required") {
          // Standard case: just required DVNs
          const sortedDvns = [...comboConfig.dvns].sort();
          comboKey = `${localEid}:required:${sortedDvns.join(",")}`;

          if (!dvnCombos.has(comboKey)) {
            dvnCombos.set(comboKey, {
              localEid,
              type: "required",
              dvns: sortedDvns,
              count: 0,
            });
          }
        } else if (comboConfig.type === "required_and_optional") {
          // Hybrid case: required DVNs + optional threshold
          const sortedRequired = [...comboConfig.requiredDvns].sort();
          const sortedOptional = [...comboConfig.optionalDvns].sort();
          comboKey = `${localEid}:hybrid:${sortedRequired.join(",")}:${sortedOptional.join(",")}:${comboConfig.optionalThreshold}`;

          if (!dvnCombos.has(comboKey)) {
            dvnCombos.set(comboKey, {
              localEid,
              type: "required_and_optional",
              requiredDvns: sortedRequired,
              optionalDvns: sortedOptional,
              optionalThreshold: comboConfig.optionalThreshold,
              count: 0,
            });
          }
        } else if (comboConfig.type === "optional_only") {
          // Optional-only case
          const sortedOptional = [...comboConfig.optionalDvns].sort();
          comboKey = `${localEid}:optional:${sortedOptional.join(",")}:${comboConfig.optionalThreshold}`;

          if (!dvnCombos.has(comboKey)) {
            dvnCombos.set(comboKey, {
              localEid,
              type: "optional_only",
              optionalDvns: sortedOptional,
              optionalThreshold: comboConfig.optionalThreshold,
              count: 0,
            });
          }
        }

        dvnCombos.get(comboKey).count++;
      }

      // Chain tracking
      const localEid = String(packet.localEid);
      chainCounts.set(localEid, (chainCounts.get(localEid) || 0) + 1);

      const srcEid = String(packet.srcEid);
      srcChainCounts.set(srcEid, (srcChainCounts.get(srcEid) || 0) + 1);

      // Time-series tracking (packet counts only)
      const timestamp = Number(packet.blockTimestamp);
      if (!Number.isNaN(timestamp)) {
        const hourBucket = Math.floor(timestamp / 3600) * 3600;
        const bucket = hourlyBuckets.get(hourBucket);
        if (bucket) {
          bucket.packets++;
        }
      }
    }

    // Update cursor to last record in batch
    const lastRecord = batch[batch.length - 1];
    cursor = {
      blockTimestamp: Number(lastRecord.blockTimestamp),
      id: lastRecord.id,
    };

    console.log(`  Processed batch ${batchCount}: ${total.toLocaleString()} packets total`);

    if (batch.length < BATCH_SIZE) {
      hasMore = false;
    }

    await new Promise((resolve) => setImmediate(resolve));
  }

  console.log(`\nTotal packets processed: ${total.toLocaleString()}`);

  if (total === 0) {
    return {
      total: 0,
      computedAt: new Date().toISOString(),
      allDefaultPercentage: 0,
      defaultLibPercentage: 0,
      defaultConfigPercentage: 0,
      trackedPercentage: 0,
      dvnCombinations: [],
      dvnSetThresholdBuckets: [],
      timeRange: { earliest: null, latest: null },
      chainBreakdown: [],
      srcChainBreakdown: [],
      timeSeries: { hourly: [] },
    };
  }

  // Convert to arrays and sort
  console.log("Finalizing results...");

  const dvnCombinations = Array.from(dvnCombos.values())
    .map((combo) => {
      const base = {
        localEid: combo.localEid,
        type: combo.type,
        count: combo.count,
        percentage: (combo.count / total) * 100,
      };

      // Add type-specific fields
      if (combo.type === "required") {
        base.dvns = combo.dvns;
      } else if (combo.type === "required_and_optional") {
        base.requiredDvns = combo.requiredDvns;
        base.optionalDvns = combo.optionalDvns;
        base.optionalThreshold = combo.optionalThreshold;
      } else if (combo.type === "optional_only") {
        base.optionalDvns = combo.optionalDvns;
        base.optionalThreshold = combo.optionalThreshold;
      }

      return base;
    })
    .sort((a, b) => b.count - a.count);

  const dvnSetThresholdBuckets = Array.from(dvnSetThresholdCounts.entries())
    .map(([threshold, packets]) => ({
      dvnSetThreshold: threshold,
      packetCount: packets,
      percentage: (packets / total) * 100,
    }))
    .sort((a, b) => a.dvnSetThreshold - b.dvnSetThreshold);

  const chainBreakdown = Array.from(chainCounts.entries())
    .map(([eid, count]) => ({
      localEid: eid,
      packetCount: count,
      percentage: (count / total) * 100,
    }))
    .sort((a, b) => b.packetCount - a.packetCount);

  const srcChainBreakdown = Array.from(srcChainCounts.entries())
    .map(([eid, count]) => ({
      srcEid: eid,
      packetCount: count,
      percentage: (count / total) * 100,
    }))
    .sort((a, b) => b.packetCount - a.packetCount);

  // Time-series data
  const hourlyData = Array.from(hourlyBuckets.entries())
    .map(([timestamp, data]) => ({
      timestamp,
      packets: data.packets,
      configChanges: data.configChanges,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  return {
    total,
    computedAt: new Date().toISOString(),
    allDefaultPercentage: (allDefault / total) * 100,
    defaultLibPercentage: (defaultLibOnly / total) * 100,
    defaultConfigPercentage: (defaultConfigOnly / total) * 100,
    trackedPercentage: (tracked / total) * 100,
    dvnCombinations,
    dvnSetThresholdBuckets,
    chainBreakdown,
    srcChainBreakdown,
    timeRange: {
      earliest: earliestTimestamp === Number.POSITIVE_INFINITY ? null : earliestTimestamp,
      latest: latestTimestamp === Number.NEGATIVE_INFINITY ? null : latestTimestamp,
    },
    timeSeries: {
      hourly: hourlyData,
      totalConfigChanges,
    },
  };
}

/**
 * Run single precomputation for a specific lookback period
 */
async function runPrecomputation(lookbackParam = null, incrementalMode = false) {
  let minTimestamp = null;

  if (lookbackParam) {
    minTimestamp = parseLookback(lookbackParam);
    console.log(`Lookback: ${lookbackParam} (from ${new Date(minTimestamp * 1000).toISOString()})`);
  } else {
    console.log("Lookback: All time");
  }

  console.log(`Endpoint: ${GRAPHQL_ENDPOINT}`);
  console.log(`Batch size: ${BATCH_SIZE.toLocaleString()}`);
  console.log(`Mode: ${incrementalMode ? "Incremental" : "Full"}\n`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outputPath = getOutputFilename(lookbackParam);
  let stats;

  if (incrementalMode) {
    // Load existing stats and metadata
    const metadata = loadMetadata(lookbackParam);

    if (!metadata || !fs.existsSync(outputPath)) {
      console.log("No previous run found. Performing full computation...\n");
      stats = await computeStatisticsIncremental(minTimestamp);
    } else {
      console.log(`Found previous run from ${metadata.computedAt}`);
      console.log(
        `Last processed: ${metadata.lastProcessedTimestamp ? new Date(metadata.lastProcessedTimestamp * 1000).toISOString() : "N/A"}`,
      );
      console.log(`Previous total: ${metadata.totalRecords.toLocaleString()} packets\n`);

      // For incremental mode, only fetch records newer than last run
      const incrementalMinTimestamp = metadata.lastProcessedTimestamp;

      console.log(
        `Fetching new records since ${new Date(incrementalMinTimestamp * 1000).toISOString()}...`,
      );
      const newStats = await computeStatisticsIncremental(incrementalMinTimestamp);

      if (newStats.total === 0) {
        console.log("\nNo new records found. Skipping merge.");
        stats = JSON.parse(fs.readFileSync(outputPath, "utf8"));
        stats.computedAt = new Date().toISOString();
      } else {
        console.log(`\nFound ${newStats.total.toLocaleString()} new packets`);

        // Load existing stats and merge
        const existingStats = JSON.parse(fs.readFileSync(outputPath, "utf8"));
        stats = mergeStatistics(existingStats, newStats);
      }
    }
  } else {
    // Full computation mode
    stats = await computeStatisticsIncremental(minTimestamp);
  }

  // Add lookback metadata to stats
  stats.lookback = lookbackParam || "all";

  // Save to file
  fs.writeFileSync(outputPath, JSON.stringify(stats, null, 2));
  console.log(`\nStatistics saved to: ${outputPath}`);

  // Save metadata for next incremental run
  const metadata = {
    computedAt: stats.computedAt,
    lastProcessedTimestamp: stats.timeRange.latest,
    totalRecords: stats.total,
    lookback: lookbackParam || "all",
  };
  saveMetadata(lookbackParam, metadata);

  console.log(`\nSummary:`);
  console.log(`  Total packets: ${stats.total.toLocaleString()}`);
  console.log(`  All-default: ${stats.allDefaultPercentage.toFixed(2)}%`);
  console.log(`  Unique DVN combos: ${stats.dvnCombinations.length.toLocaleString()}`);
  console.log(`  Chains: ${stats.chainBreakdown.length}`);
  console.log(`  Config changes: ${stats.timeSeries.totalConfigChanges.toLocaleString()}`);
  console.log(`  Hourly data points: ${stats.timeSeries.hourly.length.toLocaleString()}`);

  if (stats.timeRange.earliest && stats.timeRange.latest) {
    const days = Math.floor((stats.timeRange.latest - stats.timeRange.earliest) / 86400);
    console.log(
      `  Time range: ${new Date(stats.timeRange.earliest * 1000).toISOString().split("T")[0]} to ${new Date(stats.timeRange.latest * 1000).toISOString().split("T")[0]} (${days.toLocaleString()} days)`,
    );
  }

  console.log("\n✓ Done!");
}

async function main() {
  try {
    console.log("=== Packet Statistics Precomputation ===\n");

    // Parse command line arguments
    const args = process.argv.slice(2);
    let lookbackParam = null;
    let batchMode = false;
    let incrementalMode = false;

    for (const arg of args) {
      if (arg.startsWith("--lookback=")) {
        lookbackParam = arg.split("=")[1];
      } else if (arg === "--batch") {
        batchMode = true;
      } else if (arg === "--incremental") {
        incrementalMode = true;
      }
    }

    if (batchMode) {
      // Batch mode: generate all supported time ranges
      const timeRanges = ["7d", "30d", "90d", "1y", null]; // null = all time
      console.log(`Batch mode: generating ${timeRanges.length} datasets\n`);

      for (let i = 0; i < timeRanges.length; i++) {
        const range = timeRanges[i];
        console.log(`\n${"=".repeat(60)}`);
        console.log(`Dataset ${i + 1}/${timeRanges.length}: ${range || "all"}`);
        console.log("=".repeat(60) + "\n");

        await runPrecomputation(range, incrementalMode);

        // Small delay between runs to avoid hammering the API
        if (i < timeRanges.length - 1) {
          console.log("\nWaiting 2 seconds before next dataset...");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      console.log(`\n${"=".repeat(60)}`);
      console.log(`✓ Batch complete! Generated ${timeRanges.length} datasets`);
      console.log("=".repeat(60));
    } else {
      // Single mode
      await runPrecomputation(lookbackParam, incrementalMode);
    }
  } catch (error) {
    console.error("\n✗ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
