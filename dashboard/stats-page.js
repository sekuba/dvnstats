const DATA_DIR = "./data";

let statsData = null;
let chainMetadata = null;
let dvnResolver = null;
let availableDatasets = [];
let currentDataset = null;

class DVNResolver {
  constructor() {
    this.dvnDirectory = new Map();
  }

  hydrate(data) {
    if (!data || typeof data !== "object") return;

    Object.entries(data).forEach(([key, chain]) => {
      if (!chain || typeof chain !== "object") return;

      const deployments = Array.isArray(chain.deployments) ? chain.deployments : [];

      deployments.forEach((dep) => {
        if (dep?.eid === undefined || dep.eid === null) return;

        const eid = String(dep.eid);

        if (chain.dvns && typeof chain.dvns === "object") {
          Object.entries(chain.dvns).forEach(([addr, info]) => {
            if (!addr) return;
            const normalized = String(addr).toLowerCase();
            const dvnLabel = info?.canonicalName || info?.name || info?.id || addr;
            this.dvnDirectory.set(`local:${eid}:${normalized}`, dvnLabel);
            if (!this.dvnDirectory.has(`fallback:${normalized}`)) {
              this.dvnDirectory.set(`fallback:${normalized}`, dvnLabel);
            }
          });
        }
      });
    });
  }

  resolveDvnName(address, localEid = null) {
    if (!address) return address;

    const normalized = String(address).toLowerCase();

    let resolved = undefined;
    if (localEid !== undefined && localEid !== null) {
      resolved = this.dvnDirectory.get(`local:${localEid}:${normalized}`);
    }
    if (!resolved) {
      resolved = this.dvnDirectory.get(`fallback:${normalized}`) || address;
    }

    return resolved;
  }

  resolveDvnNames(addresses, localEid = null) {
    return Array.isArray(addresses)
      ? addresses.map((addr) => this.resolveDvnName(addr, localEid))
      : [];
  }
}

async function loadChainMetadata() {
  try {
    const response = await fetch("./layerzero.json");
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.warn("Could not load chain metadata:", error);
    return null;
  }
}

function getChainName(eid, metadata) {
  if (!metadata) return `EID ${eid}`;

  for (const [chainKey, chainData] of Object.entries(metadata)) {
    if (!chainData.deployments) continue;

    for (const deployment of chainData.deployments) {
      if (String(deployment.eid) === String(eid)) {
        return (
          chainData.chainDetails?.name ||
          chainData.chainDetails?.shortName ||
          chainKey.replace("-mainnet", "").replace("-", " ")
        );
      }
    }
  }

  return `EID ${eid}`;
}

// Format numbers
function formatNumber(num) {
  return num.toLocaleString();
}

function formatPercent(percent) {
  return `${percent.toFixed(2)}%`;
}

function formatDate(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(Number(timestamp) * 1000);
  return date.toISOString().split("T")[0];
}

function formatAddress(address) {
  if (!address || address.length < 10) return address;
  return `${address.substring(0, 6)}…${address.substring(address.length - 4)}`;
}

function renderOverview(stats) {
  document.getElementById("stat-total").textContent = formatNumber(stats.total);
  document.getElementById("stat-all-default").textContent = formatPercent(
    stats.allDefaultPercentage,
  );
  document.getElementById("stat-default-lib").textContent = formatPercent(
    stats.defaultLibPercentage,
  );
  document.getElementById("stat-default-config").textContent = formatPercent(
    stats.defaultConfigPercentage,
  );
  document.getElementById("stat-tracked").textContent = formatPercent(stats.trackedPercentage);
  document.getElementById("stat-dvn-combos").textContent = formatNumber(
    stats.dvnCombinations.length,
  );

  const subtitle = `${formatNumber(stats.total)} packets • ${stats.dvnCombinations.length} unique DVN combinations`;
  document.getElementById("stats-subtitle").textContent = subtitle;

  document.getElementById("computed-at").textContent = new Date(stats.computedAt).toLocaleString();

  const timeRange = `${formatDate(stats.timeRange.earliest)} → ${formatDate(stats.timeRange.latest)}`;
  document.getElementById("time-range").textContent = timeRange;
}

