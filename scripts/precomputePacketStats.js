#!/usr/bin/env node

/**
 * Builds dashboard/data/stats.json straight from the indexer's Postgres.
 *
 * One scan of PacketDelivered is folded into two daily cubes
 *   (day, destination eid, trust class, DVN quorum) -> packets
 *   (day, source eid)                                -> packets
 * cached in .cache/stats-cube.json. Later runs rescan only the last few days
 * (reorgs and late packets from lagging chains land there), so a refresh takes
 * about a second; --full rebuilds the cube (~1 min at 20M packets). Every time
 * window, daily series and DVN-set ranking is then a sum over the cube, so the
 * windows can never disagree with each other.
 *
 * Usage:
 *   pnpm stats              # incremental
 *   pnpm stats -- --full    # rebuild the cube from scratch
 *
 * Connection: PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE, defaulting to the
 * docker-compose stack.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = path.join(repoRoot, "dashboard/data/stats.json");
const CACHE_PATH = path.join(repoRoot, ".cache/stats-cube.json");
const METADATA_PATH = path.join(repoRoot, "dashboard/layerzero.json");
const ALIASES_PATH = path.join(repoRoot, "dashboard/oapp-aliases.json");
const REGISTRY_PATH = path.join(repoRoot, "dashboard/chainRegistry.js");

const SCHEMA_VERSION = 4;
const CUBE_VERSION = 1;
const DAY = 86400;
const HOUR = 3600;
const REFRESH_DAYS = 7;
const HOURLY_DAYS = 90;
const MESH_WINDOW_DAYS = 30;
const TOP_DVN_SETS = 20;
const TOP_MESHES = 25;
const SERIES_CHAIN_LIMIT = 8;
const WINDOWS = [
  ["7d", 7],
  ["30d", 30],
  ["90d", 90],
  ["1y", 365],
  ["all", null],
];

const ZERO_ADDRESS_PATTERN = /^0x0*$/i;
// lzRead responses arrive on channel ids at the top of the uint32 range, not on a chain.
const READ_CHANNEL_THRESHOLD = 4294965694;
const DEAD_DVN_ADDRESS = "0x000000000000000000000000000000000000dead";
const OPTIONAL_FIELDS = ["optionalDVNs", "optionalDVNCount", "optionalDVNThreshold"];
const REQUIRED_FIELDS = ["requiredDVNs", "requiredDVNCount"];

/**
 * Trust tiers: who can change how a packet on this route is verified.
 *   lzVerifiers  LayerZero's admin can change *which* DVNs suffice: the route
 *                inherits the default receive library, the whole default ULN
 *                config, or the default required DVN set (spec.md §5).
 *   lzParams     The OApp owns its required DVNs, but still inherits
 *                confirmations or the optional-DVN settings, so LayerZero can
 *                weaken finality or add verifiers (halt the route) — not forge.
 *   owner        Every field is set by the OApp owner.
 *   unknown      Custom receive library the indexer cannot decode.
 * TIER_SQL below must classify exactly like trustTier().
 */
const TIER_BY_CODE = ["owner", "lzParams", "lzVerifiers", "unknown"];

function trustTier(route) {
  const fallback = new Set(route.fallbackFields ?? []);
  if (route.usesDefaultLibrary) return "lzVerifiers";
  if (!route.isConfigTracked) return "unknown";
  if (route.usesDefaultConfig || REQUIRED_FIELDS.some((field) => fallback.has(field))) {
    return "lzVerifiers";
  }
  if (!(route.rc > 0) && OPTIONAL_FIELDS.some((field) => fallback.has(field))) {
    return "lzVerifiers";
  }
  return fallback.size > 0 ? "lzParams" : "owner";
}

const sqlArray = (values) => `ARRAY[${values.map((value) => `'${value}'`).join(", ")}]`;

const TIER_SQL = `CASE
    WHEN "usesDefaultLibrary" THEN 2
    WHEN NOT coalesce("isConfigTracked", false) THEN 3
    WHEN "usesDefaultConfig"
      OR "fallbackFields" && ${sqlArray(REQUIRED_FIELDS)}
      OR (coalesce("effectiveRequiredDVNCount", 0) = 0
          AND "fallbackFields" && ${sqlArray(OPTIONAL_FIELDS)}) THEN 2
    WHEN cardinality("fallbackFields") > 0 THEN 1
    ELSE 0
  END`;

