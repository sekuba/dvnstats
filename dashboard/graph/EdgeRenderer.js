import { APP_CONFIG } from "../config.js";
import { AddressUtils } from "../utils/AddressUtils.js";
import { describeCombination } from "./utils.js";

export class EdgeRenderer {
  constructor() {}

  renderEdges(
    svgNS,
    edgeSecurityInfo,
    nodePositions,
    maxRequiredDVNsInWeb,
    dominantCombination,
    showPersistentTooltip,
    maxEdgePacketCount,
  ) {
    const edgesGroup = document.createElementNS(svgNS, "g");
    edgesGroup.setAttribute("class", "edges");

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
          maxEdgePacketCount,
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
          maxEdgePacketCount,
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
    maxEdgePacketCount,
  ) {
    const style = this.getEdgeStyle(info, maxRequiredDVNsInWeb, maxEdgePacketCount);

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
    maxEdgePacketCount,
  ) {
    const forwardStyle = this.getEdgeStyle(forwardInfo, maxRequiredDVNsInWeb, maxEdgePacketCount);
    const reverseStyle = this.getEdgeStyle(reverseInfo, maxRequiredDVNsInWeb, maxEdgePacketCount);
    const midX = (fromPos.x + toPos.x) / 2;
    const midY = (fromPos.y + toPos.y) / 2;
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const angle = Math.atan2(dy, dx);

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

  getEdgeStyle(info, maxRequiredDVNsInWeb, maxEdgePacketCount) {
    if (info.isBlocked) {
      return {
        color: APP_CONFIG.GRAPH_COLORS.EDGE_BLOCKED,
        width: APP_CONFIG.GRAPH_STYLES.EDGE_BLOCKED_WIDTH,
        opacity: APP_CONFIG.GRAPH_STYLES.EDGE_BLOCKED_OPACITY,
        dashArray: APP_CONFIG.GRAPH_STYLES.EDGE_BLOCKED_DASH,
      };
    }
    if (info.isUnknownSecurity) {
      return {
        color: APP_CONFIG.GRAPH_COLORS.EDGE_UNKNOWN,
        width: APP_CONFIG.GRAPH_STYLES.EDGE_UNKNOWN_WIDTH,
        opacity: APP_CONFIG.GRAPH_STYLES.EDGE_UNKNOWN_OPACITY,
        dashArray: APP_CONFIG.GRAPH_STYLES.EDGE_UNKNOWN_DASH,
      };
    }

    const differsFromPopular = !!info.differsFromPopular;
    const baseColor = differsFromPopular
      ? APP_CONFIG.GRAPH_COLORS.EDGE_ANOMALY
      : info.requiredDVNCount < maxRequiredDVNsInWeb
        ? APP_CONFIG.GRAPH_COLORS.EDGE_WEAK
        : APP_CONFIG.GRAPH_COLORS.EDGE_NORMAL;

    let trafficStrength = 0;
    if (typeof info.packetStrength === "number") {
      trafficStrength = info.packetStrength;
    } else if (maxEdgePacketCount > 0 && typeof info.packetCount === "number") {
      trafficStrength = info.packetCount / maxEdgePacketCount;
    }
    trafficStrength = Math.max(0, Math.min(trafficStrength, 1));

    const widthBase = differsFromPopular
      ? APP_CONFIG.GRAPH_STYLES.EDGE_WIDTH_ANOMALY
      : APP_CONFIG.GRAPH_STYLES.EDGE_WIDTH_BASE;
    const width = widthBase + trafficStrength * APP_CONFIG.GRAPH_STYLES.EDGE_WIDTH_TRAFFIC;
    const opacity =
      APP_CONFIG.GRAPH_STYLES.EDGE_OPACITY_BASE +
      trafficStrength * APP_CONFIG.GRAPH_STYLES.EDGE_OPACITY_TRAFFIC;

    return {
      color: baseColor,
      width: width.toFixed(2),
      opacity: opacity.toFixed(2),
      dashArray: "none",
    };
  }

  buildEdgeTooltip(info, maxRequiredDVNsInWeb, dominantCombination) {
    const {
      edge,
      isBlocked,
      blockReason,
      peerStateHint,
      requiredDVNCount,
      requiredDVNLabels,
      optionalDVNLabels,
      optionalDVNCount,
      optionalDVNThreshold,
      usesSentinel,
      differsFromPopular,
      differenceReasons,
      packetCount,
      packetPercent,
      packetShare,
      lastPacketBlock,
      lastPacketTimestamp,
      libraryStatus,
      synthetic,
    } = info;

    let blockMessage = null;
    if (isBlocked && blockReason === "stale-peer") {
      blockMessage = "Status: BLOCKED (stale peer)";
    } else if (isBlocked && blockReason === "zero-peer") {
      blockMessage = "Status: BLOCKED (peer set to zero address)";
    } else if (isBlocked && blockReason === "implicit-block") {
      blockMessage = "Status: BLOCKED / unknown (peer not configured)";
    } else if (isBlocked && blockReason === "blocking-dvn") {
      blockMessage = "Status: BLOCKED (blocking DVN)";
    } else if (isBlocked && blockReason === "dead-dvn") {
      blockMessage = "Status: BLOCKED (dead DVN)";
    } else if (isBlocked && blockReason === "missing-library") {
      blockMessage = "Status: BLOCKED (missing default receive library)";
    } else if (isBlocked) {
      blockMessage = "Status: BLOCKED";
    }

    const hasSecurityConfig = !!info.hasSecurityConfig;
    const unknownMessage = info.isUnknownSecurity ? "Unknown security config (untracked)" : null;
    const routeLine = this.buildRouteLabel(info);

    const requiredLine = hasSecurityConfig
      ? requiredDVNLabels && requiredDVNLabels.length > 0
        ? `Required DVNs (${requiredDVNCount}): ${requiredDVNLabels.join(", ")}`
        : `Required DVN Count: ${requiredDVNCount}`
      : "Required DVNs: unknown";

    const optionalLine =
      hasSecurityConfig && optionalDVNCount > 0
        ? `Optional DVNs quorum ${optionalDVNThreshold}/${optionalDVNCount}${optionalDVNLabels && optionalDVNLabels.length ? ` → ${optionalDVNLabels.join(", ")}` : ""}`
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
      ? `Dominant set: ${describeCombination(dominantCombination)}`
      : null;

    const trafficPercent =
      Number.isFinite(packetPercent) && packetPercent > 0
        ? packetPercent.toFixed(packetPercent >= 10 ? 1 : 2)
        : null;
    const hasPackets = packetCount > 0;
    const trafficLine = hasPackets
      ? `Traffic: ${packetCount.toLocaleString("en-US")} packets${
          trafficPercent ? ` (${trafficPercent}% inbound share)` : ""
        }`
      : packetShare && packetShare > 0
        ? `Traffic: ${(packetShare * 100).toFixed(2)}% inbound share`
        : null;

    let lastPacketLine = null;
    if (hasPackets && lastPacketTimestamp) {
      const date = new Date(lastPacketTimestamp * 1000);
      const human =
        Number.isFinite(date.getTime()) && date.getTime() > 0
          ? date.toLocaleString()
          : String(lastPacketTimestamp);
      lastPacketLine = lastPacketBlock
        ? `Last packet: ${human} (Block ${lastPacketBlock})`
        : `Last packet: ${human}`;
    } else if (hasPackets && lastPacketBlock) {
      lastPacketLine = `Last packet block: ${lastPacketBlock}`;
    }

    let libraryLine = null;
    if (libraryStatus === "none") {
      libraryLine = "Receive library: none configured";
    } else if (libraryStatus === "unsupported") {
      libraryLine = "Receive library: unsupported (ULN unavailable)";
    }

    let peerHintLine = null;
    if (peerStateHint === "auto-discovered") {
      peerHintLine = "Peer source: auto-discovered from packets";
    } else if (peerStateHint === "explicit") {
      peerHintLine = "Peer source: explicit configuration";
    } else if (peerStateHint === "implicit-blocked") {
      peerHintLine = "Peer source: missing (implicit block)";
    }

    const resolutionLine = synthetic
      ? "Config resolved from defaults (no materialized route)"
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
      libraryLine,
      peerHintLine,
      resolutionLine,
      trafficLine,
      lastPacketLine,
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
}
