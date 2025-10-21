const GRAPHQL_ENDPOINT = "http://localhost:8080/v1/graphql";

const chainLookup = {
  byNativeId: new Map(),
  byEid: new Map(),
};
const copyFeedbackTimers = new WeakMap();
const oappChainOptionsState = {
  list: [],
  map: new Map(),
};
const chainMetadataPromise = loadChainMetadata();
chainMetadataPromise.catch(() => {});
chainMetadataPromise.then(() => {
  if (resultsState.lastRender) {
    const { rows, payload, meta } = resultsState.lastRender;
    updateResultsPane(rows, payload, meta);
  }
});
const oappChainOptionsPromise = loadOAppChainOptions();
oappChainOptionsPromise.catch(() => {});
oappChainOptionsPromise.then(() => {
  if (resultsState.lastRender) {
    const { rows, payload, meta } = resultsState.lastRender;
    updateResultsPane(rows, payload, meta);
  }
});

const queryRegistry = {
  "top-oapps": {
    label: "Top OApps",
    description: "Ordered by total packets received",
    query: `
      query TopOApps($limit: Int, $minPackets: numeric!) {
        OApp(
          order_by: { totalPacketsReceived: desc }
          limit: $limit
          where: { totalPacketsReceived: { _gte: $minPackets } }
        ) {
          id
          chainId
          address
          totalPacketsReceived
          lastPacketBlock
          lastPacketTimestamp
        }
      }
    `,
    buildVariables: (card) => {
      const limitInput = card.querySelector('input[name="limit"]');
      const minPacketsInput = card.querySelector('input[name="minPackets"]');

      const rawLimit = limitInput?.value?.trim() ?? "";
      const parsedLimit = parseOptionalPositiveInt(rawLimit);
      const minPackets = clampInteger(
        minPacketsInput?.value,
        0,
        Number.MAX_SAFE_INTEGER,
        0,
      );

      const variables = {
        minPackets: String(minPackets),
      };
      if (Number.isFinite(parsedLimit)) {
        variables.limit = parsedLimit;
      }

      return {
        variables,
        meta: {
          limitLabel: Number.isFinite(parsedLimit)
            ? `limit=${parsedLimit}`
            : "limit=∞",
        },
      };
    },
    extractRows: (data) => data?.OApp ?? [],
  },
  "oapp-security-config": {
    label: "OApp Security Config",
    description: "Resolve the current security posture for a single OApp",
    query: `
      query CurrentSecurityConfig($oappId: String!) {
        OApp(where: { id: { _eq: $oappId } }) {
          id
          chainId
          address
          totalPacketsReceived
          lastPacketBlock
          lastPacketTimestamp
        }
        OAppSecurityConfig(
          where: { oappId: { _eq: $oappId } }
          order_by: { eid: asc }
        ) {
          id
          eid
          chainId
          oapp
          effectiveReceiveLibrary
          effectiveConfirmations
          effectiveRequiredDVNCount
          effectiveOptionalDVNCount
          effectiveOptionalDVNThreshold
          effectiveRequiredDVNs
          effectiveOptionalDVNs
          isConfigTracked
          usesDefaultLibrary
          usesDefaultConfig
          usesRequiredDVNSentinel
          fallbackFields
          defaultLibraryVersionId
          defaultConfigVersionId
          libraryOverrideVersionId
          configOverrideVersionId
          lastComputedBlock
          lastComputedTimestamp
          lastComputedByEventId
        }
      }
    `,
    initialize: ({ card }) => {
      const chainInput = card.querySelector('[data-chain-input]');
      const chainLabel = card.querySelector('[data-chain-label]');
      const datalist = card.querySelector('[data-chain-datalist]');

      if (datalist) {
        oappChainOptionsPromise.then((options) => {
          populateChainDatalist(datalist, options);
        });
      }

      if (chainInput && chainLabel) {
        const updateLabel = () => {
          const chainId = chainInput.value.trim();
          const display = getChainDisplayLabel(chainId);
          chainLabel.textContent = display
            ? `Chain: ${display}`
            : "Chain not selected.";
        };
        chainInput.addEventListener("input", updateLabel);
        oappChainOptionsPromise.then(() => updateLabel());
      }

      const idInput = card.querySelector('input[name="oappId"]');
      if (idInput) {
        idInput.addEventListener("blur", () => {
          if (!idInput.value) return;
          try {
            const normalized = normalizeOAppId(idInput.value);
            if (normalized !== idInput.value) {
              idInput.value = normalized;
            }
          } catch (error) {
            // ignore invalid input on blur
          }
        });
      }
    },
    buildVariables: (card) => {
      const idInput = card.querySelector('input[name="oappId"]');
      const chainInput = card.querySelector('input[name="chainId"]');
      const addressInput = card.querySelector('input[name="oappAddress"]');

      const rawId = idInput?.value?.trim() ?? "";
      let oappId = "";
      let chainId = "";
      let address = "";

      if (rawId) {
        const normalizedId = normalizeOAppId(rawId);
        const parts = normalizedId.split("_");
        chainId = parts[0];
        address = parts[1];
        oappId = normalizedId;
        if (chainInput) {
          chainInput.value = chainId;
          chainInput.dispatchEvent(new Event("input"));
        }
        if (addressInput) {
          addressInput.value = address;
        }
        if (idInput) {
          idInput.value = oappId;
        }
      } else {
        chainId = chainInput?.value?.trim() ?? "";
        address = addressInput?.value?.trim() ?? "";
        if (!chainId || !address) {
          throw new Error("Provide an OApp ID or destination chain plus address.");
        }
        address = normalizeAddress(address);
        oappId = `${chainId}_${address}`;
        if (idInput) {
          idInput.value = oappId;
        }
        if (addressInput) {
          addressInput.value = address;
        }
        if (chainInput) {
          chainInput.dispatchEvent(new Event("input"));
        }
      }

      const chainDisplay = getChainDisplayLabel(chainId) || chainId;
      const summary = chainId ? `${chainDisplay} • ${address}` : `${address}`;

      return {
        variables: { oappId },
        meta: {
          limitLabel: `oappId=${oappId}`,
          summary,
          chainId,
          chainLabel: chainDisplay,
          oappAddress: address,
          resultLabel: chainId
            ? `OApp Security Config – ${chainDisplay}`
            : "OApp Security Config",
        },
      };
    },
    processResponse: (payload, meta) => {
      const oapp = payload?.data?.OApp?.[0] ?? null;
      const rows = payload?.data?.OAppSecurityConfig ?? [];
      const enrichedMeta = { ...meta };

      if (oapp) {
        const chainId = String(oapp.chainId ?? "");
        const chainDisplay = getChainDisplayLabel(chainId) || enrichedMeta.chainLabel || chainId;
        enrichedMeta.oappInfo = oapp;
        enrichedMeta.chainLabel = chainDisplay;
        enrichedMeta.summary = enrichedMeta.summary || `${chainDisplay} • ${oapp.address}`;
        enrichedMeta.resultLabel = `OApp Security Config – ${chainDisplay}`;
      }

      return { rows, meta: enrichedMeta };
    },
  },
};

