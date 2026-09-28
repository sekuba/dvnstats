const DATA_URL = "./data/stats.json";
const SCHEMA_VERSION = 4;
const DAY = 86400;
const HOUR = 3600;
const SVG_NS = "http://www.w3.org/2000/svg";

const WINDOW_NAMES = ["7d", "30d", "90d", "1y", "all"];
const DEFAULT_WINDOW = "90d";
const DATASET_PARAM = "range";
const LEGACY_DATASET_PARAM = "dataset";
const CHART_VIEW_PARAM_PREFIX = "view-";
const VALID_CHART_VIEWS = new Set(["snapshot", "time"]);
const chartViewState = {
  "verification-control": "snapshot",
  "dvn-threshold": "snapshot",
  "destination-chain": "snapshot",
  "source-chain": "snapshot",
};

const MAX_LINE_POINTS = 600;
const MAX_DAILY_POINTS = 120;
const HOURLY_WINDOW_DAYS = 90;
const STACKED_CHAIN_LIMIT = 8;
const DVN_THRESHOLD_UNKNOWN = "unknown";
const COLORS = [
  "#1b9c85",
  "#78bdff",
  "#ff1df5",
  "#f2f200",
  "#ff6b6b",
  "#4ecdc4",
  "#aa96da",
  "#f38181",
  "#fcbad3",
  "#95e1d3",
];

// Must match the tier definitions in scripts/precomputePacketStats.js.
const TIERS = [
  {
    key: "lzVerifiers",
    short: "LZ picks verifiers",
    label: "LayerZero picks the verifiers",
    color: "#ff1df5",
    note: "The route inherits the default receive library, the whole default ULN config, or the default required DVNs. LayerZero can change which DVNs are enough to deliver a packet.",
  },
  {
    key: "lzParams",
    short: "LZ sets other parameters",
    label: "LayerZero sets other parameters",
    color: "#f2f200",
    note: "The OApp owner set its own required DVNs, but confirmations or optional-DVN settings still fall back to LayerZero defaults. LayerZero can weaken finality or add verifiers that stall the route, but cannot get a packet past the owner's required DVNs.",
  },
  {
    key: "owner",
    short: "Owner sets everything",
    label: "OApp owner controls everything",
    color: "#1b9c85",
    note: "Every validation setting is set by the OApp owner.",
  },
  {
    key: "unknown",
    short: "Unknown",
    label: "Unknown (custom library)",
    color: "#c7c7c7",
    note: "A receive library the indexer cannot decode.",
  },
];

const WEAKEST_COLORS = { 1: "#ff1df5", 2: "#f2f200", strong: "#1b9c85", unknown: "#c7c7c7" };

let stats = null;
let currentWindow = null;

// ---------------------------------------------------------------------------
// Formatting and DOM helpers

const formatNumber = (num) => Number(num).toLocaleString();
const formatCompactNumber = (num) =>
  new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(num);
const formatPercent = (percent) => `${percent.toFixed(2)}%`;
const formatAxisPercent = (percent) => `${Math.round(percent)}%`;
const share = (value, total) => (total > 0 ? (value / total) * 100 : 0);
const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function formatDate(timestamp) {
  if (!timestamp) return "—";
  return new Date(Number(timestamp) * 1000).toISOString().split("T")[0];
}

function formatAddress(address) {
  if (!address || address.length < 10) return address;
  return `${address.substring(0, 6)}…${address.substring(address.length - 4)}`;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function svgTitle(node, text) {
  node.appendChild(svgEl("title")).textContent = text;
  return node;
}

/** "<strong>value</strong> <span class=…>(detail)</span>" built without innerHTML. */
function valueCell(className, strong, detail, detailClass) {
  const cell = el("div", className);
  cell.appendChild(el("strong", null, strong));
  if (detail !== undefined) {
    cell.append(" ");
    cell.appendChild(el("span", detailClass, detail));
  }
  return cell;
}

function renderEmpty(container, message) {
  container.replaceChildren(el("p", "chart-empty", message));
}

const chainName = (eid) => stats.chains[eid] ?? `EID ${eid}`;
const windowLabel = (name) => (name === "all" ? "All Time" : name.toUpperCase());

// ---------------------------------------------------------------------------
// URL state and anchors

function updateUrl(mutator) {
  const url = new URL(window.location.href);
  mutator(url);
  window.history.pushState({}, "", url);
}

function getRequestedWindow() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get(DATASET_PARAM) || params.get(LEGACY_DATASET_PARAM);
  return stats?.windows[requested] ? requested : null;
}

function applyChartViewsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  for (const chartKey of Object.keys(chartViewState)) {
    const view = params.get(`${CHART_VIEW_PARAM_PREFIX}${chartKey}`) || params.get(chartKey);
    chartViewState[chartKey] = VALID_CHART_VIEWS.has(view) ? view : "snapshot";
  }
}

function setLinkTarget(element) {
  if (element && !element.hasAttribute("tabindex")) {
    element.setAttribute("tabindex", "-1");
  }
}

