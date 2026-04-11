class LatestSubmittedScoresPanel extends HTMLElement {
  constructor() {
    super();
    this.limit = 10;
    this.expandedLimit = 100;
    this.isExpanded = false;
    this.handleKeydown = this.handleKeydown.bind(this);
  }

  static get observedAttributes() {
    return ["limit", "title"];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    if (name === "limit") {
      this.limit = this.parseLimit(newValue);
    }

    if (this.isConnected) {
      this.render();
      this.load();
    }
  }

  connectedCallback() {
    this.limit = this.parseLimit(this.getAttribute("limit"));
    this.render();
    window.addEventListener("keydown", this.handleKeydown);
    this.load();
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeydown);
  }

  linkUserId(userId, vpsId) {
    return `<a href="/players?userid=${encodeURIComponent(userId)}&vpsid=${encodeURIComponent(vpsId)}" class="user-link">${userId}</a>`;
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  fmtNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  fmtLatestScoreValue(score) {
    if (!score || typeof score !== "object") return "-";
    const numericValue = score.value ?? score.score;
    if (
      numericValue !== null &&
      numericValue !== undefined &&
      numericValue !== ""
    ) {
      const base = this.fmtNumber(numericValue);
      return score.value_suffix ? `${base} ${score.value_suffix}` : base;
    }
    if (Array.isArray(score.extra_lines) && score.extra_lines.length) {
      return score.extra_lines.join(" | ");
    }
    return "-";
  }

  fmtDate(value) {
    if (!value) return "-";
    const raw = String(value).trim();
    const hasTimeZone = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);
    const normalized = !hasTimeZone && raw.includes("T") ? `${raw}Z` : raw;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  }

  linkTableName(name, vpsId) {
    const text =
      name === null || name === undefined || name === "" ? "-" : String(name);
    const id = String(vpsId || "").trim();
    if (!id || text === "-") return this.escapeHtml(text);
    return `<a href="tables?vpsid=${encodeURIComponent(id)}">${this.escapeHtml(text)}</a>`;
  }

  linkVpsId(vpsId) {
    const id = String(vpsId || "").trim();
    if (!id) return "-";
    const safeId = this.escapeHtml(id);
    return `<a href="https://virtualpinballspreadsheet.github.io/games?game=${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer" aria-label="Open VPS entry for ${safeId}" title="${safeId}"><img src="img/vpsLogo.png" alt="VPS" style="height: 1.15rem; width: auto; vertical-align: middle;"></a>`;
  }

  linkTableNameWithVps(name, vpsId) {
    const tableLink = this.linkTableName(name, vpsId);
    const vpsLink = this.linkVpsId(vpsId);
    if (vpsLink === "-") return tableLink;
    return `<span class="table-name-with-vps"><span class="table-name-link">${tableLink}</span><span class="table-vps-link">${vpsLink}</span></span>`;
  }

  parseLimit(value) {
    const parsed = Number(value || 10);
    if (!Number.isFinite(parsed)) return 10;
    return Math.max(1, Math.min(API_PAGE_LIMIT, Math.floor(parsed)));
  }

  getTitle() {
    return this.getAttribute("title") || "Latest Submitted Scores";
  }

  getCurrentLimit() {
    return this.isExpanded ? this.expandedLimit : this.limit;
  }

  handleKeydown(event) {
    if (event.key === "Escape" && this.isExpanded) {
      this.toggleExpanded(false);
    }
  }

  toggleExpanded(force) {
    this.isExpanded = typeof force === "boolean" ? force : !this.isExpanded;
    this.classList.toggle("is-expanded", this.isExpanded);

    const button = this.querySelector(".panel-expand-btn");
    if (button) {
      button.setAttribute("aria-expanded", this.isExpanded ? "true" : "false");
      button.setAttribute(
        "aria-label",
        `${this.isExpanded ? "Collapse" : "Expand"} Latest Submitted Scores panel`,
      );
    }

    document.body.classList.toggle(
      "latest-scores-overlay-open",
      this.isExpanded,
    );

    this.load();
  }

  render() {
    this.innerHTML = `
      <div class="panel-heading">
        <h3>${this.escapeHtml(this.getTitle())}</h3>
        <button
          class="panel-expand-btn"
          type="button"
          aria-expanded="${this.isExpanded ? "true" : "false"}"
          aria-label="${this.isExpanded ? "Collapse" : "Expand"} Latest Submitted Scores panel"
        >
          <span class="panel-expand-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M7 3H3v4M13 3h4v4M17 13v4h-4M3 13v4h4"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </svg>
          </span>
        </button>
      </div>
      <div class="panel-expanded-note">${this.isExpanded ? "Expanded view showing more entries." : ""}</div>
      <table></table>
    `;

    const expandButton = this.querySelector(".panel-expand-btn");
    if (expandButton) {
      expandButton.addEventListener("click", () => this.toggleExpanded());
    }
  }

  async api(path) {
    try {
      const response = await fetch(`${API_BASE}${path}`);
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      return { ok: false, status: 0, data: { error: error.message } };
    }
  }

  async load() {
    const table = this.querySelector("table");
    const expandedNote = this.querySelector(".panel-expanded-note");
    if (!table) return;

    table.innerHTML = `<tr><td class="muted">Loading...</td></tr>`;
    if (expandedNote) {
      expandedNote.textContent = this.isExpanded
        ? "Expanded view showing more entries."
        : "";
    }

    const res = await this.api(
      `/api/v1/users/scores/latest?limit=${encodeURIComponent(this.getCurrentLimit())}&offset=0`,
    );

    const rows = res.ok && Array.isArray(res.data?.items) ? res.data.items : [];

    if (!rows.length) {
      table.innerHTML = `<tr><td class="muted">No data</td></tr>`;
      return;
    }

    let html = `
      <thead>
        <tr>
          <th>Table</th>
          <th>User</th>
          <th>Label</th>
          <th>Score</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
    `;

    rows.forEach((row) => {
      html += `
        <tr>
          <td data-label="Table">${this.linkTableNameWithVps(
            row.tableTitle || row.vpsdb?.name || "Unknown Table",
            row.vpsId,
          )}</td>
          <td data-label="User">${this.linkUserId(row.userId, row.vpsId)}</td>
          <td data-label="Label">${this.escapeHtml(row.label || "-")}</td>
          <td data-label="Score">${this.escapeHtml(this.fmtLatestScoreValue(row.score))}</td>
          <td data-label="Updated">${this.escapeHtml(this.fmtDate(row.updatedAt))}</td>
        </tr>
      `;
    });

    html += "</tbody>";
    table.innerHTML = html;
  }
}

customElements.define(
  "latest-submitted-scores-panel",
  LatestSubmittedScoresPanel,
);
