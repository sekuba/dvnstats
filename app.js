const ROOT_DATASET = document.documentElement.dataset;
const GRAPHQL_ENDPOINT =
  ROOT_DATASET.graphqlEndpoint || "http://localhost:8080/v1/graphql";
const GRAPHQL_HEADERS = {
  "Content-Type": "application/json",
  ...(ROOT_DATASET.hasuraAdminSecret
    ? { "x-hasura-admin-secret": ROOT_DATASET.hasuraAdminSecret }
    : {}),
};

const chainLookup = {
  byNativeId: new Map(),
  byEid: new Map(),
};
const copyFeedbackTimers = new WeakMap();
const oappChainOptionsState = {
  list: [],
  map: new Map(),
};
const dvnLayerLookup = new Map();
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
const oappAliasState = {
  map: new Map(),
  storageKey: "dashboard:oappAliases",
};
const oappAliasesPromise = loadOAppAliases();
oappAliasesPromise.catch(() => {});
oappAliasesPromise.then(() => {
  reprocessLastResults();
});

function getOAppAlias(oappId) {
  if (!oappId) {
    return null;
  }
  return oappAliasState.map.get(String(oappId)) || null;
}

function setOAppAlias(oappId, alias) {
  if (!oappId) {
    return;
  }
  const normalizedId = String(oappId);
  const normalizedAlias = alias && alias.trim() ? alias.trim() : null;

  if (normalizedAlias) {
    oappAliasState.map.set(normalizedId, normalizedAlias);
  } else {
    oappAliasState.map.delete(normalizedId);
  }

  persistOAppAliases();
  reprocessLastResults();
}

function formatOAppIdCell(oappId) {
  if (!oappId) {
    return createFormattedCell(["—"], "");
  }
  const alias = getOAppAlias(oappId);
  const lines = alias ? [alias, `ID ${oappId}`] : [oappId];
  return createFormattedCell(lines, oappId, { oappId });
}

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
    extractRows: (data) =>
      (data?.OApp ?? []).map((row) => ({
        ...row,
        id: formatOAppIdCell(row.id),
      })),
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
        DvnMetadata {
          address
          chainId
          name
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
      const configs = payload?.data?.OAppSecurityConfig ?? [];
      const dvnMetadata = payload?.data?.DvnMetadata ?? [];
      const enrichedMeta = { ...meta };

      if (oapp) {
        const chainId = String(oapp.chainId ?? "");
        const chainDisplay = getChainDisplayLabel(chainId) || enrichedMeta.chainLabel || chainId;
        enrichedMeta.oappInfo = oapp;
        enrichedMeta.chainLabel = chainDisplay;
        enrichedMeta.chainId = chainId;
        enrichedMeta.summary = enrichedMeta.summary || `${chainDisplay} • ${oapp.address}`;
        enrichedMeta.resultLabel = `OApp Security Config – ${chainDisplay}`;
      }

      if (Array.isArray(dvnMetadata) && dvnMetadata.length) {
        enrichedMeta.dvnLookup = buildDvnLookup(dvnMetadata);
      } else {
        enrichedMeta.dvnLookup = new Map();
      }

      const formattedRows = formatSecurityConfigRows(configs, enrichedMeta);

      return { rows: formattedRows, meta: enrichedMeta };
    },
  },
  "popular-oapps-window": {
    label: "Popular OApps (Window)",
    description: "Rank OApps by packets in a configurable time window",
    query: `
      query PopularOAppsWindow($fromTimestamp: numeric!, $fetchLimit: Int) {
        PacketDelivered(
          where: { blockTimestamp: { _gte: $fromTimestamp } }
          order_by: { blockTimestamp: desc }
          limit: $fetchLimit
        ) {
          id
          oappId
          chainId
          receiver
          blockTimestamp
          blockNumber
          srcEid
        }
      }
    `,
    initialize: ({ card }) => {
      const unitSelect = card.querySelector('select[name="windowUnit"]');
      if (unitSelect && !unitSelect.value) {
        unitSelect.value = "days";
      }
    },
    buildVariables: (card) => {
      const windowValueInput = card.querySelector('input[name="windowValue"]');
      const windowUnitSelect = card.querySelector('select[name="windowUnit"]');
      const resultLimitInput = card.querySelector('input[name="resultLimit"]');
      const fetchLimitInput = card.querySelector('input[name="fetchLimit"]');

      const rawWindowValue = clampInteger(windowValueInput?.value, 1, 365, 7);
      const windowUnit = windowUnitSelect?.value ?? "days";
      const unitSeconds = {
        minutes: 60,
        hours: 3600,
        days: 86400,
      };
      const secondsPerUnit = unitSeconds[windowUnit] ?? unitSeconds.days;
      const windowSeconds = rawWindowValue * secondsPerUnit;
      const nowSeconds = Math.floor(Date.now() / 1000);
      const fromTimestamp = Math.max(nowSeconds - windowSeconds, 0);

      const resultLimit = clampInteger(resultLimitInput?.value, 1, 200, 20);
      const fetchLimitRaw = fetchLimitInput?.value?.trim();
      const fetchLimitParsed = parseOptionalPositiveInt(fetchLimitRaw);
      const fetchLimit =
        Number.isFinite(fetchLimitParsed) && fetchLimitParsed > 0
          ? Math.min(fetchLimitParsed, 200000)
          : null;

      const windowLabel = `${rawWindowValue}${windowUnit.charAt(0)}`;

      return {
        variables: {
          fromTimestamp: String(fromTimestamp),
          ...(fetchLimit ? { fetchLimit } : {}),
        },
        meta: {
          limitLabel: `window=${windowLabel}, top=${resultLimit}, sample=${fetchLimit ?? "∞"}`,
          summary: `Top ${resultLimit} • last ${windowLabel}`,
          windowSeconds,
          windowLabel,
          fromTimestamp,
          nowTimestamp: nowSeconds,
          resultLimit,
          fetchLimit,
        },
      };
    },
    processResponse: (payload, meta) => {
      const packets = payload?.data?.PacketDelivered ?? [];
      const result = aggregatePopularOapps(packets, {
        fromTimestamp: meta.fromTimestamp,
        nowTimestamp: meta.nowTimestamp,
        windowLabel: meta.windowLabel,
        windowSeconds: meta.windowSeconds,
        resultLimit: meta.resultLimit,
        fetchLimit: meta.fetchLimit,
      });

      return {
        rows: result.rows,
        meta: {
          ...meta,
          summary: result.meta.summary,
          popularOappsSummary: result.meta.popularOappsSummary,
        },
      };
    },
  },
  "web-of-security": {
    label: "Web of Security",
    description: "Load and visualize the security graph for an OApp",
    query: null,
    initialize: ({ card, run }) => {
      const fileInput = card.querySelector('input[name="webFile"]');
      if (fileInput) {
        fileInput.addEventListener('change', () => {
          if (fileInput.files && fileInput.files[0]) {
            run();
          }
        });
      }
    },
    buildVariables: (card) => {
      const oappIdInput = card.querySelector('input[name="oappId"]');
      const fileInput = card.querySelector('input[name="webFile"]');

      const oappId = oappIdInput?.value?.trim() ?? "";

      if (!fileInput?.files?.[0]) {
        throw new Error("Please select a web data JSON file.");
      }

      return {
        variables: {
          oappId,
          file: fileInput.files[0]
        },
        meta: {
          limitLabel: oappId ? `seed=${oappId}` : "web-of-security",
          summary: oappId || "Web of Security",
        },
      };
    },
    processResponse: async (payload, meta) => {
      const webData = payload?.webData;
      if (!webData) {
        throw new Error("Invalid web data format");
      }

      return {
        rows: [],
        meta: {
          ...meta,
          webData,
          resultLabel: "Web of Security",
          renderMode: "graph",
        },
      };
    },
  },
};

