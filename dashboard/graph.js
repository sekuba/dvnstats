/**
 * SVG Graph Visualization for Security Web
 * Renders interactive force-directed graph of OApp security connections
 */

import { CONFIG } from "./config.js";

/**
 * Main graph renderer
 */
export class SecurityGraphRenderer {
  constructor(getOAppAlias, getChainDisplayLabel) {
    this.width = CONFIG.SVG.WIDTH;
    this.height = CONFIG.SVG.HEIGHT;
    this.nodeRadius = CONFIG.SVG.NODE_RADIUS;
    this.padding = CONFIG.SVG.PADDING;
    this.seedGap = CONFIG.SVG.SEED_GAP;
    this.columnSpacing = CONFIG.SVG.COLUMN_SPACING;
    this.maxNodesPerColumn = CONFIG.SVG.MAX_NODES_PER_COLUMN;
    this.maxColumns = CONFIG.SVG.MAX_COLUMNS;
    this.deadAddress = CONFIG.DEAD_ADDRESS;
    this.getOAppAlias = getOAppAlias;
    this.getChainDisplayLabel = getChainDisplayLabel;
  }

  /**
   * Renders the complete web of security visualization
   */
  render(webData) {
    if (!webData || !webData.nodes || !webData.edges) {
      return this.renderError();
    }

    const container = document.createElement("div");
    container.className = "web-of-security-container";

    const summary = this.renderSummary(webData);
    container.appendChild(summary);

    const svg = this.renderSVG(webData);
    container.appendChild(svg);

    const nodeList = this.renderNodeList(webData.nodes);
    container.appendChild(nodeList);

    return container;
  }

  renderError() {
    const error = document.createElement("div");
    error.className = "placeholder";
    error.innerHTML = `
      <p class="placeholder-title">Invalid web data</p>
      <p>The loaded file does not contain valid web data.</p>
    `;
    return error;
  }

  renderSummary(webData) {
    const summary = document.createElement("div");
    summary.className = "summary-panel";
    summary.innerHTML = `
      <h3>Web of Security Overview</h3>
      <dl>
        <dt>Seed OApp</dt>
        <dd>${webData.seed || "—"}</dd>
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
      <h4 style="margin-top: 1.5rem; margin-bottom: 0.5rem;">Legend</h4>
      <dl style="font-size: 0.9em;">
        <dt>Node Color</dt>
        <dd>
          <span style="display: inline-block; background: #ffff99; padding: 2px 6px; border: 1px solid #000; margin-right: 4px;">Yellow</span>: Maximum security (min DVN count ≥ web max, excl. blocked configs)<br>
          <span style="display: inline-block; background: #ff9999; padding: 2px 6px; border: 1px solid #000; margin-right: 4px; margin-top: 4px;">Red</span>: Weak link (min DVN count &lt; web max)
        </dd>
        <dt style="margin-top: 0.5rem;">Edge Color</dt>
        <dd>
          <span style="color: #000; opacity: 0.7; font-weight: bold;">Black</span>: Maximum security (DVN count = web max)<br>
          <span style="color: #ff6666; opacity: 0.7;">Red</span>: Lower security (DVN count &lt; web max)<br>
          <span style="color: #ff0000; font-weight: bold;">Dashed Red</span>: Blocked (dead address in DVNs)
        </dd>
        <dt style="margin-top: 0.5rem;">Node Border</dt>
        <dd>
          Solid: Tracked (security config known)<br>
          Dashed: Dangling (unknown security - dangerous!)
        </dd>
      </dl>
    `;
    return summary;
  }

  renderSVG(webData) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", this.height);
    svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    svg.style.border = "1px solid var(--ink)";
    svg.style.background = "var(--paper)";
    svg.style.marginTop = "1rem";
    svg.style.cursor = "grab";

    const contentGroup = document.createElementNS(svgNS, "g");
    contentGroup.setAttribute("class", "zoom-content");

    this.setupZoomAndPan(svg, contentGroup);
    const showPersistentTooltip = this.setupPersistentTooltips(svg);

