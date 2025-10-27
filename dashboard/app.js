import { APP_CONFIG } from "./config.js";
import { ChainDirectory, HasuraClient } from "./core.js";
import { AliasStore, QueryCoordinator, ResultsView, ToastQueue } from "./ui.js";

class DashboardApp {
  constructor() {
    this.client = new HasuraClient();
    this.chainDirectory = new ChainDirectory();
    this.aliasStore = new AliasStore();
    this.toastQueue = new ToastQueue();

    this.dom = {
      title: document.getElementById("results-title"),
      meta: document.getElementById("results-meta"),
      body: document.getElementById("results-body"),
      copyButton: document.getElementById("copy-json"),
      aliasDownloadButton: document.getElementById("download-aliases"),
      aliasModal: document.getElementById("alias-editor"),
      aliasForm: document.getElementById("alias-editor-form"),
      aliasTitle: document.getElementById("alias-editor-title"),
    };
    this.aliasFields = {
      id: this.dom.aliasForm?.querySelector('input[name="oappId"]') ?? null,
      alias: this.dom.aliasForm?.querySelector('input[name="alias"]') ?? null,
      defaultTitle: this.dom.aliasTitle?.textContent || "Set OApp Name",
    };

    this.bulkAliasTargets = null;

    this.resultsView = new ResultsView(
      this.dom.title,
      this.dom.meta,
      this.dom.body,
      this.dom.copyButton,
      this.chainDirectory,
      this.aliasStore,
      this.toastQueue,
    );

    this.queryCoordinator = new QueryCoordinator(
      this.client,
      { chain: this.chainDirectory },
      this.aliasStore,
      (rows, payload, meta) => this.resultsView.render(rows, payload, meta),
    );
  }

  async initialize() {
    console.log("[DashboardApp] Initializing…");

    await Promise.all([this.chainDirectory.load(), this.aliasStore.load()]);

    console.log("[DashboardApp] Metadata ready");

    this.setupQueryCards();
    this.registerGlobalHandlers();

    console.log("[DashboardApp] Ready");
  }

