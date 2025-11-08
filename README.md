# LayerZero Security Stats and Config Explorer
[Learn about the Fragility of an interop protocol](https://sekuba.github.io/dvnstats/) by [surfing through real onchain data](https://sekuba.github.io/dvnstats/explorer.html).

Made possible by Envio Hypersync and -index, GPT5-Codex, Sonnet 4.5 and yours truly.

All frontend code is in the ./dashboard folder, you can host it yourself if you like. Below is envio explaining to you how to run the backend and the indexer. If you do so, remember to point the frontend at your own graphql endpoint.

In case you want to go deeper / see code, i recommend [spec.md](./spec.md) and the [EventHandlers.ts](./src/EventHandlers.ts) of the indexer respectively.

## Envio Indexer

*Please refer to the [documentation website](https://docs.envio.dev) for a thorough guide on all [Envio](https://envio.dev) indexer features*

### Run

```bash
pnpm dev
```

Visit http://localhost:8080 to see the GraphQL Playground, local password is `testing`.

### Generate files from `config.yaml` or `schema.graphql`

```bash
pnpm codegen
```

### Pre-requisites

- [Node.js (use v18 or newer)](https://nodejs.org/en/download/current)
- [pnpm (use v8 or newer)](https://pnpm.io/installation)
- [Docker desktop](https://www.docker.com/products/docker-desktop/)
