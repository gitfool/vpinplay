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
        <h3>${escapeHtml(this.getTitle())}</h3>
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

    const res = await api(
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
          <td data-label="Table">${linkTableNameWithVps(
            row.tableTitle || row.vpsdb?.name || "Unknown Table",
            row.vpsId,
          )}</td>
          <td data-label="User">${linkUserId(row.userId)}</td>
          <td data-label="Label">${escapeHtml(row.label || "-")}</td>
          <td data-label="Score">${escapeHtml(fmtLatestScoreValue(row.score))}</td>
          <td data-label="Updated">${escapeHtml(fmtDate(row.updatedAt))}</td>
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
