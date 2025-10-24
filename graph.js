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
    const { edge, isBlocked, requiredDVNCount, requiredDVNs } = info;
    const style = this.getEdgeStyle(
      isBlocked,
      requiredDVNCount,
      maxRequiredDVNsInWeb,
    );

    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", fromPos.x);
    line.setAttribute("y1", fromPos.y);
    line.setAttribute("x2", toPos.x);
    line.setAttribute("y2", toPos.y);
    line.setAttribute("stroke", style.color);
    line.setAttribute("stroke-width", style.width);
    line.setAttribute("stroke-dasharray", style.dashArray);
    line.setAttribute("opacity", style.opacity);
    line.style.cursor = "pointer";

    const tooltipText = this.buildEdgeTooltip(
      edge,
      isBlocked,
      requiredDVNCount,
      requiredDVNs,
      maxRequiredDVNsInWeb,
    );
    const title = document.createElementNS(svgNS, "title");
    title.textContent = tooltipText;
    line.appendChild(title);

    line.addEventListener("click", (e) => {
      e.stopPropagation();
      showPersistentTooltip(tooltipText, e.pageX + 10, e.pageY + 10);
    });

    edgesGroup.appendChild(line);

    // Arrow
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const angle = Math.atan2(dy, dx);
    const arrowX = fromPos.x + dx * 0.75;
    const arrowY = fromPos.y + dy * 0.75;

    const arrow = this.createArrowMarker(
      svgNS,
      arrowX,
      arrowY,
      angle,
      8,
      style.color,
    );
    edgesGroup.appendChild(arrow);
  }

  renderBidirectionalEdge(
    svgNS,
    edgesGroup,
    fromPos,
    toPos,
    forwardInfo,
    reverseInfo,
    maxRequiredDVNsInWeb,
    showPersistentTooltip,
  ) {
    const forwardStyle = this.getEdgeStyle(
      forwardInfo.isBlocked,
      forwardInfo.requiredDVNCount,
      maxRequiredDVNsInWeb,
    );
    const reverseStyle = this.getEdgeStyle(
      reverseInfo.isBlocked,
      reverseInfo.requiredDVNCount,
      maxRequiredDVNsInWeb,
    );

    const midX = (fromPos.x + toPos.x) / 2;
    const midY = (fromPos.y + toPos.y) / 2;

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
      showPersistentTooltip,
    );

    // Arrows
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
        forwardStyle.color,
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
    showPersistentTooltip,
  ) {
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("stroke", style.color);
    line.setAttribute("stroke-width", style.width);
    line.setAttribute("stroke-dasharray", style.dashArray);
    line.setAttribute("opacity", style.opacity);
    line.style.cursor = "pointer";

    const tooltipText = this.buildEdgeTooltip(
      info.edge,
      info.isBlocked,
      info.requiredDVNCount,
      info.requiredDVNs,
      maxRequiredDVNsInWeb,
    );
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

  buildEdgeTooltip(
    edge,
    isBlocked,
    requiredDVNCount,
    requiredDVNs,
    maxRequiredDVNsInWeb,
  ) {
    const lines = [`${edge.from} → ${edge.to}`, `Src EID: ${edge.srcEid}`];

    if (isBlocked) {
      lines.push("STATUS: BLOCKED (dead address in DVNs)");
    } else if (maxRequiredDVNsInWeb > 0 && requiredDVNCount < maxRequiredDVNsInWeb) {
      lines.push(
        `WARNING: Lower security (${requiredDVNCount} vs max ${maxRequiredDVNsInWeb})`,
      );
    }

    if (requiredDVNs.length > 0) {
      lines.push(`Required DVNs: ${requiredDVNs.join(", ")}`);
      lines.push(`Required Count: ${requiredDVNCount}`);
    } else if (requiredDVNCount > 0) {
      lines.push(`Required DVN Count: ${requiredDVNCount}`);
    } else {
      lines.push("Required DVN Count: 0 (WARNING: No required DVNs!)");
    }

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

  renderNodes(
    svgNS,
    nodes,
    nodePositions,
    maxMinRequiredDVNsForNodes,
    showPersistentTooltip,
  ) {
    const nodesGroup = document.createElementNS(svgNS, "g");
    nodesGroup.setAttribute("class", "nodes");

    for (const node of nodes) {
      const pos = nodePositions.get(node.id);
      if (!pos) continue;

      const nonBlockedConfigs =
        node.securityConfigs?.filter((cfg) => {
          const dvns = cfg.requiredDVNs || [];
          return !dvns.some((addr) => this.isDeadAddress(addr));
        }) || [];

      const minRequiredDVNs =
        nonBlockedConfigs.length > 0
          ? Math.min(...nonBlockedConfigs.map((c) => c.requiredDVNCount))
          : 0;

      const hasBlockedConfig =
        node.securityConfigs?.some((cfg) => {
          const dvns = cfg.requiredDVNs || [];
          return dvns.some((addr) => this.isDeadAddress(addr));
        }) || false;

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

      edgeSecurityInfo.push({ edge, requiredDVNCount, requiredDVNs, isBlocked });
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

    // Split depth 1 nodes into multiple columns for better layout
    if (nodesByDepth.has(1)) {
      const depth1Nodes = nodesByDepth.get(1);
      if (depth1Nodes.length > 1) {
        const numColumns = Math.max(2, Math.min(6, Math.ceil(nodes.length / 15)));
        const nodesPerColumn = Math.ceil(depth1Nodes.length / numColumns);

        for (let i = 0; i < numColumns; i++) {
          const start = i * nodesPerColumn;
          const end = Math.min(start + nodesPerColumn, depth1Nodes.length);
          if (start < depth1Nodes.length) {
            const columnNodes = depth1Nodes.slice(start, end);
            if (columnNodes.length > 0) {
              nodesByDepth.set(1.1 + i * 0.1, columnNodes);
            }
          }
        }
        nodesByDepth.delete(1);
      }
    }

    const depths = Array.from(nodesByDepth.keys()).sort((a, b) => a - b);
    const maxDepth = Math.max(...depths.filter((d) => d < 999));
    const totalColumns = depths.filter((d) => d < 999).length;

    const depthSpacing = (this.width - 2 * this.padding) / Math.max(totalColumns - 1, 1);

    for (const [depthIndex, depth] of depths.entries()) {
      const nodesAtDepth = nodesByDepth.get(depth);
      const baseX = this.padding + depthSpacing * depthIndex;
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

        const x = baseX - xOffset;
        const y = baseY;

        positions.set(node.id, { x, y });
      }
    }

    return positions;
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
