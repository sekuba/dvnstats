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
refresh and the explorer's Hot OApps query both range-scan `PacketDelivered` by
`blockTimestamp`, which is not one of those — without the index in
[scripts/indexes.sql](./scripts/indexes.sql) each of them seq-scans 20M rows.
It is idempotent, and needs re-running after every resync.

### Stats and publishing

```bash
pnpm stats          # refresh dashboard/data/stats.json (~5s)
pnpm stats:full     # rebuild the stats cube from scratch (~3 min), e.g. after a resync
pnpm publish:site   # refresh stats, then force-push committed dashboard/ + stats to gh-pages
```

[scripts/precomputePacketStats.js](./scripts/precomputePacketStats.js) reads
Postgres directly (`PG*` env vars, defaulting to the docker-compose stack). It
folds `PacketDelivered` into a daily cube cached in `.cache/`, rescans only the
last 7 days on each run, and bounds every query by one snapshot timestamp so
all numbers on the page agree. `dashboard/data/` is not committed: the site on
gh-pages is a single force-pushed commit of the committed `dashboard/` plus the
fresh `stats.json` ([scripts/publish.sh](./scripts/publish.sh), which also
lists the cron lines). Packets arriving more than 7 days late (a chain lagging
that far behind) are only picked up by `pnpm stats:full`, so run that weekly.

The public GraphQL endpoint is plain Hasura over this database; every query it
runs is capped at 30s by `statement_timeout` in `docker-compose.yml`.

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
