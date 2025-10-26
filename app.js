/**
 * LayerZero Security Config Explorer
 * Main application bootstrap
 */

import {
  GraphQLClient,
  ChainMetadata,
  OAppChainOptions,
  normalizeOAppId,
} from "./core.js";
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
    this.oappChainOptions = new OAppChainOptions();
    this.aliasManager = new AliasManager();
    this.toastManager = new ToastManager();

    // DOM elements
    this.resultsTitle = document.getElementById("results-title");
    this.resultsMeta = document.getElementById("results-meta");
    this.resultsBody = document.getElementById("results-body");
    this.copyJsonButton = document.getElementById("copy-json");
    this.refreshAllButton = document.getElementById("refresh-all");
    this.aliasEditor = document.getElementById("alias-editor");
    this.aliasEditorForm = document.getElementById("alias-editor-form");
    this.aliasEditorIdInput = this.aliasEditorForm?.querySelector('input[name="oappId"]');
    this.aliasEditorAliasInput = this.aliasEditorForm?.querySelector('input[name="alias"]');

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
        oappChainOptions: this.oappChainOptions,
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
    await Promise.all([
      this.chainMetadata.load(),
      this.oappChainOptions.load(),
      this.aliasManager.load(),
    ]);

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

    // Refresh all button
    this.refreshAllButton?.addEventListener("click", async () => {
      const cards = document.querySelectorAll("[data-query-key]");
      for (const card of cards) {
        const key = card.getAttribute("data-query-key");
        const statusEl = card.querySelector("[data-status]");
        try {
          await this.queryManager.runQuery(key, card, statusEl);
        } catch (error) {
          console.error(`[Dashboard] Refresh failed: ${key}`, error);
        }
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

    // Alias editor form
    this.aliasEditorForm?.addEventListener("submit", (event) => {
      this.handleAliasSubmit(event);
    });

    this.aliasEditorForm?.addEventListener("click", (event) => {
      this.handleAliasFormClick(event);
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
  openAliasEditor(oappId) {
    if (!this.aliasEditor || !this.aliasEditorForm || !this.aliasEditorIdInput || !this.aliasEditorAliasInput) {
      return;
    }

    this.aliasEditorIdInput.value = oappId;
    this.aliasEditorAliasInput.value = this.aliasManager.get(oappId) || "";
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
  }

  /**
   * Handle alias form submission
   */
  handleAliasSubmit(event) {
    event.preventDefault();

    if (!this.aliasEditorIdInput || !this.aliasEditorAliasInput) {
      return;
    }

    const oappId = this.aliasEditorIdInput.value;
    const alias = this.aliasEditorAliasInput.value;

    this.aliasManager.set(oappId, alias);
    this.queryManager.reprocessLastResults();
    this.closeAliasEditor();
  }

  /**
   * Handle alias form button clicks
   */
  handleAliasFormClick(event) {
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
      if (this.aliasEditorIdInput) {
        this.aliasManager.set(this.aliasEditorIdInput.value, "");
        this.queryManager.reprocessLastResults();
      }
      this.closeAliasEditor();
    } else if (action === "export") {
      event.preventDefault();
      this.aliasManager.export();
    }
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
