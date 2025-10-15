"use strict";

/**
 * One-time aggregation script that looks at the PacketDelivered entities for the
 * last N days (30 by default) and produces security configuration statistics.
 *
 * Usage:
 *   node scripts/packetSecuritySummary.js \
 *     --endpoint=http://localhost:8080/v1/graphql \
 *     --days=30 \
 *     --out=packet_security_summary.json
 *
 * Environment variable GRAPHQL_ENDPOINT takes precedence over --endpoint.
 */

const fs = require("fs");
const path = require("path");

const LAYERZERO_CHAINS_V2 = [
  { name: "Abstract Mainnet", slug: "abstract", chainId: 2741, eid: 30324 },
  { name: "Animechain Mainnet", slug: "animechain", chainId: 69000, eid: 30372 },
  { name: "Ape Mainnet", slug: "ape", chainId: 33139, eid: 30312 },
  { name: "Aptos", slug: "aptos", chainId: null, eid: 30108 },
  { name: "Arbitrum Mainnet", slug: "arbitrum", chainId: 42161, eid: 30110 },
  { name: "Arbitrum Nova Mainnet", slug: "arbitrumnova", chainId: 42170, eid: 30175 },
  { name: "Astar Mainnet", slug: "astar", chainId: 592, eid: 30210 },
  { name: "Astar zkEVM Mainnet", slug: "astarzkevm", chainId: 3776, eid: 30257 },
  { name: "Avalanche Mainnet", slug: "avalanche", chainId: 43114, eid: 30106 },
  { name: "BNB Smart Chain (BSC) Mainnet", slug: "bsc", chainId: 56, eid: 30102 },
  { name: "BOB Mainnet", slug: "bob", chainId: 60808, eid: 30279 },
  { name: "Bahamut Mainnet", slug: "bahamut", chainId: 5165, eid: 30363 },
  { name: "Base Mainnet", slug: "base", chainId: 8453, eid: 30184 },
  { name: "Beam Mainnet", slug: "beam", chainId: 4337, eid: 30198 },
  { name: "Berachain Mainnet", slug: "berachain", chainId: 80094, eid: 30362 },
  { name: "Bevm Mainnet", slug: "bevm", chainId: 11501, eid: 30317 },
  { name: "Bitlayer Mainnet", slug: "bitlayer", chainId: 200901, eid: 30314 },
  { name: "Blast Mainnet", slug: "blast", chainId: 81457, eid: 30243 },
  { name: "Botanix", slug: "botanix", chainId: 3637, eid: 30376 },
  { name: "Bouncebit Mainnet", slug: "bouncebit", chainId: 6001, eid: 30293 },
  { name: "Canto Mainnet", slug: "canto", chainId: 7700, eid: 30159 },
  { name: "Celo Mainnet", slug: "celo", chainId: 42220, eid: 30125 },
  { name: "Codex Mainnet", slug: "codex", chainId: 81224, eid: 30323 },
  { name: "Concrete", slug: "concrete", chainId: 12739, eid: 30366 },
  { name: "Conflux eSpace Mainnet", slug: "conflux", chainId: 1030, eid: 30212 },
  { name: "CoreDAO Mainnet", slug: "coredao", chainId: 1116, eid: 30153 },
  { name: "Corn Mainnet", slug: "corn", chainId: 21000000, eid: 30331 },
  { name: "Cronos EVM Mainnet", slug: "cronos", chainId: 25, eid: 30359 },
  { name: "Cronos zkEVM Mainnet", slug: "cronoszkevm", chainId: 388, eid: 30360 },
  { name: "Cyber Mainnet", slug: "cyber", chainId: 7560, eid: 30283 },
  { name: "DFK Chain", slug: "dfk", chainId: 53935, eid: 30115 },
  { name: "DM2 Verse Mainnet", slug: "dm2verse", chainId: 68770, eid: 30315 },
  { name: "DOS Chain Mainnet", slug: "dos", chainId: 7979, eid: 30149 },
  { name: "Degen Mainnet", slug: "degen", chainId: 666666666, eid: 30267 },
  { name: "Dexalot Subnet Mainnet", slug: "dexalot", chainId: 432204, eid: 30118 },
  { name: "EDU Chain Mainnet", slug: "edu", chainId: 41923, eid: 30328 },
  { name: "EVM on Flow Mainnet", slug: "evmonflow", chainId: 747, eid: 30336 },
  { name: "Ethereum Mainnet", slug: "ethereum", chainId: 1, eid: 30101 },
  { name: "Etherlink Mainnet", slug: "etherlink", chainId: 42793, eid: 30292 },
  { name: "Fantom Mainnet", slug: "fantom", chainId: 250, eid: 30112 },
  { name: "Flare Mainnet", slug: "flare", chainId: 14, eid: 30295 },
  { name: "Fraxtal Mainnet", slug: "fraxtal", chainId: 252, eid: 30255 },
  { name: "Fuse Mainnet", slug: "fuse", chainId: 122, eid: 30138 },
  { name: "Glue Mainnet", slug: "glue", chainId: 1300, eid: 30342 },
  { name: "Gnosis Mainnet", slug: "gnosis", chainId: 100, eid: 30145 },
  { name: "Goat Mainnet", slug: "goat", chainId: 2345, eid: 30361 },
  { name: "Gravity Mainnet", slug: "gravity", chainId: 1625, eid: 30294 },
  { name: "Gunz Mainnet", slug: "gunz", chainId: 43419, eid: 30371 },
  { name: "Harmony Mainnet", slug: "harmony", chainId: 1666600000, eid: 30116 },
  { name: "Hedera Mainnet", slug: "hedera", chainId: 295, eid: 30316 },
  { name: "Hemi Mainnet", slug: "hemi", chainId: 43111, eid: 30329 },
  { name: "Homeverse Mainnet", slug: "homeverse", chainId: 19011, eid: 30265 },
  { name: "Horizen EON Mainnet", slug: "horizen", chainId: 7332, eid: 30215 },
  { name: "Hubble Mainnet", slug: "hubble", chainId: 1992, eid: 30182 },
  { name: "HyperEVM Mainnet", slug: "hyperevm", chainId: 999, eid: 30367 },
  { name: "Initia Mainnet", slug: "initia", chainId: null, eid: 30326 },
  { name: "Ink Mainnet", slug: "ink", chainId: 57073, eid: 30339 },
  { name: "Iota Mainnet", slug: "iota", chainId: 8822, eid: 30284 },
  { name: "Japan Open Chain Mainnet", slug: "japanopenchain", chainId: 81, eid: 30285 },
  { name: "Kaia Mainnet (formerly Klaytn)", slug: "kaia", chainId: 8217, eid: 30150 },
  { name: "Katana", slug: "katana", chainId: 747474, eid: 30375 },
  { name: "Kava Mainnet", slug: "kava", chainId: 2222, eid: 30177 },
  { name: "Lens Mainnet", slug: "lens", chainId: 232, eid: 30373 },
  { name: "Lightlink Mainnet", slug: "lightlink", chainId: 1890, eid: 30309 },
  { name: "Linea Mainnet", slug: "linea", chainId: 59144, eid: 30183 },
  { name: "Lisk Mainnet", slug: "lisk", chainId: 1135, eid: 30321 },
  { name: "Loot Mainnet", slug: "loot", chainId: 5151706, eid: 30197 },
  { name: "Lyra Mainnet", slug: "lyra", chainId: 957, eid: 30311 },
  { name: "Manta Pacific Mainnet", slug: "mantapacific", chainId: 169, eid: 30217 },
  { name: "Mantle Mainnet", slug: "mantle", chainId: 5000, eid: 30181 },
  { name: "Merlin Mainnet", slug: "merlin", chainId: 4200, eid: 30266 },
  { name: "Meter Mainnet", slug: "meter", chainId: 82, eid: 30176 },
  { name: "Metis Mainnet", slug: "metis", chainId: 1088, eid: 30151 },
  { name: "Mode Mainnet", slug: "mode", chainId: 34443, eid: 30260 },
  { name: "Moonbeam Mainnet", slug: "moonbeam", chainId: 1284, eid: 30126 },
  { name: "Moonriver Mainnet", slug: "moonriver", chainId: 1285, eid: 30167 },
  { name: "Morph Mainnet", slug: "morph", chainId: 2818, eid: 30322 },
  { name: "Movement Mainnet", slug: "movement", chainId: null, eid: 30325 },
  { name: "Near Aurora Mainnet", slug: "aurora", chainId: 1313161554, eid: 30211 },
  { name: "Nibiru Mainnet", slug: "nibiru", chainId: 6900, eid: 30369 },
  { name: "OKX Mainnet", slug: "okx", chainId: 66, eid: 30155 },
  { name: "Optimism Mainnet", slug: "optimism", chainId: 10, eid: 30111 },
  { name: "Orderly Mainnet", slug: "orderly", chainId: 291, eid: 30213 },
  { name: "Otherworld Space Mainnet", slug: "otherworldspace", chainId: 8227, eid: 30341 },
  { name: "Peaq Mainnet", slug: "peaq", chainId: 3338, eid: 30302 },
  { name: "Plume Mainnet", slug: "plume", chainId: 98866, eid: 30370 },
  { name: "Polygon Mainnet", slug: "polygon", chainId: 137, eid: 30109 },
  { name: "Polygon zkEVM Mainnet", slug: "polygonzkevm", chainId: 1101, eid: 30158 },
  { name: "Rari Chain Mainnet", slug: "rari", chainId: 1380012617, eid: 30235 },
  { name: "Reya Mainnet", slug: "reya", chainId: 1729, eid: 30313 },
  { name: "Rootstock Mainnet", slug: "rootstock", chainId: 30, eid: 30333 },
  { name: "Sanko Mainnet", slug: "sanko", chainId: 1996, eid: 30278 },
  { name: "Scroll Mainnet", slug: "scroll", chainId: 534352, eid: 30214 },
  { name: "Sei Mainnet", slug: "sei", chainId: 1329, eid: 30280 },
  { name: "Shimmer Mainnet", slug: "shimmer", chainId: 148, eid: 30230 },
  { name: "Skale Mainnet", slug: "skale", chainId: 2046399126, eid: 30273 },
  { name: "Solana Mainnet", slug: "solana", chainId: 101, eid: 30168 },
  { name: "Soneium Mainnet", slug: "soneium", chainId: 1868, eid: 30340 },
  { name: "Sonic Mainnet", slug: "sonic", chainId: 146, eid: 30332 },
  { name: "Sophon Mainnet", slug: "sophon", chainId: 50104, eid: 30334 },
  { name: "Story Mainnet", slug: "story", chainId: 1514, eid: 30364 },
  { name: "Subtensor EVM Mainnet", slug: "subtensor", chainId: 964, eid: 30374 },
  { name: "Superposition Mainnet", slug: "superposition", chainId: 55244, eid: 30327 },
  { name: "Swell Mainnet", slug: "swell", chainId: 1923, eid: 30335 },
  { name: "TON Mainnet", slug: "ton", chainId: null, eid: 30343 },
  { name: "Tac", slug: "tac", chainId: 239, eid: 30377 },
  { name: "Taiko Mainnet", slug: "taiko", chainId: 167000, eid: 30290 },
  { name: "TelosEVM Mainnet", slug: "telos", chainId: 40, eid: 30199 },
  { name: "Tenet Mainnet", slug: "tenet", chainId: 1559, eid: 30173 },
  { name: "Tiltyard Mainnet", slug: "tiltyard", chainId: 710420, eid: 30238 },
  { name: "Tron Mainnet", slug: "tron", chainId: 728126428, eid: 30420 },
  { name: "Unichain Mainnet", slug: "unichain", chainId: 130, eid: 30320 },
  { name: "Vana Mainnet", slug: "vana", chainId: 1480, eid: 30330 },
  { name: "Viction Mainnet", slug: "viction", chainId: 88, eid: 30196 },
  { name: "Worldchain Mainnet", slug: "worldchain", chainId: 480, eid: 30319 },
  { name: "X Layer Mainnet", slug: "xlayer", chainId: 196, eid: 30274 },
  { name: "XChain Mainnet", slug: "xchain", chainId: 94524, eid: 30291 },
  { name: "XDC Mainnet", slug: "xdc", chainId: 50, eid: 30365 },
  { name: "XPLA Mainnet", slug: "xpla", chainId: 37, eid: 30216 },
  { name: "Xai Mainnet", slug: "xai", chainId: 660279, eid: 30236 },
  { name: "Zircuit Mainnet", slug: "zircuit", chainId: 48900, eid: 30303 },
  { name: "Zora Mainnet", slug: "zora", chainId: 7777777, eid: 30195 },
  { name: "inEVM Mainnet", slug: "inevm", chainId: 2525, eid: 30234 },
  { name: "opBNB Mainnet", slug: "opbnb", chainId: 204, eid: 30202 },
  { name: "re.al Mainnet", slug: "real", chainId: 111188, eid: 30237 },
  { name: "zkLink Mainnet", slug: "zklink", chainId: 810180, eid: 30301 },
  { name: "zkSync Era Mainnet", slug: "zksync", chainId: 324, eid: 30165 },
];

