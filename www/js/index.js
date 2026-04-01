const EXPANDED_DASHBOARD_PANEL_LIMIT = 100;
let expandedDashboardPanelId = null;

function getDashboardPanelConfigs() {
  return {
    topRatedPanel: {
      tableId: "topRatedTable",
      fetchRows: (limit) => fetchPaginatedRows("/api/v1/tables/top-rated", limit),
      columns: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        {
          label: "Avg Rating",
          getter: (r) => fmtRatingStars(r.avgRating, { showNumeric: true }),
          html: true,
        },
        { label: "Rating Count", getter: (r) => r.ratingCount },
        { label: "VPS ID", getter: (r) => linkVpsId(r.vpsId), html: true },
      ],
    },
    topPlayTimePanel: {
      tableId: "topPlayTimeGlobalTable",
      fetchRows: (limit) =>
        fetchPaginatedRows("/api/v1/tables/top-play-time", limit),
      columns: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        {
          label: "Run Time (Total)",
          getter: (r) => fmtWeeklyRuntime(r.runTimeTotal),
        },
        { label: "Starts (Total)", getter: (r) => r.startCountTotal },
        { label: "Players", getter: (r) => r.playerCount },
        { label: "VPS ID", getter: (r) => linkVpsId(r.vpsId), html: true },
      ],
    },
    newlyAddedPanel: {
      tableId: "newlyAddedTable",
      fetchRows: (limit) => fetchPaginatedRows("/api/v1/tables/newly-added", limit),
      columns: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        { label: "First Seen", getter: (r) => fmtDate(r.firstSeenAt) },
        { label: "Variations", getter: (r) => r.variationCount },
        { label: "VPS ID", getter: (r) => linkVpsId(r.vpsId), html: true },
      ],
    },
    topVariantsPanel: {
      tableId: "topVariantsTable",
      fetchRows: (limit) => fetchPaginatedRows("/api/v1/tables/top-variants", limit),
      columns: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        { label: "Variants", getter: (r) => r.variationCount },
        { label: "VPS ID", getter: (r) => linkVpsId(r.vpsId), html: true },
      ],
    },
    topPlayerPlaysPanel: {
      tableId: "topPlayerPlaysTable",
      fetchRows: (limit) => loadTopPlayerActivity("startCountPlayed", TOP_PLAYER_DAYS, limit),
      beforeRender: () => {
        q("topPlayerPlaysTitle").textContent = `Top Player Plays (${TOP_PLAYER_DAYS}d)`;
      },
      columns: [
        { label: "User", getter: (r) => linkUserId(r.userId), html: true },
        { label: "Plays", getter: (r) => fmtNumber(r.startCountPlayed) },
      ],
    },
    topPlayerPlaytimePanel: {
      tableId: "topPlayerPlaytimeTable",
      fetchRows: (limit) => loadTopPlayerActivity("runTimePlayed", TOP_PLAYER_DAYS, limit),
      beforeRender: () => {
        q("topPlayerPlaytimeTitle").textContent =
          `Top Player Playtime (${TOP_PLAYER_DAYS}d)`;
      },
      columns: [
        { label: "User", getter: (r) => linkUserId(r.userId), html: true },
        { label: "Run Time", getter: (r) => fmtWeeklyRuntime(r.runTimePlayed) },
      ],
    },
    latestSubmittedScoresPanel: {
      tableId: "latestSubmittedScoresTable",
      fetchRows: (limit) => fetchLatestSubmittedScores(limit),
      columns: [
        {
          label: "Table",
          getter: (r) =>
            linkTableName(
              r.tableTitle || r.vpsdb?.name || "Unknown Table",
              r.vpsId,
            ),
          html: true,
        },
        { label: "User", getter: (r) => linkUserId(r.userId), html: true },
        { label: "Label", getter: (r) => r.label || "-" },
        { label: "Score", getter: (r) => fmtLatestScoreValue(r.score) },
        { label: "Updated", getter: (r) => fmtDate(r.updatedAt) },
      ],
    },
  };
}

function syncExpandedDashboardPanelState() {
  const panels = document.querySelectorAll(".dashboard-panel");
  const grid = q("dashboardPanels");
  const isExpanded = Boolean(expandedDashboardPanelId);

  if (grid) {
    grid.classList.toggle("panel-expanded", isExpanded);
  }

  panels.forEach((panel) => {
    const button = panel.querySelector(".panel-expand-btn");
    const expanded = panel.id === expandedDashboardPanelId;

    panel.classList.toggle("is-expanded", expanded);

    if (button) {
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      button.setAttribute(
        "aria-label",
        `${expanded ? "Collapse" : "Expand"} ${panel.querySelector("h3")?.textContent || "panel"}`,
      );
    }
  });
}