function slugifyAnchor(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function uniqueElementId(baseId) {
  let id = baseId;
  let suffix = 2;
  while (document.getElementById(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function appendPermalink(heading, targetId) {
  if (!heading || !targetId || heading.querySelector(".section-permalink")) {
    return;
  }
  const link = el("a", "section-permalink", "#");
  link.href = `#${targetId}`;
  link.setAttribute("aria-label", `Link to ${heading.textContent.trim()}`);
  heading.appendChild(link);
}

function initializeStatsAnchors() {
  const header = document.querySelector(".stats-header");
  if (header && !header.id) {
    header.id = "stats-top";
  }
  const title = document.querySelector(".stats-header h1");
  if (header && title) {
    setLinkTarget(header);
    appendPermalink(title, header.id);
  }

  document.querySelectorAll(".stat-card").forEach((card) => {
    const heading = card.querySelector("h2");
    if (!heading) return;
    if (!card.id) {
      card.id = uniqueElementId(`stat-${slugifyAnchor(heading.textContent)}`);
    }
    setLinkTarget(card);
    appendPermalink(heading, card.id);
  });

  document.querySelectorAll(".chart-section").forEach((section) => {
    const heading = section.querySelector(".chart-title");
    if (!heading) return;
    if (!section.id) {
      section.id = uniqueElementId(slugifyAnchor(heading.textContent));
    }
    setLinkTarget(section);
    appendPermalink(heading, section.id);
  });

  document.querySelectorAll(".stats-grid[id], .svg-diagram[id]").forEach(setLinkTarget);
}

function scrollToCurrentHash() {
  const rawHash = window.location.hash.slice(1);
  if (!rawHash) return;
  const target = document.getElementById(decodeURIComponent(rawHash));
  if (!target) return;
  requestAnimationFrame(() => {
    target.scrollIntoView({ block: "start" });
    target.focus?.({ preventScroll: true });
  });
}

function setChartView(chartKey, view, options = {}) {
  if (!VALID_CHART_VIEWS.has(view)) return;
  chartViewState[chartKey] = view;

  document
    .querySelectorAll(`[data-chart-toggle="${chartKey}"] .chart-toggle-button`)
    .forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });
  document.querySelectorAll(`[data-chart-panel="${chartKey}"]`).forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.view !== view);
  });

  if (options.updateUrl) {
    updateUrl((url) => url.searchParams.set(`${CHART_VIEW_PARAM_PREFIX}${chartKey}`, view));
  }
}

function syncChartViews() {
  for (const [chartKey, view] of Object.entries(chartViewState)) setChartView(chartKey, view);
}

function initChartToggles() {
  document.querySelectorAll("[data-chart-toggle]").forEach((toggle) => {
    const chartKey = toggle.dataset.chartToggle;
    toggle.querySelectorAll(".chart-toggle-button").forEach((button) => {
      button.addEventListener("click", () => {
        setChartView(chartKey, button.dataset.view, { updateUrl: true });
      });
    });
  });
  syncChartViews();
}

// ---------------------------------------------------------------------------
// Time ranges over the precomputed series

function dailyRange(win) {
  const daily = stats.series.daily;
  const start = win.fromDay - daily.firstDay;
  const length = daily.packets.length - start;
  return {
    timestamps: Array.from({ length }, (_, i) => (win.fromDay + i) * DAY),
    slice: (values) => values.slice(start),
  };
}

/** Daily buckets for short windows, Monday-aligned weeks beyond MAX_DAILY_POINTS days. */
function rollup(win) {
  const range = dailyRange(win);
  if (range.timestamps.length <= MAX_DAILY_POINTS) {
    return { interval: "daily", timestamps: range.timestamps, sum: range.slice };
  }

  const weeks = [];
  const weekOfDay = range.timestamps.map((timestamp) => {
    const monday = timestamp - ((new Date(timestamp * 1000).getUTCDay() + 6) % 7) * DAY;
    if (weeks.at(-1) !== monday) weeks.push(monday);
    return weeks.length - 1;
  });
  return {
    interval: "weekly",
    timestamps: weeks,
    sum: (values) => {
      const out = new Array(weeks.length).fill(0);
      range.slice(values).forEach((value, i) => {
        out[weekOfDay[i]] += value;
      });
      return out;
    },
  };
}

/** Hourly points for windows up to 90 days, daily beyond; merged down to MAX_LINE_POINTS. */
function lineRange(win) {
  let timestamps;
  let slice;
  let baseHours;
  if (win.days && win.days <= HOURLY_WINDOW_DAYS) {
    const hourly = stats.series.hourly;
    const start = Math.max(0, win.fromDay * 24 - hourly.firstHour);
    timestamps = hourly.packets.slice(start).map((_, i) => (hourly.firstHour + start + i) * HOUR);
    slice = (key) => hourly[key].slice(start);
    baseHours = 1;
  } else {
    const range = dailyRange(win);
    timestamps = range.timestamps;
    slice = (key) => range.slice(stats.series.daily[key]);
    baseHours = 24;
  }

  const mergeFactor = Math.max(1, Math.ceil(timestamps.length / MAX_LINE_POINTS));
  const merge = (values) => {
    const merged = [];
    for (let i = 0; i < values.length; i += mergeFactor) {
      merged.push(values.slice(i, i + mergeFactor).reduce((sum, value) => sum + value, 0));
    }
    return merged;
  };
  return {
    timestamps: timestamps.filter((_, i) => i % mergeFactor === 0),
    values: (key) => merge(slice(key)),
    interval: intervalLabel(baseHours * mergeFactor),
  };
}

function intervalLabel(hours) {
  if (hours === 1) return "hourly";
  if (hours < 24) return `every ${hours} hours`;
  if (hours === 24) return "daily";
  if (hours < 168) return `every ${Math.round(hours / 24)} days`;
  const weeks = Math.round(hours / 168);
  return weeks === 1 ? "weekly" : `every ${weeks} weeks`;
}

// ---------------------------------------------------------------------------
// Chart primitives

function renderPieChart(containerId, data) {
  const container = document.getElementById(containerId);
  if (!data.length) return renderEmpty(container, "No data available");

  const total = data.reduce((sum, item) => sum + item.value, 0);
  const pieChart = el("div", "pie-chart-container");
  const svg = svgEl("svg", { viewBox: "0 0 200 200", class: "pie-svg" });
  const legend = el("div", "pie-legend");

  let currentAngle = 0;
  data.forEach((item, index) => {
    const percentage = share(item.value, total);
    const angle = (item.value / total) * 360;
    const point = (degrees) => [
      100 + 80 * Math.cos((Math.PI * degrees) / 180),
      100 + 80 * Math.sin((Math.PI * degrees) / 180),
    ];
    const [x1, y1] = point(currentAngle);
    const [x2, y2] = point(currentAngle + angle);
    const color = item.color ?? COLORS[index % COLORS.length];

    const slice = svgEl("path", {
      d: `M 100 100 L ${x1} ${y1} A 80 80 0 ${angle > 180 ? 1 : 0} 1 ${x2} ${y2} Z`,
      fill: color,
      stroke: "#0d0d0d",
      "stroke-width": "2",
      class: "pie-slice",
    });
    svgTitle(slice, `${item.label}: ${formatNumber(item.value)} (${formatPercent(percentage)})`);
    svg.appendChild(slice);
    currentAngle += angle;

    const legendItem = el("div", "pie-legend-item");
    legendItem.appendChild(el("div", "pie-legend-color")).style.backgroundColor = color;
    legendItem.appendChild(el("div", "pie-legend-label", item.label));
    legendItem.appendChild(
      valueCell("pie-legend-value", formatNumber(item.value), `(${formatPercent(percentage)})`),
    );
    legend.appendChild(legendItem);
  });

  pieChart.append(svg, legend);
  container.replaceChildren(pieChart);
}

