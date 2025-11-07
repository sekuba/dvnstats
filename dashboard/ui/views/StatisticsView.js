/**
 * StatisticsView - Renders pre-computed packet statistics with brutalist design
 */

export class StatisticsView {
  /**
   * Render statistics dashboard
   * @param {HTMLElement} container - Container element
   * @param {Object} statistics - Computed statistics object
   * @param {Object} meta - Metadata including DVN labels
   * @param {Object} aliasStore - Alias store for DVN name resolution
   * @param {Function} resolveDvnLabels - Function to resolve DVN labels
   */
  static render(container, statistics, meta, aliasStore, resolveDvnLabels) {
    container.innerHTML = "";
    container.classList.remove("empty");

    // Overview Panel
    const overviewPanel = this.createOverviewPanel(statistics, meta);
    container.appendChild(overviewPanel);

    // DVN Count Buckets
    const dvnBucketsPanel = this.createDvnCountBucketsPanel(statistics);
    container.appendChild(dvnBucketsPanel);

    // Optional DVN Buckets
    if (statistics.optionalDvnCountBuckets.length > 0) {
      const optionalBucketsPanel = this.createOptionalDvnBucketsPanel(statistics);
      container.appendChild(optionalBucketsPanel);
    }

    // Top DVN Combinations
    const dvnCombosPanel = this.createDvnCombinationsPanel(
      statistics,
      meta,
      aliasStore,
      resolveDvnLabels,
    );
    container.appendChild(dvnCombosPanel);
  }

  static createOverviewPanel(statistics, meta) {
    const panel = document.createElement("div");
    panel.className = "statistics-overview";

    const html = `
      <div class="summary-panels">
        <div class="summary-panel-row">
          <div class="summary-panel">
            <h3>Dataset Overview</h3>
            <dl>
              <dt>Total Packets</dt>
              <dd>${statistics.total.toLocaleString()}</dd>
              <dt>Time Range</dt>
              <dd>${meta.timeRangeLabel || "All time"}</dd>
              ${
                statistics.timeRange.earliest && statistics.timeRange.latest
                  ? `
              <dt>Period</dt>
              <dd>${this.formatTimestamp(statistics.timeRange.earliest)} → ${this.formatTimestamp(statistics.timeRange.latest)}</dd>
              <dt>Days Covered</dt>
              <dd>${Math.floor((statistics.timeRange.latest - statistics.timeRange.earliest) / 86400)}</dd>
              `
                  : ""
              }
            </dl>
          </div>

          <div class="summary-panel">
            <h3>Default Configuration Usage</h3>
            <dl>
              <dt>All-Default</dt>
              <dd class="metric-highlight">${statistics.allDefaultPercentage.toFixed(2)}%</dd>
              <dt>Default Library</dt>
              <dd>${statistics.defaultLibPercentage.toFixed(2)}%</dd>
              <dt>Default Config</dt>
              <dd>${statistics.defaultConfigPercentage.toFixed(2)}%</dd>
            </dl>
          </div>

          <div class="summary-panel">
            <h3>Security Insights</h3>
            <dl>
              <dt>Tracked Configs</dt>
              <dd>${statistics.trackedPercentage.toFixed(2)}%</dd>
              <dt>Unique DVN Combos</dt>
              <dd>${statistics.dvnCombinations.length}</dd>
              <dt>DVN Count Range</dt>
              <dd>${this.getDvnCountRange(statistics.dvnCountBuckets)}</dd>
            </dl>
          </div>
        </div>
      </div>
    `;

    panel.innerHTML = html;
    return panel;
  }

