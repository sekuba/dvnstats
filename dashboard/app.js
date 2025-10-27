/**
 * LayerZero Security Config Explorer
 * Main application bootstrap
 */

import { GraphQLClient, ChainMetadata } from "./core.js";
import { AliasManager, QueryManager, ResultsRenderer, ToastManager } from "./ui.js";
import { SecurityWebCrawler } from "./crawler.js";

/**
 * Main application class
 */
class Dashboard {
  constructor() {
    // Core services
    this.client = new GraphQLClient();
    this.chainMetadata = new ChainMetadata();
    this.aliasManager = new AliasManager();
    this.toastManager = new ToastManager();

    // DOM elements
    this.resultsTitle = document.getElementById("results-title");
    this.resultsMeta = document.getElementById("results-meta");
    this.resultsBody = document.getElementById("results-body");
    this.copyJsonButton = document.getElementById("copy-json");
    this.downloadAliasesButton = document.getElementById("download-aliases");
    this.aliasEditor = document.getElementById("alias-editor");
    this.aliasEditorForm = document.getElementById("alias-editor-form");
    this.aliasEditorIdInput = this.aliasEditorForm?.querySelector('input[name="oappId"]');
    this.aliasEditorAliasInput = this.aliasEditorForm?.querySelector('input[name="alias"]');
    this.aliasEditorTitle = document.getElementById("alias-editor-title");
    this.aliasEditorTitleDefault = this.aliasEditorTitle?.textContent || "Set OApp Name";
    this.bulkAliasTargets = null;

    // Results renderer
    this.resultsRenderer = new ResultsRenderer(
      this.resultsTitle,
      this.resultsMeta,
      this.resultsBody,
      this.copyJsonButton,
      this.chainMetadata,
      this.aliasManager,
      this.toastManager,
    );

    // Query manager
    this.queryManager = new QueryManager(
      this.client,
      {
        chain: this.chainMetadata,
      },
      this.aliasManager,
      (rows, payload, meta) => this.resultsRenderer.render(rows, payload, meta),
    );
  }

  /**
   * Initialize the application
   */
  async initialize() {
    console.log("[Dashboard] Initializing...");

    // Load all metadata in parallel
    await Promise.all([this.chainMetadata.load(), this.aliasManager.load()]);

    console.log("[Dashboard] Metadata loaded");

    // Initialize query cards
    this.initializeQueryCards();

    // Setup global event handlers
    this.setupGlobalHandlers();

    console.log("[Dashboard] Ready");
  }

