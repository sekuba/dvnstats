#!/usr/bin/env node

/**
 * Precompute packet statistics from all PacketDelivered records
 * Uses incremental processing to handle millions of packets without memory issues
 *
 * Output files: dashboard/data/packet-stats-{lookback}.json
 *
 * Usage:
 *   npm run stats:precompute                    # All time (packet-stats-all.json)
 *   npm run stats:precompute -- --lookback=30d  # Last 30 days (packet-stats-30d.json)
 *   npm run stats:precompute -- --lookback=90d  # Last 90 days (packet-stats-90d.json)
 *   npm run stats:precompute -- --lookback=1y   # Last 1 year (packet-stats-1y.json)
 *   npm run stats:precompute -- --batch         # Generate all supported time ranges
 *
 * Supported lookback formats:
 *   30d, 90d, 180d  - Days
 *   1m, 3m, 6m      - Months (30 days each)
 *   1y, 2y          - Years (365 days each)
 *   24h, 48h        - Hours
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

async function fetchPacketBatch(offset, limit, minTimestamp = null) {
  const whereClause =
    minTimestamp !== null ? `where: { blockTimestamp: { _gte: ${minTimestamp} } }` : "";

  const query = `
    query FetchPackets($offset: Int!, $limit: Int!) {
      PacketDelivered(
        order_by: { blockTimestamp: desc }
        limit: $limit
        offset: $offset
        ${whereClause}
      ) {
        localEid
        srcEid
        blockTimestamp
        usesDefaultLibrary
        usesDefaultConfig
        effectiveRequiredDVNs
        effectiveOptionalDVNs
        effectiveRequiredDVNCount
        effectiveOptionalDVNCount
        isConfigTracked
      }
    }
  `;

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { offset, limit } }),
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
    const whereClause =
      minTimestamp !== null ? `where: { blockTimestamp: { _gte: ${minTimestamp} } }` : "";

    let offset = 0;
    let hasMore = true;
    let typeCount = 0;

    while (hasMore) {
      const query = `
        query FetchVersions($offset: Int!, $limit: Int!) {
          ${versionType}(
            order_by: { blockTimestamp: desc }
            limit: $limit
            offset: $offset
            ${whereClause}
          ) {
            blockTimestamp
          }
        }
      `;

      const response = await fetch(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { offset, limit: BATCH_SIZE } }),
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

      offset += versions.length;

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
  const dvnCounts = new Map();
  const optionalDvnCounts = new Map();
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
  let offset = 0;
  let hasMore = true;
  let batchCount = 0;

  while (hasMore) {
    const batch = await fetchPacketBatch(offset, BATCH_SIZE, minTimestamp);

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

      // DVN combinations (required DVNs only) - store with localEid for correct resolution
      const requiredDVNs = Array.isArray(packet.effectiveRequiredDVNs)
        ? packet.effectiveRequiredDVNs
        : [];

      if (requiredDVNs.length > 0) {
        const localEid = String(packet.localEid);
        const sortedDvns = [...requiredDVNs].sort();
        const comboKey = `${localEid}:${sortedDvns.join(",")}`;

        if (!dvnCombos.has(comboKey)) {
          dvnCombos.set(comboKey, {
            localEid,
            dvns: sortedDvns,
            count: 0,
          });
        }
        dvnCombos.get(comboKey).count++;
      }

      // DVN count buckets
      const requiredCount = packet.effectiveRequiredDVNCount ?? requiredDVNs.length;
      dvnCounts.set(requiredCount, (dvnCounts.get(requiredCount) || 0) + 1);

      const optionalCount = packet.effectiveOptionalDVNCount ?? 0;
      optionalDvnCounts.set(optionalCount, (optionalDvnCounts.get(optionalCount) || 0) + 1);

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

    offset += batch.length;
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
      dvnCountBuckets: [],
      optionalDvnCountBuckets: [],
      timeRange: { earliest: null, latest: null },
      chainBreakdown: [],
      srcChainBreakdown: [],
      timeSeries: { hourly: [] },
    };
  }

  // Convert to arrays and sort
  console.log("Finalizing results...");

  const dvnCombinations = Array.from(dvnCombos.values())
    .map((combo) => ({
      localEid: combo.localEid,
      dvns: combo.dvns,
      count: combo.count,
      percentage: (combo.count / total) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  const dvnCountBuckets = Array.from(dvnCounts.entries())
    .map(([count, packets]) => ({
      requiredDvnCount: count,
      packetCount: packets,
      percentage: (packets / total) * 100,
    }))
    .sort((a, b) => a.requiredDvnCount - b.requiredDvnCount);

  const optionalDvnCountBuckets = Array.from(optionalDvnCounts.entries())
    .map(([count, packets]) => ({
      optionalDvnCount: count,
      packetCount: packets,
      percentage: (packets / total) * 100,
    }))
    .sort((a, b) => a.optionalDvnCount - b.optionalDvnCount);

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
    dvnCountBuckets,
    optionalDvnCountBuckets,
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
async function runPrecomputation(lookbackParam = null) {
  let minTimestamp = null;

  if (lookbackParam) {
    minTimestamp = parseLookback(lookbackParam);
    console.log(`Lookback: ${lookbackParam} (from ${new Date(minTimestamp * 1000).toISOString()})`);
  } else {
    console.log("Lookback: All time");
  }

  console.log(`Endpoint: ${GRAPHQL_ENDPOINT}`);
  console.log(`Batch size: ${BATCH_SIZE.toLocaleString()}\n`);

  // Compute statistics incrementally
  const stats = await computeStatisticsIncremental(minTimestamp);

  // Add lookback metadata to stats
  stats.lookback = lookbackParam || "all";

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Generate output filename based on lookback
  const outputPath = getOutputFilename(lookbackParam);

  // Save to file
  fs.writeFileSync(outputPath, JSON.stringify(stats, null, 2));
  console.log(`\nStatistics saved to: ${outputPath}`);
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

    for (const arg of args) {
      if (arg.startsWith("--lookback=")) {
        lookbackParam = arg.split("=")[1];
      } else if (arg === "--batch") {
        batchMode = true;
      }
    }

    if (batchMode) {
      // Batch mode: generate all supported time ranges
      const timeRanges = ["30d", "90d", "1y", null]; // null = all time
      console.log(`Batch mode: generating ${timeRanges.length} datasets\n`);

      for (let i = 0; i < timeRanges.length; i++) {
        const range = timeRanges[i];
        console.log(`\n${"=".repeat(60)}`);
        console.log(`Dataset ${i + 1}/${timeRanges.length}: ${range || "all"}`);
        console.log("=".repeat(60) + "\n");

        await runPrecomputation(range);

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
      await runPrecomputation(lookbackParam);
    }
  } catch (error) {
    console.error("\n✗ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
