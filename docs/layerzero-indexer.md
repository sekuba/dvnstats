# LayerZero Security Configuration Indexer

## Table of Contents
- [Overview](#overview)
- [LayerZero Security Architecture](#layerzero-security-architecture)
- [Indexer Architecture](#indexer-architecture)
- [Event Handlers](#event-handlers)
- [Configuration Merge Logic](#configuration-merge-logic)
- [Sentinel Values](#sentinel-values)
- [Data Model](#data-model)
- [Implementation Details](#implementation-details)
- [Validation & Error Handling](#validation--error-handling)

---

## Overview

This indexer tracks LayerZero V2 security configurations across 16 EVM chains, providing real-time and historical views of how OApps (Omnichain Applications) configure their cross-chain message verification.

**Purpose**: Monitor and analyze DVN (Decentralized Verifier Network) configurations, including:
- Protocol-wide defaults set by LayerZero
- OApp-specific overrides
- Effective security settings (merged defaults + overrides)
- Point-in-time security snapshots for each packet delivery
- DVN metadata and naming

**Chains Indexed**: Ethereum, Optimism, BSC, Fantom, Polygon, zkSync Era, Worldchain, Zora, Lisk, Lumia, Base, Mode, Arbitrum One, Taiko, Linea, Blast, Scroll, Zora Network (16 total)

---

## LayerZero Security Architecture

### Security Model

LayerZero uses **Decentralized Verifier Networks (DVNs)** to verify cross-chain messages. Each message must be verified by:
- **Required DVNs**: ALL must verify (no threshold)
- **Optional DVNs**: M-of-N must verify (configurable threshold)

```
Message Verification = (ALL required DVNs) AND (M of N optional DVNs)
```

### Three-State Configuration System

Each UlnConfig field supports three distinct states:

| State | Value | Meaning |
|-------|-------|---------|
| **Inherit** | `0` or `undefined` | Use the default configuration for that chain |
| **Override** | Normal value | Use this specific value |
| **Explicit Nil** | Sentinel (max_value) | Explicitly override to ZERO (do not inherit) |

**Example Scenario**:
```typescript
// Default config for chain
Default: {
  requiredDVNCount: 2,
  requiredDVNs: [DVN_A, DVN_B],
  confirmations: 15
}

// OApp config
OApp: {
  requiredDVNCount: 0,      // ← Inherits default (2 DVNs)
  confirmations: 20         // ← Overrides to 20
}

// Effective result
Effective: {
  requiredDVNCount: 2,      // Inherited from default
  requiredDVNs: [DVN_A, DVN_B],
  confirmations: 20         // Used override
}
```

**Critical Security Distinction**:
- `requiredDVNCount = 0` → Inherits default (might require 2 DVNs)
- `requiredDVNCount = 255` → Explicitly requires ZERO DVNs (**security risk!**)

### UlnConfig Structure

```solidity
struct UlnConfig {
  uint64 confirmations;          // Block confirmations required
  uint8 requiredDVNCount;        // Number of required DVNs
  uint8 optionalDVNCount;        // Number of optional DVNs
  uint8 optionalDVNThreshold;    // How many optional DVNs must verify
  address[] requiredDVNs;        // Required DVN addresses
  address[] optionalDVNs;        // Optional DVN addresses
}
```

**Validation Rules**:
- For required DVNs: **ALL** in the list must verify
- For optional DVNs: **at least threshold** must verify
- `optionalDVNThreshold ≤ optionalDVNCount`
- Counts should match array lengths (except when using sentinel values)

**Example Configuration**:
```typescript
{
  confirmations: 20,
  requiredDVNCount: 1,
  requiredDVNs: [DVN_Polyhedra],
  optionalDVNCount: 3,
  optionalDVNThreshold: 2,
  optionalDVNs: [DVN_Google, DVN_Chainlink, DVN_Acme]
}
```
**Validation Rule**: Message valid when it has attestations from:
- Polyhedra (required) **AND**
- Any 2 of 3 optional DVNs (Google, Chainlink, Acme)

---

## Indexer Architecture

### System Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Event Sources                             │
├─────────────────────────────────────────────────────────────┤
│ EndpointV2                    │  ReceiveUln302               │
│ - PacketDelivered             │  - DefaultUlnConfigsSet      │
│ - DefaultReceiveLibrarySet    │  - UlnConfigSet              │
│ - ReceiveLibrarySet           │                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Data Processing Layer                       │
├─────────────────────────────────────────────────────────────┤
│ • Address Normalization (lowercase, dedupe, sort)           │
│ • Sentinel Value Interpretation                             │
│ • Default/Override Merging Logic                            │
│ • Fallback Field Tracking                                   │
│ • DVN Metadata Resolution                                   │
│ • Config Validation & Logging                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   Entity Storage (11 Types)                  │
├─────────────────────────────────────────────────────────────┤
│ Current State:           Version History:                    │
│ - DefaultReceiveLibrary  - DefaultReceiveLibraryVersion     │
│ - DefaultUlnConfig       - DefaultUlnConfigVersion          │
│ - OAppReceiveLibrary     - OAppReceiveLibraryVersion        │
│ - OAppUlnConfig          - OAppUlnConfigVersion             │
│                                                              │
│ Computed & Analytics:                                        │
│ - OApp (aggregate stats) - OAppSecurityConfig (effective)   │
│ - OAppEidPacketStats     - PacketDelivered (snapshot)       │
│ - DvnMetadata (names)                                        │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **State + History Pattern**: Current state entities for fast queries, Version entities for complete audit trail
2. **Denormalization**: `PacketDelivered` stores full security config snapshot (no joins needed)
3. **Config Tracking Filter**: Only processes configs for hardcoded ReceiveUln302 addresses per chain
4. **Cascade Recomputation**: Default changes trigger recomputation of all affected OApp configs

---

## Event Handlers

### 1. EndpointV2.DefaultReceiveLibrarySet

**Purpose**: Tracks protocol-wide default receive library per endpoint ID (eid)

**Source**: `EndpointV2` contract
**Event**: `DefaultReceiveLibrarySet(uint32 eid, address newLib)`

**Processing Flow**:
```typescript
1. Normalize library address → lowercase
2. Create/update DefaultReceiveLibrary entity (current state)
   - ID: chainId_eid
   - Stores: library address, block/timestamp, eventId
3. Create DefaultReceiveLibraryVersion entity (historical record)
   - ID: chainId_blockNumber_logIndex
   - Immutable snapshot
4. Trigger recomputeSecurityConfigsForScope()
   - Fetches all OAppSecurityConfig for this chain
   - Filters by eid
   - Recomputes effective config for each affected OApp
```

**Key Insight**: This is a **cascade trigger** - changing a default library can affect hundreds of OApps.

**Error Handling**: Recomputation continues on individual failures, logs errors with context

---

### 2. ReceiveUln302.DefaultUlnConfigsSet

**Purpose**: Sets protocol-wide security config defaults (confirmations, DVNs, thresholds)

**Source**: `ReceiveUln302` contract
**Event**: `DefaultUlnConfigsSet((uint32,(uint64,uint8,uint8,uint8,address[],address[]))[] params)`

**Processing Flow**:
```typescript
1. Batch processing (single event can set multiple configs)
2. For each (eid, config) pair:
   a. Destructure config tuple into named variables
   b. Check for zero addresses in DVN arrays → log warnings
   c. Normalize DVN addresses (lowercase, dedupe, sort, filter zeros)
   d. Create/update DefaultUlnConfig entity
   e. Validate config (counts vs arrays, threshold vs count)
   f. Create DefaultUlnConfigVersion with composite ID
      - ID: eventId_eid (differs from other versions!)
   g. Trigger recomputeSecurityConfigsForScope()
```

**Version ID Special Case**:
```typescript
// DefaultUlnConfigVersion uses composite ID because one event can set multiple configs
const versionId = `${eventId}_${eid}`;

// Other Version entities use simple eventId (one config per event)
const versionId = eventId;
```

**Validation Checks**:
- DVN count matches array length (except sentinels)
- Threshold ≤ count
- Zero addresses logged but filtered out

---

### 3. EndpointV2.ReceiveLibrarySet

**Purpose**: OApp-specific override for receive library

**Source**: `EndpointV2` contract
**Event**: `ReceiveLibrarySet(address receiver, uint32 eid, address newLib)`

**Processing Flow**:
```typescript
1. Normalize receiver and library addresses
2. Create OApp entity if doesn't exist (using getOrCreate)
   - Initial state: 0 packets, no timestamps
3. Store library override in OAppReceiveLibrary
   - ID: oappId_eid
4. Create OAppReceiveLibraryVersion (historical)
5. Compute effective config for this specific OApp+eid pair
   - Merges this library override with defaults
   - Stores result in OAppSecurityConfig
```

**ID Structure**:
- OApp: `chainId_oappAddress`
- Library Config: `oappId_eid`
- Security Config: `oappId_eid` (same as library config ID)

---

### 4. ReceiveUln302.UlnConfigSet

**Purpose**: OApp-specific security config override

**Source**: `ReceiveUln302` contract
**Event**: `UlnConfigSet(address oapp, uint32 eid, (uint64,uint8,uint8,uint8,address[],address[]) config)`

**Processing Flow**:
```typescript
1. Destructure config tuple
2. Check for zero addresses → log warnings
3. Normalize DVN addresses
4. Create OApp entity if doesn't exist
5. Store config in OAppUlnConfig
6. Validate config
7. Create OAppUlnConfigVersion (historical)
8. Compute effective config
   - Merges this config override with defaults
   - Stores result in OAppSecurityConfig
```

**Similar to**: DefaultUlnConfigsSet but for individual OApps

**Key Difference**: Only processes single config per event (no batch)

---

### 5. EndpointV2.PacketDelivered

**Purpose**: Records packet delivery with full security config snapshot

**Source**: `EndpointV2` contract
**Event**: `PacketDelivered((uint32,bytes32,uint64) origin, address receiver)`

**Processing Flow**:
```typescript
1. Extract origin tuple: [srcEid, sender, nonce]
2. Create/update OApp entity
   - Increment totalPacketsReceived
   - Update lastPacketBlock/Timestamp
3. Create/update OAppEidPacketStats
   - Per-source-eid statistics
   - Increment packetCount for this source
4. Compute effective config at delivery time
   - Critical: captures security settings AT THIS MOMENT
5. Update stats with security config reference
6. Create PacketDelivered entity with FULL denormalized config
   - All effective security fields copied
   - No foreign key lookups needed for queries
```

**Why Denormalization?**:
```typescript
// Allows queries like "show all packets delivered with zero required DVNs"
// Without needing to join OAppSecurityConfig table
SELECT * FROM PacketDelivered
WHERE effectiveRequiredDVNCount = 0
  AND isConfigTracked = true;
```

**Error Handling**: Full try-catch with detailed context logging before re-throw

---

## Configuration Merge Logic

### The mergeSecurityConfig Function

This is the **most complex and critical** function in the system. It implements the three-state configuration system.

**Signature**:
```typescript
const mergeSecurityConfig = (
  context: handlerContext | undefined,  // For logging
  chainId: number,
  eid: bigint,
  oappId: string | undefined,           // For logging
  defaults: { library?: string; config: NormalizedConfig },
  overrides?: { library?: string; config: NormalizedConfig }
): MergeResult
```

### Merge Priority Rules

```
Priority Order (highest to lowest):
1. Override with non-zero value
2. Default value
3. Override with zero value (only if override has OTHER values)
4. undefined
```

**Example**:
```typescript
Default:    { confirmations: 15, requiredDVNCount: 2 }
Override:   { confirmations: 20, requiredDVNCount: 0 }
Effective:  { confirmations: 20, requiredDVNCount: 2 }  // ← inherited!
            fallbackFields: ["requiredDVNCount"]
```

### Receive Library Merging

```typescript
1. If override library is non-zero → use override
2. Else if default library exists → use default
   - Mark "receiveLibrary" as fallback if override was zero
3. Else → undefined

// Config tracking check
if (effectiveLibrary !== TRACKED_LIBRARY_PER_CHAIN[chainId]) {
  return emptyConfig;  // Don't track configs for unknown libraries
}
```

### Confirmations Merging

```typescript
if (override !== undefined && override !== 0n) {
  effective = (override === SENTINEL_CONFIRMATIONS) ? 0n : override;
} else if (default !== undefined) {
  effective = (default === SENTINEL_CONFIRMATIONS) ? 0n : default;
  if (overrideHasConfig && (override === undefined || override === 0n)) {
    fallbackFields.add("confirmations");
  }
} else {
  effective = undefined;
}
```

**Sentinel Handling**: `2^64-1` means "explicitly zero confirmations" (not inherit)

### Required DVN Count Merging

```typescript
if (override !== undefined &&
    (override > 0 || override === SENTINEL_REQUIRED_DVN_COUNT)) {
  rawCount = override;
} else if (default !== undefined) {
  rawCount = default;
  if (overrideHasConfig && (override === undefined || override === 0)) {
    fallbackFields.add("requiredDVNCount");
  }
}

// Special sentinel handling
if (rawCount === SENTINEL_REQUIRED_DVN_COUNT) {
  effectiveCount = 0;
  effectiveDVNs = [];  // Ignore DVN list when sentinel
  usesRequiredDVNSentinel = true;
}
```

### Optional DVN Count Merging

```typescript
if (override !== undefined &&
    (override > 0 || override === SENTINEL_OPTIONAL_DVN_COUNT)) {
  rawCount = (override === SENTINEL_OPTIONAL_DVN_COUNT) ? 0 : override;
} else if (default !== undefined) {
  rawCount = (default === SENTINEL_OPTIONAL_DVN_COUNT) ? 0 : default;
  if (overrideHasConfig && (override === undefined || override === 0)) {
    fallbackFields.add("optionalDVNCount");
  }
}
```

### DVN List Merging

```typescript
// For required DVNs
if (usesRequiredDVNSentinel) {
  effectiveDVNs = [];  // Sentinel means ignore list
} else if (overrideDVNs.length > 0) {
  effectiveDVNs = overrideDVNs;
} else if (defaultDVNs.length > 0 || defaultCount > 0) {
  effectiveDVNs = defaultDVNs;
  if (overrideHasConfig && overrideDVNs.length === 0) {
    fallbackFields.add("requiredDVNs");
  }
}

// Final count determination
if (usesRequiredDVNSentinel) {
  effectiveCount = 0;
} else if (effectiveDVNs.length > 0) {
  effectiveCount = effectiveDVNs.length;  // Use actual array length
} else if (rawCount !== undefined) {
  effectiveCount = rawCount;  // Use declared count (may not have addresses yet)
}
```

### Threshold Capping

```typescript
// Auto-correct if threshold > count (defensive)
if (effectiveOptionalDVNThreshold > effectiveOptionalDVNCount) {
  const original = effectiveOptionalDVNThreshold;
  effectiveOptionalDVNThreshold = effectiveOptionalDVNCount;

  context.log.warn("UlnConfig auto-correction: threshold capped", {
    chainId, eid, oappId,
    originalThreshold: original,
    cappedThreshold: effectiveOptionalDVNThreshold
  });
}
```

### Fallback Field Tracking

Tracks which fields fell back to defaults:
```typescript
fallbackFields = ["confirmations", "requiredDVNs"]
// Means: OApp had SOME config but these specific fields inherited from default
```

**Order Preserved**: `["receiveLibrary", "confirmations", "requiredDVNCount", ...]`

### Config Comparison

```typescript
const usesDefaultLibrary =
  effectiveLibrary === defaultResolvedLibrary;

const usesDefaultConfig =
  isConfigTracked &&
  defaultIsConfigTracked &&
  configsAreEqual(resolved.comparable, defaultResolved.comparable);
```

Where `configsAreEqual` performs deep comparison:
- Sentinel flags match
- Counts match
- Thresholds match
- DVN arrays match (order-sensitive)
- Confirmations match

---

## Sentinel Values

### Complete Sentinel Table

| Field | Type | Default (0) | Normal Value | Sentinel (NIL) | Effective When Sentinel |
|-------|------|-------------|--------------|----------------|------------------------|
| `confirmations` | `uint64` | Inherit | 1-N blocks | `2^64-1` (18446744073709551615) | `0n` |
| `requiredDVNCount` | `uint8` | Inherit | 1-N DVNs | `255` | `0` |
| `optionalDVNCount` | `uint8` | Inherit | 1-N DVNs | `255` | `0` |
| `optionalDVNThreshold` | `uint8` | Inherit | 1-N DVNs | N/A | N/A |

**Constants**:
```typescript
const SENTINEL_CONFIRMATIONS = 18446744073709551615n;  // 2^64 - 1
const SENTINEL_REQUIRED_DVN_COUNT = 255;               // type(uint8).max
const SENTINEL_OPTIONAL_DVN_COUNT = 255;               // type(uint8).max
```

### Why Sentinels Exist

**Problem**: How to distinguish "inherit default" from "explicitly set to zero"?

**Solution**: Use max value as sentinel

**Example Scenario**:
```typescript
// Chain default requires 2 DVNs
Default: { requiredDVNCount: 2, requiredDVNs: [DVN_A, DVN_B] }

// Case 1: OApp sets count to 0
OApp_A: { requiredDVNCount: 0 }
→ Inherits default → requires DVN_A and DVN_B ✓

// Case 2: OApp sets count to sentinel
OApp_B: { requiredDVNCount: 255 }
→ Explicitly requires ZERO DVNs → no verification! ⚠️
```

### Sentinel Usage in Practice

**Rare but Critical**:
- Most configs use required DVNs exclusively (no optionals)
- Sentinel values are rarely used in production
- When used, they represent conscious security decisions (or risks)

**Logging Strategy**:
```typescript
// Debug level - informational tracking
if (requiredDVNCount === SENTINEL_REQUIRED_DVN_COUNT) {
  context.log.debug("UlnConfig using sentinel: requiredDVNCount=255 (NIL)", {
    chainId, eid, source
  });
}
```

**Security Implications**:
- `requiredDVNCount = 255` → Zero required DVNs (high risk)
- `optionalDVNCount = 255` → Zero optional DVNs (might be fine if required DVNs exist)
- `confirmations = 2^64-1` → Zero confirmations (instant finality, high risk on certain chains)

---

## Data Model

### Entity Categories

**1. Default State (Protocol-Level)**
- `DefaultReceiveLibrary` - Current default library per (chain, eid)
- `DefaultUlnConfig` - Current default UlnConfig per (chain, eid)

**2. Default History (Immutable Versions)**
- `DefaultReceiveLibraryVersion` - Every library change
- `DefaultUlnConfigVersion` - Every config change

**3. OApp State (Application-Level)**
- `OApp` - OApp metadata and aggregate stats
- `OAppReceiveLibrary` - Current library override per (oapp, eid)
- `OAppUlnConfig` - Current config override per (oapp, eid)

**4. OApp History (Immutable Versions)**
- `OAppReceiveLibraryVersion` - Every library change
- `OAppUlnConfigVersion` - Every config change

**5. Computed State**
- `OAppSecurityConfig` - Effective merged config per (oapp, eid)
- `OAppEidPacketStats` - Packet statistics per (oapp, srcEid)

**6. Events**
- `PacketDelivered` - Every packet with denormalized security config

**7. Metadata**
- `DvnMetadata` - DVN names per (chain, address)

### ID Schemes

```typescript
// Event-based IDs
eventId = `${chainId}_${blockNumber}_${logIndex}`

// Scoped IDs
defaultScopedId = `${chainId}_${eid}`
oappId = `${chainId}_${oappAddress}`
securityConfigId = `${oappId}_${eid}`

// Version IDs (special case for DefaultUlnConfigVersion)
defaultUlnConfigVersionId = `${eventId}_${eid}`  // Composite!
otherVersionId = eventId  // Simple
```

### Key Relationships

```
OApp (1) ──< (N) OAppSecurityConfig (per source eid)
OApp (1) ──< (N) OAppEidPacketStats (per source eid)
OApp (1) ──< (N) PacketDelivered

OAppSecurityConfig (1) ──> (1) DefaultReceiveLibrary (via chain+eid)
OAppSecurityConfig (1) ──> (1) DefaultUlnConfig (via chain+eid)
OAppSecurityConfig (1) ──> (0..1) OAppReceiveLibrary (if override exists)
OAppSecurityConfig (1) ──> (0..1) OAppUlnConfig (if override exists)

OAppSecurityConfig (1) ──> (1) DefaultReceiveLibraryVersion (via ID reference)
OAppSecurityConfig (1) ──> (1) DefaultUlnConfigVersion (via ID reference)
OAppSecurityConfig (1) ──> (0..1) OAppReceiveLibraryVersion (via ID reference)
OAppSecurityConfig (1) ──> (0..1) OAppUlnConfigVersion (via ID reference)

PacketDelivered (1) ──> (1) OAppSecurityConfig (denormalized)
```

### Indexes

All entities have appropriate indexes on:
- `chainId` - for filtering by chain
- `eid` - for filtering by endpoint
- `oappId` / `oapp` - for filtering by application
- `eventId` - for tracing changes
- Foreign key references

---

## Implementation Details

### Address Normalization

```typescript
const normalizeAddress = (value: string | undefined | null): string | undefined =>
  value ? value.toLowerCase() : undefined;

const isZeroAddress = (value: string | undefined | null): boolean =>
  value?.toLowerCase() === "0x0000000000000000000000000000000000000000";
```

**DVN Address Processing**:
```typescript
const uniqueNormalizedAddresses = (input: readonly string[]): string[] => {
  const seen = new Set<string>();
  for (const value of input) {
    const normalized = normalizeAddress(value);
    if (!normalized || isZeroAddress(normalized) || seen.has(normalized)) {
      continue;  // Skip zero addresses and duplicates
    }
    seen.add(normalized);
  }
  return Array.from(seen).sort();  // Sorted for consistent comparison
};
```

### DVN Metadata Resolution

**Source**: `layerzero.json` (738.2 KB metadata file)

**Structure**:
```typescript
{
  [network]: {
    chainDetails: { nativeChainId: number },
    dvns: {
      [address]: {
        canonicalName?: string,
        name?: string,
        id?: string
      }
    }
  }
}
```

**Lookup**:
```typescript
const DVN_CHAIN_AWARE_LOOKUP = buildChainAwareDvnLookup(layerzeroMetadata);
// Map: "chainId_address" → "name"

const getDvnName = (chainId: number, address: string): string | undefined =>
  DVN_CHAIN_AWARE_LOOKUP.get(`${chainId}_${address}`);
```

**Metadata Upsert**:
```typescript
// Creates or updates DvnMetadata entity
// Updates name if changed (mutable - affects historical records)
await ensureDvnMetadataEntries(context, chainId, dvnAddresses);
```

### Config Tracking Filter

**Only tracks configs for supported ReceiveUln302 addresses**:
```typescript
const RECEIVE_ULN_302_PER_CHAIN: Record<number, string> = {
  1: "0xc02ab410f0734efa3f14628780e6e695156024c2",     // Ethereum
  10: "0x3c4962ff6258dcfcafd23a814237b7d6eb712063",    // Optimism
  56: "0xb217266c3a98c8b2709ee26836c98cf12f6ccec1",    // BSC
  // ... 16 chains total
};

const isTrackedReceiveLibrary = (chainId: number, library?: string): boolean => {
  const tracked = RECEIVE_ULN_302_PER_CHAIN[chainId];
  return tracked !== undefined && tracked === library;
};
```

**If not tracked**:
```typescript
return {
  effectiveReceiveLibrary,
  effectiveConfirmations: undefined,
  effectiveRequiredDVNCount: undefined,
  effectiveOptionalDVNCount: 0,
  effectiveOptionalDVNs: [],
  effectiveRequiredDVNs: [],
  isConfigTracked: false,
  // ...
};
```

### Cascade Recomputation

**Triggered by**: Default library or config changes

**Process**:
```typescript
const recomputeSecurityConfigsForScope = async (
  context, chainId, chainIdBigInt, eid, blockNumber, blockTimestamp, eventId
) => {
  // 1. Fetch all security configs for chain
  const configsForChain = await context.OAppSecurityConfig
    .getWhere.chainId.eq(chainIdBigInt);

  // 2. Filter by eid (in-memory)
  const configsForEid = configsForChain.filter(c => c.eid === eid);

  // 3. Recompute each affected config
  for (const config of configsForEid) {
    try {
      await computeAndPersistEffectiveConfig({
        context, chainId, chainIdBigInt,
        oappId: config.oappId,
        oappAddress: config.oapp,
        eid, blockNumber, blockTimestamp, eventId
      });
    } catch (error) {
      context.log.error("Failed to recompute", error);
      // Continue processing others
    }
  }
};
```

**Performance**: May process hundreds of OApps per default change. Errors on individual OApps don't stop batch processing.

---

## Validation & Error Handling

### Validation Functions

**1. validateUlnConfig**
```typescript
validateUlnConfig(context, config, source, chainId, eid): boolean
```

**Checks**:
- `requiredDVNCount === requiredDVNs.length` (except sentinel)
- `optionalDVNCount === optionalDVNs.length` (except sentinel)
- `optionalDVNThreshold <= optionalDVNCount`

**Logging**: Warns on validation failures but doesn't throw

**Returns**: `true` if valid, `false` if issues found

**2. checkForZeroAddresses**
```typescript
checkForZeroAddresses(context, addresses, source, chainId, eid, dvnType)
```

**Purpose**: Detects zero addresses before normalization filters them out

**Logging**: Warns when found (indicates potential misconfiguration)

### Error Boundaries

**recomputeSecurityConfigsForScope**:
```typescript
try {
  // Outer try: Query and loop
  for (const config of configsForEid) {
    try {
      // Inner try: Individual recomputation
      await computeAndPersistEffectiveConfig(...);
    } catch (error) {
      // Log error, continue processing others
      context.log.error("Failed to recompute", error);
      context.log.error("Context", { chainId, eid, oappId });
    }
  }
} catch (error) {
  // Critical error in query or loop
  context.log.error("Failed entire scope", error);
  throw error;  // Re-throw to halt processing
}
```

**PacketDelivered Handler**:
```typescript
try {
  // Entire handler logic
} catch (error) {
  context.log.error("Failed to process PacketDelivered", error);
  context.log.error("Context", {
    chainId, blockNumber, logIndex,
    receiver, origin
  });
  throw error;  // Re-throw to prevent partial state
}
```

### Logging Strategy

**Debug** - Informational tracking:
- Sentinel value usage
- Recomputation progress
- Empty query results

**Info** - Normal operations:
- Major processing milestones

**Warn** - Potential issues:
- Validation failures
- Zero addresses detected
- Threshold capping
- Count/array mismatches

**Error** - Actual failures:
- Handler exceptions
- Recomputation failures
- Database errors

**Structured Logging**:
```typescript
context.log.warn("UlnConfig validation: requiredDVNCount mismatch", {
  chainId: 1,
  eid: "30101",
  requiredDVNCount: 2,
  requiredDVNsLength: 3,
  requiredDVNs: ["0xabc...", "0xdef...", "0x123..."]
});
```

---

## Configuration

### Networks (16 chains)

```yaml
networks:
- id: 1       # Ethereum
  start_block: 0
  contracts:
  - name: EndpointV2
    address: [0x1a44076050125825900e736c501f859c50fE728c]
  - name: ReceiveUln302
    address: [0xc02Ab410f0734EFa3F14628780e6e695156024C2]
# ... (15 more chains)
```

### Indexer Settings

```yaml
name: envio-indexer
unordered_multichain_mode: true  # Parallel chain processing
preload_handlers: true            # Enable data preloading
```

### Events Tracked

**EndpointV2** (3 events):
```solidity
event PacketDelivered((uint32,bytes32,uint64) origin, address receiver)
event DefaultReceiveLibrarySet(uint32 eid, address newLib)
event ReceiveLibrarySet(address receiver, uint32 eid, address newLib)
```

**ReceiveUln302** (2 events):
```solidity
event UlnConfigSet(address oapp, uint32 eid, (uint64,uint8,uint8,uint8,address[],address[]) config)
event DefaultUlnConfigsSet((uint32,(uint64,uint8,uint8,uint8,address[],address[]))[] params)
```

---

## Query Examples

### Find OApps with zero required DVNs
```graphql
query DangerousConfigs {
  oAppSecurityConfigs(
    where: {
      effectiveRequiredDVNCount: 0
      isConfigTracked: true
    }
  ) {
    oapp
    eid
    effectiveOptionalDVNCount
    effectiveOptionalDVNThreshold
    usesRequiredDVNSentinel
  }
}
```

### Track config changes for an OApp
```graphql
query ConfigHistory($oappId: String!) {
  oAppUlnConfigVersions(
    where: { oappId: $oappId }
    orderBy: blockNumber
    orderDirection: asc
  ) {
    blockNumber
    blockTimestamp
    eid
    requiredDVNCount
    optionalDVNCount
    requiredDVNs
    optionalDVNs
  }
}
```

### Analyze packets using fallback configs
```graphql
query FallbackPackets {
  packetDelivereds(
    where: { usesDefaultConfig: true }
  ) {
    receiver
    srcEid
    fallbackFields
    effectiveRequiredDVNs
  }
}
```

### DVN usage statistics
```graphql
query DvnStats {
  dvnMetadatas {
    name
    address
    chainId
  }
}
```

---

### Audit Queries

**Most permissive configs**:
```graphql
{
  oAppSecurityConfigs(
    where: { effectiveRequiredDVNCount_lte: 1 }
    orderBy: effectiveRequiredDVNCount
  ) { oapp, eid, effectiveRequiredDVNs }
}
```

**Recent config changes**:
```graphql
{
  oAppSecurityConfigs(
    orderBy: lastComputedBlock
    orderDirection: desc
    first: 100
  ) { oapp, eid, lastComputedTimestamp, fallbackFields }
}
```