function parseArgs(argv) {
  const args = {};
  for (const part of argv.slice(2)) {
    const match = part.match(/^--([^=]+)=(.*)$/);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

function loadDvnNames(filePath) {
  const result = {
    map: new Map(),
    resolvedPath: filePath,
    found: false,
  };

  if (!filePath) return result;

  let resolved = filePath;
  if (!path.isAbsolute(resolved)) {
    resolved = path.resolve(process.cwd(), filePath);
  }
  result.resolvedPath = resolved;

  if (!fs.existsSync(resolved)) {
    console.warn(`layerzero.json not found at ${resolved}, DVN names will be omitted.`);
    return result;
  }

  try {
    const raw = fs.readFileSync(resolved, "utf8");
    const json = JSON.parse(raw);
    for (const value of Object.values(json)) {
      if (!value || typeof value !== "object") continue;
      const dvns = value.dvns;
      if (!dvns || typeof dvns !== "object") continue;
      for (const [address, details] of Object.entries(dvns)) {
        if (!address) continue;
        const name = details?.canonicalName || details?.id;
        if (!name) continue;
        result.map.set(address.toLowerCase(), name);
      }
    }
    result.found = true;
  } catch (error) {
    console.warn(`Failed to parse layerzero.json at ${resolved}: ${error.message}`);
  }

  return result;
}

function normalizeAddress(address) {
  return typeof address === "string" ? address.toLowerCase() : undefined;
}

function toNumber(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toStringId(value) {
  if (value === null || value === undefined) return undefined;
  return typeof value === "string" ? value : String(value);
}

function incrementCounter(map, key, amount = 1) {
  const current = map.get(key) ?? 0;
  map.set(key, current + amount);
}

function getChainName(chainId) {
  const numeric = Number(chainId);
  const entry = LAYERZERO_CHAINS_V2.find(
    chain => chain.chainId !== null && Number(chain.chainId) === numeric,
  );
  return entry?.name ?? `Chain ${chainId}`;
}

async function fetchGraphQL(endpoint, query, variables) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(
      `GraphQL HTTP ${response.status}: ${response.statusText}\n${JSON.stringify(json, null, 2)}`,
    );
  }
  if (json.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors, null, 2)}`);
  }
  return json.data;
}

async function fetchDefaultConfigs(endpoint) {
  const limit = 1000;
  let offset = 0;
  const defaults = new Map();

  for (;;) {
    const data = await fetchGraphQL(
      endpoint,
      `
        query DefaultConfigs($limit: Int!, $offset: Int!) {
          DefaultUlnConfig(
            limit: $limit
            offset: $offset
            order_by: { chainId: asc, eid: asc }
          ) {
            chainId
            eid
            confirmations
            requiredDVNCount
            requiredDVNs
            optionalDVNCount
            optionalDVNs
            optionalDVNThreshold
          }
        }
      `,
      { limit, offset },
    );

    const batch = data.DefaultUlnConfig ?? [];
    for (const item of batch) {
      const chainId = toStringId(item.chainId);
      const eid = toStringId(item.eid);
      if (!chainId || !eid) continue;
      const key = `${chainId}_${eid}`;
      defaults.set(key, {
        confirmations: item.confirmations,
        requiredDVNCount: toNumber(item.requiredDVNCount),
        requiredDVNs: (item.requiredDVNs ?? []).map(addr => normalizeAddress(addr)).filter(
          Boolean,
        ),
        optionalDVNCount: toNumber(item.optionalDVNCount),
        optionalDVNs: (item.optionalDVNs ?? []).map(addr => normalizeAddress(addr)).filter(
          Boolean,
        ),
        optionalDVNThreshold: toNumber(item.optionalDVNThreshold),
      });
    }

    if (batch.length < limit) break;
    offset += batch.length;
  }

  return defaults;
}

async function fetchSecurityConfigs(endpoint) {
  const limit = 1000;
  let offset = 0;
  const byId = new Map();
  const byKey = new Map();
  let zeroFallbackTotal = 0;
  const zeroFallbackByChain = new Map();
  let optionalOnlyTotal = 0;
  const optionalOnlyByChain = new Map();

  for (;;) {
    const data = await fetchGraphQL(
      endpoint,
      `
        query SecurityConfigs($limit: Int!, $offset: Int!) {
          OAppSecurityConfig(
            limit: $limit
            offset: $offset
            order_by: { chainId: asc, oappId: asc, eid: asc }
          ) {
            id
            chainId
            oappId
            eid
            receiveLibrary
            configConfirmations
            configRequiredDVNCount
            configRequiredDVNs
            configOptionalDVNCount
            configOptionalDVNs
            configOptionalDVNThreshold
          }
        }
      `,
      { limit, offset },
    );

    const batch = data.OAppSecurityConfig ?? [];
    for (const item of batch) {
      const chainId = toStringId(item.chainId);
      const eid = toStringId(item.eid);
      const entry = {
        id: item.id,
        chainId,
        oappId: item.oappId,
        eid,
        receiveLibrary: normalizeAddress(item.receiveLibrary),
        configConfirmations: item.configConfirmations,
        configRequiredDVNCount: toNumber(item.configRequiredDVNCount),
        configRequiredDVNs: (item.configRequiredDVNs ?? [])
          .map(addr => normalizeAddress(addr))
          .filter(Boolean),
        configOptionalDVNCount: toNumber(item.configOptionalDVNCount),
        configOptionalDVNs: (item.configOptionalDVNs ?? [])
          .map(addr => normalizeAddress(addr))
          .filter(Boolean),
        configOptionalDVNThreshold: toNumber(item.configOptionalDVNThreshold),
      };

      const usesZeroFallback = !entry.configRequiredDVNCount || entry.configRequiredDVNCount <= 0;
      entry.usesZeroFallback = usesZeroFallback;

      if (usesZeroFallback) {
        zeroFallbackTotal += 1;
        if (chainId) {
          incrementCounter(zeroFallbackByChain, chainId);
        }
      }

      const optionalOnly = entry.configRequiredDVNCount === 255;
      entry.optionalOnly = optionalOnly;
      if (optionalOnly) {
        optionalOnlyTotal += 1;
        if (chainId) {
          incrementCounter(optionalOnlyByChain, chainId);
        }
      }

      if (item.id) {
        byId.set(item.id, entry);
      }
      if (chainId && eid) {
        byKey.set(`${chainId}_${eid}`, entry);
      }
    }

    if (batch.length < limit) break;
    offset += batch.length;
  }

  return {
    byId,
    byKey,
    zeroFallbackTotal,
    zeroFallbackByChain,
    optionalOnlyTotal,
    optionalOnlyByChain,
  };
}

async function fetchPackets(endpoint, sinceTimestamp) {
  const limit = 100000;
  let offset = 0;
  const packets = [];

  for (;;) {
    const data = await fetchGraphQL(
      endpoint,
      `
        query PacketBatch($limit: Int!, $offset: Int!, $since: numeric!) {
          PacketDelivered(
            limit: $limit
            offset: $offset
            order_by: { blockTimestamp: asc }
            where: { blockTimestamp: { _gte: $since } }
          ) {
            id
            chainId
            blockTimestamp
            srcEid
            configRequiredDVNCount
            securityConfigId
          }
        }
      `,
      {
        limit,
        offset,
        since: sinceTimestamp,
      },
    );

    const batch = data.PacketDelivered ?? [];
    packets.push(...batch);
    if (batch.length < limit) break;
    offset += batch.length;
    console.log(`  fetched ${packets.length} packets...`);
  }

  return packets;
}

function determineEffectiveConfig(event, securityConfigs, defaultsMap) {
  const chainId = toStringId(event.chainId);
  const eid = toStringId(event.srcEid);
  const key = chainId && eid ? `${chainId}_${eid}` : undefined;
  const defaultConfig = key ? defaultsMap.get(key) : undefined;

  const securityConfig = event.securityConfigId
    ? securityConfigs.byId.get(event.securityConfigId)
    : undefined;
  const fallbackSecurity = securityConfig || (key ? securityConfigs.byKey.get(key) : undefined);
  const result = {
    requiredCount: 0,
    requiredDVNs: [],
    optionalDVNs: [],
    optionalThreshold: undefined,
    optionalOnly: false,
    defaultsApplied: false,
    addressCountMismatch: false,
    optionalAddressMismatch: false,
  };

  const applySource = source => {
    if (!source) return false;
    const requiredRaw = toNumber(source.configRequiredDVNCount);
    const optionalRaw = toNumber(source.configOptionalDVNCount);
    const optionalThreshold = toNumber(source.configOptionalDVNThreshold);
    const requiredList = (source.configRequiredDVNs ?? []).map(addr => normalizeAddress(addr)).filter(Boolean);
    const optionalList = (source.configOptionalDVNs ?? []).map(addr => normalizeAddress(addr)).filter(Boolean);

    if (requiredRaw === 255) {
      result.optionalOnly = true;
      result.requiredCount = 0;
      result.requiredDVNs = [];
      result.optionalDVNs = optionalList;
      result.optionalThreshold = optionalThreshold ?? optionalRaw ?? optionalList.length;
      return true;
    }

    const normalizedRequired = requiredRaw && requiredRaw > 0 ? requiredRaw : undefined;
    result.requiredCount = normalizedRequired ?? 0;
    result.requiredDVNs = requiredList;
    result.optionalDVNs = optionalList;
    result.optionalThreshold = optionalThreshold ?? optionalRaw ?? optionalList.length;
    return normalizedRequired !== undefined;
  };

  let sourceApplied = false;

  if (fallbackSecurity && !fallbackSecurity.usesZeroFallback) {
    sourceApplied = applySource(fallbackSecurity);
  }

  if (!sourceApplied && defaultConfig) {
    if (!result.optionalOnly && (result.requiredCount === 0 || result.requiredDVNs.length < result.requiredCount)) {
      result.defaultsApplied = true;
      const defaultSource = {
        configRequiredDVNCount: defaultConfig.requiredDVNCount,
        configRequiredDVNs: defaultConfig.requiredDVNs,
        configOptionalDVNCount: defaultConfig.optionalDVNCount,
        configOptionalDVNs: defaultConfig.optionalDVNs,
        configOptionalDVNThreshold: defaultConfig.optionalDVNThreshold,
      };
      sourceApplied = applySource(defaultSource) || sourceApplied;
    }
  }

  if (!sourceApplied) {
    const eventRequired = toNumber(event.configRequiredDVNCount);
    if (eventRequired && eventRequired > 0) {
      result.requiredCount = eventRequired;
    }
  }

  if (!result.optionalOnly) {
    if (!result.requiredCount || Number.isNaN(result.requiredCount)) {
      result.requiredCount = 0;
    }
    if (result.requiredDVNs.length < result.requiredCount && defaultConfig) {
      const fallbackList = (defaultConfig.requiredDVNs ?? [])
        .map(addr => normalizeAddress(addr))
        .filter(Boolean);
      if (fallbackList.length >= (defaultConfig.requiredDVNCount ?? result.requiredCount)) {
        result.requiredDVNs = fallbackList;
        result.requiredCount = defaultConfig.requiredDVNCount ?? result.requiredCount;
        result.defaultsApplied = true;
      }
    }
    result.addressCountMismatch = result.requiredDVNs.length < result.requiredCount;
  } else {
    // optional-only configs rely on optional DVNs; ensure threshold is respected
    if (result.optionalThreshold === undefined || Number.isNaN(result.optionalThreshold)) {
      result.optionalThreshold = result.optionalDVNs.length;
    }
    if (result.optionalDVNs.length < (result.optionalThreshold ?? 0)) {
      result.optionalAddressMismatch = true;
      if (defaultConfig) {
        const fallbackOptional = (defaultConfig.optionalDVNs ?? [])
          .map(addr => normalizeAddress(addr))
          .filter(Boolean);
        const fallbackThreshold = defaultConfig.optionalDVNThreshold ?? defaultConfig.optionalDVNCount ?? fallbackOptional.length;
        if (fallbackOptional.length >= fallbackThreshold) {
          result.optionalDVNs = fallbackOptional;
          result.optionalThreshold = fallbackThreshold;
          result.defaultsApplied = true;
          result.optionalAddressMismatch = false;
        }
      }
    }
  }

  return result;
}

async function main() {
const args = parseArgs(process.argv);
  const endpoint =
    process.env.GRAPHQL_ENDPOINT ??
    args.endpoint ??
    "http://localhost:8080/v1/graphql";

  const layerzeroPath = args.layerzero ?? "layerzero.json";
  const dvnNames = loadDvnNames(layerzeroPath);
  if (dvnNames.found) {
    console.log(
      `Loaded ${dvnNames.map.size} DVN canonical names from ${dvnNames.resolvedPath}`,
    );
  }

  const days = Number(args.days ?? 30);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid --days value (${args.days}). Must be > 0.`);
  }

  const secondsInDay = 24 * 60 * 60;
  const sinceSeconds = Math.floor(Date.now() / 1000 - days * secondsInDay);
  const since = String(sinceSeconds);

  const outputPath = path.resolve(
    process.cwd(),
    args.out ?? "packet_security_summary.json",
  );

  console.log(
    `Fetching PacketDelivered events since ${new Date(
      sinceSeconds * 1000,
    ).toISOString()} from ${endpoint}`,
  );

  const defaultsMap = await fetchDefaultConfigs(endpoint);
  console.log(`Loaded ${defaultsMap.size} DefaultUlnConfig entries`);

  const securityConfigs = await fetchSecurityConfigs(endpoint);
  console.log(`Loaded ${securityConfigs.byId.size} OAppSecurityConfig entries`);
  console.log(
    `${securityConfigs.zeroFallbackTotal} configs rely on default DVN settings (requiredDVNCount <= 0)`,
  );
  console.log(
    `${securityConfigs.optionalOnlyTotal} configs use optional-only DVN mode (requiredDVNCount === 255)`,
  );

  const packets = await fetchPackets(endpoint, since);
  console.log(`Fetched ${packets.length} PacketDelivered events`);

  const totalsByGroup = new Map();
  const totalsByChain = new Map();
  const totalsByDvnAddress = new Map();
  const requiredNameGroups = new Map();
  const optionalNameGroups = new Map();
  let packetsMissingAddresses = 0;
  let packetsOptionalMismatch = 0;

  let packetsUsingDefaults = 0;

  const getGroupKey = config =>
    config.optionalOnly
      ? `optional:${config.optionalThreshold ?? 0}`
      : `required:${config.requiredCount ?? 0}`;

  const ensureGroupEntry = (map, key, config) => {
    let entry = map.get(key);
    if (!entry) {
      entry = config.optionalOnly
        ? {
            key,
            optionalOnly: true,
            optionalThreshold: config.optionalThreshold ?? 0,
            packetCount: 0,
          }
        : {
            key,
            optionalOnly: false,
            requiredDVNs: config.requiredCount ?? 0,
            packetCount: 0,
          };
      map.set(key, entry);
    }
    if (config.optionalOnly) {
      entry.optionalThreshold = config.optionalThreshold ?? entry.optionalThreshold ?? 0;
    } else {
      entry.requiredDVNs = config.requiredCount ?? entry.requiredDVNs ?? 0;
    }
    return entry;
  };

  for (const packet of packets) {
    const chainId = toStringId(packet.chainId);
    const chainLabel = getChainName(chainId);
    const config = determineEffectiveConfig(packet, securityConfigs, defaultsMap);
    if (config.defaultsApplied) {
      packetsUsingDefaults += 1;
    }
    if (config.addressCountMismatch) {
      packetsMissingAddresses += 1;
    }

    if (config.optionalAddressMismatch) {
      packetsOptionalMismatch += 1;
    }

    const groupKey = getGroupKey(config);
    const groupEntry = ensureGroupEntry(totalsByGroup, groupKey, config);
    groupEntry.packetCount += 1;

    const perChain = totalsByChain.get(chainId) ?? {
      chainId,
      chainName: chainLabel,
      groupTotals: new Map(),
      packetCount: 0,
    };
    perChain.packetCount += 1;
    const chainGroupEntry = ensureGroupEntry(perChain.groupTotals, groupKey, config);
    chainGroupEntry.packetCount += 1;
    totalsByChain.set(chainId, perChain);

    const relevantAddresses = config.optionalOnly
      ? config.optionalDVNs
      : config.requiredDVNs.slice(0, config.requiredCount);
    for (const addr of new Set(relevantAddresses)) {
      if (!addr) continue;
      incrementCounter(totalsByDvnAddress, addr);
    }

    if (config.optionalOnly) {
      const names = config.optionalDVNs
        .map(addr => dvnNames.map.get(addr) ?? addr)
        .filter(Boolean)
        .sort();
      const key = `opt:${names.join("|")}|thr:${config.optionalThreshold ?? 0}`;
      const entry = optionalNameGroups.get(key) ?? {
        optionalOnly: true,
        optionalThreshold: config.optionalThreshold ?? 0,
        addresses: config.optionalDVNs.slice(),
        names,
        packetCount: 0,
      };
      entry.packetCount += 1;
      optionalNameGroups.set(key, entry);
    } else {
      const names = config.requiredDVNs
        .slice(0, config.requiredCount)
        .map(addr => dvnNames.map.get(addr) ?? addr)
        .filter(Boolean)
        .sort();
      const key = `req:${names.join("|")}`;
      const entry = requiredNameGroups.get(key) ?? {
        optionalOnly: false,
        requiredCount: config.requiredCount ?? 0,
        addresses: config.requiredDVNs.slice(0, config.requiredCount),
        names,
        packetCount: 0,
      };
      entry.packetCount += 1;
      requiredNameGroups.set(key, entry);
    }
  }

  const byRequired = Array.from(totalsByGroup.values())
    .map(entry =>
      entry.optionalOnly
        ? {
            optionalOnly: true,
            optionalThreshold: entry.optionalThreshold,
            packetCount: entry.packetCount,
          }
        : {
            optionalOnly: false,
            requiredDVNs: entry.requiredDVNs,
            packetCount: entry.packetCount,
          },
    )
    .sort((a, b) => b.packetCount - a.packetCount);

  const byChain = Array.from(totalsByChain.values())
    .map(entry => ({
      chainId: entry.chainId,
      chainName: entry.chainName,
      packetCount: entry.packetCount,
      requiredBreakdown: Array.from(entry.groupTotals.values())
        .map(breakdown =>
          breakdown.optionalOnly
            ? {
                optionalOnly: true,
                optionalThreshold: breakdown.optionalThreshold,
                packetCount: breakdown.packetCount,
              }
            : {
                optionalOnly: false,
                requiredDVNs: breakdown.requiredDVNs,
                packetCount: breakdown.packetCount,
              },
        )
        .sort((a, b) => b.packetCount - a.packetCount),
    }))
    .sort((a, b) => b.packetCount - a.packetCount);

  const byAddress = Array.from(totalsByDvnAddress.entries())
    .map(([address, count]) => ({
      address,
      canonicalName: dvnNames.map.get(address) ?? null,
      packetCount: count,
    }))
    .sort((a, b) => b.packetCount - a.packetCount);

  const requiredNameRanking = Array.from(requiredNameGroups.values())
    .map(entry => ({
      packetCount: entry.packetCount,
      requiredCount: entry.requiredCount,
      requiredAddresses: entry.addresses,
      requiredNames: entry.names,
    }))
    .sort((a, b) => b.packetCount - a.packetCount);

  const optionalNameRanking = Array.from(optionalNameGroups.values())
    .map(entry => ({
      packetCount: entry.packetCount,
      optionalThreshold: entry.optionalThreshold,
      optionalAddresses: entry.addresses,
      optionalNames: entry.names,
    }))
    .sort((a, b) => b.packetCount - a.packetCount);

  const zeroFallbackByChain = Array.from(securityConfigs.zeroFallbackByChain.entries()).map(
    ([chainId, count]) => ({
      chainId,
      chainName: getChainName(chainId),
      configCount: count,
    }),
  );

  const optionalOnlyByChain = Array.from(securityConfigs.optionalOnlyByChain.entries()).map(
    ([chainId, count]) => ({
      chainId,
      chainName: getChainName(chainId),
      configCount: count,
    }),
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    endpoint,
    days,
    sinceTimestamp: sinceSeconds,
    layerzeroPath: dvnNames.resolvedPath,
    dvnNamesLoaded: dvnNames.map.size,
    totalPackets: packets.length,
    packetsUsingDefaults,
    packetsMissingRequiredAddresses: packetsMissingAddresses,
    packetsOptionalAddressMismatch: packetsOptionalMismatch,
    configsUsingDefaultFallback: securityConfigs.zeroFallbackTotal,
    configsUsingDefaultFallbackByChain: zeroFallbackByChain,
    configsUsingOptionalOnly: securityConfigs.optionalOnlyTotal,
    configsUsingOptionalOnlyByChain: optionalOnlyByChain,
    requiredDVNGroups: byRequired,
    chainGroups: byChain,
    requiredDvnAddressRanking: byAddress,
    requiredDvnNameRanking: requiredNameRanking,
    optionalDvnNameRanking: optionalNameRanking,
  };

  await fs.promises.writeFile(
    outputPath,
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  console.log(
    `Summary written to ${outputPath} (total packets: ${packets.length})`,
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
