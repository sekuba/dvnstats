import { APP_CONFIG } from "../../config.js";
import { resolveChainDisplayLabel } from "../../core.js";
import { buildPayloadDetails } from "./ResultsPayloadDetails.js";
import { renderSummaryPanels } from "./ResultsSummaryPanels.js";
import { buildResultsTable } from "./ResultsTable.js";

export class ResultsView {
  constructor(
    resultsTitle,
    resultsMeta,
    resultsBody,
    copyJsonButton,
    chainMetadata,
    aliasStore,
    toastQueue,
  ) {
    this.resultsTitle = resultsTitle;
    this.resultsMeta = resultsMeta;
    this.resultsBody = resultsBody;
    this.copyJsonButton = copyJsonButton;
    this.chainMetadata = chainMetadata;
    this.aliasStore = aliasStore;
    this.toastQueue = toastQueue;
    this.lastRender = null;
    this.copyFeedbackTimers = new WeakMap();
  }

  render(rows, payload, meta) {
    const metaSnapshot = { ...meta };
    this.lastRender = { rows, payload, meta: metaSnapshot };

    if (this.copyJsonButton) {
      const hideCopyButton = metaSnapshot.originalLabel === "Top OApps";
      this.copyJsonButton.hidden = hideCopyButton;
      if (!hideCopyButton) {
        this.copyJsonButton.disabled =
          metaSnapshot.renderMode === "graph" ? false : rows.length === 0;
        this.copyJsonButton.textContent =
          metaSnapshot.renderMode === "graph" ? "Download JSON" : "Copy JSON";
      }
    }

    const variableHints = this.buildVariableSummary(metaSnapshot.variables);
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

    this.resultsTitle.textContent = metaSnapshot.label || "Results";
    this.resultsMeta.textContent = metaParts.join(" • ");

    if (meta.error) {
      this.renderError(meta);
      return;
    }

    if (metaSnapshot.renderMode === "graph") {
      this.renderGraph(metaSnapshot.webData);
      return;
    }

    if (metaSnapshot.renderMode === "statistics") {
      this.renderStatistics(metaSnapshot);
      return;
    }

    const summaryPanel = renderSummaryPanels(metaSnapshot, {
      aliasStore: this.aliasStore,
      getChainDisplayLabel: (chainId) => this.getChainDisplayLabel(chainId),
    });

    if (!rows.length) {
      this.resultsBody.classList.add("empty");
      this.resultsBody.innerHTML = "";
      if (summaryPanel) {
        this.resultsBody.appendChild(summaryPanel);
      }
      const placeholder = document.createElement("div");
      placeholder.className = "placeholder";
      placeholder.innerHTML = `
        <p class="placeholder-title">No rows returned</p>
        <p>Adjust filters or try again.</p>
      `;
      this.resultsBody.appendChild(placeholder);
      return;
    }

    this.resultsBody.classList.remove("empty");
    this.resultsBody.innerHTML = "";

    if (summaryPanel) {
      this.resultsBody.appendChild(summaryPanel);
    }

    const table = buildResultsTable(rows, { chainMetadata: this.chainMetadata });
    const payloadDetails = buildPayloadDetails(payload);

    this.resultsBody.appendChild(table);
    this.resultsBody.appendChild(payloadDetails);
  }

  async renderGraph(webData, centerNodeId = null) {
    this.resultsBody.classList.remove("empty");
    this.resultsBody.innerHTML = "";

    const { SecurityGraphView } = await import("../../graph/SecurityGraphView.js");
    const renderer = new SecurityGraphView({
      getOAppAlias: (oappId) => this.aliasStore.get(oappId),
      getChainDisplayLabel: (chainId) => this.getChainDisplayLabel(chainId),
      requestUniformAlias: (ids) => {
        if (!Array.isArray(ids) || !ids.length) {
          return;
        }
        const uniqueIds = Array.from(
          new Set(
            ids.map((id) => (id === null || id === undefined ? null : String(id))).filter(Boolean),
          ),
        );
        if (!uniqueIds.length) {
          return;
        }
        const event = new CustomEvent("alias:rename-all", {
          detail: {
            oappIds: uniqueIds,
            source: "web-of-security",
          },
        });
        document.dispatchEvent(event);
      },
    });

    renderer.onRecenter = (newCenterNodeId) => {
      this.renderGraph(webData, newCenterNodeId);
    };

    const graphContainer = renderer.render(webData, { centerNodeId });
    this.resultsBody.appendChild(graphContainer);
  }

  async renderStatistics(meta) {
    this.resultsBody.classList.remove("empty");
    this.resultsBody.innerHTML = "";

    const { StatisticsView } = await import("./StatisticsView.js");
    const statistics = meta.statistics;

    if (!statistics) {
      this.renderError({ error: "Statistics data missing" });
      return;
    }

    StatisticsView.render(
      this.resultsBody,
      statistics,
      meta,
      this.aliasStore,
      (addresses, localEid) => {
        // DVN label resolution (currently unused but available for future enhancement)
        return addresses;
      },
    );
  }

  getChainDisplayLabel(chainId) {
    return resolveChainDisplayLabel(this.chainMetadata, chainId);
  }

  renderError(meta) {
    this.copyJsonButton.disabled = true;
    this.resultsBody.classList.remove("empty");
    this.resultsBody.innerHTML = "";

    const template = document.getElementById("error-template");
    const node = template.content.cloneNode(true);
    node.querySelector("[data-error-message]").textContent = meta.error;
    this.resultsBody.appendChild(node);
  }

  buildVariableSummary(variables = {}) {
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

  async handleCopyableClick(event) {
    const target = event.target.closest(".copyable");
    if (!target || !this.resultsBody.contains(target)) {
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
      this.flashCopyFeedback(target, true);
      this.toastQueue.show("Copied", "success");
    } catch (error) {
      console.error("Copy failed", error);
      this.flashCopyFeedback(target, false);
      this.toastQueue.show("Copy failed", "error");
    }
  }

  flashCopyFeedback(element, didSucceed) {
    element.classList.remove("copied", "copy-failed");
    element.classList.add(didSucceed ? "copied" : "copy-failed");

    const existing = this.copyFeedbackTimers.get(element);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(
      () => {
        element.classList.remove("copied", "copy-failed");
        this.copyFeedbackTimers.delete(element);
      },
      didSucceed ? APP_CONFIG.FEEDBACK.COPY_DURATION : APP_CONFIG.FEEDBACK.COPY_DURATION + 400,
    );
    this.copyFeedbackTimers.set(element, timeout);
  }

  async handleCopyJson() {
    const isGraphMode = this.lastRender?.meta?.renderMode === "graph";
    const webData = this.lastRender?.meta?.webData;

    if (isGraphMode && webData) {
      const dataStr = JSON.stringify(webData, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `web-of-security-${webData.seed || "data"}-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.flashButtonFeedback(this.copyJsonButton, "Downloaded!");
      return;
    }

    const source = this.lastRender?.payload?.data ?? this.lastRender?.rows ?? [];
    if (!source || (Array.isArray(source) && !source.length)) {
      return;
    }

    const payload = JSON.stringify(source, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      this.flashButtonFeedback(this.copyJsonButton, "Copied!");
    } catch (error) {
      console.error("Clipboard copy failed", error);
      this.flashButtonFeedback(this.copyJsonButton, "Copy failed");
    }
  }

  flashButtonFeedback(button, label) {
    const original = button.textContent;
    button.textContent = label;
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = this.lastRender?.rows?.length === 0;
    }, APP_CONFIG.FEEDBACK.BUTTON_DURATION);
  }
}
