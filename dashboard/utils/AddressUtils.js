import { APP_CONFIG } from "../config.js";
import { isNullish } from "./NumberUtils.js";

const HEX_PREFIX = "0x";
const BYTES32_HEX_LENGTH = 64;
const EVM_ADDRESS_HEX_LENGTH = 40;
const HEX_BODY_REGEX = /^[0-9a-f]+$/i;

// Use APP_CONFIG.ADDRESSES directly (already lowercase in config)
const NORMALIZED_CONSTANTS = APP_CONFIG.ADDRESSES;

export class AddressUtils {
  static normalize(address, options = {}) {
    const { allowNull = false } = options;

    if (isNullish(address)) {
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

  static isZero(address) {
    if (!address) {
      return false;
    }
    const normalized = String(address).toLowerCase();
    return (
      normalized === NORMALIZED_CONSTANTS.ZERO || normalized === NORMALIZED_CONSTANTS.ZERO_PEER
    );
  }

  static isDead(address) {
    if (!address) {
      return false;
    }
    return String(address).toLowerCase() === NORMALIZED_CONSTANTS.DEAD;
  }

  static isZeroOrDead(address) {
    return this.isZero(address) || this.isDead(address);
  }

  static get constants() {
    return NORMALIZED_CONSTANTS;
  }
}