    const nodePositions = this.layoutNodes(webData.nodes);
    const nodesById = new Map(webData.nodes.map((n) => [n.id, n]));

    const { edgeSecurityInfo, maxRequiredDVNsInWeb } =
      this.calculateEdgeSecurityInfo(webData.edges, nodesById);
    const maxMinRequiredDVNsForNodes =
      this.calculateMaxMinRequiredDVNsForNodes(webData.nodes);

    // Render edges
    const edgesGroup = this.renderEdges(
      svgNS,
      edgeSecurityInfo,
      nodePositions,
      maxRequiredDVNsInWeb,
      showPersistentTooltip,
    );
    contentGroup.appendChild(edgesGroup);

    // Render nodes
    const nodesGroup = this.renderNodes(
      svgNS,
      webData.nodes,
      nodePositions,
      maxMinRequiredDVNsForNodes,
      showPersistentTooltip,
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
    showPersistentTooltip,
  ) {
    const style = this.getEdgeStyle(
      info.isBlocked,
      info.requiredDVNCount,
      maxRequiredDVNsInWeb,
    );

    this.createEdgeLine(svgNS, edgesGroup, fromPos, toPos, style, info, maxRequiredDVNsInWeb, showPersistentTooltip);

    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const angle = Math.atan2(dy, dx);

    edgesGroup.appendChild(
      this.createArrowMarker(svgNS, fromPos.x + dx * 0.75, fromPos.y + dy * 0.75, angle, 8, style.color)
    );
  }

  renderBidirectionalEdge(svgNS, edgesGroup, fromPos, toPos, forwardInfo, reverseInfo, maxRequiredDVNsInWeb, showPersistentTooltip) {
    const forwardStyle = this.getEdgeStyle(forwardInfo.isBlocked, forwardInfo.requiredDVNCount, maxRequiredDVNsInWeb);
    const reverseStyle = this.getEdgeStyle(reverseInfo.isBlocked, reverseInfo.requiredDVNCount, maxRequiredDVNsInWeb);
    const midX = (fromPos.x + toPos.x) / 2;
    const midY = (fromPos.y + toPos.y) / 2;
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const angle = Math.atan2(dy, dx);

    // Render two halves
    this.renderHalfEdge(svgNS, edgesGroup, fromPos.x, fromPos.y, midX, midY, reverseStyle, reverseInfo, maxRequiredDVNsInWeb, showPersistentTooltip);
    this.renderHalfEdge(svgNS, edgesGroup, midX, midY, toPos.x, toPos.y, forwardStyle, forwardInfo, maxRequiredDVNsInWeb, showPersistentTooltip);

    // Arrows
    edgesGroup.appendChild(this.createArrowMarker(svgNS, fromPos.x + dx * 0.75, fromPos.y + dy * 0.75, angle, 8, forwardStyle.color));
    edgesGroup.appendChild(this.createArrowMarker(svgNS, fromPos.x + dx * 0.25, fromPos.y + dy * 0.25, angle + Math.PI, 8, reverseStyle.color));
  }

  renderHalfEdge(svgNS, edgesGroup, x1, y1, x2, y2, style, info, maxRequiredDVNsInWeb, showPersistentTooltip) {
    this.createEdgeLine(svgNS, edgesGroup, { x: x1, y: y1 }, { x: x2, y: y2 }, style, info, maxRequiredDVNsInWeb, showPersistentTooltip);
  }

  createEdgeLine(svgNS, edgesGroup, fromPos, toPos, style, info, maxRequiredDVNsInWeb, showPersistentTooltip) {
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", fromPos.x);
    line.setAttribute("y1", fromPos.y);
    line.setAttribute("x2", toPos.x);
    line.setAttribute("y2", toPos.y);
    Object.assign(line.style, { cursor: "pointer" });

    Object.entries(style).forEach(([key, value]) => {
      const attrMap = { color: "stroke", width: "stroke-width", opacity: "opacity", dashArray: "stroke-dasharray" };
      line.setAttribute(attrMap[key], value);
    });

    const tooltipText = this.buildEdgeTooltip(info, maxRequiredDVNsInWeb);
    const title = document.createElementNS(svgNS, "title");
    title.textContent = tooltipText;
    line.appendChild(title);

    line.addEventListener("click", (e) => {
      e.stopPropagation();
      showPersistentTooltip(tooltipText, e.pageX + 10, e.pageY + 10);
    });

    edgesGroup.appendChild(line);
  }

