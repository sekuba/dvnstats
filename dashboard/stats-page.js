/**
 * Stats Page - Loads precomputed statistics and renders interactive diagrams
 */

const DATA_PATH = './data/packet-stats.json';

// State
let statsData = null;
let chainMetadata = null;

// Load chain metadata for EID -> name mapping
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

// Render DVN count buckets
function renderDvnCountChart(stats) {
  const data = stats.dvnCountBuckets.map(bucket => ({
    label: `${bucket.requiredDvnCount} DVN${bucket.requiredDvnCount === 1 ? '' : 's'}`,
    value: bucket.packetCount,
    percentage: bucket.percentage,
  }));

  renderBarChart('dvn-count-chart', data, { barClass: 'bar-fill--success' });
}

// Render optional DVN count buckets
function renderOptionalDvnCountChart(stats) {
  const data = stats.optionalDvnCountBuckets.map(bucket => ({
    label: `${bucket.optionalDvnCount} DVN${bucket.optionalDvnCount === 1 ? '' : 's'}`,
    value: bucket.packetCount,
    percentage: bucket.percentage,
  }));

  renderBarChart('optional-dvn-count-chart', data, { barClass: 'bar-fill--info' });
}

// Render top DVN combinations
function renderDvnComboChart(stats) {
  const container = document.getElementById('dvn-combo-chart');
  container.innerHTML = '';

  const topCombos = stats.dvnCombinations.slice(0, 15);

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

    combo.dvns.forEach(dvn => {
      const badge = document.createElement('span');
      badge.className = 'dvn-badge-small';
      badge.textContent = formatAddress(dvn);
      badge.title = dvn;
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