function renderBarChart(containerId, data, options = {}) {
  const container = document.getElementById(containerId);
  if (!data.length) return renderEmpty(container, "No data available");

  const maxValue = Math.max(...data.map((d) => d.value));
  container.replaceChildren(
    ...data.map((item) => {
      const row = el("div", "bar-row");
      const barContainer = el("div", "bar-container-horizontal");
      const bar = barContainer.appendChild(
        el("div", `bar-fill-horizontal ${options.barClass || ""}`),
      );
      bar.style.width = `${maxValue > 0 ? (item.value / maxValue) * 100 : 0}%`;
      row.append(
        el("div", "bar-label", item.label),
        barContainer,
        valueCell(
          "bar-value",
          formatNumber(item.value),
          `(${formatPercent(item.percentage)})`,
          "bar-percent",
        ),
      );
      row.addEventListener("mouseenter", () => {
        bar.style.transform = "scaleY(1.2)";
      });
      row.addEventListener("mouseleave", () => {
        bar.style.transform = "scaleY(1)";
      });
      return row;
    }),
  );
}

const CHART = { width: 1200, padding: { top: 20, right: 40, bottom: 60, left: 80 } };

/** Grid, axes and tick labels shared by the line and stacked-area charts. */
function drawAxes(svg, { height, maxY, yLabel, xTicks }) {
  const { width, padding } = CHART;
  const chartHeight = height - padding.top - padding.bottom;
  const grid = svg.appendChild(svgEl("g", { class: "grid" }));

  for (let i = 0; i <= 5; i++) {
    const y = height - padding.bottom - (chartHeight * i) / 5;
    grid.appendChild(
      svgEl("line", {
        x1: padding.left,
        y1: y,
        x2: width - padding.right,
        y2: y,
        stroke: "#0d0d0d",
        "stroke-width": "1",
        "stroke-opacity": "0.1",
      }),
    );
    const label = svgEl("text", {
      x: padding.left - 10,
      y: y + 4,
      "text-anchor": "end",
      class: "axis-label",
    });
    label.textContent = yLabel((maxY * i) / 5);
    svg.appendChild(label);
  }

  const axis = (x1, y1, x2, y2) =>
    svgEl("line", { x1, y1, x2, y2, stroke: "#0d0d0d", "stroke-width": "3" });
  svg.appendChild(axis(padding.left, padding.top, padding.left, height - padding.bottom));
  svg.appendChild(
    axis(padding.left, height - padding.bottom, width - padding.right, height - padding.bottom),
  );

  for (const { x, text } of xTicks) {
    const label = svgEl("text", {
      x,
      y: height - padding.bottom + 25,
      "text-anchor": "middle",
      class: "axis-label",
    });
    label.textContent = text;
    svg.appendChild(label);
  }
}

function timeScale(timestamps) {
  const { width, padding } = CHART;
  const min = timestamps[0];
  const range = timestamps.at(-1) - min || 1;
  const scaleX = (t) => padding.left + ((t - min) / range) * (width - padding.left - padding.right);
  const count = Math.min(6, timestamps.length);
  const ticks = Array.from({ length: count }, (_, i) => {
    const index = count === 1 ? 0 : Math.floor((i * (timestamps.length - 1)) / (count - 1));
    return { x: scaleX(timestamps[index]), text: formatDate(timestamps[index]) };
  });
  return { scaleX, ticks };
}

function summaryPanel(className, items) {
  const summary = el("div", className);
  for (const [label, value] of items) {
    const item = summary.appendChild(el("div", "summary-item"));
    item.append(el("span", "summary-label", `${label}:`), " ", el("span", "summary-value", value));
  }
  return summary;
}

function renderLegend(className, entries) {
  const legend = el("div", "stacked-legend");
  for (const entry of entries) {
    const item = legend.appendChild(el("div", "stacked-legend-item"));
    item.appendChild(el("div", "stacked-legend-color")).style.backgroundColor = entry.color;
    item.appendChild(el("div", "stacked-legend-label", entry.label));
    if (entry.strong !== undefined) {
      const value = item.appendChild(valueCell("stacked-legend-value", entry.strong, entry.detail));
      value.title = entry.title ?? "";
    }
  }
  legend.classList.add(className);
  return legend;
}

/**
 * Stacked area chart; series are { label, color, values[] } aligned with timestamps.
 * In percent mode each bucket is normalised to 100%.
 */
