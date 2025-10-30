/**
 * SVG Graph Visualization for Security Web
 * Renders interactive force-directed graph of OApp security connections
 */

import { APP_CONFIG } from "./config.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Main graph renderer
 */
export class SecurityGraphView {
  constructor({ getOAppAlias, getChainDisplayLabel, requestUniformAlias } = {}) {
    this.width = APP_CONFIG.GRAPH_VISUAL.WIDTH;
    this.height = APP_CONFIG.GRAPH_VISUAL.HEIGHT;
    this.nodeRadius = APP_CONFIG.GRAPH_VISUAL.NODE_RADIUS;
    this.padding = APP_CONFIG.GRAPH_VISUAL.PADDING;
    this.seedGap = APP_CONFIG.GRAPH_VISUAL.SEED_GAP;
    this.columnSpacing = APP_CONFIG.GRAPH_VISUAL.COLUMN_SPACING;
    this.maxNodesPerColumn = APP_CONFIG.GRAPH_VISUAL.MAX_NODES_PER_COLUMN;
    this.maxColumns = APP_CONFIG.GRAPH_VISUAL.MAX_COLUMNS;
    this.deadAddress = APP_CONFIG.ADDRESSES.DEAD;
    this.zeroPeer = APP_CONFIG.ADDRESSES.ZERO_PEER;
    this.zeroAddress = APP_CONFIG.ADDRESSES.ZERO;
    this.getOAppAlias = typeof getOAppAlias === "function" ? getOAppAlias : () => null;
    this.getChainDisplayLabel =
      typeof getChainDisplayLabel === "function" ? getChainDisplayLabel : () => "";
    this.requestUniformAlias =
      typeof requestUniformAlias === "function" ? requestUniformAlias : null;
  }

  /**
   * Renders the complete web of security visualization
   */
  render(webData, options = {}) {
    if (!webData?.nodes || !webData?.edges) return this.renderError();

    const container = document.createElement("div");
    container.className = "web-of-security-container";

    const nodesById = new Map(webData.nodes.map((n) => [n.id, n]));
    const edgeAnalysis = this.calculateEdgeSecurityInfo(webData.edges, nodesById);
    const maxMinRequiredDVNsForNodes = this.calculateMaxMinRequiredDVNsForNodes(webData.nodes);
    const blockedNodes = this.findBlockedNodes(webData.nodes, edgeAnalysis.edgeSecurityInfo);

    // Find the most connected tracked node to use as center
    const centerNodeId =
      options.centerNodeId || this.findMostConnectedNode(webData.nodes, webData.edges);

    const context = {
      edgeSecurityInfo: edgeAnalysis.edgeSecurityInfo,
      maxRequiredDVNsInWeb: edgeAnalysis.maxRequiredDVNsInWeb,
      dominantCombination: edgeAnalysis.dominantCombination,
      combinationStats: edgeAnalysis.combinationStats,
      maxMinRequiredDVNsForNodes,
      blockedNodes,
      centerNodeId,
    };

    container.append(
      this.renderSummary(webData, centerNodeId),
      this.renderSVG(webData, context),
      this.renderNodeList(webData, context),
    );

    return container;
  }

  renderError() {
    const el = document.createElement("div");
    el.className = "placeholder";
    el.innerHTML =
      '<p class="placeholder-title">Invalid web data</p><p>The loaded file does not contain valid web data.</p>';
    return el;
  }

  renderSummary(webData, centerNodeId) {
    const centerNode = webData.nodes.find((n) => n.id === centerNodeId);
    const centerAlias = centerNode
      ? this.getOAppAlias(centerNode.id) || centerNode.id
      : centerNodeId || "—";

    const summary = document.createElement("div");
    summary.className = "summary-panel";
    summary.innerHTML = `
      <h3>Web of Security Overview</h3>
      <dl>
        <dt>Seed OApp</dt>
        <dd>${webData.seed || "—"}</dd>
        <dt>Center Node</dt>
        <dd>${centerAlias}</dd>
        <dt>Crawl Depth</dt>
        <dd>${webData.crawlDepth || 0}</dd>
        <dt>Total Nodes</dt>
        <dd>${webData.nodes.length}</dd>
        <dt>Tracked Nodes</dt>
        <dd>${webData.nodes.filter((n) => n.isTracked).length}</dd>
        <dt>Dangling Nodes</dt>
        <dd>${webData.nodes.filter((n) => n.isDangling).length}</dd>
        <dt>Total Edges</dt>
        <dd>${webData.edges.length}</dd>
        <dt>Crawled At</dt>
        <dd>${new Date(webData.timestamp).toLocaleString()}</dd>
      </dl>
    `;
    return summary;
  }

  renderSVG(webData, context) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", this.height);
    svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    svg.style.border = "1px solid var(--ink)";
    svg.style.background = "var(--paper)";
    svg.style.marginTop = "1rem";
    svg.style.cursor = "grab";

    const contentGroup = document.createElementNS(SVG_NS, "g");
    contentGroup.setAttribute("class", "zoom-content");

    this.setupZoomAndPan(svg, contentGroup);
    const showPersistentTooltip = this.setupPersistentTooltips(svg);

    const nodePositions = this.layoutNodes(webData.nodes, webData.edges, context.centerNodeId);

    // Focus state for hiding unconnected nodes
    let focusedNodeId = null;
    let visibleNodeIds = new Set();

    // Build adjacency map for quick neighbor lookup
    const adjacencyMap = new Map();
    for (const node of webData.nodes) {
      adjacencyMap.set(node.id, new Set());
    }
    for (const edge of webData.edges) {
      if (adjacencyMap.has(edge.from)) adjacencyMap.get(edge.from).add(edge.to);
      if (adjacencyMap.has(edge.to)) adjacencyMap.get(edge.to).add(edge.from);
    }

    const updateVisibility = (nodeId) => {
      if (focusedNodeId === nodeId) {
        // Toggle off - show everything
        focusedNodeId = null;
        visibleNodeIds.clear();

        // Show all nodes and edges
        nodesGroup.querySelectorAll(".node").forEach((node) => {
          node.style.display = "";
        });
        edgesGroup.querySelectorAll("line, g").forEach((edge) => {
          edge.style.display = "";
        });
      } else {
        // Focus on this node
        focusedNodeId = nodeId;
        visibleNodeIds = new Set([nodeId, ...(adjacencyMap.get(nodeId) || [])]);

        // Hide unconnected nodes
        nodesGroup.querySelectorAll(".node").forEach((node) => {
          const nodeData = node.getAttribute("data-node-id");
          if (!visibleNodeIds.has(nodeData)) {
            node.style.display = "none";
          } else {
            node.style.display = "";
          }
        });

        // Hide edges where either endpoint is not visible
        edgesGroup.querySelectorAll("[data-edge-from]").forEach((edge) => {
          const from = edge.getAttribute("data-edge-from");
          const to = edge.getAttribute("data-edge-to");
          if (!visibleNodeIds.has(from) || !visibleNodeIds.has(to)) {
            edge.style.display = "none";
          } else {
            edge.style.display = "";
          }
        });
      }
    };

    const {
      edgeSecurityInfo,
      maxRequiredDVNsInWeb,
      dominantCombination,
      maxMinRequiredDVNsForNodes,
      blockedNodes,
      centerNodeId,
    } = context;

    // Render edges
    const edgesGroup = this.renderEdges(
      SVG_NS,
      edgeSecurityInfo,
      nodePositions,
      maxRequiredDVNsInWeb,
      dominantCombination,
      showPersistentTooltip,
    );
    contentGroup.appendChild(edgesGroup);

