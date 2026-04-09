async function refreshDashboard() {
  const header = document.querySelector("vpinplay-header");
  if (header) header.setRefreshing(true);

  try {
    const params = new URLSearchParams(window.location.search);
    const vpsId = (params.get("vpsid") || "").trim();

    const gridPanels = document.querySelector(".grid-panels");
    if (gridPanels) {
      if (vpsId) {
        gridPanels.classList.add("show");
      } else {
        gridPanels.classList.remove("show");
      }
    }

    const scoresPanel = document.querySelector("table-scores-panel");
    if (scoresPanel) {
      scoresPanel.setAttribute("vps-id", vpsId);
    }

    const detailsPanel = document.querySelector("table-details-panel");
    if (detailsPanel) {
      detailsPanel.setAttribute("vps-id", vpsId);
    }

    const metadataPanel = document.querySelector("tables-metadata");
    if (metadataPanel) {
      metadataPanel.setAttribute("vps-id", vpsId);
    }

    const playerRatings = document.querySelector("player-ratings");
    if (playerRatings) {
      playerRatings.setAttribute("vps-id", vpsId);
    }

    const playerRuntimes = document.querySelector("player-runtimes");
    if (playerRuntimes) {
      playerRuntimes.setAttribute("vps-id", vpsId);
    }
  } finally {
    if (header) {
      header.markRefresh();
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await customElements.whenDefined("vpinplay-header");

  refreshDashboard();
});
