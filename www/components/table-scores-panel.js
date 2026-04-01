class TableScoresPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.vpsId = null;
    this.apiBase = null;
  }

  static get observedAttributes() {
    return ["vps-id", "api-base"];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      if (name === "vps-id") {
        this.vpsId = newValue;
      } else if (name === "api-base") {
        this.apiBase = newValue.replace(/\/$/, "");
      }
      if (this.vpsId) this.loadPanel();
    }
  }

  connectedCallback() {
    this.render();
    const urlParams = new URLSearchParams(window.location.search);
    this.vpsId = this.getAttribute("vps-id") || urlParams.get("vpsid");
    this.apiBase = (
      this.getAttribute("api-base") || "https://api.vpinplay.com:8888"
    ).replace(/\/$/, "");
    if (this.vpsId) this.loadPanel();
  }

  render() {
    this.shadowRoot.innerHTML = `
    <link rel="stylesheet" href="css/table-scores-panel.css">
    <div class="scoreboard-title">Scoreboard</div>
    <div class="status" id="status" hidden>Ready.</div>
    <div class="grid-score-panels" id="grid-score-panels"></div>
  `;
  }

  // Utility functions (adapted from source files)
  q(id) {
    return this.shadowRoot.getElementById(id);
  }

  setStatus(message, tone = "info") {
    const el = this.q("status");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    el.className = `status ${tone}`;
  }

  clearStatus() {
    const el = this.q("status");
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
    el.className = "status";
  }

  scoreText(entry) {
    if (entry.score !== null && entry.score !== undefined) {
      // Use the global fmtNumber
      const base = window.fmtNumber(entry.score);
      return entry.value_suffix ? `${base} ${entry.value_suffix}` : base;
    }
    if (Array.isArray(entry.extra_lines) && entry.extra_lines.length) {
      return entry.extra_lines.join(" | ");
    }
    return "-";
  }

  numericScore(entry) {
    const num = Number(entry?.score);
    return Number.isFinite(num) ? num : null;
  }

  compareEntries(a, b) {
    const aScore = this.numericScore(a);
    const bScore = this.numericScore(b);
    if (aScore !== null && bScore !== null && aScore !== bScore) {
      return bScore - aScore;
    }
    if (aScore !== null && bScore === null) return -1;
    if (aScore === null && bScore !== null) return 1;

    const aRank = Number(a?.rank);
    const bRank = Number(b?.rank);
    const hasARank = Number.isFinite(aRank);
    const hasBRank = Number.isFinite(bRank);
    if (hasARank && hasBRank && aRank !== bRank) {
      return aRank - bRank;
    }
    if (hasARank && !hasBRank) return -1;
    if (!hasARank && hasBRank) return 1;

    const aMatched = a?.matchedUserId ? 1 : 0;
    const bMatched = b?.matchedUserId ? 1 : 0;
    if (aMatched !== bMatched) {
      return bMatched - aMatched;
    }

    return String(a?.updatedAt || "").localeCompare(String(b?.updatedAt || ""));
  }

  groupEntries(entries) {
    const groups = new Map();
    for (const entry of entries) {
      const section = String(entry.section || "").trim() || "Other";
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push(entry);
    }
    for (const [section, sectionEntries] of groups.entries()) {
      groups.set(
        section,
        sectionEntries.slice().sort(this.compareEntries.bind(this)),
      );
    }
    return groups;
  }

  getPreferredSectionOrder(groups) {
    const sections = [...groups.keys()].sort((a, b) => {
      if (a === "GRAND CHAMPION") return -1;
      if (b === "GRAND CHAMPION") return 1;
      return a.localeCompare(b);
    });

    return sections;
  }

  scoreOwnerLabel(entry) {
    if (
      typeof entry?.matchedUserId === "string" &&
      entry.matchedUserId.trim()
    ) {
      return entry.matchedUserId.trim();
    }
    if (typeof entry?.initials === "string" && entry.initials.trim()) {
      return entry.initials.trim();
    }
    return "";
  }

  setSectionTitle(id, text) {
    const el = this.q(id);
    if (el) el.textContent = text;
  }

  async api(path) {
    try {
      const response = await fetch(`${this.apiBase}${path}`);
      const data = await response.json().catch(() => []);
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      return { ok: false, status: 0, data: { error: error.message } };
    }
  }

  async fetchBestEverScoreItems() {
    const items = [];
    const PAGE_SIZE = 500; // Consistent page size
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await this.api(
        `/api/v1/users/scores/best-ever?vpsId=${encodeURIComponent(this.vpsId)}&limit=${PAGE_SIZE}&offset=${offset}`,
      );
      const pageItems = Array.isArray(result.data?.items)
        ? result.data.items
        : null;
      if (!result.ok || !pageItems) {
        return {
          ok: false,
          status: result.status,
          error: result.data?.error || "Request failed",
          items,
        };
      }
      items.push(...pageItems);
      if (pageItems.length < PAGE_SIZE) break;
    }
    return { ok: true, items };
  }

  normalizeBestEverItems(items) {
    return items
      .filter((item) => item && item.score && typeof item.score === "object")
      .map((item) => {
        // Need to normalize section name from either score.section or score.score_type
        const section = item.score.section || item.score.score_type || "Other";

        return {
          ...item.score,
          section,
          matchedUserId: typeof item.userId === "string" ? item.userId : "",
          updatedAt: item.updatedAt || null,
          vpsdb: item.vpsdb,
          tableTitle: item.tableTitle,
          // Handle where we get score value from, either 'value' or 'score' field
          score: item.score.score ?? item.score.value ?? null,
        };
      });
  }

  renderDynamicSections(groups, orderedSections) {
    const gridPanels = this.q("grid-score-panels");
    if (!gridPanels) return;

    gridPanels.innerHTML = "";

    orderedSections.forEach((sectionName) => {
      const entries = groups.get(sectionName) || [];
      if (!entries.length) return;

      const isGrandChampion = sectionName === "GRAND CHAMPION";
      const cardClass = isGrandChampion ? "score-card hero" : "score-card";

      const card = document.createElement("section");
      card.className = cardClass;
      card.innerHTML = `
      <div class="score-card-title">${sectionName}</div>
      <div class="score-card-body"></div>
    `;

      const body = card.querySelector(".score-card-body");

      if (isGrandChampion) {
        this.renderGrandChampionInline(body, entries[0]);
      } else {
        this.renderRankedListInline(body, entries);
      }

      gridPanels.appendChild(card);
    });
  }

  renderGrandChampionInline(host, entry) {
    if (!entry) {
      host.className = "hero-empty";
      host.textContent = "No grand champion entry found.";
      return;
    }
    host.innerHTML = `
    <div class="grand-initials">${this.scoreOwnerLabel(entry)}</div>
    <div class="grand-score">${this.scoreText(entry)}</div>
  `;
  }

  renderRankedListInline(host, entries) {
    if (!entries.length) {
      host.innerHTML = `<div class="empty-state">No entries available.</div>`;
      return;
    }
    host.innerHTML = `
    <div class="score-list">
      ${entries
        .map(
          (entry, index) => `
        <div class="score-row">
          <div class="score-rank">#${index + 1}</div>
          <div class="score-initials">${this.scoreOwnerLabel(entry)}</div>
          <div class="score-value">${this.scoreText(entry)}</div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
  }

  async loadPanel() {
    if (!this.vpsId) return;

    this.setStatus(`Loading global score data for ${this.vpsId}...`);
    const bestEverResult = await this.fetchBestEverScoreItems();

    if (!bestEverResult.ok) {
      this.setStatus(
        `Failed to load score data (${bestEverResult.status || "network"}).`,
        "error",
      );
      const gridPanels = this.q("grid-score-panels");
      if (gridPanels) gridPanels.innerHTML = "";
      return;
    }

    const items = bestEverResult.items.filter(
      (item) =>
        item &&
        String(item.vpsId || "")
          .trim()
          .toLowerCase() ===
          String(this.vpsId || "")
            .trim()
            .toLowerCase(),
    );

    if (!items.length) {
      this.setStatus(
        `No historical matched score entries were found for ${this.vpsId}.`,
        "error",
      );
      const gridPanels = this.q("grid-score-panels");
      if (gridPanels) gridPanels.innerHTML = "";
      return;
    }

    const entries = this.normalizeBestEverItems(items);
    const groups = this.groupEntries(entries);
    const orderedSections = this.getPreferredSectionOrder(groups);

    this.renderDynamicSections(groups, orderedSections);

    const grid = this.q("score-panel-grid");
    if (grid) grid.hidden = false;
    this.clearStatus();
  }
}
customElements.define("table-scores-panel", TableScoresPanel);
