import { formatTimestampValue } from "../../formatters/valueFormatters.js";

export function renderSummaryPanels(meta, { aliasStore, getChainDisplayLabel }) {
  if (!meta) {
    return null;
  }

  const container = document.createElement("div");
  container.className = "summary-panels";

  const oappPanels = [];
  if (meta.oappInfo) {
    const panel = renderOAppSummary(meta, aliasStore, getChainDisplayLabel);
    if (panel) {
      oappPanels.push(panel);
    }
  }
  if (meta.securitySummary) {
    const panel = renderSecuritySummary(meta.securitySummary);
    if (panel) {
      oappPanels.push(panel);
    }
  }
  if (meta.routeStats && meta.routeStats.length > 0) {
    const panel = renderRouteStatsSummary(meta.routeStats, getChainDisplayLabel);
    if (panel) {
      oappPanels.push(panel);
    }
  }
  if (meta.rateLimiter || (meta.rateLimits && meta.rateLimits.length > 0)) {
    const panel = renderRateLimitingSummary(meta, getChainDisplayLabel);
    if (panel) {
      oappPanels.push(panel);
    }
  }

  if (oappPanels.length > 0) {
    const row = document.createElement("div");
    row.className = "summary-panel-row";
    oappPanels.forEach((panel) => row.appendChild(panel));
    container.appendChild(row);
  }

  if (meta.popularOappsSummary) {
    const panel = renderPopularOappsSummary(meta.popularOappsSummary);
    if (panel) {
      const row = document.createElement("div");
      row.className = "summary-panel-row";
      row.appendChild(panel);
      container.appendChild(row);
    }
  }

  return container.children.length > 0 ? container : null;
}

function renderOAppSummary(meta, aliasStore, getChainDisplayLabel) {
  const info = meta?.oappInfo;
  if (!info) {
    return null;
  }

  const panel = createPanel("OApp Overview");
  const list = document.createElement("dl");
  panel.appendChild(list);

  const alias = aliasStore?.get?.(info.id);
  if (alias) {
    appendSummaryRow(list, "OApp Alias", alias);
  }
  appendSummaryRow(list, "OApp ID", info.id ?? "");

  const localEid =
    info.localEid !== undefined && info.localEid !== null ? String(info.localEid) : "—";
  const localLabel = meta.chainLabel || getChainDisplayLabel(localEid) || `EID ${localEid}`;
  appendSummaryRow(list, "Local EID", localLabel);
  appendSummaryRow(list, "Address", info.address ?? "");

  if (info.totalPacketsReceived !== undefined && info.totalPacketsReceived !== null) {
    appendSummaryRow(list, "Total Packets", String(info.totalPacketsReceived));
  }
  if (info.lastPacketBlock !== undefined && info.lastPacketBlock !== null) {
    appendSummaryRow(list, "Last Packet Block", String(info.lastPacketBlock));
  }
  if (info.lastPacketTimestamp !== undefined && info.lastPacketTimestamp !== null) {
    const ts = formatTimestampValue(info.lastPacketTimestamp);
    if (ts) {
      appendSummaryRow(list, "Last Packet Time", ts.primary);
    }
  }

  return panel;
}

function renderRouteStatsSummary(routeStats, getChainDisplayLabel) {
  if (!Array.isArray(routeStats) || routeStats.length === 0) {
    return null;
  }

  const panel = createPanel("Per-Route Activity");
  const list = document.createElement("dl");
  panel.appendChild(list);

  appendSummaryRow(list, "Total Routes", routeStats.length);

  routeStats.slice(0, 5).forEach((route, index) => {
    const chainLabel = getChainDisplayLabel(route.srcEid) || `EID ${route.srcEid}`;
    appendSummaryRow(
      list,
      index === 0 ? "Top Routes" : " ",
      `${chainLabel}: ${route.packetCount} packets`,
    );
  });

  if (routeStats.length > 5) {
    appendSummaryRow(list, " ", `... and ${routeStats.length - 5} more routes`);
  }

  return panel;
}

