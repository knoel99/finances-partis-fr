/* Finances partis FR — charts from CNCCFP JSON only (no invented numbers) */
(function () {
  "use strict";

  const SHORT_LABELS = {
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
    resistons: "Résistons !",
  };

  const COLORS = {
    upr: "#ff6b35",
    rn: "#0a3d6b",
    lr: "#1e3a8a",
    ps: "#e11d48",
    lfi: "#b91c1c",
    renaissance: "#f59e0b",
    eelv: "#16a34a",
    pcf: "#dc2626",
    dlf: "#7c3aed",
    reconquete: "#1e293b",
    modem: "#f97316",
    lo: "#991b1b",
    generations: "#ec4899",
    sp: "#64748b",
    resistons: "#0ea5e9",
  };

  const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

  function eur(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  }

  /** Y ticks on the log scale, in millions of euros (1 M€, 10 M€, 0,1 M€…). */
  function formatMillionsEur(value) {
    const millions = value / 1e6;
    const abs = Math.abs(millions);
    let digits = 0;
    if (abs > 0 && abs < 1) {
      digits = Math.min(6, Math.max(0, Math.ceil(-Math.log10(abs))));
    }
    const rounded = Number(millions.toFixed(digits));
    return (
      rounded.toLocaleString("fr-FR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }) + " M€"
    );
  }

  function axisTitle(titleY, logarithmic) {
    if (!logarithmic) return titleY;
    if (titleY.endsWith("— €")) return titleY.slice(0, -1) + "M€";
    return titleY + " (M€)";
  }

  /**
   * Chart.js logarithmic scale rejects non-positive values (log undefined)
   * and would otherwise draw a 0 at the axis minimum. Omit those points
   * instead of substituting an epsilon, so a true zero is not plotted as debt.
   */
  function seriesForScale(raw, logarithmic) {
    return raw.map((v) => {
      if (v == null || Number.isNaN(v)) return null;
      if (logarithmic && !(v > 0)) return null;
      return v;
    });
  }

  function partyLabel(id, partis) {
    if (SHORT_LABELS[id]) return SHORT_LABELS[id];
    const p = (partis || []).find((x) => x.id === id);
    if (p && p.noms_historiques && p.noms_historiques.length)
      return p.noms_historiques[p.noms_historiques.length - 1];
    return id;
  }

  function seriesByParty(dette) {
    const map = {};
    (dette.parties || []).forEach((p) => {
      map[p.party_id] = p;
    });
    return map;
  }

  function buildDataset(partyId, seriesObj, field, partis) {
    const byYear = {};
    (seriesObj.series || []).forEach((pt) => {
      byYear[pt.year] = pt[field];
    });
    const data = YEARS.map((y) =>
      byYear[y] != null ? byYear[y] : null
    );
    const isUpr = partyId === "upr";
    return {
      label: partyLabel(partyId, partis),
      data,
      borderColor: COLORS[partyId] || "#94a3b8",
      backgroundColor: "transparent",
      borderWidth: isUpr ? 3 : 1.5,
      borderDash: isUpr ? [8, 5] : [],
      tension: 0,
      pointRadius: isUpr ? 4 : 2,
      pointHoverRadius: 5,
      spanGaps: false,
      order: isUpr ? 0 : 1,
    };
  }

  function legendLabelOptions() {
    return {
      color: "#334155",
      boxWidth: 14,
      padding: 8,
      font(ctx) {
        const w = ctx && ctx.chart ? ctx.chart.width : 800;
        return { size: w < 520 ? 10 : 11 };
      },
    };
  }

  function yScaleOptions(titleY, logarithmic) {
    if (!logarithmic) {
      return {
        type: "linear",
        title: {
          display: true,
          text: titleY,
          color: "#475569",
        },
        ticks: {
          color: "#475569",
          maxRotation: 0,
          callback(v) {
            if (Math.abs(v) >= 1e6)
              return (
                (v / 1e6).toLocaleString("fr-FR", {
                  maximumFractionDigits: 1,
                }) + " M€"
              );
            if (Math.abs(v) >= 1e3)
              return (
                (v / 1e3).toLocaleString("fr-FR", {
                  maximumFractionDigits: 0,
                }) + " k€"
              );
            return v;
          },
        },
        grid: { color: "rgba(15, 23, 42, 0.12)" },
      };
    }

    return {
      type: "logarithmic",
      title: {
        display: true,
        text: axisTitle(titleY, true),
        color: "#475569",
      },
      ticks: {
        color: "#475569",
        maxRotation: 0,
        autoSkip: true,
        callback(value, index, ticks) {
          const tick = ticks && ticks[index];
          const n = Number(value);
          if (!Number.isFinite(n) || n <= 0) return "";
          if (tick && tick.major === false) return "";
          return formatMillionsEur(n);
        },
      },
      afterBuildTicks(scale) {
        const major = scale.ticks.filter((t) => t.major && t.value > 0);
        if (major.length >= 2) scale.ticks = major;
      },
      grid: { color: "rgba(15, 23, 42, 0.12)" },
    };
  }

  const euroCharts = [];

  function makeChart(canvasId, seriesMap, partis, field, titleY) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === "undefined") return null;

    const partyIds = Object.keys(seriesMap).sort((a, b) => {
      if (a === "upr") return 1;
      if (b === "upr") return -1;
      return partyLabel(a, partis).localeCompare(partyLabel(b, partis), "fr");
    });

    const datasets = partyIds.map((id) => {
      const ds = buildDataset(id, seriesMap[id], field, partis);
      ds.rawValues = ds.data.slice();
      ds.pointHitRadius = id === "upr" ? 12 : 8;
      return ds;
    });

    const chart = new Chart(el, {
      type: "line",
      data: { labels: YEARS, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", axis: "x", intersect: false },
        plugins: {
          legend: {
            position: "bottom",
            labels: legendLabelOptions(),
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const raw =
                  ctx.dataset.rawValues &&
                  ctx.dataset.rawValues[ctx.dataIndex];
                const v = raw != null ? raw : ctx.parsed.y;
                if (v == null) return ctx.dataset.label + " : n/a";
                const omitted = !(v > 0) && document.body.classList.contains("log-scale");
                return (
                  ctx.dataset.label +
                  " : " +
                  eur(v) +
                  (omitted ? " (non tracé en log)" : "")
                );
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#475569", maxRotation: 0 },
            grid: { color: "rgba(15, 23, 42, 0.12)" },
          },
          y: yScaleOptions(titleY, false),
        },
      },
    });

    euroCharts.push({ chart, titleY });
    return chart;
  }

  function setLogScale(on) {
    document.body.classList.toggle("log-scale", on);
    document.querySelectorAll(".js-log-scale").forEach((el) => {
      el.checked = on;
    });
    document.querySelectorAll(".log-hint").forEach((el) => {
      el.hidden = !on;
    });
    euroCharts.forEach(({ chart, titleY }) => {
      chart.data.datasets.forEach((ds) => {
        ds.data = seriesForScale(ds.rawValues || ds.data, on);
      });
      chart.options.scales.y = yScaleOptions(titleY, on);
      chart.update();
    });
  }

  function fillUprTable(comptes) {
    const tbody = document.querySelector("#upr-table tbody");
    if (!tbody) return;
    const rows = (comptes.comptes || [])
      .filter((r) => r.party_id === "upr")
      .sort((a, b) => a.year - b.year);
    tbody.innerHTML = rows
      .map(
        (r) =>
          `<tr class="upr-row">
            <td>${r.year}</td>
            <td class="num">${eur(r.somme_emprunts_eur)}</td>
            <td class="num">${eur(r.dettes_passif_total_III_eur)}</td>
            <td class="num">${eur(r.cotisations_adherents_eur)}</td>
            <td class="num">${eur(r.dons_eur)}</td>
            <td class="num">${eur(r.aide_publique_eur)}</td>
          </tr>`
      )
      .join("");
  }

  function fillCandidateLists(partisData) {
    const meta = partisData.meta || {};
    const officiels = meta.candidats_officiels || {};
    const nameById = {};
    (partisData.partis || []).forEach((p) => {
      nameById[p.id] = partyLabel(p.id, partisData.partis);
    });

    function renderOfficial(year, containerId) {
      const block = officiels[String(year)];
      const el = document.getElementById(containerId);
      if (!el || !block) return;
      const items = (block.liste || [])
        .map((c) => {
          const tag =
            c.parti_id != null
              ? nameById[c.parti_id] || c.etiquette || ""
              : c.etiquette || "";
          const note = c.note ? ` <em>(${c.note})</em>` : "";
          return `<li><strong>${c.nom}</strong>${
            tag ? " — " + tag : ""
          }${note}</li>`;
        })
        .join("");
      el.querySelector("ol").innerHTML = items;
      const src = el.querySelector(".meta-src");
      if (src) {
        src.innerHTML = `${block.decision || ""} — <a href="${
          block.source
        }" target="_blank" rel="noopener">source</a>`;
      }
    }

    renderOfficial(2017, "list-2017");
    renderOfficial(2022, "list-2022");

    const el27 = document.getElementById("list-2027");
    if (el27) {
      const items = [];
      (partisData.partis || []).forEach((p) => {
        (p.candidats_2027 || []).forEach((c) => {
          items.push({
            nom: c.nom,
            parti: partyLabel(p.id, partisData.partis),
            statut: c.statut,
            annonce: c.annonce || "",
            sources: c.sources || [],
          });
        });
      });
      el27.querySelector("ul").innerHTML = items
        .map((c) => {
          const src =
            c.sources[0] != null
              ? ` <a href="${c.sources[0]}" target="_blank" rel="noopener">↗</a>`
              : "";
          return `<li><strong>${c.nom}</strong> — ${c.parti}<br><span class="badge warn">${c.statut}</span>${
            c.annonce ? " " + c.annonce : ""
          }${src}</li>`;
        })
        .join("");
    }
  }

  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("Échec chargement " + path + " (" + res.status + ")");
    return res.json();
  }

  async function init() {
    const status = document.getElementById("data-status");
    try {
      const [partis, dette, comptes] = await Promise.all([
        loadJson("data/partis.json"),
        loadJson("data/series_dette.json"),
        loadJson("data/comptes_annuels.json"),
      ]);

      const seriesMap = seriesByParty(dette);
      const partisList = partis.partis || [];

      makeChart(
        "chart-emprunts",
        seriesMap,
        partisList,
        "debt_eur",
        "Emprunts financiers (somme_emprunts) — €"
      );
      makeChart(
        "chart-bilan",
        seriesMap,
        partisList,
        "debt_total_bilan_III_eur",
        "Total III passif (dettes bilan) — €"
      );

      fillUprTable(comptes);
      fillCandidateLists(partis);

      document.querySelectorAll(".js-log-scale").forEach((el) => {
        el.addEventListener("change", () => setLogScale(el.checked));
      });

      if (status) {
        status.textContent =
          "Données chargées — " +
          (dette.parties || []).length +
          " partis, exercices 2017–2024 (CNCCFP).";
        status.className = "badge ok";
      }
    } catch (err) {
      console.error(err);
      if (status) {
        status.textContent = String(err.message || err);
        status.className = "error";
      }
      document.querySelectorAll(".chart-wrap").forEach((w) => {
        w.innerHTML =
          '<p class="error">Impossible de charger les graphiques. Ouvrez le site via un serveur HTTP local (voir tip de vérification).</p>';
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
