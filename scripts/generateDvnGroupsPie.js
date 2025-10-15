const fs = require("fs");
const path = require("path");

/**
 * Reads dvngroups.json, aggregates packet counts by DVN group name,
 * and writes a standalone HTML file with a donut-style pie chart.
 */
function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const inputPath = path.join(repoRoot, "dvngroups.json");
  const outputDir = path.join(repoRoot, "dashboard");
  const outputPath = path.join(outputDir, "dvn-groups-pie.html");

  const raw = fs.readFileSync(inputPath, "utf8");
  // dvngroups.json has a trailing comma before the closing brace; strip it so JSON.parse succeeds.
  const sanitized = raw.replace(/,\s*}\s*$/, "\n}");

  const parsed = JSON.parse(sanitized);
  const ranking = Array.isArray(parsed.requiredDvnNameRanking)
    ? parsed.requiredDvnNameRanking
    : [];

  if (!ranking.length) {
    throw new Error("No data found in requiredDvnNameRanking");
  }

  const groupTotals = new Map();
  for (const entry of ranking) {
    const label = Array.isArray(entry.requiredNames)
      ? entry.requiredNames.join(" + ")
      : "Unknown group";
    const packetCount = Number(entry.packetCount) || 0;
    groupTotals.set(label, (groupTotals.get(label) || 0) + packetCount);
  }

  const sortedGroups = [...groupTotals.entries()]
    .sort((a, b) => b[1] - a[1]);

  const topLimit = 12;
  const topGroups = sortedGroups.slice(0, topLimit);
  const remainder = sortedGroups.slice(topLimit);

  const otherTotal = remainder.reduce((sum, [, count]) => sum + count, 0);
  if (otherTotal > 0) {
    topGroups.push(["Other DVN groups", otherTotal]);
  }

  const labels = topGroups.map(([label]) => label);
  const values = topGroups.map(([, count]) => count);
  const totalPackets = values.reduce((sum, value) => sum + value, 0);

  const chartData = {
    labels,
    values,
    totalPackets,
    lastUpdated: new Date().toISOString(),
  };

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const html = generateHtml(chartData);
  fs.writeFileSync(outputPath, html, "utf8");

  console.log(`✅ Pie chart written to ${path.relative(repoRoot, outputPath)}`);
}

function generateHtml({ labels, values, totalPackets, lastUpdated }) {
  // These colors define the starting hues for the gradients used in the slices.
  const baseHues = [
    215, 343, 32, 282, 8, 192, 52, 8, 130, 260, 12, 170, 300,
  ];

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>DVN Groups Packet Distribution</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        color-scheme: dark light;
        font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
        background: radial-gradient(circle at 20% 20%, #1b2735, #090a0f 60%);
        color: #f5f6fa;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .card {
        width: min(960px, 92vw);
        padding: 32px clamp(24px, 3vw, 48px);
        border-radius: 28px;
        background: rgba(15, 18, 25, 0.84);
        backdrop-filter: blur(18px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow:
          0 30px 60px rgba(0, 0, 0, 0.45),
          inset 0 1px 0 rgba(255, 255, 255, 0.06);
      }

      h1 {
        margin: 0 0 12px;
        font-size: clamp(28px, 5vw, 38px);
        letter-spacing: 0.02em;
      }

      p {
        margin: 4px 0 0;
        color: rgba(255, 255, 255, 0.72);
      }

      canvas {
        max-width: 100%;
      }

      .footer {
        margin-top: 24px;
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        font-size: 14px;
        color: rgba(255, 255, 255, 0.56);
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>DVN Groups Packet Distribution</h1>
      <p>Top DVN group combinations by packet count, aggregated from dvngroups.json.</p>
      <canvas id="dvnPieChart" width="880" height="540" role="img"></canvas>
      <div class="footer">
        <span>Total packets: ${totalPackets.toLocaleString()}</span>
        <span>Generated: ${new Date(lastUpdated).toLocaleString()}</span>
      </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js" integrity="sha384-Jrxf3ZvGnIOdHuYGtbARzO7j//BiE+CczzgYc9bzjBPQtK6EvCC7npSrFSQIJ3VU" crossorigin="anonymous"></script>
    <script>
      const labels = ${JSON.stringify(labels)};
      const values = ${JSON.stringify(values)};
      const totalPackets = ${JSON.stringify(totalPackets)};
      const baseHues = ${JSON.stringify(baseHues)};

      const centerText = {
        id: "centerText",
        afterDraw(chart) {
          const { ctx } = chart;
          const meta = chart.getDatasetMeta(0);
          if (!meta?.data?.length) return;
          const center = meta.data[0].getProps(["x", "y"], true);
          ctx.save();
          ctx.font = "600 28px Inter, system-ui, sans-serif";
          ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(totalPackets.toLocaleString(), center.x, center.y - 12);
          ctx.font = "500 16px Inter, system-ui, sans-serif";
          ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
          ctx.fillText("total packets", center.x, center.y + 14);
          ctx.restore();
        },
      };

      const canvas = document.getElementById("dvnPieChart");
      const ctx = canvas.getContext("2d");

      const gradients = labels.map((_, index) => {
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        const hue = baseHues[index % baseHues.length];
        gradient.addColorStop(0, "hsl(" + hue + ", 85%, 68%)");
        gradient.addColorStop(1, "hsl(" + (hue + 18) % 360 + ", 88%, 52%)");
        return gradient;
      });

      new Chart(ctx, {
        type: "doughnut",
        data: {
          labels,
          datasets: [
            {
              data: values,
              backgroundColor: gradients,
              borderWidth: 2,
              borderColor: "rgba(15, 18, 25, 0.92)",
              hoverBorderColor: "rgba(255, 255, 255, 0.9)",
              hoverOffset: 20,
              spacing: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "52%",
          plugins: {
            legend: {
              position: "right",
              align: "start",
              labels: {
                color: "rgba(255, 255, 255, 0.88)",
                font: {
                  family: "Inter, system-ui, sans-serif",
                  size: 13,
                },
                padding: 16,
                boxWidth: 14,
              },
            },
            tooltip: {
              backgroundColor: "rgba(10, 12, 20, 0.94)",
              borderColor: "rgba(255, 255, 255, 0.18)",
              borderWidth: 1,
              padding: 12,
              displayColors: true,
              callbacks: {
                label(context) {
                  const value = context.raw;
                  const pct = (value / totalPackets) * 100;
                  return context.label + ": " + value.toLocaleString() + " packets (" + pct.toFixed(2) + "%)";
                },
              },
            },
          },
          layout: { padding: { left: 12, right: 12, top: 16, bottom: 16 } },
        },
        plugins: [centerText],
      });
    </script>
  </body>
</html>`;
}

main();
