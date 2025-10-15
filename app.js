const ENDPOINT_STORAGE_KEY = "lz-security-dashboard-endpoint";
const DEFAULT_ENDPOINT = "http://localhost:8080/v1/graphql";

const endpointInput = document.getElementById("endpoint");
const endpointStatus = document.getElementById("endpoint-status");
const pingEndpointBtn = document.getElementById("ping-endpoint");
const resultsContainer = document.getElementById("results");
const resultsMeta = document.getElementById("results-meta");
const copyResultsBtn = document.getElementById("copy-results");
const tableTemplate = document.getElementById("table-template");

let latestRawResult = null;

/** @typedef {{name: string, slug: string, chainId: (number|null), eid: number}} ChainInfo */

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

const INDEXED_CHAIN_IDS = new Set([
  1, 10, 56, 130, 137, 324, 480, 999, 1135, 1868, 8453, 34443,
].map(String));

const chainByChainId = new Map();
const chainByEid = new Map();
const chainByName = new Map();
const chainBySlug = new Map();

for (const info of LAYERZERO_CHAINS_V2) {
  if (info.chainId !== null && info.chainId !== undefined) {
    chainByChainId.set(info.chainId, info);
    chainByChainId.set(String(info.chainId), info);
  }
  if (info.eid !== null && info.eid !== undefined) {
    chainByEid.set(info.eid, info);
    chainByEid.set(String(info.eid), info);
  }
  chainByName.set(info.name.toLowerCase(), info);
  chainBySlug.set(info.slug.toLowerCase(), info);
}

const indexedChainInfos = LAYERZERO_CHAINS_V2.filter(
  info => info.chainId !== null && INDEXED_CHAIN_IDS.has(String(info.chainId)),
);

const missingIndexedChains = [...INDEXED_CHAIN_IDS].filter(
  chainId => !chainByChainId.has(chainId),
);

if (missingIndexedChains.length) {
  console.warn(
    "Missing chain metadata for chainIds:",
    missingIndexedChains.join(", "),
  );
}

const loadStoredEndpoint = () => {
  const stored = localStorage.getItem(ENDPOINT_STORAGE_KEY);
  endpointInput.value = stored || DEFAULT_ENDPOINT;
};

const saveEndpoint = value => {
  if (value) {
    localStorage.setItem(ENDPOINT_STORAGE_KEY, value);
  } else {
    localStorage.removeItem(ENDPOINT_STORAGE_KEY);
  }
};

const getEndpoint = () => endpointInput.value.trim();

const setStatus = (message, type = "") => {
  endpointStatus.textContent = message;
  endpointStatus.className = `status ${type}`;
};

const stringify = value => JSON.stringify(value, null, 2);

const normalizeQuery = value => value.trim().toLowerCase();

const matchChainInfo = (info, query) => {
  if (!query) return true;
  const q = normalizeQuery(query);
  return (
    info.name.toLowerCase().includes(q) ||
    info.slug.toLowerCase().includes(q) ||
    (info.chainId !== null && String(info.chainId).includes(q)) ||
    String(info.eid).includes(q)
  );
};

const toNumericString = value => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const digits = value.match(/\d+/);
    return digits ? digits[0] : undefined;
  }
  return undefined;
};

const normalizeNumericString = numeric => {
  if (!numeric) return undefined;
  try {
    return BigInt(numeric).toString();
  } catch {
    return numeric.replace(/^0+(?=\d)/, "");
  }
};

const findChainByChainId = value => {
  if (value === null || value === undefined) return undefined;
  if (chainByChainId.has(value)) return chainByChainId.get(value);
  const numeric = toNumericString(value);
  const normalized = normalizeNumericString(numeric);
  if (normalized && chainByChainId.has(normalized)) {
    return chainByChainId.get(normalized);
  }
  const parsed = Number(normalized);
  if (!Number.isNaN(parsed) && chainByChainId.has(parsed)) {
    return chainByChainId.get(parsed);
  }
  return undefined;
};

const findChainByEid = value => {
  if (value === null || value === undefined) return undefined;
  if (chainByEid.has(value)) return chainByEid.get(value);
  const numeric = toNumericString(value);
  const normalized = normalizeNumericString(numeric);
  if (normalized && chainByEid.has(normalized)) {
    return chainByEid.get(normalized);
  }
  const parsed = Number(normalized);
  if (!Number.isNaN(parsed) && chainByEid.has(parsed)) {
    return chainByEid.get(parsed);
  }
  return undefined;
};

