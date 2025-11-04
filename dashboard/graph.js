/**
 * SVG Graph Visualization for Security Web
 *
 * This file serves as a barrel export for backwards compatibility.
 * The actual implementations have been moved to separate modules:
 *
 * - graph/SecurityGraphView.js - Main coordinator
 * - graph/GraphAnalyzer.js - Edge analysis and metrics
 * - graph/GraphLayout.js - Node positioning algorithm
 * - graph/GraphInteractions.js - Zoom, pan, tooltips
 * - graph/EdgeRenderer.js - Edge SVG rendering
 * - graph/NodeRenderer.js - Node SVG rendering
 * - graph/NodeListView.js - Node list panel
 * - graph/utils.js - Utility functions
 */

export { SecurityGraphView } from "./graph/SecurityGraphView.js";
