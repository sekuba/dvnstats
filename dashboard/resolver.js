import { normalizeKey } from "./core.js";
import { bigIntSafe } from "./utils/NumberUtils.js";
import { getTrackedReceiveLibrary } from "./trackedLibraries.js";
import { normalizeSecurityConfig } from "./security/SecurityConfigNormalizer.js";

export function resolveOAppSecurityConfigs({
  oappId,
  localEid,
  oappAddress,
  securityConfigs = [],
  defaultReceiveLibraries = [],
  defaultUlnConfigs = [],
  oappPeers = [],
  oappReceiveLibraries = [],
  oappUlnConfigs = [],
  routeStats = [],
}) {
  const trackedReceiveLibrary = getTrackedReceiveLibrary(localEid);
  const securityByEid = buildMap(securityConfigs, (row) => normalizeKey(row.eid));
  const peerByEid = buildMap(oappPeers, (row) => normalizeKey(row.eid));
  const defaultLibraryByEid = buildMap(defaultReceiveLibraries, (row) => normalizeKey(row.eid));
  const defaultConfigByEid = buildMap(defaultUlnConfigs, (row) => normalizeKey(row.eid));
  const libraryOverrideByEid = buildMap(oappReceiveLibraries, (row) => normalizeKey(row.eid));
  const configOverrideByEid = buildMap(oappUlnConfigs, (row) => normalizeKey(row.eid));
  const routeStatsEids = new Set(routeStats.map((row) => normalizeKey(row.srcEid || row.eid)));

  const candidateEids = new Set([
    ...securityByEid.keys(),
    ...peerByEid.keys(),
    ...defaultLibraryByEid.keys(),
    ...defaultConfigByEid.keys(),
    ...libraryOverrideByEid.keys(),
    ...configOverrideByEid.keys(),
    ...routeStatsEids.values(),
  ]);

  const resolvedRows = [];
  let syntheticCount = 0;
  let implicitBlocks = 0;
  let explicitBlocks = 0;

  for (const eid of candidateEids) {
    if (!eid) {
      continue;
    }

    const normalized = normalizeSecurityConfig({
      eid,
      config: securityByEid.get(eid),
      peerRecord: peerByEid.get(eid),
      oappId,
      oappAddress,
      localEid,
      trackedReceiveLibrary,
      defaultLibrary: defaultLibraryByEid.get(eid),
      defaultConfig: defaultConfigByEid.get(eid),
      overrideLibrary: libraryOverrideByEid.get(eid),
      overrideConfig: configOverrideByEid.get(eid),
    });

    if (!normalized) {
      continue;
    }

    if (normalized.synthetic) {
      syntheticCount += 1;
    }

    if (normalized.peerStateHint === "implicit-blocked") {
      implicitBlocks += 1;
    } else if (normalized.peerStateHint === "explicit-blocked") {
      explicitBlocks += 1;
    }

    resolvedRows.push(normalized);
  }

  resolvedRows.sort((a, b) => {
    const aEid = bigIntSafe(a.eid);
    const bEid = bigIntSafe(b.eid);
    if (aEid !== null && bEid !== null) {
      return aEid < bEid ? -1 : aEid > bEid ? 1 : 0;
    }
    return String(a.eid).localeCompare(String(b.eid));
  });

  return {
    rows: resolvedRows,
    summary: {
      totalRoutes: resolvedRows.length,
      syntheticCount,
      implicitBlocks,
      explicitBlocks,
    },
  };
}

function buildMap(list, keySelector) {
  const map = new Map();
  if (!Array.isArray(list)) {
    return map;
  }
  for (const item of list) {
    const key = keySelector(item);
    if (!key) continue;
    map.set(key, item);
  }
  return map;
}

