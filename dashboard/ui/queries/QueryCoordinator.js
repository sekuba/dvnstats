
import { resolveChainDisplayLabel } from "../../core.js";
import { resolveDvnLabels as _resolveDvnLabels } from "../../utils/DvnUtils.js";
import { OAppFormatter } from "./formatters/OAppFormatter.js";
import { SecurityConfigFormatter } from "./formatters/SecurityConfigFormatter.js";
import { buildQueryRegistry } from "./QueryRegistry.js";

export class QueryCoordinator {
  constructor(client, metadata, aliasStore, onResultsUpdate) {
    this.client = client;
    this.chainMetadata = metadata.chain;
    this.aliasStore = aliasStore;
    this.onResultsUpdate = onResultsUpdate;
    this.requestSeq = 0;
    this.latestRequest = 0;
    this.lastPayload = null;
    this.lastQueryKey = null;
    this.lastMetaBase = null;
    this.lastVariables = null;
    this.registry = null;

    
    this.securityConfigFormatter = new SecurityConfigFormatter(
      this.chainMetadata,
      this.aliasStore,
      (chainId) => this.getChainDisplayLabel(chainId),
      (addresses, meta, localEidOverride) =>
        this.resolveDvnLabels(addresses, meta, localEidOverride),
    );
    this.oappFormatter = new OAppFormatter(this.aliasStore, (chainId) =>
      this.getChainDisplayLabel(chainId),
    );
  }

  getChainDisplayLabel(chainId) {
    return resolveChainDisplayLabel(this.chainMetadata, chainId);
  }

  formatOAppIdCell(oappId) {
    return this.oappFormatter.formatOAppIdCell(oappId);
  }

  resolveDvnLabels(addresses, meta, localEidOverride) {
    return _resolveDvnLabels(addresses, this.chainMetadata, {
      localEid: localEidOverride,
      meta,
    });
  }

  buildQueryRegistry() {
    if (this.registry) {
      return this.registry;
    }

    this.registry = buildQueryRegistry(this);
    return this.registry;
  }

  populateChainDatalist(datalist) {
    datalist.innerHTML = "";
    const options = this.chainMetadata.listLocalEndpoints();
    options.forEach((option) => {
      if (!option || !option.id) return;
      const node = document.createElement("option");
      const display = `${option.label} (${option.id})`;
      node.value = option.id;
      node.label = display;
      node.textContent = display;
      datalist.appendChild(node);
    });
  }

  async runQuery(key, card, statusEl) {
    const requestId = ++this.requestSeq;
    this.latestRequest = requestId;

    this.setStatus(statusEl, "Loading…", "loading");

    const registry = this.buildQueryRegistry();
    const config = registry[key];

    if (!config) {
      throw new Error(`Unknown query: ${key}`);
    }

    const buildFn =
      typeof config.buildRequest === "function"
        ? config.buildRequest
        : typeof config.buildVariables === "function"
          ? config.buildVariables
          : null;
    const buildResult = buildFn ? buildFn(card) : {};
    if (!buildResult || typeof buildResult !== "object") {
      throw new Error("Query builder must return an object with `variables` and optional `meta`.");
    }
    const { variables, meta: extraMeta = {} } = buildResult;

    const hasCustomExecutor = typeof config.execute === "function";
    if (!hasCustomExecutor && (!variables || Object.keys(variables).length === 0)) {
      throw new Error("Missing query input.");
    }

    const startedAt = performance.now();

    try {
      const executionContext = {
        client: this.client,
        chainMetadata: this.chainMetadata,
        coordinator: this,
        requestId,
        setStatus: (text, state) => this.setStatus(statusEl, text, state),
      };

      let payload;
      if (hasCustomExecutor) {
        payload = await config.execute(buildResult, executionContext);
      } else {
        if (!config.query) {
          throw new Error(`Query definition for ${key} is missing an executor.`);
        }
        const data = await this.client.query(config.query, variables);
        payload = { data };
      }

      if (!payload || typeof payload !== "object") {
        throw new Error("Query execution returned an invalid payload.");
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
        const result = (await config.processResponse(payload, { ...baseMeta })) || {};
        rows = Array.isArray(result.rows) ? result.rows : [];
        if (result.meta && typeof result.meta === "object") {
          finalMeta = { ...baseMeta, ...result.meta };
        }
      } else if (typeof config.extractRows === "function") {
        rows = config.extractRows(payload.data) ?? [];
      }

      this.lastMetaBase = baseMeta;
      this.lastQueryKey = key;
      this.lastVariables = variables;
      this.lastPayload = payload;

      this.setStatus(
        statusEl,
        finalMeta.renderMode === "graph"
          ? `Loaded web with ${finalMeta.webData?.nodes?.length || 0} nodes in ${elapsed.toFixed(0)} ms`
          : `Fetched ${rows.length} row${rows.length === 1 ? "" : "s"} in ${elapsed.toFixed(0)} ms`,
        "success",
      );

      if (requestId === this.latestRequest) {
        this.onResultsUpdate(rows, payload, finalMeta);
      }

      return rows;
    } catch (error) {
      console.error("Query failed", error);
      this.setStatus(statusEl, error.message, "error");

      if (requestId === this.latestRequest) {
        this.onResultsUpdate([], null, {
          label: extraMeta.resultLabel || config.label,
          error: error.message,
          variables,
          limitLabel: extraMeta.limitLabel,
          summary: extraMeta.summary,
        });
      }
      return [];
    }
  }

  async reprocessLastResults() {
    if (!this.lastPayload || !this.lastMetaBase || !this.lastQueryKey) {
      return;
    }

    const registry = this.buildQueryRegistry();
    const config = registry[this.lastQueryKey];
    if (!config) {
      return;
    }

    const baseMeta = { ...this.lastMetaBase };
    let rows = [];
    let finalMeta = { ...baseMeta };

    try {
      if (typeof config.processResponse === "function") {
        let result = config.processResponse(this.lastPayload, { ...baseMeta }) || {};
        if (result && typeof result.then === "function") {
          result = await result;
        }
        rows = Array.isArray(result.rows) ? result.rows : [];
        if (result?.meta && typeof result.meta === "object") {
          finalMeta = { ...baseMeta, ...result.meta };
        }
      } else if (typeof config.extractRows === "function") {
        rows = config.extractRows(this.lastPayload.data) ?? [];
      }
    } catch (error) {
      console.error("[QueryCoordinator] Failed to reprocess results", error);
      return;
    }

    this.lastMetaBase = baseMeta;
    this.onResultsUpdate(rows, this.lastPayload, finalMeta);
  }

  setStatus(node, text, state) {
    if (!node) return;

    node.textContent = text;
    if (state) {
      node.setAttribute("data-state", state);
    } else {
      node.removeAttribute("data-state");
    }
  }
}