  setupQueryCards() {
    const registry = this.queryCoordinator.buildQueryRegistry();
    let bootstrapTriggered = false;

    document.querySelectorAll("[data-query-key]").forEach((card) => {
      const key = card.getAttribute("data-query-key");
      const config = registry[key];

      if (!config) {
        console.warn(`[DashboardApp] Unknown query key: ${key}`);
        return;
      }

      const runButton = card.querySelector(".run-query");
      const form = card.querySelector("form");
      const statusEl = card.querySelector("[data-status]");
      const queryCode = card.querySelector("[data-query-code]");

      if (queryCode && config.query) {
        queryCode.textContent = config.query.trim();
      }

      const runQuery = async () => {
        try {
          await this.queryCoordinator.runQuery(key, card, statusEl);
        } catch (error) {
          console.error(`[DashboardApp] Query failed: ${key}`, error);
          this.toastQueue.show(error.message, "error");
        }
      };

      runButton?.addEventListener("click", runQuery);
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        runQuery();
      });

      if (typeof config.initialize === "function") {
        try {
          config.initialize({ card, run: runQuery });
        } catch (error) {
          console.warn(`[DashboardApp] Initialize hook failed for ${key}`, error);
        }
      }

      if (!bootstrapTriggered) {
        bootstrapTriggered = true;
        queueMicrotask(runQuery);
      }
    });
  }

  registerGlobalHandlers() {
    this.dom.copyButton?.addEventListener("click", () => {
      this.resultsView.handleCopyJson();
    });

    this.dom.aliasDownloadButton?.addEventListener("click", () => {
      try {
        this.aliasStore.export();
      } catch (error) {
        console.error("[DashboardApp] Failed to export aliases", error);
        this.toastQueue.show("Failed to export aliases", "error");
      }
    });

    this.dom.body?.addEventListener("click", (event) => {
      this.resultsView.handleCopyableClick(event);
    });

    this.dom.body?.addEventListener("dblclick", (event) => {
      this.handleAliasDoubleClick(event);
    });

    document.addEventListener("alias:rename-all", (event) => {
      const detail = event?.detail;
      if (!detail) {
        return;
      }
      const targets = this.sanitizeAliasTargets(detail.oappIds);
      if (!targets.length) {
        this.toastQueue.show("No eligible nodes available for renaming.", "info");
        return;
      }
      this.openAliasModal({ mode: "bulk", targets });
    });

    this.dom.aliasForm?.addEventListener("submit", (event) => {
      this.handleAliasSubmit(event).catch((error) => {
        console.error("[DashboardApp] Alias submit failed", error);
      });
    });

    this.dom.aliasForm?.addEventListener("click", (event) => {
      this.handleAliasFormClick(event).catch((error) => {
        console.error("[DashboardApp] Alias action failed", error);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.dom.aliasModal?.classList.contains("hidden")) {
        event.preventDefault();
        this.closeAliasModal();
      }
    });

    this.dom.aliasModal?.addEventListener("click", (event) => {
      if (event.target === this.dom.aliasModal) {
        this.closeAliasModal();
      }
    });
  }

  handleAliasDoubleClick(event) {
    const container = event.target.closest(".copyable[data-oapp-id]");
    if (!container || !this.dom.body.contains(container)) {
      return;
    }

    event.preventDefault();
    const oappId = container.dataset.oappId;
    if (!oappId) {
      return;
    }

    const selection = window.getSelection?.();
    if (selection && selection.removeAllRanges) {
      selection.removeAllRanges();
    }

    this.openAliasModal({ mode: "single", target: oappId });
  }

  openAliasModal({ mode, target, targets }) {
    if (
      !this.dom.aliasModal ||
      !this.dom.aliasForm ||
      !this.aliasFields.id ||
      !this.aliasFields.alias
    ) {
      return;
    }

    const formMode = mode === "bulk" ? "bulk" : "single";

    if (formMode === "bulk") {
      const cleanedTargets = this.sanitizeAliasTargets(targets);
      if (!cleanedTargets.length) {
        this.toastQueue.show("No eligible nodes available for renaming.", "info");
        return;
      }

      this.bulkAliasTargets = cleanedTargets;
      const targetLabel =
        cleanedTargets.length === 1 ? cleanedTargets[0] : `${cleanedTargets.length} nodes selected`;
      const sharedAlias = this.computeSharedAlias(cleanedTargets);

      this.aliasFields.id.value = targetLabel;
      this.aliasFields.alias.value = sharedAlias;
      if (this.dom.aliasTitle) {
        this.dom.aliasTitle.textContent =
          cleanedTargets.length === 1 ? this.aliasFields.defaultTitle : "Set OApp Name (All Nodes)";
      }
    } else {
      if (!target) {
        return;
      }
      this.bulkAliasTargets = null;
      this.aliasFields.id.value = target;
      this.aliasFields.alias.value = this.aliasStore.get(target) || "";
      if (this.dom.aliasTitle) {
        this.dom.aliasTitle.textContent = this.aliasFields.defaultTitle;
      }
    }

    this.dom.aliasModal.classList.remove("hidden");

    queueMicrotask(() => {
      this.aliasFields.alias.focus();
      this.aliasFields.alias.select();
    });
  }

  computeSharedAlias(targetIds) {
    const aliases = targetIds
      .map((id) => this.aliasStore.get(id))
      .filter((value) => typeof value === "string" && value.length > 0);
    if (!aliases.length) {
      return "";
    }
    const [firstAlias] = aliases;
    return aliases.every((alias) => alias === firstAlias) ? firstAlias : "";
  }

  closeAliasModal() {
    if (!this.dom.aliasModal || !this.dom.aliasForm || !this.aliasFields.alias) {
      return;
    }

    this.dom.aliasModal.classList.add("hidden");
    this.dom.aliasForm.reset();
    this.bulkAliasTargets = null;
    if (this.dom.aliasTitle) {
      this.dom.aliasTitle.textContent = this.aliasFields.defaultTitle;
    }
  }

  async handleAliasSubmit(event) {
    event.preventDefault();

    if (!this.aliasFields.id || !this.aliasFields.alias) {
      return;
    }

    const alias = this.aliasFields.alias.value;
    const targets = this.sanitizeAliasTargets(this.bulkAliasTargets);

    if (targets.length > 0) {
      targets.forEach((id) => this.aliasStore.set(id, alias));
      await this.queryCoordinator.reprocessLastResults();
      this.closeAliasModal();

      const normalized = alias && alias.trim().length > 0;
      const tone = normalized ? "success" : "info";
      const message = normalized
        ? `Applied alias to ${targets.length} node${targets.length === 1 ? "" : "s"}.`
        : `Cleared aliases for ${targets.length} node${targets.length === 1 ? "" : "s"}.`;
      this.toastQueue.show(message, tone);
      return;
    }

    const oappId = this.aliasFields.id.value;
    if (!oappId) {
      this.closeAliasModal();
      return;
    }

    this.aliasStore.set(oappId, alias);
    await this.queryCoordinator.reprocessLastResults();
    this.closeAliasModal();
  }

  async handleAliasFormClick(event) {
    const button = event.target;
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const action = button.dataset.action;

    if (action === "cancel") {
      event.preventDefault();
      this.closeAliasModal();
      return;
    }

    if (action === "clear") {
      event.preventDefault();
      const targets = this.sanitizeAliasTargets(this.bulkAliasTargets);
      if (targets.length) {
        targets.forEach((id) => this.aliasStore.set(id, ""));
        await this.queryCoordinator.reprocessLastResults();
        this.closeAliasModal();
        this.toastQueue.show(
          `Cleared aliases for ${targets.length} node${targets.length === 1 ? "" : "s"}.`,
          "info",
        );
      } else if (this.aliasFields.id) {
        const oappId = this.aliasFields.id.value;
        if (oappId) {
          this.aliasStore.set(oappId, "");
          await this.queryCoordinator.reprocessLastResults();
        }
        this.closeAliasModal();
      }
      return;
    }

    if (action === "export") {
      event.preventDefault();
      this.aliasStore.export();
    }
  }

  sanitizeAliasTargets(input) {
    const zeroAddresses = new Set(
      [APP_CONFIG.ZERO_ADDRESS, APP_CONFIG.ZERO_PEER]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase()),
    );
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
      if (!address.startsWith("0x")) {
        return;
      }
      if (zeroAddresses.has(address)) {
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

function bootstrapDashboard() {
  const dashboard = new DashboardApp();
  dashboard.initialize().catch((error) => {
    console.error("[DashboardApp] Failed to initialize", error);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapDashboard);
} else {
  bootstrapDashboard();
}