const resultsTitle = document.getElementById("results-title");
const resultsMeta = document.getElementById("results-meta");
const resultsBody = document.getElementById("results-body");
const copyJsonButton = document.getElementById("copy-json");
const refreshAllButton = document.getElementById("refresh-all");
const aliasEditor = document.getElementById("alias-editor");
const aliasEditorForm = document.getElementById("alias-editor-form");
const aliasEditorIdInput = aliasEditorForm?.querySelector('input[name="oappId"]');
const aliasEditorAliasInput = aliasEditorForm?.querySelector('input[name="alias"]');

const resultsState = {
  requestSeq: 0,
  latestRequest: 0,
  lastRows: [],
  lastPayload: null,
  lastQueryLabel: "Awaiting query",
  lastRender: null,
  lastQueryKey: null,
  lastMetaBase: null,
  lastVariables: null,
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
  const source = resultsState.lastPayload?.data ?? resultsState.lastRows;
  if (!source || (Array.isArray(source) && !source.length)) {
    return;
  }

  const payload = JSON.stringify(source, null, 2);
  try {
    await navigator.clipboard.writeText(payload);
    flipButtonTemporarily(copyJsonButton, "Copied!", 1800);
  } catch (error) {
    console.error("Clipboard copy failed", error);
    flipButtonTemporarily(copyJsonButton, "Copy failed", 1800);
  }
});

resultsBody?.addEventListener("click", handleCopyableClick);
resultsBody?.addEventListener("dblclick", handleAliasDblClick);