const findChainByQuery = query => {
  if (!query) return undefined;
  const normalized = normalizeQuery(query);
  if (chainByName.has(normalized)) return chainByName.get(normalized);
  if (chainBySlug.has(normalized)) return chainBySlug.get(normalized);
  const numeric = toNumericString(query);
  if (numeric) {
    return (
      chainByChainId.get(numeric) ||
      chainByEid.get(numeric) ||
      chainByChainId.get(Number(numeric)) ||
      chainByEid.get(Number(numeric))
    );
  }
  return undefined;
};

const resolveChainIdValue = raw => {
  if (!raw) return undefined;
  const info = findChainByQuery(raw);
  if (info?.chainId !== null && info?.chainId !== undefined) {
    return normalizeNumericString(String(info.chainId));
  }
  const numeric = toNumericString(raw);
  return normalizeNumericString(numeric);
};

const resolveEidValue = raw => {
  if (!raw) return undefined;
  const info = findChainByQuery(raw);
  if (info?.eid !== undefined) {
    return normalizeNumericString(String(info.eid));
  }
  const numeric = toNumericString(raw);
  return normalizeNumericString(numeric);
};

const formatChainLabel = value => {
  const info = findChainByChainId(value);
  if (!info) return value;
  return `${info.chainId} (${info.name})`;
};

const formatEidLabel = value => {
  const info = findChainByEid(value);
  if (!info) return value;
  return `${info.eid} (${info.name})`;
};

const isNumericString = value =>
  typeof value === "string" && /^-?\d+$/.test(value);

const isTimestampColumn = column => {
  const name = column.toLowerCase();
  return name.includes("timestamp") || name.endsWith("time");
};

const formatTimestamp = value => {
  const numericValue =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "number"
        ? value
        : Number(value);
  if (!Number.isFinite(numericValue)) return String(value);
  const milliseconds = numericValue < 1e12 ? numericValue * 1000 : numericValue;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.valueOf())) return String(value);
  return date.toLocaleString();
};

const createTimestampNode = value => {
  const span = document.createElement("span");
  span.textContent = String(value);
  span.title = formatTimestamp(value);
  span.className = "timestamp-value";
  return span;
};

const isChainIdColumn = column => {
  const name = column.toLowerCase();
  return (
    name === "chainid" ||
    name.endsWith("chainid") ||
    name.includes("_chainid") ||
    name === "chain_id"
  );
};

const isEidColumn = column => {
  const name = column.toLowerCase();
  return name === "eid" || name.endsWith("eid") || name.includes("_eid");
};

const createChainIdNode = value => {
  const span = document.createElement("span");
  span.textContent = String(value);
  const info = findChainByChainId(value);
  if (info) {
    span.title = `${info.name} (chainId ${info.chainId ?? "n/a"}, eid ${info.eid})`;
  } else {
    span.title = `Unknown chainId ${value}`;
  }
  span.className = "chain-value";
  return span;
};

const createEidNode = value => {
  const span = document.createElement("span");
  span.textContent = String(value);
  const info = findChainByEid(value);
  if (info) {
    span.title = `${info.name} (eid ${info.eid}, chainId ${info.chainId ?? "n/a"})`;
  } else {
    span.title = `Unknown eid ${value}`;
  }
  span.className = "eid-value";
  return span;
};

const parseLimit = raw => {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
};

const buildOptionLabel = info =>
  `${info.name} · chainId ${info.chainId ?? "n/a"} · eid ${info.eid}`;

const renderOptions = (datalist, infos, getValue) => {
  if (!datalist) return;
  datalist.innerHTML = "";
  const fragment = document.createDocumentFragment();
  infos.slice(0, 50).forEach(info => {
    const option = document.createElement("option");
    option.value = getValue(info);
    option.label = buildOptionLabel(info);
    option.textContent = option.label;
    fragment.appendChild(option);
  });
  datalist.appendChild(fragment);
};

const updateIndexedChainOptions = search => {
  const datalist = document.getElementById("indexed-chains");
  const filtered = search
    ? indexedChainInfos.filter(info => matchChainInfo(info, search))
    : indexedChainInfos;
  renderOptions(datalist, filtered, info => String(info.chainId));
};

