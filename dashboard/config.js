/**
 * Central configuration object for the LayerZero Security Config Explorer.
 * Exported as an immutable object to make accidental runtime mutation obvious.
 */
export const APP_CONFIG = Object.freeze({
  GRAPHQL_ENDPOINT:
    new URLSearchParams(window.location.search).get("endpoint") ||
    document.documentElement.dataset.graphqlEndpoint ||
    "http://localhost:8080/v1/graphql",
  DEAD_ADDRESS: "0x000000000000000000000000000000000000dead",
  ZERO_ADDRESS: "0x0000000000000000000000000000000000000000",
  ZERO_PEER: "0x0000000000000000000000000000000000000000000000000000000000000000",
  SVG: Object.freeze({
    WIDTH: 1600,
    HEIGHT: 1200,
    NODE_RADIUS: 40,
    PADDING: 150,
    SEED_GAP: 400,
    COLUMN_SPACING: 300,
    MAX_NODES_PER_COLUMN: 8,
    MAX_COLUMNS: 20,
  }),
  CRAWLER: Object.freeze({
    DEFAULT_DEPTH: 10,
  }),
  UI: Object.freeze({
    TOAST_DURATION: 1600,
    MAX_TOASTS: 6,
    COPY_FEEDBACK_DURATION: 1200,
    BUTTON_FEEDBACK_DURATION: 1800,
  }),
  DATA_SOURCES: Object.freeze({
    CHAIN_METADATA: ["./layerzero.json", "/dashboard/layerzero.json"],
    OAPP_ALIASES: "./oapp-aliases.json",
  }),
  STORAGE: Object.freeze({
    OAPP_ALIASES: "dashboard:oappAliases",
  }),
  CACHE_TTL: 3600000,
});