aliasEditorForm?.addEventListener("submit", handleAliasSubmit);
aliasEditorForm?.addEventListener("click", handleAliasFormClick);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !aliasEditor?.classList.contains("hidden")) {
    event.preventDefault();
    closeAliasEditor();
  }
});
aliasEditor?.addEventListener("click", (event) => {
  if (event.target === aliasEditor) {
    closeAliasEditor();
  }
});

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

  const startedAt = performance.now();

  try {
    let payload;

    if (variables.file) {
      const file = variables.file;
      const text = await file.text();
      const webData = JSON.parse(text);
      payload = { webData };
    } else {
      const requestBody = JSON.stringify({
        query: config.query,
        variables,
      });

      const response = await fetch(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: GRAPHQL_HEADERS,
        body: requestBody,
      });

      payload = await response.json().catch(() => ({}));

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
    }

    const elapsed = performance.now() - startedAt;
    const baseMeta = {
      elapsed,
      variables,
      requestId,
      label: extraMeta.resultLabel || config.label,
      originalLabel: config.label,
      queryKey: key,
      ...extraMeta,
    };

  let rows = [];
  let finalMeta = { ...baseMeta };

  if (typeof config.processResponse === "function") {
    const result = await config.processResponse(payload, { ...baseMeta }) || {};
    rows = Array.isArray(result.rows) ? result.rows : [];
    if (result.meta && typeof result.meta === "object") {
      finalMeta = { ...baseMeta, ...result.meta };
    }
  } else if (typeof config.extractRows === "function") {
    rows = config.extractRows(payload.data) ?? [];
  }

  resultsState.lastMetaBase = baseMeta;
  resultsState.lastQueryKey = key;
  resultsState.lastVariables = variables;

  setStatus(
    statusEl,
    finalMeta.renderMode === "graph"
      ? `Loaded web with ${finalMeta.webData?.nodes?.length || 0} nodes in ${elapsed.toFixed(0)} ms`
      : `Fetched ${rows.length} row${rows.length === 1 ? "" : "s"} in ${elapsed.toFixed(0)} ms`,
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

  copyJsonButton.disabled = metaSnapshot.renderMode === "graph" ? false : rows.length === 0;

  const variableHints = buildVariableSummary(metaSnapshot.variables);
  const metaParts = [
    metaSnapshot.renderMode === "graph"
      ? `${metaSnapshot.webData?.nodes?.length || 0} nodes, ${metaSnapshot.webData?.edges?.length || 0} edges`
      : `${rows.length} row${rows.length === 1 ? "" : "s"}`,
    metaSnapshot.summary,
    `${Math.round(metaSnapshot.elapsed)} ms`,
    metaSnapshot.limitLabel,
    variableHints,
    new Date().toLocaleTimeString(),
  ].filter(Boolean);

  resultsTitle.textContent = metaSnapshot.label;
  resultsMeta.textContent = metaParts.join(" • ");

  if (metaSnapshot.renderMode === "graph") {
    resultsBody.classList.remove("empty");
    resultsBody.innerHTML = "";
    const graphContainer = renderWebOfSecurity(metaSnapshot.webData);
    resultsBody.appendChild(graphContainer);
    return;
  }

  const summaryPanel = renderSummaryPanel(metaSnapshot);

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
  const { nodes, copyValue, isCopyable, meta } = interpretValue(column, value);
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

  if (meta && typeof meta === "object") {
    if (meta.oappId) {
      container.dataset.oappId = meta.oappId;
    }
  }

  nodes.forEach((node) => container.append(node));
  return container;
}