  /**
   * Initialize all query cards
   */
  initializeQueryCards() {
    const registry = this.queryManager.buildQueryRegistry();
    let bootstrapTriggered = false;

    document.querySelectorAll("[data-query-key]").forEach((card) => {
      const key = card.getAttribute("data-query-key");
      const config = registry[key];

      if (!config) {
        console.warn(`[Dashboard] Unknown query key: ${key}`);
        return;
      }

      const runButton = card.querySelector(".run-query");
      const form = card.querySelector("form");
      const statusEl = card.querySelector("[data-status]");
      const queryCode = card.querySelector("[data-query-code]");

      if (queryCode && config.query) {
        queryCode.textContent = config.query.trim();
      }

      const run = async () => {
        try {
          await this.queryManager.runQuery(key, card, statusEl);
        } catch (error) {
          console.error(`[Dashboard] Query failed: ${key}`, error);
          this.toastManager.show(error.message, "error");
        }
      };

      runButton?.addEventListener("click", run);
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        run();
      });

      // Initialize query-specific hooks
      if (typeof config.initialize === "function") {
        try {
          config.initialize({ card, run });
        } catch (error) {
          console.warn(`[Dashboard] Initialize hook failed for ${key}`, error);
        }
      }

      // Bootstrap first query (only once, after metadata loads)
      if (!bootstrapTriggered) {
        bootstrapTriggered = true;
        queueMicrotask(run);
      }
    });
  }

  /**
   * Setup global event handlers
   */
  setupGlobalHandlers() {
    // Copy JSON button
    this.copyJsonButton?.addEventListener("click", () => {
      this.resultsRenderer.handleCopyJson();
    });

    // Download aliases button
    this.downloadAliasesButton?.addEventListener("click", () => {
      try {
        this.aliasManager.export();
      } catch (error) {
        console.error("[Dashboard] Failed to export aliases", error);
        this.toastManager.show("Failed to export aliases", "error");
      }
    });

    // Copyable cells
    this.resultsBody?.addEventListener("click", (event) => {
      this.resultsRenderer.handleCopyableClick(event);
    });

    // Double-click to edit alias
    this.resultsBody?.addEventListener("dblclick", (event) => {
      this.handleAliasDblClick(event);
    });

    document.addEventListener("alias:rename-all", (event) => {
      const detail = event?.detail;
      if (!detail) {
        return;
      }
      const filteredTargets = this.filterAliasTargets(detail.oappIds);
      if (!filteredTargets.length) {
        this.toastManager.show("No eligible nodes available for renaming.", "info");
        return;
      }
      this.openAliasEditor(null, { mode: "bulk", targets: filteredTargets });
    });

    // Alias editor form
    this.aliasEditorForm?.addEventListener("submit", (event) => {
      this.handleAliasSubmit(event).catch((error) => {
        console.error("[Dashboard] Alias submit failed", error);
      });
    });

    this.aliasEditorForm?.addEventListener("click", (event) => {
      this.handleAliasFormClick(event).catch((error) => {
        console.error("[Dashboard] Alias action failed", error);
      });
    });

    // Close alias editor on Escape
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.aliasEditor?.classList.contains("hidden")) {
        event.preventDefault();
        this.closeAliasEditor();
      }
    });

    // Close alias editor on backdrop click
    this.aliasEditor?.addEventListener("click", (event) => {
      if (event.target === this.aliasEditor) {
        this.closeAliasEditor();
      }
    });
  }

  /**
   * Handle double-click to edit alias
   */
  handleAliasDblClick(event) {
    const target = event.target.closest(".copyable[data-oapp-id]");
    if (!target || !this.resultsBody.contains(target)) {
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

    this.openAliasEditor(oappId);
  }

  /**
   * Open alias editor modal
   */
  openAliasEditor(oappId, options = {}) {
    if (
      !this.aliasEditor ||
      !this.aliasEditorForm ||
      !this.aliasEditorIdInput ||
      !this.aliasEditorAliasInput
    ) {
      return;
    }

    const mode = options.mode === "bulk" ? "bulk" : "single";

    if (mode === "bulk") {
      const targets = this.filterAliasTargets(options.targets);

      if (!targets.length) {
        this.toastManager.show("No eligible nodes available for renaming.", "info");
        return;
      }

      this.bulkAliasTargets = targets;
      if (this.aliasEditorTitle) {
        this.aliasEditorTitle.textContent =
          targets.length === 1 ? this.aliasEditorTitleDefault : "Set OApp Name (All Nodes)";
      }

      this.aliasEditorIdInput.value =
        targets.length === 1 ? targets[0] : `${targets.length} nodes selected`;

      const aliases = targets
        .map((id) => this.aliasManager.get(id))
        .filter((value) => typeof value === "string" && value.length > 0);
      const sharedAlias =
        aliases.length && aliases.every((value) => value === aliases[0]) ? aliases[0] : "";
      this.aliasEditorAliasInput.value = sharedAlias;
    } else {
      this.bulkAliasTargets = null;
      if (!oappId) {
        return;
      }
      if (this.aliasEditorTitle) {
        this.aliasEditorTitle.textContent = this.aliasEditorTitleDefault;
      }
      this.aliasEditorIdInput.value = oappId;
      this.aliasEditorAliasInput.value = this.aliasManager.get(oappId) || "";
    }

    this.aliasEditor.classList.remove("hidden");

    setTimeout(() => {
      this.aliasEditorAliasInput.focus();
      this.aliasEditorAliasInput.select();
    }, 0);
  }

  /**
   * Close alias editor modal
   */
  closeAliasEditor() {
    if (!this.aliasEditor || !this.aliasEditorForm || !this.aliasEditorAliasInput) {
      return;
    }

    this.aliasEditor.classList.add("hidden");
    this.aliasEditorForm.reset();
    this.bulkAliasTargets = null;
    if (this.aliasEditorTitle) {
      this.aliasEditorTitle.textContent = this.aliasEditorTitleDefault;
    }
  }

  /**
   * Handle alias form submission
   */
  async handleAliasSubmit(event) {
    event.preventDefault();

    if (!this.aliasEditorIdInput || !this.aliasEditorAliasInput) {
      return;
    }

    const alias = this.aliasEditorAliasInput.value;
    const targets = this.filterAliasTargets(this.bulkAliasTargets);

    if (targets && targets.length) {
      targets.forEach((id) => this.aliasManager.set(id, alias));
      await this.queryManager.reprocessLastResults();
      this.closeAliasEditor();

      const normalized = alias && alias.trim().length > 0;
      const tone = normalized ? "success" : "info";
      const message = normalized
        ? `Applied alias to ${targets.length} node${targets.length === 1 ? "" : "s"}.`
        : `Cleared aliases for ${targets.length} node${targets.length === 1 ? "" : "s"}.`;
      this.toastManager.show(message, tone);
      return;
    }

    const oappId = this.aliasEditorIdInput.value;
    if (!oappId) {
      this.closeAliasEditor();
      return;
    }

    this.aliasManager.set(oappId, alias);
    await this.queryManager.reprocessLastResults();
    this.closeAliasEditor();
  }

  /**
   * Handle alias form button clicks
   */
  async handleAliasFormClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    const action = target.dataset.action;

    if (action === "cancel") {
      event.preventDefault();
      this.closeAliasEditor();
    } else if (action === "clear") {
      event.preventDefault();
      const targets = this.filterAliasTargets(this.bulkAliasTargets);
      if (targets && targets.length) {
        targets.forEach((id) => this.aliasManager.set(id, ""));
        await this.queryManager.reprocessLastResults();
        this.closeAliasEditor();
        this.toastManager.show(
          `Cleared aliases for ${targets.length} node${targets.length === 1 ? "" : "s"}.`,
          "info",
        );
      } else if (this.aliasEditorIdInput) {
        const oappId = this.aliasEditorIdInput.value;
        if (oappId) {
          this.aliasManager.set(oappId, "");
          await this.queryManager.reprocessLastResults();
        }
        this.closeAliasEditor();
      }
    } else if (action === "export") {
      event.preventDefault();
      this.aliasManager.export();
    }
  }

  filterAliasTargets(input) {
    const ZERO_ADDRESS20 = "0x0000000000000000000000000000000000000000";
    const ZERO_ADDRESS32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const seen = new Set();
    const result = [];

    const candidates = Array.isArray(input) ? input : [];
    candidates.forEach((raw) => {
      if (raw === null || raw === undefined) {
        return;
      }
      const trimmed = String(raw).trim();
      if (!trimmed) {
        return;
      }
      const parts = trimmed.split("_");
      if (parts.length < 2) {
        return;
      }
      const address = parts[parts.length - 1].toLowerCase();
      if (address === ZERO_ADDRESS20 || address === ZERO_ADDRESS32) {
        if (this.aliasManager) {
          this.aliasManager.set(trimmed, "");
        }
        return;
      }
      if (!address.startsWith("0x")) {
        return;
      }
      if (seen.has(trimmed)) {
        return;
      }
      seen.add(trimmed);
      result.push(trimmed);
    });

    return result;
  }
}

// Initialize the dashboard when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    const dashboard = new Dashboard();
    dashboard.initialize().catch((error) => {
      console.error("[Dashboard] Failed to initialize", error);
    });
  });
} else {
  const dashboard = new Dashboard();
  dashboard.initialize().catch((error) => {
    console.error("[Dashboard] Failed to initialize", error);
  });
}
