export const APP_CONFIG = Object.freeze({
  GRAPHQL_ENDPOINT:
    new URLSearchParams(window.location.search).get("endpoint") ||
    document.documentElement.dataset.graphqlEndpoint ||
    "http://localhost:8080/v1/graphql",

  ADDRESSES: Object.freeze({
    DEAD: "0x000000000000000000000000000000000000dead",
    ZERO: "0x0000000000000000000000000000000000000000",
    ZERO_PEER: "0x0000000000000000000000000000000000000000000000000000000000000000",
  }),

  GRAPH_VISUAL: Object.freeze({
    WIDTH: 2300,
    HEIGHT: 1200,
    NODE_RADIUS: 40,
    PADDING: 150,
    SEED_GAP: 400,
    COLUMN_SPACING: 300,
    MAX_NODES_PER_COLUMN: 8,
    MAX_COLUMNS: 20,
    ARC_INTENSITY: 200,
    Y_JITTER_MAX: 15,
    HASH_MOD: 31,
  }),

  CRAWLER: Object.freeze({
    DEFAULT_DEPTH: 10,
    MAX_DEPTH: 20,
    BATCH_SIZE: 16,
  }),

  FEEDBACK: Object.freeze({
    TOAST_DURATION: 1600,
    MAX_TOASTS: 6,
    COPY_DURATION: 1200,
    BUTTON_DURATION: 1800,
  }),

  LIMITS: Object.freeze({
    MIN_RESULT_LIMIT: 1,
    MAX_RESULT_LIMIT: 200,
    MAX_FETCH_LIMIT: 200000,
    MIN_YEAR: 1,
    MAX_YEAR: 365,
  }),

  DATA_SOURCES: Object.freeze({
    CHAIN_METADATA: ["./layerzero.json", "/dashboard/layerzero.json"],
    OAPP_ALIASES: "./oapp-aliases.json",
  }),

  STORAGE_KEYS: Object.freeze({
    OAPP_ALIASES: "dashboard:oappAliases",
  }),
});