function renderStackedAreaChart(containerId, timestamps, series, options = {}) {
  const container = document.getElementById(containerId);
  const isPercentMode = options.valueMode === "percent";
  const visible = series
    .map((entry) => ({ ...entry, total: entry.values.reduce((sum, v) => sum + v, 0) }))
    .filter((entry) => entry.total > 0);
  if (!visible.length || !timestamps.length) {
    return renderEmpty(container, "No time-series data available");
  }

  const bucketTotals = timestamps.map((_, i) =>
    visible.reduce((sum, entry) => sum + (entry.values[i] || 0), 0),
  );
  const totalPackets = bucketTotals.reduce((sum, count) => sum + count, 0);
  const plotted = visible.map((entry) => ({
    ...entry,
    values: isPercentMode
      ? entry.values.map((value, i) => share(value || 0, bucketTotals[i]))
      : entry.values,
  }));
  const maxY = isPercentMode ? 100 : Math.max(1, ...bucketTotals);

  const height = 340;
  const { padding } = CHART;
  const chartHeight = height - padding.top - padding.bottom;
  const { scaleX, ticks } = timeScale(timestamps);
  const scaleY = (value) => height - padding.bottom - (value / maxY) * chartHeight;
  const svg = svgEl("svg", { viewBox: `0 0 ${CHART.width} ${height}`, class: "stacked-area-svg" });

  const baseline = new Array(timestamps.length).fill(0);
  for (const entry of plotted) {
    const points = entry.values.map((value, i) => {
      const bottom = baseline[i];
      baseline[i] = bottom + (value || 0);
      return { x: scaleX(timestamps[i]), bottom, top: baseline[i] };
    });
    const top = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${scaleY(p.top)}`).join(" ");
    const bottom = [...points]
      .reverse()
      .map((p) => `L ${p.x} ${scaleY(p.bottom)}`)
      .join(" ");
    const area = svgEl("path", {
      d: `${top} ${bottom} Z`,
      fill: entry.color,
      "fill-opacity": "0.78",
      stroke: "#0d0d0d",
      "stroke-width": "1",
      class: "stacked-area-layer",
    });
    const entryShare = share(entry.total, totalPackets);
    svgTitle(
      area,
      isPercentMode
        ? `${entry.label}: ${formatPercent(entryShare)} of packets (${formatNumber(entry.total)} packets)`
        : `${entry.label}: ${formatNumber(entry.total)} packets`,
    );
    svg.appendChild(area);
  }

  drawAxes(svg, {
    height,
    maxY,
    yLabel: (value) => (isPercentMode ? formatAxisPercent(value) : formatNumber(Math.round(value))),
    xTicks: ticks,
  });

  const peakIndex = bucketTotals.reduce(
    (best, value, i) => (value > bucketTotals[best] ? i : best),
    0,
  );
  const chartContainer = el("div", "stacked-area-container");
  chartContainer.append(
    svg,
    summaryPanel("time-series-summary stacked-summary", [
      ["Total", formatNumber(totalPackets)],
      ["Interval", capitalize(options.interval || "daily")],
      [
        isPercentMode ? "Peak volume" : "Peak",
        `${formatNumber(bucketTotals[peakIndex])} on ${formatDate(timestamps[peakIndex])}`,
      ],
      ["Series", formatNumber(visible.length)],
    ]),
    renderLegend(
      "stacked-legend",
      visible.map((entry) => {
        const entryShare = share(entry.total, totalPackets);
        return {
          color: entry.color,
          label: entry.label,
          strong: isPercentMode ? formatPercent(entryShare) : formatNumber(entry.total),
          detail: isPercentMode
            ? `${formatCompactNumber(entry.total)} pkts`
            : `(${formatPercent(entryShare)})`,
          title: `${entry.label}: ${formatPercent(entryShare)} (${formatNumber(entry.total)} packets)`,
        };
      }),
    ),
  );
  container.replaceChildren(chartContainer);
}

/** Line chart with area fill; series are { label, color, values[] } aligned with timestamps. */
function renderLineChart(containerId, timestamps, series, options = {}) {
  const container = document.getElementById(containerId);
  const totals = series.map((entry) => entry.values.reduce((sum, v) => sum + v, 0));
  if (!timestamps.length || totals.every((total) => total === 0)) {
    return renderEmpty(container, "No time-series data available");
  }

  const height = 300;
  const { padding } = CHART;
  const chartHeight = height - padding.top - padding.bottom;
  const maxY = Math.max(1, ...series.flatMap((entry) => entry.values));
  const { scaleX, ticks } = timeScale(timestamps);
  const scaleY = (value) => height - padding.bottom - (value / maxY) * chartHeight;
  const svg = svgEl("svg", { viewBox: `0 0 ${CHART.width} ${height}`, class: "time-series-svg" });

  drawAxes(svg, {
    height,
    maxY,
    yLabel: (value) => formatNumber(Math.round(value)),
    xTicks: ticks,
  });

  for (const entry of series) {
    const points = entry.values.map((value, i) => `${scaleX(timestamps[i])} ${scaleY(value)}`);
    const baseY = height - padding.bottom;
    svg.appendChild(
      svgEl("path", {
        d: `M ${scaleX(timestamps[0])} ${baseY} L ${points.join(" L ")} L ${scaleX(timestamps.at(-1))} ${baseY} Z`,
        fill: entry.color,
        "fill-opacity": "0.15",
      }),
    );
    svg.appendChild(
      svgTitle(
        svgEl("path", {
          d: `M ${points.join(" L ")}`,
          fill: "none",
          stroke: entry.color,
          "stroke-width": "3",
          "stroke-linejoin": "round",
          "stroke-linecap": "round",
        }),
        entry.label,
      ),
    );
  }

  const combined = timestamps.map((_, i) =>
    series.reduce((sum, entry) => sum + entry.values[i], 0),
  );
  const total = combined.reduce((sum, value) => sum + value, 0);
  const peak = combined.reduce((best, value, i) => (value > combined[best] ? i : best), 0);

  const chartContainer = el("div", "time-series-container");
  chartContainer.append(
    svg,
    summaryPanel("time-series-summary", [
      ["Total", formatNumber(total)],
      ["Average", formatNumber(Math.round(total / timestamps.length))],
      ["Peak", `${formatNumber(combined[peak])} on ${formatDate(timestamps[peak])}`],
      ["Data Points", `${formatNumber(timestamps.length)} (${options.interval})`],
    ]),
  );
  if (series.length > 1) {
    chartContainer.appendChild(
      renderLegend(
        "line-legend",
        series.map((entry, i) => ({
          color: entry.color,
          label: entry.label,
          strong: formatNumber(totals[i]),
          detail: `(${formatPercent(share(totals[i], total))})`,
        })),
      ),
    );
  }
  container.replaceChildren(chartContainer);
}

// ---------------------------------------------------------------------------
// Sections

function renderOverview(win) {
  const pct = (value) => formatPercent(share(value, win.total));
  setText("stat-total", formatNumber(win.total));
  setText("stat-lz-verifiers", pct(win.tiers.lzVerifiers));
  setText("stat-lz-any", pct(win.tiers.lzVerifiers + win.tiers.lzParams));
  setText("stat-all-default", pct(win.flags.allDefault));
  setText("stat-default-lib", pct(win.flags.defaultLibrary));
  setText("stat-tracked", pct(win.flags.tracked));
  setText("stat-dvn-combos", formatNumber(win.dvnSets.distinctContractSets));
  setText(
    "stat-dvn-combos-label",
    `Per chain • ${formatNumber(win.dvnSets.distinct)} by operator name`,
  );
  setText(
    "stat-dvn-combos-note",
    `Unique validation setups (required DVNs plus any optional quorum). Every chain runs its own DVN contracts, deployed, keyed and administered separately, so the same operators on two chains count as two sets. Merged by operator name there are ${formatNumber(win.dvnSets.distinct)}: fewer parties to trust, but not fewer things that can break. ${formatNumber(win.dvnSets.unnamedAddresses)} DVN addresses have no public name`,
  );
  setText("stat-indexed-chains", formatNumber(stats.coverage.indexedChainCount));
  setText("stat-source-eids", formatNumber(win.sources.length));

  setText(
    "stats-subtitle",
    `${formatNumber(win.total)} packets • ${formatNumber(win.dvnSets.distinctContractSets)} distinct DVN sets • ${stats.coverage.indexedChainCount} indexed chains`,
  );
  setText("computed-at", new Date(stats.computedAt).toLocaleString());
  setText("time-range", `${formatDate(win.fromDay * DAY)} → ${formatDate(stats.dataThrough)}`);
}

function renderVerificationControl(win) {
  const container = document.getElementById("verification-control-chart");
  const rows = TIERS.filter((tier) => win.tiers[tier.key] > 0 || tier.key !== "unknown").map(
    (tier) => {
      const value = win.tiers[tier.key];
      const percentage = share(value, win.total);
      const row = el("div", "tier-row");
      const text = row.appendChild(el("div", "tier-text"));
      text.append(el("div", "tier-label", tier.label), el("p", "tier-note", tier.note));
      const bar = row.appendChild(el("div", "tier-bar"));
      const fill = bar.appendChild(el("div", "tier-bar-fill"));
      fill.style.width = `${percentage}%`;
      fill.style.backgroundColor = tier.color;
      row.appendChild(
        valueCell("tier-value", formatPercent(percentage), `${formatNumber(value)} packets`),
      );
      return row;
    },
  );
  container.replaceChildren(...rows);

  const r = rollup(win);
  setText(
    "verification-control-subtitle",
    `Fraction of packets by who can change the settings that validated them • ${capitalize(r.interval)} history in the time view`,
  );
  renderStackedAreaChart(
    "verification-control-time-chart",
    r.timestamps,
    TIERS.map((tier) => ({
      label: tier.short,
      color: tier.color,
      values: r.sum(stats.series.daily.tiers[tier.key]),
    })),
    { interval: r.interval, valueMode: "percent" },
  );
}

function compareThresholdKeys(a, b) {
  const rank = (key) =>
    key === DVN_THRESHOLD_UNKNOWN ? Number.POSITIVE_INFINITY : Number.parseInt(key, 10);
  return rank(a) - rank(b) || a.localeCompare(b);
}

function thresholdLabel(key) {
  if (key === DVN_THRESHOLD_UNKNOWN) return "Unknown (custom or read library)";
  if (key.endsWith("+")) return `${key} DVNs`;
  return plural(Number(key), "DVN");
}

function renderDvnThreshold(win) {
  const keys = Object.keys(win.thresholds).sort(compareThresholdKeys);
  renderPieChart(
    "dvn-set-threshold-chart",
    keys.map((key) => ({ label: thresholdLabel(key), value: win.thresholds[key] })),
  );

  const r = rollup(win);
  setText(
    "dvn-set-threshold-subtitle",
    `Fraction of packets by effective DVN quorum: required DVNs plus the optional threshold (2 of 3 optional counts as 2) • ${capitalize(r.interval)} history in the time view excludes unknown`,
  );
  // Unknown stays in the snapshot but is left out of the time view.
  const seriesKeys = Object.keys(stats.series.daily.thresholds)
    .filter((key) => key !== DVN_THRESHOLD_UNKNOWN)
    .sort(compareThresholdKeys);
  renderStackedAreaChart(
    "dvn-set-threshold-time-chart",
    r.timestamps,
    seriesKeys.map((key, index) => ({
      label: thresholdLabel(key),
      color: COLORS[index % COLORS.length],
      values: r.sum(stats.series.daily.thresholds[key]),
    })),
    { interval: r.interval, valueMode: "percent" },
  );
}

function dvnBadge(label, className = "dvn-badge-small") {
  const badge = el("span", className, label.startsWith("0x") ? formatAddress(label) : label);
  badge.title = label;
  return badge;
}

function renderDvnSets(win) {
  const container = document.getElementById("dvn-combo-chart");
  const sets = win.dvnSets.top;
  if (!sets.length) return renderEmpty(container, "No DVN sets found");

  setText(
    "dvn-combo-subtitle",
    `Most common DVN sets by packet count (top ${sets.length} of ${formatNumber(win.dvnSets.distinct)} by operator name). Each row bundles separately deployed DVN contracts on every chain it is used on`,
  );
  const maxValue = sets[0].packets;
  container.replaceChildren(
    ...sets.map((set, index) => {
      const row = el("div", "combo-row");
      const dvnList = el("div", "combo-dvn-list");
      for (const label of set.required) dvnList.appendChild(dvnBadge(label));
      if (set.type !== "required") {
        const optional = dvnBadge(
          `+${set.optionalThreshold} of ${set.optional.length} optional`,
          "dvn-badge-small dvn-badge-optional",
        );
        optional.title = `${set.optionalThreshold} out of: ${set.optional.join(", ")}`;
        dvnList.appendChild(optional);
      }
      const spread = dvnList.appendChild(
        el(
          "div",
          "combo-note",
          `${plural(set.chains, "chain")} • ${plural(set.contractSets, "contract set")}`,
        ),
      );
      spread.title =
        "The same operator names are a different set of DVN contracts on every chain, each with its own signers, admins and upgrades";

      const barContainer = el("div", "combo-bar-container");
      const bar = barContainer.appendChild(el("div", "combo-bar-fill"));
      bar.style.width = `${(set.packets / maxValue) * 100}%`;
      row.append(
        el("div", "combo-rank", `#${index + 1}`),
        dvnList,
        barContainer,
        valueCell(
          "combo-value",
          formatNumber(set.packets),
          `(${formatPercent(share(set.packets, win.total))})`,
          "combo-percent",
        ),
      );
      row.addEventListener("mouseenter", () => {
        bar.style.opacity = "1";
        bar.style.transform = "scaleY(1.15)";
      });
      row.addEventListener("mouseleave", () => {
        bar.style.opacity = "0.85";
        bar.style.transform = "scaleY(1)";
      });
      return row;
    }),
  );
}

