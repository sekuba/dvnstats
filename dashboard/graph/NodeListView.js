import { AddressUtils } from "../utils/AddressUtils.js";
import { ensureArray } from "../utils/NumberUtils.js";
import { DomBuilder } from "../utils/dom/DomBuilder.js";
import { NodeMetricsCalculator } from "./node-list/NodeMetricsCalculator.js";
import { appendSummaryRow, describeCombination, shortenAddress } from "./utils.js";

export class NodeListView {
  constructor({ getOAppAlias, formatChainLabel, areStringArraysEqual, requestUniformAlias }) {
    this.metricsCalculator = new NodeMetricsCalculator({
      getOAppAlias,
      formatChainLabel,
      areStringArraysEqual,
    });
    this.getOAppAlias = typeof getOAppAlias === "function" ? getOAppAlias : () => null;
    this.formatChainLabel = typeof formatChainLabel === "function" ? formatChainLabel : () => "";
    this.shortenAddress = shortenAddress;
    this.appendSummaryRow = appendSummaryRow;
    this.describeCombination = describeCombination;
    this.requestUniformAlias = requestUniformAlias;
  }

  renderNodeList(webData, analysis = {}) {
    const nodes = ensureArray(webData?.nodes);
    const container = DomBuilder.section({ className: "node-detail-board", style: { marginTop: "2rem" } });

    container.appendChild(DomBuilder.h3({ textContent: "Node Security Highlights" }));

    let renameActions = null;

    if (!nodes.length) {
      container.appendChild(DomBuilder.p({ textContent: "No nodes returned by the crawl." }));
      return container;
    }

    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const metricsById = new Map();

    const blockedNodes =
      analysis?.blockedNodes instanceof Set
        ? analysis.blockedNodes
        : new Set(ensureArray(analysis?.blockedNodes));

    const edgeSecurityInfo = ensureArray(analysis?.edgeSecurityInfo);
    const dominantCombination = analysis?.dominantCombination || null;

    // Use NodeMetricsCalculator to compute all metrics
    const nodeMetrics = this.metricsCalculator.calculateNodeMetrics(
      nodes,
      edgeSecurityInfo,
      blockedNodes,
      dominantCombination,
    );

    nodeMetrics.forEach((metric) => metricsById.set(metric.id, metric));

    // Handle rename actions for uniform aliasing
    if (this.requestUniformAlias && nodeMetrics.length) {
      const zeroAddresses = new Set([
        AddressUtils.constants.ZERO,
        AddressUtils.constants.ZERO_PEER,
      ]);
      const renameTargets = [];
      const seenRenameTargets = new Set();

      for (const metric of nodeMetrics) {
        if (!metric || typeof metric.id !== "string") {
          continue;
        }
        const trimmedId = metric.id.trim();
        if (!trimmedId || seenRenameTargets.has(trimmedId)) {
          continue;
        }
        const parts = trimmedId.split("_");
        if (parts.length < 2) {
          continue;
        }
        const rawAddr = parts[parts.length - 1];
        const addr = AddressUtils.normalizeSafe(rawAddr) || "";
        if (!addr.startsWith("0x")) {
          continue;
        }
        if (zeroAddresses.has(addr)) {
          continue;
        }
        const nodeAddr = AddressUtils.normalizeSafe(metric.node?.address) || "";
        if (zeroAddresses.has(nodeAddr)) {
          continue;
        }
        seenRenameTargets.add(trimmedId);
        renameTargets.push(trimmedId);
      }

      if (renameTargets.length) {
        renameActions = document.createElement("div");
        renameActions.className = "summary-actions node-actions";
        const renameButton = document.createElement("button");
        renameButton.type = "button";
        renameButton.textContent = "Rename All Nodes";
        renameButton.title =
          "Set a shared alias for every node in this crawl (excludes zero-peer sentinels)";
        renameButton.addEventListener("click", () => {
          if (!Array.isArray(renameTargets) || !renameTargets.length) {
            return;
          }
          this.requestUniformAlias([...renameTargets]);
        });
        renameActions.appendChild(renameButton);
      }
    }

    const formatNodeDescriptor = (metric) => {
      if (!metric) {
        return "";
      }
      const alias = metric.alias || metric.id;
      return `${alias} (${metric.chainLabel})`;
    };

    const formatNodeShort = (id) => {
      if (!id) {
        return "";
      }
      const metric = metricsById.get(id);
      if (metric) {
        return metric.alias || metric.id;
      }
      const alias = this.getOAppAlias(id);
      return alias || id;
    };

    const formatRoute = (info) => {
      const from = formatNodeShort(info.edge.from);
      const to = formatNodeShort(info.edge.to);
      return `${from} → ${to}`;
    };

    const eligibleNodes = nodeMetrics.filter((metric) => metric.isTracked && !metric.isBlocked);

    const computeMedian = (values) => {
      const filtered = [];
      for (const value of values) {
        const numeric = typeof value === "number" ? value : isNullish(value) ? NaN : Number(value);
        if (Number.isFinite(numeric)) {
          filtered.push(numeric);
        }
      }
      if (!filtered.length) {
        return 0;
      }
      const sorted = [...filtered].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
      }
      return sorted[mid];
    };

