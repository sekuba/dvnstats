import { AddressUtils } from "../utils/AddressUtils.js";

export function getFallbackFields(config) {
  return Array.isArray(config?.fallbackFields) ? config.fallbackFields.filter(Boolean) : [];
}

export function usesDefaultReceiveLibrary(config) {
  if (!config || typeof config !== "object") {
    return false;
  }
  if (config.usesDefaultLibrary !== undefined && config.usesDefaultLibrary !== null) {
    return config.usesDefaultLibrary === true;
  }
  const fallbackFields = getFallbackFields(config);
  if (fallbackFields.length > 0) {
    return fallbackFields.includes("receiveLibrary");
  }
  return config.libraryStatus === "none" && !hasEffectiveReceiveLibrary(config);
}

export function hasEffectiveReceiveLibrary(config) {
  const effectiveLibrary = config?.effectiveReceiveLibrary || null;
  return Boolean(effectiveLibrary) && !AddressUtils.isZero(effectiveLibrary);
}

export function isMissingReceiveLibrary(config) {
  if (!config || typeof config !== "object") {
    return false;
  }
  return (
    config.libraryStatus === "none" &&
    !hasEffectiveReceiveLibrary(config) &&
    usesDefaultReceiveLibrary(config)
  );
}
