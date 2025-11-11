import { AddressUtils } from "../../utils/AddressUtils.js";
import { ensureArray, isDefined } from "../../utils/NumberUtils.js";
import { DomBuilder } from "../../utils/dom/DomBuilder.js";

/**
 * Renders individual node rows for the node list table
 * Extracted from NodeListView to follow single responsibility principle
 */
export class NodeRowRenderer {
  constructor({ formatChainLabel, shortenAddress }) {
    this.formatChainLabel = typeof formatChainLabel === "function" ? formatChainLabel : () => "";
    this.shortenAddress = typeof shortenAddress === "function" ? shortenAddress : (addr) => addr;
  }

  /**
   * Create a badge element
   */
  createBadge(label, tone = "default", tooltip = null) {
    return DomBuilder.span({
      className: `badge badge--${tone}`,
      textContent: label,
      title: tooltip || undefined,
    });
  }

  /**
   * Render a complete node row
   */
  renderNodeRow(
    metric,
    edgeLows,
    edgeHighs,
    hasEdgeVariation,
    packetLows,
    packetHighs,
    hasPacketVariation,
    formatNumber,
  ) {
    const rowClasses = ["row"];
    if (metric.isBlocked) rowClasses.push("row-blocked");
    if (!metric.isTracked) rowClasses.push("row-untracked");
    if (metric.hasConfigDifference) rowClasses.push("row-variant");
    const tr = DomBuilder.tr({ className: rowClasses.filter(Boolean).join(" ") });

    // Node cell
    const nodeInfo = DomBuilder.span({
      className: "node-id copyable",
      dataset: { copyValue: metric.id, oappId: metric.id },
    });

    if (metric.alias) {
      nodeInfo.appendChild(
        DomBuilder.span({
          className: "node-alias",
          textContent: metric.alias,
        }),
      );
    }

    nodeInfo.appendChild(
      DomBuilder.span({
        className: "node-id-chain",
        textContent: metric.chainLabel,
      }),
    );

    nodeInfo.appendChild(
      DomBuilder.span({
        className: "node-id-value",
        textContent: metric.id,
      }),
    );

    const nodeCell = DomBuilder.td(
      {},
      DomBuilder.div({ className: "node-identity" }, nodeInfo),
    );
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
    const packetClasses = ["metric-cell"];
    if (hasPacketVariation && metric.isTracked && !metric.isBlocked) {
      if (packetLows.includes(metric.id)) {
        packetClasses.push("cell-extreme-low");
      } else if (packetHighs.includes(metric.id)) {
        packetClasses.push("cell-extreme-high");
      }
    }
    const packetsCell = DomBuilder.td({
      className: packetClasses.join(" "),
      textContent: formatNumber(metric.totalPackets),
    });
    tr.appendChild(packetsCell);

    // Notes cell
    const notesCell = this.renderNotesCell(metric);
    tr.appendChild(notesCell);

    return tr;
  }

  /**
   * Render the DVN configuration cell
   */
  renderConfigCell(metric) {
    const configCell = DomBuilder.td({ className: "config-cell" });
    if (!metric.configDetails.length) {
      configCell.textContent = "—";
    } else {
      const stack = DomBuilder.div({ className: "config-stack" });

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
          const list = DomBuilder.div({ className: "dvn-pill-row" });
          safePairs.forEach((pair) => {
            const copyValue = pair.address || pair.label;
            list.appendChild(
              DomBuilder.span({
                className: "dvn-pill copyable",
                dataset: { copyValue: copyValue || "" },
                title: pair.address || pair.label,
                textContent: pair.label || (pair.address ? this.shortenAddress(pair.address) : "—"),
              }),
            );
          });
          container.appendChild(list);
        } else {
          container.appendChild(
            DomBuilder.div({
              className: "dvn-pill-row",
              textContent: isMissingConfig(detail) ? "no config" : "—",
            }),
          );
        }
      };

      const renderVariantDetail = (detail) => {
        const lineClasses = ["config-line"];
        if (detail.differsFromDominant) lineClasses.push("config-line--variant");
        if (detail.usesSentinel) lineClasses.push("config-line--sentinel");

        const line = DomBuilder.div({ className: lineClasses.join(" ") });
        const chainLabel = isDefined(detail.srcEid)
          ? this.formatChainLabel(detail.srcEid) || `EID ${detail.srcEid}`
          : "EID —";
        line.appendChild(
          DomBuilder.div({
            className: "config-line-header",
            textContent: `${chainLabel} • ${describeRequiredLabel(detail)}`,
          }),
        );
        renderDvns(detail, line);
        stack.appendChild(line);
      };

      const renderStandardGroup = (group) => {
        if (!group?.sample) {
          return;
        }
        const line = DomBuilder.div({ className: "config-line config-line--standard" });
        line.appendChild(
          DomBuilder.div({
            className: "config-line-header",
            textContent: `Dominant set • ${group.count} chain${group.count === 1 ? "" : "s"} • ${describeRequiredLabel(group.sample)}`,
          }),
        );

        const uniqueEids = Array.from(
          new Set(group.eids.filter((eid) => isDefined(eid))),
        ).map((eid) => String(eid));
        if (uniqueEids.length) {
          const chainLabels = uniqueEids.map((eid) => this.formatChainLabel(eid) || `EID ${eid}`);
          const preview = chainLabels.slice(0, 4).join(", ");
          line.appendChild(
            DomBuilder.div({
              className: "config-line-note",
              textContent: chainLabels.length > 4 ? `${preview}, …` : preview,
            }),
          );
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

  /**
   * Render the optional DVNs cell
   */
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

  /**
   * Render the edges cell showing incoming connections
   */
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

  /**
   * Render the notes cell with badges
   */
  renderNotesCell(metric) {
    const notesCell = document.createElement("td");
    notesCell.className = "notes-cell";
    const noteBadges = [];

    if (metric.diffReasonSummary.length) {
      noteBadges.push(this.createBadge("Δ DVN set", "alert", metric.diffReasonSummary.join("; ")));
    }
    if (metric.blockReasons.length) {
      noteBadges.push(this.createBadge("Blocked", "danger", metric.blockReasons.join("; ")));
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
        this.createBadge(
          "Sentinel quorum",
          "info",
          sentinelDetails.length ? sentinelDetails.join("; ") : null,
        ),
      );
    }
    if (metric.fromPacketDelivered) {
      noteBadges.push(this.createBadge("From packet", "info", "Inferred from packet"));
    }
    metric.notes.forEach((note) => {
      if (note === "Blocked" || note === "Sentinel quorum") {
        return;
      }
      noteBadges.push(this.createBadge(note, "muted"));
    });

    if (!noteBadges.length) {
      notesCell.textContent = "—";
    } else {
      noteBadges.forEach((badge) => notesCell.appendChild(badge));
    }
    return notesCell;
  }
}