async function renderDashboardPanels(defaultLimit) {
  const configs = getDashboardPanelConfigs();
  const entries = Object.entries(configs);

  await Promise.all(
    entries.map(async ([panelId, config]) => {
      const limit =
        expandedDashboardPanelId === panelId
          ? EXPANDED_DASHBOARD_PANEL_LIMIT
          : defaultLimit;
      const rows = await config.fetchRows(limit);

      if (typeof config.beforeRender === "function") {
        config.beforeRender();
      }

      renderTable(config.tableId, config.columns, rows);
    }),
  );
}

async function refreshDashboard() {
  const header = document.querySelector("vpinplay-header");
  if (header) header.setRefreshing(true);
  const limit = 5;

  const [
    lastSyncRes,
    vpsdbStatusRes,
    weeklyActivityRes,
    userCountRes,
    tableCountRes,
  ] = await Promise.all([
    api("/api/v1/sync/last"),
    api("/api/v1/vpsdb/status"),
    api("/api/v1/tables/activity-weekly?days=7"),
    api("/api/v1/users/count"),
    api("/api/v1/tables/count"),
  ]);

  q("kpiLastSync").textContent = lastSyncRes.ok
    ? fmtDate(lastSyncRes.data.lastSyncAt)
    : "-";
  q("kpiLastSyncUser").textContent =
    `Last sync by user: ${lastSyncRes.ok ? lastSyncRes.data.userId || "-" : "-"}`;

  q("kpiTotalTables").textContent = tableCountRes.ok
    ? fmtNumber(tableCountRes.data.totalTableRows)
    : "-";
  q("kpiUserCount").textContent = userCountRes.ok
    ? fmtNumber(userCountRes.data.userCount)
    : "-";

  if (vpsdbStatusRes.ok) {
    const statusText = String(vpsdbStatusRes.data.status || "unknown");
    setKpi(
      "kpiVpsdbStatus",
      statusText,
      statusText === "ok" ? "status-ok" : "status-bad",
    );
    q("kpiVpsdbMeta").textContent =
      `records: ${vpsdbStatusRes.data.recordCount ?? "-"} | last: ${fmtDate(vpsdbStatusRes.data.lastSyncAt)}`;
  } else {
    setKpi("kpiVpsdbStatus", "error", "status-bad");
    q("kpiVpsdbMeta").textContent = "Unable to fetch VPSDB status";
  }

  if (weeklyActivityRes.ok) {
    q("kpiRuntimeWeek").textContent = fmtWeeklyRuntime(
      weeklyActivityRes.data.runTimePlayed,
    );
    q("kpiStartsWeek").textContent = fmtNumber(
      weeklyActivityRes.data.startCountPlayed,
    );
  } else {
    q("kpiRuntimeWeek").textContent = "-";
    q("kpiStartsWeek").textContent = "-";
  }

  await renderDashboardPanels(limit);

  if (ENABLE_ALL_TABLES_PANEL) {
    await loadAllTablesPage();
  }

  if (header) {
    header.markRefresh();
  }
}

async function toggleDashboardPanel(panelId) {
  expandedDashboardPanelId =
    expandedDashboardPanelId === panelId ? null : panelId;
  syncExpandedDashboardPanelState();
  await refreshDashboard();
}

document.addEventListener("DOMContentLoaded", async () => {
  await customElements.whenDefined("vpinplay-header");

  if (!ENABLE_ALL_TABLES_PANEL) {
    const allTablesPanel = q("allTablesPanel");
    if (allTablesPanel) allTablesPanel.style.display = "none";
  }

  syncExpandedDashboardPanelState();
  refreshDashboard();
});

async function fetchLatestSubmittedScores(limit) {
  const safeLimit = Math.max(
    1,
    Math.min(API_PAGE_LIMIT, Number(limit || 0) || 5),
  );
  const res = await api(
    `/api/v1/users/scores/latest?limit=${encodeURIComponent(safeLimit)}&offset=0`,
  );
  return res.ok && Array.isArray(res.data?.items) ? res.data.items : [];
}
