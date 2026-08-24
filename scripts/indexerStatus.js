#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const DEFAULT_POSTGRES_CONTAINER = "dvnstats-postgres";
const DEFAULT_HASURA_CONTAINER = "dvnstats-hasura";
const DEFAULT_DATABASE = "envio-dev";
const DEFAULT_DB_USER = "postgres";
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_HEIGHT_TIMEOUT_MS = 15_000;
const DEFAULT_WARN_LAG_BLOCKS = 100;
const DEFAULT_TOP_ROWS = 12;

let options;

try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}

if (options.help) {
  printHelp();
  process.exit(0);
}

const config = {
  postgresContainer: process.env.ENVIO_POSTGRES_CONTAINER ?? DEFAULT_POSTGRES_CONTAINER,
  hasuraContainer: process.env.ENVIO_HASURA_CONTAINER ?? DEFAULT_HASURA_CONTAINER,
  database: process.env.ENVIO_DATABASE ?? DEFAULT_DATABASE,
  dbUser: process.env.ENVIO_DB_USER ?? DEFAULT_DB_USER,
  concurrency:
    options.concurrency ??
    parsePositiveInteger(process.env.INDEXER_STATUS_CONCURRENCY) ??
    DEFAULT_CONCURRENCY,
  heightTimeoutMs:
    options.timeoutMs ??
    parsePositiveInteger(process.env.INDEXER_STATUS_TIMEOUT_MS) ??
    DEFAULT_HEIGHT_TIMEOUT_MS,
  warnLagBlocks:
    options.warnLag ??
    parseNonNegativeInteger(process.env.INDEXER_STATUS_WARN_LAG_BLOCKS) ??
    DEFAULT_WARN_LAG_BLOCKS,
  topRows:
    options.topRows ??
    parsePositiveInteger(process.env.INDEXER_STATUS_TOP_ROWS) ??
    DEFAULT_TOP_ROWS,
};

try {
  const status = await collectStatus(config);

  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    printStatus(status, { all: options.all });
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}

async function collectStatus(config) {
  const checkedAt = new Date().toISOString();
  const services = getEnvioServices(config);
  const indexerProcesses = getIndexerProcesses();
  const chainProgress = getChainProgress(config);
  const heights = await fetchHeights(chainProgress, config);
  const chains = chainProgress
    .map((row) => {
      const height = heights.get(row.chainId);
      const tip = height?.tip ?? null;
      const tipLag = tip === null ? null : tip - row.progressBlock;
      const dbLag = row.sourceBlock - row.progressBlock;

      return {
        ...row,
        currentTip: tip,
        dbLag,
        tipLag,
        tipError: height?.error ?? "",
        status: chainStatus({ dbLag, tipLag, tipError: height?.error }),
      };
    })
    .sort((a, b) => a.chainId - b.chainId);

  const successfulTipChecks = chains.filter((chain) => chain.tipError === "");
  const failedTipChecks = chains.filter((chain) => chain.tipError !== "");
  const dbBacklogChains = chains.filter((chain) => chain.dbLag > 0);
  const laggingChains = successfulTipChecks.filter(
    (chain) => (chain.tipLag ?? 0) > config.warnLagBlocks,
  );

  const tipLags = successfulTipChecks
    .map((chain) => chain.tipLag)
    .filter((lag) => lag !== null)
    .sort((a, b) => a - b);

  return {
    checkedAt,
    config,
    services,
    indexerProcesses,
    summary: {
      chainCount: chains.length,
      successfulTipChecks: successfulTipChecks.length,
      failedTipChecks: failedTipChecks.length,
      dbBacklogChainCount: dbBacklogChains.length,
      maxDbLag: maxNumber(chains.map((chain) => chain.dbLag)),
      warnLagBlocks: config.warnLagBlocks,
      laggingChainCount: laggingChains.length,
      nearTipChainCount: successfulTipChecks.length - laggingChains.length,
      maxTipLag: maxNumber(tipLags),
      p95TipLag: percentile(tipLags, 0.95),
      averageTipLag: average(tipLags),
    },
    chains,
  };
}

function getEnvioServices(config) {
  const output = execOptional("docker", [
    "ps",
    "--filter",
    `name=${config.postgresContainer}`,
    "--filter",
    `name=${config.hasuraContainer}`,
    "--format",
    "{{.Names}}\t{{.Status}}\t{{.Ports}}",
  ]);

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, status, ports] = line.split("\t");
      return { name, status, ports };
    });
}

