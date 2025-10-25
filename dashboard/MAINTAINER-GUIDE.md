# LayerZero Security Config Explorer - Maintainer Guide

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Module Reference](#module-reference)
3. [Adding New Features](#adding-new-features)
4. [Common Tasks](#common-tasks)
5. [Data Flow](#data-flow)
6. [Troubleshooting](#troubleshooting)
7. [Code Patterns](#code-patterns)
8. [Performance Considerations](#performance-considerations)

---

## Architecture Overview

### Module Structure

```
dashboard/
├── config.js       # Configuration constants
├── core.js         # Shared utilities & metadata management
├── crawler.js      # Security web crawling
├── graph.js        # SVG graph visualization
├── ui.js           # Query management & results rendering
└── app.js          # Application bootstrap & orchestration
```

### Dependency Graph

```
app.js
  ├─→ config.js
  ├─→ core.js (GraphQLClient, ChainMetadata, DvnRegistry, OAppChainOptions)
  ├─→ ui.js (AliasManager, QueryManager, ResultsRenderer, ToastManager)
  │    ├─→ config.js
  │    ├─→ core.js (utilities)
  │    └─→ crawler.js (lazy loaded for web-of-security)
  └─→ graph.js (lazy loaded via ui.js for web-of-security)
       └─→ config.js
```

### Key Design Decisions

1. **ES6 Modules**: All code uses native JavaScript modules (`import`/`export`)
2. **Class-based**: Services are classes for clear state management
3. **Lazy Loading**: Heavy modules (crawler, graph) loaded only when needed
4. **Single Instance**: Each service instantiated once in `app.js`
5. **Dependency Injection**: Dependencies passed via constructor
6. **No External Libraries**: Pure vanilla JavaScript (brutalist aesthetic)

---

## Module Reference

### config.js (56 lines)

**Purpose**: Centralized configuration constants

**Exports**:
- `CONFIG` - Single configuration object

**Key Sections**:
```javascript
CONFIG.GRAPHQL_ENDPOINT    // Hasura endpoint (auto-detected)
CONFIG.DEAD_ADDRESS        // Blocked DVN address
CONFIG.SVG.*              // Graph rendering settings
CONFIG.CRAWLER.*          // Crawl defaults
CONFIG.UI.*               // Timing & limits
CONFIG.DATA_SOURCES.*     // Metadata file paths
CONFIG.STORAGE.*          // localStorage keys
```

**When to Edit**:
- Changing timeouts or limits
- Adding new data sources
- Adjusting graph layout parameters

---

### core.js (581 lines)

**Purpose**: Shared utilities and metadata management

**Exports**:

#### Classes

**`GraphQLClient`**
- Communicates with Hasura GraphQL endpoint
- Handles errors and response validation
```javascript
const client = new GraphQLClient(endpoint);
const data = await client.query(query, variables);
```

**`ChainMetadata`**
- Manages LayerZero chain/EID mappings
- Resolves chain names and labels
- **Critical**: Must load `layerzero.json` (full format) first for EID mappings
```javascript
await chainMetadata.load();
const chainId = chainMetadata.resolveChainId(eid);  // EID → chainId
const eid = chainMetadata.resolveEid(chainId);       // chainId → EID
const label = chainMetadata.getChainLabel(chainId);
```

**`DvnRegistry`**
- Manages DVN metadata
- Resolves DVN addresses to names
```javascript
await dvnRegistry.load();
const name = dvnRegistry.resolve(address, chainId);
const names = dvnRegistry.resolveMany(addresses, chainId);
```

**`OAppChainOptions`**
- Manages available chains for OApp queries
- Populates chain selection datalists
```javascript
await oappChainOptions.load();
const label = oappChainOptions.getLabel(chainId);
const options = oappChainOptions.getOptions();
```

#### Utility Functions

```javascript
normalizeAddress(address)           // Ethereum address normalization
makeOAppId(chainId, address)        // Creates oappId string
normalizeOAppId(value)              // Parses & validates oappId
clampInteger(value, min, max, fallback)
parseOptionalPositiveInt(value)
formatTimestampValue(value)         // Unix timestamp → readable
stringifyScalar(value)              // Safe scalar stringification
looksLikeHash(column, value)        // Heuristic detection
looksLikeTimestampColumn(column)
chainPreferenceFromColumn(column)   // Detect chain vs EID columns
```

**`ErrorBoundary`**
- Wrapper for async error handling
```javascript
await ErrorBoundary.wrap(
  async () => { /* operation */ },
  (error) => { /* fallback */ }
);
```

---

### crawler.js (236 lines)

**Purpose**: Security web crawling (breadth-first traversal)

**Exports**:

**`SecurityWebCrawler`**

**Constructor**:
```javascript
new SecurityWebCrawler(client, chainMetadata, dvnRegistry)
```

**Main Method**:
```javascript
const webData = await crawler.crawl(seedOAppId, {
  depth: 10,           // Max traversal depth
  onProgress: (msg) => console.log(msg)
});

// Returns:
{
  seed: "chainId_address",
  crawlDepth: 10,
  timestamp: "2025-10-24T...",
  nodes: [
    {
      id: "chainId_address",
      chainId: "8453",
      address: "0x...",
      totalPacketsReceived: 1234,
      isTracked: true,
      isDangling: false,
      depth: 1,
      securityConfigs: [
        {
          srcEid: "30184",
          requiredDVNCount: 2,
          requiredDVNs: ["LayerZero Labs", "..."],
          optionalDVNCount: 0,
          optionalDVNs: [],
          optionalDVNThreshold: 0,
          usesRequiredDVNSentinel: false,
          isConfigTracked: true,
          peer: "0x…",
          peerOAppId: "30184_0x...",
          peerResolved: true
        }
      ]
    }
  ],
  edges: [
    {
      from: "peer_oappId",
      to: "receiver_oappId",
      srcEid: "30184",
      srcChainId: "8453",
      linkType: "peer",
      peerResolved: true,
      peerRaw: "0x0000..."
    }
  ]
}
```

**Algorithm**:
1. BFS traversal starting from seed
2. For each node: fetch security configs and associated peers
3. Resolve peer EIDs → chainIds → candidate OApp IDs
4. Enqueue resolved peers (EVM addresses) until depth limit
5. Add "dangling" nodes for unresolved peers referenced by edges

**Performance**: Typical crawl (depth=2) completes in seconds because it avoids per-packet scans.

---

### graph.js (912 lines)

**Purpose**: SVG graph visualization of security web

**Exports**:

**`SecurityGraphRenderer`**

**Constructor**:
```javascript
new SecurityGraphRenderer(
  getOAppAlias,           // Function to get alias for oappId
  getChainDisplayLabel    // Function to format chain labels
)
```

**Main Method**:
```javascript
const container = renderer.render(webData);
document.body.appendChild(container);
```

**Features**:
- **Node Layout**: Depth-based with arc compensation
- **Edge Detection**: Identifies bidirectional connections
- **Security Coloring**:
  - **Yellow nodes**: Maximum security (min DVN count ≥ web max)
  - **Red nodes**: Weak links (min DVN count < web max)
  - **Black edges**: Max security
  - **Red edges**: Lower security
  - **Dashed red edges**: Blocked (dead address in DVNs)
- **Interactive**:
  - Zoom with mousewheel
  - Pan by dragging
  - Click for persistent tooltips
  - Escape to close tooltips
- **Node Details Table**: Below graph

**Layout Algorithm**:
```
Depth 0 (seed):     Single column, centered
Depth 1:            Split into multiple columns if many nodes
Depth 2+:           One column per depth
Dangling nodes:     Far right column
Arc compensation:   Nodes curve away from center for readability
```

---

### ui.js (1,667 lines)

**Purpose**: Query management and results rendering

**Exports**:

#### `AliasManager`

Manages OApp aliases (friendly names)

```javascript
const aliasManager = new AliasManager();
await aliasManager.load();

aliasManager.get(oappId);              // Get alias
aliasManager.set(oappId, "MyOApp");    // Set alias
aliasManager.export();                 // Download JSON
```

**Storage**: localStorage + static `oapp-aliases.json` (merged)

---

#### `QueryManager`

Manages query registry and execution

```javascript
const queryManager = new QueryManager(
  client,
  { chain, dvn, oappChainOptions },
  aliasManager,
  onResultsUpdate
);

// Build registry (done internally)
const registry = queryManager.buildQueryRegistry();

// Execute query
await queryManager.runQuery(key, card, statusEl);

// Reprocess after alias change
queryManager.reprocessLastResults();
```

**Query Registry Structure**:
```javascript
{
  "query-key": {
    label: "Human readable",
    description: "What this does",
    query: `GraphQL query string` | null,

    // Optional: Initialize form (called once)
    initialize: ({ card, run }) => { },

    // Required: Extract variables from form
    buildVariables: (card) => ({
      variables: { ... },     // GraphQL variables
      meta: { ... }          // Extra metadata for rendering
    }),

    // Optional: Extract rows from response
    extractRows: (data) => [...],

    // Optional: Process response (async)
    processResponse: async (payload, meta) => ({
      rows: [...],
      meta: { ...meta, ... }
    })
  }
}
```

**Current Queries**:
1. `top-oapps` - Most active OApps by packet count
2. `oapp-security-config` - Security settings for one OApp
3. `popular-oapps-window` - Activity within time window
4. `web-of-security` - Crawl/load security graph

---

#### `ResultsRenderer`

Renders query results as tables or graphs

```javascript
const renderer = new ResultsRenderer(
  resultsTitle,      // <h2> element
  resultsMeta,       // <p> element
  resultsBody,       // Container element
  copyJsonButton,    // Button element
  chainMetadata,
  aliasManager,
  toastManager
);

renderer.render(rows, payload, meta);
```

**Rendering Modes**:
- **Table** (default): `meta.renderMode` undefined
- **Graph**: `meta.renderMode === "graph"` + `meta.webData`
- **Error**: `meta.error` present

**Cell Formatting**:
Cells can be plain values or formatted objects:
```javascript
{
  __formatted: true,
  lines: ["Primary", "Secondary"],   // Multi-line display
  copyValue: "value-to-copy",
  meta: { oappId: "..." }             // For interactions
}
```

**Auto-detection**:
- Timestamps: Formatted with ISO + unix
- Chain IDs: Resolved to names
- EIDs: Resolved to chain names
- Hashes: Rendered in `<code>`
- Arrays/Objects: JSON formatted

---

#### `ToastManager`

Simple toast notifications

```javascript
const toastManager = new ToastManager();
toastManager.show("Copied!", "success");
toastManager.show("Error occurred", "error");
```

**Tones**: `neutral`, `success`, `error`

---

### app.js (316 lines)

**Purpose**: Application bootstrap and orchestration

**Main Class**: `Dashboard`

**Initialization Sequence**:
```
1. Create service instances
2. Load all metadata in parallel:
   - ChainMetadata
   - DvnRegistry
   - OAppChainOptions
   - AliasManager
3. Initialize query cards
4. Setup global event handlers
5. Bootstrap first query
```

**Key Methods**:

```javascript
async initialize()              // Main init
initializeQueryCards()          // Setup all query panels
setupGlobalHandlers()           // Buttons, copy, aliases
openAliasEditor(oappId)        // Modal management
closeAliasEditor()
handleAliasSubmit(event)
handleAliasFormClick(event)
```

**Event Handlers**:
- Copy JSON button
- Refresh all button
- Copyable cell clicks
- Double-click for alias editing
- Alias modal (submit, clear, export, cancel)
- Escape key to close modal

---

## Adding New Features

### Adding a New Query

**Step 1**: Add query card to `index.html`

```html
<article class="query-card" data-query-key="my-new-query">
  <header class="card-header">
    <div>
      <h2>My Query Title</h2>
      <p>Description of what this does.</p>
    </div>
    <button class="run-query" type="button">Run</button>
  </header>
  <form class="card-body">
    <label>
      Parameter Name
      <input name="myParam" type="text" />
    </label>
  </form>
  <details class="card-query">
    <summary>GraphQL query</summary>
    <pre class="graphql" data-query-code></pre>
  </details>
  <footer class="card-footer">
    <span class="status-tag" data-status>Idle</span>
  </footer>
</article>
```

**Step 2**: Add query definition to `ui.js` → `buildQueryRegistry()`

```javascript
"my-new-query": {
  label: "My Query",
  description: "What it does",
  query: `
    query MyQuery($param: String!) {
      MyTable(where: { field: { _eq: $param } }) {
        id
        field1
        field2
      }
    }
  `,

  // Optional: Initialize form controls
  initialize: ({ card, run }) => {
    const input = card.querySelector('input[name="myParam"]');
    input.addEventListener('change', () => run());
  },

  // Required: Build variables from form
  buildVariables: (card) => {
    const input = card.querySelector('input[name="myParam"]');
    const value = input?.value?.trim();

    if (!value) {
      throw new Error("Parameter is required");
    }

    return {
      variables: { param: value },
      meta: {
        limitLabel: `param=${value}`,
        summary: `Results for ${value}`,
      },
    };
  },

  // Simple extraction (OR use processResponse for complex)
  extractRows: (data) => data?.MyTable ?? [],

  // OR complex processing
  processResponse: async (payload, meta) => {
    const items = payload?.data?.MyTable ?? [];

    // Transform data
    const rows = items.map(item => ({
      ...item,
      // Format cells
      id: this.formatOAppIdCell(item.id),
    }));

    return {
      rows,
      meta: {
        ...meta,
        customInfo: "anything",
      },
    };
  },
},
```

**Step 3**: Test

- Refresh browser
- Find new card
- Fill form
- Click Run
- Verify results

---

### Adding a New Metadata Source

**Example**: Add token metadata

**Step 1**: Add to `config.js`

```javascript
DATA_SOURCES: {
  // ... existing
  TOKEN_METADATA: "./tokens.json",
}
```

**Step 2**: Create manager in `core.js`

```javascript
export class TokenRegistry {
  constructor() {
    this.tokens = new Map();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;

    try {
      const response = await fetch(CONFIG.DATA_SOURCES.TOKEN_METADATA);
      const data = await response.json();

      Object.entries(data).forEach(([address, info]) => {
        this.tokens.set(address.toLowerCase(), info);
      });

      console.log(`[TokenRegistry] Loaded ${this.tokens.size} tokens`);
      this.loaded = true;
    } catch (error) {
      console.warn("[TokenRegistry] Failed to load", error);
      this.loaded = true;
    }
  }

  getSymbol(address) {
    return this.tokens.get(address.toLowerCase())?.symbol || address;
  }
}
```

**Step 3**: Integrate in `app.js`

```javascript
class Dashboard {
  constructor() {
    // ... existing
    this.tokenRegistry = new TokenRegistry();
  }

  async initialize() {
    await Promise.all([
      // ... existing
      this.tokenRegistry.load(),
    ]);
  }
}
```

**Step 4**: Use in queries

```javascript
// Pass to ResultsRenderer or use in processResponse
const symbol = this.tokenRegistry.getSymbol(tokenAddress);
```

---

### Adding Interactive Features to Graph

**Example**: Add node filtering

**Step 1**: Add UI controls (in `graph.js` → `renderSummary()`)

```javascript
const filterContainer = document.createElement("div");
filterContainer.innerHTML = `
  <label>
    <input type="checkbox" id="hide-dangling" />
    Hide dangling nodes
  </label>
`;
summary.appendChild(filterContainer);
```

**Step 2**: Add event handler in `renderSVG()`

```javascript
const checkbox = svg.querySelector('#hide-dangling');
checkbox.addEventListener('change', (e) => {
  const isDangling = e.target.checked;

  for (const node of webData.nodes) {
    if (node.isDangling) {
      const pos = nodePositions.get(node.id);
      // Update visibility
    }
  }
});
```

---

## Common Tasks

### Changing the GraphQL Endpoint

**Option 1**: URL parameter
```
http://localhost:3000?endpoint=https://your-hasura.com/v1/graphql
```

**Option 2**: Edit `index.html`
```html
<html data-graphql-endpoint="https://your-hasura.com/v1/graphql">
```

**Option 3**: Set in JavaScript (before loading)
```html
<script>
  window.ENV = {
    GRAPHQL_ENDPOINT: "https://your-hasura.com/v1/graphql"
  };
</script>
```

---

### Updating Chain Metadata

**Important**: The dashboard requires `layerzero.json` (the standard LayerZero chain metadata file).

**File Priority** (config.js):
1. `./layerzero.json`
2. `../layerzero.json`
3. `/layerzero.json`

**Expected Format**:
```json
{
  "chain-key": {
    "chainDetails": {
      "nativeChainId": 42161,
      "name": "Arbitrum",
      "shortName": "Arbitrum"
    },
    "deployments": [
      {
        "eid": "30110",
        "stage": "mainnet"
      }
    ],
    "dvns": {
      "0xaddress": {
        "canonicalName": "DVN Name"
      }
    }
  }
}
```

**To Update**:
1. Replace `dashboard/layerzero.json` with new version
2. Refresh browser
3. Check console: `[ChainMetadata] Processed X chains, Y deployments, Z EID mappings`
4. Verify Z > 0 (should be 500+)

---

### Adjusting Crawler Parameters

**In UI** (`index.html`):
```html
<input name="depth" type="number" value="10" />
```

**Defaults** (`config.js`):
```javascript
CRAWLER: {
  DEFAULT_DEPTH: 10,
}
```

**Performance Impact**:
- Depth controls breadth exponentially (depth 1 ≈ handful of nodes, depth 2 ≈ few dozen, depth 3 ≈ few hundred).
- Without per-packet scans, crawls typically finish in a few seconds.

**Recommendations**:
- **Quick exploration**: depth = 1
- **Medium crawl**: depth = 2
- **Deep dive**: depth = 3 (ensure browser can render larger graphs)

---

### Styling Graph Visualization

**SVG Constants** (`config.js`):
```javascript
SVG: {
  WIDTH: 1600,        // Viewbox width
  HEIGHT: 1200,       // Viewbox height
  NODE_RADIUS: 40,    // Base node size
  PADDING: 150,       // Edge margins
}
```

**Colors** (`graph.js` → `renderNodes()`):
```javascript
// Node fill
fillColor = node.isDangling ? "none"
  : minRequiredDVNs >= maxMinRequiredDVNsForNodes ? "#ffff99"  // Yellow = secure
  : "#ff9999";  // Red = weak link

// Edge stroke
color = isBlocked ? "#ff0000"               // Red dashed = blocked
  : requiredDVNCount < max ? "#ff6666"      // Red solid = lower security
  : "#000000ff";                            // Black = max security
```

**Layout Algorithm** (`graph.js` → `layoutNodes()`):
```javascript
// Depth-based horizontal spacing
const depthSpacing = (width - 2 * padding) / (totalColumns - 1);

// Vertical distribution per depth
const verticalSpacing = (height - 2 * padding) / (nodesAtDepth.length - 1);

// Arc compensation (curve away from center)
const arcIntensity = 200;
const xOffset = arcIntensity * normalizedPosition * normalizedPosition;
```

---

### Exporting Data

**As JSON** (built-in):
- Click "Copy JSON" button
- For graphs: Downloads `web-of-security-{seed}-{timestamp}.json`
- For tables: Copies to clipboard

**Programmatically** (in browser console):
```javascript
// Get last results
const data = document.querySelector('#results-body').__vueish_data__;

// Or from global (if exposed)
console.log(window.lastResults);
```

**From Crawler**:
```javascript
const crawler = new SecurityWebCrawler(client, chainMetadata, dvnRegistry);
const webData = await crawler.crawl(seedOAppId);
console.log(JSON.stringify(webData, null, 2));
```

---

## Data Flow

### Query Execution Flow

```
User clicks "Run"
  ↓
app.js: runQuery()
  ↓
ui.js: QueryManager.runQuery()
  ↓
ui.js: buildVariables(card) → variables + meta
  ↓
[If web-of-security]
  → crawler.js: SecurityWebCrawler.crawl()
  → Returns webData
[Else]
  → core.js: GraphQLClient.query()
  → Returns data
  ↓
ui.js: processResponse() or extractRows()
  → Returns { rows, meta }
  ↓
ui.js: ResultsRenderer.render(rows, payload, meta)
  ↓
[If meta.renderMode === "graph"]
  → graph.js: SecurityGraphRenderer.render()
  → Appends SVG
[Else]
  → ui.js: buildTable(rows)
  → Appends <table>
```

### Metadata Loading Flow

```
Browser loads app.js
  ↓
Dashboard.initialize()
  ↓
Promise.all([
  ChainMetadata.load()
    → Fetch layerzero.json
    → Parse deployments
    → Build eidToChainId map

  DvnRegistry.load()
    → GraphQL query DvnMetadata
    → Build address→name map

  OAppChainOptions.load()
    → Fetch oapp-chains.json
    → Build chainId→label map

  AliasManager.load()
    → Fetch oapp-aliases.json (static)
    → Merge localStorage (user edits)
])
  ↓
initializeQueryCards()
  ↓
Bootstrap first query
```

### Alias Update Flow

```
User double-clicks OApp ID cell
  ↓
app.js: handleAliasDblClick()
  ↓
app.js: openAliasEditor(oappId)
  ↓
User edits, clicks "Save"
  ↓
app.js: handleAliasSubmit()
  ↓
ui.js: AliasManager.set(oappId, alias)
  → Saves to localStorage
  ↓
ui.js: QueryManager.reprocessLastResults()
  → Re-runs processResponse/extractRows
  → Reformats cells with new alias
  ↓
ui.js: ResultsRenderer.render()
  → Updates table display
```

---

## Troubleshooting

### No EID Mappings (Crawler Shows 0)

**Symptoms**:
```
[SecurityWebCrawler] Starting crawl with 0 EID mappings
Skipping sender: unknown chainId for srcEid=30184
```

**Cause**: `layerzero.json` file missing or has invalid format

**Fix**:
1. Check console for: `[ChainMetadata] Loaded from ...`
2. Verify file exists: `ls dashboard/layerzero.json`
3. Check file format: Should have `deployments` arrays with `eid` fields
4. Download fresh copy from LayerZero API if corrupted
5. Verify console shows: `[ChainMetadata] Processed X chains, Y deployments, Z EID mappings` with Z > 0

**Verification**:
```javascript
// In browser console
console.log(chainMetadata.eidToChainId.size);  // Should be 500+
```

---

### Bootstrap Race Condition (Missing Chain Labels)

**Symptoms**:
- First query shows chain IDs instead of names (e.g., "8453" instead of "Base")
- Subsequent queries work fine

**Cause**: Query runs before metadata loads

**Fix**: Already fixed in refactored code. Metadata loads before bootstrap query.

**Old Code** (broken):
```javascript
queueMicrotask(run);  // Runs immediately!
```

**New Code** (fixed):
```javascript
async initialize() {
  await Promise.all([/* metadata loads */]);
  queueMicrotask(run);  // Now runs after metadata
}
```

---

### Syntax Error with `??` Operator

**Symptoms**:
```
Uncaught SyntaxError: cannot use `??` unparenthesized within `||` and `&&` expressions
```

**Cause**: Mixing `??` with `||` or `&&` without parentheses

**Example** (broken):
```javascript
const x = a || b ?? c;  // ERROR
```

**Fix**:
```javascript
const x = a || (b ?? c);  // OK
const x = (a ?? b) || c;  // OK
```

**Prevention**: Always parenthesize `??` when used with other operators.

---

### Graph Not Rendering

**Symptoms**:
- Blank results area
- Console error about `SecurityGraphRenderer`

**Causes & Fixes**:

1. **Module not loaded**:
   ```
   Error: Failed to resolve module specifier "./graph.js"
   ```
   Fix: Check `<script type="module">` in index.html

2. **Invalid webData**:
   ```javascript
   // Check in console
   console.log(resultsState.lastRender?.meta?.webData);
   ```
   Fix: Verify webData has `.nodes` and `.edges` arrays

3. **SVG not appended**:
   Check `resultsBody.innerHTML` - should contain SVG element

---

### Copy-to-Clipboard Not Working

**Symptoms**: Click cell, nothing happens

**Causes**:

1. **Not HTTPS/localhost**: Clipboard API requires secure context
   - Fix: Use localhost or HTTPS

2. **No `data-copy-value`**: Cell not marked as copyable
   - Check cell has `.copyable` class
   - Verify `data-copy-value` attribute set

3. **Text selected**: Copy disabled when user is selecting
   - Expected behavior (prevents accidental overwrite)

---

### Query Returns No Data

**Debug Checklist**:

1. **Check GraphQL endpoint**:
   ```javascript
   console.log(CONFIG.GRAPHQL_ENDPOINT);
   ```

2. **Inspect request in Network tab**:
   - Should be POST to `/v1/graphql`
   - Check request payload
   - Check response body

3. **Verify variables**:
   ```javascript
   // In buildVariables()
   console.log('Variables:', variables);
   ```

4. **Test query in Hasura Console**:
   - Copy query from "GraphQL query" disclosure
   - Paste into Hasura GraphiQL
   - Add variables
   - Run independently

5. **Check permissions**:
   - Hasura may require auth headers
   - Add to `GraphQLClient` headers if needed

---

## Code Patterns

### Error Handling

**Async Operations**:
```javascript
// Use ErrorBoundary for non-critical operations
const result = await ErrorBoundary.wrap(
  async () => await fetchData(),
  (error) => {
    console.warn("Fetch failed, using fallback", error);
    return defaultValue;
  }
);

// Use try/catch for critical operations
try {
  await criticalOperation();
} catch (error) {
  console.error("Critical failure", error);
  toastManager.show(error.message, "error");
  throw error;  // Re-throw if caller needs to handle
}
```

**GraphQL Errors**:
```javascript
// Handled automatically in GraphQLClient
// Just catch and display
try {
  const data = await client.query(query, variables);
} catch (error) {
  // error.message contains user-friendly text
  showError(error.message);
}
```

---

### State Management

**Service State** (class properties):
```javascript
class MyService {
  constructor() {
    this.data = new Map();  // Internal state
    this.loaded = false;    // Loading flag
  }

  async load() {
    if (this.loaded) return;  // Idempotent

    // Fetch and store
    this.data = await fetchData();
    this.loaded = true;
  }
}
```

**UI State** (stored in QueryManager/ResultsRenderer):
```javascript
// Last query results (for reprocessing)
this.lastPayload = payload;
this.lastQueryKey = key;
this.lastMetaBase = meta;

// Current request tracking
this.requestSeq = 0;
this.latestRequest = 0;

// Use to prevent race conditions
const requestId = ++this.requestSeq;
this.latestRequest = requestId;

// ... async operation ...

if (requestId === this.latestRequest) {
  // Only update if this is still latest request
  updateUI();
}
```

**Global State** (avoid unless necessary):
```javascript
// BAD: Global variables
let currentData = null;

// GOOD: Instance properties
class Dashboard {
  constructor() {
    this.currentData = null;
  }
}
```

---

### DOM Manipulation

**Query Selectors**:
```javascript
// Cache at construction
constructor() {
  this.button = document.getElementById("my-button");
}

// Use cached references
this.button.disabled = true;
```

**Creating Elements**:
```javascript
// Simple
const div = document.createElement("div");
div.className = "my-class";
div.textContent = "Hello";

// Complex (use template literals)
div.innerHTML = `
  <h3>${escapeHtml(title)}</h3>
  <p>${escapeHtml(description)}</p>
`;

// Always escape user content!
```

**SVG Creation**:
```javascript
const svgNS = "http://www.w3.org/2000/svg";
const circle = document.createElementNS(svgNS, "circle");
circle.setAttribute("cx", 100);
circle.setAttribute("cy", 100);
circle.setAttribute("r", 50);
```

---

### Formatting Cells

**Simple Value**:
```javascript
return value;  // Displayed as-is
```

**Formatted Cell** (multi-line, copyable):
```javascript
return {
  __formatted: true,
  lines: ["Primary", "Secondary"],
  copyValue: "what-gets-copied",
  meta: { oappId: "..." }  // For interactions
};
```

**Helper Method** (in QueryManager):
```javascript
this.createFormattedCell(lines, copyValue, meta)
```

**Auto-Detection**:
ResultsRenderer automatically detects and formats:
- Timestamps → ISO + unix
- Chain IDs → Resolved names
- Hashes → Code blocks
- Arrays/Objects → Pretty JSON

---

### Adding Tooltips

**Built-in Title** (simple):
```javascript
element.title = "Tooltip text";
```

**SVG Title** (for SVG elements):
```javascript
const title = document.createElementNS(svgNS, "title");
title.textContent = "Tooltip text\nLine 2";
element.appendChild(title);
```

**Persistent Tooltip** (graph feature):
```javascript
const showTooltip = setupPersistentTooltips(svg);

element.addEventListener('click', (e) => {
  e.stopPropagation();
  showTooltip("Tooltip text", e.pageX + 10, e.pageY + 10);
});

// Closes on Escape or clicking svg background
```

### Memory Management

**Potential Leaks**:
1. **Event listeners**: Always remove when destroying
2. **Timers**: Clear on component unmount
3. **Cached references**: Nullify large objects when done

**Current Mitigation**:
```javascript
// Toast timers are tracked and limited
if (this.timers.length > 6) {
  clearTimeout(this.timers.shift());
}

// Copy feedback timers use WeakMap (auto garbage collected)
const copyFeedbackTimers = new WeakMap();
```

**Best Practice**:
```javascript
class Component {
  constructor() {
    this.handleClick = this.handleClick.bind(this);
    this.element.addEventListener('click', this.handleClick);
  }

  destroy() {
    this.element.removeEventListener('click', this.handleClick);
    this.element = null;  // Release reference
  }
}
```

---

## Testing

### Manual Testing Checklist

**Bootstrap**:
- [ ] Page loads without errors
- [ ] First query runs automatically
- [ ] Chain labels appear (not just IDs)
- [ ] Metadata logged in console

**Top OApps Query**:
- [ ] Default limit works
- [ ] Custom limit works
- [ ] Minimum packet filter works
- [ ] Results sorted correctly
- [ ] Chain names resolved
- [ ] Timestamps formatted
- [ ] Copy works on all cells

**OApp Security Config Query**:
- [ ] OApp ID validation
- [ ] Chain + address form works
- [ ] Security configs displayed
- [ ] DVN names resolved
- [ ] Fallback fields shown
- [ ] Summary panel appears
- [ ] Copy works

**Popular OApps Window Query**:
- [ ] Time unit selector works
- [ ] Window calculation correct
- [ ] Aggregation correct
- [ ] EID counting accurate
- [ ] Summary panel accurate

**Web of Security**:
- [ ] Crawl from seed works
- [ ] Load from file works
- [ ] Graph renders correctly
- [ ] Nodes positioned well
- [ ] Edges drawn correctly
- [ ] Colors match security levels
- [ ] Zoom works smoothly
- [ ] Pan works
- [ ] Tooltips appear
- [ ] Tooltips close on Escape
- [ ] Node detail table accurate
- [ ] Download JSON works

**Aliases**:
- [ ] Double-click opens editor
- [ ] Alias saves to localStorage
- [ ] Results update immediately
- [ ] Export JSON works
- [ ] Clear removes alias

**General**:
- [ ] Refresh all button works
- [ ] Copy JSON works (table)
- [ ] Copy JSON → Download (graph)
- [ ] No console errors
- [ ] Mobile responsive (basic)