function renderPacketVolume(win) {
  const range = lineRange(win);
  setText("time-series-packets-subtitle", `${capitalize(range.interval)} packet count`);
  renderLineChart(
    "time-series-packets-chart",
    range.timestamps,
    [{ label: "Packets", color: "#1b9c85", values: range.values("packets") }],
    { interval: range.interval },
  );
}

function renderConfigChanges(win) {
  const range = lineRange(win);
  const { lz, owner } = win.configChanges;
  setText(
    "time-series-config-subtitle",
    `${capitalize(range.interval)} receive library and ULN config changes • ${formatNumber(lz)} by LayerZero (defaults), ${formatNumber(owner)} by OApp owners`,
  );
  renderLineChart(
    "time-series-config-chart",
    range.timestamps,
    [
      { label: "OApp owners", color: "#1b9c85", values: range.values("ownerChanges") },
      { label: "LayerZero defaults", color: "#ff1df5", values: range.values("lzChanges") },
    ],
    { interval: range.interval },
  );
}

function renderChainSection(win, { field, chartId, timeChartId, subtitleId, barClass, noun }) {
  const breakdown = win[field];
  renderBarChart(
    chartId,
    breakdown.slice(0, 20).map(([eid, packets]) => ({
      label: chainName(eid),
      value: packets,
      percentage: share(packets, win.total),
    })),
    { barClass },
  );

  const r = rollup(win);
  setText(
    subtitleId,
    `${capitalize(noun)} chain packet distribution • time view: top ${STACKED_CHAIN_LIMIT} plus Other in ${r.interval} buckets`,
  );
  const top = breakdown.slice(0, STACKED_CHAIN_LIMIT);
  const series = top.map(([eid], index) => ({
    label: chainName(eid),
    color: COLORS[(index + (field === "destinations" ? 3 : 0)) % COLORS.length],
    values: r.sum(stats.series.daily[field][eid]),
  }));
  const totals = r.sum(stats.series.daily.packets);
  series.push({
    label: "Other",
    color: "#0d0d0d",
    values: totals.map((total, i) => total - series.reduce((sum, s) => sum + s.values[i], 0)),
  });
  renderStackedAreaChart(timeChartId, r.timestamps, series, {
    interval: r.interval,
    valueMode: "percent",
  });
}