// cls bits: 1 default library, 2 default config, 4 tracked library, (tier << 3).
const CLS_SQL = `((CASE WHEN "usesDefaultLibrary" THEN 1 ELSE 0 END)
  | (CASE WHEN "usesDefaultConfig" THEN 2 ELSE 0 END)
  | (CASE WHEN "isConfigTracked" THEN 4 ELSE 0 END)
  | (8 * ${TIER_SQL}))`;

// A quorum is the effective DVN setup of a packet; q is a short hash of it.
const CUBE_SQL = `
WITH p AS (
  SELECT div("blockTimestamp", ${DAY})::int AS d,
         "localEid"::int8 AS dst,
         "srcEid"::int8 AS src,
         ${CLS_SQL} AS cls,
         left(md5(concat_ws('|',
           array_to_string("effectiveRequiredDVNs", ','),
           array_to_string("effectiveOptionalDVNs", ','),
           coalesce("effectiveRequiredDVNCount"::text, '-'),
           coalesce("effectiveOptionalDVNThreshold"::text, '-'))), 16) AS q,
         "effectiveRequiredDVNs" AS req,
         "effectiveOptionalDVNs" AS opt,
         "effectiveRequiredDVNCount" AS rc,
         "effectiveOptionalDVNThreshold" AS ot
  FROM "PacketDelivered"
  WHERE "blockTimestamp" >= $1::numeric AND "blockTimestamp" <= $2::numeric
)
SELECT grouping(src) AS no_src, grouping(cls) AS no_cls,
       d, dst, src, cls, q, req, opt, rc, ot, count(*)::int AS n
FROM p
GROUP BY GROUPING SETS ((d, dst, cls, q), (d, src), (dst, q, req, opt, rc, ot))`;

const CONFIG_CHANGE_TABLES = [
  ["lz", "DefaultReceiveLibraryVersion"],
  ["lz", "DefaultUlnConfigVersion"],
  ["owner", "OAppReceiveLibraryVersion"],
  ["owner", "OAppUlnConfigVersion"],
];
const CONFIG_CHANGES_SQL = CONFIG_CHANGE_TABLES.map(
  ([
    who,
    table,
  ]) => `SELECT '${who}' AS who, div("blockTimestamp", ${HOUR})::int AS h, count(*)::int AS n
  FROM "${table}" WHERE "blockTimestamp" <= $1::numeric GROUP BY 2`,
).join("\nUNION ALL\n");

const HOURLY_PACKETS_SQL = `
SELECT div("blockTimestamp", ${HOUR})::int AS h, count(*)::int AS n
FROM "PacketDelivered"
WHERE "blockTimestamp" >= $1::numeric AND "blockTimestamp" <= $2::numeric GROUP BY 1`;

const ROUTES_SQL = `
SELECT "oappId" AS "oappId", eid::int8 AS eid, peer, "peerOappId", "libraryStatus",
       coalesce("isConfigTracked", false) AS "isConfigTracked",
       "usesDefaultLibrary", "usesDefaultConfig", "fallbackFields",
       "effectiveRequiredDVNCount" AS rc, "effectiveOptionalDVNThreshold" AS ot,
       "effectiveRequiredDVNs" AS req, "effectiveOptionalDVNs" AS opt
FROM "OAppSecurityConfig"`;

const OAPP_WINDOW_PACKETS_SQL = `
SELECT "oappId" AS "oappId", count(*)::int AS n
FROM "PacketDelivered"
WHERE "blockTimestamp" >= $1::numeric AND "blockTimestamp" <= $2::numeric GROUP BY 1`;

const OAPP_TOTALS_SQL = `
SELECT id, "totalPacketsReceived"::float8 AS n FROM "OAppStats" WHERE "totalPacketsReceived" > 0`;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

