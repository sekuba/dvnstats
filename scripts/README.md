# Packet Statistics Precomputation

This script fetches all PacketDelivered records from Hasura and computes statistics.

## Usage

```bash
# Set GraphQL endpoint (optional, defaults to production)
export GRAPHQL_ENDPOINT=https://shinken.business/v1/graphql

# Run precomputation
npm run stats:precompute
```

Output is saved to `dashboard/data/packet-stats.json`.

## Statistics Computed

- Total packets analyzed
- All-default configuration percentage
- Default library/config usage
- Tracked library percentage
- DVN combinations (top combinations by packet count)
- Required DVN count distribution
- Optional DVN count distribution
- Chain breakdown (destination and source)
- Time range

## Landing Page

View the precomputed statistics at `dashboard/stats.html`.