function getIndexerProcesses() {
  const output = execOptional("pgrep", ["-a", "-f", "envio.*(dev|start)|pnpm.*(dev|start)"]);

  return output
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.includes("scripts/indexerStatus.js"))
    .filter((line) => !line.includes("pgrep -a -f"))
    .map((line) => line.trim());
}

function getChainProgress(config) {
  const query = `
    SELECT id, progress_block, source_block
    FROM envio_chains
    ORDER BY id;
  `;
  const output = execRequired("docker", [
    "exec",
    config.postgresContainer,
    "psql",
    "-U",
    config.dbUser,
    "-d",
    config.database,
    "-At",
    "-F",
    ",",
    "-c",
    query,
  ]);

  if (output.trim() === "") {
    return [];
  }

  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [chainId, progressBlock, sourceBlock] = line
        .split(",")
        .map((value) => Number.parseInt(value, 10));

      return { chainId, progressBlock, sourceBlock };
    });
}

async function fetchHeights(rows, config) {
  const results = new Map();
  let cursor = 0;
  const workerCount = Math.min(config.concurrency, rows.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor];
        cursor += 1;
        results.set(row.chainId, await fetchHeight(row.chainId, config));
      }
    }),
  );

  return results;
}

async function fetchHeight(chainId, config) {
  const url = `https://${chainId}.hypersync.xyz/height`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.heightTimeoutMs),
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`${response.status} ${compact(text)}`);
    }

    const body = JSON.parse(text);
    const tip = Number.parseInt(body.height, 10);

    if (!Number.isFinite(tip)) {
      throw new Error(`invalid height response: ${compact(text)}`);
    }

    return { tip, error: "" };
  } catch (error) {
    return { tip: null, error: error.message };
  }
}

function chainStatus({ dbLag, tipLag, tipError }) {
  if (tipError) {
    return "TIP_ERROR";
  }

  if (dbLag > 0) {
    return "DB_BACKLOG";
  }

  if (tipLag > config.warnLagBlocks) {
    return "LAGGING";
  }

  if (tipLag > 0) {
    return "LIVE";
  }

  if (tipLag < 0) {
    return "AHEAD";
  }

  return "TIP";
}

function printStatus(status, { all }) {
  const { summary } = status;
  const lines = [
    `Indexer status at ${status.checkedAt}`,
    "",
    `Services: ${formatServices(status.services)}`,
    `Indexer process: ${formatProcessStatus(status.indexerProcesses)}`,
    `Chains: ${summary.chainCount} configured, ${summary.successfulTipChecks} tip checks OK, ${summary.failedTipChecks} failed`,
    `DB backlog: ${summary.dbBacklogChainCount} chains, max ${formatNumber(summary.maxDbLag)} blocks`,
    `HyperSync lag: max ${formatNumber(summary.maxTipLag)} blocks, p95 ${formatNumber(summary.p95TipLag)} blocks, avg ${formatDecimal(summary.averageTipLag)} blocks`,
    `Near tip threshold: <= ${formatNumber(summary.warnLagBlocks)} blocks (${summary.nearTipChainCount}/${summary.successfulTipChecks} OK)`,
  ];

  console.log(lines.join("\n"));

  const rows = selectRowsForTable(status.chains, status.config.topRows, all);

  if (rows.length > 0) {
    console.log("");
    console.log(
      all
        ? "All chains:"
        : `Worst lags, errors, and DB backlog (top ${status.config.topRows} by lag):`,
    );
    console.log(
      makeTable(
        rows.map((chain) => ({
          chain: chain.chainId,
          progress: chain.progressBlock,
          source: chain.sourceBlock,
          tip: chain.currentTip ?? "-",
          tip_lag: chain.tipLag ?? "-",
          db_lag: chain.dbLag,
          status: chain.status,
          error: chain.tipError ? compact(chain.tipError, 48) : "",
        })),
        ["chain", "progress", "source", "tip", "tip_lag", "db_lag", "status", "error"],
      ),
    );
  }
}

function selectRowsForTable(chains, topRows, all) {
  if (all) {
    return chains;
  }

  const required = chains.filter((chain) => chain.tipError !== "" || chain.dbLag > 0);
  const byLag = [...chains]
    .filter((chain) => chain.tipError === "")
    .sort((a, b) => (b.tipLag ?? -Infinity) - (a.tipLag ?? -Infinity))
    .slice(0, topRows);

  const deduped = new Map();
  for (const chain of [...required, ...byLag]) {
    deduped.set(chain.chainId, chain);
  }

  return [...deduped.values()].sort((a, b) => (b.tipLag ?? -Infinity) - (a.tipLag ?? -Infinity));
}

