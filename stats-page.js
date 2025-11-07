/**
 * Stats Page - Loads precomputed statistics and renders interactive diagrams
 */

const DATA_PATH = './data/packet-stats.json';

// State
let statsData = null;
let chainMetadata = null;
let dvnResolver = null;

// Simple ChainDirectory for DVN resolution
class DVNResolver {
  constructor() {
    this.dvnDirectory = new Map();
  }

  hydrate(data) {
    if (!data || typeof data !== 'object') return;

    Object.entries(data).forEach(([key, chain]) => {
      if (!chain || typeof chain !== 'object') return;

      const deployments = Array.isArray(chain.deployments) ? chain.deployments : [];

      deployments.forEach((dep) => {
        if (dep?.eid === undefined || dep.eid === null) return;

        const eid = String(dep.eid);

        if (chain.dvns && typeof chain.dvns === 'object') {
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

// Load chain metadata for EID -> name mapping and DVN resolution
async function loadChainMetadata() {
  try {
    const response = await fetch('./layerzero.json');
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.warn('Could not load chain metadata:', error);
    return null;
  }
}

function getChainName(eid, metadata) {
  if (!metadata) return `EID ${eid}`;

  // layerzero.json is an object with chain keys as properties
  // Each chain can have multiple EIDs in deployments array
  for (const [chainKey, chainData] of Object.entries(metadata)) {
    if (!chainData.deployments) continue;

    for (const deployment of chainData.deployments) {
      if (String(deployment.eid) === String(eid)) {
        // Return the chain name from chainDetails, or fallback to chainKey
        return chainData.chainDetails?.name ||
               chainData.chainDetails?.shortName ||
               chainKey.replace('-mainnet', '').replace('-', ' ');
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
  if (!timestamp) return '—';
  const date = new Date(Number(timestamp) * 1000);
  return date.toISOString().split('T')[0];
}

function formatAddress(address) {
  if (!address || address.length < 10) return address;
  return `${address.substring(0, 6)}…${address.substring(address.length - 4)}`;
}

// Render overview cards
function renderOverview(stats) {
  document.getElementById('stat-total').textContent = formatNumber(stats.total);
  document.getElementById('stat-all-default').textContent = formatPercent(stats.allDefaultPercentage);
  document.getElementById('stat-default-lib').textContent = formatPercent(stats.defaultLibPercentage);
  document.getElementById('stat-default-config').textContent = formatPercent(stats.defaultConfigPercentage);
  document.getElementById('stat-tracked').textContent = formatPercent(stats.trackedPercentage);
  document.getElementById('stat-dvn-combos').textContent = formatNumber(stats.dvnCombinations.length);

  // Update subtitle and footer
  const subtitle = `${formatNumber(stats.total)} packets • ${stats.dvnCombinations.length} unique DVN combinations`;
  document.getElementById('stats-subtitle').textContent = subtitle;

  document.getElementById('computed-at').textContent = new Date(stats.computedAt).toLocaleString();

  const timeRange = `${formatDate(stats.timeRange.earliest)} → ${formatDate(stats.timeRange.latest)}`;
  document.getElementById('time-range').textContent = timeRange;
}

// Render pie chart
function renderPieChart(containerId, data, options = {}) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  if (!data || data.length === 0) {
    container.innerHTML = '<p class="chart-empty">No data available</p>';
    return;
  }

  const total = data.reduce((sum, item) => sum + item.value, 0);

  // Create pie chart
  const pieChart = document.createElement('div');
  pieChart.className = 'pie-chart-container';

  // SVG for pie
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('class', 'pie-svg');

  let currentAngle = 0;
  const colors = [
    '#1b9c85', // green
    '#78bdff', // blue
    '#ff1df5', // magenta
    '#f2f200', // yellow
    '#ff6b6b', // red
    '#4ecdc4', // teal
    '#95e1d3', // mint
    '#f38181', // salmon
    '#aa96da', // purple
    '#fcbad3', // pink
  ];

  data.forEach((item, index) => {
    const percentage = (item.value / total) * 100;
    const angle = (item.value / total) * 360;

    if (percentage < 0.5) return; // Skip tiny slices

    const slice = document.createElementNS('http://www.w3.org/2000/svg', 'path');
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
      `Z`
    ].join(' ');

    slice.setAttribute('d', pathData);
    slice.setAttribute('fill', colors[index % colors.length]);
    slice.setAttribute('stroke', '#0d0d0d');
    slice.setAttribute('stroke-width', '2');
    slice.setAttribute('class', 'pie-slice');

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${item.label}: ${formatNumber(item.value)} (${formatPercent(percentage)})`;
    slice.appendChild(title);

    svg.appendChild(slice);
    currentAngle += angle;
  });

  pieChart.appendChild(svg);

  // Legend
  const legend = document.createElement('div');
  legend.className = 'pie-legend';

  data.forEach((item, index) => {
    const percentage = (item.value / total) * 100;
    if (percentage < 0.5) return; // Skip tiny slices

    const legendItem = document.createElement('div');
    legendItem.className = 'pie-legend-item';

    const colorBox = document.createElement('div');
    colorBox.className = 'pie-legend-color';
    colorBox.style.backgroundColor = colors[index % colors.length];

    const label = document.createElement('div');
    label.className = 'pie-legend-label';
    label.textContent = item.label;

    const value = document.createElement('div');
    value.className = 'pie-legend-value';
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
  container.innerHTML = '';

  if (!data || data.length === 0) {
    container.innerHTML = '<p class="chart-empty">No data available</p>';
    return;
  }

  const maxValue = Math.max(...data.map(d => d.value));

  data.forEach(item => {
    const row = document.createElement('div');
    row.className = 'bar-row';

    const label = document.createElement('div');
    label.className = 'bar-label';
    label.textContent = item.label;

    const barContainer = document.createElement('div');
    barContainer.className = 'bar-container-horizontal';

    const bar = document.createElement('div');
    bar.className = `bar-fill-horizontal ${options.barClass || ''}`;
    const percentage = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
    bar.style.width = `${percentage}%`;

    const valueLabel = document.createElement('div');
    valueLabel.className = 'bar-value';
    valueLabel.innerHTML = `<strong>${formatNumber(item.value)}</strong> <span class="bar-percent">(${formatPercent(item.percentage)})</span>`;

    barContainer.appendChild(bar);
    row.appendChild(label);
    row.appendChild(barContainer);
    row.appendChild(valueLabel);

    // Interactive hover
    row.addEventListener('mouseenter', () => {
      bar.style.transform = 'scaleY(1.2)';
    });
    row.addEventListener('mouseleave', () => {
      bar.style.transform = 'scaleY(1)';
    });

    container.appendChild(row);
  });
}

// Render DVN count pie chart (with "Other" bucket for 0 and >4)
function renderDvnCountChart(stats) {
  const buckets = new Map();

  stats.dvnCountBuckets.forEach(bucket => {
    const count = bucket.requiredDvnCount;
    if (count === 0 || count > 4) {
      buckets.set('Other (0 or >4 DVNs)',
        (buckets.get('Other (0 or >4 DVNs)') || 0) + bucket.packetCount);
    } else {
      buckets.set(`${count} DVN${count === 1 ? '' : 's'}`, bucket.packetCount);
    }
  });

  const data = Array.from(buckets.entries())
    .map(([label, value]) => ({
      label,
      value,
      percentage: (value / stats.total) * 100
    }))
    .sort((a, b) => {
      // Sort: 1, 2, 3, 4, Other
      if (a.label.startsWith('Other')) return 1;
      if (b.label.startsWith('Other')) return -1;
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });

  renderPieChart('dvn-count-chart', data);
}

// Render optional DVN count pie chart (exclude 0)
function renderOptionalDvnCountChart(stats) {
  const data = stats.optionalDvnCountBuckets
    .filter(bucket => bucket.optionalDvnCount > 0) // Exclude 0
    .map(bucket => ({
      label: `${bucket.optionalDvnCount} DVN${bucket.optionalDvnCount === 1 ? '' : 's'}`,
      value: bucket.packetCount,
      percentage: bucket.percentage,
    }));

  renderPieChart('optional-dvn-count-chart', data);
}

// Render top DVN combinations with resolved names
function renderDvnComboChart(stats) {
  const container = document.getElementById('dvn-combo-chart');
  container.innerHTML = '';

  const topCombos = stats.dvnCombinations.slice(0, 20); // Top 20

  if (topCombos.length === 0) {
    container.innerHTML = '<p class="chart-empty">No DVN combinations found</p>';
    return;
  }

  const maxValue = topCombos[0]?.count || 0;

  topCombos.forEach((combo, index) => {
    const row = document.createElement('div');
    row.className = 'combo-row';

    const rank = document.createElement('div');
    rank.className = 'combo-rank';
    rank.textContent = `#${index + 1}`;

    const dvnList = document.createElement('div');
    dvnList.className = 'combo-dvn-list';

    // Resolve DVN names
    combo.dvns.forEach(dvn => {
      const badge = document.createElement('span');
      badge.className = 'dvn-badge-small';

      // Try to resolve DVN name
      const resolvedName = dvnResolver ? dvnResolver.resolveDvnName(dvn) : dvn;
      const isResolved = resolvedName !== dvn && !resolvedName.startsWith('0x');

      badge.textContent = isResolved ? resolvedName : formatAddress(dvn);
      badge.title = `${isResolved ? resolvedName + ' - ' : ''}${dvn}`;
      dvnList.appendChild(badge);
    });

    const barContainer = document.createElement('div');
    barContainer.className = 'combo-bar-container';

    const bar = document.createElement('div');
    bar.className = 'combo-bar-fill';
    const percentage = maxValue > 0 ? (combo.count / maxValue) * 100 : 0;
    bar.style.width = `${percentage}%`;

    const value = document.createElement('div');
    value.className = 'combo-value';
    value.innerHTML = `<strong>${formatNumber(combo.count)}</strong> <span class="combo-percent">(${formatPercent(combo.percentage)})</span>`;

    barContainer.appendChild(bar);
    row.appendChild(rank);
    row.appendChild(dvnList);
    row.appendChild(barContainer);
    row.appendChild(value);

    // Interactive hover
    row.addEventListener('mouseenter', () => {
      bar.style.opacity = '1';
      bar.style.transform = 'scaleY(1.15)';
    });
    row.addEventListener('mouseleave', () => {
      bar.style.opacity = '0.85';
      bar.style.transform = 'scaleY(1)';
    });

    container.appendChild(row);
  });
}

// Render chain breakdown
function renderChainChart(stats) {
  const data = stats.chainBreakdown.slice(0, 20).map(item => ({
    label: getChainName(item.localEid, chainMetadata),
    value: item.packetCount,
    percentage: item.percentage,
  }));

  renderBarChart('chain-chart', data, { barClass: 'bar-fill--accent' });
}

// Render source chain breakdown
function renderSrcChainChart(stats) {
  const data = stats.srcChainBreakdown.slice(0, 20).map(item => ({
    label: getChainName(item.srcEid, chainMetadata),
    value: item.packetCount,
    percentage: item.percentage,
  }));

  renderBarChart('src-chain-chart', data, { barClass: 'bar-fill--magenta' });
}

// Show error
function showError(message) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('stats-content').classList.add('hidden');
  const errorState = document.getElementById('error-state');
  errorState.classList.remove('hidden');
  document.getElementById('error-message').textContent = message;
}

// Show content
function showContent() {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('stats-content').classList.remove('hidden');
}

// Load and render statistics
async function loadAndRender() {
  try {
    // Load chain metadata first
    chainMetadata = await loadChainMetadata();

    // Initialize DVN resolver
    if (chainMetadata) {
      dvnResolver = new DVNResolver();
      dvnResolver.hydrate(chainMetadata);
    }

    // Load precomputed stats
    const response = await fetch(DATA_PATH);
    if (!response.ok) {
      throw new Error(`Failed to load statistics: ${response.status} ${response.statusText}`);
    }

    statsData = await response.json();

    if (!statsData || statsData.total === 0) {
      throw new Error('No packet data available. Run the precomputation script first.');
    }

    // Render all sections
    renderOverview(statsData);
    renderDvnCountChart(statsData);
    renderOptionalDvnCountChart(statsData);
    renderDvnComboChart(statsData);
    renderChainChart(statsData);
    renderSrcChainChart(statsData);

    showContent();
  } catch (error) {
    console.error('Failed to load statistics:', error);
    showError(error.message);
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadAndRender();
});