  getEdgeStyle(isBlocked, requiredDVNCount, maxRequiredDVNsInWeb) {
    if (isBlocked) {
      return { color: "#ff0000", width: "1", opacity: "0.6", dashArray: "8,4" };
    }
    if (requiredDVNCount < maxRequiredDVNsInWeb) {
      return { color: "#ff6666", width: "2", opacity: "0.5", dashArray: "none" };
    }
    return { color: "#000000ff", width: "3", opacity: "0.5", dashArray: "none" };
  }

  buildEdgeTooltip(info, maxRequiredDVNsInWeb) {
    const { edge, isBlocked, requiredDVNCount, requiredDVNs, peerResolved, peerRaw } = info;
    const lines = [
      `${edge.from} → ${edge.to}`,
      `Src EID: ${edge.srcEid}`,
      edge.linkType === "peer" && "Link: PeerSet",
      isBlocked && "STATUS: BLOCKED (dead address in DVNs)",
      !isBlocked && maxRequiredDVNsInWeb > 0 && requiredDVNCount < maxRequiredDVNsInWeb &&
        `WARNING: Lower security (${requiredDVNCount} vs max ${maxRequiredDVNsInWeb})`,
      requiredDVNs.length > 0 ? `Required DVNs: ${requiredDVNs.join(", ")}` : requiredDVNCount > 0 && `Required DVN Count: ${requiredDVNCount}`,
      requiredDVNs.length > 0 && `Required Count: ${requiredDVNCount}`,
      requiredDVNCount === 0 && "Required DVN Count: 0 (WARNING: No required DVNs!)",
      peerResolved === false && "Peer unresolved (non-EVM or unknown address)",
      peerResolved === false && peerRaw && `Peer Raw: ${peerRaw}`,
      peerResolved === true && "Peer resolved",
    ].filter(Boolean);

    return lines.join("\n");
  }

  createArrowMarker(svgNS, x, y, angle, size, color) {
    const arrowGroup = document.createElementNS(svgNS, "g");
    arrowGroup.setAttribute(
      "transform",
      `translate(${x}, ${y}) rotate(${(angle * 180) / Math.PI})`,
    );

    const arrow = document.createElementNS(svgNS, "polygon");
    arrow.setAttribute(
      "points",
      `0,0 -${size},-${size / 2} -${size},${size / 2}`,
    );
    arrow.setAttribute("fill", color);
    arrow.setAttribute("opacity", "0.8");

    arrowGroup.appendChild(arrow);
    return arrowGroup;
  }

