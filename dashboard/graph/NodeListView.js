import { AddressUtils } from "../utils/AddressUtils.js";
import { ensureArray } from "../utils/NumberUtils.js";
import { DomBuilder } from "../utils/dom/DomBuilder.js";
import { NodeMetricsCalculator } from "./node-list/NodeMetricsCalculator.js";
import { NodeRowRenderer } from "./node-list/NodeRowRenderer.js";
import { appendSummaryRow, describeCombination, shortenAddress } from "./utils.js";

export class NodeListView {
  constructor({ getOAppAlias, formatChainLabel, areStringArraysEqual, requestUniformAlias }) {
    this.metricsCalculator = new NodeMetricsCalculator({
      getOAppAlias,
      formatChainLabel,
      areStringArraysEqual,
    });
    this.rowRenderer = new NodeRowRenderer({
      formatChainLabel,
      shortenAddress,
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
        renameActions = DomBuilder.div(
          { className: "summary-actions node-actions" },
          DomBuilder.button({
            attributes: { type: "button" },
            textContent: "Rename All Nodes",
            title: "Set a shared alias for every node in this crawl (excludes zero-peer sentinels)",
            onClick: () => {
              if (!Array.isArray(renameTargets) || !renameTargets.length) {
                return;
              }
              this.requestUniformAlias([...renameTargets]);
            },
          }),
        );
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
    const insightGrid = DomBuilder.div({ className: "node-insight-grid" });
    container.appendChild(insightGrid);

    const dominantCard = DomBuilder.div({ className: "insight-card" });
    dominantCard.appendChild(DomBuilder.h4({ textContent: "Dominant DVN Set" }));

    if (dominantCombination) {
      dominantCard.appendChild(
        DomBuilder.p({
          className: "insight-lead",
          textContent: this.describeCombination(dominantCombination),
        }),
      );

      const dl = DomBuilder.dl({ className: "insight-list" });
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
      dominantCard.appendChild(DomBuilder.p({ textContent: "No dominant DVN set detected." }));
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
    const anomaliesCard = DomBuilder.div({ className: "insight-card insight-card--alert" });
    anomaliesCard.appendChild(DomBuilder.h4({ textContent: "Special Cases" }));

    const anomalyContainer = DomBuilder.div({ className: "anomaly-groups" });
    anomaliesCard.appendChild(anomalyContainer);

    const appendAnomalyGroup = (label, items) => {
      if (!items.length) {
        return;
      }
      const group = DomBuilder.div({ className: "anomaly-group" });
      group.appendChild(DomBuilder.h5({ textContent: label }));

      const list = DomBuilder.ul({ className: "anomaly-list" });
      items.forEach((item) => {
        const li = DomBuilder.li();
        li.appendChild(
          DomBuilder.span({
            className: "anomaly-node",
            textContent: formatNodeDescriptor(item.metric),
          }),
        );
        if (item.detail) {
          li.appendChild(
            DomBuilder.span({
              className: "anomaly-detail",
              textContent: item.detail,
            }),
          );
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
      anomalyContainer.appendChild(
        DomBuilder.p({ textContent: "No anomalies detected in this crawl." }),
      );
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
    const statsCard = DomBuilder.div({ className: "insight-card" });
    statsCard.appendChild(DomBuilder.h4({ textContent: "Connectivity Stats" }));

    const statsList = DomBuilder.dl({ className: "insight-list" });
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
    const table = DomBuilder.table({ className: "node-detail-table" });
    const thead = DomBuilder.thead();
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

    const tbody = DomBuilder.tbody();
    nodeMetrics.forEach((metric) => {
      const tr = this.rowRenderer.renderNodeRow(
        metric,
        edgeLows,
        edgeHighs,
        hasEdgeVariation,
        packetLows,
        packetHighs,
        hasPacketVariation,
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
}
