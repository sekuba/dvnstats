/**
 * Centralized configuration for the LayerZero Security Config Explorer
 */

export const CONFIG = {
  // GraphQL endpoint - can be overridden via URL param or data attribute
  GRAPHQL_ENDPOINT:
    new URLSearchParams(window.location.search).get("endpoint") ||
    document.documentElement.dataset.graphqlEndpoint ||
    "http://localhost:8080/v1/graphql",

  // Dead address used for blocked DVN detection
  DEAD_ADDRESS: "0x000000000000000000000000000000000000dead",

  // Zero address (bytes32) for blocked peer detection
  ZERO_PEER: "0x0000000000000000000000000000000000000000000000000000000000000000",

  // SVG graph rendering constants
  SVG: {
    WIDTH: 1600,
    HEIGHT: 1200,
    NODE_RADIUS: 40,
    PADDING: 150,
    SEED_GAP: 400,           // Distance from seed to first column (left/right)
    COLUMN_SPACING: 300,     // Distance between subsequent columns
    MAX_NODES_PER_COLUMN: 8, // Max nodes in a single column before splitting
    MAX_COLUMNS: 20,         // Max number of columns per side
  },

  // Security web crawler settings
  CRAWLER: {
    DEFAULT_DEPTH: 10,
  },

  // UI interaction settings
  UI: {
    TOAST_DURATION: 1600,
    MAX_TOASTS: 6,
    COPY_FEEDBACK_DURATION: 1200,
    BUTTON_FEEDBACK_DURATION: 1800,
  },

  // Data sources
  DATA_SOURCES: {
    CHAIN_METADATA: [
      "./layerzero.json",
      "../layerzero.json",
      "/layerzero.json",
    ],
    OAPP_ALIASES: "./oapp-aliases.json",
  },

  // Local storage keys
  STORAGE: {
    OAPP_ALIASES: "dashboard:oappAliases",
  },

  // Metadata cache TTL (1 hour)
  CACHE_TTL: 3600000,
};
