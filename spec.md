# LayerZero Security Config Indexer Specification

This indexer tracks security configurations for LayerZero OApps across multiple chains, maintaining both current state and historical versions.

---

## 1. Keys & Terminology

* **`localEid`** = The LayerZero Endpoint ID for the chain being indexed (e.g., 30111 for Optimism)
* **`eid`** = A remote Endpoint ID representing another chain
* **`oapp`** = An OApp contract address on the local chain (normalized to lowercase)
* **`oappId`** = Unique identifier: `${localEid}_${oappAddress}`
* **`srcEid`** = Source Endpoint ID for inbound packets (same as `eid` in config context)

**Effective Receive Library** for a path `(oapp, eid)`:
```typescript
effectiveLibrary = libraryOverride[oapp][eid] || defaultLibrary[eid] || undefined
```

**Effective ULN Config** = Field-by-field merge of default and OApp-specific configs, only computed when `effectiveLibrary` matches the tracked ReceiveUln302 address.

---

## 2. Entities Maintained

### Current State (Latest Values)

#### Global Defaults (per destination eid)
* **`DefaultReceiveLibrary`** - Default receive library address for each destination eid
* **`DefaultUlnConfig`** - Default ULN configuration (confirmations, DVNs, thresholds)

#### OApp-Specific Overrides (per OApp route)
* **`OAppReceiveLibrary`** - OApp's custom library (overrides default)
* **`OAppUlnConfig`** - OApp's custom ULN config (overrides default)
* **`OAppPeer`** - Configured peer address for each destination
  * `fromPacketDelivered: false` - Explicitly set via `PeerSet` event
  * `fromPacketDelivered: true` - Auto-discovered from packet delivery
  * **Peer interpretation**: Usually a zero peer, aswell as an unset peer mean that the route is blocked. But analysts should treat this as an assumption because some OApps override peer handling in custom logic. In such cases the auto-discovery from PacketDelivered shows which peers are set in practice.

#### Computed Security Configuration
* **`OAppSecurityConfig`** - Merged effective config for each OApp route
  * `libraryStatus`: `"tracked"` | `"unsupported"` | `"none"`
  * `usesDefaultLibrary`: Whether falling back to default library
  * `usesDefaultConfig`: Whether falling back to default ULN config
  * `fallbackFields`: Which config fields fall back to defaults
  * Effective DVN arrays, confirmations, thresholds
  * Peer information

#### Activity Tracking
* **`OAppStats`** - Per-OApp packet counters and timestamps
* **`OAppRouteStats`** - Per-route (OApp + srcEid) packet statistics
* **`PacketDelivered`** - Individual packet delivery records with snapshot of security config at delivery time

#### Rate Limiting (OFT-specific)
* **`OAppRateLimiter`** - Rate limiter contract address
* **`OAppRateLimit`** - Per-destination rate limits (limit, window)

### Historical Versions

Every state change creates a version entity:
* `DefaultReceiveLibraryVersion`
* `DefaultUlnConfigVersion`
* `OAppReceiveLibraryVersion`
* `OAppUlnConfigVersion`
* `OAppPeerVersion`
* `OAppRateLimiterVersion`
* `OAppRateLimitVersion`

---

## 3. Event → State Update Rules

### EndpointV2 Events

**`DefaultReceiveLibrarySet(eid, newLib)`**
1. Update `DefaultReceiveLibrary[localEid_eid]`
2. Create `DefaultReceiveLibraryVersion` history record
3. **Recompute** all `OAppSecurityConfig` entities for `(localEid, eid)` scope

**`ReceiveLibrarySet(receiver, eid, newLib)`**
1. Update `OAppReceiveLibrary[oappId_eid]`
2. Create `OAppReceiveLibraryVersion` history record
3. **Compute** `OAppSecurityConfig` for this specific `(oappId, eid)` route

**`PacketDelivered(origin, receiver)`**
1. Increment `OAppStats.totalPacketsReceived` for receiver
2. Increment `OAppRouteStats.packetCount` for (receiver, srcEid)
3. Handle peer state:
   * If no peer exists → auto-create `OAppPeer` with `fromPacketDelivered: true`
   * If peer exists with `fromPacketDelivered: false`:
     * If peer is zero address → **WARN** "route explicitly blocked"
     * If peer doesn't match sender → **WARN** "sender mismatch"
   * Missing peer records still imply a blocked route per protocol defaults, but dashboards should label them as **implicit blocks** to account for custom OApps that may bypass peer checks.