const updateAllEidOptions = search => {
  const datalist = document.getElementById("all-eids");
  const filtered = search
    ? LAYERZERO_CHAINS_V2.filter(info => matchChainInfo(info, search))
    : LAYERZERO_CHAINS_V2;
  renderOptions(datalist, filtered, info => String(info.eid));
};

const populateDatalists = () => {
  updateIndexedChainOptions("");
  updateAllEidOptions("");

  const chainInputs = document.querySelectorAll('input[list="indexed-chains"]');
  chainInputs.forEach(input => {
    input.addEventListener("input", () => updateIndexedChainOptions(input.value));
    input.addEventListener("focus", () => updateIndexedChainOptions(input.value));
  });

  const eidInputs = document.querySelectorAll('input[list="all-eids"]');
  eidInputs.forEach(input => {
    input.addEventListener("input", () => updateAllEidOptions(input.value));
    input.addEventListener("focus", () => updateAllEidOptions(input.value));
  });
};

const toTable = records => {
  const tableFragment = tableTemplate.content.cloneNode(true);
  const table = tableFragment.querySelector("table");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  const columns = new Set();
  for (const record of records) {
    if (record && typeof record === "object" && !Array.isArray(record)) {
      Object.keys(record).forEach(key => columns.add(key));
    }
  }

  const headerRow = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  for (const record of records) {
    const row = document.createElement("tr");
    for (const col of columns) {
      const cell = document.createElement("td");
      const value = record?.[col];
      if (
        value !== null &&
        value !== undefined &&
        isChainIdColumn(col) &&
        (typeof value === "number" ||
          typeof value === "bigint" ||
          isNumericString(value) ||
          typeof value === "string")
      ) {
        cell.appendChild(createChainIdNode(value));
      } else if (
        value !== null &&
        value !== undefined &&
        isEidColumn(col) &&
        (typeof value === "number" ||
          typeof value === "bigint" ||
          isNumericString(value) ||
          typeof value === "string")
      ) {
        cell.appendChild(createEidNode(value));
      } else if (
        value !== null &&
        value !== undefined &&
        isTimestampColumn(col) &&
        (typeof value === "number" ||
          typeof value === "bigint" ||
          isNumericString(value))
      ) {
        cell.appendChild(createTimestampNode(value));
      } else {
        cell.textContent = formatCellValue(value);
      }
      row.appendChild(cell);
    }
    tbody.appendChild(row);
  }

  return tableFragment;
};

const formatCellValue = value => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(item => typeof item !== "object")) {
      return value.join(", ");
    }
    return value.map(item => stringify(item)).join("\n\n");
  }
  if (typeof value === "object") {
    return stringify(value);
  }
  return String(value);
};

const renderResult = payload => {
  latestRawResult = payload;
  resultsContainer.innerHTML = "";

  if (!payload) {
    resultsMeta.textContent = "";
    return;
  }

  const { description, durationMs, data, errors } = payload;
  const ts = new Date().toLocaleTimeString();
  const pieces = [];
  if (description) pieces.push(description);
  if (durationMs !== undefined)
    pieces.push(`took ${durationMs.toFixed(1)} ms`);
  pieces.push(`@ ${ts}`);
  resultsMeta.innerHTML = `<span class="timestamp">${pieces.join(
    " · ",
  )}</span>`;

  if (errors?.length) {
    const errorBlock = document.createElement("pre");
    errorBlock.textContent = stringify(errors);
    resultsContainer.appendChild(errorBlock);
    return;
  }

  if (!data) {
    resultsContainer.textContent = "No data returned.";
    return;
  }

  const rootKeys = Object.keys(data);
  if (rootKeys.length === 0) {
    resultsContainer.textContent = "Empty result.";
    return;
  }

  for (const key of rootKeys) {
    const value = data[key];
    const section = document.createElement("div");
    section.className = "result-block";

    const heading = document.createElement("h3");
    heading.textContent = key;
    section.appendChild(heading);

    if (Array.isArray(value) && value.every(item => typeof item === "object")) {
      section.appendChild(toTable(value));
    } else if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      section.appendChild(toTable([value]));
    } else {
      const pre = document.createElement("pre");
      pre.textContent = formatCellValue(value);
      section.appendChild(pre);
    }

    resultsContainer.appendChild(section);
  }
};

