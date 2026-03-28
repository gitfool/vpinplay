const API_BASE = "https://api.vpinplay.com:8888";
let currentUserId = null;
let currentViewMode = "table";

function q(id) {
  return document.getElementById(id);
}

function getPreferredTheme() {
  const saved = localStorage.getItem("vpin-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function updateThemeToggleLabel(theme) {
  const btn = q("themeToggleBtn");
  if (!btn) return;
  btn.textContent = theme === "dark" ? "Light" : "Dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeToggleLabel(theme);
}

function initTheme() {
  applyTheme(getPreferredTheme());
}

function toggleTheme() {
  const next =
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "light"
      : "dark";
  localStorage.setItem("vpin-theme", next);
  applyTheme(next);
}

function getPreferredViewMode() {
  const saved = localStorage.getItem("vpin-view-mode");
  return saved === "carousel" ? "carousel" : "table";
}

function applyViewMode(mode) {
  currentViewMode = mode;
  const panels = q("panels");
  const btn = q("viewToggleBtn");
  if (mode === "carousel") {
    panels.classList.add("carousel-view");
    btn.textContent = "Table View";
  } else {
    panels.classList.remove("carousel-view");
    btn.textContent = "Carousel View";
  }
}

function initViewMode() {
  applyViewMode(getPreferredViewMode());
}

function toggleViewMode() {
  const next = currentViewMode === "carousel" ? "table" : "carousel";
  localStorage.setItem("vpin-view-mode", next);
  applyViewMode(next);
  refreshDashboard();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDate(value) {
  if (!value) return "Never";
  const raw = String(value).trim();
  const hasTimeZone = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);
  const normalized = !hasTimeZone && raw.includes("T") ? `${raw}Z` : raw;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "Invalid date";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function fmtRuntime(minutes) {
  const n = Number(minutes || 0);
  return `${n} min`;
}

function fmtNumber(value) {
  return Number(value || 0).toLocaleString();
}

function fmtRatingStars(value, options = {}) {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  const clamped = Math.max(0, Math.min(5, numeric));
  const roundedToHalf = Math.round(clamped * 2) / 2;
  const fullStars = Math.floor(roundedToHalf);
  const hasHalf = roundedToHalf - fullStars >= 0.5;
  let stars = "";
  for (let i = 0; i < 5; i += 1) {
    const fillPercent =
      i < fullStars ? 100 : i === fullStars && hasHalf ? 50 : 0;
    stars += `<span class="rating-star-cell" aria-hidden="true"><span class="rating-star empty">★</span><span class="rating-star fill" style="width:${fillPercent}%">★</span></span>`;
  }
  const numericText = options.showNumeric
    ? ` <span class="rating-value">(${escapeHtml(clamped.toFixed(2))})</span>`
    : "";
  return `<span class="rating-stars" title="${escapeHtml(clamped.toFixed(2))} / 5" aria-label="${escapeHtml(clamped.toFixed(2))} out of 5 stars">${stars}</span>${numericText}`;
}

function fmtTableName(row) {
  const name = row?.vpsdb?.name;
  const manufacturer = row?.vpsdb?.manufacturer;
  const year = row?.vpsdb?.year;
  const suffixParts = [manufacturer, year].filter(
    (v) => v !== null && v !== undefined && String(v).trim() !== "",
  );
  const baseName = name || "Unknown Table";
  return suffixParts.length
    ? `${baseName} (${suffixParts.join(", ")})`
    : baseName;
}

function linkTableName(name, vpsId) {
  const text =
    name === null || name === undefined || name === "" ? "-" : String(name);
  const id = String(vpsId || "").trim();
  if (!id || text === "-") return escapeHtml(text);
  return `<a href="table.html?vpsid=${encodeURIComponent(id)}">${escapeHtml(text)}</a>`;
}

async function api(path) {
  try {
    const response = await fetch(`${API_BASE}${path}`);
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: { error: error.message } };
  }
}

async function getGlobalAvgRatingMap(rows) {
  const vpsIds = [
    ...new Set((rows || []).map((r) => r?.vpsId).filter(Boolean)),
  ];
  if (vpsIds.length === 0) return {};

  const responses = await Promise.all(
    vpsIds.map((vpsId) =>
      api(`/api/v1/tables/${encodeURIComponent(vpsId)}/rating-summary`),
    ),
  );

  const map = {};
  responses.forEach((res, idx) => {
    const vpsId = vpsIds[idx];
    if (!res.ok || !res.data) {
      map[vpsId] = null;
      return;
    }
    const avg = res.data.avgRating;
    map[vpsId] = avg === null || avg === undefined ? null : Number(avg);
  });
  return map;
}

function fmtUserOverGlobalRating(row, globalAvgRatingMap) {
  const userRating = row?.rating;
  const globalAvg = globalAvgRatingMap?.[row?.vpsId];
  return `${fmtRatingStars(userRating)}<span class="rating-separator">/</span>${fmtRatingStars(globalAvg, { showNumeric: true })}`;
}

function renderTable(elId, columns, rows) {
  const el = q(elId);
  if (!rows || rows.length === 0) {
    el.innerHTML = `<tr><td class="muted">No data</td></tr>`;
    return;
  }

  let html = "<thead><tr>";
  columns.forEach((col) => {
    html += `<th>${escapeHtml(col.label)}</th>`;
  });
  html += "</tr></thead><tbody>";

  rows.forEach((row) => {
    html += "<tr>";
    columns.forEach((col) => {
      const raw = col.getter(row);
      const text = raw === null || raw === undefined || raw === "" ? "-" : raw;
      html += `<td>${col.html ? text : escapeHtml(text)}</td>`;
    });
    html += "</tr>";
  });

  html += "</tbody>";
  el.innerHTML = html;
}

function getCardImageUrl(vpsId) {
  if (!vpsId) return "";
  return `https://github.com/superhac/vpinmediadb/raw/refs/heads/main/${encodeURIComponent(vpsId)}/cab.png`;
}

function renderCarousel(elId, rows, options = {}) {
  const el = q(elId);
  if (!rows || rows.length === 0) {
    el.innerHTML = `<div class="muted" style="padding: 20px;">No data</div>`;
    return;
  }

  let html = `<div class="carousel-container">`;
  rows.forEach((row) => {
    const title = options.titleGetter(row);
    const sub = options.subGetter(row);
    const vpsId = row.vpsId;
    const imgUrl = vpsId
      ? getCardImageUrl(vpsId)
      : "https://placehold.co/160x220/111d31/e8f0ff?text=No+VPS+ID";

    html += `
                    <a href="table.html?vpsid=${encodeURIComponent(vpsId || "")}" class="carousel-card">
                        <div class="card-img-wrap">
                            <img src="${imgUrl}" alt="${escapeHtml(title)}" onerror="this.src='https://placehold.co/160x220/111d31/e8f0ff?text=No+Image'; this.onerror=null;" loading="lazy">
                        </div>
                        <div class="card-info">
                            <div class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
                            <div class="card-sub">${options.subHtml ? sub : escapeHtml(sub)}</div>
                        </div>
                    </a>
                `;
  });
  html += `</div>`;
  el.innerHTML = html;
}

function setUserStatus(availableResponse) {
  const el = q("userStatus");
  if (!availableResponse.ok) {
    el.className = "status bad";
    el.textContent = "Could not verify user availability";
    return;
  }

  const available = !!availableResponse.data.available;
  if (available) {
    el.className = "status warn";
    el.textContent = "User ID is currently available (no registered sync yet)";
  } else {
    el.className = "status ok";
    el.textContent = "User ID is registered";
  }
}

function setKpi(id, value) {
  q(id).textContent = value;
}

function buildSpotlightRows(
  userLastSync,
  runtimeSum,
  runtimeWeek,
  startCountSum,
  startsWeek,
  mostPlayed,
) {
  const rows = [];
  if (userLastSync?.ok) {
    rows.push({
      metric: "Last Sync",
      value: escapeHtml(fmtDate(userLastSync.data.lastSyncAt)),
    });
  }
  if (runtimeSum?.ok) {
    rows.push({
      metric: "Runtime Sum",
      value: escapeHtml(fmtRuntime(runtimeSum.data.runTimeTotal)),
    });
  }
  if (runtimeWeek?.ok) {
    rows.push({
      metric: "This Week Runtime",
      value: escapeHtml(fmtRuntime(runtimeWeek.data.runTimePlayed)),
    });
  }
  if (startCountSum?.ok) {
    rows.push({
      metric: "Start Count Sum",
      value: escapeHtml(fmtNumber(startCountSum.data.startCountTotal)),
    });
  }
  if (startsWeek?.ok) {
    rows.push({
      metric: "This Week Plays",
      value: escapeHtml(fmtNumber(startsWeek.data.startCountPlayed)),
    });
  }
  if (mostPlayed?.ok && Array.isArray(mostPlayed.data) && mostPlayed.data[0]) {
    rows.push({
      metric: "Most Played Table",
      value: `${linkTableName(fmtTableName(mostPlayed.data[0]), mostPlayed.data[0].vpsId)} (${escapeHtml(fmtNumber(mostPlayed.data[0].startCount))} starts)`,
    });
  }
  return rows;
}

async function refreshDashboard() {
  if (!currentUserId) return;

  q("userBadge").textContent = `userid=${currentUserId}`;

  const [
    availableRes,
    lastSyncRes,
    countRes,
    runtimeSumRes,
    runtimeWeekRes,
    startCountSumRes,
    startCountWeekRes,
    topRatedRes,
    recentRes,
    topPlaytimeRes,
    mostPlayedRes,
    userNewlyAddedRes,
  ] = await Promise.all([
    api(`/api/v1/users/${encodeURIComponent(currentUserId)}/available`),
    api(`/api/v1/users/${encodeURIComponent(currentUserId)}/last-sync`),
    api(`/api/v1/users/${encodeURIComponent(currentUserId)}/tables/count`),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/runtime-sum`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/runtime-weekly?days=7`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/start-count-sum`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/start-count-weekly?days=7`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/top-rated?limit=5`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/recently-played?limit=5`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/top-play-time?limit=5`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/most-played?limit=5`,
    ),
    api(
      `/api/v1/users/${encodeURIComponent(currentUserId)}/tables/newly-added?limit=5`,
    ),
  ]);

  const rowsNeedingGlobalRating = [
    ...(topRatedRes.ok ? topRatedRes.data : []),
    ...(recentRes.ok ? recentRes.data : []),
    ...(userNewlyAddedRes.ok ? userNewlyAddedRes.data : []),
  ];
  const globalAvgRatingMap = await getGlobalAvgRatingMap(
    rowsNeedingGlobalRating,
  );

  setUserStatus(availableRes);

  const totalStarts = startCountSumRes.ok
    ? Number(startCountSumRes.data.startCountTotal || 0)
    : 0;
  const totalRuntime = runtimeSumRes.ok
    ? Number(runtimeSumRes.data.runTimeTotal || 0)
    : 0;
  const runtimeWeek = runtimeWeekRes.ok
    ? Number(runtimeWeekRes.data.runTimePlayed || 0)
    : 0;
  const startsWeek = startCountWeekRes.ok
    ? Number(startCountWeekRes.data.startCountPlayed || 0)
    : 0;

  setKpi(
    "kpiTableCount",
    countRes.ok ? fmtNumber(countRes.data.tableCount) : "-",
  );
  setKpi(
    "kpiLastSync",
    lastSyncRes.ok ? fmtDate(lastSyncRes.data.lastSyncAt) : "-",
  );
  setKpi("kpiStarts", fmtNumber(totalStarts));
  setKpi("kpiRuntime", fmtRuntime(totalRuntime));
  setKpi("kpiRuntimeWeek", fmtRuntime(runtimeWeek));
  setKpi("kpiStartsWeek", fmtNumber(startsWeek));

  renderTable(
    "spotlightTable",
    [
      { label: "Metric", getter: (r) => r.metric },
      { label: "Value", getter: (r) => r.value, html: true },
    ],
    buildSpotlightRows(
      lastSyncRes,
      runtimeSumRes,
      runtimeWeekRes,
      startCountSumRes,
      startCountWeekRes,
      mostPlayedRes,
    ),
  );

  const isCarousel = currentViewMode === "carousel";
  const tableListPanels = [
    {
      id: "topRatedTable",
      container: "topRatedContainer",
      data: topRatedRes.ok ? topRatedRes.data : [],
      title: "Top Rated (User)",
      sub: (r) => fmtUserOverGlobalRating(r, globalAvgRatingMap),
      cols: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        {
          label: "Mine / Avg Rating",
          getter: (r) => fmtUserOverGlobalRating(r, globalAvgRatingMap),
          html: true,
        },
        { label: "Starts", getter: (r) => r.startCount },
      ],
    },
    {
      id: "recentlyPlayedTable",
      container: "recentlyPlayedContainer",
      data: recentRes.ok ? recentRes.data : [],
      title: "Recently Played",
      sub: (r) =>
        `${fmtDate(r.lastRun)} • ${fmtUserOverGlobalRating(r, globalAvgRatingMap)}`,
      cols: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        { label: "Last Run", getter: (r) => fmtDate(r.lastRun) },
        {
          label: "Mine / Avg Rating",
          getter: (r) => fmtUserOverGlobalRating(r, globalAvgRatingMap),
          html: true,
        },
      ],
    },
    {
      id: "topPlaytimeTable",
      container: "topPlaytimeContainer",
      data: topPlaytimeRes.ok ? topPlaytimeRes.data : [],
      title: "Top Play Time",
      sub: (r) =>
        `${fmtRuntime(r.runTime)} (${fmtNumber(r.startCount)} starts)`,
      cols: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        { label: "Run Time", getter: (r) => fmtRuntime(r.runTime) },
        { label: "Starts", getter: (r) => fmtNumber(r.startCount) },
      ],
    },
    {
      id: "mostPlayedTable",
      container: "mostPlayedContainer",
      data: mostPlayedRes.ok ? mostPlayedRes.data : [],
      title: "Most Played",
      sub: (r) =>
        `${fmtNumber(r.startCount)} starts (Last: ${fmtDate(r.lastRun)})`,
      cols: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        { label: "Starts", getter: (r) => fmtNumber(r.startCount) },
        { label: "Last Run", getter: (r) => fmtDate(r.lastRun) },
      ],
    },
    {
      id: "userNewlyAddedTable",
      container: "userNewlyAddedContainer",
      data: userNewlyAddedRes.ok ? userNewlyAddedRes.data : [],
      title: "Newest Added",
      sub: (r) =>
        `Added: ${fmtDate(r.createdAt)} • ${fmtUserOverGlobalRating(r, globalAvgRatingMap)}`,
      cols: [
        {
          label: "Table",
          getter: (r) => linkTableName(fmtTableName(r), r.vpsId),
          html: true,
        },
        { label: "Added", getter: (r) => fmtDate(r.createdAt) },
        {
          label: "My / Avg Rating",
          getter: (r) => fmtUserOverGlobalRating(r, globalAvgRatingMap),
          html: true,
        },
      ],
    },
  ];

  tableListPanels.forEach((panel) => {
    const container = q(panel.container);
    if (isCarousel) {
      renderCarousel(panel.container, panel.data, {
        titleGetter: (r) => fmtTableName(r),
        subGetter: panel.sub,
        subHtml: true,
      });
    } else {
      container.innerHTML = `<table id="${panel.id}"></table>`;
      renderTable(panel.id, panel.cols, panel.data);
    }
  });
}

function applyUserId() {
  const entered = q("setupUserId").value.trim();
  if (!entered) return;
  const url = new URL(window.location.href);
  url.searchParams.set("userid", entered);
  window.location.href = url.toString();
}

function init() {
  initTheme();
  initViewMode();
  const params = new URLSearchParams(window.location.search);
  const userId = params.get("userid");

  if (!userId) {
    q("setup").classList.remove("hidden");
    q("dashboard").classList.add("hidden");
    q("title").textContent = "Player Dashboard (Testing)";
    return;
  }

  currentUserId = userId;
  q("setup").classList.add("hidden");
  q("dashboard").classList.remove("hidden");
  q("title").textContent = `${userId}`;
  q("userBadge").textContent = `userid=${userId}`;
  refreshDashboard();
}

document.addEventListener("DOMContentLoaded", () => {
  init();
});