function renderPieChart(containerId, data, options = {}) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  if (!data || data.length === 0) {
    container.innerHTML = '<p class="chart-empty">No data available</p>';
    return;
  }

  const total = data.reduce((sum, item) => sum + item.value, 0);

  // Create pie chart
  const pieChart = document.createElement("div");
  pieChart.className = "pie-chart-container";

  // SVG for pie
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 200 200");
  svg.setAttribute("class", "pie-svg");

  let currentAngle = 0;
  const colors = [
    "#1b9c85", // green
    "#78bdff", // blue
    "#ff1df5", // magenta
    "#f2f200", // yellow
    "#ff6b6b", // red
    "#4ecdc4", // teal
    "#95e1d3", // mint
    "#f38181", // salmon
    "#aa96da", // purple
    "#fcbad3", // pink
  ];

  data.forEach((item, index) => {
    const percentage = (item.value / total) * 100;
    const angle = (item.value / total) * 360;

    if (percentage < 0.5) return; // Skip tiny slices

    const slice = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;

    const x1 = 100 + 80 * Math.cos((Math.PI * startAngle) / 180);
    const y1 = 100 + 80 * Math.sin((Math.PI * startAngle) / 180);
    const x2 = 100 + 80 * Math.cos((Math.PI * endAngle) / 180);
    const y2 = 100 + 80 * Math.sin((Math.PI * endAngle) / 180);

    const largeArc = angle > 180 ? 1 : 0;

    const pathData = [
      `M 100 100`,
      `L ${x1} ${y1}`,
      `A 80 80 0 ${largeArc} 1 ${x2} ${y2}`,
      `Z`,
    ].join(" ");

    slice.setAttribute("d", pathData);
    slice.setAttribute("fill", colors[index % colors.length]);
    slice.setAttribute("stroke", "#0d0d0d");
    slice.setAttribute("stroke-width", "2");
    slice.setAttribute("class", "pie-slice");

    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${item.label}: ${formatNumber(item.value)} (${formatPercent(percentage)})`;
    slice.appendChild(title);

    svg.appendChild(slice);
    currentAngle += angle;
  });

  pieChart.appendChild(svg);

  // Legend
  const legend = document.createElement("div");
  legend.className = "pie-legend";

  data.forEach((item, index) => {
    const percentage = (item.value / total) * 100;
    if (percentage < 0.5) return; // Skip tiny slices

    const legendItem = document.createElement("div");
    legendItem.className = "pie-legend-item";

    const colorBox = document.createElement("div");
    colorBox.className = "pie-legend-color";
    colorBox.style.backgroundColor = colors[index % colors.length];

    const label = document.createElement("div");
    label.className = "pie-legend-label";
    label.textContent = item.label;

    const value = document.createElement("div");
    value.className = "pie-legend-value";
    value.innerHTML = `<strong>${formatNumber(item.value)}</strong> <span>(${formatPercent(percentage)})</span>`;

    legendItem.appendChild(colorBox);
    legendItem.appendChild(label);
    legendItem.appendChild(value);

    legend.appendChild(legendItem);
  });

  pieChart.appendChild(legend);
  container.appendChild(pieChart);
}

// Render horizontal bar chart
function renderBarChart(containerId, data, options = {}) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  if (!data || data.length === 0) {
    container.innerHTML = '<p class="chart-empty">No data available</p>';
    return;
  }

  const maxValue = Math.max(...data.map((d) => d.value));

  data.forEach((item) => {
    const row = document.createElement("div");
    row.className = "bar-row";

    const label = document.createElement("div");
    label.className = "bar-label";
    label.textContent = item.label;

    const barContainer = document.createElement("div");
    barContainer.className = "bar-container-horizontal";

    const bar = document.createElement("div");
    bar.className = `bar-fill-horizontal ${options.barClass || ""}`;
    const percentage = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
    bar.style.width = `${percentage}%`;

    const valueLabel = document.createElement("div");
    valueLabel.className = "bar-value";
    valueLabel.innerHTML = `<strong>${formatNumber(item.value)}</strong> <span class="bar-percent">(${formatPercent(item.percentage)})</span>`;

    barContainer.appendChild(bar);
    row.appendChild(label);
    row.appendChild(barContainer);
    row.appendChild(valueLabel);

    // Interactive hover
    row.addEventListener("mouseenter", () => {
      bar.style.transform = "scaleY(1.2)";
    });
    row.addEventListener("mouseleave", () => {
      bar.style.transform = "scaleY(1)";
    });

    container.appendChild(row);
  });
}

// Render DVN count pie chart (with "Other" bucket for 0 and >4)
function renderDvnCountChart(stats) {
  const buckets = new Map();

  stats.dvnCountBuckets.forEach((bucket) => {
    const count = bucket.requiredDvnCount;
    if (count === 0 || count > 4) {
      buckets.set(
        "Other (0 or >4 DVNs)",
        (buckets.get("Other (0 or >4 DVNs)") || 0) + bucket.packetCount,
      );
    } else {
      buckets.set(`${count} DVN${count === 1 ? "" : "s"}`, bucket.packetCount);
    }
  });

  const data = Array.from(buckets.entries())
    .map(([label, value]) => ({
      label,
      value,
      percentage: (value / stats.total) * 100,
    }))
    .sort((a, b) => {
      // Sort: 1, 2, 3, 4, Other
      if (a.label.startsWith("Other")) return 1;
      if (b.label.startsWith("Other")) return -1;
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });

  renderPieChart("dvn-count-chart", data);
}

// Render optional DVN count pie chart (exclude 0)
function renderOptionalDvnCountChart(stats) {
  const data = stats.optionalDvnCountBuckets
    .filter((bucket) => bucket.optionalDvnCount > 0) // Exclude 0
    .map((bucket) => ({
      label: `${bucket.optionalDvnCount} DVN${bucket.optionalDvnCount === 1 ? "" : "s"}`,
      value: bucket.packetCount,
      percentage: bucket.percentage,
    }));

  renderPieChart("optional-dvn-count-chart", data);
}

// Render top DVN combinations with resolved names (deduplicated by resolved names)
function renderDvnComboChart(stats) {
  const container = document.getElementById("dvn-combo-chart");
  container.innerHTML = "";

  if (!stats.dvnCombinations || stats.dvnCombinations.length === 0) {
    container.innerHTML = '<p class="chart-empty">No DVN combinations found</p>';
    return;
  }

  // Deduplicate by resolved names
  const mergedCombos = new Map();

  stats.dvnCombinations.forEach((combo) => {
    // Resolve all DVN addresses to names using the correct localEid
    const resolvedDvns = combo.dvns.map((dvn) => {
      const resolved = dvnResolver ? dvnResolver.resolveDvnName(dvn, combo.localEid) : dvn;
      return {
        address: dvn,
        name: resolved,
        isResolved: resolved !== dvn && !resolved.startsWith("0x"),
      };
    });

    // Sort by resolved name (or address if not resolved)
    const sorted = [...resolvedDvns].sort((a, b) => {
      const aKey = a.isResolved ? a.name : a.address;
      const bKey = b.isResolved ? b.name : b.address;
      return aKey.localeCompare(bKey);
    });

    // Create key from sorted resolved names
    const comboKey = sorted.map((d) => (d.isResolved ? d.name : d.address)).join("|||");

    if (mergedCombos.has(comboKey)) {
      // Merge with existing
      const existing = mergedCombos.get(comboKey);
      existing.count += combo.count;
    } else {
      // Add new
      mergedCombos.set(comboKey, {
        dvns: sorted,
        count: combo.count,
        comboKey,
      });
    }
  });

  // Convert to array and recalculate percentages
  const deduplicatedCombos = Array.from(mergedCombos.values())
    .map((combo) => ({
      ...combo,
      percentage: (combo.count / stats.total) * 100,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20); // Top 20

  if (deduplicatedCombos.length === 0) {
    container.innerHTML = '<p class="chart-empty">No DVN combinations found</p>';
    return;
  }

  const maxValue = deduplicatedCombos[0]?.count || 0;

  deduplicatedCombos.forEach((combo, index) => {
    const row = document.createElement("div");
    row.className = "combo-row";

    const rank = document.createElement("div");
    rank.className = "combo-rank";
    rank.textContent = `#${index + 1}`;

    const dvnList = document.createElement("div");
    dvnList.className = "combo-dvn-list";

    // Render resolved DVN names
    combo.dvns.forEach((dvn) => {
      const badge = document.createElement("span");
      badge.className = "dvn-badge-small";

      badge.textContent = dvn.isResolved ? dvn.name : formatAddress(dvn.address);
      badge.title = dvn.isResolved ? `${dvn.name} - ${dvn.address}` : dvn.address;
      dvnList.appendChild(badge);
    });

    const barContainer = document.createElement("div");
    barContainer.className = "combo-bar-container";

    const bar = document.createElement("div");
    bar.className = "combo-bar-fill";
    const percentage = maxValue > 0 ? (combo.count / maxValue) * 100 : 0;
    bar.style.width = `${percentage}%`;

    const value = document.createElement("div");
    value.className = "combo-value";
    value.innerHTML = `<strong>${formatNumber(combo.count)}</strong> <span class="combo-percent">(${formatPercent(combo.percentage)})</span>`;

    barContainer.appendChild(bar);
    row.appendChild(rank);
    row.appendChild(dvnList);
    row.appendChild(barContainer);
    row.appendChild(value);

    // Interactive hover
    row.addEventListener("mouseenter", () => {
      bar.style.opacity = "1";
      bar.style.transform = "scaleY(1.15)";
    });
    row.addEventListener("mouseleave", () => {
      bar.style.opacity = "0.85";
      bar.style.transform = "scaleY(1)";
    });

    container.appendChild(row);
  });
}

