import { isNullish } from "./NumberUtils.js";

export function getChainDisplayLabel(chainId, chainMetadata) {
  if (isNullish(chainId) || chainId === "") return "";

  const key = String(chainId);

  if (chainMetadata && typeof chainMetadata.getChainDisplayLabel === "function") {
    const label = chainMetadata.getChainDisplayLabel(key);
    if (label) return label;
  }

  if (chainMetadata && typeof chainMetadata.getChainInfo === "function") {
    const info = chainMetadata.getChainInfo(key);
    if (info) return `${info.primary} (${key})`;
  }

  return key;
}

export function formatChainLabel(chainId, chainMetadata, options = {}) {
  if (isNullish(chainId) || chainId === "") return "";

  const { stripEid = false, addEidPrefix = false } = options;
  let display = getChainDisplayLabel(chainId, chainMetadata);

  if (stripEid && display) {
    display = display.replace(/\s*\(\d+\)$/, "");
  }

  if (addEidPrefix && display === String(chainId)) {
    const str = String(chainId);
    if (str.startsWith("eid-")) {
      const suffix = str.slice(4);
      return suffix ? `EID ${suffix}` : "EID";
    }
    return `EID ${str}`;
  }

  return display;
}