function interpretValue(column, value) {
  const nodes = [];

  if (value && typeof value === "object" && value.__formatted) {
    const lines = Array.isArray(value.lines) ? value.lines : [value.lines ?? ""];
    lines.forEach((line) => {
      const span = document.createElement("span");
      const content = line === null || line === undefined || line === "" ? " " : String(line);
      span.textContent = content;
      nodes.push(span);
    });
    const cleanedLines = lines
      .map((line) => (line === null || line === undefined ? "" : String(line)))
      .filter((line) => line.trim().length > 0);
    const copyValue = value.copyValue ?? cleanedLines.join(" | ");
    return {
      nodes,
      copyValue,
      isCopyable: true,
      meta: value.meta || null,
    };
  }

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
    const nativeIdKey =
      nativeId !== undefined && nativeId !== null ? String(nativeId) : null;
    if (nativeIdKey && entry.dvns && typeof entry.dvns === "object") {
      Object.entries(entry.dvns).forEach(([address, info]) => {
        if (!address) {
          return;
        }
        const lowerAddress = String(address).toLowerCase();
        const name =
          info?.canonicalName ||
          info?.name ||
          info?.id ||
          address;
        dvnLayerLookup.set(`${nativeIdKey}:${lowerAddress}`, name);
      });
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

function renderSummaryPanel(meta) {
  if (!meta) {
    return null;
  }
  if (meta.oappInfo) {
    return renderOAppSummary(meta);
  }
  if (meta.popularOappsSummary) {
    return renderPopularOappsSummary(meta.popularOappsSummary);
  }
  return null;
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
  const alias = getOAppAlias(info.id);
  if (alias) {
    appendSummaryRow(list, "OApp Alias", alias);
  }
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

function renderPopularOappsSummary(summary) {
  if (!summary) {
    return null;
  }

  const panel = document.createElement("div");
  panel.className = "summary-panel";

  const heading = document.createElement("h3");
  heading.textContent = "Window Overview";
  panel.appendChild(heading);

  const list = document.createElement("dl");
  panel.appendChild(list);

  appendSummaryRow(list, "Window", summary.windowLabel || "");

  if (summary.fromTimestamp) {
    const fromTs = formatTimestampValue(summary.fromTimestamp);
    if (fromTs) {
      appendSummaryRow(list, "From", fromTs.primary);
    }
  }

  if (summary.toTimestamp) {
    const toTs = formatTimestampValue(summary.toTimestamp);
    if (toTs) {
      appendSummaryRow(list, "To", toTs.primary);
    }
  }

  appendSummaryRow(list, "Packets Scanned", summary.sampledPackets);
  appendSummaryRow(list, "Unique OApps", summary.totalOapps);
  appendSummaryRow(list, "Results Returned", summary.returnedCount);
  appendSummaryRow(list, "Sample Limit", summary.fetchLimit);

  return panel;
}

function aggregatePopularOapps(packets, options = {}) {
  const resultLimit = clampInteger(options.resultLimit, 1, 200, 20);
  const fromTimestamp = options.fromTimestamp ?? 0;
  const toTimestamp = options.nowTimestamp ?? Math.floor(Date.now() / 1000);
  const windowLabel = options.windowLabel || "";
  const fetchLimit = options.fetchLimit ?? null;

  const groups = new Map();
  let sampledPackets = 0;

  packets.forEach((packet) => {
    if (!packet) {
      return;
    }
    sampledPackets += 1;

    const inferredKey = packet.oappId || buildOAppId(packet.chainId, packet.receiver);
    if (!inferredKey) {
      return;
    }

    const [chainPart, addressPart] = inferredKey.split("_");
    const normalizedAddress = (packet.receiver || addressPart || "").toLowerCase();
    const chainId = chainPart || String(packet.chainId ?? "");

    const group = groups.get(inferredKey) ?? {
      oappId: inferredKey,
      chainId,
      address: normalizedAddress,
      count: 0,
      eids: new Set(),
      lastTimestamp: 0,
      firstTimestamp: Number.MAX_SAFE_INTEGER,
      lastBlock: null,
    };

    group.count += 1;

    if (packet.srcEid !== undefined && packet.srcEid !== null) {
      group.eids.add(String(packet.srcEid));
    }

    const timestamp = Number(packet.blockTimestamp ?? 0);
    if (Number.isFinite(timestamp)) {
      if (timestamp > group.lastTimestamp) {
        group.lastTimestamp = timestamp;
      }
      if (timestamp < group.firstTimestamp) {
        group.firstTimestamp = timestamp;
      }
    }

    const blockNumber = packet.blockNumber !== undefined ? Number(packet.blockNumber) : null;
    if (Number.isFinite(blockNumber)) {
      if (group.lastBlock === null || blockNumber > group.lastBlock) {
        group.lastBlock = blockNumber;
      }
    }

    groups.set(inferredKey, group);
  });

  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return (b.lastTimestamp || 0) - (a.lastTimestamp || 0);
  });

  const limited = sortedGroups.slice(0, resultLimit);
  const rows = limited.map((group, index) => {
    const chainDisplay = getChainDisplayLabel(group.chainId) || group.chainId || "—";
    const address = group.address || (group.oappId.split("_")[1] ?? "—");
    const eids = Array.from(group.eids).sort();

    const chainCell = createFormattedCell(
      [chainDisplay, `ChainId ${group.chainId || "—"}`],
      group.chainId,
    );

    const oappCell = formatOAppIdCell(group.oappId);
    const addressCell = createFormattedCell([address], address);

    const eidLines = [`Count ${eids.length}`];
    const eidCopyValue = eids.join(", ");
    const eidCell = createFormattedCell(eidLines, eidCopyValue || `Count ${eids.length}`);

    const lastLines = [];
    if (group.lastTimestamp) {
      const ts = formatTimestampValue(group.lastTimestamp);
      if (ts) {
        lastLines.push(ts.primary);
        if (ts.secondary) {
          lastLines.push(ts.secondary);
        }
      }
    }
    if (group.lastBlock !== null && group.lastBlock !== undefined) {
      lastLines.push(`Block ${group.lastBlock}`);
    }
    const lastCell = createFormattedCell(
      lastLines.length ? lastLines : ["—"],
      String(group.lastTimestamp ?? ""),
    );

    return {
      Rank: String(index + 1),
      "OApp ID": oappCell,
      Chain: chainCell,
      Address: addressCell,
      Packets: String(group.count),
      "Unique EIDs": eidCell,
      "Last Packet": lastCell,
    };
  });

  const summary = {
    windowLabel,
    fromTimestamp,
    toTimestamp,
    totalOapps: groups.size,
    sampledPackets,
    returnedCount: rows.length,
    fetchLimit: fetchLimit ?? "∞",
  };

  const summaryLabel = `Top ${rows.length} • last ${windowLabel || "window"}`;

  return {
    rows,
    meta: {
      summary: summaryLabel,
      popularOappsSummary: summary,
    },
  };
}

function buildOAppId(chainId, address) {
  if (chainId === undefined || chainId === null) {
    return null;
  }
  if (!address) {
    return null;
  }
  const trimmedAddress = String(address).toLowerCase();
  return `${chainId}_${trimmedAddress}`;
}

function formatSecurityConfigRows(rows, meta) {
  return rows.map((row) => formatSecurityConfigRow(row, meta));
}

async function loadOAppAliases() {
  const map = oappAliasState.map;
  map.clear();

  try {
    const response = await fetch("./oapp-aliases.json", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      if (data && typeof data === "object") {
        Object.entries(data).forEach(([key, value]) => {
          if (value) {
            map.set(String(key), String(value));
          }
        });
      }
    }
  } catch (error) {
    console.warn("[aliases] failed to load oapp-aliases.json", error);
  }

  try {
    const stored = localStorage.getItem(oappAliasState.storageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object") {
        Object.entries(parsed).forEach(([key, value]) => {
          if (value) {
            map.set(String(key), String(value));
          } else {
            map.delete(String(key));
          }
        });
      }
    }
  } catch (error) {
    console.warn("[aliases] failed to restore aliases from localStorage", error);
  }

  return map;
}

function persistOAppAliases() {
  try {
    const obj = Object.fromEntries(oappAliasState.map.entries());
    localStorage.setItem(oappAliasState.storageKey, JSON.stringify(obj));
  } catch (error) {
    console.warn("[aliases] failed to persist aliases", error);
  }
}