// Same resolution rules as ChainDirectory in dashboard/core.js.
async function loadLabels() {
  const metadata = readJson(METADATA_PATH);
  const { INDEXED_CHAINS } = await import(pathToFileURL(REGISTRY_PATH).href);
  const chains = new Map();
  const dvnsByChain = new Map();
  const dvnFallback = new Map();

  for (const [key, chain] of Object.entries(metadata)) {
    if (!chain || typeof chain !== "object") continue;
    const base = chain.chainDetails?.shortName || chain.chainDetails?.name || chain.chainKey || key;
    for (const deployment of chain.deployments ?? []) {
      if (deployment?.eid === undefined || deployment.eid === null) continue;
      const eid = Number(deployment.eid);
      const stage =
        deployment.stage && deployment.stage !== "mainnet" ? ` (${deployment.stage})` : "";
      chains.set(eid, `${base}${stage}`);
      for (const [address, info] of Object.entries(chain.dvns ?? {})) {
        const normalized = address.toLowerCase();
        const label = info?.canonicalName || info?.name || info?.id || address;
        dvnsByChain.set(`${eid}:${normalized}`, label);
        if (!dvnFallback.has(normalized)) dvnFallback.set(normalized, label);
      }
    }
  }
  for (const chain of INDEXED_CHAINS) {
    if (chain.label) chains.set(Number(chain.localEid), chain.label);
  }

  return {
    indexedChainCount: INDEXED_CHAINS.length,
    chainLabel: (eid) =>
      chains.get(Number(eid)) ??
      (Number(eid) >= READ_CHANNEL_THRESHOLD ? "lzRead channel" : `EID ${eid}`),
    dvnLabel: (address, eid) => {
      const normalized = String(address).toLowerCase();
      return dvnsByChain.get(`${eid}:${normalized}`) ?? dvnFallback.get(normalized) ?? normalized;
    },
  };
}

const isUnnamed = (label) => label.startsWith("0x");
const isDeadDvn = (address, label) =>
  String(address).toLowerCase() === DEAD_DVN_ADDRESS || label.trim().toLowerCase() === "lzdeaddvn";

/** Number of DVN approvals a packet needs, and the shape of the quorum. */
function quorumShape(rc, ot) {
  if (rc === null || rc === undefined) return { threshold: "unknown", type: null };
  const optionalThreshold = ot ?? 0;
  const hasRequired = rc > 0 && rc < 255;
  if (hasRequired && optionalThreshold === 0) return { threshold: rc, type: "required" };
  if (hasRequired) return { threshold: rc + optionalThreshold, type: "required_and_optional" };
  if (optionalThreshold > 0) return { threshold: optionalThreshold, type: "optional_only" };
  return { threshold: rc, type: null };
}

const thresholdBucket = (threshold) =>
  threshold === "unknown" ? "unknown" : threshold >= 6 ? "6+" : String(threshold);

/**
 * A per-chain DVN quorum, keyed two ways:
 *   key          by operator name, so the same operators on every chain merge (whom you trust)
 *   contractKey  by chain + contract address. Each chain runs its own DVN contracts, with their
 *                own signers, admins and upgrades, so the same names on another chain are a
 *                separate configuration that can fail on its own.
 */
function namedDvnSet(quorum, labels) {
  const { threshold, type } = quorumShape(quorum.rc, quorum.ot);
  if (!type) return null;
  const addresses = (list) => (list ?? []).map((address) => address.toLowerCase()).sort();
  const requiredAddresses = type === "optional_only" ? [] : addresses(quorum.req);
  const optionalAddresses = type === "required" ? [] : addresses(quorum.opt);
  const names = (list) => list.map((address) => labels.dvnLabel(address, quorum.dst)).sort();
  const required = names(requiredAddresses);
  const optional = names(optionalAddresses);
  const optionalThreshold = type === "required" ? 0 : quorum.ot;
  return {
    key: JSON.stringify([type, required, optional, optionalThreshold]),
    contractKey: JSON.stringify([
      quorum.dst,
      type,
      requiredAddresses,
      optionalAddresses,
      optionalThreshold,
    ]),
    contracts: [...requiredAddresses, ...optionalAddresses].map((a) => `${quorum.dst}:${a}`),
    type,
    threshold,
    required,
    optional,
    optionalThreshold,
  };
}

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    const cache = readJson(CACHE_PATH);
    return cache.version === CUBE_VERSION ? cache : null;
  } catch (error) {
    console.warn(`Ignoring unreadable cube cache: ${error.message}`);
    return null;
  }
}