  static createDvnCountBucketsPanel(statistics) {
    const panel = document.createElement("div");
    panel.className = "statistics-panel";

    const maxCount = Math.max(...statistics.dvnCountBuckets.map((b) => b.packetCount));

    const bucketRows = statistics.dvnCountBuckets
      .map((bucket) => {
        const barWidth = maxCount > 0 ? (bucket.packetCount / maxCount) * 100 : 0;
        return `
        <tr>
          <td class="dvn-count-cell">${bucket.requiredDvnCount}</td>
          <td class="metric-cell">${bucket.packetCount.toLocaleString()}</td>
          <td class="percentage-cell">${bucket.percentage.toFixed(2)}%</td>
          <td class="bar-cell">
            <div class="bar-container">
              <div class="bar-fill" style="width: ${barWidth}%"></div>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");

    panel.innerHTML = `
      <h3 class="panel-title">Packets by Required DVN Count</h3>
      <table class="statistics-table">
        <thead>
          <tr>
            <th>Required DVNs</th>
            <th>Packets</th>
            <th>% of Total</th>
            <th>Distribution</th>
          </tr>
        </thead>
        <tbody>
          ${bucketRows}
        </tbody>
      </table>
    `;

    return panel;
  }

  static createOptionalDvnBucketsPanel(statistics) {
    const panel = document.createElement("div");
    panel.className = "statistics-panel";

    const maxCount = Math.max(...statistics.optionalDvnCountBuckets.map((b) => b.packetCount));

    const bucketRows = statistics.optionalDvnCountBuckets
      .map((bucket) => {
        const barWidth = maxCount > 0 ? (bucket.packetCount / maxCount) * 100 : 0;
        return `
        <tr>
          <td class="dvn-count-cell">${bucket.optionalDvnCount}</td>
          <td class="metric-cell">${bucket.packetCount.toLocaleString()}</td>
          <td class="percentage-cell">${bucket.percentage.toFixed(2)}%</td>
          <td class="bar-cell">
            <div class="bar-container">
              <div class="bar-fill bar-fill--optional" style="width: ${barWidth}%"></div>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");

    panel.innerHTML = `
      <h3 class="panel-title">Packets by Optional DVN Count</h3>
      <table class="statistics-table">
        <thead>
          <tr>
            <th>Optional DVNs</th>
            <th>Packets</th>
            <th>% of Total</th>
            <th>Distribution</th>
          </tr>
        </thead>
        <tbody>
          ${bucketRows}
        </tbody>
      </table>
    `;

    return panel;
  }

  static createDvnCombinationsPanel(statistics, meta, aliasStore, resolveDvnLabels) {
    const panel = document.createElement("div");
    panel.className = "statistics-panel";

    const topCombos = statistics.dvnCombinations.slice(0, 20); // Show top 20
    const maxCount = topCombos.length > 0 ? topCombos[0].count : 0;

    const comboRows = topCombos
      .map((combo, index) => {
        const barWidth = maxCount > 0 ? (combo.count / maxCount) * 100 : 0;
        const dvnList = combo.dvns
          .map((dvn) => {
            const short = this.formatAddress(dvn);
            return `<span class="dvn-badge" title="${dvn}">${short}</span>`;
          })
          .join(" ");

        return `
        <tr>
          <td class="rank-cell">#${index + 1}</td>
          <td class="dvn-list-cell">${dvnList}</td>
          <td class="dvn-count-cell">${combo.dvns.length}</td>
          <td class="metric-cell">${combo.count.toLocaleString()}</td>
          <td class="percentage-cell">${combo.percentage.toFixed(2)}%</td>
          <td class="bar-cell">
            <div class="bar-container">
              <div class="bar-fill bar-fill--combo" style="width: ${barWidth}%"></div>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");

    const totalShown = topCombos.reduce((sum, combo) => sum + combo.count, 0);
    const totalShownPct =
      statistics.total > 0 ? ((totalShown / statistics.total) * 100).toFixed(2) : 0;

    panel.innerHTML = `
      <h3 class="panel-title">Top Required DVN Combinations (by packet count)</h3>
      <p class="panel-subtitle">
        Showing top ${topCombos.length} of ${statistics.dvnCombinations.length} unique combinations
        (${totalShownPct}% of all packets)
      </p>
      <table class="statistics-table statistics-table--wide">
        <thead>
          <tr>
            <th>Rank</th>
            <th>DVN Addresses</th>
            <th># DVNs</th>
            <th>Packets</th>
            <th>% of Total</th>
            <th>Distribution</th>
          </tr>
        </thead>
        <tbody>
          ${comboRows}
        </tbody>
      </table>
    `;

    return panel;
  }

  static formatAddress(address) {
    if (!address) return "—";
    if (address.length < 10) return address;
    return `${address.substring(0, 6)}…${address.substring(address.length - 4)}`;
  }

  static formatTimestamp(timestamp) {
    if (!timestamp) return "—";
    const date = new Date(Number(timestamp) * 1000);
    return date.toISOString().split("T")[0]; // YYYY-MM-DD
  }

  static getDvnCountRange(buckets) {
    if (buckets.length === 0) return "—";
    const counts = buckets.map((b) => b.requiredDvnCount);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    return min === max ? `${min}` : `${min}–${max}`;
  }
}