// Render chain breakdown
function renderChainChart(stats) {
  const data = stats.chainBreakdown.slice(0, 20).map((item) => ({
    label: getChainName(item.localEid, chainMetadata),
    value: item.packetCount,
    percentage: item.percentage,
  }));

  renderBarChart("chain-chart", data, { barClass: "bar-fill--accent" });
}

// Render source chain breakdown
function renderSrcChainChart(stats) {
  const data = stats.srcChainBreakdown.slice(0, 20).map((item) => ({
    label: getChainName(item.srcEid, chainMetadata),
    value: item.packetCount,
    percentage: item.percentage,
  }));

  renderBarChart("src-chain-chart", data, { barClass: "bar-fill--magenta" });
}

// Render time-series line chart
function renderTimeSeriesChart(containerId, data, options = {}) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  if (!data || data.length === 0) {
    container.innerHTML = '<p class="chart-empty">No time-series data available</p>';
    return;
  }

  // Filter out zero values for better visualization
  const filteredData = data.filter((d) => d.value > 0);

  if (filteredData.length === 0) {
    container.innerHTML = '<p class="chart-empty">No time-series data available</p>';
    return;
  }

  const { color = "#1b9c85", label = "Value", showPoints = false, timeInterval = "hourly" } = options;

  // Create chart container
  const chartContainer = document.createElement("div");
  chartContainer.className = "time-series-container";

  // Calculate dimensions and scales
  const width = 1200;
  const height = 300;
  const padding = { top: 20, right: 40, bottom: 60, left: 80 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const minTimestamp = Math.min(...filteredData.map((d) => d.timestamp));
  const maxTimestamp = Math.max(...filteredData.map((d) => d.timestamp));
  const minValue = 0;
  const maxValue = Math.max(...filteredData.map((d) => d.value));

  // Scale functions
  const scaleX = (timestamp) => {
    return padding.left + ((timestamp - minTimestamp) / (maxTimestamp - minTimestamp)) * chartWidth;
  };

  const scaleY = (value) => {
    return height - padding.bottom - ((value - minValue) / (maxValue - minValue)) * chartHeight;
  };

  // Create SVG
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "time-series-svg");

  // Background grid (optional)
  const gridGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  gridGroup.setAttribute("class", "grid");

  // Horizontal grid lines (5 lines)
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (chartHeight * i) / 5;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", padding.left);
    line.setAttribute("y1", y);
    line.setAttribute("x2", width - padding.right);
    line.setAttribute("y2", y);
    line.setAttribute("stroke", "#0d0d0d");
    line.setAttribute("stroke-width", "1");
    line.setAttribute("stroke-opacity", "0.1");
    gridGroup.appendChild(line);
  }
  svg.appendChild(gridGroup);

  // Build path for line chart
  const pathData = filteredData
    .map((d, i) => {
      const x = scaleX(d.timestamp);
      const y = scaleY(d.value);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  // Area fill under line
  const areaPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const areaData = [
    `M ${scaleX(filteredData[0].timestamp)} ${height - padding.bottom}`,
    ...filteredData.map((d) => `L ${scaleX(d.timestamp)} ${scaleY(d.value)}`),
    `L ${scaleX(filteredData[filteredData.length - 1].timestamp)} ${height - padding.bottom}`,
    "Z",
  ].join(" ");
  areaPath.setAttribute("d", areaData);
  areaPath.setAttribute("fill", color);
  areaPath.setAttribute("fill-opacity", "0.15");
  svg.appendChild(areaPath);

  // Line
  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("d", pathData);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", "3");
  line.setAttribute("stroke-linejoin", "round");
  line.setAttribute("stroke-linecap", "round");
  svg.appendChild(line);

  // Points (optional)
  if (showPoints && filteredData.length < 200) {
    filteredData.forEach((d) => {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", scaleX(d.timestamp));
      circle.setAttribute("cy", scaleY(d.value));
      circle.setAttribute("r", "4");
      circle.setAttribute("fill", color);
      circle.setAttribute("stroke", "#0d0d0d");
      circle.setAttribute("stroke-width", "2");

      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `${formatDate(d.timestamp)}: ${formatNumber(d.value)}`;
      circle.appendChild(title);

      svg.appendChild(circle);
    });
  }

  // Y-axis
  const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  yAxis.setAttribute("x1", padding.left);
  yAxis.setAttribute("y1", padding.top);
  yAxis.setAttribute("x2", padding.left);
  yAxis.setAttribute("y2", height - padding.bottom);
  yAxis.setAttribute("stroke", "#0d0d0d");
  yAxis.setAttribute("stroke-width", "3");
  svg.appendChild(yAxis);

  // X-axis
  const xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  xAxis.setAttribute("x1", padding.left);
  xAxis.setAttribute("y1", height - padding.bottom);
  xAxis.setAttribute("x2", width - padding.right);
  xAxis.setAttribute("y2", height - padding.bottom);
  xAxis.setAttribute("stroke", "#0d0d0d");
  xAxis.setAttribute("stroke-width", "3");
  svg.appendChild(xAxis);

  // Y-axis labels (5 ticks)
  for (let i = 0; i <= 5; i++) {
    const value = minValue + ((maxValue - minValue) * i) / 5;
    const y = height - padding.bottom - (chartHeight * i) / 5;

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", padding.left - 10);
    text.setAttribute("y", y + 4);
    text.setAttribute("text-anchor", "end");
    text.setAttribute("class", "axis-label");
    text.textContent = formatNumber(Math.round(value));
    svg.appendChild(text);
  }

  // X-axis labels (show ~6 time points)
  const numXLabels = Math.min(6, filteredData.length);
  for (let i = 0; i < numXLabels; i++) {
    const index = Math.floor((i * (filteredData.length - 1)) / (numXLabels - 1));
    const d = filteredData[index];
    const x = scaleX(d.timestamp);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", x);
    text.setAttribute("y", height - padding.bottom + 25);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "axis-label");
    text.textContent = formatDate(d.timestamp);
    svg.appendChild(text);
  }

  chartContainer.appendChild(svg);

  // Summary stats
  const summary = document.createElement("div");
  summary.className = "time-series-summary";

  const totalValue = filteredData.reduce((sum, d) => sum + d.value, 0);
  const avgValue = totalValue / filteredData.length;
  const maxPoint = filteredData.reduce(
    (max, d) => (d.value > max.value ? d : max),
    filteredData[0],
  );

  summary.innerHTML = `
    <div class="summary-item">
      <span class="summary-label">Total:</span>
      <span class="summary-value">${formatNumber(Math.round(totalValue))}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Average:</span>
      <span class="summary-value">${formatNumber(Math.round(avgValue))}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Peak:</span>
      <span class="summary-value">${formatNumber(maxPoint.value)} on ${formatDate(maxPoint.timestamp)}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Data Points:</span>
      <span class="summary-value">${formatNumber(filteredData.length)} (${timeInterval})</span>
    </div>
  `;

  chartContainer.appendChild(summary);
  container.appendChild(chartContainer);
}