async function refreshCube(sql, { full, cutoff }) {
  const cached = full ? null : loadCache();
  const fromDay = cached ? cached.lastDay - REFRESH_DAYS + 1 : 0;
  console.log(
    cached
      ? `Refreshing cube from ${isoDay(fromDay)} (cached through ${isoDay(cached.lastDay)})`
      : "Building cube from scratch (full scan)…",
  );

  const started = Date.now();
  const rows = await sql.unsafe(CUBE_SQL, [fromDay * DAY, cutoff]);
  console.log(`  ${rows.length.toLocaleString()} cube rows in ${Date.now() - started} ms`);

  const cube = {
    version: CUBE_VERSION,
    lastDay: cached?.lastDay ?? 0,
    dst: (cached?.dst ?? []).filter((row) => row[0] < fromDay),
    src: (cached?.src ?? []).filter((row) => row[0] < fromDay),
    quorums: cached?.quorums ?? {},
  };

  for (const row of rows) {
    if (row.no_src === 0) {
      cube.src.push([row.d, row.src, row.n]);
    } else if (row.no_cls === 0) {
      cube.dst.push([row.d, row.dst, row.cls, row.q, row.n]);
      cube.lastDay = Math.max(cube.lastDay, row.d);
    } else {
      cube.quorums[`${row.dst}|${row.q}`] = [row.req, row.opt, row.rc, row.ot];
    }
  }

  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cube));
  return cube;
}

const isoDay = (day) => new Date(day * DAY * 1000).toISOString().slice(0, 10);

function emptyWindowStats() {
  return {
    total: 0,
    flags: { allDefault: 0, defaultLibrary: 0, defaultConfig: 0, tracked: 0 },
    tiers: Object.fromEntries(TIER_BY_CODE.map((tier) => [tier, 0])),
    thresholds: {},
    destinations: new Map(),
    sources: new Map(),
    quorums: new Map(),
    configChanges: { lz: 0, owner: 0 },
  };
}

const increment = (map, key, amount) => map.set(key, (map.get(key) ?? 0) + amount);
const sortedEntries = (map) => Array.from(map.entries()).sort((a, b) => b[1] - a[1]);

function rankDvnSets(quorumCounts, cube, labels) {
  const sets = new Map();
  const contractSets = new Set();
  const unnamed = new Set();
  for (const [quorumKey, packets] of quorumCounts) {
    const [dst] = quorumKey.split("|");
    const [req, opt, rc, ot] = cube.quorums[quorumKey] ?? [];
    const set = namedDvnSet({ dst: Number(dst), req, opt, rc, ot }, labels);
    if (!set) continue;
    for (const label of [...set.required, ...set.optional]) {
      if (isUnnamed(label)) unnamed.add(label);
    }
    contractSets.add(set.contractKey);
    let entry = sets.get(set.key);
    if (!entry) {
      entry = { ...set, packets: 0, contractKeys: new Set(), chains: new Set() };
      sets.set(set.key, entry);
    }
    entry.packets += packets;
    entry.contractKeys.add(set.contractKey);
    entry.chains.add(dst);
  }
  const ranked = Array.from(sets.values()).sort((a, b) => b.packets - a.packets);
  return {
    distinct: ranked.length,
    distinctRequiredOnly: ranked.filter((set) => set.type === "required").length,
    distinctContractSets: contractSets.size,
    unnamedAddresses: unnamed.size,
    top: ranked
      .slice(0, TOP_DVN_SETS)
      .map(({ type, required, optional, optionalThreshold, packets, contractKeys, chains }) => ({
        type,
        required,
        optional,
        optionalThreshold,
        packets,
        contractSets: contractKeys.size,
        chains: chains.size,
      })),
  };
}

