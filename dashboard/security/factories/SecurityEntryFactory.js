/**
 * Factory functions for creating security-related objects with consistent defaults.
 * Centralizes default values and reduces verbosity across the codebase.
 */

/**
 * Default template for security entry objects
 */
const SECURITY_ENTRY_DEFAULTS = {
  id: null,
  srcEid: null,
  localEid: null,
  requiredDVNCount: 0,
  requiredDVNs: [],
  requiredDVNLabels: [],
  optionalDVNCount: 0,
  optionalDVNs: [],
  optionalDVNLabels: [],
  optionalDVNThreshold: 0,
  usesRequiredDVNSentinel: false,
  libraryStatus: "unknown",
  peer: null,
  peerStateHint: null,
  peerOappId: null,
  peerLocalEid: null,
  peerAddress: null,
  sourceType: "materialized",
  synthetic: false,
  fallbackFields: [],
  routePacketCount: 0,
  routePacketShare: 0,
  routePacketPercent: 0,
  routeLastPacketBlock: null,
  routeLastPacketTimestamp: null,
  attachedCandidate: false,
  unresolvedPeer: false,
};

/**
 * Default template for graph edge objects
 */
const GRAPH_EDGE_DEFAULTS = {
  from: null,
  to: null,
  srcEid: null,
  peerRaw: null,
  peerLocalEid: null,
  peerOappId: null,
  peerStateHint: null,
  blockReasonHint: null,
  isStalePeer: false,
  libraryStatus: null,
  synthetic: false,
  sourceType: null,
  routePacketCount: 0,
  routePacketShare: 0,
  routePacketPercent: 0,
  routeLastPacketBlock: null,
  routeLastPacketTimestamp: null,
};

/**
 * Default template for edge context objects
 */
const EDGE_CONTEXT_DEFAULTS = {
  config: null,
  edgeFrom: null,
  edgeTo: null,
  peerInfo: null,
  peerRaw: null,
  peerLocalEid: null,
  queueNext: null,
  isOutbound: false,
  peerStateHint: null,
  routeMetric: null,
  sourceType: null,
  libraryStatus: null,
  synthetic: false,
  isStalePeer: false,
};

/**
 * Creates a security entry object with defaults
 * @param {Object} config - Configuration object from database
 * @param {Object} peerDetails - Peer information from buildPeerInfo
 * @param {Object} routeMetric - Route statistics
 * @param {string} localEid - Local endpoint ID
 * @param {Array} requiredDVNs - Required DVN addresses
 * @param {Array} requiredDVNLabels - Required DVN labels
 * @param {Array} optionalDVNs - Optional DVN addresses
 * @param {Array} optionalDVNLabels - Optional DVN labels
 * @returns {Object} Security entry with all fields populated
 */
export function createSecurityEntry({
  config,
  peerDetails,
  routeMetric,
  localEid,
  requiredDVNs = [],
  requiredDVNLabels = [],
  optionalDVNs = [],
  optionalDVNLabels = [],
}) {
  const entry = {
    ...SECURITY_ENTRY_DEFAULTS,
    // Override with provided values
    id: config?.id ?? SECURITY_ENTRY_DEFAULTS.id,
    srcEid: config?.eid ?? SECURITY_ENTRY_DEFAULTS.srcEid,
    localEid: localEid ?? SECURITY_ENTRY_DEFAULTS.localEid,
    requiredDVNCount: config?.effectiveRequiredDVNCount ?? SECURITY_ENTRY_DEFAULTS.requiredDVNCount,
    requiredDVNs,
    requiredDVNLabels,
    optionalDVNCount: config?.effectiveOptionalDVNCount ?? SECURITY_ENTRY_DEFAULTS.optionalDVNCount,
    optionalDVNs,
    optionalDVNLabels,
    optionalDVNThreshold:
      config?.effectiveOptionalDVNThreshold ?? SECURITY_ENTRY_DEFAULTS.optionalDVNThreshold,
    usesRequiredDVNSentinel:
      config?.usesRequiredDVNSentinel ?? SECURITY_ENTRY_DEFAULTS.usesRequiredDVNSentinel,
    libraryStatus: config?.libraryStatus ?? SECURITY_ENTRY_DEFAULTS.libraryStatus,
    peer: config?.peer ?? SECURITY_ENTRY_DEFAULTS.peer,
    peerStateHint: config?.peerStateHint ?? SECURITY_ENTRY_DEFAULTS.peerStateHint,
    peerOappId: peerDetails?.oappId ?? SECURITY_ENTRY_DEFAULTS.peerOappId,
    peerLocalEid: peerDetails?.localEid ?? SECURITY_ENTRY_DEFAULTS.peerLocalEid,
    peerAddress: peerDetails?.address ?? SECURITY_ENTRY_DEFAULTS.peerAddress,
    sourceType: config?.sourceType ?? SECURITY_ENTRY_DEFAULTS.sourceType,
    synthetic: !!config?.synthetic,
    fallbackFields: Array.isArray(config?.fallbackFields)
      ? config.fallbackFields
      : SECURITY_ENTRY_DEFAULTS.fallbackFields,
    routePacketCount: routeMetric?.packetCount ?? SECURITY_ENTRY_DEFAULTS.routePacketCount,
    routePacketShare: routeMetric?.share ?? SECURITY_ENTRY_DEFAULTS.routePacketShare,
    routePacketPercent: routeMetric?.percent ?? SECURITY_ENTRY_DEFAULTS.routePacketPercent,
    routeLastPacketBlock:
      routeMetric?.lastPacketBlock ?? SECURITY_ENTRY_DEFAULTS.routeLastPacketBlock,
    routeLastPacketTimestamp:
      routeMetric?.lastPacketTimestamp ?? SECURITY_ENTRY_DEFAULTS.routeLastPacketTimestamp,
    unresolvedPeer:
      !peerDetails?.oappId &&
      !(peerDetails && peerDetails.isZeroPeer) &&
      !config?.peerOappId,
  };

  return entry;
}

