import { APP_CONFIG } from "./config.js";
import { ChainDirectory, HasuraClient } from "./core.js";
import { AliasStore, QueryCoordinator, ResultsView, ToastQueue } from "./ui.js";
import { AddressUtils } from "./utils/AddressUtils.js";

const EXPLORER_QUERY_KEYS = [
  "top-oapps",
  "web-of-security",
  "oapp-security-config",
  "popular-oapps-window",
];
const EXPLORER_FORM_PARAM_NAMES = new Set([
  "limit",
  "minPackets",
  "seedOAppId",
  "depth",
  "oappId",
  "localEid",
  "oappAddress",
  "windowValue",
  "windowUnit",
  "resultLimit",
  "fetchLimit",
]);

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
      downloadSvgButton: document.getElementById("download-svg"),
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
    this.queryCards = new Map();
    this.queryStatusNodes = new Map();

    this.resultsView = new ResultsView(
      this.dom.title,
      this.dom.meta,
      this.dom.body,
      this.dom.copyButton,
      this.dom.downloadSvgButton,
      this.chainDirectory,
      this.aliasStore,
      this.toastQueue,
      {
        onGraphCenterChange: (centerNodeId) => this.updateGraphCenterUrl(centerNodeId),
      },
    );

    this.queryCoordinator = new QueryCoordinator(
      this.client,
      { chain: this.chainDirectory },
      this.aliasStore,
      (rows, payload, meta) => this.handleResultsUpdate(rows, payload, meta),
    );
  }

  async initialize() {
    console.log("[DashboardApp] Initializing…");

    await Promise.all([this.chainDirectory.load(), this.aliasStore.load()]);

    console.log("[DashboardApp] Metadata ready");

    this.setupQueryCards();
    this.setupQuickCrawlButtons();
    this.initializeExplorerAnchors();
    this.registerGlobalHandlers();
    await this.applyExplorerLinkFromUrl({ runDefault: true });

    console.log("[DashboardApp] Ready");
  }

  setupQuickCrawlButtons() {
    const container = document.getElementById("quick-crawl-buttons");
    const section = document.getElementById("quick-crawl");
    if (!container || !section) return;

    const buttons = this.aliasStore.getQuickCrawlButtons();
    if (!buttons.length) {
      section.style.display = "none";
      return;
    }

    section.style.display = "block";
    container.innerHTML = "";

    buttons.forEach(({ oappId, name }) => {
      const button = document.createElement("button");
      button.className = "quick-crawl-button";
      button.textContent = name;
      button.dataset.oappId = oappId;
      button.type = "button";
      button.addEventListener("click", () => this.handleQuickCrawl(oappId, name));
      container.appendChild(button);
    });
  }

  async handleQuickCrawl(oappId, name) {
    const webCard = document.querySelector('[data-query-key="web-of-security"]');
    if (!webCard) return;

    const seedInput = webCard.querySelector('input[name="seedOAppId"]');
    const fileInput = webCard.querySelector('input[name="webFile"]');
    const statusEl = webCard.querySelector("[data-status]");

    if (seedInput) {
      seedInput.value = oappId;
    }
    if (fileInput) {
      fileInput.value = "";
    }

    try {
      await this.runQueryCard("web-of-security", webCard, statusEl, {
        updateUrl: true,
        scrollToResults: true,
      });
      this.toastQueue.show(`Crawling ${name}`, "success");
    } catch (error) {
      console.error("[DashboardApp] Quick crawl failed", error);
      this.toastQueue.show(error.message, "error");
    }
  }

  setupQueryCards() {
    const registry = this.queryCoordinator.buildQueryRegistry();

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
      this.queryCards.set(key, card);
      this.queryStatusNodes.set(key, statusEl);

      if (queryCode && config.query) {
        queryCode.textContent = config.query.trim();
      }

      const runQuery = async (options = {}) => {
        try {
          await this.runQueryCard(key, card, statusEl, options);
        } catch (error) {
          console.error(`[DashboardApp] Query failed: ${key}`, error);
          this.toastQueue.show(error.message, "error");
        }
      };

      runButton?.addEventListener("click", () =>
        runQuery({ updateUrl: true, scrollToResults: true }),
      );
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        runQuery({ updateUrl: true, scrollToResults: true });
      });

      if (typeof config.initialize === "function") {
        try {
          config.initialize({
            card,
            run: () => runQuery({ updateUrl: true, scrollToResults: true }),
          });
        } catch (error) {
          console.warn(`[DashboardApp] Initialize hook failed for ${key}`, error);
        }
      }
    });
  }

  async runQueryCard(key, card, statusEl, options = {}) {
    this.setActiveQueryCard(key);

    if (options.updateUrl) {
      this.updateExplorerUrlFromCard(key, card, {
        hash: options.scrollToResults ? "results" : null,
      });
    }

    const rows = await this.queryCoordinator.runQuery(key, card, statusEl);
    if (options.scrollToResults) {
      this.scrollToCurrentHash();
    }
    return rows;
  }

  handleResultsUpdate(rows, payload, meta) {
    const metaSnapshot = { ...meta };

    if (metaSnapshot.renderMode === "graph" && metaSnapshot.webData?.nodes) {
      const centerNodeId = new URLSearchParams(window.location.search).get("center");
      const hasCenterNode = centerNodeId
        ? metaSnapshot.webData.nodes.some((node) => node.id === centerNodeId)
        : false;
      if (hasCenterNode) {
        metaSnapshot.centerNodeId = centerNodeId;
      }
    }

    this.resultsView.render(rows, payload, metaSnapshot);
    this.scrollToCurrentHash();
  }

  async applyExplorerLinkFromUrl({ runDefault = false } = {}) {
    const linkedKey = this.getLinkedQueryKeyFromUrl();

    if (linkedKey && this.queryCards.has(linkedKey)) {
      const card = this.queryCards.get(linkedKey);
      const statusEl = this.queryStatusNodes.get(linkedKey);
      this.populateCardFromUrl(card);
      this.setActiveQueryCard(linkedKey);

      if (this.shouldRunLinkedQuery(linkedKey, card)) {
        await this.runQueryCard(linkedKey, card, statusEl, { updateUrl: false });
        return;
      }

      if (!this.scrollToCurrentHash()) {
        this.scrollToElement(card);
      }
      return;
    }

    if (!runDefault) {
      this.scrollToCurrentHash();
      return;
    }

    const defaultKey = EXPLORER_QUERY_KEYS.find((key) => this.queryCards.has(key));
    if (!defaultKey) {
      return;
    }

    await this.runQueryCard(
      defaultKey,
      this.queryCards.get(defaultKey),
      this.queryStatusNodes.get(defaultKey),
      {
        updateUrl: false,
      },
    );
  }

  getLinkedQueryKeyFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const queryParamKey = this.normalizeQueryKey(params.get("view") || params.get("query"));
    if (queryParamKey) {
      return queryParamKey;
    }

    const hashId = decodeURIComponent(window.location.hash.slice(1));
    if (!hashId) {
      return null;
    }

    if (hashId.startsWith("query-")) {
      return this.normalizeQueryKey(hashId.slice("query-".length));
    }

    return this.normalizeQueryKey(hashId);
  }

  normalizeQueryKey(rawKey) {
    if (!rawKey) {
      return null;
    }
    const normalized = String(rawKey).trim().toLowerCase();
    return EXPLORER_QUERY_KEYS.includes(normalized) ? normalized : null;
  }

  populateCardFromUrl(card) {
    const params = new URLSearchParams(window.location.search);
    card.querySelectorAll("input[name], select[name], textarea[name]").forEach((control) => {
      if (control instanceof HTMLInputElement && control.type === "file") {
        return;
      }

      if (params.has(control.name)) {
        control.value = params.get(control.name) ?? "";
      } else if (EXPLORER_FORM_PARAM_NAMES.has(control.name)) {
        this.resetControlToDefault(control);
      } else {
        return;
      }

      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  resetControlToDefault(control) {
    if (control instanceof HTMLSelectElement) {
      const selectedOption = Array.from(control.options).find((option) => option.defaultSelected);
      control.value = selectedOption?.value ?? control.options[0]?.value ?? "";
      return;
    }

    if (control instanceof HTMLTextAreaElement) {
      control.value = control.defaultValue || "";
      return;
    }

    if (control instanceof HTMLInputElement) {
      if (control.type === "checkbox" || control.type === "radio") {
        control.checked = control.defaultChecked;
      } else {
        control.value = control.defaultValue || "";
      }
    }
  }

  shouldRunLinkedQuery(key, card) {
    if (key === "web-of-security") {
      return Boolean(card.querySelector('input[name="seedOAppId"]')?.value?.trim());
    }

    if (key === "oapp-security-config") {
      const oappId = card.querySelector('input[name="oappId"]')?.value?.trim();
      const localEid = card.querySelector('input[name="localEid"]')?.value?.trim();
      const oappAddress = card.querySelector('input[name="oappAddress"]')?.value?.trim();
      return Boolean(oappId || (localEid && oappAddress));
    }

    return true;
  }

  updateExplorerUrlFromCard(key, card, options = {}) {
    const url = new URL(window.location.href);
    url.searchParams.delete("query");
    url.searchParams.delete("view");
    url.searchParams.delete("center");
    EXPLORER_FORM_PARAM_NAMES.forEach((name) => url.searchParams.delete(name));

    url.searchParams.set("view", key);

    card.querySelectorAll("input[name], select[name], textarea[name]").forEach((control) => {
      if (control.disabled || !EXPLORER_FORM_PARAM_NAMES.has(control.name)) {
        return;
      }
      if (control instanceof HTMLInputElement && control.type === "file") {
        return;
      }

      const value = control.value?.trim?.() ?? control.value;
      if (value !== undefined && value !== null && String(value).length > 0) {
        url.searchParams.set(control.name, value);
      }
    });

    if (options.hash) {
      url.hash = options.hash;
    }

    window.history.pushState({}, "", url);
  }

  updateGraphCenterUrl(centerNodeId) {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "web-of-security");
    if (centerNodeId) {
      url.searchParams.set("center", centerNodeId);
    } else {
      url.searchParams.delete("center");
    }
    url.hash = "results";
    window.history.replaceState({}, "", url);
  }

  setActiveQueryCard(key) {
    this.queryCards.forEach((card, cardKey) => {
      card.classList.toggle("query-card--active", cardKey === key);
    });
  }

  initializeExplorerAnchors() {
    document.querySelectorAll("[data-query-key]").forEach((card) => {
      const key = card.getAttribute("data-query-key");
      if (!card.id && key) {
        card.id = `query-${key}`;
      }
      const heading = card.querySelector("h2");
      this.appendPermalink(heading, card.id);
      this.setLinkTarget(card);
    });

    const results = document.getElementById("results");
    this.setLinkTarget(results);
    this.appendPermalink(this.dom.title, "results");

    const quickCrawl = document.getElementById("quick-crawl");
    this.setLinkTarget(quickCrawl);
  }

  appendPermalink(heading, targetId) {
    if (!heading || !targetId || heading.querySelector(".section-permalink")) {
      return;
    }

    const label = heading.textContent.trim();
    const link = document.createElement("a");
    link.className = "section-permalink";
    link.href = `#${targetId}`;
    link.textContent = "#";
    link.setAttribute("aria-label", `Link to ${label}`);
    heading.appendChild(link);
  }

  setLinkTarget(element) {
    if (element && !element.hasAttribute("tabindex")) {
      element.setAttribute("tabindex", "-1");
    }
  }

  scrollToCurrentHash() {
    const hashId = decodeURIComponent(window.location.hash.slice(1));
    if (!hashId) {
      return false;
    }

    const target = document.getElementById(hashId);
    if (!target) {
      return false;
    }

    this.scrollToElement(target);
    return true;
  }

  scrollToElement(element) {
    if (!element) {
      return;
    }

    requestAnimationFrame(() => {
      element.scrollIntoView({ block: "start" });
      if (typeof element.focus === "function") {
        element.focus({ preventScroll: true });
      }
    });
  }

  registerGlobalHandlers() {
    this.dom.copyButton?.addEventListener("click", () => {
      this.resultsView.handleCopyJson();
    });

    this.dom.downloadSvgButton?.addEventListener("click", () => {
      this.resultsView.handleDownloadSvg();
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

    window.addEventListener("hashchange", () => {
      this.scrollToCurrentHash();
    });

    window.addEventListener("popstate", () => {
      this.applyExplorerLinkFromUrl({ runDefault: false }).catch((error) => {
        console.error("[DashboardApp] Failed to apply explorer URL state", error);
      });
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

    if (mode === "bulk") {
      const cleaned = this.sanitizeAliasTargets(targets);
      if (!cleaned.length) {
        this.toastQueue.show("No eligible nodes for renaming", "info");
        return;
      }

      this.bulkAliasTargets = cleaned;
      this.aliasFields.id.value = cleaned.length === 1 ? cleaned[0] : `${cleaned.length} nodes`;
      this.aliasFields.alias.value = this.computeSharedAlias(cleaned);
      if (this.dom.aliasTitle) {
        this.dom.aliasTitle.textContent =
          cleaned.length === 1 ? this.aliasFields.defaultTitle : "Set OApp Name (All Nodes)";
      }
    } else {
      if (!target) return;
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

  computeSharedAlias(ids) {
    const aliases = ids.map((id) => this.aliasStore.get(id)).filter((v) => v && v.length);
    if (!aliases.length) return "";
    return aliases.every((a) => a === aliases[0]) ? aliases[0] : "";
  }

  closeAliasModal() {
    if (!this.dom.aliasModal || !this.dom.aliasForm) return;

    this.dom.aliasModal.classList.add("hidden");
    this.dom.aliasForm.reset();
    this.bulkAliasTargets = null;
    if (this.dom.aliasTitle) {
      this.dom.aliasTitle.textContent = this.aliasFields.defaultTitle;
    }
  }

  async handleAliasSubmit(event) {
    event.preventDefault();
    if (!this.aliasFields.id || !this.aliasFields.alias) return;

    const alias = this.aliasFields.alias.value;
    const targets = this.sanitizeAliasTargets(this.bulkAliasTargets);

    if (targets.length) {
      const entries = targets.map((id) => ({ oappId: id, alias }));
      const changed = this.aliasStore.setMany(entries);

      if (changed) {
        this.setupQuickCrawlButtons();
        await this.queryCoordinator.reprocessLastResults();
      }

      this.closeAliasModal();

      const hasAlias = alias?.trim().length > 0;
      const message = hasAlias
        ? `Applied alias to ${targets.length} node${targets.length === 1 ? "" : "s"}`
        : `Cleared ${targets.length} alias${targets.length === 1 ? "" : "es"}`;
      this.toastQueue.show(
        changed ? message : "No alias updates",
        changed ? (hasAlias ? "success" : "info") : "info",
      );
      return;
    }

    const id = this.aliasFields.id.value;
    if (id) {
      const changed = this.aliasStore.set(id, alias);
      if (changed) {
        this.setupQuickCrawlButtons();
        await this.queryCoordinator.reprocessLastResults();
      }
    }
    this.closeAliasModal();
  }

  async handleAliasFormClick(event) {
    if (!(event.target instanceof HTMLButtonElement)) return;

    const action = event.target.dataset.action;
    if (!action) {
      return;
    }

    event.preventDefault();

    if (action === "cancel") {
      this.closeAliasModal();
    } else if (action === "clear") {
      const targets = this.sanitizeAliasTargets(this.bulkAliasTargets);
      if (targets.length) {
        const entries = targets.map((id) => ({ oappId: id, alias: "" }));
        const changed = this.aliasStore.setMany(entries);
        if (changed) {
          this.setupQuickCrawlButtons();
          await this.queryCoordinator.reprocessLastResults();
        }
        this.closeAliasModal();
        this.toastQueue.show(
          changed
            ? `Cleared ${targets.length} alias${targets.length === 1 ? "" : "es"}`
            : "No alias updates",
          "info",
        );
      } else {
        const id = this.aliasFields.id?.value;
        if (id) {
          const changed = this.aliasStore.set(id, "");
          if (changed) {
            this.setupQuickCrawlButtons();
            await this.queryCoordinator.reprocessLastResults();
          }
        }
        this.closeAliasModal();
      }
    } else if (action === "export") {
      this.aliasStore.export();
    }
  }

  sanitizeAliasTargets(input) {
    const zeroAddrs = new Set([AddressUtils.constants.ZERO, AddressUtils.constants.ZERO_PEER]);
    const seen = new Set();
    const result = [];

    (Array.isArray(input) ? input : []).forEach((raw) => {
      if (!raw) return;
      const trimmed = String(raw).trim();
      if (!trimmed || seen.has(trimmed)) return;

      const parts = trimmed.split("_");
      if (parts.length < 2) return;

      const addr = parts[parts.length - 1].toLowerCase();
      if (!addr.startsWith("0x") || zeroAddrs.has(addr)) return;

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