function buildWindows(cube, changes, labels) {
  const lastDay = cube.lastDay;
  const firstDay = cube.dst.reduce((min, row) => Math.min(min, row[0]), lastDay);
  const windows = WINDOWS.map(([name, days]) => ({
    name,
    days,
    fromDay: days ? Math.max(firstDay, lastDay - days + 1) : firstDay,
    stats: emptyWindowStats(),
  }));

  for (const [day, dst, cls, q, n] of cube.dst) {
    const { threshold } = quorumShapeFor(cube, dst, q);
    for (const { fromDay, stats } of windows) {
      if (day < fromDay) continue;
      stats.total += n;
      if (cls & 1) stats.flags.defaultLibrary += n;
      if (cls & 2) stats.flags.defaultConfig += n;
      if ((cls & 3) === 3) stats.flags.allDefault += n;
      if (cls & 4) stats.flags.tracked += n;
      stats.tiers[TIER_BY_CODE[cls >> 3]] += n;
      const bucket = thresholdBucket(threshold);
      stats.thresholds[bucket] = (stats.thresholds[bucket] ?? 0) + n;
      increment(stats.destinations, dst, n);
      increment(stats.quorums, `${dst}|${q}`, n);
    }
  }
  for (const [day, src, n] of cube.src) {
    for (const { fromDay, stats } of windows) {
      if (day >= fromDay) increment(stats.sources, src, n);
    }
  }
  for (const [hour, who, n] of changes) {
    for (const { days, fromDay, stats } of windows) {
      if (days === null || Math.floor(hour / 24) >= fromDay) stats.configChanges[who] += n;
    }
  }

  return {
    firstDay,
    windows: windows.map(({ name, days, fromDay, stats }) => ({
      name,
      days,
      fromDay,
      total: stats.total,
      flags: stats.flags,
      tiers: stats.tiers,
      thresholds: stats.thresholds,
      destinations: sortedEntries(stats.destinations),
      sources: sortedEntries(stats.sources),
      configChanges: stats.configChanges,
      dvnSets: rankDvnSets(stats.quorums, cube, labels),
    })),
  };
}

const shapeCache = new Map();
function quorumShapeFor(cube, dst, q) {
  const key = `${dst}|${q}`;
  let shape = shapeCache.get(key);
  if (!shape) {
    const [, , rc, ot] = cube.quorums[key] ?? [];
    shape = quorumShape(rc, ot);
    shapeCache.set(key, shape);
  }
  return shape;
}

/** Columnar daily series; per-chain series only for chains that rank top-N in some window. */
function buildDailySeries(cube, changes, firstDay, windows) {
  const length = cube.lastDay - firstDay + 1;
  const zeros = () => new Array(length).fill(0);
  const pickChains = (field) =>
    Array.from(
      new Set(windows.flatMap((w) => w[field].slice(0, SERIES_CHAIN_LIMIT).map(([eid]) => eid))),
    );
  const series = {
    firstDay,
    packets: zeros(),
    lzChanges: zeros(),
    ownerChanges: zeros(),
    tiers: Object.fromEntries(TIER_BY_CODE.map((tier) => [tier, zeros()])),
    thresholds: {},
    destinations: Object.fromEntries(pickChains("destinations").map((eid) => [eid, zeros()])),
    sources: Object.fromEntries(pickChains("sources").map((eid) => [eid, zeros()])),
  };

  for (const [day, dst, cls, q, n] of cube.dst) {
    const i = day - firstDay;
    series.packets[i] += n;
    series.tiers[TIER_BY_CODE[cls >> 3]][i] += n;
    const bucket = thresholdBucket(quorumShapeFor(cube, dst, q).threshold);
    (series.thresholds[bucket] ??= zeros())[i] += n;
    if (series.destinations[dst]) series.destinations[dst][i] += n;
  }
  for (const [day, src, n] of cube.src) {
    if (series.sources[src]) series.sources[src][day - firstDay] += n;
  }
  for (const [hour, who, n] of changes) {
    const i = Math.floor(hour / 24) - firstDay;
    if (i >= 0 && i < length) series[who === "lz" ? "lzChanges" : "ownerChanges"][i] += n;
  }
  return series;
}

