import { APP_CONFIG } from "../config.js";

const HEX_PREFIX = "0x";
const BYTES32_HEX_LENGTH = 64;
const EVM_ADDRESS_HEX_LENGTH = 40;
const HEX_BODY_REGEX = /^[0-9a-f]+$/i;

/**
 * Pre-computed normalized address constants for fast comparison
 */
const NORMALIZED_CONSTANTS = Object.freeze({
  ZERO: APP_CONFIG.ADDRESSES.ZERO.toLowerCase(),
  ZERO_PEER: APP_CONFIG.ADDRESSES.ZERO_PEER.toLowerCase(),
  DEAD: APP_CONFIG.ADDRESSES.DEAD.toLowerCase(),
});

/**
 * Centralized address utilities for normalization, validation, and comparison
 */
export class AddressUtils {
  /**
   * Normalize an address to a consistent format
   *
   * @param {string|null|undefined} address - The address to normalize
   * @param {Object} options - Options for normalization
   * @param {boolean} options.allowNull - If true, returns null for null/undefined input. If false, throws error.
   * @returns {string|null} Normalized address
   * @throws {Error} If address is invalid or empty (unless allowNull is true)
   */
  static normalize(address, options = {}) {
    const { allowNull = false } = options;

    if (address === undefined || address === null) {
      if (allowNull) {
        return null;
      }
      throw new Error("Address required");
    }

    const raw = String(address).trim();
    if (!raw) {
      if (allowNull) {
        return null;
      }
      throw new Error("Address cannot be empty");
    }

    const hasHexPrefix = raw.slice(0, HEX_PREFIX.length).toLowerCase() === HEX_PREFIX;
    if (!hasHexPrefix) {
      return raw;
    }

    const lower = `${HEX_PREFIX}${raw.slice(HEX_PREFIX.length).toLowerCase()}`;
    const hexBody = lower.slice(HEX_PREFIX.length);
    if (!HEX_BODY_REGEX.test(hexBody)) {
      throw new Error(`Invalid hex address: ${address}`);
    }

    if (hexBody.length === BYTES32_HEX_LENGTH) {
      const trimmedHex = hexBody.replace(/^0+/, "");
      if (trimmedHex.length === 0) {
        return APP_CONFIG.ADDRESSES.ZERO;
      }
      if (trimmedHex.length <= EVM_ADDRESS_HEX_LENGTH) {
        return `${HEX_PREFIX}${trimmedHex.padStart(EVM_ADDRESS_HEX_LENGTH, "0")}`;
      }
      return lower;
    }

    if (hexBody.length <= EVM_ADDRESS_HEX_LENGTH) {
      return `${HEX_PREFIX}${hexBody.padStart(EVM_ADDRESS_HEX_LENGTH, "0")}`;
    }

    return lower;
  }

  /**
   * Null-safe address normalization - returns null for null/undefined/empty input
   *
   * @param {string|null|undefined} address - The address to normalize
   * @returns {string|null} Normalized address or null
   */
  static normalizeSafe(address) {
    if (!address) {
      return null;
    }
    try {
      return this.normalize(address, { allowNull: true });
    } catch {
      return String(address).toLowerCase();
    }
  }

  /**
   * Check if an address is a zero address (either EVM or bytes32 format)
   *
   * @param {string|null|undefined} address - The address to check
   * @returns {boolean} True if the address is a zero address
   */
  static isZero(address) {
    if (!address) {
      return false;
    }
    const normalized = String(address).toLowerCase();
    return (
      normalized === NORMALIZED_CONSTANTS.ZERO || normalized === NORMALIZED_CONSTANTS.ZERO_PEER
    );
  }

  /**
   * Check if an address is the dead address (0x...dead)
   *
   * @param {string|null|undefined} address - The address to check
   * @returns {boolean} True if the address is the dead address
   */
  static isDead(address) {
    if (!address) {
      return false;
    }
    return String(address).toLowerCase() === NORMALIZED_CONSTANTS.DEAD;
  }

  /**
   * Check if an address is either zero or dead
   *
   * @param {string|null|undefined} address - The address to check
   * @returns {boolean} True if the address is zero or dead
   */
  static isZeroOrDead(address) {
    return this.isZero(address) || this.isDead(address);
  }

  /**
   * Get pre-computed normalized constants for fast comparison
   */
  static get constants() {
    return NORMALIZED_CONSTANTS;
  }
}