/**
 * Creates an edge context object with defaults
 * @param {Object} options - Context options
 * @returns {Object} Edge context with all fields populated
 */
export function createEdgeContext({
  config = null,
  edgeFrom = null,
  edgeTo = null,
  peerInfo = null,
  peerRaw = null,
  peerLocalEid = null,
  queueNext = null,
  isOutbound = false,
  peerStateHint = null,
  routeMetric = null,
  sourceType = null,
  libraryStatus = null,
  synthetic = false,
  isStalePeer = false,
} = {}) {
  return {
    ...EDGE_CONTEXT_DEFAULTS,
    config,
    edgeFrom,
    edgeTo,
    peerInfo,
    peerRaw,
    peerLocalEid,
    queueNext,
    isOutbound,
    peerStateHint,
    routeMetric,
    sourceType,
    libraryStatus,
    synthetic,
    isStalePeer,
  };
}

/**
 * Creates an inbound edge context from security config
 * @param {Object} normalizedInbound - Normalized inbound configuration
 * @param {Object} peerDetails - Peer details
 * @param {string} sanitizedInboundOAppId - Sanitized inbound OApp ID
 * @param {string} oappId - Current OApp ID (target)
 * @param {string} remoteLocalEid - Remote local EID
 * @param {boolean} isStalePeer - Whether this is a stale peer
 * @returns {Object} Edge context for inbound connection
 */
export function createInboundEdgeContext({
  normalizedInbound,
  peerDetails,
  sanitizedInboundOAppId,
  oappId,
  remoteLocalEid,
  isStalePeer = false,
}) {
  return createEdgeContext({
    config: normalizedInbound,
    edgeFrom: sanitizedInboundOAppId,
    edgeTo: oappId,
    peerInfo: peerDetails,
    peerRaw: peerDetails?.rawPeer ?? normalizedInbound?.peer ?? null,
    peerLocalEid: remoteLocalEid ?? peerDetails?.localEid ?? null,
    queueNext: sanitizedInboundOAppId,
    isOutbound: false,
    peerStateHint: normalizedInbound?.peerStateHint ?? peerDetails?.peerStateHint ?? null,
    routeMetric: null,
    sourceType: normalizedInbound?.sourceType ?? null,
    libraryStatus: normalizedInbound?.libraryStatus ?? null,
    synthetic: !!normalizedInbound?.synthetic,
    isStalePeer,
  });
}

/**
 * Creates a graph edge object with defaults
 * @param {Object} options - Edge properties
 * @returns {Object} Graph edge with all fields populated
 */
export function createGraphEdge({
  from = null,
  to = null,
  srcEid = null,
  peerRaw = null,
  peerLocalEid = null,
  peerOappId = null,
  peerStateHint = null,
  blockReasonHint = null,
  isStalePeer = false,
  libraryStatus = null,
  synthetic = false,
  sourceType = null,
} = {}) {
  return {
    ...GRAPH_EDGE_DEFAULTS,
    from,
    to,
    srcEid,
    peerRaw,
    peerLocalEid,
    peerOappId: peerOappId ?? from,
    peerStateHint,
    blockReasonHint,
    isStalePeer,
    libraryStatus,
    synthetic,
    sourceType,
  };
}