async function buildHourlySeries(sql, changes, lastDay, cutoff) {
  const firstHour = (lastDay - HOURLY_DAYS + 1) * 24;
  const length = (lastDay + 1) * 24 - firstHour;
  const zeros = () => new Array(length).fill(0);
  const series = { firstHour, packets: zeros(), lzChanges: zeros(), ownerChanges: zeros() };
  for (const { h, n } of await sql.unsafe(HOURLY_PACKETS_SQL, [firstHour * HOUR, cutoff])) {
    if (h - firstHour < length) series.packets[h - firstHour] += n;
  }
  for (const [hour, who, n] of changes) {
    const i = hour - firstHour;
    if (i >= 0 && i < length) series[who === "lz" ? "lzChanges" : "ownerChanges"][i] += n;
  }
  return series;
}

/**
 * Meshes: connected components of OApps joined by configured or observed peers
 * (an OFT deployed on N chains is one mesh). Each open inbound route is a door
 * with its own verifier set, and the mesh is only as strong as its weakest one.
 */
async function buildMeshes(sql, labels, lastDay, cutoff) {
  const [routes, windowPackets, totals] = await Promise.all([
    sql.unsafe(ROUTES_SQL),
    sql.unsafe(OAPP_WINDOW_PACKETS_SQL, [(lastDay - MESH_WINDOW_DAYS + 1) * DAY, cutoff]),
    sql.unsafe(OAPP_TOTALS_SQL),
  ]);
  const aliases = readJson(ALIASES_PATH);
  const packets30d = new Map(windowPackets.map((row) => [row.oappId, row.n]));
  const packetsAll = new Map(totals.map((row) => [row.id, row.n]));

  const parent = new Map();
  const find = (id) => {
    if (!parent.has(id)) parent.set(id, id);
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== root) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (a, b) => parent.set(find(a), find(b));

  const openRoutes = [];
  for (const route of routes) {
    find(route.oappId);
    const peerId = route.peerOappId;
    const peerAddress = peerId ? peerId.slice(peerId.indexOf("_") + 1) : null;
    if (!peerId || !route.peer || ZERO_ADDRESS_PATTERN.test(peerAddress)) continue;
    if (route.libraryStatus === "none") continue;
    const requiredLabels = (route.req ?? []).map((address) =>
      labels.dvnLabel(address, localEidOf(route.oappId)),
    );
    if ((route.req ?? []).some((address, i) => isDeadDvn(address, requiredLabels[i]))) continue;
    union(route.oappId, peerId);
    openRoutes.push(route);
  }
  for (const id of packetsAll.keys()) find(id);

  const meshes = new Map();
  const meshOf = (id) => {
    const root = find(id);
    let mesh = meshes.get(root);
    if (!mesh) {
      mesh = {
        members: new Set(),
        routes: 0,
        trackedRoutes: 0,
        tiers: Object.fromEntries(TIER_BY_CODE.map((tier) => [tier, 0])),
        dvnSets: new Set(),
        operators: new Set(),
        dvnContracts: new Set(),
        weakest: null,
        weakestRoutes: 0,
      };
      meshes.set(root, mesh);
    }
    return mesh;
  };
  for (const id of parent.keys()) meshOf(id).members.add(id);

  for (const route of openRoutes) {
    const mesh = meshOf(route.oappId);
    mesh.routes += 1;
    mesh.tiers[trustTier(route)] += 1;
    if (!route.isConfigTracked) continue;
    const set = namedDvnSet({ ...route, dst: localEidOf(route.oappId) }, labels);
    if (!set) continue;
    mesh.trackedRoutes += 1;
    mesh.dvnSets.add(set.key);
    for (const label of [...set.required, ...set.optional]) mesh.operators.add(label);
    for (const contract of set.contracts) mesh.dvnContracts.add(contract);
    if (mesh.weakest === null || set.threshold < mesh.weakest) {
      mesh.weakest = set.threshold;
      mesh.weakestRoutes = 1;
    } else if (set.threshold === mesh.weakest) {
      mesh.weakestRoutes += 1;
    }
  }

  const summarized = [];
  for (const mesh of meshes.values()) {
    const members = Array.from(mesh.members);
    const recent = members.reduce((sum, id) => sum + (packets30d.get(id) ?? 0), 0);
    if (recent === 0) continue;
    const seed = members.reduce((best, id) =>
      (packets30d.get(id) ?? 0) > (packets30d.get(best) ?? 0) ? id : best,
    );
    summarized.push({
      name: meshName(members, aliases),
      seed,
      seedChain: labels.chainLabel(localEidOf(seed)),
      oapps: members.length,
      chains: new Set(members.map(localEidOf)).size,
      routes: mesh.routes,
      trackedRoutes: mesh.trackedRoutes,
      dvnSets: mesh.dvnSets.size,
      operators: mesh.operators.size,
      dvnContracts: mesh.dvnContracts.size,
      weakest: mesh.weakest,
      weakestRoutes: mesh.weakestRoutes,
      tiers: mesh.tiers,
      packets30d: recent,
      packetsAll: members.reduce((sum, id) => sum + (packetsAll.get(id) ?? 0), 0),
    });
  }
  summarized.sort((a, b) => b.packets30d - a.packets30d);

  return {
    windowDays: MESH_WINDOW_DAYS,
    receivingOApps: packetsAll.size,
    activeOApps: packets30d.size,
    activeMeshes: summarized.length,
    top: summarized.slice(0, TOP_MESHES),
    // [chains, routes, distinct DVN sets, weakest threshold, packets30d] for every active mesh
    points: summarized.map((m) => [m.chains, m.routes, m.dvnSets, m.weakest, m.packets30d]),
  };
}