// Merge datapoints to reduce total count to below maxDatapoints
function mergeDatapoints(data, maxDatapoints = 600) {
  if (data.length <= maxDatapoints) {
    return { data, mergeFactor: 1 };
  }

  // Calculate how many points to merge into one
  const mergeFactor = Math.ceil(data.length / maxDatapoints);
  const mergedData = [];

  for (let i = 0; i < data.length; i += mergeFactor) {
    const group = data.slice(i, i + mergeFactor);

    // Use the first timestamp in the group
    const timestamp = group[0].timestamp;

    // Sum the values in the group
    const value = group.reduce((sum, point) => sum + point.value, 0);

    mergedData.push({ timestamp, value });
  }

  return { data: mergedData, mergeFactor };
}

// Get human-readable time interval description
function getTimeIntervalLabel(mergeFactor) {
  if (mergeFactor === 1) {
    return "hourly";
  } else if (mergeFactor < 24) {
    return `every ${mergeFactor} hours`;
  } else if (mergeFactor === 24) {
    return "daily";
  } else if (mergeFactor < 168) {
    const days = Math.round(mergeFactor / 24);
    return `every ${days} days`;
  } else {
    const weeks = Math.round(mergeFactor / 168);
    return weeks === 1 ? "weekly" : `every ${weeks} weeks`;
  }
}