const resultsTitle = document.getElementById("results-title");
const resultsMeta = document.getElementById("results-meta");
const resultsBody = document.getElementById("results-body");
const copyJsonButton = document.getElementById("copy-json");
const refreshAllButton = document.getElementById("refresh-all");

const resultsState = {
  requestSeq: 0,
  latestRequest: 0,
  lastRows: [],
  lastPayload: null,
  lastQueryLabel: "Awaiting query",
  lastRender: null,
};

document.querySelectorAll("[data-query-key]").forEach((card) => {
  const key = card.getAttribute("data-query-key");
  const config = queryRegistry[key];
  if (!config) {
    return;
  }

  const runButton = card.querySelector(".run-query");
  const form = card.querySelector("form");
  const statusEl = card.querySelector("[data-status]");
  const queryCode = card.querySelector("[data-query-code]");

  if (queryCode) {
    queryCode.textContent = config.query.trim();
  }

  const run = () => runQuery(key, card, config, statusEl);

  runButton?.addEventListener("click", run);
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });

  if (!resultsState.bootstrapTriggered) {
    resultsState.bootstrapTriggered = true;
    queueMicrotask(run);
  }

  if (typeof config.initialize === "function") {
    try {
      config.initialize({ card, run });
    } catch (error) {
      console.warn(`initialize hook failed for ${key}`, error);
    }
  }
});