    const pickExtremes = (metrics, accessor, medianValue) => {
      let low = null;
      let lowDelta = -1;
      let high = null;
      let highDelta = -1;
      for (const metric of metrics) {
        const value = accessor(metric);
        const diff = value - medianValue;
        const absDiff = Math.abs(diff);
        if (diff <= 0 && absDiff >= lowDelta) {
          low = metric;
          lowDelta = absDiff;
        }
        if (diff >= 0 && absDiff >= highDelta) {
          high = metric;
          highDelta = absDiff;
        }
      }
      return { low, high };
    };

    const collectExtremes = (extremes, accessor) => {
      const lows = [];
      const highs = [];
      const lowValue = accessor(extremes.low);
      const highValue = accessor(extremes.high);

      if (extremes.low && extremes.high && lowValue !== highValue) {
        for (const metric of eligibleNodes) {
          const value = accessor(metric);
          if (value === lowValue) {
            lows.push(metric.id);
          }
          if (value === highValue) {
            highs.push(metric.id);
          }
        }
      }

      return {
        lows,
        highs,
        variation: lows.length > 0 || highs.length > 0,
      };
    };

    const edgeMedian = computeMedian(eligibleNodes.map((metric) => metric.activeIncomingCount));
    const packetMedian = computeMedian(eligibleNodes.map((metric) => metric.totalPackets));
    const edgeExtremes = pickExtremes(
      eligibleNodes,
      (metric) => metric.activeIncomingCount,
      edgeMedian,
    );
    const packetExtremes = pickExtremes(
      eligibleNodes,
      (metric) => metric.totalPackets,
      packetMedian,
    );

    const formatMedianValue = (value) => {
      if (!Number.isFinite(value)) {
        return "—";
      }
      const rounded = Math.round(value * 10) / 10;
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    };

    const formatNumber = (value) => Number(value || 0).toLocaleString("en-US");

    const {
      lows: edgeLows,
      highs: edgeHighs,
      variation: hasEdgeVariation,
    } = collectExtremes(edgeExtremes, (metric) => metric?.activeIncomingCount);
    const {
      lows: packetLows,
      highs: packetHighs,
      variation: hasPacketVariation,
    } = collectExtremes(packetExtremes, (metric) => metric?.totalPackets);

    this.renderInsightsGrid(
      container,
      dominantCombination,
      nodeMetrics,
      eligibleNodes,
      edgeMedian,
      packetMedian,
      edgeExtremes,
      packetExtremes,
      hasEdgeVariation,
      hasPacketVariation,
      formatNodeDescriptor,
      formatNodeShort,
      formatRoute,
      formatMedianValue,
      formatNumber,
    );