// Render hourly packet volume time series
function renderPacketTimeSeries(stats) {
  if (!stats.timeSeries || !stats.timeSeries.hourly) {
    document.getElementById("time-series-packets-chart").innerHTML =
      '<p class="chart-empty">No time-series data available</p>';
    return;
  }

  const data = stats.timeSeries.hourly.map((d) => ({
    timestamp: d.timestamp,
    value: d.packets,
  }));

  // Merge datapoints if we have more than 600
  const { data: mergedData, mergeFactor } = mergeDatapoints(data, 600);
  const timeInterval = getTimeIntervalLabel(mergeFactor);

  // Update subtitle with actual time interval
  const intervalCapitalized = timeInterval.charAt(0).toUpperCase() + timeInterval.slice(1);
  document.getElementById("time-series-packets-subtitle").textContent =
    `${intervalCapitalized} packet count across entire time range`;

  renderTimeSeriesChart("time-series-packets-chart", mergedData, {
    color: "#1b9c85",
    label: "Packets",
    showPoints: false,
    timeInterval: timeInterval,
  });
}

// Render config changes time series
function renderConfigChangesTimeSeries(stats) {
  if (!stats.timeSeries || !stats.timeSeries.hourly) {
    document.getElementById("time-series-config-chart").innerHTML =
      '<p class="chart-empty">No time-series data available</p>';
    return;
  }

  // Update total config changes label
  if (stats.timeSeries.totalConfigChanges !== undefined) {
    document.getElementById("total-config-changes").textContent = formatNumber(
      stats.timeSeries.totalConfigChanges,
    );
  }

  const data = stats.timeSeries.hourly.map((d) => ({
    timestamp: d.timestamp,
    value: d.configChanges,
  }));

  // Merge datapoints if we have more than 600
  const { data: mergedData, mergeFactor } = mergeDatapoints(data, 600);
  const timeInterval = getTimeIntervalLabel(mergeFactor);

  // Update subtitle with actual time interval
  const intervalCapitalized = timeInterval.charAt(0).toUpperCase() + timeInterval.slice(1);
  const totalConfigChanges = stats.timeSeries.totalConfigChanges !== undefined
    ? formatNumber(stats.timeSeries.totalConfigChanges)
    : document.getElementById("total-config-changes").textContent;
  document.getElementById("time-series-config-subtitle").innerHTML =
    `${intervalCapitalized} config changes • <span id="total-config-changes">${totalConfigChanges}</span> total config changes`;

  renderTimeSeriesChart("time-series-config-chart", mergedData, {
    color: "#ff1df5",
    label: "Config Changes",
    showPoints: false,
    timeInterval: timeInterval,
  });
}

