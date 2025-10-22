# Dashboard Overview

This dashboard is a lightweight, “brutalist” front-end that sits on top of the LayerZero security-config indexer exposed via Hasura. It exists so protocol engineers and analysts can exercise the GraphQL API quickly, visualize dense result sets, and copy‑paste primary keys for deeper explorations.

The data model driving the UI is documented in [`docs/security-config-data-model.md`](../docs/security-config-data-model.md). The biggest takeaways from that document you’ll see mirrored here:

- `OApp` entities summarize receivers (`{chainId}_{address}`) and track packet counters.
- `OAppSecurityConfig` captures each OApp/origin EID’s effective security posture after defaults and overrides merge.
- `PacketDelivered` snapshots the config that was in force for a specific delivery.
- `DvnMetadata` resolves DVN addresses to names so we can render friendlier views without losing copyable addresses.

This README explains how the dashboard is structured and how to extend it safely.

---

## Runtime Layout

```
dashboard/
├── index.html     # Hand-built HTML shell with three query cards and an empty results pane
├── styles.css     # Global brutalist theming + component styles
├── app.js         # Entire “app” – query registry, fetch logic, render helpers, aggregation
├── layerzero-chains.json  # Generated map of chainId → label, shared by multiple cards
└── oapp-chains.json       # Curated list of supported chainIds for security-config lookups
```

There is no framework: `app.js` is imported as an ES module and wires up the DOM once on load.

### Query Cards

Each card on the page registers itself in the `queryRegistry` object within `app.js`. A card provides:

| Field | Purpose |
| --- | --- |
| `query` | GraphQL document executed against `http://localhost:8080/v1/graphql`. |
| `initialize` *(optional)* | One-time DOM wiring (e.g., populate datalists, normalize inputs). |
| `buildVariables` | Reads the card’s form, computes JSON variables, and returns metadata. |
| `extractRows` / `processResponse` | Shapes raw Hasura responses into an array of rows and summary metadata used by the renderer. |

Helpers you’ll see referenced across cards:

- `normalizeOAppId`, `normalizeAddress`: keep identifiers lowercase and in the `{chainId}_{address}` shape used by the indexer.
- `getChainDisplayLabel`, `buildDvnLookup`: hydrate human-readable labels from `layerzero-chains.json` and `DvnMetadata`.
- `createFormattedCell`: wraps complex cell content (multi-line, copy-friendly) in a consistent structure for rendering.
- `aggregatePopularOapps`: custom post-processing used by the “Popular OApps (Window)” card to build leaderboard rows from raw `PacketDelivered` samples.

The result pane is generic: `updateResultsPane` takes the row array, optional summary, and payload, then composes:

1. A summary panel (`renderSummaryPanel`) if the card provided one (either OApp overview or window stats).
2. A table with uniform columns across rows.
3. A collapsible raw JSON view.

Cells that contain structured data use `.copyable` wrappers. Clicking anywhere in the cell copies the underlying `copyValue` (e.g., OApp IDs, addresses, or raw DVN addresses) while we display friendly names.

### Styling

`styles.css` is global and aims to stay simple:

- Card layout uses CSS grid (auto-fit min width) so new cards drop in with minimal tweaks.
- Tables are full-width and enforce a consistent whitespace + border aesthetic.
- Helper classes (`.summary-panel`, `.copyable`, `.copy-toast`) separate concerns from the main layout.

If you introduce new components, reuse the existing token palette (`--ink`, `--accent`, etc.) so everything feels cohesive.

---

## Existing Query Cards

1. **Top OApps**  
   Pulls the `OApp` table ordered by `totalPacketsReceived`. Supports optional limit and min-packets filters. This is effectively a read-through of cumulative counters populated by the handlers described under “Per-OApp Override Entities” in the main data-model docs.

2. **OApp Security Config**  
   Uses the `OAppSecurityConfig` table to show the merged LayerZero security posture for a specific OApp/origin EID scope. Inputs accept either a full `oappId` or chain/address pair (chain list comes from `config.yaml` via `oapp-chains.json`). The response is enriched with `DvnMetadata` to render DVN names but the copy action preserves raw addresses. The summary panel echoes the latest `OApp` counters so you can cross-reference how active the receiver is – see the “Effective Configuration” section of the docs for field semantics.

