# AGENTS // Indexer Primer

This note gives agents a fast mental model for the LayerZero security indexer. For deeper dives, consult `docs/layerzero-indexer.md` (full theory) and `dashboard/MAINTAINER-GUIDE.md` (ops/runtime).

## What We Index
- **Contracts**: `EndpointV2`, `ReceiveUln302`, and wildcard `OAppOFT` across all configured networks (see `config.yaml`). Wildcards let us capture every OApp even when addresses are unknown ahead of time.
- **Events**:
  - `EndpointV2`: `DefaultReceiveLibrarySet`, `ReceiveLibrarySet`, `PacketDelivered`
  - `ReceiveUln302`: `DefaultUlnConfigsSet`, `UlnConfigSet`
  - `OAppOFT`: `PeerSet`, `RateLimiterSet`, `RateLimitsChanged`
- **Transaction hashes** are requested via `field_selection` and persisted on every mutable entity for traceability.

## Data Model Highlights
- **Defaults (protocol scope)**: `DefaultReceiveLibrary`, `DefaultUlnConfig` + `*Version` history.
- **Overrides (oapp scope)**: `OAppReceiveLibrary`, `OAppUlnConfig`, `OAppPeer`, `OAppRateLimiter`, `OAppRateLimit` + their `*Version` tables.
- **Effective view**: `OAppSecurityConfig` (one row per `(oappId, eid)`) merges defaults + overrides and denormalizes the latest peer snapshot and recompute metadata.
- **Usage stats**: `OAppEidPacketStats` (per source eid) and `PacketDelivered` (per delivery, with full effective config frozen in time).
- **Metadata**: `DvnMetadata` enriches DVN addresses with human names.

IDs follow the pattern described in `docs/layerzero-indexer.md`: scoped IDs (`chainId_eid`, `oappId_eid`), event IDs (`chain_block_log`), and composite version IDs where a single event mutates multiple rows.

## Handler Lifecycles (see `src/EventHandlers.ts`)
1. **Normalize** incoming addresses (`toLowerCase`, zero handling) except for peer bytes, which are stored verbatim.
2. **Persist current state** in the relevant table (`Default*`, `OApp*`, etc.) and append a `*Version` snapshot with block/timestamp/tx hash.
3. **Recompute effective configs** when a change could affect security posture:
   - `computeAndPersistEffectiveConfig` merges defaults and overrides, enforces sentinel logic (`255`, `2^64-1`), dedupes DVNs, and writes `OAppSecurityConfig`.
   - `recomputeSecurityConfigsForScope` refreshes every OApp on the same `(chainId, eid)` when defaults move.
4. **PacketDelivered** flow:
   - Touches cumulative stats (`OApp`, `OAppEidPacketStats`), recomputes the current effective config, and writes a denormalized `PacketDelivered` record for analytics.

`computeAndPersistEffectiveConfig` is the core algorithm: it filters out zero addresses, normalizes arrays, applies fallback tracking, resolves DVN metadata, and exposes whether an OApp relies on defaults or sentinels. Peer data and recompute hashes are stitched onto the result so consumers always see the exact state that produced an event.

## Mental Map
- **Defaults drive cascades**: any default event triggers recomputation for all affected OApps (same chain/eid).
- **Overrides are surgical**: only the specific `(oappId, eid)` recomputes.
- **Peers & rate controls**: stored separately for clarity, but `OAppSecurityConfig` mirrors the latest peer so security snapshots stay self-contained.
- **Tx hashes everywhere**: debug and backfill work well because every mutation carries the transaction source.

With this structure you can answer: “What is this OApp’s verification posture right now?”, “What changed and when?”, and “Which peer routes are live?” directly from HyperIndex without on-chain RPC.
