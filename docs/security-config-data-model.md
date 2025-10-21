# LayerZero Security Config Data Model

## Overview
- The indexer defined in `config.yaml` ingests `EndpointV2` and `ReceiveUln302` events across all configured chains, focusing solely on incoming packets.
- Event handlers in `src/EventHandlers.ts` normalize addresses, merge defaults and overrides, and persist the resulting state via the GraphQL schema exposed by the Hasura service that ships with this project.
- All schema types capture either (a) the latest default security posture per chain/origin, (b) per-OApp overrides, (c) the effective configuration applied to delivered packets, or (d) supporting reference data (DVN metadata, packet counters).
- Every mutation of defaults or overrides recomputes the downstream effective configuration so that packets always snapshot the security config that was in force at delivery time.

## Identifier Conventions
- `eventId = {chainId}_{blockNumber}_{logIndex}` (`makeEventId`).
- `defaultScopeId = {chainId}_{originEid}` (`makeDefaultScopedId`).
- `oappId = {chainId}_{oappAddress}` (`makeOAppId`, addresses stored in lowercase).
- `securityConfigId = {oappId}_{originEid}` (`makeSecurityConfigId`); reused by `OAppReceiveLibrary`, `OAppUlnConfig`, `OAppSecurityConfig`, and `OAppEidPacketStats`.
- `DvnMetadata.id = {chainId}_{dvnAddress}`.
- Version tables always use `eventId` (sometimes suffixed with `_{eid}` for fan-out events) so histories can be replayed chronologically.

## Default Scope Entities

### `DefaultReceiveLibrary`
| Field | Type | Notes |
| --- | --- | --- |
| `id` | ID! | `{chainId}_{eid}` scope key. |
| `chainId` | BigInt | Destination chain of the EndpointV2 contract. |
| `eid` | BigInt | Origin Endpoint ID. |
| `library` | String | Lowercased receive library address or `null` if unset/zero. |
| `lastUpdatedBlock`, `lastUpdatedTimestamp` | BigInt | Block/time of the `DefaultReceiveLibrarySet` event. |
| `lastUpdatedByEventId` | String | Event identifier for traceability. |

Source event: `EndpointV2.DefaultReceiveLibrarySet(chainId, eid, newLib)`.  
Changing a default receive library triggers recomputation of every `OAppSecurityConfig` on the same `(chainId, eid)` scope.

`DefaultReceiveLibraryVersion` stores a full history (same columns as above plus `eventId`, `blockNumber`, `blockTimestamp`). Version rows use `eventId` as the primary key.

### `DefaultUlnConfig`
| Field | Type | Notes |
| --- | --- | --- |
| `id` | ID! | `{chainId}_{eid}` scope key. |
| `confirmations` | BigInt | Default block confirmations. |
| `requiredDVNCount`, `optionalDVNCount`, `optionalDVNThreshold` | Int | Default DVN numeric parameters. |
| `requiredDVNs`, `optionalDVNs` | `[String!]!` | Lowercased, deduplicated DVN lists, zero address stripped. |
| `lastUpdated*` | BigInt | Block/time of the `DefaultUlnConfigsSet` event that included the scope. |
| `lastUpdatedByEventId` | String | Event containing the default batch. |

Source event: `ReceiveUln302.DefaultUlnConfigsSet((eid, config)[])`.  
Multiple `(eid, config)` tuples in a batch share the same `eventId`, but each version row in `DefaultUlnConfigVersion` is suffixed with the `eid` (`${eventId}_${eid}`) to maintain uniqueness.

Defaults only apply when the effective receive library is the tracked `ReceiveUln302` for that chain. Other libraries are recorded but treated as untracked (see below).

## Per-OApp Override Entities

### `OApp`
| Field | Type | Notes |
| --- | --- | --- |
| `id` | ID! | `{chainId}_{oappAddress}`. |
| `chainId` | BigInt | Destination chain. |
| `address` | String! | OApp address (lowercased). |
| `totalPacketsReceived` | BigInt! | Incremented per `PacketDelivered`. |
| `lastPacketBlock`, `lastPacketTimestamp` | BigInt | Latest delivery metadata. |

Ensured/created lazily whenever an override or packet is seen.

### `OAppReceiveLibrary`
| Field | Type | Notes |
| --- | --- | --- |
| `id` | ID! | `{oappId}_{eid}` (same as security config id). |
| `oappId`, `chainId`, `oapp`, `eid` | … | Scope of the override. |
| `library` | String | Lowercased receive library override. |
| `lastUpdated*`, `lastUpdatedByEventId` | BigInt/String | Block/time/event for the override. |

