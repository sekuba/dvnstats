# LayerZero Packet Statistics Dashboard

A statistics landing page showing precomputed insights from LayerZero packet delivery data.

## Features

- **Precomputed Statistics**: Fast, interactive charts powered by server-side batch processing
- **Multiple Time Ranges**: Switch between 30d, 90d, 1y, and all-time views
- **Comprehensive Metrics**:
  - Default configuration usage patterns
  - DVN (Decentralized Verifier Network) combinations
  - Required and optional DVN distributions
  - Cross-chain packet flows
  - Time-series analysis (hourly packets and config changes)
- **Brutalist Design**: Bold, geometric interface with high contrast

## Quick Start

### 1. Generate Statistics

Generate all supported time ranges at once:

```bash
npm run stats:precompute -- --batch
```

Or generate a specific time range:

```bash
npm run stats:precompute -- --lookback=30d
```

### 2. View the Dashboard

Open `dashboard/index.html` in your browser. The stats page will automatically discover and load available datasets.

## Usage

### Precomputation Script

Located at: `scripts/precomputePacketStats.js`

**Generate all time ranges (recommended):**
```bash
npm run stats:precompute -- --batch
```

This generates:
- `data/packet-stats-30d.json` (last 30 days)
- `data/packet-stats-90d.json` (last 90 days)
- `data/packet-stats-1y.json` (last 1 year)
- `data/packet-stats-all.json` (all time)

**Generate specific time range:**
```bash
npm run stats:precompute -- --lookback=30d   # Last 30 days
npm run stats:precompute -- --lookback=1y    # Last 1 year
npm run stats:precompute                     # All time
```

**Supported formats:**
- Days: `30d`, `90d`, `180d`
- Months: `1m`, `3m`, `6m` (30-day months)
- Years: `1y`, `2y` (365-day years)
- Hours: `24h`, `48h`

### Dataset Switching

The stats page automatically discovers available datasets and shows time range buttons in the header. Click any button to switch datasets instantly without recomputation.

## Statistics Computed

### Overview Cards
- Total packets analyzed
- All-default config percentage (using both default library and config)
- Default library percentage
- Default ULN config percentage
- Tracked library percentage (ReceiveUln302)
- Unique DVN combinations

### Charts

**DVN Count Distributions (Pie Charts)**
- Required DVN count distribution (1-4 DVNs, 0 and >4 grouped as "Other")
- Optional DVN count distribution (excluding 0)

**Top DVN Combinations (Bar Chart)**
- Top 20 required DVN sets by packet count
- DVN addresses resolved to canonical names
- Deduplication by resolved names (not addresses)
- Chain-specific resolution using localEid

**Time Series (Line Charts)**
- Hourly packet volume over entire time range
- Configuration changes over time (Version events)
- Summary statistics: total, average, peak, data points

**Chain Breakdowns (Bar Charts)**
- Packets by destination chain (localEid)
- Packets by source chain (srcEid)

## Architecture

### Data Flow

```
GraphQL (Hasura)
    ↓
Precomputation Script
    ↓ (batch processing)
JSON Files (dashboard/data/)
    ↓ (client-side)
Stats Page (index.html)
```

### Performance

- **Batch Size**: 100,000 records per fetch
- **Processing**: Single-pass incremental algorithm
- **Time Range Discovery**: Zero-scan for lookback queries, 2-query optimization for all-time
- **Config Changes**: ~4k events (vs ~700k packets) for 30d period
- **Client-Side**: Instant dataset switching with cached metadata

### Config Change Tracking

Config changes are tracked using Version events (actual configuration updates):
- `DefaultReceiveLibraryVersion` - Default library changes
- `DefaultUlnConfigVersion` - Default ULN config changes
- `OAppReceiveLibraryVersion` - OApp library override changes
- `OAppUlnConfigVersion` - OApp ULN config changes

This approach counts when configs were **modified**, not when packets used them.

## Files

```
dashboard/
├── index.html           # Stats landing page (main entry)
├── explorer.html        # Query explorer (secondary page)
├── stats-page.js        # Stats rendering logic
├── stats-page.css       # Brutalist styling
└── data/
    ├── packet-stats-30d.json   # Precomputed stats (30 days)
    ├── packet-stats-90d.json   # Precomputed stats (90 days)
    ├── packet-stats-1y.json    # Precomputed stats (1 year)
    └── packet-stats-all.json   # Precomputed stats (all time)

scripts/
└── precomputePacketStats.js    # Batch processing script
```

## Development

### Adding New Time Ranges

1. Add the pattern to `stats-page.js`:
```javascript
const patterns = ['30d', '90d', '1y', '2y', 'all']; // Add '2y'
```

2. (Optional) Add to batch mode in `precomputePacketStats.js`:
```javascript
const timeRanges = ['30d', '90d', '1y', '2y', null];
```

### Customizing Charts

Chart rendering functions in `stats-page.js`:
- `renderPieChart()` - Pie charts
- `renderBarChart()` - Horizontal bar charts
- `renderTimeSeriesChart()` - Line charts with area fill
- `renderDvnComboChart()` - DVN combination display

### DVN Resolution

DVNResolver class provides chain-specific DVN name resolution:
```javascript
dvnResolver.resolveDvnName(address, localEid)  // Chain-specific
dvnResolver.resolveDvnName(address)            // Fallback
```

Resolution priority:
1. Local EID-specific mapping
2. Fallback global mapping
3. Original address

## Production Deployment

### Pre-deployment Checklist

1. ✅ Generate fresh statistics:
   ```bash
   npm run stats:precompute -- --batch
   ```

2. ✅ Verify all datasets exist:
   ```bash
   ls -lh dashboard/data/packet-stats-*.json
   ```

3. ✅ Test in browser:
   - Open `dashboard/index.html`
   - Verify all time range buttons appear
   - Switch between datasets
   - Check for console errors

4. ✅ Validate data integrity:
   - Check packet counts match expected ranges
   - Verify DVN names resolve correctly
   - Confirm time-series charts render

### Deployment

The dashboard is a static site. Deploy the `dashboard/` directory to any web host:

```bash
# Example with static file server
cd dashboard
python -m http.server 8080
```

Or deploy to:
- GitHub Pages
- Netlify
- Vercel
- Any static hosting service

### Automation

Set up a cron job to regenerate statistics daily:

```bash
# crontab -e
0 2 * * * cd /path/to/dvnstats && npm run stats:precompute -- --batch
```

This keeps data fresh without manual intervention.

## Troubleshooting

**No datasets found:**
- Run `npm run stats:precompute -- --batch` to generate data
- Check `dashboard/data/` directory exists
- Verify JSON files are valid

**DVN names not resolving:**
- Ensure `layerzero.json` is present in dashboard directory
- Check DVN addresses exist in metadata
- Verify localEid is being passed correctly

**Time-series charts empty:**
- Check that Version events exist in database
- Verify time range covers period with config changes
- Inspect JSON data for `timeSeries.hourly` array

**Slow precomputation:**
- Normal for all-time queries (millions of packets)
- Use `--lookback` for faster partial updates
- Check network connection to GraphQL endpoint

## License

Part of the DVNStats project.