function formatServices(services) {
  if (services.length === 0) {
    return "not found";
  }

  return services.map((service) => `${service.name} ${service.status}`).join("; ");
}

function formatProcessStatus(processes) {
  if (processes.length === 0) {
    return "not running";
  }

  return `running (${processes.length} matching processes)`;
}

function makeTable(rows, columns) {
  const renderedRows = rows.map((row) => columns.map((column) => formatCell(row[column])));
  const widths = columns.map((column, columnIndex) =>
    Math.max(column.length, ...renderedRows.map((row) => row[columnIndex].length)),
  );
  const header = columns.map((column, index) => column.padEnd(widths[index])).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const body = renderedRows
    .map((row) => row.map((value, index) => value.padEnd(widths[index])).join("  "))
    .join("\n");

  return [header, divider, body].filter(Boolean).join("\n");
}

function formatCell(value) {
  return typeof value === "number" ? String(value) : String(value);
}

function formatNumber(value) {
  return value === null || value === undefined ? "-" : new Intl.NumberFormat("en-US").format(value);
}

function formatDecimal(value) {
  return value === null || value === undefined ? "-" : value.toFixed(1);
}

function compact(value, limit = 120) {
  const compacted = String(value).replace(/\s+/g, " ").trim();
  return compacted.length > limit ? `${compacted.slice(0, limit - 3)}...` : compacted;
}

function execRequired(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = error.stderr?.toString()?.trim();
    const detail = stderr ? `: ${stderr}` : "";
    throw new Error(`failed to run ${command} ${args.join(" ")}${detail}`);
  }
}

function execOptional(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function maxNumber(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  return finiteValues.length === 0 ? null : Math.max(...finiteValues);
}

function average(values) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, percentile) {
  if (values.length === 0) {
    return null;
  }

  const index = Math.ceil(values.length * percentile) - 1;
  return values[Math.max(0, Math.min(index, values.length - 1))];
}

function parseArgs(args) {
  const options = {
    all: false,
    help: false,
    json: false,
    topRows: null,
    warnLag: null,
    timeoutMs: null,
    concurrency: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--all") {
      options.all = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--top") {
      options.topRows = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--warn-lag") {
      options.warnLag = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      options.timeoutMs = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--concurrency") {
      options.concurrency = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`unknown option: ${arg}`);
  }

  options.topRows =
    options.topRows === null ? null : parsePositiveIntegerOrThrow(options.topRows, "--top");
  options.warnLag =
    options.warnLag === null ? null : parseNonNegativeIntegerOrThrow(options.warnLag, "--warn-lag");
  options.timeoutMs =
    options.timeoutMs === null
      ? null
      : parsePositiveIntegerOrThrow(options.timeoutMs, "--timeout-ms");
  options.concurrency =
    options.concurrency === null
      ? null
      : parsePositiveIntegerOrThrow(options.concurrency, "--concurrency");

  return options;
}

function requireValue(args, index, optionName) {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }

  return value;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parsePositiveIntegerOrThrow(value, optionName) {
  const parsed = parsePositiveInteger(value);

  if (parsed === null) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return parsed;
}

function parseNonNegativeIntegerOrThrow(value, optionName) {
  const parsed = parseNonNegativeInteger(value);

  if (parsed === null) {
    throw new Error(`${optionName} must be a non-negative integer`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/indexerStatus.js [options]

Print current Envio indexer status from Docker/Postgres and HyperSync tips.

Options:
  --all                 Print every chain instead of only the worst lags
  --json                Print raw JSON
  --top <n>             Number of lag rows to print (default: ${DEFAULT_TOP_ROWS})
  --warn-lag <blocks>   Mark chains above this lag as LAGGING (default: ${DEFAULT_WARN_LAG_BLOCKS})
  --timeout-ms <ms>     Per-chain HyperSync height timeout (default: ${DEFAULT_HEIGHT_TIMEOUT_MS})
  --concurrency <n>     Concurrent HyperSync height requests (default: ${DEFAULT_CONCURRENCY})
  -h, --help            Show this help

Environment:
  ENVIO_POSTGRES_CONTAINER  Docker Postgres container (default: ${DEFAULT_POSTGRES_CONTAINER})
  ENVIO_HASURA_CONTAINER    Docker Hasura container (default: ${DEFAULT_HASURA_CONTAINER})
  ENVIO_DATABASE            Postgres database (default: ${DEFAULT_DATABASE})
  ENVIO_DB_USER             Postgres user (default: ${DEFAULT_DB_USER})`);
}