const executeQuery = async ({ description, query, variables }) => {
  const endpoint = getEndpoint();
  if (!endpoint) {
    setStatus("Missing endpoint", "error");
    return;
  }

  saveEndpoint(endpoint);
  setStatus("");

  const started = performance.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    const elapsed = performance.now() - started;
    const json = await response.json();
    renderResult({
      description,
      durationMs: elapsed,
      data: json.data,
      errors: json.errors,
    });

    if (!response.ok) {
      setStatus(`HTTP ${response.status}`, "error");
    } else if (json.errors?.length) {
      setStatus("GraphQL errors", "error");
    } else {
      setStatus("OK", "ok");
    }
  } catch (error) {
    renderResult({
      description,
      durationMs: performance.now() - started,
      data: null,
      errors: [{ message: error.message || String(error) }],
    });
    setStatus("Request failed", "error");
  }
};

const handleTopOApps = event => {
  event.preventDefault();
  const data = new FormData(event.target);
  const limitRaw = data.get("limit")?.trim();
  const limit = parseLimit(limitRaw);
  const chainIdRaw = data.get("chainId")?.trim() ?? "";
  const chainId = resolveChainIdValue(chainIdRaw);

  if (chainIdRaw && !chainId) {
    setStatus("Unknown chain identifier", "error");
    return;
  }

  let query;
  let variables;

  if (chainId) {
    if (limit !== undefined) {
      query = `
        query TopOAppsWithChain($limit: Int!, $chainId: numeric!) {
          OApp(
            limit: $limit
            order_by: { totalPacketsReceived: desc }
            where: { chainId: { _eq: $chainId } }
          ) {
            id
            chainId
            address
            totalPacketsReceived
            lastPacketBlock
            lastPacketTimestamp
          }
        }
      `;
      variables = { limit, chainId };
    } else {
      query = `
        query TopOAppsWithChain($chainId: numeric!) {
          OApp(
            order_by: { totalPacketsReceived: desc }
            where: { chainId: { _eq: $chainId } }
          ) {
            id
            chainId
            address
            totalPacketsReceived
            lastPacketBlock
            lastPacketTimestamp
          }
        }
      `;
      variables = { chainId };
    }
  } else {
    if (limit !== undefined) {
      query = `
        query TopOApps($limit: Int!) {
          OApp(
            limit: $limit
            order_by: { totalPacketsReceived: desc }
          ) {
            id
            chainId
            address
            totalPacketsReceived
            lastPacketBlock
            lastPacketTimestamp
          }
        }
      `;
      variables = { limit };
    } else {
      query = `
        query TopOApps {
          OApp(order_by: { totalPacketsReceived: desc }) {
            id
            chainId
            address
            totalPacketsReceived
            lastPacketBlock
            lastPacketTimestamp
          }
        }
      `;
      variables = {};
    }
  }

  const descriptionParts = ["Top OApps"];
  if (chainId) descriptionParts.push(formatChainLabel(chainId));
  descriptionParts.push(limit !== undefined ? `limit ${limit}` : "no limit");

  executeQuery({
    description: descriptionParts.join(" · "),
    query,
    variables,
  });
};

const handleSecuritySnapshot = event => {
  event.preventDefault();
  const data = new FormData(event.target);
  const oappId = data.get("oappId")?.trim();
  const eidRaw = data.get("eid")?.trim();

  if (!oappId) {
    setStatus("Provide an OApp ID", "error");
    return;
  }

  const separatorIndex = oappId.indexOf("_");
  if (separatorIndex === -1) {
    setStatus("OApp ID must follow 'chainId_address' format", "error");
    return;
  }

  const derivedChainPart = oappId.slice(0, separatorIndex);
  const chainId = resolveChainIdValue(derivedChainPart);
  if (!chainId) {
    setStatus("Unable to derive chainId from OApp ID", "error");
    return;
  }

  const eid = resolveEidValue(eidRaw);
  if (!eid) {
    setStatus("Provide an Eid", "error");
    return;
  }

  executeQuery({
    description: `Security snapshot ${oappId} (${formatChainLabel(chainId)}) / ${formatEidLabel(eid)}`,
    query: `
      query OAppSecuritySnapshot($oappId: String!, $chainId: numeric!, $eid: numeric!) {
        OAppSecurityConfig(
          where: {
            oappId: { _eq: $oappId }
            chainId: { _eq: $chainId }
            eid: { _eq: $eid }
          }
          order_by: { lastUpdatedTimestamp: desc }
          limit: 5
        ) {
          id
          receiveLibrary
          configConfirmations
          configRequiredDVNCount
          configOptionalDVNCount
          configOptionalDVNThreshold
          configRequiredDVNs
          configOptionalDVNs
          lastUpdatedBlock
          lastUpdatedTimestamp
          lastUpdatedByEventId
        }
      }
    `,
    variables: {
      oappId,
      chainId,
      eid,
    },
  });
};

