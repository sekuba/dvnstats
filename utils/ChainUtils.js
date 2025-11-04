/**
 * ChainUtils - Centralized utilities for chain label formatting and display
 *
 * This module provides consistent chain label formatting across the dashboard,
 * eliminating duplicated chain display logic.
 */

/**
 * Gets the display label for a chain ID using chain metadata.
 * Falls back to various strategies if metadata is not available.
 *
 * @param {string|number} chainId - The chain ID (EID)
 * @param {Object} chainMetadata - The chain metadata service
 * @returns {string} The formatted chain display label
 *
 * @example
 * getChainDisplayLabel("30101", chainMetadata)  // Returns "Ethereum (30101)"
 * getChainDisplayLabel("30102", chainMetadata)  // Returns "BNB Chain (30102)"
 * getChainDisplayLabel("999", chainMetadata)    // Returns "999" if not found
 */
export function getChainDisplayLabel(chainId, chainMetadata) {
  if (chainId === undefined || chainId === null || chainId === "") {
    return "";
  }

  const key = String(chainId);

  if (chainMetadata && typeof chainMetadata.getChainDisplayLabel === "function") {
    const label = chainMetadata.getChainDisplayLabel(key);
    if (label) {
      return label;
    }
  }

  if (chainMetadata && typeof chainMetadata.getChainInfo === "function") {
    const info = chainMetadata.getChainInfo(key);
    if (info) {
      return `${info.primary} (${key})`;
    }
  }

  return key;
}

/**
 * Formats a chain label with optional customizations.
 * Can strip the EID number suffix and add custom prefixes.
 *
 * @param {string|number} chainId - The chain ID (EID)
 * @param {Object} chainMetadata - The chain metadata service
 * @param {Object} options - Formatting options
 * @param {boolean} options.stripEid - If true, removes the "(number)" suffix
 * @param {boolean} options.addEidPrefix - If true, adds "EID" prefix for unknown chains
 * @returns {string} The formatted chain label
 *
 * @example
 * formatChainLabel("30101", chainMetadata, { stripEid: true })
 *   // Returns "Ethereum" instead of "Ethereum (30101)"
 *
 * formatChainLabel("999", chainMetadata, { addEidPrefix: true })
 *   // Returns "EID 999" instead of "999"
 *
 * formatChainLabel("eid-123", chainMetadata, { addEidPrefix: true })
 *   // Returns "EID 123"
 */
export function formatChainLabel(chainId, chainMetadata, options = {}) {
  if (chainId === undefined || chainId === null || chainId === "") {
    return "";
  }

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

/**
 * Alias for getChainDisplayLabel for backward compatibility.
 * This matches the naming in core.js.
 *
 * @deprecated Use getChainDisplayLabel instead
 */
export function resolveChainDisplayLabel(chainMetadata, chainId) {
  return getChainDisplayLabel(chainId, chainMetadata);
}
