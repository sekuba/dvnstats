icecold codex x sekuba present *layerzero security overview thing*

<img width="1697" height="937" alt="image" src="https://github.com/user-attachments/assets/96ceaf15-7bf9-4931-9e2e-206ca633ef7d" />


## Envio Indexer

*Please refer to the [documentation website](https://docs.envio.dev) for a thorough guide on all [Envio](https://envio.dev) indexer features*

### Run

```bash
pnpm dev
```

Visit http://localhost:8080 to see the GraphQL Playground, local password is `testing`.

### Explore data with the dashboard

- Open `dashboard/index.html` directly in your browser, or serve it with `pnpm dlx serve dashboard`.
- Point the endpoint field at your running GraphQL API (defaults to `http://localhost:8080/v1/graphql`).
- Use the built-in queries (Top OApps, Security Snapshot, Packet Samples, etc.) or paste custom GraphQL in the ad‑hoc runner.

### Generate a 30-day packet security summary

```bash
pnpm stats:packets --endpoint=http://localhost:8080/v1/graphql --days=30 --out=packet_security_summary.json
```

The script scans `PacketDelivered` events from the last N days (30 by default), applies the same fallback logic used in the indexer (default configs when a custom config is missing data), and writes aggregated counts grouped by required DVNs, chain, and DVN address/name. Optional-only configs (required DVN count `255`) and default-based configs (`0`/unset) are tracked separately. If a `layerzero.json` file is present (or provided via `--layerzero=path`), DVN canonical names are included in the rankings. You can also supply the endpoint via the `GRAPHQL_ENDPOINT` environment variable.

### Generate files from `config.yaml` or `schema.graphql`

```bash
pnpm codegen
```

### Pre-requisites

- [Node.js (use v18 or newer)](https://nodejs.org/en/download/current)
- [pnpm (use v8 or newer)](https://pnpm.io/installation)
- [Docker desktop](https://www.docker.com/products/docker-desktop/)
