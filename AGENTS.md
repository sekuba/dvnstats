# Repository Guidelines

## Project Structure & Module Organization
- `config.yaml` defines all chains and blockchain events we are indexing
- `src/` holds TypeScript event handlers (see `EventHandlers.ts`) orchestrating indexer persistence.
- `generated/` stores Envio codegen outputs; treat as read-only and refresh with `pnpm codegen`.
- `scripts/` contains operational tooling such as `packetSecuritySummary.js` for security config (DVN) stats exports.
- `dashboard/` hosts the static explorer; open `index.html` locally or serve it with `pnpm dlx serve`.
- `test/` mirrors handler behavior with ts-mocha specs; align filenames with the contracts under test.
- Config assets sit at the repo root (`config.yaml`, `schema.graphql`, `layerzero.json`); `build/` and `generated/` artifacts may be recreated freely.

## Build, Test, and Development Commands
- `pnpm dev` starts the local Envio stack with a GraphQL endpoint at `http://localhost:8080/v1/graphql`.
- `pnpm start` runs the compiled indexer against configured endpoints for production-style verification.
- `pnpm codegen` rebuilds TypeScript types from `config.yaml` and `schema.graphql`.
- `pnpm build` compiles TypeScript; `pnpm clean` resets project references.
- `pnpm stats:packets` writes `packet_security_summary.json`; override `--days` as needed.
- `pnpm test` executes the mocha suite (alias of `pnpm mocha`); append `--watch` when iterating.

## Coding Style & Naming Conventions
- Use TypeScript with 2-space indentation, trailing commas, and `const`; prefer arrow functions for handlers.
- Entity identifiers follow `${chainId}_${blockNumber}_${logIndex}`; reuse helpers in `EventHandlers.ts`.
- Normalize blockchain addresses with `normalizeAddress` to enforce lowercase; avoid duplicating this logic.
- Import models from `"generated"` and never edit generated files manually to preserve codegen parity.

## Testing Guidelines
- Store specs in `test/*.ts`; `describe` blocks should match the contract or handler names.
- Rely on `TestHelpers.MockDb` to simulate persistence and assert entity snapshots.
- Cover new handlers with at least one happy-path and one edge-case test before submitting changes.
- Run `pnpm test`; document external dependencies (e.g., live RPC) in the PR description.

## Commit & Pull Request Guidelines
- Prefer concise, imperative commit subjects (`add pic`, `required dvn count fix`) consistent with history.
- Keep each commit focused; include body details when linking issues or noting follow-up work.
- PRs must explain user impact, list executed commands, and attach dashboard screenshots for UI adjustments.

## Data & Configuration Notes
- Maintain parity between `config.yaml` and `schema.graphql`; rerun `pnpm codegen` after edits.

## LayerZero Security Config Indexing Spec
- **Scope**: Track only incoming packets delivered through EndpointV2 contracts.
- **Security Config Definition**: A packet's security posture is determined by its `receiveLibrary` address and that library's configuration tuple (`confirmations`, DVN counts, DVN thresholds, DVN address arrays).
- **Receive Library Coverage**: Persist full configuration history for the `ReceiveUln302` library. For packets delivered through other libraries, capture the library address and flag that detailed config data is unavailable.
- **Configuration Scoping**: Security configs are owned by OApp deployers and keyed by the tuple `(chainId of the OApp, oappAddress, originEid)`. Each origin EID can point to a distinct config for a given OApp on a given chain.
- **Fallback Semantics**: Resolve effective configs by overlaying custom settings onto per-chain/per-origin defaults. Any zero or empty field (`requiredDVNCount`, `optionalDVNCount`, `optionalDVNThreshold`, `requiredDVNs`, `optionalDVNs`) inherits from the corresponding default. Defaults also supply the receive library address when none is set.
- **Special Cases**:
  - `requiredDVNCount = 255` signals that no required DVNs are enforced; validation falls back to optional DVNs governed by `optionalDVNThreshold`.
  - For non-255 values, `requiredDVNCount` must equal the length of `requiredDVNs`, and all listed required addresses must sign a packet.
  - Optional DVNs may exceed the threshold, but at least `optionalDVNThreshold` of them must sign any packet validated with optional-only configs.
- **Reference Data**:
  - `layerzero.json` supplies DVN metadata (names, chain/address mappings) and ancillary protocol information.
  - `scripts/packetSecuritySummary.js` exposes `LAYERZERO_CHAINS_V2`, mapping chain names to chain IDs and endpoint IDs (EIDs); mirror or supersede this mapping in indexer code as needed.
