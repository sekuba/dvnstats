/**
 * Results renderer
 */

import { APP_CONFIG } from "../../config.js";
import {
  formatTimestampValue,
  looksLikeEidColumn,
  looksLikeHash,
  looksLikeTimestampColumn,
  stringifyScalar,
  resolveChainDisplayLabel,
} from "../../core.js";
import {
  createFormattedCell,
  formatRouteActivityLine,
} from "../../formatters/cellFormatters.js";

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

    const summaryPanel = this.renderSummaryPanel(metaSnapshot);

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

    const table = this.buildTable(rows);
    const payloadDetails = this.buildPayloadDetails(payload);

    this.resultsBody.appendChild(table);
    this.resultsBody.appendChild(payloadDetails);
  }

  async renderGraph(webData, centerNodeId = null) {
    this.resultsBody.classList.remove("empty");
    this.resultsBody.innerHTML = "";

    const { SecurityGraphView } = await import("../../graph.js");
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

    // Set up recenter callback
    renderer.onRecenter = (newCenterNodeId) => {
      this.renderGraph(webData, newCenterNodeId);
    };

    const graphContainer = renderer.render(webData, { centerNodeId });
    this.resultsBody.appendChild(graphContainer);
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

  buildTable(rows) {
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
        this.renderCell(td, column, row[column]);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    return table;
  }

  renderCell(td, column, value) {
    const { nodes, copyValue, isCopyable, meta, highlight } = this.interpretValue(column, value);

    td.classList.remove("meter-cell");
    td.style.removeProperty("--meter-fill");

    const metaObject = meta && typeof meta === "object" ? { ...meta } : null;

    let meterPercent = null;
    if (metaObject && typeof metaObject.meterPercent === "number") {
      const clamped = Math.max(0, Math.min(1, metaObject.meterPercent));
      if (clamped > 0) {
        meterPercent = clamped;
        td.classList.add("meter-cell");
        td.style.setProperty("--meter-fill", clamped.toFixed(4));
      }
      delete metaObject.meterPercent;
    }

    if (!isCopyable) {
      const fragment = document.createDocumentFragment();
      nodes.forEach((node) => fragment.append(node));
      td.appendChild(fragment);
      return;
    }

    const container = document.createElement("div");
    container.className = "copyable";
    if (highlight) {
      container.classList.add("cell-variant");
    }

    const content =
      copyValue ??
      nodes
        .map((node) => node.textContent ?? "")
        .join(" ")
        .trim();
    if (content) {
      container.dataset.copyValue = content;
    }

    if (metaObject) {
      if (metaObject.oappId) {
        container.dataset.oappId = metaObject.oappId;
      }
      if (metaObject.localEid) {
        container.dataset.localEid = metaObject.localEid;
      }
    }

    nodes.forEach((node) => container.append(node));
    td.appendChild(container);
  }

  interpretValue(column, value) {
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
        highlight: value.highlight || false,
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

    if (looksLikeEidColumn(column)) {
      const chainInfo = this.chainMetadata.getChainInfo(value);
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

  buildPayloadDetails(payload) {
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

  renderSummaryPanel(meta) {
    if (!meta) return null;

    const container = document.createElement("div");
    container.className = "summary-panels";

    // Group OApp-related panels in a row
    const oappPanels = [];
    if (meta.oappInfo) {
      oappPanels.push(this.renderOAppSummary(meta));
    }
    if (meta.securitySummary) {
      const securityPanel = this.renderSecuritySummary(meta.securitySummary);
      if (securityPanel) {
        oappPanels.push(securityPanel);
      }
    }
    if (meta.routeStats && meta.routeStats.length > 0) {
      oappPanels.push(this.renderRouteStatsSummary(meta.routeStats));
    }
    if (meta.rateLimiter || (meta.rateLimits && meta.rateLimits.length > 0)) {
      oappPanels.push(this.renderRateLimitingSummary(meta));
    }

    // If we have OApp panels, put them in a row
    if (oappPanels.length > 0) {
      const oappRow = document.createElement("div");
      oappRow.className = "summary-panel-row";
      oappPanels.filter(Boolean).forEach((panel) => oappRow.appendChild(panel));
      container.appendChild(oappRow);
    }

    // Popular OApps summary goes on its own row
    if (meta.popularOappsSummary) {
      const popularPanel = this.renderPopularOappsSummary(meta.popularOappsSummary);
      if (popularPanel) {
        const popularRow = document.createElement("div");
        popularRow.className = "summary-panel-row";
        popularRow.appendChild(popularPanel);
        container.appendChild(popularRow);
      }
    }

    return container.children.length > 0 ? container : null;
  }

  renderOAppSummary(meta) {
    const info = meta?.oappInfo;
    if (!info) return null;

    const panel = document.createElement("div");
    panel.className = "summary-panel";

    const heading = document.createElement("h3");
    heading.textContent = "OApp Overview";
    panel.appendChild(heading);

    const list = document.createElement("dl");
    panel.appendChild(list);

    const alias = this.aliasStore.get(info.id);
    if (alias) {
      this.appendSummaryRow(list, "OApp Alias", alias);
    }
    this.appendSummaryRow(list, "OApp ID", info.id ?? "");
    const localEid =
      info.localEid !== undefined && info.localEid !== null ? String(info.localEid) : "—";
    const localLabel = meta.chainLabel || this.getChainDisplayLabel(localEid) || `EID ${localEid}`;
    this.appendSummaryRow(list, "Local EID", `${localLabel}`);
    // Native chain ids removed; local EIDs provide canonical context.
    this.appendSummaryRow(list, "Address", info.address ?? "");
    if (info.totalPacketsReceived !== undefined && info.totalPacketsReceived !== null) {
      this.appendSummaryRow(list, "Total Packets", String(info.totalPacketsReceived));
    }
    if (info.lastPacketBlock !== undefined && info.lastPacketBlock !== null) {
      this.appendSummaryRow(list, "Last Packet Block", String(info.lastPacketBlock));
    }
    if (info.lastPacketTimestamp !== undefined && info.lastPacketTimestamp !== null) {
      const ts = formatTimestampValue(info.lastPacketTimestamp);
      if (ts) {
        this.appendSummaryRow(list, "Last Packet Time", ts.primary);
      }
    }

    return panel;
  }

  renderRouteStatsSummary(routeStats) {
    if (!routeStats || routeStats.length === 0) return null;

    const panel = document.createElement("div");
    panel.className = "summary-panel";

    const heading = document.createElement("h3");
    heading.textContent = "Per-Route Activity";
    panel.appendChild(heading);

    const list = document.createElement("dl");
    panel.appendChild(list);

    this.appendSummaryRow(list, "Total Routes", routeStats.length);

    // Show top 5 routes by packet count
    const topRoutes = routeStats.slice(0, 5);
    topRoutes.forEach((route, idx) => {
      const chainLabel = this.getChainDisplayLabel(route.srcEid) || `EID ${route.srcEid}`;
      this.appendSummaryRow(
        list,
        idx === 0 ? "Top Routes" : " ",
        `${chainLabel}: ${route.packetCount} packets`,
      );
    });

    if (routeStats.length > 5) {
      this.appendSummaryRow(list, " ", `... and ${routeStats.length - 5} more routes`);
    }

    return panel;
  }

  renderSecuritySummary(summary) {
    if (!summary) return null;

    const panel = document.createElement("div");
    panel.className = "summary-panel";

    const heading = document.createElement("h3");
    heading.textContent = "Security Snapshot";
    panel.appendChild(heading);

    const list = document.createElement("dl");
    panel.appendChild(list);

    const totalRoutes = summary.totalRoutes ?? 0;
    const syntheticCount = summary.syntheticCount ?? 0;
    const implicitBlocks = summary.implicitBlocks ?? 0;
    const explicitBlocks = summary.explicitBlocks ?? 0;
    const blockedTotal = implicitBlocks + explicitBlocks;

    this.appendSummaryRow(list, "Routes analyzed", totalRoutes);

    if (syntheticCount > 0) {
      this.appendSummaryRow(list, "Using defaults", syntheticCount);
    }

    if (blockedTotal > 0) {
      const blockedLabel =
        implicitBlocks > 0 && explicitBlocks > 0
          ? `${blockedTotal} (implicit ${implicitBlocks} • explicit ${explicitBlocks})`
          : implicitBlocks > 0
            ? `${blockedTotal} (implicit)`
            : `${blockedTotal} (explicit)`;
      this.appendSummaryRow(list, "Blocked routes", blockedLabel);
    }

    return panel;
  }

  renderRateLimitingSummary(meta) {
    const rateLimiter = meta.rateLimiter;
    const rateLimits = meta.rateLimits || [];

    const panel = document.createElement("div");
    panel.className = "summary-panel";

    const heading = document.createElement("h3");
    heading.textContent = "Rate Limiting (OFT)";
    panel.appendChild(heading);

    const list = document.createElement("dl");
    panel.appendChild(list);

    if (rateLimiter && rateLimiter.rateLimiter) {
      this.appendSummaryRow(list, "Rate Limiter", rateLimiter.rateLimiter);
    } else {
      this.appendSummaryRow(list, "Rate Limiter", "Not configured");
    }

    this.appendSummaryRow(list, "Rate Limits", rateLimits.length);

    if (rateLimits.length > 0) {
      // Show up to 5 rate limits
      const displayLimits = rateLimits.slice(0, 5);
      displayLimits.forEach((limit, idx) => {
        const chainLabel = this.getChainDisplayLabel(limit.dstEid) || `EID ${limit.dstEid}`;
        const windowHours = Number(limit.window) / 3600;
        this.appendSummaryRow(
          list,
          idx === 0 ? "Limits" : " ",
          `${chainLabel}: ${limit.limit} per ${windowHours}h`,
        );
      });

      if (rateLimits.length > 5) {
        this.appendSummaryRow(list, " ", `... and ${rateLimits.length - 5} more limits`);
      }
    }

    return panel;
  }

  renderPopularOappsSummary(summary) {
    if (!summary) return null;

    const panel = document.createElement("div");
    panel.className = "summary-panel";

    const heading = document.createElement("h3");
    heading.textContent = "Window Overview";
    panel.appendChild(heading);

    const list = document.createElement("dl");
    panel.appendChild(list);

    this.appendSummaryRow(list, "Window", summary.windowLabel || "");

    if (summary.fromTimestamp) {
      const fromTs = formatTimestampValue(summary.fromTimestamp);
      if (fromTs) {
        this.appendSummaryRow(list, "From", fromTs.primary);
      }
    }

    if (summary.toTimestamp) {
      const toTs = formatTimestampValue(summary.toTimestamp);
      if (toTs) {
        this.appendSummaryRow(list, "To", toTs.primary);
      }
    }

    this.appendSummaryRow(list, "Packets Scanned", summary.sampledPackets);
    this.appendSummaryRow(list, "Unique OApps", summary.totalOapps);
    this.appendSummaryRow(list, "Results Returned", summary.returnedCount);
    this.appendSummaryRow(list, "Sample Limit", summary.fetchLimit);

    return panel;
  }

  appendSummaryRow(list, label, value) {
    if (!value && value !== 0) return;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    list.append(dt, dd);
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
