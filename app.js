const GRAPHQL_ENDPOINT = "http://localhost:8080/v1/graphql";

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

  // Auto-run the first registered query on load
  if (!resultsState.bootstrapTriggered) {
    resultsState.bootstrapTriggered = true;
    queueMicrotask(run);
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

async function runQuery(key, card, config, statusEl) {
  const requestId = ++resultsState.requestSeq;
  resultsState.latestRequest = requestId;

  setStatus(statusEl, "Loading…", "loading");

  const buildResult = config.buildVariables(card) ?? {};
  const variables = buildResult.variables ?? {};
  const extraMeta = buildResult.meta ?? {};
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

    const rows = config.extractRows(payload.data);
    const elapsed = performance.now() - startedAt;
    const meta = {
      elapsed,
      variables,
      requestId,
      label: config.label,
      limitLabel: extraMeta.limitLabel,
    };

    setStatus(
      statusEl,
      `Fetched ${rows.length} rows in ${elapsed.toFixed(0)} ms`,
      "success",
    );

    if (requestId === resultsState.latestRequest) {
      resultsState.lastRows = rows;
      resultsState.lastPayload = payload;
      resultsState.lastQueryLabel = config.label;
      updateResultsPane(rows, payload, meta);
    }

    return rows;
  } catch (error) {
    console.error("GraphQL query failed", error);
    setStatus(statusEl, error.message, "error");

    if (requestId === resultsState.latestRequest) {
      showErrorInResults(
        {
          label: config.label,
          variables,
          limitLabel: extraMeta.limitLabel,
        },
        error,
      );
    }
    return [];
  }
}

function updateResultsPane(rows, payload, meta) {
  copyJsonButton.disabled = rows.length === 0;

  const variableHints = buildVariableSummary(meta.variables);
  const metaParts = [
    `${rows.length} row${rows.length === 1 ? "" : "s"}`,
    `${Math.round(meta.elapsed)} ms`,
    meta.limitLabel,
    variableHints,
    new Date().toLocaleTimeString(),
  ].filter(Boolean);

  resultsTitle.textContent = meta.label;
  resultsMeta.textContent = metaParts.join(" • ");

  if (!rows.length) {
    resultsBody.classList.add("empty");
    resultsBody.innerHTML = `
      <div class="placeholder">
        <p class="placeholder-title">No rows returned</p>
        <p>Adjust filters or try again.</p>
      </div>
    `;
    return;
  }

  resultsBody.classList.remove("empty");
  resultsBody.innerHTML = "";

  const table = buildTable(rows);
  const payloadDetails = buildPayloadDetails(payload);

  resultsBody.appendChild(table);
  resultsBody.appendChild(payloadDetails);
}

function showErrorInResults(meta, error) {
  copyJsonButton.disabled = true;
  resultsTitle.textContent = `${meta.label} (failed)`;
  const metaParts = [
    meta.limitLabel,
    buildVariableSummary(meta.variables),
    new Date().toLocaleTimeString(),
  ].filter(Boolean);
  resultsMeta.textContent = metaParts.join(" • ") || "Request failed.";

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
  if (value === null || value === undefined) {
    return document.createTextNode("—");
  }

  if (Array.isArray(value) || typeof value === "object") {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(value, null, 2);
    return pre;
  }

  if (typeof value === "string" && looksLikeHash(column, value)) {
    const wrapper = document.createElement("div");
    wrapper.className = "cell-copy";

    const code = document.createElement("code");
    code.textContent = value;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-btn";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(value);
        flipButtonTemporarily(button, "Copied", 1500);
      } catch (err) {
        console.error("Hash copy failed", err);
        flipButtonTemporarily(button, "Failed", 1500);
      }
    });

    wrapper.append(code, button);
    return wrapper;
  }

  return document.createTextNode(String(value));
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

function flipButtonTemporarily(button, label, timeoutMs) {
  const original = button.textContent;
  button.textContent = label;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.disabled = resultsState.lastRows?.length ? false : button === copyJsonButton;
  }, timeoutMs);
}

function buildVariableSummary(variables = {}) {
  const parts = [];
  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (key === "minPackets" && (value === "0" || value === 0)) {
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