// Show error
function showError(message) {
  document.getElementById("loading-state").classList.add("hidden");
  document.getElementById("stats-content").classList.add("hidden");
  const errorState = document.getElementById("error-state");
  errorState.classList.remove("hidden");
  document.getElementById("error-message").textContent = message;
}

// Show content
function showContent() {
  document.getElementById("loading-state").classList.add("hidden");
  document.getElementById("error-state").classList.add("hidden");
  document.getElementById("stats-content").classList.remove("hidden");
}

// Discover available datasets by trying common lookback patterns
async function discoverDatasets() {
  const patterns = ["30d", "90d", "1y", "all"];
  const found = [];

  for (const pattern of patterns) {
    try {
      const filename = `packet-stats-${pattern}.json`;
      const response = await fetch(`${DATA_DIR}/${filename}`, { method: "HEAD" });
      if (response.ok) {
        found.push({ name: pattern, filename });
      }
    } catch (error) {
      // File doesn't exist, skip
    }
  }

  return found;
}

function renderDatasetButtons(datasets) {
  const header = document.querySelector(".stats-header");

  const existing = document.getElementById("dataset-selector");
  if (existing) existing.remove();

  if (datasets.length <= 1) {
    return;
  }

  const container = document.createElement("div");
  container.id = "dataset-selector";
  container.className = "dataset-selector";

  const label = document.createElement("span");
  label.className = "dataset-label";
  label.textContent = "Time Range:";
  container.appendChild(label);

  const buttonGroup = document.createElement("div");
  buttonGroup.className = "dataset-buttons";

  datasets.forEach((dataset) => {
    const button = document.createElement("button");
    button.className = "dataset-button";
    button.textContent = dataset.name === "all" ? "All Time" : dataset.name.toUpperCase();
    button.dataset.name = dataset.name;

    if (currentDataset === dataset.name) {
      button.classList.add("active");
    }

    button.addEventListener("click", () => {
      loadAndRender(dataset.name);
    });

    buttonGroup.appendChild(button);
  });

  container.appendChild(buttonGroup);
  header.appendChild(container);
}