    // Render nodes
    const nodesGroup = this.renderNodes(
      SVG_NS,
      webData.nodes,
      nodePositions,
      maxMinRequiredDVNsForNodes,
      blockedNodes,
      showPersistentTooltip,
      centerNodeId,
      updateVisibility,
    );
    contentGroup.appendChild(nodesGroup);

    svg.appendChild(contentGroup);
    return svg;
  }

  renderEdges(
    svgNS,
    edgeSecurityInfo,
    nodePositions,
    maxRequiredDVNsInWeb,
    dominantCombination,
    showPersistentTooltip,
  ) {
    const edgesGroup = document.createElementNS(svgNS, "g");
    edgesGroup.setAttribute("class", "edges");

    // Detect bidirectional edges
    const edgeMap = new Map();
    const processedEdges = new Set();

    for (const info of edgeSecurityInfo) {
      const edge = info.edge;
      const key = `${edge.from}|${edge.to}`;
      const reverseKey = `${edge.to}|${edge.from}`;

      if (!edgeMap.has(key)) {
        edgeMap.set(key, { forward: info, reverse: null });
      }

      if (edgeMap.has(reverseKey)) {
        edgeMap.get(reverseKey).reverse = info;
      }
    }

    // Render all edges
    for (const info of edgeSecurityInfo) {
      const edge = info.edge;
      const key = `${edge.from}|${edge.to}`;
      const reverseKey = `${edge.to}|${edge.from}`;

      if (processedEdges.has(key)) continue;

      const fromPos = nodePositions.get(edge.from);
      const toPos = nodePositions.get(edge.to);
      if (!fromPos || !toPos) continue;

      const edgePair = edgeMap.get(key);
      const isBidirectional = edgePair && edgePair.reverse !== null;

      if (isBidirectional) {
        processedEdges.add(key);
        processedEdges.add(reverseKey);
        this.renderBidirectionalEdge(
          svgNS,
          edgesGroup,
          fromPos,
          toPos,
          edgePair.forward,
          edgePair.reverse,
          maxRequiredDVNsInWeb,
          dominantCombination,
          showPersistentTooltip,
        );
      } else {
        this.renderUnidirectionalEdge(
          svgNS,
          edgesGroup,
          fromPos,
          toPos,
          info,
          maxRequiredDVNsInWeb,
          dominantCombination,
          showPersistentTooltip,
        );
      }
    }

    return edgesGroup;
  }

  renderUnidirectionalEdge(
    svgNS,
    edgesGroup,
    fromPos,
    toPos,
    info,
    maxRequiredDVNsInWeb,
    dominantCombination,
    showPersistentTooltip,
  ) {
    const style = this.getEdgeStyle({
      isBlocked: info.isBlocked,
      isUnknown: info.isUnknownSecurity,
      requiredDVNCount: info.requiredDVNCount,
      maxRequiredDVNsInWeb,
      differsFromPopular: info.differsFromPopular,
    });

    this.createEdgeLine(
      svgNS,
      edgesGroup,
      fromPos,
      toPos,
      style,
      info,
      maxRequiredDVNsInWeb,
      dominantCombination,
      showPersistentTooltip,
    );

    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const angle = Math.atan2(dy, dx);

    edgesGroup.appendChild(
      this.createArrowMarker(
        svgNS,
        fromPos.x + dx * 0.75,
        fromPos.y + dy * 0.75,
        angle,
        8,
        style.color,
        info.edge.from,
        info.edge.to,
      ),
    );
  }

  renderBidirectionalEdge(
    svgNS,
    edgesGroup,
    fromPos,
    toPos,
    forwardInfo,
    reverseInfo,
    maxRequiredDVNsInWeb,
    dominantCombination,
    showPersistentTooltip,
  ) {
    const forwardStyle = this.getEdgeStyle({
      isBlocked: forwardInfo.isBlocked,
      isUnknown: forwardInfo.isUnknownSecurity,
      requiredDVNCount: forwardInfo.requiredDVNCount,
      maxRequiredDVNsInWeb,
      differsFromPopular: forwardInfo.differsFromPopular,
    });
    const reverseStyle = this.getEdgeStyle({
      isBlocked: reverseInfo.isBlocked,
      isUnknown: reverseInfo.isUnknownSecurity,
      requiredDVNCount: reverseInfo.requiredDVNCount,
      maxRequiredDVNsInWeb,
      differsFromPopular: reverseInfo.differsFromPopular,
    });
    const midX = (fromPos.x + toPos.x) / 2;
    const midY = (fromPos.y + toPos.y) / 2;
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const angle = Math.atan2(dy, dx);

    // Render two halves
    this.renderHalfEdge(
      svgNS,
      edgesGroup,
      fromPos.x,
      fromPos.y,
      midX,
      midY,
      reverseStyle,
      reverseInfo,
      maxRequiredDVNsInWeb,
      dominantCombination,
      showPersistentTooltip,
    );
    this.renderHalfEdge(
      svgNS,
      edgesGroup,
      midX,
      midY,
      toPos.x,
      toPos.y,
      forwardStyle,
      forwardInfo,
      maxRequiredDVNsInWeb,
      dominantCombination,
      showPersistentTooltip,
    );

    // Arrows
    edgesGroup.appendChild(
      this.createArrowMarker(
        svgNS,
        fromPos.x + dx * 0.75,
        fromPos.y + dy * 0.75,
        angle,
        8,
        forwardStyle.color,
        forwardInfo.edge.from,
        forwardInfo.edge.to,
      ),
    );
    edgesGroup.appendChild(
      this.createArrowMarker(
        svgNS,
        fromPos.x + dx * 0.25,
        fromPos.y + dy * 0.25,
        angle + Math.PI,
        8,
        reverseStyle.color,
        reverseInfo.edge.from,
        reverseInfo.edge.to,
      ),
    );
  }

  renderHalfEdge(
    svgNS,
    edgesGroup,
    x1,
    y1,
    x2,
    y2,
    style,
    info,
    maxRequiredDVNsInWeb,
    dominantCombination,
    showPersistentTooltip,
  ) {
    this.createEdgeLine(
      svgNS,
      edgesGroup,
      { x: x1, y: y1 },
      { x: x2, y: y2 },
      style,
      info,
      maxRequiredDVNsInWeb,
      dominantCombination,
      showPersistentTooltip,
    );
  }

  createEdgeLine(
    svgNS,
    edgesGroup,
    fromPos,
    toPos,
    style,
    info,
    maxRequiredDVNsInWeb,
    dominantCombination,
    showPersistentTooltip,
  ) {
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", fromPos.x);
    line.setAttribute("y1", fromPos.y);
    line.setAttribute("x2", toPos.x);
    line.setAttribute("y2", toPos.y);
    line.setAttribute("data-edge-from", info.edge.from);
    line.setAttribute("data-edge-to", info.edge.to);
    Object.assign(line.style, { cursor: "pointer" });

    Object.entries(style).forEach(([key, value]) => {
      const attrMap = {
        color: "stroke",
        width: "stroke-width",
        opacity: "opacity",
        dashArray: "stroke-dasharray",
      };
      line.setAttribute(attrMap[key], value);
    });

    const tooltipText = this.buildEdgeTooltip(info, maxRequiredDVNsInWeb, dominantCombination);
    const title = document.createElementNS(svgNS, "title");
    title.textContent = tooltipText;
    line.appendChild(title);

    line.addEventListener("click", (e) => {
      e.stopPropagation();
      showPersistentTooltip(tooltipText, e.pageX + 10, e.pageY + 10);
    });

    edgesGroup.appendChild(line);
  }

  getEdgeStyle({
    isBlocked,
    isUnknown,
    requiredDVNCount,
    maxRequiredDVNsInWeb,
    differsFromPopular,
  }) {
    if (isBlocked) {
      return { color: "#ff0000", width: "1", opacity: "0.6", dashArray: "8,4" };
    }
    if (isUnknown) {
      return { color: "#6b7280", width: "2", opacity: "0.55", dashArray: "6,4" };
    }
    if (differsFromPopular) {
      return { color: "#ff1df5", width: "3", opacity: "0.75", dashArray: "none" };
    }
    if (requiredDVNCount < maxRequiredDVNsInWeb) {
      return { color: "#ff6666", width: "2", opacity: "0.55", dashArray: "none" };
    }
    return { color: "#000000ff", width: "3", opacity: "0.65", dashArray: "none" };
  }

  buildEdgeTooltip(info, maxRequiredDVNsInWeb, dominantCombination) {
    const {
      edge,
      isBlocked,
      blockReason,
      requiredDVNCount,
      requiredDVNLabels,
      optionalDVNLabels,
      optionalDVNCount,
      optionalDVNThreshold,
      usesSentinel,
      differsFromPopular,
      differenceReasons,
    } = info;

    let blockMessage = null;
    if (isBlocked && blockReason === "stale-peer") {
      blockMessage = "Status: BLOCKED (stale peer)";
    } else if (isBlocked && blockReason === "zero-peer") {
      blockMessage = "Status: BLOCKED (peer set to zero address)";
    } else if (isBlocked && blockReason === "blocking-dvn") {
      blockMessage = "Status: BLOCKED (blocking DVN)";
    } else if (isBlocked && blockReason === "dead-dvn") {
      blockMessage = "Status: BLOCKED (dead DVN)";
    } else if (isBlocked) {
      blockMessage = "Status: BLOCKED";
    }

    const hasSecurityConfig = Boolean(info.hasSecurityConfig);
    const unknownMessage = info.isUnknownSecurity ? "Unknown security config (untracked)" : null;
    const routeLine = this.buildRouteLabel(info);

    const requiredLine = hasSecurityConfig
      ? requiredDVNLabels && requiredDVNLabels.length > 0
        ? `Required DVNs (${requiredDVNCount}): ${requiredDVNLabels.join(", ")}`
        : `Required DVN Count: ${requiredDVNCount}`
      : "Required DVNs: unknown";

    const optionalLine =
      hasSecurityConfig && optionalDVNCount > 0
        ? `Optional DVNs quorum ${optionalDVNThreshold}/${optionalDVNCount}${
            optionalDVNLabels && optionalDVNLabels.length
              ? ` → ${optionalDVNLabels.join(", ")}`
              : ""
          }`
        : null;

    const sentinelLine =
      hasSecurityConfig && usesSentinel ? "Sentinel: Only optional quorum enforced" : null;

    const anomalyLine =
      hasSecurityConfig && !isBlocked && differsFromPopular
        ? `Anomaly: ${differenceReasons?.length ? differenceReasons.join("; ") : "non-standard DVN set"}`
        : null;

    const lowerSecurityLine =
      hasSecurityConfig &&
      !isBlocked &&
      maxRequiredDVNsInWeb > 0 &&
      requiredDVNCount < maxRequiredDVNsInWeb
        ? `Warning: Lower security (${requiredDVNCount} vs web max ${maxRequiredDVNsInWeb})`
        : null;

    const dominantLine = dominantCombination
      ? `Dominant set: ${this.describeCombination(dominantCombination)}`
      : null;

    const lines = [
      `${edge.from} → ${edge.to}`,
      routeLine,
      `Src EID: ${edge.srcEid}`,
      blockMessage,
      unknownMessage,
      requiredLine,
      optionalLine,
      sentinelLine,
      anomalyLine,
      lowerSecurityLine,
      dominantLine,
    ].filter(Boolean);

    return lines.join("\n");
  }

  buildRouteLabel(info) {
    if (!info) {
      return null;
    }
    const fromLabel = info.routeFromLabel;
    const toLabel = info.routeToLabel;
    if (!fromLabel && !toLabel) {
      return null;
    }
    const source = fromLabel || "Unknown";
    const target = toLabel || "Unknown";
    return `Route: ${source} → ${target}`;
  }

  createArrowMarker(svgNS, x, y, angle, size, color, edgeFrom, edgeTo) {
    const arrowGroup = document.createElementNS(svgNS, "g");
    arrowGroup.setAttribute(
      "transform",
      `translate(${x}, ${y}) rotate(${(angle * 180) / Math.PI})`,
    );
    if (edgeFrom && edgeTo) {
      arrowGroup.setAttribute("data-edge-from", edgeFrom);
      arrowGroup.setAttribute("data-edge-to", edgeTo);
    }

    const arrow = document.createElementNS(svgNS, "polygon");
    arrow.setAttribute("points", `0,0 -${size},-${size / 2} -${size},${size / 2}`);
    arrow.setAttribute("fill", color);
    arrow.setAttribute("opacity", "0.8");

    arrowGroup.appendChild(arrow);
    return arrowGroup;
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

      const radius = node.isTracked
        ? this.nodeRadius * (0.6 + 0.4 * Math.min(minRequiredDVNs / 5, 1))
        : this.nodeRadius * 0.5;

      const nodeGroup = document.createElementNS(svgNS, "g");
      nodeGroup.setAttribute("class", "node");
      nodeGroup.setAttribute("data-node-id", node.id);

      let fillColor;
      if (isBlocked) {
        // Grey color for nodes that cannot send packets to monitored nodes
        fillColor = "#999999";
      } else if (node.isDangling) {
        fillColor = "none";
      } else if (minRequiredDVNs >= maxMinRequiredDVNsForNodes) {
        fillColor = "#ffff99";
      } else {
        fillColor = "#ff9999";
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

  renderNodeList(webData, analysis = {}) {
    const nodes = Array.isArray(webData?.nodes) ? webData.nodes : [];
    const container = document.createElement("section");
    container.className = "node-detail-board";
    container.style.marginTop = "2rem";

    const heading = document.createElement("h3");
    heading.textContent = "Node Security Highlights";
    container.appendChild(heading);

    let renameActions = null;

    if (!nodes.length) {
      const placeholder = document.createElement("p");
      placeholder.textContent = "No nodes returned by the crawl.";
      container.appendChild(placeholder);
      return container;
    }

    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const metricsById = new Map();

    const blockedNodes =
      analysis?.blockedNodes instanceof Set
        ? analysis.blockedNodes
        : new Set(Array.isArray(analysis?.blockedNodes) ? analysis.blockedNodes : []);

    const edgeSecurityInfo = Array.isArray(analysis?.edgeSecurityInfo)
      ? analysis.edgeSecurityInfo
      : [];
    const dominantCombination = analysis?.dominantCombination || null;
    const combinationFingerprint = dominantCombination?.fingerprint ?? null;

    const edgesByTo = new Map();
    const edgesByFrom = new Map();
    for (const info of edgeSecurityInfo) {
      if (!edgesByTo.has(info.edge.to)) {
        edgesByTo.set(info.edge.to, []);
      }
      edgesByTo.get(info.edge.to).push(info);

      if (!edgesByFrom.has(info.edge.from)) {
        edgesByFrom.set(info.edge.from, []);
      }
      edgesByFrom.get(info.edge.from).push(info);
    }

    const normalizeNames = (labels) =>
      Array.isArray(labels)
        ? labels
            .map((label) =>
              label === null || label === undefined ? "" : String(label).trim().toLowerCase(),
            )
            .filter(Boolean)
            .sort()
        : [];

    const nodeMetrics = nodes.map((node) => {
      const incoming = edgesByTo.get(node.id) || [];
      const outgoing = edgesByFrom.get(node.id) || [];
      const activeIncoming = incoming.filter((edge) => !edge.isBlocked);
      const blockedIncoming = incoming.filter((edge) => edge.isBlocked);
      const differenceEdges = activeIncoming.filter((edge) => edge.differsFromPopular);
      const sentinelEdges = activeIncoming.filter((edge) => edge.usesSentinel);

      const diffReasonSet = new Set();
      for (const edge of differenceEdges) {
        if (Array.isArray(edge.differenceReasons)) {
          for (const reason of edge.differenceReasons) {
            diffReasonSet.add(reason);
          }
        }
      }

      const blockReasonSet = new Set();
      for (const edge of blockedIncoming) {
        if (edge.blockReason === "stale-peer") {
          blockReasonSet.add("Stale peer");
        } else if (edge.blockReason === "zero-peer") {
          blockReasonSet.add("Zero peer");
        } else if (edge.blockReason === "dead-dvn") {
          blockReasonSet.add("Dead DVN");
        } else if (edge.blockReason === "blocking-dvn") {
          blockReasonSet.add("Blocking DVN");
        } else {
          blockReasonSet.add("Blocked route");
        }
      }

      const configDetails = (node.securityConfigs || []).map((cfg) => {
        const requiredLabels = cfg.requiredDVNLabels || cfg.requiredDVNs || [];
        const requiredAddresses = cfg.requiredDVNs || [];
        const normalized = normalizeNames(requiredLabels);
        const fingerprint = JSON.stringify({
          required: cfg.requiredDVNCount || 0,
          names: normalized,
          sentinel: Boolean(cfg.usesRequiredDVNSentinel),
        });
        const matchesDominant =
          Boolean(combinationFingerprint) &&
          !cfg.usesRequiredDVNSentinel &&
          fingerprint === combinationFingerprint;
        const differsFromDominant = Boolean(combinationFingerprint) && !matchesDominant;
        const usesSentinel = Boolean(cfg.usesRequiredDVNSentinel);

        if (usesSentinel) {
          diffReasonSet.add(
            `sentinel quorum ${cfg.optionalDVNThreshold || 0}/${cfg.optionalDVNCount || 0}`,
          );
        } else if (differsFromDominant && dominantCombination) {
          if (cfg.requiredDVNCount !== dominantCombination.requiredDVNCount) {
            diffReasonSet.add(
              `required DVN count ${cfg.requiredDVNCount} vs dominant ${dominantCombination.requiredDVNCount ?? "?"}`,
            );
          }
          if (!this.areStringArraysEqual(normalized, dominantCombination.normalizedNames)) {
            diffReasonSet.add("validator set differs");
          }
        }

        const requiredPairs = requiredLabels.map((label, idx) => ({
          label: label || "(unknown)",
          address: requiredAddresses[idx] || null,
        }));

        const optionalLabels = cfg.optionalDVNLabels || cfg.optionalDVNs || [];
        const optionalAddresses = cfg.optionalDVNs || [];
        const optionalPairs = optionalLabels.map((label, idx) => ({
          label: label || "(unknown)",
          address: optionalAddresses[idx] || null,
        }));
        const optionalSummary =
          cfg.optionalDVNCount && cfg.optionalDVNCount > 0
            ? `${cfg.optionalDVNThreshold || 0}/${cfg.optionalDVNCount}`
            : cfg.optionalDVNThreshold
              ? `${cfg.optionalDVNThreshold}`
              : null;

        return {
          srcEid: cfg.srcEid,
          requiredDVNCount: cfg.requiredDVNCount || 0,
          requiredPairs,
          optionalPairs,
          optionalSummary,
          usesSentinel,
          matchesDominant,
          differsFromDominant,
          fingerprint,
        };
      });

      const hasConfigDifference =
        differenceEdges.length > 0 || configDetails.some((detail) => detail.differsFromDominant);
      const hasSentinel =
        sentinelEdges.length > 0 || configDetails.some((detail) => detail.usesSentinel);

      const notes = new Set();
      if (blockedNodes.has(node.id)) {
        notes.add("Blocked");
      }
      if (!node.isTracked) {
        notes.add("Untracked");
      }
      if (node.isDangling) {
        notes.add("Dangling");
      }
      if (hasSentinel) {
        notes.add("Sentinel quorum");
      }
      if (node.isTracked && activeIncoming.length === 0 && !blockedNodes.has(node.id)) {
        notes.add("No active inbound edges");
      }

      const blockReasons = Array.from(blockReasonSet);
      if (blockedNodes.has(node.id) && blockReasons.length === 0 && node.isDangling) {
        blockReasons.push("Dangling peer (no config crawled)");
      }

      const endpointId =
        node.localEid ?? (typeof node.id === "string" ? node.id.split("_")[0] : "unknown");
      const chainLabel = this.formatChainLabel(endpointId) || endpointId;
      const totalPacketsValue = Number(
        node.totalPacketsReceived === undefined || node.totalPacketsReceived === null
          ? 0
          : node.totalPacketsReceived,
      );
      const totalPackets = Number.isFinite(totalPacketsValue) ? totalPacketsValue : 0;

      return {
        id: node.id,
        node,
        alias: this.getOAppAlias(node.id),
        chainLabel,
        depth: node.depth >= 0 ? node.depth : "—",
        isTracked: Boolean(node.isTracked),
        isDangling: Boolean(node.isDangling),
        fromPacketDelivered: Boolean(node.fromPacketDelivered),
        isBlocked: blockedNodes.has(node.id),
        totalPackets,
        incoming,
        outgoing,
        activeIncoming,
        blockedIncoming,
        activeIncomingCount: activeIncoming.length,
        blockedIncomingCount: blockedIncoming.length,
        differenceEdges,
        sentinelEdges,
        diffReasonSummary: Array.from(diffReasonSet),
        blockReasons,
        configDetails,
        hasConfigDifference,
        hasSentinel,
        notes: Array.from(notes),
      };
    });

    nodeMetrics.forEach((metric) => metricsById.set(metric.id, metric));

    if (this.requestUniformAlias && nodeMetrics.length) {
      const zeroAddresses = new Set(
        [this.zeroAddress, this.zeroPeer]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase()),
      );
      const renameTargets = Array.from(
        new Set(
          nodeMetrics
            .filter((metric) => {
              if (!metric || !metric.id || typeof metric.id !== "string") {
                return false;
              }
              const idAddress = metric.id.toLowerCase().split("_").at(-1) || "";
              const nodeAddress = String(metric.node?.address || "")
                .toLowerCase()
                .trim();
              if (zeroAddresses.has(idAddress) || zeroAddresses.has(nodeAddress)) {
                return false;
              }
              return true;
            })
            .map((metric) => metric.id),
        ),
      );

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
        const numeric =
          typeof value === "number"
            ? value
            : value === undefined || value === null
              ? NaN
              : Number(value);
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
            const eidText =
              detail.srcEid !== undefined && detail.srcEid !== null ? `EID ${detail.srcEid}: ` : "";
            return `${eidText}${
              detail.optionalSummary ? `quorum ${detail.optionalSummary}` : "sentinel"
            }`;
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

      const configCell = document.createElement("td");
      configCell.className = "config-cell";
      if (!metric.configDetails.length) {
        configCell.textContent = "—";
      } else {
        const stack = document.createElement("div");
        stack.className = "config-stack";

        const standardGroups = new Map();
        const variantDetails = [];

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
            if (detail.srcEid !== undefined && detail.srcEid !== null) {
              group.eids.push(detail.srcEid);
            }
          } else {
            variantDetails.push(detail);
          }
        });

        const renderDvns = (pairs, container) => {
          const safePairs = Array.isArray(pairs) ? pairs : [];
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
            placeholder.textContent = "—";
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
          const eidText =
            detail.srcEid !== undefined && detail.srcEid !== null
              ? `EID ${detail.srcEid}`
              : "EID —";
          header.textContent = `${eidText} • ${detail.requiredDVNCount} required`;
          line.appendChild(header);
          renderDvns(detail.requiredPairs, line);
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
          header.textContent = `Dominant set • ${group.count} EID${group.count === 1 ? "" : "s"} • ${group.sample.requiredDVNCount} required`;
          line.appendChild(header);

          const uniqueEids = Array.from(
            new Set(group.eids.filter((eid) => eid !== undefined && eid !== null)),
          ).map((eid) => String(eid));
          if (uniqueEids.length) {
            const preview = uniqueEids.slice(0, 4).join(", ");
            const note = document.createElement("div");
            note.className = "config-line-note";
            note.textContent = uniqueEids.length > 4 ? `EIDs ${preview}, …` : `EIDs ${preview}`;
            line.appendChild(note);
          }

          renderDvns(group.sample.requiredPairs, line);
          stack.appendChild(line);
        };

        variantDetails.forEach(renderVariantDetail);
        standardGroups.forEach((group) => renderStandardGroup(group));

        configCell.appendChild(stack);
      }
      if (metric.hasConfigDifference) {
        configCell.classList.add("cell-variant");
      }
      tr.appendChild(configCell);

      const optionalCell = document.createElement("td");
      optionalCell.className = "optional-cell";
      const optionalChunks = metric.configDetails.filter((detail) => {
        const pairs = Array.isArray(detail.optionalPairs) ? detail.optionalPairs : [];
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
          const eidText =
            detail.srcEid !== undefined && detail.srcEid !== null
              ? `EID ${detail.srcEid}`
              : "EID —";
          const labelParts = [
            eidText,
            detail.optionalSummary
              ? `quorum ${detail.optionalSummary}`
              : detail.usesSentinel
                ? "sentinel"
                : "optional DVNs",
          ];
          header.textContent = labelParts.join(" • ");
          block.appendChild(header);

          const optionalPairs = Array.isArray(detail.optionalPairs) ? detail.optionalPairs : [];
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
      tr.appendChild(optionalCell);

      const edgesCell = document.createElement("td");
      edgesCell.className = "metric-cell";
      const edgeParts = [`${metric.activeIncomingCount} active`];
      if (metric.blockedIncomingCount > 0) {
        edgeParts.push(`${metric.blockedIncomingCount} blocked`);
      }
      edgesCell.textContent = edgeParts.join(" / ");
      if (hasEdgeVariation && metric.isTracked && !metric.isBlocked) {
        if (edgeLows.includes(metric.id)) {
          edgesCell.classList.add("cell-extreme-low");
        } else if (edgeHighs.includes(metric.id)) {
          edgesCell.classList.add("cell-extreme-high");
        }
      }
      tr.appendChild(edgesCell);

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
      tr.appendChild(notesCell);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    if (renameActions) {
      container.appendChild(renameActions);
    }
    container.appendChild(table);

    return container;
  }

  calculateEdgeSecurityInfo(edges, nodesById) {
    const edgeSecurityInfo = [];
    let maxRequiredDVNsInWeb = 0;
    const combinationStatsMap = new Map();

    for (const edge of edges) {
      const fromNode = nodesById.get(edge.from);
      const toNode = nodesById.get(edge.to);
      const isUntrackedTarget = Boolean(toNode) && !toNode.isTracked;
      let requiredDVNCount = 0;
      let requiredDVNAddresses = [];
      let requiredDVNLabels = [];
      let optionalDVNLabels = [];
      let optionalDVNCount = 0;
      let optionalDVNThreshold = 0;
      let usesSentinel = false;
      let isBlocked = false;
      let blockReason = null;

      // Check if this is a stale peer (target node's config points to a different peer for this srcEid)
      if (edge.isStalePeer) {
        isBlocked = true;
        blockReason = "stale-peer";
      }

      // Check if peer is zero address (blocks all traffic from that EID)
      if (!isBlocked && edge.peerRaw && this.isZeroPeer(edge.peerRaw)) {
        isBlocked = true;
        blockReason = "zero-peer";
      }

      let hasSecurityConfig = false;

      if (toNode?.securityConfigs && toNode.isTracked) {
        const config = toNode.securityConfigs.find(
          (cfg) => String(cfg.srcEid) === String(edge.srcEid),
        );
        if (config) {
          hasSecurityConfig = true;
          requiredDVNCount = config.requiredDVNCount || 0;
          requiredDVNAddresses = config.requiredDVNs || [];
          requiredDVNLabels = config.requiredDVNLabels || config.requiredDVNs || [];
          optionalDVNLabels = config.optionalDVNLabels || config.optionalDVNs || [];
          optionalDVNCount =
            config.optionalDVNCount ||
            (Array.isArray(optionalDVNLabels) ? optionalDVNLabels.length : 0);
          optionalDVNThreshold = config.optionalDVNThreshold || 0;
          usesSentinel = Boolean(config.usesRequiredDVNSentinel);

          // Check for dead address in DVNs
          if (!isBlocked && requiredDVNAddresses.some((addr) => this.isDeadAddress(addr))) {
            isBlocked = true;
            blockReason = "dead-dvn";
          }
          if (!isBlocked && requiredDVNLabels.some((label) => this.isBlockingDvnLabel(label))) {
            isBlocked = true;
            blockReason = "blocking-dvn";
          }
        }
      }

      if (!isBlocked && hasSecurityConfig && requiredDVNCount > maxRequiredDVNsInWeb) {
        maxRequiredDVNsInWeb = requiredDVNCount;
      }

      const normalizedRequiredNames = (requiredDVNLabels || [])
        .map((name) =>
          name === null || name === undefined ? "" : String(name).trim().toLowerCase(),
        )
        .filter(Boolean)
        .sort();

      const combinationFingerprint = hasSecurityConfig
        ? JSON.stringify({
            required: requiredDVNCount,
            names: normalizedRequiredNames,
            sentinel: usesSentinel,
          })
        : null;

      const isUnknownSecurity = !hasSecurityConfig && isUntrackedTarget;

      const routeFromLabel = this.resolveNodeChainLabel(fromNode, edge.from, edge.srcEid);
      const routeToLabel = this.resolveNodeChainLabel(toNode, edge.to, toNode?.localEid);

      const info = {
        edge,
        requiredDVNCount,
        requiredDVNAddresses,
        requiredDVNLabels,
        normalizedRequiredNames,
        optionalDVNLabels,
        optionalDVNCount,
        optionalDVNThreshold,
        usesSentinel,
        combinationFingerprint,
        hasSecurityConfig,
        isUnknownSecurity,
        isBlocked,
        blockReason,
        routeFromLabel,
        routeToLabel,
        differsFromPopular: false,
        matchesPopularCombination: false,
        differenceReasons: [],
      };

      edgeSecurityInfo.push(info);

      if (!isBlocked && hasSecurityConfig) {
        let entry = combinationStatsMap.get(combinationFingerprint);
        if (!entry) {
          entry = {
            fingerprint: combinationFingerprint,
            count: 0,
            requiredDVNCount,
            normalizedNames: normalizedRequiredNames,
            labelsSample: requiredDVNLabels.slice(),
            usesSentinel,
            edges: [],
            toNodes: new Set(),
            fromNodes: new Set(),
            srcEids: new Set(),
            optionalCounts: new Set(),
            optionalThresholds: new Set(),
            sampleInfo: {
              requiredDVNLabels: requiredDVNLabels.slice(),
              requiredDVNCount,
              optionalDVNLabels: optionalDVNLabels.slice(),
              optionalDVNCount,
              optionalDVNThreshold,
              usesSentinel,
            },
          };
          combinationStatsMap.set(combinationFingerprint, entry);
        }
        entry.count += 1;
        entry.edges.push(info);
        entry.toNodes.add(edge.to);
        entry.fromNodes.add(edge.from);
        if (edge.srcEid !== undefined && edge.srcEid !== null) {
          entry.srcEids.add(String(edge.srcEid));
        }
        entry.optionalCounts.add(optionalDVNCount || 0);
        entry.optionalThresholds.add(optionalDVNThreshold || 0);
      }
    }

    const combinationStatsList = Array.from(combinationStatsMap.values());
    const totalActiveEdges = combinationStatsList.reduce((sum, entry) => sum + entry.count, 0);

    // Determine dominant combination (prefer non-sentinel sets)
    let dominantEntry = null;
    const primaryPool = combinationStatsList.filter((entry) => !entry.usesSentinel);
    const fallbackPool = primaryPool.length > 0 ? primaryPool : combinationStatsList;
    if (fallbackPool.length > 0) {
      dominantEntry = [...fallbackPool].sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (b.requiredDVNCount !== a.requiredDVNCount) {
          return b.requiredDVNCount - a.requiredDVNCount;
        }
        return a.fingerprint.localeCompare(b.fingerprint);
      })[0];
      dominantEntry.share = totalActiveEdges > 0 ? dominantEntry.count / totalActiveEdges : 0;
    }

    const dominantFingerprint = dominantEntry?.fingerprint ?? null;

    for (const info of edgeSecurityInfo) {
      const matchesPopular =
        info.hasSecurityConfig &&
        Boolean(dominantFingerprint) &&
        !info.isBlocked &&
        !info.usesSentinel &&
        info.combinationFingerprint === dominantFingerprint;

      info.matchesPopularCombination = matchesPopular;

      const differsDueToSentinel = info.hasSecurityConfig && info.usesSentinel;
      const differsDueToCombination =
        info.hasSecurityConfig &&
        Boolean(dominantFingerprint) &&
        !info.isBlocked &&
        info.combinationFingerprint !== dominantFingerprint;

      info.differsFromPopular =
        info.hasSecurityConfig &&
        !info.isBlocked &&
        (differsDueToSentinel || differsDueToCombination);

      if (differsDueToCombination && dominantEntry) {
        if (info.requiredDVNCount !== dominantEntry.requiredDVNCount) {
          info.differenceReasons.push(
            `required DVN count ${info.requiredDVNCount} vs dominant ${dominantEntry.requiredDVNCount}`,
          );
        }
        if (
          !this.areStringArraysEqual(info.normalizedRequiredNames, dominantEntry.normalizedNames)
        ) {
          info.differenceReasons.push("validator set differs");
        }
      }

      if (differsDueToSentinel) {
        const quorumLabel =
          info.optionalDVNCount > 0
            ? `${info.optionalDVNThreshold}/${info.optionalDVNCount}`
            : `${info.optionalDVNThreshold}`;
        info.differenceReasons.push(`sentinel quorum ${quorumLabel}`);
      }

      if (
        info.hasSecurityConfig &&
        !info.isBlocked &&
        maxRequiredDVNsInWeb > 0 &&
        info.requiredDVNCount < maxRequiredDVNsInWeb
      ) {
        info.differenceReasons.push(
          `requires ${info.requiredDVNCount} vs web max ${maxRequiredDVNsInWeb}`,
        );
      }
    }

    const combinationStats = combinationStatsList.map((entry) => ({
      fingerprint: entry.fingerprint,
      count: entry.count,
      share: totalActiveEdges > 0 ? entry.count / totalActiveEdges : 0,
      requiredDVNCount: entry.requiredDVNCount,
      normalizedNames: entry.normalizedNames,
      labelsSample: entry.labelsSample,
      usesSentinel: entry.usesSentinel,
      edges: entry.edges,
      toNodes: Array.from(entry.toNodes),
      fromNodes: Array.from(entry.fromNodes),
      srcEids: Array.from(entry.srcEids),
      optionalCounts: Array.from(entry.optionalCounts),
      optionalThresholds: Array.from(entry.optionalThresholds),
      optionalLabelsSample: entry.sampleInfo?.optionalDVNLabels ?? [],
      sampleInfo: entry.sampleInfo,
    }));

    return {
      edgeSecurityInfo,
      maxRequiredDVNsInWeb,
      combinationStats,
      dominantCombination: dominantEntry,
    };
  }

  calculateMaxMinRequiredDVNsForNodes(nodes) {
    let max = 0;

    for (const node of nodes) {
      if (node.isDangling || !node.securityConfigs?.length) continue;

      const nonBlockedConfigs = node.securityConfigs.filter(
        (cfg) => !this.configHasBlockingDvn(cfg),
      );

      if (nonBlockedConfigs.length > 0) {
        const min = Math.min(
          ...nonBlockedConfigs.map((c) =>
            Number.isFinite(c.requiredDVNCount) ? c.requiredDVNCount : 0,
          ),
        );
        if (min > max) max = min;
      }
    }

    return max;
  }

  isDeadAddress(address) {
    return String(address).toLowerCase() === this.deadAddress.toLowerCase();
  }

  isBlockingDvnLabel(label) {
    if (label === null || label === undefined) {
      return false;
    }
    return String(label).trim().toLowerCase() === "lzdeaddvn";
  }

  configHasBlockingDvn(config) {
    if (!config) {
      return false;
    }
    const requiredAddresses = Array.isArray(config.requiredDVNs) ? config.requiredDVNs : [];
    const requiredLabels = Array.isArray(config.requiredDVNLabels) ? config.requiredDVNLabels : [];
    return (
      requiredAddresses.some((addr) => this.isDeadAddress(addr)) ||
      requiredLabels.some((label) => this.isBlockingDvnLabel(label))
    );
  }

  isZeroPeer(peerAddress) {
    return String(peerAddress).toLowerCase() === this.zeroPeer.toLowerCase();
  }

  findBlockedNodes(nodes, edgeSecurityInfo) {
    // Build a map of nodeId -> incoming edges (edges pointing TO this node)
    const incomingEdges = new Map();
    for (const info of edgeSecurityInfo) {
      const toNodeId = info.edge.to;
      if (!incomingEdges.has(toNodeId)) {
        incomingEdges.set(toNodeId, []);
      }
      incomingEdges.get(toNodeId).push(info);
    }

    // Find nodes that cannot send packets to monitored nodes (all incoming edges blocked)
    const blocked = new Set();
    for (const node of nodes) {
      const incoming = incomingEdges.get(node.id) || [];

      // Skip the seed node
      if (node.depth === 0) continue;

      // If the node has incoming edges, check if ALL are blocked
      if (incoming.length > 0) {
        const allBlocked = incoming.every((info) => info.isBlocked);
        if (allBlocked) {
          blocked.add(node.id);
        }
      } else if (node.isDangling) {
        // Dangling nodes with no incoming edges are also blocked
        blocked.add(node.id);
      }
    }

    return blocked;
  }

  areStringArraysEqual(a = [], b = []) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return Array.isArray(a) === Array.isArray(b);
    }
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  appendSummaryRow(list, label, value) {
    if (!list || (!value && value !== 0)) return;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    list.append(dt, dd);
  }

  describeCombination(combination) {
    if (!combination) {
      return "";
    }

    const sample = combination.sampleInfo || {};
    const requiredCount = combination.requiredDVNCount ?? sample.requiredDVNCount ?? 0;
    const requiredLabels =
      (Array.isArray(sample.requiredDVNLabels) && sample.requiredDVNLabels.length
        ? sample.requiredDVNLabels
        : combination.labelsSample) || [];

    const base =
      requiredLabels.length > 0
        ? `${requiredCount} required: ${requiredLabels.join(", ")}`
        : `${requiredCount} required DVNs`;

    if (!combination.usesSentinel) {
      return base;
    }

    const optionalLabels =
      (Array.isArray(sample.optionalDVNLabels) && sample.optionalDVNLabels.length
        ? sample.optionalDVNLabels
        : combination.optionalLabelsSample) || [];
    const optionalCount =
      sample.optionalDVNCount ??
      (Array.isArray(combination.optionalCounts) && combination.optionalCounts.length
        ? combination.optionalCounts[0]
        : 0);
    const optionalThreshold =
      sample.optionalDVNThreshold ??
      (Array.isArray(combination.optionalThresholds) && combination.optionalThresholds.length
        ? combination.optionalThresholds[0]
        : 0);

    const quorumLabel =
      optionalCount > 0 ? `${optionalThreshold}/${optionalCount}` : `${optionalThreshold}`;
    const optionalText = optionalLabels.length > 0 ? ` → ${optionalLabels.join(", ")}` : "";

    return `${base} (sentinel, quorum ${quorumLabel}${optionalText})`;
  }

  shortenAddress(value) {
    if (!value) {
      return "";
    }
    const str = String(value);
    if (str.length <= 12) {
      return str;
    }
    return `${str.slice(0, 6)}..${str.slice(-4)}`;
  }

  formatChainLabel(chainId) {
    if (chainId === undefined || chainId === null || chainId === "") {
      return "";
    }
    const display = this.getChainDisplayLabel(chainId);
    if (display) {
      return display;
    }
    const str = String(chainId);
    if (str.startsWith("eid-")) {
      const suffix = str.slice(4);
      return suffix ? `EID ${suffix} (unmapped)` : "EID (unmapped)";
    }
    return str;
  }

  resolveNodeChainLabel(node, nodeId, fallbackEid) {
    let chainSource = null;
    if (node && node.localEid !== undefined && node.localEid !== null && node.localEid !== "") {
      chainSource = node.localEid;
    } else if (node && typeof node.id === "string" && node.id.includes("_")) {
      chainSource = node.id.split("_")[0];
    } else if (typeof nodeId === "string" && nodeId.includes("_")) {
      chainSource = nodeId.split("_")[0];
    } else if (fallbackEid !== undefined && fallbackEid !== null && fallbackEid !== "") {
      chainSource = fallbackEid;
    }

    if (chainSource === null || chainSource === undefined || chainSource === "") {
      return "";
    }

    const normalized = typeof chainSource === "string" ? chainSource : String(chainSource);
    const label = this.formatChainLabel(normalized);
    return label || normalized;
  }

  getNodeSecurityMetrics(node) {
    const configs = Array.isArray(node?.securityConfigs) ? node.securityConfigs : [];
    const nonBlockedConfigs = configs.filter((cfg) => !this.configHasBlockingDvn(cfg));

    const minRequiredDVNs =
      nonBlockedConfigs.length > 0
        ? Math.min(
            ...nonBlockedConfigs.map((c) =>
              Number.isFinite(c.requiredDVNCount) ? c.requiredDVNCount : 0,
            ),
          )
        : 0;

    return {
      minRequiredDVNs,
      hasBlockedConfig: configs.some((cfg) => this.configHasBlockingDvn(cfg)),
    };
  }

  /**
   * Simple string hash function for deterministic variation
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash = hash | 0; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Find the most connected tracked node (highest total edge count)
   */
  findMostConnectedNode(nodes, edges) {
    const edgeCounts = new Map();

    // Count edges for each node
    for (const edge of edges) {
      edgeCounts.set(edge.from, (edgeCounts.get(edge.from) || 0) + 1);
      edgeCounts.set(edge.to, (edgeCounts.get(edge.to) || 0) + 1);
    }

    // Find tracked node with most edges
    let maxCount = 0;
    let mostConnected = nodes[0]?.id || null;

    for (const node of nodes) {
      if (!node.isTracked) continue;
      const count = edgeCounts.get(node.id) || 0;
      if (count > maxCount) {
        maxCount = count;
        mostConnected = node.id;
      }
    }

    return mostConnected;
  }

  /**
   * Calculate distance from center node using BFS
   */
  calculateDistancesFromCenter(nodes, edges, centerNodeId) {
    const distances = new Map();
    const adjacency = new Map();

    // Build adjacency list (undirected graph)
    for (const node of nodes) {
      adjacency.set(node.id, []);
    }
    for (const edge of edges) {
      if (adjacency.has(edge.from)) adjacency.get(edge.from).push(edge.to);
      if (adjacency.has(edge.to)) adjacency.get(edge.to).push(edge.from);
    }

    // BFS from center
    const queue = [{ id: centerNodeId, distance: 0 }];
    const visited = new Set([centerNodeId]);
    distances.set(centerNodeId, 0);

    while (queue.length > 0) {
      const { id, distance } = queue.shift();
      const neighbors = adjacency.get(id) || [];

      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          distances.set(neighborId, distance + 1);
          queue.push({ id: neighborId, distance: distance + 1 });
        }
      }
    }

    // Assign max distance to unreachable nodes
    const maxDistance = Math.max(...Array.from(distances.values()), 0);
    for (const node of nodes) {
      if (!distances.has(node.id)) {
        distances.set(node.id, maxDistance + 1);
      }
    }

    return distances;
  }

  layoutNodes(nodes, edges, centerNodeId) {
    const positions = new Map();

    if (nodes.length === 0) return positions;

    // Calculate distances from center node
    const distances = this.calculateDistancesFromCenter(nodes, edges, centerNodeId);

    // Group nodes by distance
    const nodesByDistance = new Map();
    for (const node of nodes) {
      const distance = distances.get(node.id) ?? 999;
      if (!nodesByDistance.has(distance)) {
        nodesByDistance.set(distance, []);
      }
      nodesByDistance.get(distance).push(node);
    }

    // Sort nodes within each distance: tracked first (by packet count), then untracked (by packet count)
    for (const [distance, distanceNodes] of nodesByDistance.entries()) {
      distanceNodes.sort((a, b) => {
        // Tracked nodes come first
        if (a.isTracked !== b.isTracked) {
          return a.isTracked ? -1 : 1;
        }
        // Within tracked or untracked groups, sort by packet count (descending)
        const packetsA = a.totalPacketsReceived || 0;
        const packetsB = b.totalPacketsReceived || 0;
        if (packetsA !== packetsB) {
          return packetsB - packetsA;
        }
        // Stable sort by id
        return a.id.localeCompare(b.id);
      });
    }

    // Apply column splitting to all distances
    const distancesToProcess = Array.from(nodesByDistance.keys()).filter((d) => d !== 0 && d < 999);
    for (const originalDistance of distancesToProcess) {
      const distanceNodes = nodesByDistance.get(originalDistance);
      if (!distanceNodes || distanceNodes.length <= 1) continue;

      // Special handling for distance 1: separate tracked (left) and untracked (right)
      if (originalDistance === 1) {
        const trackedNodes = distanceNodes.filter((n) => n.isTracked);
        const untrackedNodes = distanceNodes.filter((n) => !n.isTracked);

        // Process tracked nodes (left side, mirrored)
        if (trackedNodes.length > 0) {
          this.splitIntoColumns(trackedNodes, nodesByDistance, -0.1, -0.1);
        }

        // Process untracked nodes (right side)
        if (untrackedNodes.length > 0) {
          this.splitIntoColumns(untrackedNodes, nodesByDistance, originalDistance + 0.1, 0.1);
        }
      } else {
        // For all other distances, just split into columns if needed
        this.splitIntoColumns(distanceNodes, nodesByDistance, originalDistance + 0.1, 0.1);
      }

      nodesByDistance.delete(originalDistance);
    }

    const distanceKeys = Array.from(nodesByDistance.keys()).sort((a, b) => a - b);
    const centerX = this.width / 2;

    // Pre-calculate left and right column distances for indexing
    const leftDistances = distanceKeys.filter((d) => d < 0).sort((a, b) => b - a); // Sort descending: -0.1, -0.2, -0.3...
    const rightDistances = distanceKeys.filter((d) => d > 0).sort((a, b) => a - b); // Sort ascending: 0.1, 0.2, 0.3...

    for (const distance of distanceKeys) {
      const nodesAtDistance = nodesByDistance.get(distance);

      // Calculate x position using simple constant spacing
      let baseX;
      if (distance === 0) {
        // Center node
        baseX = centerX;
      } else if (distance < 0) {
        // Left side: each column to the left of center
        const columnIndex = leftDistances.indexOf(distance);
        baseX = centerX - this.seedGap - columnIndex * this.columnSpacing;
      } else {
        // Right side: each column to the right of center
        const columnIndex = rightDistances.indexOf(distance);
        baseX = centerX + this.seedGap + columnIndex * this.columnSpacing;
      }

      const verticalSpacing =
        (this.height - 2 * this.padding) / Math.max(nodesAtDistance.length - 1, 1);

      for (const [index, node] of nodesAtDistance.entries()) {
        const baseY =
          this.padding +
          (nodesAtDistance.length === 1
            ? (this.height - 2 * this.padding) / 2
            : verticalSpacing * index);

        const centerIndex = (nodesAtDistance.length - 1) / 2;
        const distanceFromCenterIndex = index - centerIndex;
        const maxDistanceFromCenter = Math.max(
          centerIndex,
          nodesAtDistance.length - 1 - centerIndex,
        );
        const normalizedPosition =
          maxDistanceFromCenter > 0 ? distanceFromCenterIndex / maxDistanceFromCenter : 0;

        const xOffset =
          APP_CONFIG.GRAPH_VISUAL.ARC_INTENSITY * normalizedPosition * normalizedPosition;

        const nodeHash = this.hashString(node.id);
        const yJitter =
          (nodeHash % APP_CONFIG.GRAPH_VISUAL.HASH_MOD) - APP_CONFIG.GRAPH_VISUAL.Y_JITTER_MAX;

        // Mirror arc direction: left side (negative distance) arcs left, right side arcs right
        const x = distance < 0 ? baseX + xOffset : baseX - xOffset;
        const y = baseY + yJitter;

        positions.set(node.id, { x, y });
      }
    }

    return positions;
  }

  splitIntoColumns(nodes, nodesByDepth, baseDepth, increment) {
    if (nodes.length <= this.maxNodesPerColumn) {
      // No splitting needed, create single column
      nodesByDepth.set(baseDepth, nodes);
      return;
    }

    const numColumns = Math.max(
      1,
      Math.min(this.maxColumns, Math.ceil(nodes.length / this.maxNodesPerColumn)),
    );
    const nodesPerColumn = Math.ceil(nodes.length / numColumns);

    for (let i = 0; i < numColumns; i++) {
      const start = i * nodesPerColumn;
      const end = Math.min(start + nodesPerColumn, nodes.length);
      if (start < nodes.length) {
        const columnNodes = nodes.slice(start, end);
        if (columnNodes.length > 0) {
          const columnDepth = baseDepth + i * increment;
          nodesByDepth.set(columnDepth, columnNodes);
        }
      }
    }
  }

  setupZoomAndPan(svg, contentGroup) {
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let isPanning = false;
    let startX = 0;
    let startY = 0;

    function updateTransform() {
      contentGroup.setAttribute(
        "transform",
        `translate(${translateX}, ${translateY}) scale(${scale})`,
      );
    }

    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const svgX = (mouseX - translateX) / scale;
      const svgY = (mouseY - translateY) / scale;
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.1, Math.min(10, scale * zoomFactor));
      translateX = mouseX - svgX * newScale;
      translateY = mouseY - svgY * newScale;
      scale = newScale;
      updateTransform();
    });

    svg.addEventListener("mousedown", (e) => {
      if (e.target === svg || e.target === contentGroup) {
        isPanning = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        svg.style.cursor = "grabbing";
      }
    });

    svg.addEventListener("mousemove", (e) => {
      if (isPanning) {
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        updateTransform();
      }
    });

    svg.addEventListener("mouseup", () => {
      isPanning = false;
      svg.style.cursor = "grab";
    });

    svg.addEventListener("mouseleave", () => {
      isPanning = false;
      svg.style.cursor = "grab";
    });
  }

  setupPersistentTooltips(svg) {
    // Clear any existing tooltips from previous renders
    this.clearAllTooltips();

    let persistentTooltip = null;

    const show = (text, x, y) => {
      hide();

      persistentTooltip = document.createElement("div");
      persistentTooltip.className = "persistent-tooltip";
      persistentTooltip.style.cssText = `
        position: absolute;
        left: ${x}px;
        top: ${y}px;
        background: var(--paper);
        border: 2px solid var(--ink);
        padding: 8px 12px;
        font-family: monospace;
        font-size: 12px;
        white-space: pre-wrap;
        max-width: 400px;
        z-index: 1000;
        pointer-events: auto;
        box-shadow: 4px 4px 0 rgba(0,0,0,0.1);
        user-select: text;
      `;
      persistentTooltip.textContent = text;
      document.body.appendChild(persistentTooltip);

      const rect = persistentTooltip.getBoundingClientRect();
      if (rect.right > window.innerWidth - 10) {
        persistentTooltip.style.left = `${x - rect.width - 20}px`;
      }
      if (rect.bottom > window.innerHeight - 10) {
        persistentTooltip.style.top = `${y - rect.height - 20}px`;
      }
    };

    const hide = () => {
      if (persistentTooltip) {
        persistentTooltip.remove();
        persistentTooltip = null;
      }
    };

    const keyHandler = (e) => {
      if (e.key === "Escape") hide();
    };

    const clickHandler = (e) => {
      if (e.target === svg) hide();
    };

    document.addEventListener("keydown", keyHandler);
    svg.addEventListener("click", clickHandler);

    // Store cleanup function
    this.cleanupTooltipHandlers = () => {
      hide();
      document.removeEventListener("keydown", keyHandler);
      svg.removeEventListener("click", clickHandler);
    };

    return show;
  }

  clearAllTooltips() {
    // Remove all persistent tooltips from DOM
    document.querySelectorAll(".persistent-tooltip").forEach((el) => el.remove());

    // Clean up previous handlers if they exist
    if (this.cleanupTooltipHandlers) {
      this.cleanupTooltipHandlers();
      this.cleanupTooltipHandlers = null;
    }
  }
}
