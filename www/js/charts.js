const CHART_WINDOW_DAYS = 30;
const CHART_TOP_LIMIT = 10;

let topRuntimeChart = null;

function formatBucketLabel(bucket) {
  const date = new Date(`${bucket}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return bucket;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getChartPalette() {
  return [
    "#00d9ff",
    "#ff0a78",
    "#ffd93d",
    "#00ff9f",
    "#b429f9",
    "#ff6b35",
    "#6ce5ff",
    "#ff7bb0",
    "#fff07a",
    "#a98bff",
  ];
}

function getCssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function renderTopRuntimeSummary(items) {
  const el = q("topRuntimeSummary");
  if (!el) return;

  if (!Array.isArray(items) || items.length === 0) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = items
    .map(
      (item, index) => `
        <article class="chart-summary-card">
          <div class="chart-summary-rank">Rank ${index + 1}</div>
          <div class="chart-summary-title">${escapeHtml(fmtTableName(item))}</div>
          <div class="chart-summary-stats">
            ${escapeHtml(fmtWeeklyRuntime(item.runTimePlayed))} total runtime<br>
            ${escapeHtml(`${fmtNumber(item.startCountPlayed)} starts`)}
          </div>
        </article>
      `,
    )
    .join("");
}

function destroyTopRuntimeChart() {
  if (topRuntimeChart) {
    topRuntimeChart.destroy();
    topRuntimeChart = null;
  }
}

function buildTopRuntimeDatasets(items) {
  const palette = getChartPalette();
  return items.map((item, index) => ({
    label: fmtTableName(item),
    data: Array.isArray(item.dailyBuckets)
      ? item.dailyBuckets.map((point) => Number(point.runTimePlayed || 0))
      : [],
    borderColor: palette[index % palette.length],
    backgroundColor: palette[index % palette.length],
    borderWidth: 2,
    pointRadius: 1.5,
    pointHoverRadius: 4,
    pointBackgroundColor: palette[index % palette.length],
    pointBorderWidth: 0,
    tension: 0.28,
    fill: false,
  }));
}

function renderTopRuntimeChart(payload) {
  const canvas = q("topRuntimeChart");
  if (!canvas || typeof Chart === "undefined") return false;

  destroyTopRuntimeChart();

  const items = Array.isArray(payload?.items) ? payload.items : [];
  const buckets = Array.isArray(payload?.buckets) ? payload.buckets : [];
  const labels = buckets.map(formatBucketLabel);
  const axisInk = getCssVar("--ink-muted", "#b89dd9");
  const axisLine = getCssVar("--line", "#3d2461");

  topRuntimeChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: buildTopRuntimeDatasets(items),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: axisInk,
            boxWidth: 18,
            usePointStyle: true,
            pointStyle: "line",
          },
        },
        tooltip: {
          callbacks: {
            label(context) {
              const value = Number(context.parsed.y || 0);
              return `${context.dataset.label}: ${fmtWeeklyRuntime(value)}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: axisInk,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10,
          },
          grid: {
            color: axisLine,
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: axisInk,
            callback(value) {
              return fmtWeeklyRuntime(value);
            },
          },
          grid: {
            color: axisLine,
          },
        },
      },
    },
  });

  return true;
}

async function refreshCharts() {
  const header = document.querySelector("vpinplay-header");
  const statusEl = q("topRuntimeChartStatus");
  const metaEl = q("topRuntimeChartMeta");

  if (header) header.setRefreshing(true);
  if (statusEl) statusEl.textContent = "Loading chart data...";

  try {
    const result = await api(
      `/api/v1/tables/top-play-time-buckets?days=${encodeURIComponent(CHART_WINDOW_DAYS)}&limit=${encodeURIComponent(CHART_TOP_LIMIT)}`,
    );

    if (!result.ok) {
      destroyTopRuntimeChart();
      q("kpiTrackedTables").textContent = "-";
      renderTopRuntimeSummary([]);
      if (statusEl) statusEl.textContent = "Unable to load chart data.";
      return;
    }

    const items = Array.isArray(result.data?.items) ? result.data.items : [];
    q("kpiChartWindow").textContent = `${fmtNumber(result.data?.days || CHART_WINDOW_DAYS)}d`;
    q("kpiTrackedTables").textContent = fmtNumber(items.length);

    if (metaEl) {
      metaEl.textContent = `Daily runtime buckets from ${fmtDate(result.data?.from)} to ${fmtDate(result.data?.to)}.`;
    }

    renderTopRuntimeSummary(items);

    if (items.length === 0) {
      destroyTopRuntimeChart();
      if (statusEl) statusEl.textContent = "No runtime activity found for this window.";
      return;
    }

    const rendered = renderTopRuntimeChart(result.data);
    if (statusEl) {
      statusEl.textContent = rendered
        ? "Top 10 tables ranked by total runtime across the selected window."
        : "Chart library unavailable.";
    }
  } finally {
    if (header) header.markRefresh();
  }
}

window.refreshDashboard = refreshCharts;

document.addEventListener("DOMContentLoaded", async () => {
  await customElements.whenDefined("vpinplay-header");
  refreshCharts();
});