Source: `EndpointV2.ReceiveLibrarySet(receiver, eid, newLib)`.  
`OAppReceiveLibraryVersion` mirrors the fields and keeps an append-only history with `eventId` primary keys.

### `OAppUlnConfig`
| Field | Type | Notes |
| --- | --- | --- |
| `id` | ID! | `{oappId}_{eid}`. |
| `confirmations`, `requiredDVNCount`, `optionalDVNCount`, `optionalDVNThreshold` | Same semantics as defaults. |
| `requiredDVNs`, `optionalDVNs` | `[String!]!` lowercased and deduplicated. |
| `lastUpdated*`, `lastUpdatedByEventId` | BigInt/String | Override provenance. |

Source: `ReceiveUln302.UlnConfigSet(oapp, eid, config)`.  
`OAppUlnConfigVersion` snapshots each change (`eventId` primary key).

Overrides can set any subset of fields. Zero or empty values are treated as “inherit default” during merge.

## Effective Configuration

### `OAppSecurityConfig`
The canonical view of a (chain, oapp, originEid) security config after defaults, overrides, and fallback rules are applied.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | ID! | `{oappId}_{eid}`. |
| `effectiveReceiveLibrary` | String | Resolved library (override > default, ignoring zero address). |
| `effectiveConfirmations` | BigInt | Resolved confirmations (override > default > undefined). |
| `effectiveRequiredDVNCount` | Int | Resolved required count; `0` when sentinel (255) is used. |
| `effectiveOptionalDVNCount` | Int! | Resolved optional count (list length or numeric fallback). |
| `effectiveOptionalDVNThreshold` | Int | Clamped so it never exceeds the optional count. |
| `effectiveRequiredDVNs`, `effectiveOptionalDVNs` | `[String!]!` | Sorted, lowercased. Required list is empty when the sentinel is used. |
| `isConfigTracked` | Boolean! | `true` only when the resolved library equals the chain’s tracked `ReceiveUln302`. |
| `usesDefaultLibrary`, `usesDefaultConfig` | Boolean! | Whether the resolved values match the default-only merge. |
| `usesRequiredDVNSentinel` | Boolean! | `true` when `requiredDVNCount` resolved from sentinel `255`. |
| `fallbackFields` | `[String!]!` | Ordered list of fields sourced from defaults because overrides were zero/empty. Order is fixed: `receiveLibrary`, `confirmations`, `requiredDVNCount`, `requiredDVNs`, `optionalDVNCount`, `optionalDVNs`, `optionalDVNThreshold`. |
| `defaultLibraryVersionId`, `defaultConfigVersionId` | String | Last contributing default version ids. |
| `libraryOverrideVersionId`, `configOverrideVersionId` | String | Last contributing override version ids (or `null` if none). |
| `lastComputedBlock`, `lastComputedTimestamp`, `lastComputedByEventId` | BigInt/String | Metadata describing when the merge was last recomputed. |

Merge logic (from `mergeSecurityConfig` in `src/EventHandlers.ts`):
- Library resolution: override wins unless it is zero; otherwise the default library is used.
- Configuration resolution: only evaluated when the library is tracked (see `TRACKED_LIBRARY_PER_CHAIN`); untracked libraries yield `isConfigTracked = false` and empty DVN data.
- Field fallback: any override set to `0`, `[]`, or absent inherits the default value and the field name is appended to `fallbackFields`.
- Sentinel handling: `requiredDVNCount = 255` indicates an optional-only configuration; required DVNs list is cleared and `effectiveRequiredDVNCount` is forced to `0` while `usesRequiredDVNSentinel = true`.
- Consistency checks: when non-sentinel required DVNs are present, the handler ensures the length of `effectiveRequiredDVNs` matches the resolved count before storage.
- DVN metadata: every resolved DVN address is inserted (if missing) into `DvnMetadata`.

Each change to defaults, overrides, or packet delivery recalculates and persists the entity so packets can pull a consistent snapshot.

## Packet-Level Observability

### `PacketDelivered`
| Field | Type | Notes |
| --- | --- | --- |
| `id` | ID! | Delivery `eventId`. |
| `chainId`, `blockNumber`, `blockTimestamp` | BigInt | Delivery context. |
| `receiver` | String! | OApp address (lowercased). |
| `srcEid` | BigInt! | Origin Endpoint ID. |
| `sender` | String! | Raw sender from the event (not normalized). |
| `nonce` | BigInt! | Packet nonce. |
| `oappId` | String! | `{chainId}_{receiver}` reference to `OApp`. |
| `securityConfigId` | String | `{oappId}_{srcEid}` reference to `OAppSecurityConfig`. |
| `effective…`, `isConfigTracked`, `usesDefault…`, `usesRequiredDVNSentinel`, `fallbackFields` | | A full copy of the `OAppSecurityConfig` fields at delivery time for immutable auditing. |
| `defaultLibraryVersionId`, `defaultConfigVersionId`, `libraryOverrideVersionId`, `configOverrideVersionId` | String | Snapshot of all contributing version IDs. |

