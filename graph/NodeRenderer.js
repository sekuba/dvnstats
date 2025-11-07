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

      const buildTooltipContent = () => ({
        title: nodeTooltipText,
        render: (root) => {
          const divider = document.createElement("hr");
          divider.style.margin = "8px 0";
          divider.style.border = "none";
          divider.style.borderTop = "1px solid var(--ink)";
          divider.style.opacity = "0.2";
          root.appendChild(divider);

          const form = document.createElement("form");
          form.className = "node-connection-form";
          form.style.display = "flex";
          form.style.flexDirection = "column";
          form.style.gap = "4px";

          const label = document.createElement("label");
          label.textContent = "Show unblocked path to OApp ID";
          label.style.fontSize = "11px";
          label.style.fontWeight = "600";
          form.appendChild(label);

          const input = document.createElement("input");
          input.type = "text";
          input.placeholder = "Paste OApp ID and press Enter";
          input.style.fontFamily = "monospace";
          input.style.fontSize = "12px";
          input.style.padding = "4px 6px";
          input.style.border = "1px solid var(--ink)";
          input.style.borderRadius = "4px";
          input.style.width = "100%";
          form.appendChild(input);

          const status = document.createElement("div");
          status.className = "node-connection-status";
          status.style.display = "none";
          status.style.fontSize = "11px";
          status.style.marginTop = "2px";

          const setStatus = (message, tone = "info") => {
            status.textContent = message;
            status.style.display = "";
            if (tone === "success") {
              status.style.color = "var(--success, #1a7f37)";
            } else if (tone === "error") {
              status.style.color = "var(--danger, #b3261e)";
            } else {
              status.style.color = "var(--ink)";
            }
          };

          form.addEventListener("submit", (evt) => {
            evt.preventDefault();
            const targetId = input.value.trim();
            if (!targetId) {
              setStatus("Enter an OApp ID to inspect the connecting path.", "error");
              return;
            }
            const result = updateVisibility(node.id, {
              targetNodeId: targetId,
              onSuccess: (path) => {
                const hops = Math.max(0, path.length - 1);
                const hopLabel = hops === 1 ? "hop" : "hops";
                setStatus(`Showing connection (${hops} ${hopLabel}).`, "success");
              },
              onFail: (message) => {
                setStatus(message || "No connecting path found.", "error");
              },
            });
            if (!result) {
              if (status.style.display === "none") {
                setStatus("Unable to resolve a connecting path.", "error");
              }
            }
          });

          root.appendChild(form);
          root.appendChild(status);

          setTimeout(() => {
            input.focus();
            input.select();
          }, 0);
        },
      });

      circle.addEventListener("click", (e) => {
        e.stopPropagation();
        showPersistentTooltip(buildTooltipContent(), e.pageX + 10, e.pageY + 10);
        if (updateVisibility) {
          updateVisibility(node.id);
        }
      });

      circle.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (this.onRecenter) {
          this.onRecenter(node.id);
        }
      });

      nodeGroup.appendChild(circle);

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