const handleMultiDvn = event => {
  event.preventDefault();
  const data = new FormData(event.target);
  const minRequired = Number(data.get("minRequired") || 2);
  const limitRaw = data.get("limit")?.trim();
  const limit = parseLimit(limitRaw);

  const hasLimit = limit !== undefined;
  const query = hasLimit
    ? `
      query ConfigsWithRequired($minRequired: Int!, $limit: Int!) {
        OAppSecurityConfig(
          where: { configRequiredDVNCount: { _gte: $minRequired } }
          order_by: { configRequiredDVNCount: desc, lastUpdatedTimestamp: desc }
          limit: $limit
        ) {
          oappId
          chainId
          eid
          receiveLibrary
          configConfirmations
          configRequiredDVNCount
          configOptionalDVNCount
          configOptionalDVNThreshold
          lastUpdatedTimestamp
        }
      }
    `
    : `
      query ConfigsWithRequired($minRequired: Int!) {
        OAppSecurityConfig(
          where: { configRequiredDVNCount: { _gte: $minRequired } }
          order_by: { configRequiredDVNCount: desc, lastUpdatedTimestamp: desc }
        ) {
          oappId
          chainId
          eid
          receiveLibrary
          configConfirmations
          configRequiredDVNCount
          configOptionalDVNCount
          configOptionalDVNThreshold
          lastUpdatedTimestamp
        }
      }
    `;

  const variables = hasLimit
    ? { minRequired, limit }
    : { minRequired };

  const descriptionParts = [
    `Configs with ≥ ${minRequired} required DVNs`,
    hasLimit ? `limit ${limit}` : "no limit",
  ];

  executeQuery({
    description: descriptionParts.join(" · "),
    query,
    variables,
  });
};

const handlePacketSamples = event => {
  event.preventDefault();
  const data = new FormData(event.target);
  const chainIdRaw = data.get("chainId")?.trim();
  const chainId = resolveChainIdValue(chainIdRaw);
  if (!chainId) {
    setStatus("Unknown chain identifier", "error");
    return;
  }
  const receiver = data.get("receiver")?.trim();
  const limitRaw = data.get("limit")?.trim();
  const limit = parseLimit(limitRaw);

  const hasLimit = limit !== undefined;
  const query = hasLimit
    ? `
      query PacketSamplesWithLimit($chainId: numeric!, $receiver: String!, $limit: Int!) {
        PacketDelivered(
          where: { chainId: { _eq: $chainId }, receiver: { _eq: $receiver } }
          order_by: { blockTimestamp: desc }
          limit: $limit
        ) {
          id
          blockNumber
          blockTimestamp
          srcEid
          sender
          nonce
          securityConfigId
          receiveLibrary
          configConfirmations
          configRequiredDVNCount
          configOptionalDVNCount
          configOptionalDVNThreshold
        }
      }
    `
    : `
      query PacketSamples($chainId: numeric!, $receiver: String!) {
        PacketDelivered(
          where: { chainId: { _eq: $chainId }, receiver: { _eq: $receiver } }
          order_by: { blockTimestamp: desc }
        ) {
          id
          blockNumber
          blockTimestamp
          srcEid
          sender
          nonce
          securityConfigId
          receiveLibrary
          configConfirmations
          configRequiredDVNCount
          configOptionalDVNCount
          configOptionalDVNThreshold
        }
      }
    `;

  const variables = hasLimit
    ? { chainId, receiver, limit }
    : { chainId, receiver };

  const descriptionParts = [
    `Packet samples for ${receiver}`,
    formatChainLabel(chainId),
    hasLimit ? `limit ${limit}` : "no limit",
  ];

  executeQuery({
    description: descriptionParts.join(" · "),
    query,
    variables,
  });
};

