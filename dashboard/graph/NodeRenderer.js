/**
 * Node Renderer - SVG node rendering with styling and interactions
 */

import { APP_CONFIG } from "../config.js";
import { AddressUtils } from "../utils/AddressUtils.js";

export class NodeRenderer {
  constructor({ nodeRadius, getOAppAlias, formatChainLabel, getNodeSecurityMetrics, onRecenter }) {
    this.nodeRadius = nodeRadius || APP_CONFIG.GRAPH_VISUAL.NODE_RADIUS;
    this.getOAppAlias = typeof getOAppAlias === "function" ? getOAppAlias : () => null;
    this.formatChainLabel = typeof formatChainLabel === "function" ? formatChainLabel : () => "";
    this.getNodeSecurityMetrics =
      typeof getNodeSecurityMetrics === "function" ? getNodeSecurityMetrics : () => ({});
    this.onRecenter = onRecenter;
  }

  /**
   * Render all nodes as SVG circles with labels
   */
  renderNodes(
    svgNS,
    nodes,
    nodePositions,
    maxMinRequiredDVNsForNodes,
    blockedNodes,
    showPersistentTooltip,
    centerNodeId,
    updateVisibility,
  ) {
    const nodesGroup = document.createElementNS(svgNS, "g");
    nodesGroup.setAttribute("class", "nodes");

    for (const node of nodes) {
      const pos = nodePositions.get(node.id);
      if (!pos) continue;

      const { minRequiredDVNs, hasBlockedConfig } = this.getNodeSecurityMetrics(node);
      const isBlocked = blockedNodes.has(node.id);
      const isCenterNode = node.id === centerNodeId;

      let radius = this.nodeRadius * 0.5;
      if (node.isTracked) {
        radius = this.nodeRadius * (0.6 + 0.4 * Math.min(minRequiredDVNs / 5, 1));
      } else if (
        !node.isTracked &&
        node.id &&
        AddressUtils.isZero(String(node.id).split("_").at(-1))
      ) {
        radius = this.nodeRadius * 0.65;
      }

      const nodeGroup = document.createElementNS(svgNS, "g");
      nodeGroup.setAttribute("class", "node");
      nodeGroup.setAttribute("data-node-id", node.id);

      let fillColor;
      if (isBlocked) {
        // Grey color for nodes that cannot send packets to monitored nodes
        fillColor = APP_CONFIG.GRAPH_COLORS.NODE_BLOCKED;
      } else if (node.isDangling) {
        fillColor = "none";
      } else if (minRequiredDVNs >= maxMinRequiredDVNsForNodes) {
        fillColor = APP_CONFIG.GRAPH_COLORS.NODE_SECURE;
      } else {
        fillColor = APP_CONFIG.GRAPH_COLORS.NODE_WEAK;
      }

      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", pos.x);
      circle.setAttribute("cy", pos.y);
      circle.setAttribute("r", radius);
      circle.setAttribute("fill", fillColor);
      circle.setAttribute("stroke", "none");
      circle.style.cursor = "pointer";

      const alias = this.getOAppAlias(node.id);
      const endpointId =
        node.localEid ?? (typeof node.id === "string" ? node.id.split("_")[0] : "unknown");
      const endpointLabel = this.formatChainLabel(endpointId) || endpointId;
      const titleLines = [
        alias ? `${alias} (${node.id})` : node.id,
        `Chain: ${endpointLabel}`,
        `Node security config tracked: ${node.isTracked ? "Yes" : "No"}`,
      ];

      if (node.fromPacketDelivered) {
        titleLines.push(`No peer info: Inferred from packet`);
      }

      if (node.isTracked) {
        titleLines.push(`Lifetime packets received: ${node.totalPacketsReceived}`);
        titleLines.push(`Min required DVNs: ${minRequiredDVNs}`);
      }

      if (isBlocked) {
        titleLines.push(`Blocked: Cannot send packets to monitored nodes`);
      }

      if (hasBlockedConfig) {
        titleLines.push(`Has blocking config(s)`);
      }

      if (!isBlocked && minRequiredDVNs < maxMinRequiredDVNsForNodes) {
        if (node.isTracked) {
          titleLines.push(
            `Lower than highest DVN threshold (${minRequiredDVNs} vs ${maxMinRequiredDVNsForNodes})`,
          );
        } else {
          titleLines.push(`Potential weak link: Untracked security config`);
        }
      }

      titleLines.push(`Click to toggle unconnected nodes, Double-click to put this node at center`);

      const nodeTooltipText = titleLines.join("\n");
      const title = document.createElementNS(svgNS, "title");
      title.textContent = nodeTooltipText;
      circle.appendChild(title);

      circle.addEventListener("click", (e) => {
        e.stopPropagation();
        showPersistentTooltip(nodeTooltipText, e.pageX + 10, e.pageY + 10);
        if (updateVisibility) {
          updateVisibility(node.id);
        }
      });

      // Add double-click handler to re-center on this node
      circle.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (this.onRecenter) {
          this.onRecenter(node.id);
        }
      });

      nodeGroup.appendChild(circle);

      // Chain label
      const chainDisplaySource =
        node.localEid ?? (typeof node.id === "string" ? node.id.split("_")[0] : "unknown");
      let chainDisplayLabel =
        this.formatChainLabel(chainDisplaySource) || `Endpoint ${chainDisplaySource}`;
      chainDisplayLabel = chainDisplayLabel.replace(/\s*\(\d+\)$/, "");
      const displayText = chainDisplayLabel.toUpperCase();

      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", pos.x);
      text.setAttribute("y", pos.y + 4);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "12");
      text.setAttribute("font-weight", "500");
      text.setAttribute("fill", "var(--ink)");
      text.textContent = displayText;
      nodeGroup.appendChild(text);

      nodesGroup.appendChild(nodeGroup);
    }

    return nodesGroup;
  }
}