    this.renderNodeTable(
      container,
      nodeMetrics,
      renameActions,
      edgeLows,
      edgeHighs,
      hasEdgeVariation,
      packetLows,
      packetHighs,
      hasPacketVariation,
      formatNumber,
    );

    return container;
  }

  renderInsightsGrid(
    container,
    dominantCombination,
    nodeMetrics,
    eligibleNodes,
    edgeMedian,
    packetMedian,
    edgeExtremes,
    packetExtremes,
    hasEdgeVariation,
    hasPacketVariation,
    formatNodeDescriptor,
    formatNodeShort,
    formatRoute,
    formatMedianValue,
    formatNumber,
  ) {
    const insightGrid = document.createElement("div");
    insightGrid.className = "node-insight-grid";
    container.appendChild(insightGrid);

    const dominantCard = document.createElement("div");
    dominantCard.className = "insight-card";
    const domTitle = document.createElement("h4");
    domTitle.textContent = "Dominant DVN Set";
    dominantCard.appendChild(domTitle);

    if (dominantCombination) {
      const lead = document.createElement("p");
      lead.className = "insight-lead";
      lead.textContent = this.describeCombination(dominantCombination);
      dominantCard.appendChild(lead);

      const dl = document.createElement("dl");
      dl.className = "insight-list";
      const shareText =
        typeof dominantCombination.share === "number"
          ? ` (${(dominantCombination.share * 100).toFixed(1)}%)`
          : "";
      this.appendSummaryRow(dl, "Edges Using Set", `${dominantCombination.count}${shareText}`);

      const destIds = Array.from(dominantCombination.toNodes || []);
      if (destIds.length) {
        const sample = destIds
          .slice(0, 3)
          .map((id) => formatNodeShort(id))
          .join(", ");
        const destinations =
          destIds.length > 3
            ? `${destIds.length} nodes (${sample}, ...)`
            : `${destIds.length} node${destIds.length === 1 ? "" : "s"} (${sample})`;
        this.appendSummaryRow(dl, "Destination Nodes", destinations);
      }

      const chains = Array.from(dominantCombination.srcEids || []).map(
        (localEid) => this.formatChainLabel(localEid) || localEid,
      );
      this.appendSummaryRow(dl, "Source Chains", chains.length ? chains.join(", ") : "—");

      const routeExamples = dominantCombination.edges
        ? dominantCombination.edges.slice(0, 3).map((info) => formatRoute(info))
        : [];
      if (routeExamples.length) {
        const routes =
          routeExamples.length >= 3 &&
          dominantCombination.edges &&
          dominantCombination.edges.length > 3
            ? `${routeExamples.join("; ")}, ...`
            : routeExamples.join("; ");
        this.appendSummaryRow(dl, "Sample Routes", routes);
      }

      dominantCard.appendChild(dl);
    } else {
      const empty = document.createElement("p");
      empty.textContent = "No dominant DVN set detected.";
      dominantCard.appendChild(empty);
    }

    insightGrid.appendChild(dominantCard);

    this.renderAnomaliesCard(insightGrid, nodeMetrics, formatNodeDescriptor);

    this.renderStatsCard(
      insightGrid,
      eligibleNodes,
      edgeMedian,
      packetMedian,
      edgeExtremes,
      packetExtremes,
      hasEdgeVariation,
      hasPacketVariation,
      formatNodeDescriptor,
      formatMedianValue,
      formatNumber,
    );
  }

  renderAnomaliesCard(insightGrid, nodeMetrics, formatNodeDescriptor) {
    const anomaliesCard = document.createElement("div");
    anomaliesCard.className = "insight-card insight-card--alert";
    const anomaliesTitle = document.createElement("h4");
    anomaliesTitle.textContent = "Special Cases";
    anomaliesCard.appendChild(anomaliesTitle);

    const anomalyContainer = document.createElement("div");
    anomalyContainer.className = "anomaly-groups";
    anomaliesCard.appendChild(anomalyContainer);

    const appendAnomalyGroup = (label, items) => {
      if (!items.length) {
        return;
      }
      const group = document.createElement("div");
      group.className = "anomaly-group";
      const groupTitle = document.createElement("h5");
      groupTitle.textContent = label;
      group.appendChild(groupTitle);

      const list = document.createElement("ul");
      list.className = "anomaly-list";
      items.forEach((item) => {
        const li = document.createElement("li");
        const nodeSpan = document.createElement("span");
        nodeSpan.className = "anomaly-node";
        nodeSpan.textContent = formatNodeDescriptor(item.metric);
        li.appendChild(nodeSpan);
        if (item.detail) {
          const detailSpan = document.createElement("span");
          detailSpan.className = "anomaly-detail";
          detailSpan.textContent = item.detail;
          li.appendChild(detailSpan);
        }
        list.appendChild(li);
      });

      group.appendChild(list);
      anomalyContainer.appendChild(group);
    };

    const blockedItems = nodeMetrics
      .filter((metric) => metric.isBlocked || metric.blockReasons.length)
      .map((metric) => {
        const detail = metric.blockReasons.length
          ? metric.blockReasons.join("; ")
          : "All inbound edges blocked";
        return {
          metric,
          detail: metric.isBlocked ? detail : `Blocked route: ${detail}`,
        };
      });
    appendAnomalyGroup("Blocked", blockedItems);

    const variantItems = nodeMetrics
      .filter(
        (metric) => metric.hasConfigDifference && !metric.isBlocked && !metric.blockReasons.length,
      )
      .map((metric) => ({
        metric,
        detail: metric.diffReasonSummary.length
          ? metric.diffReasonSummary.join("; ")
          : "DVN set differs from dominant",
      }));
    appendAnomalyGroup("Non-standard DVNs", variantItems);

    const sentinelItems = nodeMetrics
      .filter((metric) => metric.hasSentinel)
      .map((metric) => {
        const quorumNotes = metric.configDetails
          .filter((detail) => detail.usesSentinel || detail.optionalSummary)
          .map((detail) => {
            const eidText = isDefined(detail.srcEid) ? `EID ${detail.srcEid}: ` : "";
            return `${eidText}${detail.optionalSummary ? `quorum ${detail.optionalSummary}` : "sentinel"}`;
          });
        return {
          metric,
          detail: quorumNotes.length ? quorumNotes.join("; ") : "Optional-only quorum",
        };
      });
    appendAnomalyGroup("Sentinel DVNs", sentinelItems);

    const fromPacketItems = nodeMetrics
      .filter((metric) => metric.fromPacketDelivered)
      .map((metric) => ({
        metric,
        detail: "Inferred from packet (no peer info)",
      }));
    appendAnomalyGroup("From Packet", fromPacketItems);

    if (!anomalyContainer.childElementCount) {
      const emptyAnomaly = document.createElement("p");
      emptyAnomaly.textContent = "No anomalies detected in this crawl.";
      anomalyContainer.appendChild(emptyAnomaly);
    }

    insightGrid.appendChild(anomaliesCard);
  }

  renderStatsCard(
    insightGrid,
    eligibleNodes,
    edgeMedian,
    packetMedian,
    edgeExtremes,
    packetExtremes,
    hasEdgeVariation,
    hasPacketVariation,
    formatNodeDescriptor,
    formatMedianValue,
    formatNumber,
  ) {
    const statsCard = document.createElement("div");
    statsCard.className = "insight-card";
    const statsTitle = document.createElement("h4");
    statsTitle.textContent = "Connectivity Stats";
    statsCard.appendChild(statsTitle);

    const statsList = document.createElement("dl");
    statsList.className = "insight-list";
    this.appendSummaryRow(
      statsList,
      "Median inbound edges",
      eligibleNodes.length ? formatMedianValue(edgeMedian) : "—",
    );
    if (hasEdgeVariation && edgeExtremes.low) {
      this.appendSummaryRow(
        statsList,
        "Lowest connectivity",
        `${formatNodeDescriptor(edgeExtremes.low)} • ${edgeExtremes.low.activeIncomingCount}`,
      );
    }
    if (hasEdgeVariation && edgeExtremes.high) {
      this.appendSummaryRow(
        statsList,
        "Highest connectivity",
        `${formatNodeDescriptor(edgeExtremes.high)} • ${edgeExtremes.high.activeIncomingCount}`,
      );
    }
    this.appendSummaryRow(
      statsList,
      "Median packets",
      eligibleNodes.length ? formatMedianValue(packetMedian) : "—",
    );
    if (hasPacketVariation && packetExtremes.low) {
      this.appendSummaryRow(
        statsList,
        "Lightest traffic",
        `${formatNodeDescriptor(packetExtremes.low)} • ${formatNumber(packetExtremes.low.totalPackets)}`,
      );
    }
    if (hasPacketVariation && packetExtremes.high) {
      this.appendSummaryRow(
        statsList,
        "Heaviest traffic",
        `${formatNodeDescriptor(packetExtremes.high)} • ${formatNumber(packetExtremes.high.totalPackets)}`,
      );
    }

    statsCard.appendChild(statsList);
    insightGrid.appendChild(statsCard);
  }

  renderNodeTable(
    container,
    nodeMetrics,
    renameActions,
    edgeLows,
    edgeHighs,
    hasEdgeVariation,
    packetLows,
    packetHighs,
    hasPacketVariation,
    formatNumber,
  ) {
    const createBadge = (label, tone = "default", tooltip = null) => {
      const span = document.createElement("span");
      span.className = `badge badge--${tone}`;
      span.textContent = label;
      if (tooltip) {
        span.title = tooltip;
      }
      return span;
    };

    const table = document.createElement("table");
    table.className = "node-detail-table";
    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>Node</th>
        <th>DVN Configs</th>
        <th>Optional Quorum</th>
        <th>Inbound Edges</th>
        <th>Packets</th>
        <th>Notes</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    nodeMetrics.forEach((metric) => {
      const tr = this.renderNodeRow(
        metric,
        edgeLows,
        edgeHighs,
        hasEdgeVariation,
        packetLows,
        packetHighs,
        hasPacketVariation,
        createBadge,
        formatNumber,
      );
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    if (renameActions) {
      container.appendChild(renameActions);
    }
    container.appendChild(table);
  }

  renderNodeRow(
    metric,
    edgeLows,
    edgeHighs,
    hasEdgeVariation,
    packetLows,
    packetHighs,
    hasPacketVariation,
    createBadge,
    formatNumber,
  ) {
    const tr = document.createElement("tr");
    if (metric.isBlocked) {
      tr.classList.add("row-blocked");
    }
    if (!metric.isTracked) {
      tr.classList.add("row-untracked");
    }
    if (metric.hasConfigDifference) {
      tr.classList.add("row-variant");
    }

    // Node cell
    const nodeCell = document.createElement("td");
    const nodeBlock = document.createElement("div");
    nodeBlock.className = "node-identity";
    const nodeInfo = document.createElement("span");
    nodeInfo.className = "node-id copyable";
    nodeInfo.dataset.copyValue = metric.id;
    nodeInfo.dataset.oappId = metric.id;
    if (metric.alias) {
      const aliasLine = document.createElement("span");
      aliasLine.className = "node-alias";
      aliasLine.textContent = metric.alias;
      nodeInfo.appendChild(aliasLine);
    }

    const chainLine = document.createElement("span");
    chainLine.className = "node-id-chain";
    chainLine.textContent = metric.chainLabel;
    nodeInfo.appendChild(chainLine);

    const idLine = document.createElement("span");
    idLine.className = "node-id-value";
    idLine.textContent = metric.id;
    nodeInfo.appendChild(idLine);

    nodeBlock.appendChild(nodeInfo);
    nodeCell.appendChild(nodeBlock);
    tr.appendChild(nodeCell);

    // Config cell
    const configCell = this.renderConfigCell(metric);
    tr.appendChild(configCell);

    // Optional cell
    const optionalCell = this.renderOptionalCell(metric);
    tr.appendChild(optionalCell);

    // Edges cell
    const edgesCell = this.renderEdgesCell(metric, edgeLows, edgeHighs, hasEdgeVariation);
    tr.appendChild(edgesCell);

    // Packets cell
    const packetsCell = document.createElement("td");
    packetsCell.className = "metric-cell";
    packetsCell.textContent = formatNumber(metric.totalPackets);
    if (hasPacketVariation && metric.isTracked && !metric.isBlocked) {
      if (packetLows.includes(metric.id)) {
        packetsCell.classList.add("cell-extreme-low");
      } else if (packetHighs.includes(metric.id)) {
        packetsCell.classList.add("cell-extreme-high");
      }
    }
    tr.appendChild(packetsCell);

    // Notes cell
    const notesCell = this.renderNotesCell(metric, createBadge);
    tr.appendChild(notesCell);

    return tr;
  }

  renderConfigCell(metric) {
    const configCell = document.createElement("td");
    configCell.className = "config-cell";
    if (!metric.configDetails.length) {
      configCell.textContent = "—";
    } else {
      const stack = document.createElement("div");
      stack.className = "config-stack";

      const standardGroups = new Map();
      const variantDetails = [];

      const isMissingConfig = (detail) => {
        if (!detail) {
          return false;
        }
        const usesDefaultLibrary = detail.usesDefaultLibrary !== false;
        const hasLibraryOverride =
          detail.libraryOverrideVersionId !== null && detail.libraryOverrideVersionId !== undefined;
        const effectiveLibrary = detail.effectiveReceiveLibrary || null;
        const hasEffectiveLibrary =
          !!(effectiveLibrary) && !AddressUtils.isZero(effectiveLibrary);
        return (
          usesDefaultLibrary &&
          !hasLibraryOverride &&
          detail.libraryStatus === "none" &&
          !hasEffectiveLibrary
        );
      };

      const describeRequiredLabel = (detail) => {
        if (!detail) {
          return "—";
        }
        if (isMissingConfig(detail)) {
          return "no config";
        }
        const count = Number.isFinite(detail.requiredDVNCount) ? detail.requiredDVNCount : 0;
        return `${count} required`;
      };

      metric.configDetails.forEach((detail) => {
        if (detail.matchesDominant && !detail.usesSentinel && !detail.differsFromDominant) {
          const key = detail.fingerprint || "dominant";
          if (!standardGroups.has(key)) {
            standardGroups.set(key, {
              count: 0,
              eids: [],
              sample: detail,
            });
          }
          const group = standardGroups.get(key);
          group.count += 1;
          if (isDefined(detail.srcEid)) {
            group.eids.push(detail.srcEid);
          }
        } else {
          variantDetails.push(detail);
        }
      });

      const renderDvns = (detail, container) => {
        const safePairs = ensureArray(detail?.requiredPairs);
        if (safePairs.length) {
          const list = document.createElement("div");
          list.className = "dvn-pill-row";
          safePairs.forEach((pair) => {
            const pill = document.createElement("span");
            pill.className = "dvn-pill copyable";
            const copyValue = pair.address || pair.label;
            pill.dataset.copyValue = copyValue || "";
            pill.title = pair.address || pair.label;
            pill.textContent =
              pair.label || (pair.address ? this.shortenAddress(pair.address) : "—");
            list.appendChild(pill);
          });
          container.appendChild(list);
        } else {
          const placeholder = document.createElement("div");
          placeholder.className = "dvn-pill-row";
          placeholder.textContent = isMissingConfig(detail) ? "no config" : "—";
          container.appendChild(placeholder);
        }
      };

      const renderVariantDetail = (detail) => {
        const line = document.createElement("div");
        line.className = "config-line";
        if (detail.differsFromDominant) {
          line.classList.add("config-line--variant");
        }
        if (detail.usesSentinel) {
          line.classList.add("config-line--sentinel");
        }
        const header = document.createElement("div");
        header.className = "config-line-header";
        const chainLabel = isDefined(detail.srcEid)
          ? this.formatChainLabel(detail.srcEid) || `EID ${detail.srcEid}`
          : "EID —";
        header.textContent = `${chainLabel} • ${describeRequiredLabel(detail)}`;
        line.appendChild(header);
        renderDvns(detail, line);
        stack.appendChild(line);
      };

      const renderStandardGroup = (group) => {
        if (!group?.sample) {
          return;
        }
        const line = document.createElement("div");
        line.className = "config-line config-line--standard";
        const header = document.createElement("div");
        header.className = "config-line-header";
        header.textContent = `Dominant set • ${group.count} chain${group.count === 1 ? "" : "s"} • ${describeRequiredLabel(group.sample)}`;
        line.appendChild(header);

        const uniqueEids = Array.from(
          new Set(group.eids.filter((eid) => isDefined(eid))),
        ).map((eid) => String(eid));
        if (uniqueEids.length) {
          const chainLabels = uniqueEids.map((eid) => this.formatChainLabel(eid) || `EID ${eid}`);
          const preview = chainLabels.slice(0, 4).join(", ");
          const note = document.createElement("div");
          note.className = "config-line-note";
          note.textContent = chainLabels.length > 4 ? `${preview}, …` : preview;
          line.appendChild(note);
        }

        renderDvns(group.sample, line);
        stack.appendChild(line);
      };

      variantDetails.forEach(renderVariantDetail);
      standardGroups.forEach((group) => renderStandardGroup(group));

      configCell.appendChild(stack);
    }
    if (metric.hasConfigDifference) {
      configCell.classList.add("cell-variant");
    }
    return configCell;
  }

  renderOptionalCell(metric) {
    const optionalCell = document.createElement("td");
    optionalCell.className = "optional-cell";
    const optionalChunks = metric.configDetails.filter((detail) => {
      const pairs = ensureArray(detail.optionalPairs);
      return (detail.optionalSummary && detail.optionalSummary !== "0") || pairs.length;
    });
    if (!optionalChunks.length) {
      optionalCell.textContent = "—";
    } else {
      const stack = document.createElement("div");
      stack.className = "optional-stack";
      optionalChunks.forEach((detail) => {
        const block = document.createElement("div");
        block.className = "optional-line";
        const header = document.createElement("div");
        header.className = "optional-line-header";
        const chainLabel = isDefined(detail.srcEid)
          ? this.formatChainLabel(detail.srcEid) || `EID ${detail.srcEid}`
          : "EID —";
        const labelParts = [
          chainLabel,
          detail.optionalSummary
            ? `quorum ${detail.optionalSummary}`
            : detail.usesSentinel
              ? "sentinel"
              : "optional DVNs",
        ];
        header.textContent = labelParts.join(" • ");
        block.appendChild(header);

        const optionalPairs = ensureArray(detail.optionalPairs);
        if (optionalPairs.length) {
          const list = document.createElement("div");
          list.className = "dvn-pill-row";
          optionalPairs.forEach((pair) => {
            const pill = document.createElement("span");
            pill.className = "dvn-pill dvn-pill--optional copyable";
            const copyValue = pair.address || pair.label;
            pill.dataset.copyValue = copyValue || "";
            pill.title = pair.address || pair.label;
            pill.textContent = pair.label || this.shortenAddress(pair.address);
            list.appendChild(pill);
          });
          block.appendChild(list);
        }

        stack.appendChild(block);
      });
      optionalCell.appendChild(stack);
    }
    if (metric.hasSentinel) {
      optionalCell.classList.add("cell-sentinel");
    }
    return optionalCell;
  }

  renderEdgesCell(metric, edgeLows, edgeHighs, hasEdgeVariation) {
    const edgesCell = document.createElement("td");
    edgesCell.className = "edges-cell";

    const edgeCount = document.createElement("div");
    edgeCount.className = "edge-count";
    const edgeParts = [`${metric.activeIncomingCount} active`];
    if (metric.blockedIncomingCount > 0) {
      edgeParts.push(`${metric.blockedIncomingCount} blocked`);
    }
    edgeCount.textContent = edgeParts.join(" / ");
    edgesCell.appendChild(edgeCount);

    if (metric.activeIncoming && metric.activeIncoming.length > 0) {
      const activeList = document.createElement("div");
      activeList.className = "active-edges-list";
      const activeSources = new Set();
      metric.activeIncoming.forEach((edgeInfo) => {
        const srcEid = edgeInfo?.edge?.srcEid;
        if (isDefined(srcEid)) {
          activeSources.add(String(srcEid));
        }
      });
      if (activeSources.size > 0) {
        const activeChains = Array.from(activeSources)
          .map((eid) => this.formatChainLabel(eid) || `EID ${eid}`)
          .sort();
        activeList.textContent = `Active: ${activeChains.join(", ")}`;
        edgesCell.appendChild(activeList);
      }
    }

    if (metric.blockedIncoming && metric.blockedIncoming.length > 0) {
      const blockedList = document.createElement("div");
      blockedList.className = "blocked-edges-list";
      const blockedSources = new Set();
      metric.blockedIncoming.forEach((edgeInfo) => {
        const srcEid = edgeInfo?.edge?.srcEid;
        if (isDefined(srcEid)) {
          blockedSources.add(String(srcEid));
        }
      });
      if (blockedSources.size > 0) {
        const blockedChains = Array.from(blockedSources)
          .map((eid) => this.formatChainLabel(eid) || `EID ${eid}`)
          .sort();
        blockedList.textContent = `Blocked: ${blockedChains.join(", ")}`;
        edgesCell.appendChild(blockedList);
      }
    }

    if (hasEdgeVariation && metric.isTracked && !metric.isBlocked) {
      if (edgeLows.includes(metric.id)) {
        edgesCell.classList.add("cell-extreme-low");
      } else if (edgeHighs.includes(metric.id)) {
        edgesCell.classList.add("cell-extreme-high");
      }
    }
    return edgesCell;
  }

  renderNotesCell(metric, createBadge) {
    const notesCell = document.createElement("td");
    notesCell.className = "notes-cell";
    const noteBadges = [];

    if (metric.diffReasonSummary.length) {
      noteBadges.push(createBadge("Δ DVN set", "alert", metric.diffReasonSummary.join("; ")));
    }
    if (metric.blockReasons.length) {
      noteBadges.push(createBadge("Blocked", "danger", metric.blockReasons.join("; ")));
    }
    if (metric.hasSentinel) {
      const sentinelDetails = metric.configDetails
        .filter((detail) => detail.usesSentinel || detail.optionalSummary)
        .map((detail) =>
          detail.optionalSummary
            ? `EID ${detail.srcEid}: quorum ${detail.optionalSummary}`
            : `EID ${detail.srcEid}: sentinel`,
        );
      noteBadges.push(
        createBadge(
          "Sentinel quorum",
          "info",
          sentinelDetails.length ? sentinelDetails.join("; ") : null,
        ),
      );
    }
    if (metric.fromPacketDelivered) {
      noteBadges.push(createBadge("From packet", "info", "Inferred from packet"));
    }
    metric.notes.forEach((note) => {
      if (note === "Blocked" || note === "Sentinel quorum") {
        return;
      }
      noteBadges.push(createBadge(note, "muted"));
    });

    if (!noteBadges.length) {
      notesCell.textContent = "—";
    } else {
      noteBadges.forEach((badge) => notesCell.appendChild(badge));
    }
    return notesCell;
  }
}