// ---------------------------------------------------------------------------
// Fragility of scale (window-independent, last 30 days)

const weakestColor = (weakest) =>
  weakest === null
    ? WEAKEST_COLORS.unknown
    : weakest <= 1
      ? WEAKEST_COLORS[1]
      : weakest === 2
        ? WEAKEST_COLORS[2]
        : WEAKEST_COLORS.strong;

const webName = (web) =>
  web.name || `${formatAddress(web.seed.slice(web.seed.indexOf("_") + 1))} on ${web.seedChain}`;

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function renderScaleStats(meshes) {
  const largest = meshes.top.reduce((best, web) => (web.routes > best.routes ? web : best));
  const cards = [
    [
      "OApp Webs",
      formatNumber(meshes.activeMeshes),
      `With packets in the last ${meshes.windowDays} days`,
    ],
    ["Receiving OApps", formatNumber(meshes.receivingOApps), "Contracts that ever got a packet"],
    [
      "Largest Web",
      `${formatNumber(largest.routes)} routes`,
      `${webName(largest)}, ${largest.chains} chains`,
    ],
  ];
  document.getElementById("scale-stats").replaceChildren(
    ...cards.map(([title, value, label]) => {
      const card = el("div", "stat-card stat-card--static");
      card.append(
        el("h2", null, title),
        el("div", "stat-value", value),
        el("div", "stat-label", label),
      );
      return card;
    }),
  );
}