3. **Popular OApps (Window)**
   Samples recent `PacketDelivered` rows (ordered by `blockTimestamp DESC`) within an adjustable lookback window. Aggregation happens client-side: we count packets, accumulate unique EIDs, and record last packet metadata per OApp. The default sample size is unlimited (walk the whole window), but you can cap it to speed up large queries. This card is conceptually similar to deriving `OAppEidPacketStats` from `PacketDelivered`, but scoped to a moving time window rather than cumulative totals.

### OApp aliases

- Double-click any OApp ID cell to open the alias editor. Aliases render as friendly names while keeping the raw `{chainId}_{address}` copy target.
- Aliases load from `oapp-aliases.json` and are overlaid with values stored in `localStorage`. Use the “Export JSON” button in the editor to download the merged map and commit it back to the repo when you want to persist changes.
- Summary panels (e.g., the OApp config overview) also surface the alias when one exists.

Because each card is self-contained in `queryRegistry`, adding new panels usually means:

1. Mocking the GraphQL in a card’s `query` section.
2. Defining `buildVariables` to read the mini-form and append metadata.
3. Implementing `extractRows`/`processResponse` to shape the output – either as raw rows or, for more complex displays, using formatted cells.

---

## Rendering & Copy Behavior

- Tables are generated dynamically. Column names are inferred from the first row’s keys; keep row objects homogenous.
- `interpretValue` handles the three value types:
  * `formatted`: `createFormattedCell` output (preferred for multi-line or copy-special fields).
  * Plain arrays/objects: rendered as JSON `<pre>` blocks.
  * Scalars: inserted verbatim.
- Hashes, transaction identifiers, and addresses automatically get copy cursors. The copy toast in the top-right surfaces success/failure and each cell flashes inline with subtle color changes.

Raw JSON can be copied globally via the button in the results header. It uses `resultsState.lastPayload` if available (so you can see exact GraphQL data), falling back to the table rows otherwise.

---

## Data & Metadata Dependencies

- `layerzero-chains.json` and `oapp-chains.json` are generated from repo sources (`layerzero.json` and `config.yaml`). Regenerate them if chains are added or renamed.
- DVN naming depends on `DvnMetadata` entries emitted by the indexer (see “Reference Data” in the docs). No DVN entry? The UI falls back to the address but copy still works.
- The dashboard reads the Hasura endpoint from the `data-graphql-endpoint` attribute on the root `<html>` element (defaults to `http://localhost:8080/v1/graphql`). Update that attribute when you deploy behind a different host/port. If you need to send headers (e.g., Hasura admin secret), set `data-hasura-admin-secret` as well.

---

## Extending or Maintaining

1. **When adding panels**
   - Stick to the pattern in `queryRegistry`: keep GraphQL, inputs, and render logic co-located.
   - Reuse helper utilities (address normalization, formatted cells). Add new helpers below the existing ones to avoid tangled logic.
   - Remember to collapse new `<details>` blocks by default unless there’s a strong reason to expose the GraphQL snippet.

2. **When touching styles**
   - Favor additive changes—existing classes are shared across cards. Test both light and high-density tables before shipping.
   - Avoid inline styles in `index.html`; the project intentionally keeps markup minimal.

3. **When the data model evolves**
   - Consult [`docs/security-config-data-model.md`](../docs/security-config-data-model.md) to understand new fields or tables.
   - Update the relevant cards to surface new insights. For example, if `OAppSecurityConfig` adds a flag, extend `formatSecurityConfigRow`.
   - Revise helper maps (chain lookup, DVN naming) if the upstream JSON changes structure.

4. **Testing / validation**
   - Manual smoke-tests are usually sufficient: run `pnpm dev` (indexer) and serve `dashboard/` via `python -m http.server` or similar.
   - When you add aggregation logic (like `aggregatePopularOapps`), feed it mocked packet arrays in a node REPL to confirm ranking and copy values behave as expected.

5. **Accessibility & ergonomics**
   - All inputs are basic HTML controls; ensure labels remain descriptive.
   - Copy affordances rely on inline styles—verify high-contrast modes if you introduce darker backgrounds.

With that, you should have enough context to extend the dashboard confidently. Keep cards focused, results readable, and remember the goal: make the LayerZero security-config index easy to interrogate without leaving the terminal. Happy shipping!