
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

    calculateDistancesFromCenter(nodes, edges, centerNodeId) {
    const distances = new Map();
    const adjacency = new Map();

    
    for (const node of nodes) {
      adjacency.set(node.id, []);
    }
    for (const edge of edges) {
      if (adjacency.has(edge.from)) adjacency.get(edge.from).push(edge.to);
      if (adjacency.has(edge.to)) adjacency.get(edge.to).push(edge.from);
    }

    
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

    
    const distances = this.calculateDistancesFromCenter(nodes, edges, centerNodeId);

    
    const nodesByDistance = new Map();
    for (const node of nodes) {
      const distance = distances.get(node.id) ?? 999;
      if (!nodesByDistance.has(distance)) {
        nodesByDistance.set(distance, []);
      }
      nodesByDistance.get(distance).push(node);
    }

    
    for (const [distance, distanceNodes] of nodesByDistance.entries()) {
      distanceNodes.sort((a, b) => {
        
        if (a.isTracked !== b.isTracked) {
          return a.isTracked ? -1 : 1;
        }
        
        const packetsA = a.totalPacketsReceived || 0;
        const packetsB = b.totalPacketsReceived || 0;
        if (packetsA !== packetsB) {
          return packetsB - packetsA;
        }
        
        return a.id.localeCompare(b.id);
      });
    }

    
    const distancesToProcess = Array.from(nodesByDistance.keys()).filter((d) => d !== 0 && d < 999);
    for (const originalDistance of distancesToProcess) {
      const distanceNodes = nodesByDistance.get(originalDistance);
      if (!distanceNodes || distanceNodes.length <= 1) continue;

      
      if (originalDistance === 1) {
        const trackedNodes = distanceNodes.filter((n) => n.isTracked);
        const untrackedNodes = distanceNodes.filter((n) => !n.isTracked);

        
        if (trackedNodes.length > 0) {
          this.splitIntoColumns(trackedNodes, nodesByDistance, -0.1, -0.1);
        }

        
        if (untrackedNodes.length > 0) {
          this.splitIntoColumns(untrackedNodes, nodesByDistance, originalDistance + 0.1, 0.1);
        }
      } else {
        
        this.splitIntoColumns(distanceNodes, nodesByDistance, originalDistance + 0.1, 0.1);
      }

      nodesByDistance.delete(originalDistance);
    }

    const distanceKeys = Array.from(nodesByDistance.keys()).sort((a, b) => a - b);
    const centerX = this.width / 2;

    
    const leftDistances = distanceKeys.filter((d) => d < 0).sort((a, b) => b - a); 
    const rightDistances = distanceKeys.filter((d) => d > 0).sort((a, b) => a - b); 

    for (const distance of distanceKeys) {
      const nodesAtDistance = nodesByDistance.get(distance);

      
      let baseX;
      if (distance === 0) {
        
        baseX = centerX;
      } else if (distance < 0) {
        
        const columnIndex = leftDistances.indexOf(distance);
        baseX = centerX - this.seedGap - columnIndex * this.columnSpacing;
      } else {
        
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

        
        const x = distance < 0 ? baseX + xOffset : baseX - xOffset;
        const y = baseY + yJitter;

        positions.set(node.id, { x, y });
      }
    }

    return positions;
  }

    splitIntoColumns(nodes, nodesByDepth, baseDepth, increment) {
    if (nodes.length <= this.maxNodesPerColumn) {
      
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
