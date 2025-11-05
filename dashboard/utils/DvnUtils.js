import { ensureArray } from "./NumberUtils.js";

export function resolveDvnLabels(addresses, chainMetadata, options = {}) {
  if (!Array.isArray(addresses) || !addresses.length) {
    return [];
  }

  if (!chainMetadata || typeof chainMetadata.resolveDvnNames !== "function") {
    return addresses.filter(Boolean);
  }

  const normalizedAddresses = addresses.filter(Boolean);
  if (!normalizedAddresses.length) {
    return [];
  }

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
 *
 *
 */
export function resolveConfigDvns(config, chainMetadata) {
  if (!config) {
    return { requiredDVNLabels: [], optionalDVNLabels: [] };
  }

  const localEid = config.localEid ?? config.eid ?? null;
  const context = isDefined(localEid) ? { localEid } : {};

  const requiredDVNs = ensureArray(config.requiredDVNs);
  const optionalDVNs = ensureArray(config.optionalDVNs);

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