refreshAllButton?.addEventListener("click", async () => {
  for (const card of document.querySelectorAll("[data-query-key]")) {
    const key = card.getAttribute("data-query-key");
    const config = queryRegistry[key];
    if (!config) {
      continue;
    }
    const statusEl = card.querySelector("[data-status]");
    await runQuery(key, card, config, statusEl);
  }
});

copyJsonButton?.addEventListener("click", async () => {
  if (!resultsState.lastRows?.length) {
    return;
  }

  const payload = JSON.stringify(resultsState.lastRows, null, 2);
  try {
    await navigator.clipboard.writeText(payload);
    flipButtonTemporarily(copyJsonButton, "Copied!", 1800);
  } catch (error) {
    console.error("Clipboard copy failed", error);
    flipButtonTemporarily(copyJsonButton, "Copy failed", 1800);
  }
});

resultsBody?.addEventListener("click", handleCopyableClick);

async function runQuery(key, card, config, statusEl) {
  const requestId = ++resultsState.requestSeq;
  resultsState.latestRequest = requestId;

  setStatus(statusEl, "Loading…", "loading");

  const buildResult = config.buildVariables?.(card) ?? {};
  const variables =
    Object.prototype.hasOwnProperty.call(buildResult, "variables") && buildResult.variables
      ? buildResult.variables
      : buildResult.variables === null
        ? {}
        : buildResult;
  const extraMeta =
    Object.prototype.hasOwnProperty.call(buildResult, "meta") && buildResult.meta
      ? buildResult.meta
      : {};

  if (!variables || Object.keys(variables).length === 0) {
    throw new Error("Missing query input.");
  }

  const requestBody = JSON.stringify({
    query: config.query,
    variables,
  });

  const startedAt = performance.now();

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText || ""}`.trim(),
      );
    }

    if (payload.errors?.length) {
      const message = payload.errors
        .map((error) => error.message || "Unknown error")
        .join("; ");
      throw new Error(message);
    }

    const elapsed = performance.now() - startedAt;
    const baseMeta = {
      elapsed,
      variables,
      requestId,
      label: extraMeta.resultLabel || config.label,
      limitLabel: extraMeta.limitLabel,
      summary: extraMeta.summary,
      chainLabel: extraMeta.chainLabel,
      oappAddress: extraMeta.oappAddress,
    };

    let rows = [];
    let finalMeta = { ...baseMeta };

    if (typeof config.processResponse === "function") {
      const result = config.processResponse(payload, baseMeta) || {};
      rows = Array.isArray(result.rows) ? result.rows : [];
      if (result.meta && typeof result.meta === "object") {
        finalMeta = { ...baseMeta, ...result.meta };
      }
    } else if (typeof config.extractRows === "function") {
      rows = config.extractRows(payload.data) ?? [];
    }

    setStatus(
      statusEl,
      `Fetched ${rows.length} row${rows.length === 1 ? "" : "s"} in ${elapsed.toFixed(
        0,
      )} ms`,
      "success",
    );

    if (requestId === resultsState.latestRequest) {
      updateResultsPane(rows, payload, finalMeta);
    }

    return rows;
  } catch (error) {
    console.error("GraphQL query failed", error);
    setStatus(statusEl, error.message, "error");

    if (requestId === resultsState.latestRequest) {
      showErrorInResults(
        {
          label: extraMeta.resultLabel || config.label,
          variables,
          limitLabel: extraMeta.limitLabel,
          summary: extraMeta.summary,
        },
        error,
      );
    }
    return [];
  }
}

function updateResultsPane(rows, payload, meta) {
  const metaSnapshot = { ...meta };
  resultsState.lastRows = rows;
  resultsState.lastPayload = payload;
  resultsState.lastQueryLabel = metaSnapshot.label;
  resultsState.lastRender = { rows, payload, meta: metaSnapshot };

  copyJsonButton.disabled = rows.length === 0;

  const variableHints = buildVariableSummary(metaSnapshot.variables);
  const metaParts = [
    `${rows.length} row${rows.length === 1 ? "" : "s"}`,
    metaSnapshot.summary,
    `${Math.round(metaSnapshot.elapsed)} ms`,
    metaSnapshot.limitLabel,
    variableHints,
    new Date().toLocaleTimeString(),
  ].filter(Boolean);

  resultsTitle.textContent = metaSnapshot.label;
  resultsMeta.textContent = metaParts.join(" • ");

  const summaryPanel = renderOAppSummary(metaSnapshot);

  if (!rows.length) {
    resultsBody.classList.add("empty");
    resultsBody.innerHTML = "";
    if (summaryPanel) {
      resultsBody.appendChild(summaryPanel);
    }
    const placeholder = document.createElement("div");
    placeholder.className = "placeholder";
    placeholder.innerHTML = `
      <p class="placeholder-title">No rows returned</p>
      <p>Adjust filters or try again.</p>
    `;
    resultsBody.appendChild(placeholder);
    return;
  }

  resultsBody.classList.remove("empty");
  resultsBody.innerHTML = "";

  if (summaryPanel) {
    resultsBody.appendChild(summaryPanel);
  }

  const table = buildTable(rows);
  const payloadDetails = buildPayloadDetails(payload);

  resultsBody.appendChild(table);
  resultsBody.appendChild(payloadDetails);
}

function showErrorInResults(meta, error) {
  copyJsonButton.disabled = true;
  resultsTitle.textContent = `${meta.label} (failed)`;
  const metaParts = [
    meta.summary,
    meta.limitLabel,
    buildVariableSummary(meta.variables),
    new Date().toLocaleTimeString(),
  ].filter(Boolean);
  resultsMeta.textContent = metaParts.join(" • ") || "Request failed.";

  resultsState.lastRows = [];
  resultsState.lastPayload = null;
  resultsState.lastQueryLabel = meta.label;
  resultsState.lastRender = null;

  resultsBody.classList.remove("empty");
  resultsBody.innerHTML = "";

  const template = document.getElementById("error-template");
  const node = template.content.cloneNode(true);
  node.querySelector("[data-error-message]").textContent = error.message;
  resultsBody.appendChild(node);
}

function buildTable(rows) {
  const columnSet = new Set();
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => columnSet.add(key));
  });

  const columns = Array.from(columnSet);
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  columns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column;
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((column) => {
      const td = document.createElement("td");
      td.appendChild(renderCell(column, row[column]));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

function renderCell(column, value) {
  const { nodes, copyValue, isCopyable } = interpretValue(column, value);
  if (!isCopyable) {
    const fragment = document.createDocumentFragment();
    nodes.forEach((node) => fragment.append(node));
    return fragment;
  }

  const container = document.createElement("div");
  container.className = "copyable";

  const content = copyValue ?? nodes.map((node) => node.textContent ?? "").join(" ").trim();
  if (content) {
    container.dataset.copyValue = content;
  }

  nodes.forEach((node) => container.append(node));
  return container;
}

function interpretValue(column, value) {
  const nodes = [];

  if (value === null || value === undefined) {
    nodes.push(document.createTextNode("—"));
    return {
      nodes,
      copyValue: "null",
      isCopyable: true,
    };
  }

  if (Array.isArray(value) || (typeof value === "object" && value)) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(value, null, 2);
    nodes.push(pre);
    return {
      nodes,
      copyValue: JSON.stringify(value, null, 2),
      isCopyable: true,
    };
  }

  const chainPreference = chainPreferenceFromColumn(column);
  if (chainPreference) {
    const chainInfo = resolveChainLabel(value, chainPreference);
    if (chainInfo) {
      nodes.push(document.createTextNode(chainInfo.primary));
      const secondary = document.createElement("span");
      secondary.className = "cell-secondary";
      secondary.textContent = chainInfo.secondary;
      nodes.push(secondary);
      return {
        nodes,
        copyValue: chainInfo.copyValue,
        isCopyable: true,
      };
    }
  }

  if (looksLikeTimestampColumn(column)) {
    const tsInfo = formatTimestampValue(value);
    if (tsInfo) {
      nodes.push(document.createTextNode(tsInfo.primary));
      const secondary = document.createElement("span");
      secondary.className = "cell-secondary";
      secondary.textContent = tsInfo.secondary;
      nodes.push(secondary);
      return {
        nodes,
        copyValue: tsInfo.copyValue,
        isCopyable: true,
      };
    }
  }

  if (typeof value === "string" && looksLikeHash(column, value)) {
    const code = document.createElement("code");
    code.textContent = value;
    nodes.push(code);
    return {
      nodes,
      copyValue: value,
      isCopyable: true,
    };
  }

  const strValue = stringifyScalar(value);
  nodes.push(document.createTextNode(strValue));
  return {
    nodes,
    copyValue: strValue,
    isCopyable: true,
  };
}

function buildPayloadDetails(payload) {
  const details = document.createElement("details");
  details.className = "json-dump";

  const summary = document.createElement("summary");
  summary.textContent = "View response payload";
  details.appendChild(summary);

  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(payload, null, 2);
  details.appendChild(pre);

  return details;
}

function setStatus(node, text, state) {
  if (!node) {
    return;
  }

  node.textContent = text;
  if (state) {
    node.setAttribute("data-state", state);
  } else {
    node.removeAttribute("data-state");
  }
}

function clampInteger(rawValue, min, max, fallback) {
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isFinite(parsed)) {
    const upper = Number.isFinite(max) ? max : Number.POSITIVE_INFINITY;
    return Math.min(Math.max(parsed, min), upper);
  }
  return fallback;
}

function looksLikeHash(column, value) {
  const lower = column.toLowerCase();
  if (lower.includes("hash") || lower.includes("tx")) {
    return true;
  }
  return /^0x[a-fA-F0-9]{16,}$/.test(value);
}

function looksLikeTimestampColumn(column) {
  const lower = column.toLowerCase();
  return lower.includes("timestamp") || lower.endsWith("time");
}

function looksLikeChainColumn(column) {
  const lower = column.toLowerCase();
  if (lower === "chainid") {
    return true;
  }
  return lower.includes("chainid") || lower.endsWith("_chain_id") || lower.endsWith("_chainid");
}

function looksLikeEidColumn(column) {
  const lower = column.toLowerCase();
  if (lower === "eid") {
    return true;
  }
  return lower.endsWith("eid") || lower.endsWith("_eid") || lower.includes("eid_");
}

function chainPreferenceFromColumn(column) {
  if (looksLikeChainColumn(column)) {
    return "native";
  }
  if (looksLikeEidColumn(column)) {
    return "eid";
  }
  return null;
}

function stringifyScalar(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return value ?? "";
}

function formatTimestampValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const millis = numeric < 1e12 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const iso = date.toISOString().replace("T", " ").replace("Z", " UTC");
  return {
    primary: iso,
    secondary: `unix ${value}`,
    copyValue: String(value),
  };
}

function resolveChainLabel(value, preference = "auto") {
  const key = String(value);
  const nativeEntry = () => {
    if (!chainLookup.byNativeId.has(key)) {
      return null;
    }
    const label = chainLookup.byNativeId.get(key);
    return {
      primary: label,
      secondary: `chainId ${key}`,
      copyValue: key,
    };
  };
  const eidEntry = () => {
    if (!chainLookup.byEid.has(key)) {
      return null;
    }
    const label = chainLookup.byEid.get(key);
    return {
      primary: label,
      secondary: `eid ${key}`,
      copyValue: key,
    };
  };

  if (preference === "native") {
    return nativeEntry() ?? eidEntry();
  }
  if (preference === "eid") {
    return eidEntry() ?? nativeEntry();
  }
  return nativeEntry() ?? eidEntry();
}

async function loadChainMetadata() {
  const candidates = [
    "./layerzero-chains.json",
    "./layerzero.json",
    "../layerzero.json",
    "/layerzero.json",
  ];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: "no-store" });
      if (!response.ok) {
        continue;
      }
      const data = await response.json();
      hydrateChainLookup(data);
      console.info(`[chains] loaded metadata from ${candidate}`);
      return candidate;
    } catch (error) {
      console.warn(`[chains] failed to load ${candidate}`, error);
    }
  }
  console.warn("[chains] metadata not found; chain names will not be resolved");
  return null;
}

function hydrateChainLookup(data) {
  if (!data || typeof data !== "object") {
    return;
  }

  const nativeTable = data.native;
  const eidTable = data.eid;
  if (nativeTable || eidTable) {
    if (nativeTable && typeof nativeTable === "object") {
      Object.entries(nativeTable).forEach(([id, label]) => {
        if (label) {
          chainLookup.byNativeId.set(String(id), String(label));
        }
      });
    }
    if (eidTable && typeof eidTable === "object") {
      Object.entries(eidTable).forEach(([id, label]) => {
        if (label) {
          chainLookup.byEid.set(String(id), String(label));
        }
      });
    }
    return;
  }

  Object.entries(data).forEach(([key, entry]) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const baseLabel = deriveChainLabel(entry, key);
    const chainDetails = entry.chainDetails ?? {};
    const nativeId = chainDetails.nativeChainId;
    if (nativeId !== undefined && nativeId !== null) {
      chainLookup.byNativeId.set(String(nativeId), baseLabel);
    }

    if (Array.isArray(entry.deployments)) {
      entry.deployments.forEach((deployment) => {
        if (!deployment || typeof deployment !== "object") {
          return;
        }
        const eid = deployment.eid;
        if (!eid) {
          return;
        }

        const stage = deployment.stage && deployment.stage !== "mainnet"
          ? ` (${deployment.stage})`
          : "";
        chainLookup.byEid.set(String(eid), `${baseLabel}${stage}`);
      });
    }
  });
}

function deriveChainLabel(entry, fallbackKey) {
  const details = entry.chainDetails ?? {};
  return (
    details.shortName ||
    details.name ||
    entry.chainKey ||
    fallbackKey
  );
}

function flipButtonTemporarily(button, label, timeoutMs) {
  const original = button.textContent;
  button.textContent = label;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.disabled = resultsState.lastRows?.length ? false : button === copyJsonButton;
  }, timeoutMs);
}

async function loadOAppChainOptions() {
  try {
    const response = await fetch("./oapp-chains.json", { cache: "no-store" });
    if (!response.ok) {
      return [];
    }
    const list = await response.json();
    if (Array.isArray(list)) {
      oappChainOptionsState.list = list.map((item) => ({
        id: String(item.id ?? item.chainId ?? ""),
        label: String(item.label ?? item.name ?? item.id ?? ""),
      }));
      oappChainOptionsState.map = new Map(
        oappChainOptionsState.list.map((item) => [item.id, item.label]),
      );
    }
  } catch (error) {
    console.warn("[chains] failed to load oapp chain options", error);
  }
  return oappChainOptionsState.list;
}

function populateChainDatalist(datalist, options) {
  if (!datalist) {
    return;
  }
  datalist.innerHTML = "";
  options.forEach((option) => {
    if (!option || !option.id) {
      return;
    }
    const node = document.createElement("option");
    const display = composeChainDisplay(option.label, option.id);
    node.value = option.id;
    node.label = display;
    node.textContent = display;
    datalist.appendChild(node);
  });
}

function getChainDisplayLabel(chainId) {
  if (!chainId && chainId !== 0) {
    return "";
  }
  const key = String(chainId);
  if (oappChainOptionsState.map.has(key)) {
    const label = oappChainOptionsState.map.get(key);
    return composeChainDisplay(label, key);
  }
  const chainInfo = resolveChainLabel(key, "native");
  if (chainInfo) {
    return composeChainDisplay(chainInfo.primary, key);
  }
  return key;
}

function composeChainDisplay(label, chainId) {
  if (label) {
    return `${label} (${chainId})`;
  }
  return String(chainId ?? "");
}

function normalizeAddress(value) {
  if (!value) {
    throw new Error("Address is required.");
  }
  let trimmed = String(value).trim();
  if (!trimmed) {
    throw new Error("Address is required.");
  }
  if (!trimmed.startsWith("0x")) {
    trimmed = `0x${trimmed}`;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw new Error("Invalid address format.");
  }
  return trimmed.toLowerCase();
}

function normalizeOAppId(value) {
  if (!value) {
    throw new Error("OApp ID is required.");
  }
  const trimmed = String(value).trim();
  const parts = trimmed.split("_");
  if (parts.length !== 2) {
    throw new Error("OApp ID must follow 'chainId_address'.");
  }
  const chainId = parts[0]?.trim();
  const address = normalizeAddress(parts[1]);
  if (!chainId) {
    throw new Error("OApp ID must include a chainId.");
  }
  return `${chainId}_${address}`;
}

function renderOAppSummary(meta) {
  const info = meta?.oappInfo;
  if (!info) {
    return null;
  }

  const panel = document.createElement("div");
  panel.className = "summary-panel";

  const heading = document.createElement("h3");
  heading.textContent = "OApp Overview";
  panel.appendChild(heading);

  const list = document.createElement("dl");
  panel.appendChild(list);

  appendSummaryRow(list, "OApp ID", info.id ?? "");
  appendSummaryRow(list, "Chain", meta.chainLabel || String(info.chainId ?? ""));
  appendSummaryRow(list, "Address", info.address ?? "");
  if (info.totalPacketsReceived !== undefined && info.totalPacketsReceived !== null) {
    appendSummaryRow(list, "Total Packets", String(info.totalPacketsReceived));
  }
  if (info.lastPacketBlock !== undefined && info.lastPacketBlock !== null) {
    appendSummaryRow(list, "Last Packet Block", String(info.lastPacketBlock));
  }
  if (info.lastPacketTimestamp !== undefined && info.lastPacketTimestamp !== null) {
    const ts = formatTimestampValue(info.lastPacketTimestamp);
    if (ts) {
      appendSummaryRow(list, "Last Packet Time", ts.primary);
    }
  }

  return panel;
}

function appendSummaryRow(list, label, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }
  const dt = document.createElement("dt");
  dt.textContent = label;
  list.appendChild(dt);

  const dd = document.createElement("dd");
  dd.textContent = String(value);
  list.appendChild(dd);
}

function buildVariableSummary(variables = {}) {
  const parts = [];
  if (!variables) {
    return "";
  }
  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (key === "minPackets" && (value === "0" || value === 0)) {
      continue;
    }
    if (key === "oappId") {
      continue;
    }
    parts.push(`${key}=${value}`);
  }
  return parts.join(", ");
}

function parseOptionalPositiveInt(rawValue) {
  if (!rawValue) {
    return Number.NaN;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return Number.NaN;
}

async function handleCopyableClick(event) {
  const target = event.target.closest(".copyable");
  if (!target || !resultsBody.contains(target)) {
    return;
  }

  const selection = window.getSelection();
  if (selection && selection.toString().trim()) {
    return;
  }

  const value = target.dataset.copyValue ?? target.textContent;
  if (!value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    flashCopyFeedback(target, true);
    showCopyToast("Copied", "success");
  } catch (error) {
    console.error("Copy failed", error);
    flashCopyFeedback(target, false);
    showCopyToast("Copy failed", "error");
  }
}

function flashCopyFeedback(element, didSucceed) {
  element.classList.remove("copied", "copy-failed");
  element.classList.add(didSucceed ? "copied" : "copy-failed");

  const existing = copyFeedbackTimers.get(element);
  if (existing) {
    clearTimeout(existing);
  }
  const timeout = setTimeout(() => {
    element.classList.remove("copied", "copy-failed");
    copyFeedbackTimers.delete(element);
  }, didSucceed ? 1200 : 1600);
  copyFeedbackTimers.set(element, timeout);
}

function showCopyToast(message, tone = "neutral") {
  const container = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `copy-toast copy-toast-${tone}`;
  toast.textContent = message;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  const timeout = setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => {
      toast.remove();
    }, 220);
  }, 1600);

  copyToastState.timers.push(timeout);
  if (copyToastState.timers.length > 6) {
    const removedTimeout = copyToastState.timers.shift();
    if (removedTimeout) {
      clearTimeout(removedTimeout);
    }
  }
}

function ensureToastContainer() {
  if (copyToastState.container && document.body.contains(copyToastState.container)) {
    return copyToastState.container;
  }
  const container = document.createElement("div");
  container.className = "copy-toast-container";
  document.body.appendChild(container);
  copyToastState.container = container;
  return container;
}
const copyToastState = {
  container: null,
  timers: [],
};
