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

### Generate files from `config.yaml` or `schema.graphql`

```bash
pnpm codegen
```

### Pre-requisites

- [Node.js (use v18 or newer)](https://nodejs.org/en/download/current)
- [pnpm (use v8 or newer)](https://pnpm.io/installation)
- [Docker desktop](https://www.docker.com/products/docker-desktop/)
