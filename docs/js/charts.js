/* Finances partis FR — filtres, classements, petits multiples, tableaux.
   Chiffres lus dans les JSON CNCCFP du dépôt. Aucune valeur inventée. */
(function () {
  "use strict";

  const METRICS = [
    { id: "somme_emprunts_eur", label: "Emprunts financiers", short: "Emprunts" },
    { id: "dettes_passif_total_III_eur", label: "Total III du passif", short: "Total III" },
    { id: "cotisations_adherents_eur", label: "Cotisations adhérents", short: "Cotisations" },
    { id: "dons_eur", label: "Dons", short: "Dons" },
    { id: "aide_publique_eur", label: "Aide publique", short: "Aide publique" },
  ];

  const SHORT = {
    upr: "UPR",
    rn: "RN",
    lr: "LR",
    ps: "PS",
    lfi: "LFI",
    renaissance: "Renaissance",
    eelv: "Écologistes",
    pcf: "PCF",
    dlf: "DLF",
    reconquete: "Reconquête",
    modem: "MoDem",
    lo: "LO",
    generations: "Génération.s",
    sp: "S&P",
    resistons: "Résistons",
  };

  const COLORS = {
    upr: "#ff6b35",
    rn: "#0a3d6b",
    lr: "#1e3a8a",
    ps: "#e11d48",
    lfi: "#b91c1c",
    renaissance: "#d97706",
    eelv: "#16a34a",
    pcf: "#dc2626",
    dlf: "#7c3aed",
    reconquete: "#1e293b",
    modem: "#ea580c",
    lo: "#991b1b",
    generations: "#db2777",
    sp: "#64748b",
    resistons: "#0284c7",
  };

  const AXIS = "#475569";
  const GRID = "rgba(15, 23, 42, 0.12)";
  const MAX_LINES = 4;

  const state = {
    parties: new Set(),
    yearFrom: 2017,
    yearTo: 2024,
    focusYear: 2024,
    metric: METRICS[0].id,
    mode: "rank",
    log: false,
    sortMatrix: { key: "2024", dir: "desc" },
    sortMetrics: { key: METRICS[0].id, dir: "desc" },
  };

  let store = {
    rows: [],
    partis: [],
    years: [],
    libelles: {},
    glossaire: [],
    couverture: {},
    exercice2025: null,
    elections: null,
    officiels: {},
    dataset: "https://www.data.gouv.fr/datasets/comptes-des-partis-et-groupements-politiques",
    compteSources: [],
  };
  const elecSort = { key: "voix", dir: "desc" };
  const charts = [];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function safeUrl(u) {
    try {
      const url = new URL(u, window.location.href);
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch (e) { /* ignore */ }
    return "";
  }

  function eur(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  }

  function formatAxis(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    const abs = Math.abs(n);
    if (abs >= 1e6) {
      return (
        (n / 1e6).toLocaleString("fr-FR", {
          maximumFractionDigits: abs >= 1e7 ? 0 : 1,
        }) + " M€"
      );
    }
    if (abs >= 1e3) {
      return (
        (n / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " k€"
      );
    }
    return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
  }

  function partyById(id) {
    return store.partis.find((p) => p.id === id);
  }

  function partyName(p) {
    const names = (p && p.noms_historiques) || [];
    if (names.length) return names[names.length - 1];
    return (p && p.id) || "";
  }

  function shortName(id) {
    if (SHORT[id]) return SHORT[id];
    const p = partyById(id);
    return p ? partyName(p) : id;
  }

  function colorOf(id) {
    return COLORS[id] || "#64748b";
  }

  function metricById(id) {
    return METRICS.find((m) => m.id === id) || METRICS[0];
  }

  function yearsInRange() {
    const out = [];
    for (let y = state.yearFrom; y <= state.yearTo; y += 1) out.push(y);
    return out;
  }

  function selectedParties() {
    return store.partis.filter((p) => state.parties.has(p.id));
  }

  function valueAt(partyId, year, metric) {
    const row = store.rows.find((r) => r.party_id === partyId && r.year === year);
    if (!row || row[metric] == null || Number.isNaN(Number(row[metric]))) return null;
    return Number(row[metric]);
  }

  function destroyCharts() {
    while (charts.length) {
      const c = charts.pop();
      try { c.destroy(); } catch (e) { /* already gone */ }
    }
  }

  function applyLightDefaults() {
    if (typeof Chart === "undefined") return;
    Chart.defaults.color = "#334155";
    Chart.defaults.borderColor = GRID;
    Chart.defaults.backgroundColor = "#ffffff";
    Chart.defaults.font.family = '"Segoe UI", system-ui, sans-serif';
    if (Chart.defaults.scale) {
      Chart.defaults.scale.grid = Chart.defaults.scale.grid || {};
      Chart.defaults.scale.grid.color = GRID;
      Chart.defaults.scale.ticks = Chart.defaults.scale.ticks || {};
      Chart.defaults.scale.ticks.color = AXIS;
    }
    const tip = Chart.defaults.plugins && Chart.defaults.plugins.tooltip;
    if (tip) {
      tip.backgroundColor = "#ffffff";
      tip.titleColor = "#1e293b";
      tip.bodyColor = "#334155";
      tip.borderColor = "#d5dee8";
      tip.borderWidth = 1;
    }
  }

  const whiteBackground = {
    id: "whiteBackground",
    beforeDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    },
  };

  function tooltipOptions() {
    return {
      backgroundColor: "#ffffff",
      titleColor: "#1e293b",
      bodyColor: "#334155",
      borderColor: "#d5dee8",
      borderWidth: 1,
      callbacks: {
        label(ctx) {
          const raw = ctx.dataset.rawValues
            ? ctx.dataset.rawValues[ctx.dataIndex]
            : null;
          const v = raw != null ? raw : (ctx.parsed.x != null && ctx.dataset.indexAxis === "y"
            ? ctx.parsed.x
            : ctx.parsed.y);
          if (v == null || Number.isNaN(v)) return ctx.dataset.label + " : —";
          return ctx.dataset.label + " : " + eur(v);
        },
      },
    };
  }

  function valueScale(log, min, max) {
    if (log) {
      const positiveMin = min > 0 ? min : 1;
      const positiveMax = max > 0 ? max : positiveMin * 10;
      const lo = positiveMin / 10;
      const hi = positiveMax > positiveMin ? positiveMax * 1.15 : positiveMin * 10;
      return {
        type: "logarithmic",
        min: lo,
        max: hi,
        ticks: {
          color: AXIS,
          maxRotation: 0,
          callback(value, index, ticks) {
            const n = Number(value);
            if (!Number.isFinite(n) || n <= 0) return "";
            const tick = ticks && ticks[index];
            if (tick && tick.major === false) return "";
            return formatAxis(n);
          },
        },
        grid: { color: GRID },
      };
    }
    return {
      type: "linear",
      min: 0,
      max: max > 0 ? max : 1,
      ticks: {
        color: AXIS,
        maxRotation: 0,
        callback: (v) => formatAxis(v),
      },
      grid: { color: GRID },
    };
  }

  function categoryScale() {
    return {
      ticks: { color: "#334155", autoSkip: false, maxRotation: 0 },
      grid: { display: false },
    };
  }

  function mountChart(canvas, config) {
    const chart = new Chart(canvas, config);
    charts.push(chart);
    return chart;
  }

  function sharedExtent(log) {
    const vals = [];
    selectedParties().forEach((p) => {
      yearsInRange().forEach((y) => {
        const v = valueAt(p.id, y, state.metric);
        if (v == null) return;
        if (log && !(v > 0)) return;
        vals.push(v);
      });
    });
    if (!vals.length) return { min: log ? 1 : 0, max: log ? 10 : 1, empty: true };
    return { min: Math.min(...vals), max: Math.max(...vals), empty: false };
  }

  function seriesFor(partyId, log) {
    const years = yearsInRange();
    const raw = years.map((y) => valueAt(partyId, y, state.metric));
    const data = raw.map((v) => {
      if (v == null) return null;
      if (log && !(v > 0)) return null;
      return v;
    });
    return { raw, data, years };
  }

  function renderRank(panel) {
    const log = state.log;
    const ranked = selectedParties()
      .map((p) => ({ p, v: valueAt(p.id, state.focusYear, state.metric) }))
      .filter((d) => d.v != null && (!log || d.v > 0))
      .sort((a, b) => b.v - a.v || shortName(a.p.id).localeCompare(shortName(b.p.id), "fr"));

    const missing = selectedParties().filter((p) => valueAt(p.id, state.focusYear, state.metric) == null);
    const zeros = selectedParties().filter((p) => valueAt(p.id, state.focusYear, state.metric) === 0);

    if (!ranked.length) {
      panel.dataset.chart = "empty";
      panel.innerHTML = '<p class="empty">Aucun montant affichable pour cette année, cette métrique et cette sélection.</p>';
      return;
    }

    const height = Math.max(300, ranked.length * 34 + 72);
    panel.dataset.chart = "bar";
    panel.innerHTML =
      '<div class="chart-wrap" style="height:' + height + 'px">' +
      '<canvas id="chart-rank" aria-label="Classement en barres horizontales"></canvas></div>';
    const max = Math.max(...ranked.map((d) => d.v));
    const padded = max === 0 ? 1 : max * 1.06;
    mountChart(document.getElementById("chart-rank"), {
      type: "bar",
      plugins: [whiteBackground],
      data: {
        labels: ranked.map((d) => shortName(d.p.id)),
        datasets: [{
          label: metricById(state.metric).label,
          data: ranked.map((d) => d.v),
          rawValues: ranked.map((d) => d.v),
          backgroundColor: ranked.map((d) => colorOf(d.p.id)),
          borderColor: ranked.map((d) => colorOf(d.p.id)),
          borderWidth: 1,
          maxBarThickness: 22,
          indexAxis: "y",
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: tooltipOptions(),
        },
        scales: {
          x: valueScale(log, Math.min(...ranked.map((d) => d.v)), log ? max : padded),
          y: categoryScale(),
        },
      },
    });

    const notes = [];
    if (missing.length) {
      notes.push("Sans montant publié pour " + state.focusYear + " : " + missing.map((p) => shortName(p.id)).join(", ") + ".");
    }
    if (log && zeros.length) {
      notes.push("À 0 €, donc absents du graphique logarithmique : " + zeros.map((p) => shortName(p.id)).join(", ") + ".");
    }
    if (notes.length) {
      panel.insertAdjacentHTML("beforeend", '<p class="chart-note">' + esc(notes.join(" ")) + "</p>");
    }
  }

  function renderMultiples(panel) {
    const parties = selectedParties();
    if (!parties.length) {
      panel.dataset.chart = "empty";
      panel.innerHTML = '<p class="empty">Sélectionnez au moins un parti.</p>';
      return;
    }
    const extent = sharedExtent(state.log);
    panel.dataset.chart = "multiples";
    const cards = parties.map((p) => {
      return (
        '<figure class="mini">' +
        "<h3>" + esc(shortName(p.id)) + "</h3>" +
        '<div class="chart-wrap"><canvas id="chart-' + esc(p.id) + '" aria-label="Évolution de ' + esc(shortName(p.id)) + '"></canvas></div>' +
        "</figure>"
      );
    }).join("");
    panel.innerHTML =
      '<p class="chart-note">Échelle verticale commune à tous les graphiques.</p>' +
      '<div class="multiples">' + cards + "</div>";

    parties.forEach((p) => {
      const series = seriesFor(p.id, state.log);
      const scale = valueScale(
        state.log,
        extent.min,
        state.log ? extent.max : (extent.max > 0 ? extent.max * 1.05 : 1)
      );
      scale.ticks.font = { size: 10 };
      scale.ticks.maxTicksLimit = 4;
      mountChart(document.getElementById("chart-" + p.id), {
        type: "line",
        plugins: [whiteBackground],
        data: {
          labels: series.years,
          datasets: [{
            label: shortName(p.id),
            data: series.data,
            rawValues: series.raw,
            borderColor: colorOf(p.id),
            backgroundColor: "transparent",
            borderWidth: 2,
            tension: 0,
            spanGaps: false,
            pointRadius: 2,
            pointHoverRadius: 4,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: tooltipOptions(),
          },
          scales: {
            x: {
              ticks: { color: AXIS, maxRotation: 0, font: { size: 10 } },
              grid: { color: "rgba(15, 23, 42, 0.08)" },
            },
            y: scale,
          },
        },
      });
    });
  }

  function renderEvolution(panel) {
    const parties = selectedParties();
    if (!parties.length) {
      panel.dataset.chart = "empty";
      panel.innerHTML = '<p class="empty">Sélectionnez au moins un parti.</p>';
      return;
    }
    if (parties.length > MAX_LINES) {
      panel.dataset.chart = "blocked";
      panel.innerHTML =
        '<p class="empty">L’évolution superposée est limitée à ' + MAX_LINES +
        " partis, pour éviter un graphique illisible. " +
        parties.length + " sont cochés : décochez-en dans le filtre, ou passez aux petits multiples.</p>";
      return;
    }
    const extent = sharedExtent(state.log);
    if (extent.empty) {
      panel.dataset.chart = "empty";
      panel.innerHTML = '<p class="empty">Aucun montant affichable pour cette sélection.</p>';
      return;
    }
    panel.dataset.chart = "lines";
    panel.innerHTML =
      '<div class="chart-wrap" style="height:440px">' +
      '<canvas id="chart-evo" aria-label="Évolution des partis sélectionnés"></canvas></div>';
    const years = yearsInRange();
    const scale = valueScale(state.log, extent.min, state.log ? extent.max : extent.max * 1.05);
    mountChart(document.getElementById("chart-evo"), {
      type: "line",
      plugins: [whiteBackground],
      data: {
        labels: years,
        datasets: parties.map((p) => {
          const series = seriesFor(p.id, state.log);
          return {
            label: shortName(p.id),
            data: series.data,
            rawValues: series.raw,
            borderColor: colorOf(p.id),
            backgroundColor: "transparent",
            borderWidth: 2,
            tension: 0,
            spanGaps: false,
            pointRadius: 3,
            pointHoverRadius: 5,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: "#334155", boxWidth: 14, padding: 10 },
          },
          tooltip: tooltipOptions(),
        },
        scales: {
          x: {
            ticks: { color: AXIS, maxRotation: 0 },
            grid: { color: GRID },
          },
          y: scale,
        },
      },
    });
  }

  function renderChart() {
    const panel = document.getElementById("chart-panel");
    if (!panel) return;
    destroyCharts();
    panel.dataset.mode = state.mode;
    if (typeof Chart === "undefined") {
      panel.dataset.chart = "empty";
      panel.innerHTML = '<p class="error">Chart.js n’a pas pu être chargé.</p>';
      return;
    }
    if (state.mode === "multiples") renderMultiples(panel);
    else if (state.mode === "evolution") renderEvolution(panel);
    else renderRank(panel);

    const hint = document.getElementById("log-hint");
    if (hint) hint.hidden = !state.log;
  }

  function arrow(sort, key) {
    if (sort.key !== key) return "";
    return sort.dir === "asc" ? " ▲" : " ▼";
  }

  function ariaSort(sort, key) {
    if (sort.key !== key) return "none";
    return sort.dir === "asc" ? "ascending" : "descending";
  }

  function compareNullable(av, bv, dir) {
    const aMissing = av == null || Number.isNaN(av);
    const bMissing = bv == null || Number.isNaN(bv);
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    const diff = av - bv;
    return dir === "asc" ? diff : -diff;
  }

  function sortedParties(sort, valueFor) {
    const rows = selectedParties().slice();
    rows.sort((a, b) => {
      if (sort.key === "party") {
        const c = partyName(a).localeCompare(partyName(b), "fr", { sensitivity: "base" });
        return sort.dir === "asc" ? c : -c;
      }
      const byVal = compareNullable(valueFor(a), valueFor(b), sort.dir);
      if (byVal) return byVal;
      return partyName(a).localeCompare(partyName(b), "fr", { sensitivity: "base" });
    });
    return rows;
  }

  function headerCell(sort, key, label, extraClass) {
    return (
      '<th scope="col" class="' + (extraClass || "") + '" aria-sort="' + ariaSort(sort, key) + '">' +
      '<button type="button" data-sort="' + esc(key) + '">' + esc(label) + arrow(sort, key) + "</button></th>"
    );
  }

  function renderMatrix() {
    const table = document.getElementById("table-matrix");
    const title = document.getElementById("matrix-title");
    if (!table) return;
    const years = yearsInRange();
    const metric = metricById(state.metric);
    if (title) {
      title.textContent = metric.label + " — parti × année (" + state.yearFrom + "–" + state.yearTo + ")";
    }
    if (state.sortMatrix.key !== "party" && years.indexOf(Number(state.sortMatrix.key)) === -1) {
      state.sortMatrix = { key: String(state.focusYear), dir: "desc" };
    }
    const rows = sortedParties(state.sortMatrix, (p) => {
      if (state.sortMatrix.key === "party") return null;
      return valueAt(p.id, Number(state.sortMatrix.key), state.metric);
    });
    const head = "<tr>" + headerCell(state.sortMatrix, "party", "Parti") +
      years.map((y) => headerCell(
        state.sortMatrix,
        String(y),
        String(y),
        y === state.focusYear ? "is-focus" : ""
      )).join("") + "</tr>";
    const body = rows.length
      ? rows.map((p) => {
        const cells = years.map((y) => {
          const v = valueAt(p.id, y, state.metric);
          const cls = "num" + (y === state.focusYear ? " is-focus" : "");
          return '<td class="' + cls + '">' + esc(eur(v)) + "</td>";
        }).join("");
        return "<tr><th scope=\"row\" class=\"party\">" + esc(partyName(p)) + "</th>" + cells + "</tr>";
      }).join("")
      : '<tr><td colspan="' + (years.length + 1) + '">Aucun parti sélectionné.</td></tr>';
    table.innerHTML =
      "<caption>Champ " + esc(state.metric) + ". Tri en cliquant sur un en-tête.</caption>" +
      "<thead>" + head + "</thead><tbody>" + body + "</tbody>";
  }

  function renderMetricTable() {
    const table = document.getElementById("table-metrics");
    const title = document.getElementById("metrics-title");
    if (!table) return;
    if (title) title.textContent = "Toutes les métriques en " + state.focusYear;
    const rows = sortedParties(state.sortMetrics, (p) => {
      if (state.sortMetrics.key === "party") return null;
      return valueAt(p.id, state.focusYear, state.sortMetrics.key);
    });
    const head = "<tr>" + headerCell(state.sortMetrics, "party", "Parti") +
      METRICS.map((m) => headerCell(
        state.sortMetrics,
        m.id,
        m.short,
        m.id === state.metric ? "is-focus" : ""
      )).join("") + "</tr>";
    const body = rows.length
      ? rows.map((p) => {
        const cells = METRICS.map((m) => {
          const v = valueAt(p.id, state.focusYear, m.id);
          const cls = "num" + (m.id === state.metric ? " is-focus" : "");
          return '<td class="' + cls + '">' + esc(eur(v)) + "</td>";
        }).join("");
        return "<tr><th scope=\"row\" class=\"party\">" + esc(partyName(p)) + "</th>" + cells + "</tr>";
      }).join("")
      : '<tr><td colspan="' + (METRICS.length + 1) + '">Aucun parti sélectionné.</td></tr>';
    table.innerHTML =
      "<caption>Exercice " + state.focusYear + ". La colonne surlignée est la métrique du graphique.</caption>" +
      "<thead>" + head + "</thead><tbody>" + body + "</tbody>";
  }

  function sourceAnchor(href, label) {
    const url = safeUrl(href);
    if (!url) return esc(label);
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label) + "</a>";
  }

  function fileForYear(year) {
    return (store.compteSources || []).find((item) => item.annee === year) || null;
  }

  function comptesSourceHtml(years) {
    const dataset = sourceAnchor(store.dataset, "Comptes des partis et groupements politiques");
    const list = (years || []).filter((year, index, all) => all.indexOf(year) === index);
    if (list.length === 1) {
      const file = fileForYear(list[0]);
      const fileLink = file ? sourceAnchor(file.url, "fichier exercice " + list[0]) : "";
      return "Source : CNCCFP — " + dataset + (fileLink ? " · " + fileLink : "") + ".";
    }
    const from = list[0];
    const to = list[list.length - 1];
    return "Source : CNCCFP — " + dataset +
      " · exercices " + from + "–" + to + " · " +
      sourceAnchor("sources.html#comptes", "un fichier par exercice") + ".";
  }

  function renderSourceLines() {
    const chart = document.getElementById("chart-source");
    const matrix = document.getElementById("matrix-source");
    const metrics = document.getElementById("metrics-source");
    const chartYears = state.mode === "rank" ? [state.focusYear] : yearsInRange();
    if (chart) chart.innerHTML = comptesSourceHtml(chartYears);
    if (matrix) matrix.innerHTML = comptesSourceHtml(yearsInRange());
    if (metrics) metrics.innerHTML = comptesSourceHtml([state.focusYear]);
    const file = fileForYear(state.focusYear);
    const fileLink = document.getElementById("compte-fichier");
    if (fileLink && file) {
      fileLink.href = file.url;
      fileLink.textContent = "exercice " + state.focusYear;
    }
  }

  function renderStatus() {
    const metric = metricById(state.metric);
    const n = selectedParties().length;
    const modeLabel = state.mode === "multiples"
      ? "Petits multiples"
      : state.mode === "evolution"
        ? "Évolution"
        : "Classement";
    const el = document.getElementById("view-status");
    if (el) {
      el.textContent = modeLabel + " · " + metric.label + " · " +
        (state.mode === "rank" ? String(state.focusYear) : state.yearFrom + "–" + state.yearTo) +
        " · " + n + (n > 1 ? " partis" : " parti");
    }
    const count = document.getElementById("party-count");
    if (count) count.textContent = n + " / " + store.partis.length + " partis";
    const hint = document.getElementById("metric-hint");
    if (hint) {
      const fromJson = store.libelles[state.metric];
      hint.textContent = fromJson || ("Champ " + state.metric + " des comptes annuels CNCCFP.");
    }
  }

  function render() {
    renderStatus();
    renderChart();
    renderMatrix();
    renderMetricTable();
    renderSourceLines();
  }

  function renderTables() {
    renderMatrix();
    renderMetricTable();
  }

  function bindSort(tableId, sort) {
    const table = document.getElementById(tableId);
    if (!table) return;
    table.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-sort]");
      if (!btn) return;
      const key = btn.dataset.sort;
      if (sort.key === key) sort.dir = sort.dir === "asc" ? "desc" : "asc";
      else {
        sort.key = key;
        sort.dir = key === "party" ? "asc" : "desc";
      }
      renderTables();
    });
  }

  function setAllParties(on) {
    state.parties = on ? new Set(store.partis.map((p) => p.id)) : new Set();
    document.querySelectorAll("#party-filters input").forEach((el) => {
      el.checked = on;
    });
    render();
  }

  function fillSelect(id, options, value) {
    const el = document.getElementById(id);
    el.innerHTML = options.map((o) =>
      '<option value="' + esc(o.value) + '">' + esc(o.label) + "</option>"
    ).join("");
    el.value = String(value);
  }

  function syncFocusOptions(keep) {
    const years = yearsInRange();
    const next = years.indexOf(keep) !== -1 ? keep : years[years.length - 1];
    state.focusYear = next;
    fillSelect("year-focus", years.map((y) => ({ value: y, label: String(y) })), next);
    state.sortMatrix = { key: String(next), dir: "desc" };
  }

  function buildFilters() {
    const host = document.getElementById("party-filters");
    host.innerHTML = store.partis.map((p) =>
      '<label title="' + esc(partyName(p)) + '">' +
      '<input type="checkbox" value="' + esc(p.id) + '" checked> ' +
      esc(shortName(p.id)) + "</label>"
    ).join("");
    state.parties = new Set(store.partis.map((p) => p.id));

    fillSelect("metric", METRICS.map((m) => ({ value: m.id, label: m.label })), state.metric);
    const yearOpts = store.years.map((y) => ({ value: y, label: String(y) }));
    fillSelect("year-from", yearOpts, state.yearFrom);
    fillSelect("year-to", yearOpts, state.yearTo);
    syncFocusOptions(state.focusYear);

    host.addEventListener("change", (event) => {
      const input = event.target;
      if (!input || input.type !== "checkbox") return;
      if (input.checked) state.parties.add(input.value);
      else state.parties.delete(input.value);
      render();
    });
    document.getElementById("parties-all").addEventListener("click", () => setAllParties(true));
    document.getElementById("parties-none").addEventListener("click", () => setAllParties(false));

    document.getElementById("metric").addEventListener("change", (event) => {
      state.metric = event.target.value;
      state.sortMetrics = { key: state.metric, dir: "desc" };
      render();
    });
    document.getElementById("year-from").addEventListener("change", (event) => {
      state.yearFrom = Number(event.target.value);
      if (state.yearFrom > state.yearTo) {
        state.yearTo = state.yearFrom;
        document.getElementById("year-to").value = String(state.yearTo);
      }
      syncFocusOptions(state.focusYear);
      render();
    });
    document.getElementById("year-to").addEventListener("change", (event) => {
      state.yearTo = Number(event.target.value);
      if (state.yearTo < state.yearFrom) {
        state.yearFrom = state.yearTo;
        document.getElementById("year-from").value = String(state.yearFrom);
      }
      syncFocusOptions(state.focusYear);
      render();
    });
    document.getElementById("year-focus").addEventListener("change", (event) => {
      state.focusYear = Number(event.target.value);
      state.sortMatrix = { key: String(state.focusYear), dir: "desc" };
      render();
    });
    document.querySelectorAll('input[name="mode"]').forEach((el) => {
      el.addEventListener("change", () => {
        if (!el.checked) return;
        state.mode = el.value;
        render();
      });
    });
    document.getElementById("log-scale").addEventListener("change", (event) => {
      state.log = event.target.checked;
      render();
    });
    bindSort("table-matrix", state.sortMatrix);
    bindSort("table-metrics", state.sortMetrics);
  }

  function fillCandidateLists(partisData) {
    const officiels = (partisData.meta && partisData.meta.candidats_officiels) || {};
    const nameById = {};
    store.partis.forEach((p) => { nameById[p.id] = shortName(p.id); });

    function renderOfficial(year, containerId) {
      const block = officiels[String(year)];
      const el = document.getElementById(containerId);
      if (!el || !block) return;
      const items = (block.liste || []).map((c) => {
        const tag = c.parti_id != null ? (nameById[c.parti_id] || c.etiquette || "") : (c.etiquette || "");
        const note = c.note ? " <em>(" + esc(c.note) + ")</em>" : "";
        return "<li><strong>" + esc(c.nom) + "</strong>" + (tag ? " — " + esc(tag) : "") + note + "</li>";
      }).join("");
      const list = el.querySelector("ol");
      if (list) list.innerHTML = items;
      const src = el.querySelector(".meta-src");
      const href = safeUrl(block.source || "");
      if (src) {
        src.innerHTML = esc(block.decision || "") +
          (href ? ' — <a href="' + esc(href) + '" target="_blank" rel="noopener">source</a>' : "");
      }
    }

    renderOfficial(2017, "list-2017");
    renderOfficial(2022, "list-2022");

    const el27 = document.getElementById("list-2027");
    if (!el27) return;
    const items = [];
    store.partis.forEach((p) => {
      (p.candidats_2027 || []).forEach((c) => {
        items.push({
          nom: c.nom,
          parti: shortName(p.id),
          statut: c.statut || "",
          annonce: c.annonce || "",
          source: (c.sources && c.sources[0]) || "",
        });
      });
    });
    const ul = el27.querySelector("ul");
    if (ul) {
      ul.innerHTML = items.map((c) => {
        const href = safeUrl(c.source);
        const link = href ? ' <a href="' + esc(href) + '" target="_blank" rel="noopener">↗</a>' : "";
        return "<li><strong>" + esc(c.nom) + "</strong> — " + esc(c.parti) +
          "<br><span class=\"badge warn\">" + esc(c.statut) + "</span> " +
          esc(c.annonce) + link + "</li>";
      }).join("");
    }
  }

  function intFr(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);
  }

  function pctFr(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n) + " %";
  }

  function fillGlossary(meta) {
    const host = document.getElementById("glossaire-list");
    if (!host) return;
    const items = (meta && meta.glossaire) || [];
    const cover = (meta && meta.couverture) || {};
    host.innerHTML = items.map((item) => {
      const span = cover[item.champ];
      const years = span && span.premiere_annee
        ? "Première année renseignée pour au moins un parti suivi : " + span.premiere_annee +
          ". Dernière : " + span.derniere_annee + " (" + span.n + " cases non vides)."
        : "";
      return "<article>" +
        "<h3>" + esc(item.titre) + "</h3>" +
        "<p>" + esc(item.definition) + "</p>" +
        (item.avertissement ? '<p class="caveat">' + esc(item.avertissement) + "</p>" : "") +
        (years ? '<p class="chart-note">' + esc(years) + "</p>" : "") +
        "</article>";
    }).join("");
  }

  function fill2025(meta) {
    const el = document.getElementById("exercice-2025");
    const info = meta && meta.exercice_2025;
    if (!el || !info) return;
    el.hidden = false;
    el.textContent = info.texte || "2025 non publié au 2026-09-23";
  }

  function elecLabel(tour) {
    const round = tour.tour === 1 ? "1er tour" : tour.tour + "e tour";
    return "Présidentielle " + tour.annee + " · " + round;
  }

  function currentTour() {
    const tours = (store.elections && store.elections.tours) || [];
    const sel = document.getElementById("elec-tour");
    if (!sel || !tours.length) return null;
    return tours[Number(sel.value)] || tours[tours.length - 1];
  }

  function renderElections() {
    const table = document.getElementById("table-elections");
    const metaEl = document.getElementById("elec-meta");
    const hook = document.getElementById("elec-hook");
    const tour = currentTour();
    if (!table || !tour) return;
    const rows = tour.candidats.slice().sort((a, b) => {
      const dir = elecSort.dir === "asc" ? 1 : -1;
      if (elecSort.key === "nom") {
        return dir * (a.nom + a.prenom).localeCompare(b.nom + b.prenom, "fr");
      }
      const av = a[elecSort.key];
      const bv = b[elecSort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    });
    const head = "<tr>" +
      '<th><button type="button" data-elec-sort="nom">Candidat</button></th>' +
      "<th>Parti suivi</th>" +
      '<th><button type="button" data-elec-sort="voix">Voix</button></th>' +
      '<th><button type="button" data-elec-sort="pct_exprimes">% exprimés</button></th>' +
      '<th><button type="button" data-elec-sort="pct_inscrits">% inscrits</button></th>' +
      "</tr>";
    const body = rows.map((c) => {
      const who = (c.prenom ? c.prenom + " " : "") + c.nom;
      let parti = "—";
      if (c.parti_id) parti = shortName(c.parti_id);
      else if (c.etiquette) parti = c.etiquette;
      return "<tr><td>" + esc(who) + "</td><td>" + esc(parti) + "</td><td class=\"num\">" +
        intFr(c.voix) + "</td><td class=\"num\">" + pctFr(c.pct_exprimes) +
        "</td><td class=\"num\">" + pctFr(c.pct_inscrits) + "</td></tr>";
    }).join("");
    const blancs = tour.blancs != null
      ? "Blancs " + intFr(tour.blancs) + " · nuls " + intFr(tour.nuls)
      : "Blancs et nuls (non séparés) " + intFr(tour.blancs_et_nuls);
    const fileHref = safeUrl(tour.source_url);
    const pageHref = safeUrl(tour.source_page || tour.source_dataset || "");
    table.innerHTML =
      "<caption>" + esc(elecLabel(tour)) + " · " + esc(tour.perimetre) + "</caption>" +
      "<thead>" + head + "</thead><tbody>" + body + "</tbody>";
    if (metaEl) {
      metaEl.innerHTML = "Inscrits " + intFr(tour.inscrits) +
        " · votants " + intFr(tour.votants) +
        " · exprimés " + intFr(tour.exprimes) +
        " · " + esc(blancs) + ". " +
        esc(tour.methode || "") +
        " Source : Ministère de l’Intérieur — " +
        (fileHref ? sourceAnchor(fileHref, "fichier") : "") +
        (pageHref ? " · " + sourceAnchor(pageHref, "jeu data.gouv") : "") + ".";
    }
    if (hook && store.elections && store.elections.meta) {
      const cmp = store.elections.meta.comparaison_voix_depenses || {};
      const leg = store.elections.meta.legislatives || {};
      const searches = (cmp.recherches || []).map((item) =>
        sourceAnchor(item.url, item.q)
      ).join(", ");
      const pages = (cmp.pages_cnccfp_non_extraites || []).map((url) =>
        sourceAnchor(url, "page CNCCFP")
      ).join(", ");
      hook.innerHTML = esc(cmp.raison || "") +
        (searches ? " Recherches : " + searches + "." : "") +
        (pages ? " Non extraites : " + pages + "." : "") +
        (leg.raison ? " " + esc(leg.raison) : "");
    }
  }

  function fillElections(payload) {
    store.elections = payload;
    const sel = document.getElementById("elec-tour");
    const tours = (payload && payload.tours) || [];
    if (!sel) return;
    sel.innerHTML = tours.map((tour, i) =>
      '<option value="' + i + '">' + esc(elecLabel(tour)) + "</option>"
    ).join("");
    if (tours.length) sel.value = String(tours.length - 1);
    sel.addEventListener("change", renderElections);
    const table = document.getElementById("table-elections");
    if (table) {
      table.addEventListener("click", (event) => {
        const btn = event.target.closest("button[data-elec-sort]");
        if (!btn) return;
        const key = btn.dataset.elecSort;
        if (elecSort.key === key) elecSort.dir = elecSort.dir === "asc" ? "desc" : "asc";
        else elecSort.dir = key === "nom" ? "asc" : "desc";
        elecSort.key = key;
        renderElections();
      });
    }
    renderElections();
  }

  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("Échec chargement " + path + " (" + res.status + ")");
    return res.json();
  }

  async function init() {
    const status = document.getElementById("data-status");
    try {
      const [partis, comptes] = await Promise.all([
        loadJson("data/partis.json"),
        loadJson("data/comptes_annuels.json"),
      ]);
      store.rows = comptes.comptes || [];
      store.libelles = (comptes.meta && comptes.meta.libelles) || {};
      store.glossaire = (comptes.meta && comptes.meta.glossaire) || [];
      store.couverture = (comptes.meta && comptes.meta.couverture) || {};
      store.exercice2025 = comptes.meta && comptes.meta.exercice_2025;
      if (comptes.meta && comptes.meta.dataset) store.dataset = comptes.meta.dataset;
      store.compteSources = (comptes.meta && comptes.meta.sources) || [];
      store.partis = (partis.partis || []).slice().sort((a, b) =>
        shortName(a.id).localeCompare(shortName(b.id), "fr", { sensitivity: "base" })
      );
      store.years = Array.from(new Set(store.rows.map((r) => r.year))).sort((a, b) => a - b);
      if (store.years.length) {
        state.yearFrom = store.years[0];
        state.yearTo = store.years[store.years.length - 1];
        state.focusYear = state.yearTo;
        state.sortMatrix = { key: String(state.focusYear), dir: "desc" };
      }
      const span = document.getElementById("year-span");
      if (span && store.years.length) {
        span.textContent = store.years[0] + "–" + store.years[store.years.length - 1];
      }
      if (store.years.length) {
        document.title = "Finances des partis — CNCCFP " + store.years[0] + "–" + store.years[store.years.length - 1];
      }
      fillGlossary(comptes.meta);
      fill2025(comptes.meta);
      applyLightDefaults();
      buildFilters();
      fillCandidateLists(partis);
      render();
      try {
        fillElections(await loadJson("data/elections_presidentielles.json"));
      } catch (elecErr) {
        console.error(elecErr);
        const metaEl = document.getElementById("elec-meta");
        if (metaEl) metaEl.textContent = "Résultats électoraux indisponibles : " + (elecErr.message || elecErr);
      }
      if (status) {
        const y0 = store.years[0];
        const y1 = store.years[store.years.length - 1];
        status.textContent = store.rows.length + " lignes · " + store.partis.length + " partis · " + y0 + "–" + y1;
        status.className = "badge ok";
      }
    } catch (err) {
      console.error(err);
      if (status) {
        status.textContent = String(err.message || err);
        status.className = "error";
      }
      const panel = document.getElementById("chart-panel");
      if (panel) panel.innerHTML = '<p class="error">Impossible de charger les données. Ouvrez le site via HTTP.</p>';
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
