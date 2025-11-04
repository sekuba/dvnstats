/**
 * DvnUtils - Centralized utilities for DVN (Decentralized Verifier Network) resolution
 *
 * This module provides consistent DVN name resolution logic across the dashboard,
 * eliminating duplicated DVN resolution patterns.
 */

/**
 * Resolves DVN addresses to their display names using chain metadata.
 * Handles address filtering, localEid extraction, and context building.
 *
 * @param {Array<string>} addresses - Array of DVN addresses to resolve
 * @param {Object} chainMetadata - The chain metadata service with resolveDvnNames method
 * @param {Object} options - Resolution options
 * @param {string|number} options.localEid - The local endpoint ID for context
 * @param {Object} options.meta - Metadata object to extract localEid from (fallback)
 * @returns {Array<string>} Array of resolved DVN names/labels
 *
 * @example
 * const addresses = ["0x123...", "0x456..."];
 * const labels = resolveDvnLabels(addresses, chainMetadata, {
 *   localEid: "30101"
 * });
 * // Returns: ["Polyhedra DVN", "LayerZero DVN"]
 *
 * @example
 * // Using meta object for localEid
 * const labels = resolveDvnLabels(addresses, chainMetadata, {
 *   meta: { localEid: "30101", eid: "30102" }
 * });
 */
export function resolveDvnLabels(addresses, chainMetadata, options = {}) {
  if (!Array.isArray(addresses) || !addresses.length) {
    return [];
  }

  if (!chainMetadata || typeof chainMetadata.resolveDvnNames !== "function") {
    // If no metadata service available, return addresses as-is
    return addresses.filter(Boolean);
  }

  // Filter out null/undefined/empty addresses
  const normalizedAddresses = addresses.filter(Boolean);
  if (!normalizedAddresses.length) {
    return [];
  }

  // Resolve localEid from options or meta object
  const { localEid: localEidOverride, meta } = options;

  const candidateLocal =
    localEidOverride !== undefined && localEidOverride !== null
      ? localEidOverride
      : (meta?.localEid ?? meta?.eid ?? null);

  const localKey =
    candidateLocal !== undefined && candidateLocal !== null && candidateLocal !== ""
      ? String(candidateLocal)
      : "";

  // Build context object for resolution
  const context = localKey ? { localEid: localKey } : {};

  // Resolve DVN names using the metadata service
  return chainMetadata.resolveDvnNames(normalizedAddresses, context);
}

/**
 * Resolves DVNs for a security configuration object.
 * Extracts required and optional DVNs from a config and resolves their names.
 *
 * @param {Object} config - Security configuration object
 * @param {Array<string>} config.requiredDVNs - Array of required DVN addresses
 * @param {Array<string>} config.optionalDVNs - Array of optional DVN addresses
 * @param {string|number} config.localEid - The local endpoint ID
 * @param {Object} chainMetadata - The chain metadata service
 * @returns {Object} Object with requiredDVNLabels and optionalDVNLabels arrays
 *
 * @example
 * const config = {
 *   requiredDVNs: ["0x123...", "0x456..."],
 *   optionalDVNs: ["0x789..."],
 *   localEid: "30101"
 * };
 * const { requiredDVNLabels, optionalDVNLabels } = resolveConfigDvns(
 *   config,
 *   chainMetadata
 * );
 * // requiredDVNLabels: ["Polyhedra DVN", "LayerZero DVN"]
 * // optionalDVNLabels: ["Google Cloud DVN"]
 */
export function resolveConfigDvns(config, chainMetadata) {
  if (!config) {
    return { requiredDVNLabels: [], optionalDVNLabels: [] };
  }

  const localEid = config.localEid ?? config.eid ?? null;
  const context = localEid !== undefined && localEid !== null ? { localEid } : {};

  const requiredDVNs = Array.isArray(config.requiredDVNs) ? config.requiredDVNs : [];
  const optionalDVNs = Array.isArray(config.optionalDVNs) ? config.optionalDVNs : [];

  const requiredDVNLabels =
    requiredDVNs.length > 0 && chainMetadata?.resolveDvnNames
      ? chainMetadata.resolveDvnNames(requiredDVNs, context)
      : [];

  const optionalDVNLabels =
    optionalDVNs.length > 0 && chainMetadata?.resolveDvnNames
      ? chainMetadata.resolveDvnNames(optionalDVNs, context)
      : [];

  return { requiredDVNLabels, optionalDVNLabels };
}
