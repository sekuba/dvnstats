import { TRACKED_RECEIVE_LIBRARIES } from "./chainRegistry.js";

export { TRACKED_RECEIVE_LIBRARIES };

export function getTrackedReceiveLibrary(localEid) {
  if (localEid === undefined || localEid === null) {
    return undefined;
  }
  const key = String(localEid);
  return TRACKED_RECEIVE_LIBRARIES[key];
}