const handleDefaults = event => {
  event.preventDefault();
  const data = new FormData(event.target);
  const chainIdRaw = data.get("chainId")?.trim();
  const chainId = resolveChainIdValue(chainIdRaw);
  if (!chainId) {
    setStatus("Unknown chain identifier", "error");
    return;
  }
  const limitRaw = data.get("limit")?.trim();
  const limit = parseLimit(limitRaw);

  const hasLimit = limit !== undefined;
  const query = hasLimit
    ? `
      query DefaultBaselines($chainId: numeric!, $limit: Int!) {
        DefaultReceiveLibrary(
          where: { chainId: { _eq: $chainId } }
          order_by: { eid: asc }
          limit: $limit
        ) {
          eid
          library
          blockNumber
          blockTimestamp
        }
        DefaultUlnConfig(
          where: { chainId: { _eq: $chainId } }
          order_by: { eid: asc }
          limit: $limit
        ) {
          eid
          confirmations
          requiredDVNCount
          optionalDVNCount
          optionalDVNThreshold
          requiredDVNs
          optionalDVNs
          blockNumber
          blockTimestamp
        }
      }
    `
    : `
      query DefaultBaselines($chainId: numeric!) {
        DefaultReceiveLibrary(
          where: { chainId: { _eq: $chainId } }
          order_by: { eid: asc }
        ) {
          eid
          library
          blockNumber
          blockTimestamp
        }
        DefaultUlnConfig(
          where: { chainId: { _eq: $chainId } }
          order_by: { eid: asc }
        ) {
          eid
          confirmations
          requiredDVNCount
          optionalDVNCount
          optionalDVNThreshold
          requiredDVNs
          optionalDVNs
          blockNumber
          blockTimestamp
        }
      }
    `;

  const variables = hasLimit ? { chainId, limit } : { chainId };

  const descriptionParts = [
    `Default baselines for ${formatChainLabel(chainId)}`,
    hasLimit ? `limit ${limit}` : "no limit",
  ];

  executeQuery({
    description: descriptionParts.join(" · "),
    query,
    variables,
  });
};

const handleCustomQuery = event => {
  event.preventDefault();
  const data = new FormData(event.target);
  const query = data.get("query")?.trim();
  const variablesRaw = data.get("variables")?.trim();

  if (!query) {
    setStatus("Provide a query", "error");
    return;
  }

  let variables = undefined;
  if (variablesRaw) {
    try {
      variables = JSON.parse(variablesRaw);
    } catch (error) {
      setStatus("Invalid JSON variables", "error");
      return;
    }
  }

  executeQuery({
    description: "Custom query",
    query,
    variables,
  });
};

const pingEndpoint = async () => {
  const endpoint = getEndpoint();
  if (!endpoint) {
    setStatus("Missing endpoint", "error");
    return;
  }
  setStatus("Pinging...");
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "query __Ping { __typename }" }),
    });
    const json = await response.json();
    if (response.ok && json.data?.__typename) {
      setStatus("Reachable", "ok");
    } else {
      setStatus("No response", "error");
    }
  } catch (error) {
    console.error(error);
    setStatus("Failed", "error");
  }
};

const copyResults = async () => {
  if (!latestRawResult) return;
  try {
    await navigator.clipboard.writeText(stringify(latestRawResult));
    setStatus("Copied", "ok");
    setTimeout(() => setStatus(""), 1200);
  } catch (error) {
    setStatus("Copy failed", "error");
  }
};

const registerEventHandlers = () => {
  document
    .getElementById("top-oapps-form")
    .addEventListener("submit", handleTopOApps);
  document
    .getElementById("security-snapshot-form")
    .addEventListener("submit", handleSecuritySnapshot);
  document
    .getElementById("multi-dvn-form")
    .addEventListener("submit", handleMultiDvn);
  document
    .getElementById("packet-samples-form")
    .addEventListener("submit", handlePacketSamples);
  document
    .getElementById("defaults-form")
    .addEventListener("submit", handleDefaults);
  document
    .getElementById("custom-query-form")
    .addEventListener("submit", handleCustomQuery);
  pingEndpointBtn.addEventListener("click", pingEndpoint);
  copyResultsBtn.addEventListener("click", copyResults);
};

loadStoredEndpoint();
populateDatalists();
registerEventHandlers();
resultsMeta.textContent = "Ready. Run any query to populate results.";
