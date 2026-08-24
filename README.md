# LayerZero Security Stats and Config Explorer
[Learn about the Fragility of an interop protocol](https://sekuba.github.io/dvnstats/) by [surfing through real onchain data](https://sekuba.github.io/dvnstats/explorer.html).

Made possible by Envio Hypersync and -index, GPT5-Codex, Sonnet 4.5 and yours truly.

All frontend code is in the ./dashboard folder, you can host it yourself if you like. Below is envio explaining to you how to run the backend and the indexer. If you do so, remember to point the frontend at your own graphql endpoint.

In case you want to go deeper / see code, i recommend [spec.md](./spec.md) and the [layerzero.ts](./src/handlers/layerzero.ts) handler of the indexer respectively.

## Envio Indexer

*Please refer to the [documentation website](https://docs.envio.dev) for a thorough guide on all [Envio](https://envio.dev) indexer features*

### Run

```bash
pnpm stack:up   # Postgres + Hasura from docker-compose.yml (idempotent)
pnpm start      # ./run-indexer.sh — supervised envio start against that stack
pnpm stop       # ./stop-indexer.sh — indexer only, containers keep running
```

`stack:up` starts only the two containers; the indexer is a separate host
process. Detached:

```bash
setsid nohup ./run-indexer.sh >> logs/indexer-v38.log 2>&1 &
```

```bash
pnpm db:indexes
```

Envio only creates what `@index` in `schema.graphql` declares. The stats
pipeline paginates `PacketDelivered` by `(blockTimestamp, id)`, which is not one
of those — without the index in [scripts/indexes.sql](./scripts/indexes.sql)
each page seq-scans 20M rows (40s vs 0.15s per page). It is idempotent, and
needs re-running after every resync.

### Generate files from `config.yaml` or `schema.graphql`

```bash
pnpm codegen
```

### Adding a chain

1. `config.yaml` — chain id, start block, `EndpointV2` + `ReceiveUln302` addresses
2. `src/localChainRegistry.ts` — same addresses (lowercase) plus the local EID
3. `start-blocks.md` — record the start block and its timestamp
4. `pnpm registry:build` — regenerates `dashboard/chainRegistry.js`

Addresses and EIDs come from `https://metadata.layerzero-api.com/v1/metadata`;
the start block is the earliest log from either address (HyperSync at
`https://<chainId>.hypersync.xyz/query` answers that in one request).

### Pre-requisites

- [Node.js (use v22 or newer)](https://nodejs.org/en/download/current)
- [pnpm (use v8 or newer)](https://pnpm.io/installation)
- [Docker desktop](https://www.docker.com/products/docker-desktop/)

teehee
