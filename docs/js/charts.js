/* Finances partis FR — dette (emprunts financiers), tableaux, glossaire.
   Chiffres lus dans les JSON du dépôt. Aucune valeur inventée. */
(function () {
  "use strict";

  const DEBT = "somme_emprunts_eur";
  const DEFAULT_PARTIES = 6;

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

  const PALETTE = [
    "#1d4ed8", "#0f766e", "#b45309", "#6d28d9", "#be123c",
    "#0369a1", "#3f6212", "#c2410c", "#4338ca", "#0e7490",
    "#a16207", "#7c3aed", "#9f1239", "#1e3a8a", "#115e59",
  ];

  const AXIS = "#475569";
  const GRID = "rgba(15, 23, 42, 0.12)";
  const VIEWS = ["graphiques", "donnees", "definitions"];

  const state = {
    parties: new Set(),
    focusYear: 2024,
    sortMatrix: { key: "2024", dir: "desc" },
    sortMetrics: { key: DEBT, dir: "desc" },
  };

  let store = {
    rows: [],
    partis: [],
    years: [],
    libelles: {},
    glossaire: [],
    exercice2025: null,
    elections: null,
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
      return (n / 1e6).toLocaleString("fr-FR", {
        maximumFractionDigits: abs >= 1e7 ? 0 : 1,
      }) + " M€";
    }
    if (abs >= 1e3) {
      return (n / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " k€";
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

  function displayName(p) {
    const names = (p && p.noms_historiques) || [];
    const current = names[names.length - 1] || shortName(p && p.id);
    if (/\s/.test(current) || current.length > 8) return current;
    for (let i = names.length - 2; i >= 0; i -= 1) {
      const previous = names[i];
      if (/\s/.test(previous) && previous.length > current.length) {
        return previous + " (" + current + ")";
      }
    }
    return current;
  }

  function colorOf(id) {
    const index = store.partis.findIndex((p) => p.id === id);
    return PALETTE[(index < 0 ? 0 : index) % PALETTE.length];
  }

  function selectedParties() {
    return store.partis.filter((p) => state.parties.has(p.id));
  }

  function valueAt(partyId, year, metric) {
    const row = store.rows.find((r) => r.party_id === partyId && r.year === year);
    if (!row || row[metric] == null || Number.isNaN(Number(row[metric]))) return null;
    return Number(row[metric]);
  }

  function hasRow(partyId, year) {
    return store.rows.some((r) => r.party_id === partyId && r.year === year);
  }

  function formatYearSpans(years) {
    const ys = years.slice().sort((a, b) => a - b);
    if (!ys.length) return "";
    const parts = [];
    let start = ys[0];
    let prev = ys[0];
    for (let i = 1; i <= ys.length; i += 1) {
      const y = ys[i];
      if (y === prev + 1) {
        prev = y;
        continue;
      }
      parts.push(start === prev ? String(start) : start + "–" + prev);
      start = y;
      prev = y;
    }
    return parts.join(", ");
  }

  function missingYears(party) {
    return store.years.filter((year) => !hasRow(party.id, year));
  }

  function destroyCharts() {
    while (charts.length) {
      const chart = charts.pop();
      try { chart.destroy(); } catch (e) { /* already gone */ }
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

  function debtTooltip(axis) {
    return {
      backgroundColor: "#ffffff",
      titleColor: "#1e293b",
      bodyColor: "#334155",
      borderColor: "#d5dee8",
      borderWidth: 1,
      callbacks: {
        label(ctx) {
          const raw = ctx.dataset.rawValues ? ctx.dataset.rawValues[ctx.dataIndex] : null;
          const name = ctx.dataset.fullName || ctx.dataset.label;
          if (raw == null || Number.isNaN(raw)) return name + " : pas de compte";
          return name + " : " + eur(raw);
        },
      },
    };
  }

  function mountChart(canvas, config) {
    const chart = new Chart(canvas, config);
    charts.push(chart);
    return chart;
  }

  function viewFromHash() {
    const hash = (location.hash || "").replace(/^#/, "");
    if (hash === "donnees" || hash === "definitions") return hash;
    if (hash === "glossaire") return "definitions";
    return "graphiques";
  }

  function showView(name) {
    VIEWS.forEach((view) => {
      const panel = document.getElementById(view);
      const tab = document.getElementById("tab-" + view);
      const on = view === name;
      if (panel) panel.hidden = !on;
      if (tab) {
        tab.setAttribute("aria-selected", on ? "true" : "false");
        tab.classList.toggle("active", on);
      }
    });
  }

  function renderDebtIntro() {
    const el = document.getElementById("debt-def");
    if (!el) return;
    const item = (store.glossaire || []).find((entry) => entry.champ === DEBT);
    const sentence = item && item.definition
      ? item.definition.split(/(?<=\.)\s/)[0]
      : "Dettes d’emprunt, pas l’ensemble du passif.";
    el.innerHTML = "Barres verticales des <strong>emprunts financiers</strong>. " +
      esc(sentence) +
      " Ce n’est pas le Total III du passif. Détail dans <a href=\"#definitions\">Définitions</a>.";
  }

  function renderEvolution() {
    const wrap = document.getElementById("wrap-evo");
    const empty = document.getElementById("evo-empty");
    const note = document.getElementById("evo-note");
    const parties = selectedParties();
    if (!wrap || !empty) return;
    if (typeof Chart === "undefined") {
      wrap.hidden = true;
      empty.hidden = false;
      empty.textContent = "Chart.js n’a pas pu être chargé.";
      return;
    }
    if (!parties.length) {
      wrap.hidden = true;
      empty.hidden = false;
      empty.textContent = "Cochez au moins un parti pour afficher l’évolution.";
      if (note) note.textContent = "";
      return;
    }
    wrap.hidden = false;
    empty.hidden = true;
    void wrap.offsetWidth;
    const years = store.years;
    const max = parties.reduce((acc, party) => {
      years.forEach((year) => {
        const value = valueAt(party.id, year, DEBT);
        if (value != null && value > acc) acc = value;
      });
      return acc;
    }, 0);
    mountChart(document.getElementById("canvas-evo"), {
      type: "bar",
      plugins: [whiteBackground],
      data: {
        labels: years.map(String),
        datasets: parties.map((party) => ({
          label: shortName(party.id),
          fullName: displayName(party),
          partyId: party.id,
          data: years.map((year) => valueAt(party.id, year, DEBT)),
          rawValues: years.map((year) => (hasRow(party.id, year) ? valueAt(party.id, year, DEBT) : null)),
          backgroundColor: colorOf(party.id),
          borderColor: colorOf(party.id),
          borderWidth: 1,
          maxBarThickness: 28,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "nearest", intersect: true },
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: "#334155", boxWidth: 12, padding: 10, font: { size: 12 } },
          },
          tooltip: debtTooltip("y"),
        },
        scales: {
          x: {
            title: { display: true, text: "Année", color: "#334155" },
            ticks: { color: AXIS, autoSkip: false, maxRotation: 50, minRotation: 0 },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            suggestedMax: max > 0 ? max * 1.08 : 1,
            title: { display: true, text: "Emprunts financiers", color: "#334155" },
            ticks: { color: AXIS, callback: (value) => formatAxis(value) },
            grid: { color: GRID },
          },
        },
      },
    });
    if (note) {
      const gaps = parties
        .map((party) => {
          const missing = missingYears(party);
          return missing.length ? displayName(party) + " (" + formatYearSpans(missing) + ")" : "";
        })
        .filter(Boolean);
      const bits = [];
      if (parties.length > 8) {
        bits.push(parties.length + " partis affichés : les barres sont fines. Décochez-en pour aérer le graphique.");
      }
      if (gaps.length) {
        bits.push("Pas de ligne dans le JSON (barre absente, pas un zéro) : " + gaps.join(" ; ") + ".");
      }
      note.textContent = bits.join(" ");
    }
  }

  function renderRank() {
    const wrap = document.getElementById("wrap-rank");
    const empty = document.getElementById("rank-empty");
    const note = document.getElementById("rank-note");
    if (!wrap || !empty) return;
    const ranked = store.partis
      .map((party) => ({ party, value: valueAt(party.id, state.focusYear, DEBT), row: hasRow(party.id, state.focusYear) }))
      .filter((item) => item.row && item.value != null)
      .sort((a, b) => b.value - a.value || displayName(a.party).localeCompare(displayName(b.party), "fr"));
    const absent = store.partis.filter((party) => !hasRow(party.id, state.focusYear));
    if (typeof Chart === "undefined") {
      wrap.hidden = true;
      empty.hidden = false;
      empty.textContent = "Chart.js n’a pas pu être chargé.";
      return;
    }
    if (!ranked.length) {
      wrap.hidden = true;
      empty.hidden = false;
      empty.textContent = "Aucun montant d’emprunts pour " + state.focusYear + ".";
      if (note) note.textContent = "";
      return;
    }
    wrap.hidden = false;
    empty.hidden = true;
    wrap.style.height = Math.max(320, ranked.length * 36 + 72) + "px";
    void wrap.offsetWidth;
    const max = Math.max(...ranked.map((item) => item.value));
    mountChart(document.getElementById("canvas-rank"), {
      type: "bar",
      plugins: [whiteBackground],
      data: {
        labels: ranked.map((item) => displayName(item.party)),
        datasets: [{
          label: "Emprunts financiers",
          fullName: "Emprunts financiers",
          data: ranked.map((item) => item.value),
          rawValues: ranked.map((item) => item.value),
          backgroundColor: ranked.map((item) => colorOf(item.party.id)),
          borderColor: ranked.map((item) => colorOf(item.party.id)),
          borderWidth: 1,
          maxBarThickness: 22,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#ffffff",
            titleColor: "#1e293b",
            bodyColor: "#334155",
            borderColor: "#d5dee8",
            borderWidth: 1,
            callbacks: {
              label(ctx) {
                return eur(ctx.parsed.x);
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            suggestedMax: max > 0 ? max * 1.06 : 1,
            title: { display: true, text: "Emprunts financiers", color: "#334155" },
            ticks: { color: AXIS, callback: (value) => formatAxis(value) },
            grid: { color: GRID },
          },
          y: {
            ticks: { color: "#334155", autoSkip: false, font: { size: 12 } },
            grid: { display: false },
          },
        },
      },
    });
    if (note) {
      const zeros = ranked.filter((item) => item.value === 0).map((item) => displayName(item.party));
      const bits = [];
      bits.push(ranked.length + " partis avec un compte en " + state.focusYear + ", triés par emprunts financiers.");
      if (zeros.length) bits.push("Montant publié à 0 € : " + zeros.join(", ") + ".");
      if (absent.length) {
        bits.push("Sans ligne en " + state.focusYear + " : " + absent.map(displayName).join(", ") + ".");
      }
      note.textContent = bits.join(" ");
    }
  }

  function renderCharts() {
    destroyCharts();
    if (viewFromHash() !== "graphiques") return;
    renderEvolution();
    renderRank();
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
    return dir === "asc" ? av - bv : bv - av;
  }

  function sortedParties(list, sort, valueFor) {
    const rows = list.slice();
    rows.sort((a, b) => {
      if (sort.key === "party") {
        const cmp = displayName(a).localeCompare(displayName(b), "fr", { sensitivity: "base" });
        return sort.dir === "asc" ? cmp : -cmp;
      }
      const byVal = compareNullable(valueFor(a), valueFor(b), sort.dir);
      if (byVal) return byVal;
      return displayName(a).localeCompare(displayName(b), "fr", { sensitivity: "base" });
    });
    return rows;
  }

  function headerCell(sort, key, label, extraClass) {
    return '<th scope="col" class="' + (extraClass || "") + '" aria-sort="' + ariaSort(sort, key) + '">' +
      '<button type="button" data-sort="' + esc(key) + '">' + esc(label) + arrow(sort, key) + "</button></th>";
  }

  function renderMatrix() {
    const table = document.getElementById("table-matrix");
    const title = document.getElementById("matrix-title");
    if (!table) return;
    const years = store.years;
    if (title) {
      const from = years[0];
      const to = years[years.length - 1];
      title.textContent = "Emprunts financiers — partis cochés, " + from + "–" + to;
    }
    if (state.sortMatrix.key !== "party" && years.indexOf(Number(state.sortMatrix.key)) === -1) {
      state.sortMatrix = { key: String(state.focusYear), dir: "desc" };
    }
    const rows = sortedParties(selectedParties(), state.sortMatrix, (party) => {
      if (state.sortMatrix.key === "party") return null;
      return valueAt(party.id, Number(state.sortMatrix.key), DEBT);
    });
    const head = "<tr>" + headerCell(state.sortMatrix, "party", "Parti") +
      years.map((year) => headerCell(
        state.sortMatrix,
        String(year),
        String(year),
        year === state.focusYear ? "is-focus" : ""
      )).join("") + "</tr>";
    const body = rows.length
      ? rows.map((party) => {
        const cells = years.map((year) => {
          const value = valueAt(party.id, year, DEBT);
          const cls = "num" + (year === state.focusYear ? " is-focus" : "");
          return '<td class="' + cls + '">' + esc(eur(value)) + "</td>";
        }).join("");
        return "<tr><th scope=\"row\" class=\"party\">" + esc(displayName(party)) + "</th>" + cells + "</tr>";
      }).join("")
      : '<tr><td colspan="' + (years.length + 1) + '">Aucun parti sélectionné.</td></tr>';
    table.innerHTML =
      "<caption>Champ somme_emprunts_eur. Tri en cliquant sur un en-tête. La colonne surlignée est l’année du classement.</caption>" +
      "<thead>" + head + "</thead><tbody>" + body + "</tbody>";
  }

  function renderMetricTable() {
    const table = document.getElementById("table-metrics");
    const title = document.getElementById("metrics-title");
    if (!table) return;
    if (title) title.textContent = "Toutes les métriques en " + state.focusYear;
    const rows = sortedParties(store.partis, state.sortMetrics, (party) => {
      if (state.sortMetrics.key === "party") return null;
      return valueAt(party.id, state.focusYear, state.sortMetrics.key);
    });
    const head = "<tr>" + headerCell(state.sortMetrics, "party", "Parti") +
      METRICS.map((metric) => headerCell(
        state.sortMetrics,
        metric.id,
        metric.short,
        metric.id === DEBT ? "is-focus" : ""
      )).join("") + "</tr>";
    const body = rows.length
      ? rows.map((party) => {
        const cells = METRICS.map((metric) => {
          const value = valueAt(party.id, state.focusYear, metric.id);
          const cls = "num" + (metric.id === DEBT ? " is-focus" : "");
          return '<td class="' + cls + '">' + esc(eur(value)) + "</td>";
        }).join("");
        return "<tr><th scope=\"row\" class=\"party\">" + esc(displayName(party)) + "</th>" + cells + "</tr>";
      }).join("")
      : '<tr><td colspan="' + (METRICS.length + 1) + '">Aucun parti dans le fichier.</td></tr>';
    table.innerHTML =
      "<caption>Exercice " + state.focusYear + ", tous les partis du fichier. La colonne Emprunts est la dette des graphiques.</caption>" +
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
    const page = '<a href="sources.html#comptes">Sources</a>';
    const dataset = sourceAnchor(store.dataset, "jeu data.gouv");
    const list = (years || []).filter((year, index, all) => all.indexOf(year) === index);
    if (!list.length) return "Source : " + page + ".";
    if (list.length === 1) {
      const file = fileForYear(list[0]);
      const fileLink = file ? sourceAnchor(file.url, "fichier " + list[0]) : "";
      return "Source : " + page + " · CNCCFP — " + dataset + (fileLink ? " · " + fileLink : "") + ".";
    }
    return "Source : " + page + " · CNCCFP — " + dataset +
      " · exercices " + list[0] + "–" + list[list.length - 1] + ".";
  }

  function renderSourceLines() {
    const evo = document.getElementById("evo-source");
    const rank = document.getElementById("rank-source");
    const matrix = document.getElementById("matrix-source");
    const metrics = document.getElementById("metrics-source");
    if (evo) evo.innerHTML = comptesSourceHtml(store.years);
    if (rank) rank.innerHTML = comptesSourceHtml([state.focusYear]);
    if (matrix) matrix.innerHTML = comptesSourceHtml(store.years);
    if (metrics) metrics.innerHTML = comptesSourceHtml([state.focusYear]);
  }

  function renderPartyCounts() {
    const n = selectedParties().length;
    document.querySelectorAll(".party-count").forEach((el) => {
      el.textContent = n + " / " + store.partis.length + " partis";
    });
  }

  function render() {
    renderPartyCounts();
    renderMatrix();
    renderMetricTable();
    renderSourceLines();
    renderCharts();
  }

  function renderTables() {
    renderMatrix();
    renderMetricTable();
    renderSourceLines();
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

  function partyFilterHtml() {
    return store.partis.map((party) =>
      '<label title="' + esc(displayName(party)) + '">' +
      '<input type="checkbox" value="' + esc(party.id) + '"' +
      (state.parties.has(party.id) ? " checked" : "") + "> " +
      esc(shortName(party.id)) + "</label>"
    ).join("");
  }

  function syncPartyChecks() {
    document.querySelectorAll("[data-party-filters] input").forEach((input) => {
      input.checked = state.parties.has(input.value);
    });
  }

  function setAllParties(on) {
    state.parties = on ? new Set(store.partis.map((party) => party.id)) : new Set();
    syncPartyChecks();
    render();
  }

  function defaultPartyIds() {
    const latest = store.years[store.years.length - 1];
    return store.partis
      .map((party) => ({ id: party.id, value: valueAt(party.id, latest, DEBT) }))
      .sort((a, b) => {
        const av = a.value == null ? -Infinity : a.value;
        const bv = b.value == null ? -Infinity : b.value;
        if (bv !== av) return bv - av;
        return shortName(a.id).localeCompare(shortName(b.id), "fr");
      })
      .slice(0, DEFAULT_PARTIES)
      .map((item) => item.id);
  }

  function fillYearSelects() {
    const options = store.years.map((year) =>
      '<option value="' + year + '">' + year + "</option>"
    ).join("");
    document.querySelectorAll("[data-year-focus]").forEach((el) => {
      el.innerHTML = options;
      el.value = String(state.focusYear);
    });
  }

  function buildFilters() {
    state.parties = new Set(defaultPartyIds());
    document.querySelectorAll("[data-party-filters]").forEach((host) => {
      host.innerHTML = partyFilterHtml();
      host.addEventListener("change", (event) => {
        const input = event.target;
        if (!input || input.type !== "checkbox") return;
        if (input.checked) state.parties.add(input.value);
        else state.parties.delete(input.value);
        syncPartyChecks();
        render();
      });
    });
    document.querySelectorAll("[data-parties]").forEach((btn) => {
      btn.addEventListener("click", () => setAllParties(btn.dataset.parties === "all"));
    });
    fillYearSelects();
    document.querySelectorAll("[data-year-focus]").forEach((el) => {
      el.addEventListener("change", () => {
        state.focusYear = Number(el.value);
        if (!store.years.includes(state.focusYear)) return;
        document.querySelectorAll("[data-year-focus]").forEach((other) => {
          other.value = String(state.focusYear);
        });
        render();
      });
    });
    bindSort("table-matrix", state.sortMatrix);
    bindSort("table-metrics", state.sortMetrics);
  }

  function fillCandidateLists(partisData) {
    const officiels = (partisData.meta && partisData.meta.candidats_officiels) || {};
    const nameById = {};
    store.partis.forEach((party) => { nameById[party.id] = shortName(party.id); });

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
        src.innerHTML = '<a href="sources.html#candidats">Sources</a> · ' + esc(block.decision || "") +
          (href ? ' — <a href="' + esc(href) + '" target="_blank" rel="noopener">texte officiel</a>' : "");
      }
    }

    renderOfficial(2017, "list-2017");
    renderOfficial(2022, "list-2022");

    const el27 = document.getElementById("list-2027");
    if (!el27) return;
    const items = [];
    store.partis.forEach((party) => {
      (party.candidats_2027 || []).forEach((c) => {
        items.push({
          nom: c.nom,
          parti: shortName(party.id),
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
      const chartNote = item.champ === DEBT
        ? '<p class="chart-note">C’est le poste dessiné dans les graphiques, sous l’intitulé « dette ».</p>'
        : "";
      return "<article>" +
        "<h3>" + esc(item.titre) + "</h3>" +
        "<p>" + esc(item.definition) + "</p>" +
        (item.avertissement ? '<p class="caveat">' + esc(item.avertissement) + "</p>" : "") +
        chartNote +
        (years ? '<p class="chart-note">' + esc(years) + "</p>" : "") +
        "</article>";
    }).join("");
  }

  function fill2025(meta) {
    const el = document.getElementById("exercice-2025");
    const info = meta && meta.exercice_2025;
    if (!info) return;
    if (el) {
      el.hidden = false;
      el.textContent = info.texte || "2025 non publié au 2026-09-23";
    }
    const limite = document.getElementById("limite-2025");
    if (limite) {
      limite.textContent = (info.texte || "2025 non publié") +
        (info.constat ? " " + info.constat : "");
    }
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
        " Source : <a href=\"sources.html#resultats\">Sources</a> · Ministère de l’Intérieur — " +
        (fileHref ? sourceAnchor(fileHref, "fichier") : "") +
        (pageHref ? " · " + sourceAnchor(pageHref, "jeu data.gouv") : "") + ".";
    }
    if (hook && store.elections && store.elections.meta) {
      const cmp = store.elections.meta.comparaison_voix_depenses || {};
      const leg = store.elections.meta.legislatives || {};
      const searches = (cmp.recherches || []).map((item) => sourceAnchor(item.url, item.q)).join(", ");
      const pages = (cmp.pages_cnccfp_non_extraites || []).map((url) => sourceAnchor(url, "page CNCCFP")).join(", ");
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

  function onHashChange() {
    const view = viewFromHash();
    showView(view);
    if (view === "graphiques") {
      requestAnimationFrame(() => renderCharts());
    }
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
      store.exercice2025 = comptes.meta && comptes.meta.exercice_2025;
      if (comptes.meta && comptes.meta.dataset) store.dataset = comptes.meta.dataset;
      store.compteSources = (comptes.meta && comptes.meta.sources) || [];
      store.partis = (partis.partis || []).slice().sort((a, b) =>
        shortName(a.id).localeCompare(shortName(b.id), "fr", { sensitivity: "base" })
      );
      store.years = Array.from(new Set(store.rows.map((r) => r.year))).sort((a, b) => a - b);
      if (store.years.length) {
        state.focusYear = store.years[store.years.length - 1];
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
      renderDebtIntro();
      applyLightDefaults();
      buildFilters();
      fillCandidateLists(partis);
      showView(viewFromHash());
      render();
      window.addEventListener("hashchange", onHashChange);
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
      const empty = document.getElementById("evo-empty");
      if (empty) {
        empty.hidden = false;
        empty.textContent = "Impossible de charger les données. Ouvrez le site via HTTP.";
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