async function loadAndRender(datasetName = null) {
  try {
    if (!datasetName && availableDatasets.length > 0) {
      datasetName = availableDatasets[0].name;
    }

    currentDataset = datasetName;

    const loadingBanner = document.getElementById("loading-state");
    loadingBanner.classList.remove("hidden");
    document.getElementById("stats-content").classList.add("hidden");
    document.getElementById("error-state").classList.add("hidden");

    const datasetLabel = datasetName === "all" ? "All Time" : datasetName.toUpperCase();
    loadingBanner.querySelector("p").textContent = `Loading ${datasetLabel} statistics...`;

    if (!chainMetadata) {
      chainMetadata = await loadChainMetadata();

      if (chainMetadata) {
        dvnResolver = new DVNResolver();
        dvnResolver.hydrate(chainMetadata);
      }
    }

    const dataPath = `${DATA_DIR}/packet-stats-${datasetName}.json`;

    const response = await fetch(dataPath);
    if (!response.ok) {
      throw new Error(`Failed to load statistics: ${response.status} ${response.statusText}`);
    }

    statsData = await response.json();

    if (!statsData || statsData.total === 0) {
      throw new Error("No packet data available. Run the precomputation script first.");
    }

    renderDatasetButtons(availableDatasets);

    renderOverview(statsData);
    renderDvnCountChart(statsData);
    renderOptionalDvnCountChart(statsData);
    renderDvnComboChart(statsData);
    renderChainChart(statsData);
    renderSrcChainChart(statsData);
    renderPacketTimeSeries(statsData);
    renderConfigChangesTimeSeries(statsData);

    showContent();
  } catch (error) {
    console.error("Failed to load statistics:", error);
    showError(error.message);
  }
}

// Initialize tooltip functionality for mobile tap handling
function initTooltips() {
  const statCards = document.querySelectorAll(".stat-card");

  statCards.forEach((card) => {
    card.addEventListener("click", (e) => {
      // Check if we're on a touch device or small screen
      const isMobile = window.matchMedia("(max-width: 768px)").matches || "ontouchstart" in window;

      if (isMobile) {
        // Prevent the click from immediately closing the tooltip
        e.stopPropagation();

        // Toggle tooltip-active class
        const wasActive = card.classList.contains("tooltip-active");

        // Close all other tooltips
        statCards.forEach((otherCard) => {
          if (otherCard !== card) {
            otherCard.classList.remove("tooltip-active");
          }
        });

        // Toggle this tooltip
        if (wasActive) {
          card.classList.remove("tooltip-active");
        } else {
          card.classList.add("tooltip-active");
        }
      }
    });
  });

  // Close tooltips when clicking outside on mobile
  document.addEventListener("click", (e) => {
    const isMobile = window.matchMedia("(max-width: 768px)").matches || "ontouchstart" in window;

    if (isMobile && !e.target.closest(".stat-card")) {
      statCards.forEach((card) => {
        card.classList.remove("tooltip-active");
      });
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  availableDatasets = await discoverDatasets();

  if (availableDatasets.length === 0) {
    showError("No precomputed statistics found. Run the precomputation script first.");
    return;
  }

  renderDatasetButtons(availableDatasets);

  await loadAndRender(availableDatasets[0].name);

  // Initialize tooltips after content is loaded
  initTooltips();
});
