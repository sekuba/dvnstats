#!/usr/bin/env node
/**
 * Helper script to derive the LayerZero EIDs for the locally indexed chains.
 *
 * The script scans the Envio config to collect EndpointV2 and ReceiveUln302
 * addresses, searches the LayerZero metadata bundle for matching deployments,
 * and prints a map of chainId -> details (including resolved eid).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config.yaml");
const METADATA_PATH = path.join(ROOT, "layerzero.json");

const readFile = (filePath) =>
  fs.readFileSync(filePath, { encoding: "utf8" });

const parseNetworks = (configText) => {
  const normalized = configText.replace(/\r\n/g, "\n");
  const regex = /- id: (\d+)\n([\s\S]*?)(?=\n- id: |\Z)/g;

  const results = [];
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const [, id, block] = match;
    const chainId = Number(id);
    const endpointMatch = /name:\s*EndpointV2[\s\S]*?address:\s*-\s*(0x[a-fA-F0-9]+)/.exec(
      block,
    );
    const receiveUlnMatch =
      /name:\s*ReceiveUln302[\s\S]*?address:\s*-\s*(0x[a-fA-F0-9]+)/.exec(
        block,
      );

    results.push({
      chainId,
      endpointV2: endpointMatch ? endpointMatch[1].toLowerCase() : undefined,
      receiveUln302: receiveUlnMatch ? receiveUlnMatch[1].toLowerCase() : undefined,
    });
  }

  return results;
};

const buildAddressIndex = (metadata) => {
  const index = new Map();

  const visit = (node, context) => {
    if (node === null || node === undefined) return;

    if (Array.isArray(node)) {
      for (const value of node) {
        visit(value, context);
      }
      return;
    }

    if (typeof node !== "object") {
      return;
    }

    const nextContext = { ...context };
    if (typeof node.eid === "string" || typeof node.eid === "number") {
      try {
        nextContext.eid = BigInt(node.eid).toString();
      } catch {
        nextContext.eid = String(node.eid);
      }
    }
    if (typeof node.chainKey === "string") {
      nextContext.chainKey = node.chainKey;
    }
    if (typeof node.stage === "string") {
      nextContext.stage = node.stage;
    }
    if (
      node.chainDetails &&
      typeof node.chainDetails === "object" &&
      node.chainDetails !== null
    ) {
      const candidate = node.chainDetails.nativeChainId;
      if (
        typeof candidate === "number" ||
        (typeof candidate === "string" && candidate !== "")
      ) {
        const nativeChainIdNumber = Number(candidate);
        if (!Number.isNaN(nativeChainIdNumber)) {
          nextContext.nativeChainId = nativeChainIdNumber;
        }
      }
    }
    if (
      typeof node.nativeChainId === "number" ||
      (typeof node.nativeChainId === "string" && node.nativeChainId !== "")
    ) {
      const nativeChainIdNumber = Number(node.nativeChainId);
      if (!Number.isNaN(nativeChainIdNumber)) {
        nextContext.nativeChainId = nativeChainIdNumber;
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "address" && typeof value === "string") {
        if (nextContext.eid) {
          const entry = {
            eid: nextContext.eid,
            chainKey: nextContext.chainKey,
            stage: nextContext.stage,
            nativeChainId: nextContext.nativeChainId,
          };
          const existing = index.get(value.toLowerCase()) ?? [];
          existing.push(entry);
          index.set(value.toLowerCase(), existing);
        }
      } else if (key !== "parent") {
        visit(value, nextContext);
      }
    }
  };

  visit(metadata, {});
  return index;
};

const main = () => {
  const configNetworks = parseNetworks(readFile(CONFIG_PATH));
  const metadata = JSON.parse(readFile(METADATA_PATH));
  const addressIndex = buildAddressIndex(metadata);

  const output = {};
  for (const network of configNetworks) {
    const endpointMatchesRaw = network.endpointV2
      ? addressIndex.get(network.endpointV2)
      : undefined;
    const receiveMatchesRaw = network.receiveUln302
      ? addressIndex.get(network.receiveUln302)
      : undefined;

    const filterByNativeChainId = (matches) => {
      if (!matches) return undefined;
      const filtered = matches.filter(
        candidate => candidate.nativeChainId === network.chainId,
      );
      return filtered.length > 0 ? filtered : matches;
    };

    const endpointMatches = filterByNativeChainId(endpointMatchesRaw);
    const receiveMatches = filterByNativeChainId(receiveMatchesRaw);

    const pickMatch = () => {
      if (endpointMatches && endpointMatches.length === 1) {
        return { ...endpointMatches[0], via: "endpointV2" };
      }
      if (receiveMatches && receiveMatches.length === 1) {
        return { ...receiveMatches[0], via: "receiveUln302" };
      }
      if (endpointMatches && endpointMatches.length > 0) {
        return { ...endpointMatches[0], via: "endpointV2", ambiguous: true };
      }
      if (receiveMatches && receiveMatches.length > 0) {
        return { ...receiveMatches[0], via: "receiveUln302", ambiguous: true };
      }
      return undefined;
    };

    const match = pickMatch();
    output[network.chainId] = {
      chainId: network.chainId,
      endpointV2: network.endpointV2,
      receiveUln302: network.receiveUln302,
      match,
      endpointCandidates: endpointMatches,
      receiveCandidates: receiveMatches,
    };
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
};

main();
