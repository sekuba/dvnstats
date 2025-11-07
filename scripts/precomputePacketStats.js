#!/usr/bin/env node

/**
 * Precompute packet statistics from all PacketDelivered records
 * Uses incremental processing to handle millions of packets without memory issues
 * Saves results to dashboard/data/packet-stats.json
 *
 * Usage:
 *   npm run stats:precompute                 # All time
 *   npm run stats:precompute -- --lookback=1y   # Last 1 year
 *   npm run stats:precompute -- --lookback=30d  # Last 30 days
 *   npm run stats:precompute -- --lookback=6m   # Last 6 months
 */

const fs = require('fs');
const path = require('path');

const GRAPHQL_ENDPOINT = process.env.GRAPHQL_ENDPOINT || 'https://shinken.business/v1/graphql';
const BATCH_SIZE = 5000;
const OUTPUT_PATH = path.join(__dirname, '../dashboard/data/packet-stats.json');

/**
 * Parse lookback parameter (e.g., "1y", "30d", "6m")
 * Returns timestamp (seconds) or null for all time
 */
function parseLookback(lookbackStr) {
  if (!lookbackStr) return null;

  const match = lookbackStr.match(/^(\d+)([hdmy])$/);
  if (!match) {
    throw new Error('Invalid lookback format. Use: 30d, 6m, 1y, 24h');
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  const now = Math.floor(Date.now() / 1000);
  const multipliers = {
    h: 3600,        // hours
    d: 86400,       // days
    m: 2592000,     // months (30 days)
    y: 31536000,    // years (365 days)
  };

  return now - (value * multipliers[unit]);
}

async function fetchPacketBatch(offset, limit, minTimestamp = null) {
  const whereClause = minTimestamp !== null
    ? `where: { blockTimestamp: { _gte: ${minTimestamp} } }`
    : '';

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
        configId
      }
    }
  `;

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { offset, limit } })
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
 * Process packets incrementally to avoid memory overflow
 */
async function computeStatisticsIncremental(minTimestamp = null) {
  console.log('Computing statistics incrementally...');

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

  // Time-series tracking
  const seenConfigs = new Set(); // Track unique configIds
  let earliestTimestamp = Number.POSITIVE_INFINITY;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  let offset = 0;
  let hasMore = true;
  let batchCount = 0;

  // First pass: determine time range
  console.log('First pass: determining time range...');
  while (hasMore) {
    const batch = await fetchPacketBatch(offset, BATCH_SIZE, minTimestamp);

    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    batchCount++;

    for (const packet of batch) {
      const timestamp = Number(packet.blockTimestamp);
      if (!Number.isNaN(timestamp)) {
        if (timestamp < earliestTimestamp) earliestTimestamp = timestamp;
        if (timestamp > latestTimestamp) latestTimestamp = timestamp;
      }
    }

    offset += batch.length;

    if (batch.length < BATCH_SIZE) {
      hasMore = false;
    }

    if (batchCount % 10 === 0) {
      console.log(`  Scanned ${offset.toLocaleString()} packets...`);
    }

    await new Promise(resolve => setImmediate(resolve));
  }

  console.log(`Time range: ${new Date(earliestTimestamp * 1000).toISOString()} to ${new Date(latestTimestamp * 1000).toISOString()}`);

  // Create hourly buckets
  const hourlyBuckets = createHourlyBuckets(earliestTimestamp, latestTimestamp);
  console.log(`Created ${hourlyBuckets.size.toLocaleString()} hourly buckets`);

  // Second pass: compute statistics
  console.log('\nSecond pass: computing statistics...');
  offset = 0;
  hasMore = true;
  batchCount = 0;

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

      // DVN combinations (required DVNs only)
      const requiredDVNs = Array.isArray(packet.effectiveRequiredDVNs)
        ? packet.effectiveRequiredDVNs
        : [];

      if (requiredDVNs.length > 0) {
        const sortedDvns = [...requiredDVNs].sort();
        const comboKey = sortedDvns.join(',');
        dvnCombos.set(comboKey, (dvnCombos.get(comboKey) || 0) + 1);
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

      // Time-series tracking
      const timestamp = Number(packet.blockTimestamp);
      if (!Number.isNaN(timestamp)) {
        const hourBucket = Math.floor(timestamp / 3600) * 3600;
        const bucket = hourlyBuckets.get(hourBucket);
        if (bucket) {
          bucket.packets++;

          // Track config changes (first time seeing this configId)
          if (packet.configId && !seenConfigs.has(packet.configId)) {
            bucket.configChanges++;
            seenConfigs.add(packet.configId);
          }
        }
      }
    }

    offset += batch.length;
    console.log(`  Processed batch ${batchCount}: ${total.toLocaleString()} packets total`);

    if (batch.length < BATCH_SIZE) {
      hasMore = false;
    }

    await new Promise(resolve => setImmediate(resolve));
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
  console.log('Finalizing results...');

  const dvnCombinations = Array.from(dvnCombos.entries())
    .map(([combo, count]) => ({
      dvns: combo.split(','),
      count,
      percentage: (count / total) * 100,
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
      totalConfigChanges: seenConfigs.size,
    },
  };
}

async function main() {
  try {
    console.log('=== Packet Statistics Precomputation ===\n');

    // Parse command line arguments
    const args = process.argv.slice(2);
    let lookbackParam = null;
    let minTimestamp = null;

    for (const arg of args) {
      if (arg.startsWith('--lookback=')) {
        lookbackParam = arg.split('=')[1];
      }
    }

    if (lookbackParam) {
      minTimestamp = parseLookback(lookbackParam);
      console.log(`Lookback: ${lookbackParam} (from ${new Date(minTimestamp * 1000).toISOString()})`);
    } else {
      console.log('Lookback: All time');
    }

    console.log(`Endpoint: ${GRAPHQL_ENDPOINT}`);
    console.log(`Batch size: ${BATCH_SIZE.toLocaleString()}\n`);

    // Compute statistics incrementally
    const stats = await computeStatisticsIncremental(minTimestamp);

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save to file
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(stats, null, 2));
    console.log(`\nStatistics saved to: ${OUTPUT_PATH}`);
    console.log(`\nSummary:`);
    console.log(`  Total packets: ${stats.total.toLocaleString()}`);
    console.log(`  All-default: ${stats.allDefaultPercentage.toFixed(2)}%`);
    console.log(`  Unique DVN combos: ${stats.dvnCombinations.length.toLocaleString()}`);
    console.log(`  Chains: ${stats.chainBreakdown.length}`);
    console.log(`  Config changes: ${stats.timeSeries.totalConfigChanges.toLocaleString()}`);
    console.log(`  Hourly data points: ${stats.timeSeries.hourly.length.toLocaleString()}`);

    if (stats.timeRange.earliest && stats.timeRange.latest) {
      const days = Math.floor((stats.timeRange.latest - stats.timeRange.earliest) / 86400);
      console.log(`  Time range: ${new Date(stats.timeRange.earliest * 1000).toISOString().split('T')[0]} to ${new Date(stats.timeRange.latest * 1000).toISOString().split('T')[0]} (${days.toLocaleString()} days)`);
    }

    console.log('\n✓ Done!');
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