The handler recomputes the effective configuration immediately before inserting the packet row, guaranteeing the snapshot reflects any earlier override/default changes in the same block.

### `OAppEidPacketStats`
| Field | Type | Notes |
| --- | --- | --- |
| `id` | ID! | `{oappId}_{srcEid}`. |
| `packetCount` | BigInt! | Cumulative deliveries for this scope. |
| `lastPacketBlock`, `lastPacketTimestamp` | BigInt | Latest packet metadata. |
| `lastPacketSecurityConfigId` | String | The `OAppSecurityConfig.id` used for the most recent packet. |

This table provides quick per-origin statistics without scanning `PacketDelivered`.

## Reference Data

### `DvnMetadata`
| Field | Type | Notes |
| --- | --- | --- |
| `id` | ID! | `{chainId}_{address}`. |
| `chainId` | Int! | Chain where the DVN operates. |
| `address` | String! | Lowercased DVN address. |
| `name` | String! | Canonical DVN name from `layerzero.json` (falls back to the address if unmapped). |

Entries are created lazily whenever a DVN address appears in a resolved config. The helper `buildDvnNameLookup` loads metadata from `layerzero.json`.

## Event → Table Mapping Summary
| Event | Tables Mutated |
| --- | --- |
| `EndpointV2.DefaultReceiveLibrarySet` | `DefaultReceiveLibrary`, `DefaultReceiveLibraryVersion`, recomputes `OAppSecurityConfig` for matching `(chainId, eid)`. |
| `EndpointV2.ReceiveLibrarySet` | `OApp` (ensures existence), `OAppReceiveLibrary`, `OAppReceiveLibraryVersion`, recomputes `OAppSecurityConfig` for the affected `(oapp, eid)`. |
| `ReceiveUln302.DefaultUlnConfigsSet` | `DefaultUlnConfig`, `DefaultUlnConfigVersion`, recomputes `OAppSecurityConfig` for each `(chainId, eid)` in the batch. |
| `ReceiveUln302.UlnConfigSet` | `OApp`, `OAppUlnConfig`, `OAppUlnConfigVersion`, recomputes `OAppSecurityConfig` for the affected `(oapp, eid)`. |
| `EndpointV2.PacketDelivered` | `OApp` (updates counters), `OAppEidPacketStats`, `PacketDelivered`, recomputes `OAppSecurityConfig` and snapshots it. |

## Working with the GraphQL API
- Endpoint: use the GraphQL URL exposed by your deployment (see the README for environment-specific details).
- Example query to inspect an effective config and its lineage:
  ```graphql
  query EffectiveConfig($chainId: bigint!, $oapp: String!, $eid: bigint!) {
    OAppSecurityConfig(where: {
      chainId: { _eq: $chainId }
      oapp: { _eq: $oapp }
      eid: { _eq: $eid }
    }) {
      id
      effectiveReceiveLibrary
      effectiveRequiredDVNCount
      effectiveOptionalDVNCount
      effectiveOptionalDVNThreshold
      effectiveRequiredDVNs
      effectiveOptionalDVNs
      usesDefaultLibrary
      usesDefaultConfig
      fallbackFields
      defaultLibraryVersionId
      defaultConfigVersionId
      libraryOverrideVersionId
      configOverrideVersionId
    }
  }
  ```
- Example query to correlate packets with their configs:
  ```graphql
  query Packets($oappId: String!) {
    PacketDelivered(where: { oappId: { _eq: $oappId } }, order_by: { blockNumber: desc }, limit: 20) {
      id
      srcEid
      blockNumber
      securityConfigId
      effectiveReceiveLibrary
      effectiveRequiredDVNCount
      effectiveOptionalDVNThreshold
      usesDefaultConfig
    }
  }
  ```

## Key Takeaways
- The data model is centered around `(chainId, oapp, originEid)` scopes; defaults apply per `(chainId, originEid)` while overrides customize individual OApps.
- `OAppSecurityConfig` is the source of truth for the active security posture and is recomputed on every relevant event to keep packet snapshots consistent.
- Non-`ReceiveUln302` libraries are tracked for visibility (`effectiveReceiveLibrary`, `isConfigTracked = false`), but detailed DVN data remains empty by design.
- Fallback semantics honor the LayerZero specification: zero/empty override fields inherit defaults, the sentinel `255` disables required DVNs, and optional thresholds are enforced but clamped.