function renderScaleScatter(meshes) {
  const container = document.getElementById("scale-scatter");
  const points = meshes.points;
  if (!points.length) return renderEmpty(container, "No active webs");

  const width = 1200;
  const height = 420;
  const padding = { top: 20, right: 40, bottom: 60, left: 80 };
  const maxChains = Math.max(...points.map(([chains]) => chains));
  const maxRoutes = Math.max(10, ...points.map(([, routes]) => routes));
  const maxPackets = Math.max(...points.map((p) => p[4]));
  const logMax = Math.log10(maxRoutes + 1);
  const scaleX = (chains) =>
    padding.left +
    ((chains - 1) / Math.max(1, maxChains - 1)) * (width - padding.left - padding.right);
  const scaleY = (routes) =>
    height -
    padding.bottom -
    (Math.log10(routes + 1) / logMax) * (height - padding.top - padding.bottom);

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, class: "scatter-svg" });
  const axis = (x1, y1, x2, y2) =>
    svgEl("line", { x1, y1, x2, y2, stroke: "#0d0d0d", "stroke-width": "3" });
  const label = (x, y, text, anchor = "middle") => {
    const node = svgEl("text", { x, y, "text-anchor": anchor, class: "axis-label" });
    node.textContent = text;
    return node;
  };

  for (let routes = 1; routes <= maxRoutes; routes *= 10) {
    const y = scaleY(routes);
    svg.appendChild(
      svgEl("line", {
        x1: padding.left,
        y1: y,
        x2: width - padding.right,
        y2: y,
        stroke: "#0d0d0d",
        "stroke-opacity": "0.1",
      }),
    );
    svg.appendChild(label(padding.left - 10, y + 4, formatNumber(routes), "end"));
  }
  svg.appendChild(label(padding.left - 10, scaleY(0) + 4, "0", "end"));

  const curve = [];
  for (let chains = 1; chains <= maxChains && chains * (chains - 1) <= maxRoutes; chains += 0.25) {
    curve.push(`${scaleX(chains)} ${scaleY(chains * (chains - 1))}`);
  }
  svg.appendChild(
    svgTitle(
      svgEl("path", {
        d: `M ${curve.join(" L ")}`,
        fill: "none",
        stroke: "#0d0d0d",
        "stroke-width": "2",
        "stroke-dasharray": "8,6",
      }),
      "N × (N − 1): every chain connected to every other",
    ),
  );

  // Busy webs last so they sit on top.
  for (const [chains, routes, dvnSets, weakest, packets] of [...points].sort(
    (a, b) => a[4] - b[4],
  )) {
    const dot = svgEl("circle", {
      cx: scaleX(chains),
      cy: scaleY(routes),
      r: 4 + 14 * Math.sqrt(packets / maxPackets),
      fill: weakestColor(weakest),
      "fill-opacity": "0.8",
      stroke: "#0d0d0d",
      "stroke-width": "1.5",
    });
    svgTitle(
      dot,
      `${chains} chains • ${formatNumber(routes)} open routes • ${plural(dvnSets, "DVN set")} • weakest route ${weakest === null ? "unknown" : plural(weakest, "DVN")} • ${formatNumber(packets)} packets (30d)`,
    );
    svg.appendChild(dot);
  }

  svg.appendChild(axis(padding.left, padding.top, padding.left, height - padding.bottom));
  svg.appendChild(
    axis(padding.left, height - padding.bottom, width - padding.right, height - padding.bottom),
  );
  const xStep = maxChains > 30 ? 10 : 5;
  for (let chains = 0; chains <= maxChains; chains += xStep) {
    if (chains >= 1) svg.appendChild(label(scaleX(chains), height - padding.bottom + 25, chains));
  }
  svg.appendChild(
    label(padding.left + (width - padding.left - padding.right) / 2, height - 12, "chains in web"),
  );

  const legend = renderLegend(
    "scatter-legend",
    [
      [WEAKEST_COLORS[1], "Weakest route: 1 DVN"],
      [WEAKEST_COLORS[2], "Weakest route: 2 DVNs"],
      [WEAKEST_COLORS.strong, "Weakest route: 3+ DVNs"],
    ].map(([color, text]) => ({ color, label: text })),
  );
  const note = el(
    "p",
    "chart-footnote",
    "Dot size: packets in the last 30 days. Y axis: open inbound routes (log scale).",
  );
  container.replaceChildren(svg, legend, note);
}

function renderTable(containerId, headers, rows) {
  const table = el("table", "stats-table");
  const headRow = table.appendChild(el("thead")).appendChild(el("tr"));
  for (const [text, className] of headers) headRow.appendChild(el("th", className, text));
  const body = table.appendChild(el("tbody"));
  for (const cells of rows) {
    const row = body.appendChild(el("tr"));
    cells.forEach((cell, i) => {
      const td = row.appendChild(el("td", headers[i][1]));
      if (cell instanceof Node) td.appendChild(cell);
      else td.textContent = cell;
    });
  }
  document.getElementById(containerId).replaceChildren(table);
}

function renderScaleBuckets(meshes) {
  const buckets = [
    [1, 2, "1–2"],
    [3, 5, "3–5"],
    [6, 10, "6–10"],
    [11, 20, "11–20"],
    [21, Number.POSITIVE_INFINITY, "21+"],
  ];
  const num = "num";
  renderTable(
    "scale-buckets",
    [
      ["Chains in web", null],
      ["Webs", num],
      ["Median open routes", num],
      ["Median DVN sets", num],
      ["Webs with a 1-DVN route", num],
      ["Packets (30d)", num],
    ],
    buckets
      .map(([lo, hi, label]) => {
        const group = meshes.points.filter(([chains]) => chains >= lo && chains <= hi);
        if (!group.length) return null;
        const singleDvn = group.filter(
          ([, , , weakest]) => weakest !== null && weakest <= 1,
        ).length;
        return [
          label,
          formatNumber(group.length),
          formatNumber(median(group.map(([, routes]) => routes))),
          formatNumber(median(group.map(([, , dvnSets]) => dvnSets))),
          `${formatPercent(share(singleDvn, group.length))}`,
          formatNumber(group.reduce((sum, point) => sum + point[4], 0)),
        ];
      })
      .filter(Boolean),
  );
}

function renderScaleTop(meshes) {
  const num = "num";
  renderTable(
    "scale-top",
    [
      ["#", num],
      ["Web", null],
      ["Chains", num],
      ["Routes", num],
      ["DVN sets", num],
      ["Operators", num],
      ["DVN contracts", num],
      ["Weakest route", null],
      ["LZ picks verifiers", num],
      ["Packets (30d)", num],
      ["", null],
    ],
    meshes.top.map((web, index) => {
      const link = el("a", "table-link", "crawl →");
      link.href = `./explorer.html?view=web-of-security&seedOAppId=${encodeURIComponent(web.seed)}#results`;
      const weakest =
        web.weakest === null
          ? "unknown"
          : `${plural(web.weakest, "DVN")} (${formatNumber(web.weakestRoutes)} of ${formatNumber(web.trackedRoutes)})`;
      const swatch = el("span", "weakest-swatch");
      swatch.style.backgroundColor = weakestColor(web.weakest);
      const weakestCell = el("span", "weakest-cell");
      weakestCell.append(swatch, weakest);
      return [
        String(index + 1),
        webName(web),
        formatNumber(web.chains),
        formatNumber(web.routes),
        formatNumber(web.dvnSets),
        formatNumber(web.operators),
        formatNumber(web.dvnContracts),
        weakestCell,
        `${formatNumber(web.tiers.lzVerifiers)} of ${formatNumber(web.routes)}`,
        formatNumber(web.packets30d),
        link,
      ];
    }),
  );
}