function renderSecuritySummary(summary) {
  if (!summary) {
    return null;
  }

  const panel = createPanel("Security Snapshot");
  const list = document.createElement("dl");
  panel.appendChild(list);

  const totalRoutes = summary.totalRoutes ?? 0;
  const syntheticCount = summary.syntheticCount ?? 0;
  const implicitBlocks = summary.implicitBlocks ?? 0;
  const explicitBlocks = summary.explicitBlocks ?? 0;
  const blockedTotal = implicitBlocks + explicitBlocks;

  appendSummaryRow(list, "Routes analyzed", totalRoutes);

  if (syntheticCount > 0) {
    appendSummaryRow(list, "Using defaults", syntheticCount);
  }

  if (blockedTotal > 0) {
    const blockedLabel =
      implicitBlocks > 0 && explicitBlocks > 0
        ? `${blockedTotal} (implicit ${implicitBlocks} • explicit ${explicitBlocks})`
        : implicitBlocks > 0
          ? `${blockedTotal} (implicit)`
          : `${blockedTotal} (explicit)`;
    appendSummaryRow(list, "Blocked routes", blockedLabel);
  }

  return panel;
}

function renderRateLimitingSummary(meta, getChainDisplayLabel) {
  const rateLimiter = meta.rateLimiter;
  const rateLimits = meta.rateLimits || [];

  const panel = createPanel("Rate Limiting (OFT)");
  const list = document.createElement("dl");
  panel.appendChild(list);

  if (rateLimiter && rateLimiter.rateLimiter) {
    appendSummaryRow(list, "Rate Limiter", rateLimiter.rateLimiter);
  } else {
    appendSummaryRow(list, "Rate Limiter", "Not configured");
  }

  appendSummaryRow(list, "Rate Limits", rateLimits.length);

  if (rateLimits.length > 0) {
    rateLimits.slice(0, 5).forEach((limit, index) => {
      const chainLabel = getChainDisplayLabel(limit.dstEid) || `EID ${limit.dstEid}`;
      const windowHours = Number(limit.window) / 3600;
      appendSummaryRow(
        list,
        index === 0 ? "Limits" : " ",
        `${chainLabel}: ${limit.limit} per ${windowHours}h`,
      );
    });

    if (rateLimits.length > 5) {
      appendSummaryRow(list, " ", `... and ${rateLimits.length - 5} more limits`);
    }
  }

  return panel;
}

function renderPopularOappsSummary(summary) {
  if (!summary) {
    return null;
  }

  const panel = createPanel("Window Overview");
  const list = document.createElement("dl");
  panel.appendChild(list);

  appendSummaryRow(list, "Window", summary.windowLabel || "");

  if (summary.fromTimestamp) {
    const ts = formatTimestampValue(summary.fromTimestamp);
    if (ts) {
      appendSummaryRow(list, "From", ts.primary);
    }
  }

  if (summary.toTimestamp) {
    const ts = formatTimestampValue(summary.toTimestamp);
    if (ts) {
      appendSummaryRow(list, "To", ts.primary);
    }
  }

  appendSummaryRow(list, "Packets Scanned", summary.sampledPackets);
  appendSummaryRow(list, "Unique OApps", summary.totalOapps);
  appendSummaryRow(list, "Results Returned", summary.returnedCount);
  appendSummaryRow(list, "Sample Limit", summary.fetchLimit);

  return panel;
}

function createPanel(title) {
  const panel = document.createElement("div");
  panel.className = "summary-panel";

  const heading = document.createElement("h3");
  heading.textContent = title;
  panel.appendChild(heading);

  return panel;
}

function appendSummaryRow(list, label, value) {
  if (!value && value !== 0) {
    return;
  }
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = String(value);
  list.append(dt, dd);
}
