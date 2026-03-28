        const API_BASE = "https://api.vpinplay.com:8888";
        const ALL_TABLES_PAGE_SIZE = 50;
        const API_PAGE_LIMIT = 100;
        const MAX_DASHBOARD_LIMIT = 100;
        const ENABLE_ALL_TABLES_PANEL = false;
        const TOP_PLAYER_DAYS = 7;
        const TOP_PLAYER_LIMIT = 5;
        let allTablesOffset = 0;
        let allTablesTotal = null;

        function q(id) { return document.getElementById(id); }

        function getPreferredTheme() {
            const saved = localStorage.getItem("vpin-theme");
            if (saved === "light" || saved === "dark") return saved;
            return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
            const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
            localStorage.setItem("vpin-theme", next);
            applyTheme(next);
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
            if (!value) return "-";
            const raw = String(value).trim();
            const hasTimeZone = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);
            const normalized = !hasTimeZone && raw.includes("T") ? `${raw}Z` : raw;
            const d = new Date(normalized);
            if (Number.isNaN(d.getTime())) return "-";
            return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
        }

        function truncateHash(value, max = 32) {
            const text = value || "";
            return text.length > max ? text.slice(0, max) : (text || "-");
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
                const fillPercent = i < fullStars ? 100 : (i === fullStars && hasHalf ? 50 : 0);
                stars += `<span class="rating-star-cell" aria-hidden="true"><span class="rating-star empty">★</span><span class="rating-star fill" style="width:${fillPercent}%">★</span></span>`;
            }
            const numericText = options.showNumeric ? ` <span class="rating-value">(${escapeHtml(clamped.toFixed(2))})</span>` : "";
            return `<span class="rating-stars" title="${escapeHtml(clamped.toFixed(2))} / 5" aria-label="${escapeHtml(clamped.toFixed(2))} out of 5 stars">${stars}</span>${numericText}`;
        }

        function fmtTableName(row) {
            const name = row?.vpsdb?.name || "Unknown Table";
            const manufacturer = row?.vpsdb?.manufacturer;
            const year = row?.vpsdb?.year;
            const parts = [manufacturer, year].filter(v => v !== null && v !== undefined && String(v).trim() !== "");
            return parts.length ? `${name} (${parts.join(", ")})` : name;
        }

        function linkTableName(name, vpsId) {
            const text = name === null || name === undefined || name === "" ? "-" : String(name);
            const id = String(vpsId || "").trim();
            if (!id || text === "-") return escapeHtml(text);
            return `<a href="table.html?vpsid=${encodeURIComponent(id)}">${escapeHtml(text)}</a>`;
        }

        function linkVpsId(vpsId) {
            const id = String(vpsId || "").trim();
            if (!id) return "-";
            return `<a href="https://virtualpinballspreadsheet.github.io/games?game=${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(id)}</a>`;
        }

        function linkUserId(userId) {
            const id = String(userId || "").trim();
            if (!id) return "-";
            return `<a href="player.html?userid=${encodeURIComponent(id)}">${escapeHtml(id)}</a>`;
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

        function renderTable(elId, columns, rows) {
            const el = q(elId);
            if (!rows || rows.length === 0) {
                el.innerHTML = `<tr><td class="muted">No data</td></tr>`;
                return;
            }

            let html = "<thead><tr>";
            columns.forEach(col => { html += `<th>${escapeHtml(col.label)}</th>`; });
            html += "</tr></thead><tbody>";

            rows.forEach(row => {
                html += "<tr>";
                columns.forEach(col => {
                    const raw = col.getter(row);
                    const text = raw === null || raw === undefined || raw === "" ? "-" : raw;
                    html += `<td>${col.html ? text : escapeHtml(text)}</td>`;
                });
                html += "</tr>";
            });

            html += "</tbody>";
            el.innerHTML = html;
        }

        function setKpi(id, value, className = "") {
            const el = q(id);
            el.textContent = value;
            el.className = `value ${className}`.trim();
        }

        async function loadAllTablesPage() {
            const result = await api(`/api/v1/tables?limit=${ALL_TABLES_PAGE_SIZE}&offset=${allTablesOffset}`);
            const items = result.ok && Array.isArray(result.data?.items) ? result.data.items : [];
            const pg = result.ok ? (result.data?.pagination || {}) : {};
            allTablesTotal = result.ok ? (pg.total ?? null) : null;

            renderTable("allTablesTable",
                [
                    { label: "Name", getter: r => linkTableName(r.vpsdb?.name || "Unknown Table", r.vpsId), html: true },
                    { label: "Manufacturer", getter: r => r.vpsdb?.manufacturer || "-" },
                    { label: "Year", getter: r => r.vpsdb?.year || "-" },
                    { label: "VPS ID", getter: r => linkVpsId(r.vpsId), html: true },
                    { label: "Filename", getter: r => r.filename || "-" },
                    { label: "Filehash", getter: r => truncateHash(r.filehash, 32) },
                ],
                items
            );

            const pageNumber = Math.floor((pg.offset || 0) / ALL_TABLES_PAGE_SIZE) + 1;
            const total = pg.total || 0;
            const returned = pg.returned || 0;
            const start = total === 0 ? 0 : (pg.offset || 0) + 1;
            const end = (pg.offset || 0) + returned;
            q("allTablesPageInfo").textContent = `Page ${pageNumber} (${start}-${end} of ${total})`;
            q("allTablesPrevBtn").disabled = !pg.hasPrev;
            q("allTablesNextBtn").disabled = !pg.hasNext;
        }

        async function prevAllTablesPage() {
            allTablesOffset = Math.max(0, allTablesOffset - ALL_TABLES_PAGE_SIZE);
            await loadAllTablesPage();
        }

        async function nextAllTablesPage() {
            allTablesOffset = allTablesOffset + ALL_TABLES_PAGE_SIZE;
            await loadAllTablesPage();
        }

        async function loadTopPlayerActivity(metric, days = TOP_PLAYER_DAYS, limit = TOP_PLAYER_LIMIT) {
            const safeLimit = Math.max(1, Math.min(API_PAGE_LIMIT, Number(limit || TOP_PLAYER_LIMIT)));
            const res = await api(`/api/v1/users/top-activity?metric=${encodeURIComponent(metric)}&days=${encodeURIComponent(days)}&limit=${encodeURIComponent(safeLimit)}`);
            return res.ok && Array.isArray(res.data?.items) ? res.data.items : [];
        }

        function parseDashboardLimit() {
            const raw = Number.parseInt(String(q("limitInput").value || "").trim(), 10);
            if (!Number.isFinite(raw) || raw < 1) return 5;
            return Math.min(raw, MAX_DASHBOARD_LIMIT);
        }

        async function fetchPaginatedRows(basePath, requestedLimit) {
            const target = Math.max(1, Number(requestedLimit || 0));
            let offset = 0;
            let remaining = target;
            const items = [];

            while (remaining > 0) {
                const pageLimit = Math.min(API_PAGE_LIMIT, remaining);
                const joiner = basePath.includes("?") ? "&" : "?";
                const res = await api(`${basePath}${joiner}limit=${encodeURIComponent(pageLimit)}&offset=${encodeURIComponent(offset)}`);
                if (!res.ok || !Array.isArray(res.data)) return [];

                const pageItems = res.data;
                items.push(...pageItems);

                if (pageItems.length < pageLimit) break;
                offset += pageItems.length;
                remaining = target - items.length;
            }

            return items.slice(0, target);
        }

        async function refreshDashboard() {
            const limit = parseDashboardLimit();
            q("limitInput").value = String(limit);

            const [
                lastSyncRes,
                vpsdbStatusRes,
                weeklyActivityRes,
                userCountRes,
                tableCountRes,
                topPlayerPlaysRows,
                topPlayerRuntimeRows,
                topRatedRows,
                topPlayTimeRows,
                newlyAddedRows,
                topVariantsRows,
            ] = await Promise.all([
                api("/api/v1/sync/last"),
                api("/api/v1/vpsdb/status"),
                api("/api/v1/tables/activity-weekly?days=7"),
                api("/api/v1/users/count"),
                api("/api/v1/tables/count"),
                loadTopPlayerActivity("startCountPlayed"),
                loadTopPlayerActivity("runTimePlayed"),
                fetchPaginatedRows("/api/v1/tables/top-rated", limit),
                fetchPaginatedRows("/api/v1/tables/top-play-time", limit),
                fetchPaginatedRows("/api/v1/tables/newly-added", limit),
                fetchPaginatedRows("/api/v1/tables/top-variants", limit),
            ]);

            q("lastRefresh").textContent = `Last refresh: ${new Date().toLocaleString()}`;

            q("kpiLastSync").textContent = lastSyncRes.ok ? fmtDate(lastSyncRes.data.lastSyncAt) : "-";
            q("kpiLastSyncUser").textContent = `Last sync by user: ${lastSyncRes.ok ? (lastSyncRes.data.userId || "-") : "-"}`;

            q("kpiTotalTables").textContent = tableCountRes.ok
                ? fmtNumber(tableCountRes.data.totalTableRows)
                : "-";
            q("kpiUserCount").textContent = userCountRes.ok ? fmtNumber(userCountRes.data.userCount) : "-";

            if (vpsdbStatusRes.ok) {
                const statusText = String(vpsdbStatusRes.data.status || "unknown");
                setKpi("kpiVpsdbStatus", statusText, statusText === "ok" ? "status-ok" : "status-bad");
                q("kpiVpsdbMeta").textContent = `records: ${vpsdbStatusRes.data.recordCount ?? "-"} | last: ${fmtDate(vpsdbStatusRes.data.lastSyncAt)}`;
            } else {
                setKpi("kpiVpsdbStatus", "error", "status-bad");
                q("kpiVpsdbMeta").textContent = "Unable to fetch VPSDB status";
            }

            if (weeklyActivityRes.ok) {
                q("kpiRuntimeWeek").textContent = `${fmtNumber(weeklyActivityRes.data.runTimePlayed)} min`;
                q("kpiStartsWeek").textContent = fmtNumber(weeklyActivityRes.data.startCountPlayed);
            } else {
                q("kpiRuntimeWeek").textContent = "-";
                q("kpiStartsWeek").textContent = "-";
            }

            renderTable("topRatedTable",
                [
                    { label: "Table", getter: r => linkTableName(fmtTableName(r), r.vpsId), html: true },
                    { label: "Avg Rating", getter: r => fmtRatingStars(r.avgRating, { showNumeric: true }), html: true },
                    { label: "Rating Count", getter: r => r.ratingCount },
                    { label: "VPS ID", getter: r => linkVpsId(r.vpsId), html: true },
                ],
                topRatedRows
            );

            renderTable("topPlayTimeGlobalTable",
                [
                    { label: "Table", getter: r => linkTableName(fmtTableName(r), r.vpsId), html: true },
                    { label: "Run Time (Total)", getter: r => `${Number(r.runTimeTotal || 0)} min` },
                    { label: "Starts (Total)", getter: r => r.startCountTotal },
                    { label: "Players", getter: r => r.playerCount },
                    { label: "VPS ID", getter: r => linkVpsId(r.vpsId), html: true },
                ],
                topPlayTimeRows
            );

            renderTable("newlyAddedTable",
                [
                    { label: "Table", getter: r => linkTableName(fmtTableName(r), r.vpsId), html: true },
                    { label: "First Seen", getter: r => fmtDate(r.firstSeenAt) },
                    { label: "Variations", getter: r => r.variationCount },
                    { label: "VPS ID", getter: r => linkVpsId(r.vpsId), html: true },
                ],
                newlyAddedRows
            );

            renderTable("topVariantsTable",
                [
                    { label: "Table", getter: r => linkTableName(fmtTableName(r), r.vpsId), html: true },
                    { label: "Variants", getter: r => r.variationCount },
                    { label: "VPS ID", getter: r => linkVpsId(r.vpsId), html: true },
                ],
                topVariantsRows
            );

            q("topPlayerPlaysTitle").textContent = `Top Player Plays (${TOP_PLAYER_DAYS}d)`;
            q("topPlayerPlaytimeTitle").textContent = `Top Player Playtime (${TOP_PLAYER_DAYS}d)`;

            renderTable("topPlayerPlaysTable",
                [
                    { label: "User", getter: r => linkUserId(r.userId), html: true },
                    { label: "Plays", getter: r => fmtNumber(r.startCountPlayed) },
                ],
                topPlayerPlaysRows
            );

            renderTable("topPlayerPlaytimeTable",
                [
                    { label: "User", getter: r => linkUserId(r.userId), html: true },
                    { label: "Run Time", getter: r => `${fmtNumber(r.runTimePlayed)} min` },
                ],
                topPlayerRuntimeRows
            );

            if (ENABLE_ALL_TABLES_PANEL) {
                await loadAllTablesPage();
            }
        }

        document.addEventListener("DOMContentLoaded", () => {
            initTheme();
            if (!ENABLE_ALL_TABLES_PANEL) {
                const allTablesPanel = q("allTablesPanel");
                if (allTablesPanel) allTablesPanel.style.display = "none";
            }
            refreshDashboard();
        });