  renderNodes(svgNS, nodes, nodePositions, maxMinRequiredDVNsForNodes, showPersistentTooltip) {
    const nodesGroup = document.createElementNS(svgNS, "g");
    nodesGroup.setAttribute("class", "nodes");

    for (const node of nodes) {
      const pos = nodePositions.get(node.id);
      if (!pos) continue;

      const { minRequiredDVNs, hasBlockedConfig } = this.getNodeSecurityMetrics(node);
      const radius = node.isTracked
        ? this.nodeRadius * (0.6 + 0.4 * Math.min(minRequiredDVNs / 5, 1))
        : this.nodeRadius * 0.5;

      const nodeGroup = document.createElementNS(svgNS, "g");
      nodeGroup.setAttribute("class", "node");

      let fillColor;
      if (node.isDangling) {
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
      const titleLines = [
        alias ? `${alias} (${node.id})` : node.id,
        `Chain: ${this.getChainDisplayLabel(node.chainId) || node.chainId}`,
        `Tracked: ${node.isTracked ? "Yes" : "No"}`,
        `Total Packets: ${node.totalPacketsReceived}`,
        `Min Required DVNs: ${minRequiredDVNs}`,
      ];

      const peerConfigs = node.securityConfigs?.filter((cfg) => cfg.peer) || [];
      if (peerConfigs.length > 0) {
        const resolvedPeers = peerConfigs.filter((cfg) => cfg.peerResolved).length;
        titleLines.push(`Peers: ${resolvedPeers}/${peerConfigs.length} resolved`);
      }

      if (hasBlockedConfig) {
        titleLines.push(`WARNING: Has blocked config(s) with dead address`);
      }

      if (minRequiredDVNs < maxMinRequiredDVNsForNodes) {
        if (node.isTracked) {
          titleLines.push(
            `WEAK LINK: Lower than best node security (${minRequiredDVNs} vs ${maxMinRequiredDVNsForNodes})`,
          );
        } else {
          titleLines.push(
            `POTENTIAL WEAK LINK: Unknown security config (untracked)`,
          );
        }
      }

      const nodeTooltipText = titleLines.join("\n");
      const title = document.createElementNS(svgNS, "title");
      title.textContent = nodeTooltipText;
      circle.appendChild(title);

      circle.addEventListener("click", (e) => {
        e.stopPropagation();
        showPersistentTooltip(nodeTooltipText, e.pageX + 10, e.pageY + 10);
      });

      nodeGroup.appendChild(circle);

      // Chain label
      let chainDisplayLabel =
        this.getChainDisplayLabel(node.chainId) || `Chain ${node.chainId}`;
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

  renderNodeList(nodes) {
    const container = document.createElement("div");
    container.className = "node-list-container";
    container.style.marginTop = "2rem";

    const heading = document.createElement("h3");
    heading.textContent = "Nodes Detail";
    container.appendChild(heading);

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>OApp ID</th>
        <th>Chain</th>
        <th>Tracked</th>
        <th>Depth</th>
        <th>Security Configs</th>
        <th>Total Packets</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const node of nodes) {
      const tr = document.createElement("tr");

      const alias = this.getOAppAlias(node.id);
      const oappIdCell = document.createElement("td");
      const oappDiv = document.createElement("div");
      oappDiv.className = "copyable";
      oappDiv.dataset.copyValue = node.id;
      oappDiv.dataset.oappId = node.id;

      if (alias) {
        const aliasSpan = document.createElement("span");
        aliasSpan.textContent = alias;
        oappDiv.appendChild(aliasSpan);
        const idSpan = document.createElement("span");
        idSpan.textContent = `ID ${node.id}`;
        oappDiv.appendChild(idSpan);
      } else {
        const span = document.createElement("span");
        span.textContent = node.id;
        oappDiv.appendChild(span);
      }
      oappIdCell.appendChild(oappDiv);
      tr.appendChild(oappIdCell);

      const chainCell = document.createElement("td");
      chainCell.textContent =
        this.getChainDisplayLabel(node.chainId) || node.chainId;
      tr.appendChild(chainCell);

      const trackedCell = document.createElement("td");
      trackedCell.textContent = node.isTracked
        ? "Yes"
        : node.isDangling
          ? "No (Dangling)"
          : "No";
      tr.appendChild(trackedCell);

      const depthCell = document.createElement("td");
      depthCell.textContent = node.depth >= 0 ? node.depth : "—";
      tr.appendChild(depthCell);

      const configsCell = document.createElement("td");
      if (node.securityConfigs && node.securityConfigs.length > 0) {
        const configSummaries = node.securityConfigs.map((cfg) => {
          const requiredDVNs =
            cfg.requiredDVNs.length > 0
              ? cfg.requiredDVNs.join(", ")
              : `${cfg.requiredDVNCount} DVNs`;
          return `EID ${cfg.srcEid}: ${requiredDVNs} (${cfg.requiredDVNCount} required)`;
        });
        configsCell.innerHTML = `<div style="font-size: 0.85em">${configSummaries.slice(0, 3).join("<br>")}</div>`;
        if (configSummaries.length > 3) {
          configsCell.innerHTML += `<div style="font-size: 0.85em; opacity: 0.6">...and ${configSummaries.length - 3} more</div>`;
        }
      } else {
        configsCell.textContent = "—";
      }
      tr.appendChild(configsCell);

      const packetsCell = document.createElement("td");
      packetsCell.textContent = node.totalPacketsReceived || "—";
      tr.appendChild(packetsCell);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);

    return container;
  }

  calculateEdgeSecurityInfo(edges, nodesById) {
    const edgeSecurityInfo = [];
    let maxRequiredDVNsInWeb = 0;

    for (const edge of edges) {
      const toNode = nodesById.get(edge.to);
      let requiredDVNCount = 0;
      let requiredDVNs = [];
      let isBlocked = false;

      if (toNode?.securityConfigs) {
        const config = toNode.securityConfigs.find(
          (cfg) => String(cfg.srcEid) === String(edge.srcEid),
        );
        if (config) {
          requiredDVNCount = config.requiredDVNCount || 0;
          requiredDVNs = config.requiredDVNs || [];
          isBlocked = requiredDVNs.some((addr) => this.isDeadAddress(addr));
        }
      }

      if (!isBlocked && requiredDVNCount > maxRequiredDVNsInWeb) {
        maxRequiredDVNsInWeb = requiredDVNCount;
      }

      edgeSecurityInfo.push({
        edge,
        requiredDVNCount,
        requiredDVNs,
        isBlocked,
        peerResolved: edge.peerResolved ?? null,
        peerRaw: edge.peerRaw ?? null,
      });
    }

    return { edgeSecurityInfo, maxRequiredDVNsInWeb };
  }

  calculateMaxMinRequiredDVNsForNodes(nodes) {
    let max = 0;

    for (const node of nodes) {
      if (node.isDangling || !node.securityConfigs?.length) continue;

      const nonBlockedConfigs = node.securityConfigs.filter((cfg) => {
        const dvns = cfg.requiredDVNs || [];
        return !dvns.some((addr) => this.isDeadAddress(addr));
      });

      if (nonBlockedConfigs.length > 0) {
        const min = Math.min(...nonBlockedConfigs.map((c) => c.requiredDVNCount));
        if (min > max) max = min;
      }
    }

    return max;
  }

  isDeadAddress(address) {
    return String(address).toLowerCase() === this.deadAddress.toLowerCase();
  }

  getNodeSecurityMetrics(node) {
    const nonBlockedConfigs = node.securityConfigs?.filter((cfg) =>
      !(cfg.requiredDVNs || []).some((addr) => this.isDeadAddress(addr))
    ) || [];

    return {
      minRequiredDVNs: nonBlockedConfigs.length > 0
        ? Math.min(...nonBlockedConfigs.map((c) => c.requiredDVNCount))
        : 0,
      hasBlockedConfig: node.securityConfigs?.some((cfg) =>
        (cfg.requiredDVNs || []).some((addr) => this.isDeadAddress(addr))
      ) || false,
    };
  }

  /**
   * Simple string hash function for deterministic variation
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  layoutNodes(nodes) {
    const positions = new Map();

    if (nodes.length === 0) return positions;

    const nodesByDepth = new Map();
    for (const node of nodes) {
      const depth = node.depth >= 0 ? node.depth : 999;
      if (!nodesByDepth.has(depth)) {
        nodesByDepth.set(depth, []);
      }
      nodesByDepth.get(depth).push(node);
    }

    // Sort nodes within each depth: tracked first (by packet count), then untracked (by packet count)
    for (const [depth, depthNodes] of nodesByDepth.entries()) {
      depthNodes.sort((a, b) => {
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

    // Apply column splitting to all depths
    const depthsToProcess = Array.from(nodesByDepth.keys()).filter(d => d !== 0 && d < 999);
    for (const originalDepth of depthsToProcess) {
      const depthNodes = nodesByDepth.get(originalDepth);
      if (!depthNodes || depthNodes.length <= 1) continue;

      // Special handling for depth 1: separate tracked (left) and untracked (right)
      if (originalDepth === 1) {
        const trackedNodes = depthNodes.filter(n => n.isTracked);
        const untrackedNodes = depthNodes.filter(n => !n.isTracked);

        // Process tracked nodes (left side, mirrored)
        if (trackedNodes.length > 0) {
          this.splitIntoColumns(trackedNodes, nodesByDepth, -0.1, -0.1);
        }

        // Process untracked nodes (right side)
        if (untrackedNodes.length > 0) {
          this.splitIntoColumns(untrackedNodes, nodesByDepth, originalDepth + 0.1, 0.1);
        }
      } else {
        // For all other depths, just split into columns if needed
        this.splitIntoColumns(depthNodes, nodesByDepth, originalDepth + 0.1, 0.1);
      }

      nodesByDepth.delete(originalDepth);
    }

    const depths = Array.from(nodesByDepth.keys()).sort((a, b) => a - b);
    const centerX = this.width / 2;

    // Pre-calculate left and right column depths for indexing
    const leftDepths = depths.filter(d => d < 0).sort((a, b) => b - a); // Sort descending: -0.1, -0.2, -0.3...
    const rightDepths = depths.filter(d => d > 1).sort((a, b) => a - b); // Sort ascending: 1.1, 1.2, 1.3...

    for (const depth of depths) {
      const nodesAtDepth = nodesByDepth.get(depth);

      // Calculate x position using simple constant spacing
      let baseX;
      if (depth === 0) {
        // Seed node at center
        baseX = centerX;
      } else if (depth < 0) {
        // Left side: each column to the left of seed
        const columnIndex = leftDepths.indexOf(depth);
        baseX = centerX - this.seedGap - (columnIndex * this.columnSpacing);
      } else {
        // Right side: each column to the right of seed
        const columnIndex = rightDepths.indexOf(depth);
        baseX = centerX + this.seedGap + (columnIndex * this.columnSpacing);
      }

      const verticalSpacing =
        (this.height - 2 * this.padding) / Math.max(nodesAtDepth.length - 1, 1);

      for (const [index, node] of nodesAtDepth.entries()) {
        const baseY =
          this.padding +
          (nodesAtDepth.length === 1
            ? (this.height - 2 * this.padding) / 2
            : verticalSpacing * index);

        const centerIndex = (nodesAtDepth.length - 1) / 2;
        const distanceFromCenterIndex = index - centerIndex;
        const maxDistanceFromCenter = Math.max(
          centerIndex,
          nodesAtDepth.length - 1 - centerIndex,
        );
        const normalizedPosition =
          maxDistanceFromCenter > 0 ? distanceFromCenterIndex / maxDistanceFromCenter : 0;

        const arcIntensity = 200;
        const xOffset = arcIntensity * normalizedPosition * normalizedPosition;

        // Add deterministic y-variation to prevent perfect vertical alignment
        const nodeHash = this.hashString(node.id);
        const yJitter = (nodeHash % 31) - 15; // -15 to +15 pixel variation

        // Mirror arc direction: left side (negative depth) arcs left, right side arcs right
        const x = depth < 0 ? baseX + xOffset : baseX - xOffset;
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

    const numColumns = Math.max(1, Math.min(this.maxColumns, Math.ceil(nodes.length / this.maxNodesPerColumn)));
    const nodesPerColumn = Math.ceil(nodes.length / numColumns);

    for (let i = 0; i < numColumns; i++) {
      const start = i * nodesPerColumn;
      const end = Math.min(start + nodesPerColumn, nodes.length);
      if (start < nodes.length) {
        const columnNodes = nodes.slice(start, end);
        if (columnNodes.length > 0) {
          const columnDepth = baseDepth + (i * increment);
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
    let persistentTooltip = null;

    function show(text, x, y) {
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
    }

    function hide() {
      if (persistentTooltip) {
        persistentTooltip.remove();
        persistentTooltip = null;
      }
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hide();
    });

    svg.addEventListener("click", (e) => {
      if (e.target === svg) hide();
    });

    return show;
  }
}
