# Web of Security

The Web of Security feature visualizes the security relationships between OApps (Omnichain Applications) in the LayerZero ecosystem. It crawls packet delivery connections to build a graph showing how OApps are connected and what security configurations protect each connection.

## Overview

Security in LayerZero is defined per `(oappId, srcEid)` pair - each OApp can have different security requirements depending on which chain messages are coming from. The Web of Security visualizes these relationships by:

1. Starting from a seed OApp
2. Finding all OApps that have sent packets to it (using `PacketDelivered` table)
3. Retrieving the security configuration for each sender OApp
4. Recursively exploring connections up to a specified depth
5. Visualizing the resulting graph with nodes and edges

## Architecture

### Crawler Script (`scripts/crawl-security-web.js`)

The crawler is a standalone Node.js script that queries the Hasura GraphQL endpoint to build the web data. It:

- Takes a seed `oappId` as input
- Queries `PacketDelivered` to find senders (with deduplication by `srcEid` and `sender`)
- Maps `srcEid` to `chainId` using `layerzero.json` metadata
- Queries `OAppSecurityConfig` for each discovered OApp
- Resolves DVN names from `DvnMetadata`
- Outputs a JSON file with nodes and edges

**Key Features:**
- **Dangling nodes**: OApps referenced in edges but not tracked in our database are marked as "dangling" (unknown security)
- **Depth control**: Limits how many hops to explore from the seed
- **Packet sampling**: Limits how many packets to sample per OApp to control query load
- **EID mapping**: Automatically maps LayerZero endpoint IDs to chain IDs

### Dashboard Visualization (`dashboard/`)

The dashboard card loads the pre-generated JSON file and renders:

1. **Summary Panel**: Overview of crawl metadata (seed, depth, node counts)
2. **SVG Graph**: Visual representation of the security web
   - Nodes represent OApps
   - Node size/color indicates number of required DVNs
   - Dangling nodes shown with dashed borders
   - Directed edges show packet flow
3. **Node Detail Table**: Tabular view of all nodes with security configs

## Usage

### 1. Crawl the Web

```bash
node scripts/crawl-security-web.js <oappId> [options]
```