function renderScale() {
  const { meshes } = stats;
  if (!meshes?.top?.length) {
    renderEmpty(document.getElementById("scale-scatter"), "No web data available");
    return;
  }
  renderScaleStats(meshes);
  renderScaleScatter(meshes);
  renderScaleBuckets(meshes);
  renderScaleTop(meshes);
}

// ---------------------------------------------------------------------------
// Page lifecycle

function showError(message) {
  document.getElementById("loading-state").classList.add("hidden");
  document.getElementById("stats-content").classList.add("hidden");
  document.getElementById("error-state").classList.remove("hidden");
  setText("error-message", message);
}

function showContent() {
  document.getElementById("loading-state").classList.add("hidden");
  document.getElementById("error-state").classList.add("hidden");
  document.getElementById("stats-content").classList.remove("hidden");
}

function renderWindowButtons() {
  document.getElementById("dataset-selector")?.remove();
  const names = WINDOW_NAMES.filter((name) => stats.windows[name]);
  if (names.length <= 1) return;

  const container = el("div", "dataset-selector");
  container.id = "dataset-selector";
  container.appendChild(el("span", "dataset-label", "Time Range:"));
  const buttons = container.appendChild(el("div", "dataset-buttons"));
  for (const name of names) {
    const button = buttons.appendChild(el("button", "dataset-button", windowLabel(name)));
    button.type = "button";
    button.dataset.name = name;
    button.classList.toggle("active", name === currentWindow);
    button.addEventListener("click", () => {
      if (name === currentWindow) return;
      updateUrl((url) => {
        url.searchParams.set(DATASET_PARAM, name);
        url.searchParams.delete(LEGACY_DATASET_PARAM);
      });
      renderWindow(name);
    });
  }
  document.querySelector(".stats-header").appendChild(container);
}

function renderWindow(name) {
  currentWindow = name;
  const win = stats.windows[name];
  renderWindowButtons();
  renderOverview(win);
  renderVerificationControl(win);
  renderDvnThreshold(win);
  renderDvnSets(win);
  renderPacketVolume(win);
  renderConfigChanges(win);
  renderChainSection(win, {
    field: "destinations",
    chartId: "chain-chart",
    timeChartId: "chain-time-chart",
    subtitleId: "chain-chart-subtitle",
    barClass: "bar-fill--accent",
    noun: "destination",
  });
  renderChainSection(win, {
    field: "sources",
    chartId: "src-chain-chart",
    timeChartId: "src-chain-time-chart",
    subtitleId: "src-chain-chart-subtitle",
    barClass: "bar-fill--magenta",
    noun: "source",
  });
  syncChartViews();
}

async function loadStats() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load statistics: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported stats schema v${data.schemaVersion}; regenerate with pnpm stats.`);
  }
  if (!data.windows?.all?.total) {
    throw new Error("No packet data available. Run the precomputation script first.");
  }
  return data;
}

const TOOLTIP_MARGIN = 12;
const TOOLTIP_GAP = 10; // matches the 10px in .stat-tooltip { bottom: calc(100% + 10px) }

/**
 * Keeps a card's tooltip inside the viewport: shift sideways, flip below if no room above.
 * Works from the card's box and the tooltip's size rather than the tooltip's own rect,
 * whose transform may be mid-transition.
 */
function placeTooltip(card) {
  const tooltip = card.querySelector(".stat-tooltip");
  if (!tooltip) return;

  const cardRect = card.getBoundingClientRect();
  const width = tooltip.offsetWidth;
  const left = cardRect.left + cardRect.width / 2 - width / 2;
  const maxRight = document.documentElement.clientWidth - TOOLTIP_MARGIN;
  const shift =
    left < TOOLTIP_MARGIN
      ? TOOLTIP_MARGIN - left
      : left + width > maxRight
        ? maxRight - (left + width)
        : 0;
  tooltip.style.setProperty("--tooltip-shift", `${shift}px`);

  const top = cardRect.top - TOOLTIP_GAP - tooltip.offsetHeight;
  tooltip.classList.toggle("stat-tooltip--below", top < TOOLTIP_MARGIN);
}

// Hover tooltips on desktop, tap-to-toggle on touch devices.
function initTooltips() {
  const statCards = document.querySelectorAll(".stat-card");
  const isMobile = () =>
    window.matchMedia("(max-width: 768px)").matches || "ontouchstart" in window;

  // Place every tooltip up front too: hidden tooltips still count toward page overflow,
  // so an unplaced one on an edge card would make the page scroll sideways.
  const placeAll = () => statCards.forEach(placeTooltip);
  placeAll();
  let frame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(placeAll);
  });

  statCards.forEach((card) => {
    card.addEventListener("mouseenter", () => placeTooltip(card));
    card.addEventListener("click", (event) => {
      if (!isMobile()) return;
      event.stopPropagation();
      const wasActive = card.classList.contains("tooltip-active");
      statCards.forEach((other) => other.classList.remove("tooltip-active"));
      if (!wasActive) placeTooltip(card);
      card.classList.toggle("tooltip-active", !wasActive);
    });
  });
  document.addEventListener("click", (event) => {
    if (isMobile() && !event.target.closest(".stat-card")) {
      statCards.forEach((card) => card.classList.remove("tooltip-active"));
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  initializeStatsAnchors();
  applyChartViewsFromUrl();
  initChartToggles();

  try {
    stats = await loadStats();
    renderWindow(getRequestedWindow() || DEFAULT_WINDOW);
    renderScale();
    showContent();
    scrollToCurrentHash();
  } catch (error) {
    console.error("Failed to load statistics:", error);
    showError(error.message);
    return;
  }
  initTooltips();
});

window.addEventListener("hashchange", scrollToCurrentHash);

window.addEventListener("popstate", () => {
  if (!stats) return;
  applyChartViewsFromUrl();
  const requested = getRequestedWindow() || DEFAULT_WINDOW;
  if (requested !== currentWindow) renderWindow(requested);
  else syncChartViews();
  scrollToCurrentHash();
});
