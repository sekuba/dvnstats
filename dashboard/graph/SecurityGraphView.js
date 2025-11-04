/**
 * Security Graph View - Main coordinator for graph visualization
 */

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

/**
 * Main graph renderer - coordinates all graph visualization components
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
    this.getOAppAlias = typeof getOAppAlias === "function" ? getOAppAlias : () => null;
    this.getChainDisplayLabel =
      typeof getChainDisplayLabel === "function" ? getChainDisplayLabel : () => "";
    this.requestUniformAlias =
      typeof requestUniformAlias === "function" ? requestUniformAlias : null;

    // Initialize components
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
      onRecenter: null, // Will be set in render
    });

    this.nodeListView = new NodeListView({
      getOAppAlias: this.getOAppAlias,
      formatChainLabel: this.formatChainLabel.bind(this),
      areStringArraysEqual: this.analyzer.areStringArraysEqual.bind(this.analyzer),
      requestUniformAlias: this.requestUniformAlias,
    });
  }

  /**
   * Renders the complete web of security visualization
   */
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

    // Find the most connected tracked node to use as center
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

    const nodePositions = this.layout.layoutNodes(
      webData.nodes,
      webData.edges,
      context.centerNodeId,
    );

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
      maxEdgePacketCount,
    } = context;

    // Render edges
    const edgesGroup = this.edgeRenderer.renderEdges(
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
    const nodesGroup = this.nodeRenderer.renderNodes(
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