**Options:**
- `--depth <n>`: Maximum crawl depth (default: 2)
- `--limit <n>`: Max packets per node to sample (default: 100)
- `--output <file>`: Output JSON file (default: web-of-security.json)
- `--endpoint <url>`: GraphQL endpoint (default: http://localhost:8080/v1/graphql)
- `--secret <key>`: Hasura admin secret

**Example:**
```bash
node scripts/crawl-security-web.js 8453_0x26da582889f59eaae9da1f063be0140cd93e6a4f \
  --depth 2 \
  --limit 100 \
  --output dashboard/my-web.json
```

### 2. Load in Dashboard

1. Open the dashboard in your browser
2. Navigate to the "Web of Security" card
3. (Optional) Enter the seed OApp ID for reference
4. Click "Choose File" and select the generated JSON file
5. The visualization will render automatically

### 3. Interact with the Visualization

- **Hover over nodes**: See tooltip with OApp details and max required DVNs
- **Hover over edges**: See connection details (sender, receiver, EID, packet count)
- **Double-click OApp IDs**: Open alias editor to set friendly names
- **Click copyable cells**: Copy OApp IDs to clipboard
- **Scroll down**: View detailed node table with all security configs

## Data Model

### Output JSON Structure

```json
{
  "seed": "8453_0x...",
  "crawlDepth": 2,
  "packetLimit": 100,
  "timestamp": "2025-10-22T...",
  "nodes": [
    {
      "id": "chainId_address",
      "chainId": "8453",
      "address": "0x...",
      "totalPacketsReceived": "33998",
      "isTracked": true,
      "isDangling": false,
      "depth": 0,
      "securityConfigs": [
        {
          "srcEid": "30110",
          "requiredDVNCount": 2,
          "requiredDVNs": ["LayerZero Labs", "Google Cloud"],
          "optionalDVNCount": 0,
          "optionalDVNs": [],
          "optionalDVNThreshold": 0,
          "usesRequiredDVNSentinel": false,
          "isConfigTracked": true
        }
      ]
    }
  ],
  "edges": [
    {
      "from": "42161_0x...",
      "to": "8453_0x...",
      "srcEid": "30110",
      "srcChainId": "42161",
      "packetCount": 5
    }
  ]
}
```

### Node Properties

- `id`: OApp identifier (`chainId_address`)
- `chainId`: Destination chain ID
- `address`: OApp address
- `totalPacketsReceived`: Cumulative packets received by this OApp
- `isTracked`: Whether we have security config data for this OApp
- `isDangling`: Whether this OApp was only discovered via edges (no config data)
- `depth`: Distance from seed OApp (0 = seed, -1 = dangling)
- `securityConfigs`: Array of security configs per source EID

### Edge Properties

- `from`: Source OApp ID
- `to`: Destination OApp ID
- `srcEid`: Source endpoint ID
- `srcChainId`: Source chain ID (mapped from srcEid)
- `packetCount`: Number of packets sent on this connection

## Visualization Design

### Node Appearance

- **Size**: Larger nodes = more required DVNs (more secure)
  - Base size for 0 DVNs, scales up to 1.4x for 5+ DVNs
- **Color**: Indicates security level
  - Red (`#ffcccc`): 0 required DVNs (insecure)
  - Yellow (`#ffffcc`): 1 required DVN
  - Light green (`#ccffcc`): 2 required DVNs
  - Light cyan (`#ccffff`): 3+ required DVNs
- **Border**: Solid for tracked, dashed for dangling nodes
- **Label**: OApp alias or `chainId:address` prefix

### Layout

Nodes are arranged by depth (horizontal) with vertical spacing for nodes at the same depth:
- **Depth 0** (seed): Leftmost
- **Depth 1**: Next column
- **Depth 2**: Rightmost
- **Dangling**: Far right

Edges are directed arrows showing packet flow from sender to receiver.

## Security Insights

The Web of Security helps identify:

1. **Dangling nodes**: Untrusted sources sending packets (unknown security)
2. **Security variance**: OApps with different DVN requirements per source chain
3. **Trust chains**: Multi-hop paths where security depends on intermediate OApps
4. **Weak links**: Connections with only 1 required DVN or optional-only configs
5. **Network topology**: Central OApps receiving from many sources

### Risk Indicators

- **Dangling nodes**: Highest risk - we don't know their security config
- **0 required DVNs**: Relying only on optional DVNs (threshold may be 0)
- **1 required DVN**: Single point of failure
- **2+ required DVNs**: Better security through redundancy

## Performance Considerations

### Crawler

- **Query load**: Each node triggers 2 queries (packets + security config)
- **Depth control**: Depth 2 typically explores 10-100 nodes, depth 3 can explore 100-1000s
- **Packet sampling**: Limit to 100 packets per node to avoid slow queries
- **Deduplication**: Reduces query count by deduplicating senders

**Recommended settings:**
- Depth 1-2: Good for exploring immediate connections
- Depth 3+: Only for well-connected OApps with limited fanout
- Limit 50-100: Captures most unique senders without excessive queries

### Dashboard

- **File loading**: Instant, no GraphQL queries
- **SVG rendering**: Performant up to ~100 nodes
- **Large graphs**: Consider filtering or increasing SVG canvas size

## Future Enhancements

- **Interactive filtering**: Filter by chain, DVN count, or security level
- **Force-directed layout**: Replace fixed layout with physics simulation
- **Config diff view**: Highlight differences in security configs across source chains
- **Risk scoring**: Automated risk assessment per node/edge
- **Export formats**: PNG, PDF, or interactive HTML export
- **Real-time mode**: Stream live packet deliveries and update graph
- **Aggregation**: Merge nodes by address across chains for cross-chain view

## Troubleshooting

### "Unknown chainId for srcEid"

The `layerzero.json` file doesn't contain a mapping for this endpoint ID. Either:
1. The EID is from a new chain not yet in the metadata
2. The `layerzero.json` file is out of date

**Fix**: Update `layerzero.json` with the latest chain metadata.

### "Skipping sender: invalid address"

The sender address in `PacketDelivered` couldn't be normalized to a valid address. This can happen if:
1. The address is zero (null sender)
2. The address encoding is malformed

**Fix**: Check the `PacketDelivered` data for the affected packets.

### Empty graph / No nodes

Possible causes:
1. The seed OApp has no packet deliveries
2. The crawl depth is 0
3. The database is not fully synced

**Fix**: Use a different seed OApp or increase the packet sample limit.

### Dangling nodes everywhere

If most nodes are dangling, the database may be:
1. Missing `OAppSecurityConfig` data for those chains
2. Only partially synced
3. Configured to track only specific chains

**Fix**: Check `config.yaml` to ensure all relevant chains are being indexed.

## Related Documentation

- [Security Config Data Model](./security-config-data-model.md)
- [Dashboard README](../dashboard/README.md)