const localEidOf = (oappId) => Number(String(oappId).slice(0, String(oappId).indexOf("_")));

function meshName(members, aliases) {
  const counts = new Map();
  for (const id of members) {
    const name = aliases[id]?.name;
    if (name) increment(counts, name, 1);
  }
  return sortedEntries(counts)[0]?.[0] ?? null;
}

async function main() {
  const full = process.argv.includes("--full");
  const sql = postgres({
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 17432),
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "testing",
    database: process.env.PGDATABASE ?? "envio-dev",
    max: 4,
    onnotice: () => {},
    // eids and packet counts are int8 but far below 2^53
    types: { int8: { to: 20, from: [20], serialize: String, parse: Number } },
  });

  try {
    const labels = await loadLabels();
    // Every time-bounded query stops here, so all numbers describe the same snapshot
    // even while the indexer keeps writing.
    const [{ cutoff }] =
      await sql`SELECT max("blockTimestamp")::float8 AS cutoff FROM "PacketDelivered"`;
    if (cutoff === null) throw new Error("PacketDelivered is empty");
    const cube = await refreshCube(sql, { full, cutoff });

    const changes = (await sql.unsafe(CONFIG_CHANGES_SQL, [cutoff])).map((row) => [
      row.h,
      row.who,
      row.n,
    ]);
    const { firstDay, windows } = buildWindows(cube, changes, labels);
    const [hourly, meshes] = await Promise.all([
      buildHourlySeries(sql, changes, cube.lastDay, cutoff),
      buildMeshes(sql, labels, cube.lastDay, cutoff),
    ]);
    const daily = buildDailySeries(cube, changes, firstDay, windows);

    const chainIds = new Set([
      ...windows.flatMap((w) => [...w.destinations, ...w.sources].map(([eid]) => eid)),
    ]);
    const stats = {
      schemaVersion: SCHEMA_VERSION,
      computedAt: new Date().toISOString(),
      dataThrough: cutoff,
      coverage: {
        indexedChainCount: labels.indexedChainCount,
        sourceEidCount: windows.at(-1).sources.length,
      },
      chains: Object.fromEntries(Array.from(chainIds, (eid) => [eid, labels.chainLabel(eid)])),
      windows: Object.fromEntries(windows.map((w) => [w.name, w])),
      series: { daily, hourly },
      meshes,
    };

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(stats));
    const all = stats.windows.all;
    console.log(
      `Wrote ${path.relative(repoRoot, OUTPUT_PATH)} (${fs.statSync(OUTPUT_PATH).size.toLocaleString()} bytes)`,
    );
    console.log(
      `  ${all.total.toLocaleString()} packets, ${isoDay(firstDay)} → ${isoDay(cube.lastDay)}`,
    );
    console.log(
      `  ${all.dvnSets.distinctContractSets} DVN contract sets (${all.dvnSets.distinct} by name), ${meshes.activeMeshes} active meshes`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