function exportOAppAliases() {
  const obj = Object.fromEntries(oappAliasState.map.entries());
  const content = JSON.stringify(obj, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "oapp-aliases.json";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function reprocessLastResults() {
  if (!resultsState.lastPayload || !resultsState.lastMetaBase || !resultsState.lastQueryKey) {
    return;
  }
  const key = resultsState.lastQueryKey;
  const config = queryRegistry[key];
  if (!config) {
    return;
  }

  const baseMeta = { ...resultsState.lastMetaBase };
  let rows = [];
  let finalMeta = { ...baseMeta };

  if (typeof config.processResponse === "function") {
    const result = config.processResponse(resultsState.lastPayload, { ...baseMeta }) || {};
    rows = Array.isArray(result.rows) ? result.rows : [];
    if (result.meta && typeof result.meta === "object") {
      finalMeta = { ...baseMeta, ...result.meta };
    }
  } else if (typeof config.extractRows === "function") {
    rows = config.extractRows(resultsState.lastPayload.data) ?? [];
  }

  resultsState.lastMetaBase = baseMeta;
  updateResultsPane(rows, resultsState.lastPayload, finalMeta);
}

function formatSecurityConfigRow(row, meta) {
  const formatted = {};
  formatted.EID = String(row.eid ?? "—");
  formatted.Library = formatLibraryDescriptor(row);
  formatted["Required DVNs"] = formatRequiredDvns(row, meta);
  formatted["Optional DVNs"] = formatOptionalDvns(row, meta);
  formatted.Confirmations = formatConfirmations(row);
  formatted.Fallbacks = formatFallbackFields(row.fallbackFields, row.usesDefaultConfig);
  formatted["Last Update"] = formatLastComputed(row);

  return formatted;
}

function formatLibraryDescriptor(row) {
  const address = row.effectiveReceiveLibrary || "—";
  const statusBits = [];
  statusBits.push(row.isConfigTracked ? "tracked" : "untracked");
  if (row.usesDefaultLibrary) {
    statusBits.push("default");
  }
  if (!row.usesDefaultLibrary && row.libraryOverrideVersionId) {
    statusBits.push("override");
  }

  const lines = [address];
  if (statusBits.length) {
    lines.push(statusBits.join(" • "));
  }

  return createFormattedCell(lines, address);
}

function formatRequiredDvns(row, meta) {
  if (row.usesRequiredDVNSentinel) {
    return createFormattedCell(["optional-only (sentinel)"]);
  }

  const addresses = Array.isArray(row.effectiveRequiredDVNs)
    ? row.effectiveRequiredDVNs.filter(Boolean)
    : [];
  const count = row.effectiveRequiredDVNCount ?? addresses.length ?? 0;
  const lines = [`Count ${count}`];
  if (addresses.length) {
    lines.push(...resolveDvnLabels(addresses, meta, row.chainId ?? meta.chainId));
  }

  return createFormattedCell(lines, addresses.join(", ") || String(count));
}

function formatOptionalDvns(row, meta) {
  const addresses = Array.isArray(row.effectiveOptionalDVNs)
    ? row.effectiveOptionalDVNs.filter(Boolean)
    : [];
  const count = row.effectiveOptionalDVNCount ?? addresses.length ?? 0;
  const threshold = row.effectiveOptionalDVNThreshold ?? "—";
  const lines = [`Count ${count}`, `Threshold ${threshold}`];
  if (addresses.length) {
    lines.push(...resolveDvnLabels(addresses, meta, row.chainId ?? meta.chainId));
  }

  return createFormattedCell(lines, addresses.join(", ") || `${count}/${threshold}`);
}

function formatConfirmations(row) {
  const confirmations = row.effectiveConfirmations ?? "—";
  const lines = [String(confirmations)];
  const status = [];
  if (row.usesDefaultConfig) {
    status.push("default config");
  }
  if (status.length) {
    lines.push(status.join(" • "));
  }

  return createFormattedCell(lines, String(confirmations));
}

function formatFallbackFields(fields, usesDefaultConfig) {
  const names = Array.isArray(fields) ? fields : [];
  if (!names.length) {
    if (usesDefaultConfig) {
      return createFormattedCell(["default"], "default");
    }
    return createFormattedCell(["—"], "");
  }

  const map = {
    receiveLibrary: "library",
    confirmations: "confirmations",
    requiredDVNCount: "required count",
    requiredDVNs: "required dvns",
    optionalDVNCount: "optional count",
    optionalDVNs: "optional dvns",
    optionalDVNThreshold: "optional threshold",
  };

  const lines = names.map((name) => map[name] || name);
  return createFormattedCell(lines, names.join(", "));
}

function formatLastComputed(row) {
  const lines = [];
  if (row.lastComputedBlock !== undefined && row.lastComputedBlock !== null) {
    lines.push(`Block ${row.lastComputedBlock}`);
  }
  if (row.lastComputedTimestamp !== undefined && row.lastComputedTimestamp !== null) {
    const ts = formatTimestampValue(row.lastComputedTimestamp);
    if (ts) {
      lines.push(ts.primary);
    }
  }
  if (row.lastComputedByEventId) {
    lines.push(row.lastComputedByEventId);
  }

  const copyValue = lines.join(" | ");
  return createFormattedCell(lines.length ? lines : ["—"], copyValue);
}

function createFormattedCell(lines, copyValue, meta = {}) {
  const normalizedLines = Array.isArray(lines) ? lines : [lines];
  return {
    __formatted: true,
    lines: normalizedLines.map((line) => (line === null || line === undefined ? "" : String(line))),
    copyValue,
    meta,
  };
}

function buildDvnLookup(entries) {
  const map = new Map();
  if (!Array.isArray(entries)) {
    return map;
  }
  entries.forEach((entry) => {
    if (!entry || !entry.address) {
      return;
    }
    const addressKey = String(entry.address).toLowerCase();
    const chainKey = entry.chainId !== undefined && entry.chainId !== null
      ? String(entry.chainId)
      : null;
    const label = entry.name || entry.address;
    if (!addressKey) {
      return;
    }
    if (chainKey) {
      map.set(`${chainKey}_${addressKey}`, label);
    }
    if (!map.has(addressKey)) {
      map.set(addressKey, label);
    }
  });
  return map;
}

function resolveDvnLabels(addresses, meta, chainIdOverride) {
  const lookup = meta?.dvnLookup;
  if (!Array.isArray(addresses) || !addresses.length) {
    return [];
  }
  const chainId = chainIdOverride !== undefined && chainIdOverride !== null
    ? String(chainIdOverride)
    : meta?.chainId !== undefined && meta?.chainId !== null
      ? String(meta.chainId)
      : null;
  return addresses.map((address) => {
    if (!address) {
      return "";
    }
    const key = String(address).toLowerCase();
    if (chainId) {
      const lookupKey = `${chainId}_${key}`;
      if (lookup && lookup.has(lookupKey)) {
        return lookup.get(lookupKey);
      }
      const layerKey = `${chainId}:${key}`;
      if (dvnLayerLookup.has(layerKey)) {
        return dvnLayerLookup.get(layerKey);
      }
    }
    if (lookup instanceof Map && lookup.has(key)) {
      return lookup.get(key);
    }
    return address;
  });
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
    if (key === "fromTimestamp" || key === "nowTimestamp") {
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

function handleAliasDblClick(event) {
  const target = event.target.closest(".copyable[data-oapp-id]");
  if (!target || !resultsBody.contains(target)) {
    return;
  }
  event.preventDefault();
  const oappId = target.dataset.oappId;
  if (!oappId) {
    return;
  }
  const selection = window.getSelection?.();
  if (selection && selection.removeAllRanges) {
    selection.removeAllRanges();
  }
  openAliasEditor(oappId);
}

function openAliasEditor(oappId) {
  if (!aliasEditor || !aliasEditorForm || !aliasEditorIdInput || !aliasEditorAliasInput) {
    return;
  }
  aliasEditorIdInput.value = oappId;
  aliasEditorAliasInput.value = getOAppAlias(oappId) || "";
  aliasEditor.classList.remove("hidden");
  setTimeout(() => {
    aliasEditorAliasInput.focus();
    aliasEditorAliasInput.select();
  }, 0);
}

function closeAliasEditor() {
  if (!aliasEditor || !aliasEditorForm || !aliasEditorAliasInput) {
    return;
  }
  aliasEditor.classList.add("hidden");
  aliasEditorForm.reset();
}

function handleAliasSubmit(event) {
  event.preventDefault();
  if (!aliasEditorIdInput || !aliasEditorAliasInput) {
    return;
  }
  const oappId = aliasEditorIdInput.value;
  const alias = aliasEditorAliasInput.value;
  setOAppAlias(oappId, alias);
  closeAliasEditor();
}

function handleAliasFormClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  const action = target.dataset.action;
  if (action === "cancel") {
    event.preventDefault();
    closeAliasEditor();
  } else if (action === "clear") {
    event.preventDefault();
    if (aliasEditorIdInput) {
      setOAppAlias(aliasEditorIdInput.value, "");
    }
    closeAliasEditor();
  } else if (action === "export") {
    event.preventDefault();
    exportOAppAliases();
  }
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

function renderWebOfSecurity(webData) {
  if (!webData || !webData.nodes || !webData.edges) {
    const error = document.createElement("div");
    error.className = "placeholder";
    error.innerHTML = `
      <p class="placeholder-title">Invalid web data</p>
      <p>The loaded file does not contain valid web data.</p>
    `;
    return error;
  }

  const container = document.createElement("div");
  container.className = "web-of-security-container";

  const summary = document.createElement("div");
  summary.className = "summary-panel";
  summary.innerHTML = `
    <h3>Web of Security Overview</h3>
    <dl>
      <dt>Seed OApp</dt>
      <dd>${webData.seed || "—"}</dd>
      <dt>Crawl Depth</dt>
      <dd>${webData.crawlDepth || 0}</dd>
      <dt>Total Nodes</dt>
      <dd>${webData.nodes.length}</dd>
      <dt>Tracked Nodes</dt>
      <dd>${webData.nodes.filter(n => n.isTracked).length}</dd>
      <dt>Dangling Nodes</dt>
      <dd>${webData.nodes.filter(n => n.isDangling).length}</dd>
      <dt>Total Edges</dt>
      <dd>${webData.edges.length}</dd>
      <dt>Crawled At</dt>
      <dd>${new Date(webData.timestamp).toLocaleString()}</dd>
    </dl>
    <h4 style="margin-top: 1.5rem; margin-bottom: 0.5rem;">Legend</h4>
    <dl style="font-size: 0.9em;">
      <dt>Node Color</dt>
      <dd>Based on <strong>minimum</strong> required DVNs across all source chains (weakest link)</dd>
      <dt style="margin-top: 0.5rem;">Edge Color</dt>
      <dd>
        <span style="color: var(--ink); opacity: 0.5;">Gray</span>: Normal security<br>
        <span style="color: #ff6666; opacity: 0.7;">Red</span>: Lower security than other edges in this web<br>
        <span style="color: #ff0000; font-weight: bold;">Dashed Red</span>: Blocked (dead address in DVNs)
      </dd>
      <dt style="margin-top: 0.5rem;">Node Border</dt>
      <dd>
        Solid: Tracked (security config known)<br>
        Dashed: Dangling (unknown security - dangerous!)
      </dd>
    </dl>
  `;
  container.appendChild(summary);

  const svg = renderSVGGraph(webData);
  container.appendChild(svg);

  const nodeList = renderNodeList(webData.nodes);
  container.appendChild(nodeList);

  return container;
}

function renderSVGGraph(webData) {
  const width = 1600;
  const height = 1200;
  const nodeRadius = 40;
  const padding = 150;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.border = "1px solid var(--ink)";
  svg.style.background = "var(--paper)";
  svg.style.marginTop = "1rem";

  const defs = document.createElementNS(svgNS, "defs");
  const marker = document.createElementNS(svgNS, "marker");
  marker.setAttribute("id", "arrowhead");
  marker.setAttribute("markerWidth", "10");
  marker.setAttribute("markerHeight", "10");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "3");
  marker.setAttribute("orient", "auto");
  const polygon = document.createElementNS(svgNS, "polygon");
  polygon.setAttribute("points", "0 0, 10 3, 0 6");
  polygon.setAttribute("fill", "var(--ink)");
  marker.appendChild(polygon);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const nodePositions = layoutNodes(webData.nodes, width, height, padding);

  const nodesById = new Map(webData.nodes.map(n => [n.id, n]));

  const edgeSecurityInfo = [];
  let maxRequiredDVNsInWeb = 0;

  for (const edge of webData.edges) {
    const toNode = nodesById.get(edge.to);
    let requiredDVNCount = 0;
    let requiredDVNs = [];
    let isBlocked = false;

    if (toNode && toNode.securityConfigs) {
      const configForThisEdge = toNode.securityConfigs.find(cfg => String(cfg.srcEid) === String(edge.srcEid));
      if (configForThisEdge) {
        requiredDVNCount = configForThisEdge.requiredDVNCount || 0;
        requiredDVNs = configForThisEdge.requiredDVNs || [];

        const deadAddress = "0x000000000000000000000000000000000000dead";
        isBlocked = requiredDVNs.some(addr =>
          String(addr).toLowerCase() === deadAddress.toLowerCase()
        );
      }
    }

    if (!isBlocked && requiredDVNCount > maxRequiredDVNsInWeb) {
      maxRequiredDVNsInWeb = requiredDVNCount;
    }

    edgeSecurityInfo.push({
      edge,
      requiredDVNCount,
      requiredDVNs,
      isBlocked,
    });
  }

  const edgesGroup = document.createElementNS(svgNS, "g");
  edgesGroup.setAttribute("class", "edges");

  for (const info of edgeSecurityInfo) {
    const edge = info.edge;
    const fromPos = nodePositions.get(edge.from);
    const toPos = nodePositions.get(edge.to);

    if (!fromPos || !toPos) continue;

    let strokeColor = "#000000ff";
    let strokeWidth = "3";
    let opacity = "0.5";
    let dashArray = "none";

    if (info.isBlocked) {
      strokeColor = "#ff0000";
      strokeWidth = "1";
      opacity = "0.6";
      dashArray = "8,4";
    } else if (info.requiredDVNCount < maxRequiredDVNsInWeb) {
      strokeColor = "#ff6666";
      strokeWidth = "2";
      opacity = "0.5";
    }

    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", fromPos.x);
    line.setAttribute("y1", fromPos.y);
    line.setAttribute("x2", toPos.x);
    line.setAttribute("y2", toPos.y);
    line.setAttribute("stroke", strokeColor);
    line.setAttribute("stroke-width", strokeWidth);
    line.setAttribute("stroke-dasharray", dashArray);
    line.setAttribute("marker-end", "url(#arrowhead)");
    line.setAttribute("opacity", opacity);

    const title = document.createElementNS(svgNS, "title");
    const titleLines = [
      `${edge.from} → ${edge.to}`,
      `Src EID: ${edge.srcEid}`,
    ];

    if (info.isBlocked) {
      titleLines.push(`STATUS: BLOCKED (dead address in DVNs)`);
    } else if (maxRequiredDVNsInWeb > 0 && info.requiredDVNCount < maxRequiredDVNsInWeb) {
      titleLines.push(`WARNING: Lower security than other edges (${info.requiredDVNCount} vs max ${maxRequiredDVNsInWeb})`);
    }

    if (info.requiredDVNs.length > 0) {
      titleLines.push(`Required DVNs: ${info.requiredDVNs.join(", ")}`);
      titleLines.push(`Required Count: ${info.requiredDVNCount}`);
    } else if (info.requiredDVNCount > 0) {
      titleLines.push(`Required DVN Count: ${info.requiredDVNCount}`);
    } else {
      titleLines.push(`Required DVN Count: 0 (WARNING: No required DVNs!)`);
    }

    title.textContent = titleLines.join("\n");
    line.appendChild(title);

    edgesGroup.appendChild(line);
  }
  svg.appendChild(edgesGroup);

  const nodesGroup = document.createElementNS(svgNS, "g");
  nodesGroup.setAttribute("class", "nodes");

  for (const node of webData.nodes) {
    const pos = nodePositions.get(node.id);
    if (!pos) continue;

    const minRequiredDVNs = node.securityConfigs && node.securityConfigs.length > 0
      ? Math.min(...node.securityConfigs.map(c => c.requiredDVNCount))
      : 0;

    const radius = node.isTracked
      ? nodeRadius * (0.6 + 0.4 * Math.min(minRequiredDVNs / 5, 1))
      : nodeRadius * 0.5;

    const nodeGroup = document.createElementNS(svgNS, "g");
    nodeGroup.setAttribute("class", "node");

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", pos.x);
    circle.setAttribute("cy", pos.y);
    circle.setAttribute("r", radius);
    circle.setAttribute("fill", node.isDangling ? "none" : getNodeColor(minRequiredDVNs));
    circle.setAttribute("stroke", "var(--ink)");
    circle.setAttribute("stroke-width", node.isDangling ? "3" : "2");
    circle.setAttribute("stroke-dasharray", node.isDangling ? "5,5" : "none");

    const title = document.createElementNS(svgNS, "title");
    const alias = getOAppAlias(node.id);
    const titleLines = [
      alias ? `${alias} (${node.id})` : node.id,
      `Chain: ${getChainDisplayLabel(node.chainId) || node.chainId}`,
      `Tracked: ${node.isTracked ? "Yes" : "No (Dangling)"}`,
      `Total Packets: ${node.totalPacketsReceived}`,
      `Min Required DVNs: ${minRequiredDVNs}`,
    ];
    title.textContent = titleLines.join("\n");
    circle.appendChild(title);

    nodeGroup.appendChild(circle);

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", pos.x);
    text.setAttribute("y", pos.y + radius + 18);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", "11");
    text.setAttribute("fill", "var(--ink)");
    text.textContent = alias || `${node.chainId}:${node.address.substring(0, 6)}...`;
    nodeGroup.appendChild(text);

    nodesGroup.appendChild(nodeGroup);
  }
  svg.appendChild(nodesGroup);

  return svg;
}

function layoutNodes(nodes, width, height, padding) {
  const positions = new Map();

  if (nodes.length === 0) return positions;

  const nodesByDepth = new Map();
  for (const node of nodes) {
    const depth = node.depth >= 0 ? node.depth : 999;
    if (!nodesByDepth.has(depth)) {
      nodesByDepth.set(depth, []);
    }
    nodesByDepth.get(depth).push(node);
  }

  const depths = Array.from(nodesByDepth.keys()).sort((a, b) => a - b);
  const maxDepth = Math.max(...depths);

  const depthSpacing = (width - 2 * padding) / Math.max(maxDepth, 1);

  for (const [depthIndex, depth] of depths.entries()) {
    const nodesAtDepth = nodesByDepth.get(depth);
    const x = padding + depthSpacing * depthIndex;
    const verticalSpacing = (height - 2 * padding) / Math.max(nodesAtDepth.length - 1, 1);

    for (const [index, node] of nodesAtDepth.entries()) {
      const y = padding + (nodesAtDepth.length === 1 ? (height - 2 * padding) / 2 : verticalSpacing * index);
      positions.set(node.id, { x, y });
    }
  }

  return positions;
}

function getNodeColor(requiredDVNCount) {
  if (requiredDVNCount === 0) return "#ffcccc";
  if (requiredDVNCount === 1) return "#ffffcc";
  if (requiredDVNCount === 2) return "#ccffcc";
  if (requiredDVNCount >= 3) return "#ccffff";
  return "#f0f0f0";
}

function renderNodeList(nodes) {
  const container = document.createElement("div");
  container.className = "node-list-container";
  container.style.marginTop = "2rem";

  const heading = document.createElement("h3");
  heading.textContent = "Nodes Detail";
  container.appendChild(heading);

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>OApp ID</th>
      <th>Chain</th>
      <th>Tracked</th>
      <th>Depth</th>
      <th>Security Configs</th>
      <th>Total Packets</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const node of nodes) {
    const tr = document.createElement("tr");

    const alias = getOAppAlias(node.id);
    const oappIdCell = document.createElement("td");
    const oappDiv = document.createElement("div");
    oappDiv.className = "copyable";
    oappDiv.dataset.copyValue = node.id;
    oappDiv.dataset.oappId = node.id;
    if (alias) {
      const aliasSpan = document.createElement("span");
      aliasSpan.textContent = alias;
      oappDiv.appendChild(aliasSpan);
      const idSpan = document.createElement("span");
      idSpan.textContent = `ID ${node.id}`;
      oappDiv.appendChild(idSpan);
    } else {
      const span = document.createElement("span");
      span.textContent = node.id;
      oappDiv.appendChild(span);
    }
    oappIdCell.appendChild(oappDiv);
    tr.appendChild(oappIdCell);

    const chainCell = document.createElement("td");
    chainCell.textContent = getChainDisplayLabel(node.chainId) || node.chainId;
    tr.appendChild(chainCell);

    const trackedCell = document.createElement("td");
    trackedCell.textContent = node.isTracked ? "Yes" : node.isDangling ? "No (Dangling)" : "No";
    tr.appendChild(trackedCell);

    const depthCell = document.createElement("td");
    depthCell.textContent = node.depth >= 0 ? node.depth : "—";
    tr.appendChild(depthCell);

    const configsCell = document.createElement("td");
    if (node.securityConfigs && node.securityConfigs.length > 0) {
      const configSummaries = node.securityConfigs.map(cfg => {
        const requiredDVNs = cfg.requiredDVNs.length > 0
          ? cfg.requiredDVNs.join(", ")
          : `${cfg.requiredDVNCount} DVNs`;
        return `EID ${cfg.srcEid}: ${requiredDVNs} (${cfg.requiredDVNCount} required)`;
      });
      configsCell.innerHTML = `<div style="font-size: 0.85em">${configSummaries.slice(0, 3).join("<br>")}</div>`;
      if (configSummaries.length > 3) {
        configsCell.innerHTML += `<div style="font-size: 0.85em; opacity: 0.6">...and ${configSummaries.length - 3} more</div>`;
      }
    } else {
      configsCell.textContent = "—";
    }
    tr.appendChild(configsCell);

    const packetsCell = document.createElement("td");
    packetsCell.textContent = node.totalPacketsReceived || "—";
    tr.appendChild(packetsCell);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  return container;
}