4. **Compute** and snapshot `OAppSecurityConfig` at delivery time
5. Store `PacketDelivered` record with config snapshot

### ReceiveUln302 Events (Tracked Receive Library)

**`DefaultUlnConfigsSet(params[])`**
* For each `(eid, config)` in params:
  1. Update `DefaultUlnConfig[localEid_eid]` (full replace)
  2. Create `DefaultUlnConfigVersion` history record
  3. **Recompute** all `OAppSecurityConfig` entities for `(localEid, eid)` scope

**`UlnConfigSet(oapp, eid, config)`**
1. Update `OAppUlnConfig[oappId_eid]` (full replace)
2. Create `OAppUlnConfigVersion` history record
3. **Compute** `OAppSecurityConfig` for this specific `(oappId, eid)` route

### OAppOFT Events (Wildcard - Any Contract)

**`PeerSet(eid, peer)`** (from transaction's `srcAddress`)
1. Update `OAppPeer[oappId_eid]` with `fromPacketDelivered: false`
2. Create `OAppPeerVersion` history record
3. **Compute** `OAppSecurityConfig` and update peer fields

**`RateLimiterSet(rateLimiter)`**
1. Update `OAppRateLimiter[oappId]`
2. Create `OAppRateLimiterVersion` history record

**`RateLimitsChanged(rateLimitConfigs[])`**
* For each `(dstEid, limit, window)`:
  1. Update `OAppRateLimit[oappId_dstEid]`
  2. Create `OAppRateLimitVersion` history record

---

## 4. Computing Effective Security Configuration

The `computeAndPersistEffectiveConfig` function always fetches fresh state:

```typescript
const defaults = {
  library: DefaultReceiveLibrary[localEid_eid],
  config: DefaultUlnConfig[localEid_eid]
};

const overrides = {
  library: OAppReceiveLibrary[oappId_eid],
  config: OAppUlnConfig[oappId_eid]
};

const resolved = mergeSecurityConfig(defaults, overrides);
```

This ensures defaults set **before** an OApp exists are correctly applied when the OApp's config is later computed.

### Library Status Resolution

```typescript
if (!effectiveReceiveLibrary) {
  libraryStatus = "none"  // No library configured
} else if (effectiveReceiveLibrary === trackedReceiveUln302) {
  libraryStatus = "tracked"  // ULN config available
} else {
  libraryStatus = "unsupported"  // Different library, ULN unavailable
}
```

Only `"tracked"` configs have ULN fields (confirmations, DVNs) populated.

---

## 5. ULN Config Merge Logic

### Sentinel Values

Special values that mean "explicitly set to zero" (not "inherit from default"):

| Field | Type | 0 means | Sentinel means |
|-------|------|---------|----------------|
| `confirmations` | BigInt | Inherit default | `2^64-1`: Zero confirmations |
| `requiredDVNCount` | Int | Inherit default | `255`: Zero required DVNs |
| `optionalDVNCount` | Int | Inherit default | `255`: Zero optional DVNs |

### Field-by-Field Merge

For each config field:
```typescript
if (oappValue !== 0 && oappValue !== sentinel) {
  effective = oappValue
} else if (oappValue === sentinel) {
  effective = 0  // Explicitly zero
  // Don't mark as fallback
} else {
  effective = defaultValue
  if (oappHasAnyConfig) fallbackFields.add(fieldName)
}
```

**Fallback Fields**: Array of field names that fell back to defaults. Used to track which parts of config are inherited vs. explicitly set.

### DVN Arrays

```typescript
// Required DVNs
if (requiredDVNCount === 255) {
  effectiveRequiredDVNs = []  // Sentinel: explicitly none
} else if (oapp.requiredDVNs.length > 0) {
  effectiveRequiredDVNs = oapp.requiredDVNs
} else {
  effectiveRequiredDVNs = default.requiredDVNs
  fallbackFields.add("requiredDVNs")
}

// Similar logic for optional DVNs
```

### Validation & Auto-Correction

* **DVN Count Mismatch**: Warns if `requiredDVNCount != requiredDVNs.length` (except sentinel)
* **Threshold Overflow**: Auto-caps `optionalDVNThreshold` to `optionalDVNCount` if exceeded
* **Zero Addresses**: Warns if DVN arrays contain zero addresses (filtered out)

---

## 6. Recomputation on Default Changes

When a default changes, **all** OApp configs for that scope must be recomputed:

```typescript
// DefaultReceiveLibrarySet or DefaultUlnConfigsSet
const affectedConfigs = OAppSecurityConfig.getWhere.localEid.eq(localEid)
  .filter(c => c.eid === changedEid)

for (const config of affectedConfigs) {
  computeAndPersistEffectiveConfig(config.oappId, config.eid)
}
```

This ensures OApps using defaults (`usesDefaultLibrary: true` or `usesDefaultConfig: true`) immediately reflect changes.

---

## 7. Peer Configuration States

| State | `OAppPeer` exists? | `peer` value | `fromPacketDelivered` | Meaning |
|-------|-------------------|--------------|----------------------|---------|
| Never set | No | - | - | treated as blocked by default, but auto-discovered thorugh PacketDelivered(see note) |
| Auto-discovered | Yes | Non-zero | `true` | Discovered from `PacketDelivered` |
| Explicitly set | Yes | Non-zero | `false` | Set via `PeerSet` event |
| Explicitly blocked | Yes | Zero address | `false` | Route blocked via `PeerSet(eid, 0x0)` |

**Security Validation**: Warns when packets are delivered on explicitly blocked routes or from mismatched peers.

> **Protocol vs. OApp nuance**: LayerZero Endpoint + Receive Library treat the peer address as an application-level guard. The protocol default initializes peers to the zero address, effectively blocking traffic until the OApp sets an explicit peer or observes one via delivery. Some OApps ship bespoke code that accept traffic regardless of peer state or do not emit events on peer changes. The indexer therefore:
> * assumes zero peer **and** missing peer records both indicate a blocked route;
> * surfaces whether the block was explicit (`PeerSet` to zero) or implicit (never configured) so analysts can gauge certainty.
> Consumers should interpret implicit blocks with caution because custom OApps might still accept packets despite the missing peer setup. Such cases are indexed with our PacketDelivered handler

---

## 8. Query Patterns for Frontend

### Find OApps with specific library status
```graphql
oAppSecurityConfigs(where: { libraryStatus: "unsupported" })
```

### Find OApps using defaults
```graphql
oAppSecurityConfigs(where: {
  usesDefaultLibrary: true,
  usesDefaultConfig: true
})
```

### Find explicitly blocked routes
```graphql
oAppPeers(where: {
  peer: "0x0000000000000000000000000000000000000000",
  fromPacketDelivered: false
})
```

### Get config history for an OApp route
```graphql
oAppReceiveLibraryVersions(where: { oappId: "30111_0xabc..." })
oAppUlnConfigVersions(where: { oappId: "30111_0xabc..." })
```

### Find packets delivered with specific security config
```graphql
packetDelivereds(where: {
  isConfigTracked: true,
  usesDefaultConfig: false
})
```

---

## 9. Important Implementation Notes

* **Address Normalization**: All addresses stored as lowercase. OApp addresses can be bytes32 (cross-chain) or EVM addresses.
* **Zero Address Semantics** (context-dependent):
  * **Library override = `0x0`**: "Unset override, use default" (LayerZero V2 semantics)
  * **Library default = `0x0`**: "No default configured" → route unconfigured/blocked
  * **Peer = `0x0`**: Protocol default = blocked route. Indexer treats both explicit zero peers and missing peer configs as blocked, but marks implicit cases separately because some OApps bypass peer enforcement.
  * **DVN = `0x0`**: **Invalid** (filtered out, warned) - Use sentinel count `255` for "no DVNs"
  * **Result**: Zero addresses are never valid libraries or DVNs; only peers use zero for explicit blocking
* **Event Ordering**: Process events strictly in (blockNumber, logIndex) order.
* **Preload Skip**: All handlers check `context.isPreload` and return early during preload phase.
* **Error Handling**: Recomputation continues processing other configs even if one fails.
* **Wildcard OFT Events**: `PeerSet`, `RateLimiterSet`, `RateLimitsChanged` use `{ wildcard: true }` to track any contract emitting these events.

---

## 10. Tracked Receive Library Registry

Each chain has a tracked ReceiveUln302 address defined in `localChainRegistry.ts`:

```typescript
const LOCAL_CHAIN_CONFIGS = [
  { chainId: 1, localEid: 30101n, receiveUln302: "0xc02ab410..." },
  { chainId: 10, localEid: 30111n, receiveUln302: "0x3c4962f..." },
  // ...
]
```

Only routes using these tracked libraries have ULN configs computed and `libraryStatus: "tracked"`.
