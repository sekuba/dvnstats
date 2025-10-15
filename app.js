const ENDPOINT_STORAGE_KEY = "lz-security-dashboard-endpoint";
const DEFAULT_ENDPOINT = "http://localhost:9991/graphql";

const endpointInput = document.getElementById("endpoint");
const endpointStatus = document.getElementById("endpoint-status");
const pingEndpointBtn = document.getElementById("ping-endpoint");
const resultsContainer = document.getElementById("results");
const resultsMeta = document.getElementById("results-meta");
const copyResultsBtn = document.getElementById("copy-results");
const tableTemplate = document.getElementById("table-template");

let latestRawResult = null;

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

const parseLimit = raw => {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
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
  const chainIdRaw = data.get("chainId")?.trim();
  const chainId = chainIdRaw ? chainIdRaw : undefined;

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
  if (chainId) descriptionParts.push(`chain ${chainId}`);
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
  const eid = data.get("eid")?.trim();

  if (!oappId) {
    setStatus("Provide an OApp ID", "error");
    return;
  }

  const separatorIndex = oappId.indexOf("_");
  if (separatorIndex === -1) {
    setStatus("OApp ID must follow 'chainId_address' format", "error");
    return;
  }

  const chainId = oappId.slice(0, separatorIndex);
  if (!chainId) {
    setStatus("Unable to derive chainId from OApp ID", "error");
    return;
  }

  if (!eid) {
    setStatus("Provide an Eid", "error");
    return;
  }

  executeQuery({
    description: `Security snapshot ${oappId} / ${eid}`,
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
  const chainId = data.get("chainId")?.trim();
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
  const chainId = data.get("chainId")?.trim();
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
    `Default baselines for chain ${chainId}`,
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
registerEventHandlers();
resultsMeta.textContent = "Ready. Run any query to populate results.";
