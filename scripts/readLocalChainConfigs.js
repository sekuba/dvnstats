import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultRegistryPath = path.join(repoRoot, "src/localChainRegistry.ts");

const CHAIN_CONFIG_PATTERN =
  /\{\s*chainId:\s*(\d+),\s*localEid:\s*(\d+)n,\s*endpointV2:\s*"([^"]+)",\s*receiveUln302:\s*"([^"]+)",\s*\}/g;

export function readLocalChainConfigs(registryPath = defaultRegistryPath) {
  const source = fs.readFileSync(registryPath, "utf8");
  const matches = Array.from(source.matchAll(CHAIN_CONFIG_PATTERN));

  if (matches.length === 0) {
    throw new Error(`No local chain configs found in ${registryPath}`);
  }

  return matches.map((match) => ({
    chainId: Number.parseInt(match[1], 10),
    localEid: match[2],
    endpointV2: match[3],
    receiveUln302: match[4],
  }));
}
