/**
 * Graph Layout - Node positioning algorithm
 */

import { APP_CONFIG } from "../config.js";
import { hashString } from "./utils.js";

export class GraphLayout {
  constructor({ width, height, padding, seedGap, columnSpacing, maxNodesPerColumn, maxColumns }) {
    this.width = width || APP_CONFIG.GRAPH_VISUAL.WIDTH;
    this.height = height || APP_CONFIG.GRAPH_VISUAL.HEIGHT;
    this.padding = padding || APP_CONFIG.GRAPH_VISUAL.PADDING;
    this.seedGap = seedGap || APP_CONFIG.GRAPH_VISUAL.SEED_GAP;
    this.columnSpacing = columnSpacing || APP_CONFIG.GRAPH_VISUAL.COLUMN_SPACING;
    this.maxNodesPerColumn = maxNodesPerColumn || APP_CONFIG.GRAPH_VISUAL.MAX_NODES_PER_COLUMN;
    this.maxColumns = maxColumns || APP_CONFIG.GRAPH_VISUAL.MAX_COLUMNS;
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

  /**
   * Layout nodes using force-directed-like algorithm with columns
   */
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
        // Within each tracked group, then untracked, sort by packet count (descending)
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

        const nodeHash = hashString(node.id);
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

  /**
   * Split nodes into multiple columns if they exceed max per column
   */
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
}
