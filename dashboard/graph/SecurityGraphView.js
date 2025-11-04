import { APP_CONFIG } from "../config.js";
import { AddressUtils } from "../utils/AddressUtils.js";
import { EdgeRenderer } from "./EdgeRenderer.js";
import { GraphAnalyzer } from "./GraphAnalyzer.js";
import { GraphInteractions } from "./GraphInteractions.js";
import { GraphLayout } from "./GraphLayout.js";
import { NodeListView } from "./NodeListView.js";
import { NodeRenderer } from "./NodeRenderer.js";
import { findMostConnectedNode } from "./utils.js";

const SVG_NS = APP_CONFIG.SVG.NAMESPACE;

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
    this.getOAppAlias = typeof getOAppAlias === "function" ? getOAppAlias : () => null;
    this.getChainDisplayLabel =
      typeof getChainDisplayLabel === "function" ? getChainDisplayLabel : () => "";
    this.requestUniformAlias =
      typeof requestUniformAlias === "function" ? requestUniformAlias : null;

    this.analyzer = new GraphAnalyzer({
      getChainDisplayLabel: this.getChainDisplayLabel,
    });

    this.layout = new GraphLayout({
      width: this.width,
      height: this.height,
      padding: this.padding,
      seedGap: this.seedGap,
      columnSpacing: this.columnSpacing,
      maxNodesPerColumn: this.maxNodesPerColumn,
      maxColumns: this.maxColumns,
    });

    this.interactions = new GraphInteractions();
    this.edgeRenderer = new EdgeRenderer();
    this.nodeRenderer = new NodeRenderer({
      nodeRadius: this.nodeRadius,
      getOAppAlias: this.getOAppAlias,
      formatChainLabel: this.formatChainLabel.bind(this),
      getNodeSecurityMetrics: this.analyzer.getNodeSecurityMetrics.bind(this.analyzer),
      onRecenter: null,
    });

    this.nodeListView = new NodeListView({
      getOAppAlias: this.getOAppAlias,
      formatChainLabel: this.formatChainLabel.bind(this),
      areStringArraysEqual: this.analyzer.areStringArraysEqual.bind(this.analyzer),
      requestUniformAlias: this.requestUniformAlias,
    });
  }

  render(webData, options = {}) {
    if (!webData?.nodes || !webData?.edges) return this.renderError();

    const container = document.createElement("div");
    container.className = "web-of-security-container";

    const nodesById = new Map(webData.nodes.map((n) => [n.id, n]));
    const edgeAnalysis = this.analyzer.calculateEdgeSecurityInfo(webData.edges, nodesById);
    const maxMinRequiredDVNsForNodes = this.analyzer.calculateMaxMinRequiredDVNsForNodes(
      webData.nodes,
    );
    const blockedNodes = this.analyzer.findBlockedNodes(
      webData.nodes,
      edgeAnalysis.edgeSecurityInfo,
    );

    const centerNodeId =
      options.centerNodeId || findMostConnectedNode(webData.nodes, webData.edges);

    const context = {
      edgeSecurityInfo: edgeAnalysis.edgeSecurityInfo,
      maxRequiredDVNsInWeb: edgeAnalysis.maxRequiredDVNsInWeb,
      dominantCombination: edgeAnalysis.dominantCombination,
      combinationStats: edgeAnalysis.combinationStats,
      maxEdgePacketCount: edgeAnalysis.maxEdgePacketCount,
      totalEdgePacketCount: edgeAnalysis.totalEdgePacketCount,
      maxMinRequiredDVNsForNodes,
      blockedNodes,
      centerNodeId,
    };

    container.append(
      this.renderSummary(webData, centerNodeId),
      this.renderSVG(webData, context),
      this.nodeListView.renderNodeList(webData, context),
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

    this.interactions.setupZoomAndPan(svg, contentGroup);
    const showPersistentTooltip = this.interactions.setupPersistentTooltips(svg);

    const {
      edgeSecurityInfo,
      maxRequiredDVNsInWeb,
      dominantCombination,
      maxMinRequiredDVNsForNodes,
      blockedNodes,
      centerNodeId,
      maxEdgePacketCount,
    } = context;

    const nodePositions = this.layout.layoutNodes(
      webData.nodes,
      webData.edges,
      context.centerNodeId,
    );

    const nodesById = new Map(webData.nodes.map((node) => [node.id, node]));

    let focusMode = "none"; // "none" | "neighbors" | "path"
    let focusBaseNodeId = null;
    let visibleNodeIds = new Set();
    let visibleEdgeKeys = null;

    const adjacencyMap = new Map();
    for (const node of webData.nodes) {
      adjacencyMap.set(node.id, new Set());
    }
    for (const edge of webData.edges) {
      if (adjacencyMap.has(edge.from)) adjacencyMap.get(edge.from).add(edge.to);
      if (adjacencyMap.has(edge.to)) adjacencyMap.get(edge.to).add(edge.from);
    }

    const blockedIncomingByTarget = new Map();
    for (const info of edgeSecurityInfo) {
      const fromId = info?.edge?.from;
      const toId = info?.edge?.to;
      if (!fromId || !toId || !info.isBlocked) continue;

      if (!blockedIncomingByTarget.has(toId)) {
        blockedIncomingByTarget.set(toId, new Set());
      }
      blockedIncomingByTarget.get(toId).add(fromId);
    }

    const edgeKeySet = new Set(webData.edges.map((edge) => `${edge.from}|${edge.to}`));

    let nodesGroup = null;
    let edgesGroup = null;

    const applyVisibility = () => {
      if (!nodesGroup || !edgesGroup) return;

      if (focusMode === "none") {
        nodesGroup.querySelectorAll(".node").forEach((node) => {
          node.style.display = "";
        });
        edgesGroup.querySelectorAll("[data-edge-from]").forEach((edge) => {
          edge.style.display = "";
        });
        return;
      }

      nodesGroup.querySelectorAll(".node").forEach((node) => {
        const nodeData = node.getAttribute("data-node-id");
        node.style.display = visibleNodeIds.has(nodeData) ? "" : "none";
      });

      edgesGroup.querySelectorAll("[data-edge-from]").forEach((edge) => {
        const from = edge.getAttribute("data-edge-from");
        const to = edge.getAttribute("data-edge-to");
        let shouldShow = visibleNodeIds.has(from) && visibleNodeIds.has(to);
        if (shouldShow && visibleEdgeKeys) {
          const key = `${from}|${to}`;
          shouldShow = visibleEdgeKeys.has(key);
        }
        edge.style.display = shouldShow ? "" : "none";
      });
    };

    const setNeighborVisibility = (nodeId) => {
      const baseVisible = new Set([nodeId, ...(adjacencyMap.get(nodeId) || [])]);
      const blockedSources = blockedIncomingByTarget.get(nodeId);
      if (blockedSources?.size) {
        blockedSources.forEach((blockedNodeId) => {
          if (blockedNodeId !== nodeId) {
            baseVisible.delete(blockedNodeId);
          }
        });
      }
      visibleNodeIds = baseVisible;
      visibleEdgeKeys = null;
    };

    const findPathBetween = (startId, targetId) => {
      if (!adjacencyMap.has(startId) || !adjacencyMap.has(targetId)) {
        return null;
      }
      const queue = [startId];
      const visited = new Set([startId]);
      const parents = new Map();

      while (queue.length > 0) {
        const current = queue.shift();
        if (current === targetId) {
          const path = [];
          let walker = current;
          while (walker !== undefined) {
            path.push(walker);
            walker = parents.get(walker);
          }
          return path.reverse();
        }
        const neighbors = adjacencyMap.get(current) || new Set();
        for (const neighbor of neighbors) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          parents.set(neighbor, current);
          queue.push(neighbor);
        }
      }
      return null;
    };

    const buildPathEdgeKeys = (pathNodes) => {
      const edges = new Set();
      for (let i = 0; i < pathNodes.length - 1; i += 1) {
        const a = pathNodes[i];
        const b = pathNodes[i + 1];
        const forwardKey = `${a}|${b}`;
        const reverseKey = `${b}|${a}`;
        if (edgeKeySet.has(forwardKey)) edges.add(forwardKey);
        if (edgeKeySet.has(reverseKey)) edges.add(reverseKey);
      }
      return edges;
    };

    const updateVisibility = (nodeId, options = {}) => {
      const targetNodeIdRaw =
        typeof options.targetNodeId === "string"
          ? options.targetNodeId.trim()
          : options.targetNodeId !== undefined && options.targetNodeId !== null
            ? String(options.targetNodeId).trim()
            : "";

      const onSuccess = typeof options.onSuccess === "function" ? options.onSuccess : null;
      const onFail = typeof options.onFail === "function" ? options.onFail : null;

      if (targetNodeIdRaw) {
        const normalizedTargetId = targetNodeIdRaw;
        if (!nodesById.has(normalizedTargetId)) {
          if (onFail) onFail("OApp ID not found in this web.");
          return false;
        }
        if (normalizedTargetId === nodeId) {
          if (onFail) onFail("Target OApp ID matches the selected node.");
          return false;
        }
        const path = findPathBetween(nodeId, normalizedTargetId);
        if (!path) {
          if (onFail) onFail("No connection found between the selected nodes.");
          return false;
        }

        focusMode = "path";
        focusBaseNodeId = nodeId;
        visibleNodeIds = new Set(path);
        visibleEdgeKeys = buildPathEdgeKeys(path);
        applyVisibility();
        if (onSuccess) onSuccess(path);
        return true;
      }

      if (focusMode === "path" && focusBaseNodeId === nodeId) {
        focusMode = "none";
        focusBaseNodeId = null;
        visibleNodeIds.clear();
        visibleEdgeKeys = null;
        applyVisibility();
        return true;
      }

      if (focusMode === "neighbors" && focusBaseNodeId === nodeId) {
        focusMode = "none";
        focusBaseNodeId = null;
        visibleNodeIds.clear();
        visibleEdgeKeys = null;
        applyVisibility();
        return true;
      }

      focusMode = "neighbors";
      focusBaseNodeId = nodeId;
      setNeighborVisibility(nodeId);
      applyVisibility();
      return true;
    };

    // Render edges
    edgesGroup = this.edgeRenderer.renderEdges(
      SVG_NS,
      edgeSecurityInfo,
      nodePositions,
      maxRequiredDVNsInWeb,
      dominantCombination,
      showPersistentTooltip,
      maxEdgePacketCount,
    );

    // Render nodes
    this.nodeRenderer.onRecenter = this.onRecenter;
    nodesGroup = this.nodeRenderer.renderNodes(
      SVG_NS,
      webData.nodes,
      nodePositions,
      maxMinRequiredDVNsForNodes,
      blockedNodes,
      showPersistentTooltip,
      centerNodeId,
      updateVisibility,
    );

    contentGroup.appendChild(edgesGroup);
    contentGroup.appendChild(nodesGroup);
    svg.appendChild(contentGroup);

    return svg;
  }

  formatChainLabel(chainId) {
    if (chainId === undefined || chainId === null || chainId === "") {
      return "";
    }
    const display = this.getChainDisplayLabel(chainId);
    if (display) {
      // Strip out the EID number in parentheses for cleaner display
      return display.replace(/\s*\(\d+\)$/, "");
    }
    const str = String(chainId);
    if (str.startsWith("eid-")) {
      const suffix = str.slice(4);
      return suffix ? `EID ${suffix}` : "EID";
    }
    return `EID ${str}`;
  }
}
