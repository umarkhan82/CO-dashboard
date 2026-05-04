(function () {
  const DATA =
    (window.CO_DATA &&
      window.CO_DATA.peaceGovernance &&
      window.CO_DATA.peaceGovernance.records) ||
    [];

  const SOUTH_SUDAN_CENTER = [7.3, 30.2];

  const CHART_BLUE = "#3BA4F7";
  const CHART_GREEN = "#34d399";
  const CHART_ORANGE = "#fb923c";
  const CHART_PURPLE = "#a78bfa";
  const MALE_COLOR = "#60a5fa";
  const FEMALE_COLOR = "#f472b6";

  let map = null;
  let countyGeoJsonLayer = null;
  let lastTables = {};

  const $ = (id) => document.getElementById(id);

  function fmt(n) {
    return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function fmt1(n) {
    return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function norm(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pct(current, target) {
    const c = Number(current) || 0;
    const t = Number(target) || 0;
    return t ? (c / t) * 100 : 0;
  }

  function uniqueValues(records, field) {
    return [...new Set(records.map((r) => r[field]).filter(Boolean))].sort();
  }

  function sum(records, field) {
    return records.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
  }

  function shortLabel(text, max = 34) {
    const value = String(text || "");
    if (value.length <= max) return value;
    return value.slice(0, max - 3) + "...";
  }

  function setWarning(message) {
    const el = $("data-warning");
    if (!el) return;
    el.style.display = message ? "block" : "none";
    el.textContent = message || "";
  }

  function populateSelect(id, values, label) {
    const el = $(id);
    if (!el) return;

    const current = el.value;
    el.innerHTML = "";

    const all = document.createElement("option");
    all.value = "All";
    all.textContent = `All ${label}`;
    el.appendChild(all);

    values.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });

    if ([...el.options].some((o) => o.value === current)) {
      el.value = current;
    }
  }

  function initFilters() {
    populateSelect("indicator-filter", uniqueValues(DATA, "indicator"), "Indicators");
    populateSelect("agency-filter", uniqueValues(DATA, "agency"), "Agencies");
    populateSelect("state-filter", uniqueValues(DATA, "state"), "States/Admin Areas");
    populateSelect("county-filter", uniqueValues(DATA, "county"), "Counties");

    ["indicator-filter", "agency-filter", "state-filter", "county-filter"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("change", onFilterChange);
    });

    const reset = $("reset-filters");
    if (reset) {
      reset.addEventListener("click", () => {
        ["indicator-filter", "agency-filter", "state-filter", "county-filter"].forEach((id) => {
          const el = $(id);
          if (el) el.value = "All";
        });
        updateDashboard();
      });
    }
  }

  function onFilterChange() {
    const state = $("state-filter")?.value || "All";
    const countyEl = $("county-filter");

    if (countyEl && this.id === "state-filter") {
      const counties =
        state === "All"
          ? uniqueValues(DATA, "county")
          : uniqueValues(DATA.filter((r) => r.state === state), "county");

      populateSelect("county-filter", counties, "Counties");
    }

    updateDashboard();
  }

  function getFilteredRecords() {
    const indicator = $("indicator-filter")?.value || "All";
    const agency = $("agency-filter")?.value || "All";
    const state = $("state-filter")?.value || "All";
    const county = $("county-filter")?.value || "All";

    return DATA.filter((r) => {
      return (
        (indicator === "All" || r.indicator === indicator) &&
        (agency === "All" || r.agency === agency) &&
        (state === "All" || r.state === state) &&
        (county === "All" || r.county === county)
      );
    });
  }

  function recordsForIndicator(records, keywordRules) {
    return records.filter((r) => {
      const t = norm(r.indicator);
      return keywordRules.every((rule) => {
        if (Array.isArray(rule)) return rule.some((x) => t.includes(x));
        return t.includes(rule);
      });
    });
  }

  function groupSum(records, key, valueField) {
    const out = {};
    records.forEach((r) => {
      const k = r[key] || "Not specified";
      out[k] = (out[k] || 0) + (Number(r[valueField]) || 0);
    });

    return Object.entries(out)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }

  function groupIndicators(records) {
    const out = {};

    records.forEach((r) => {
      const indicator = r.indicator || "Not specified";

      if (!out[indicator]) {
        out[indicator] = {
          indicator,
          agencies: new Set(),
          current: 0,
          target: Number(r.target) || 0
        };
      }

      out[indicator].current += Number(r.current) || 0;
      if (r.agency) out[indicator].agencies.add(r.agency);

      if (!out[indicator].target && Number(r.target)) {
        out[indicator].target = Number(r.target);
      }
    });

    return Object.values(out)
      .map((d) => ({
        indicator: d.indicator,
        agencies: [...d.agencies].sort().join(", "),
        current: d.current,
        target: d.target,
        achieved: pct(d.current, d.target)
      }))
      .sort((a, b) => b.current - a.current);
  }

  function groupStateGender(records, topN = 5) {
    const stateTotals = groupSum(records, "state", "current").slice(0, topN);

    return stateTotals.map((d) => {
      const stateRecords = records.filter((r) => r.state === d.name);
      return {
        name: d.name,
        value: d.value,
        male: sum(stateRecords, "male"),
        female: sum(stateRecords, "female")
      };
    });
  }

  function getIndicatorCountByCounty(records) {
    const out = {};

    records.forEach((r) => {
      const county = r.county;
      if (!county) return;

      if (!out[county]) {
        out[county] = {
          county,
          state: r.state,
          indicators: new Set(),
          agencies: new Set()
        };
      }

      if (r.indicator) out[county].indicators.add(r.indicator);
      if (r.agency) out[county].agencies.add(r.agency);
    });

    return out;
  }

  function getChoroplethColor(value, max) {
    if (!value || value <= 0) return "#2f3640";

    const ratio = value / max;

    if (ratio >= 0.80) return "#1f4e79";
    if (ratio >= 0.60) return "#2f6fae";
    if (ratio >= 0.40) return "#4f93c9";
    if (ratio >= 0.20) return "#9ccbe6";
    return "#d6e8f5";
  }

  function getCountyName(feature) {
    return (
      feature.properties.ADM2_EN ||
      feature.properties.County ||
      feature.properties.county ||
      feature.properties.NAME_2 ||
      feature.properties.NAME ||
      ""
    );
  }

  function darkPlotLayout(extra = {}) {
    return {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#e8f1fa", family: "Inter, sans-serif", size: 11 },
      xaxis: {
        gridcolor: "rgba(255,255,255,0.08)",
        zerolinecolor: "rgba(255,255,255,0.15)",
        color: "#8ba8c4"
      },
      yaxis: {
        gridcolor: "rgba(255,255,255,0.05)",
        zerolinecolor: "rgba(255,255,255,0.15)",
        color: "#8ba8c4"
      },
      showlegend: false,
      ...extra
    };
  }

  function plotBar(id, rows, orientation = "h", color = CHART_BLUE, xTitle = "Current Number") {
    const el = $(id);
    if (!el || typeof Plotly === "undefined") return;

    if (!rows.length) {
      Plotly.newPlot(
        id,
        [],
        darkPlotLayout({
          title: { text: "No data", font: { color: "#e8f1fa", size: 13 } },
          margin: { t: 30, r: 20, b: 40, l: 120 }
        }),
        { displayModeBar: false, responsive: true }
      );
      return;
    }

    const chartRows = orientation === "h" ? [...rows].reverse() : rows;

    const trace =
      orientation === "h"
        ? {
            type: "bar",
            orientation: "h",
            y: chartRows.map((d) => shortLabel(d.name, 30)),
            x: chartRows.map((d) => d.value),
            text: chartRows.map((d) => fmt(d.value)),
            textposition: "auto",
            marker: { color },
            customdata: chartRows.map((d) => d.name),
            hovertemplate: "%{customdata}<br>%{x:,}<extra></extra>"
          }
        : {
            type: "bar",
            x: chartRows.map((d) => shortLabel(d.name, 18)),
            y: chartRows.map((d) => d.value),
            text: chartRows.map((d) => fmt(d.value)),
            textposition: "auto",
            marker: { color },
            customdata: chartRows.map((d) => d.name),
            hovertemplate: "%{customdata}<br>%{y:,}<extra></extra>"
          };

    Plotly.newPlot(
      id,
      [trace],
      darkPlotLayout({
        margin: {
          t: 25,
          r: 25,
          b: orientation === "h" ? 40 : 90,
          l: orientation === "h" ? 150 : 55
        },
        xaxis: {
          title: orientation === "h" ? xTitle : "",
          gridcolor: "rgba(255,255,255,0.08)",
          zerolinecolor: "rgba(255,255,255,0.15)",
          color: "#8ba8c4"
        },
        yaxis: {
          title: "",
          gridcolor: "rgba(255,255,255,0.05)",
          zerolinecolor: "rgba(255,255,255,0.15)",
          color: "#8ba8c4",
          automargin: true
        }
      }),
      { displayModeBar: false, responsive: true }
    );
  }

  function plotStackedGender(id, rows) {
    const el = $(id);
    if (!el || typeof Plotly === "undefined") return;

    if (!rows.length) {
      plotBar(id, [], "v");
      return;
    }

    Plotly.newPlot(
      id,
      [
        {
          type: "bar",
          x: rows.map((d) => shortLabel(d.name, 16)),
          y: rows.map((d) => d.male),
          name: "Male",
          marker: { color: MALE_COLOR },
          text: rows.map((d) => fmt(d.male)),
          textposition: "auto"
        },
        {
          type: "bar",
          x: rows.map((d) => shortLabel(d.name, 16)),
          y: rows.map((d) => d.female),
          name: "Female",
          marker: { color: FEMALE_COLOR },
          text: rows.map((d) => fmt(d.female)),
          textposition: "auto"
        }
      ],
      darkPlotLayout({
        barmode: "stack",
        margin: { t: 25, r: 25, b: 90, l: 55 },
        showlegend: true,
        legend: { font: { color: "#e8f1fa" } }
      }),
      { displayModeBar: false, responsive: true }
    );
  }

  function updateKPIs(records) {
    const states = uniqueValues(records.filter((r) => !r.isAdminArea), "state").length;
    const adminAreas = uniqueValues(records.filter((r) => r.isAdminArea), "state").length;
    const indicators = groupIndicators(records);
    const below50 = indicators.filter((r) => Number(r.target) > 0 && Number(r.achieved) < 50).length;

    if ($("kpi-states")) $("kpi-states").textContent = fmt(states);
    if ($("kpi-admin-areas")) $("kpi-admin-areas").textContent = fmt(adminAreas);
    if ($("kpi-counties")) $("kpi-counties").textContent = fmt(uniqueValues(records, "county").length);
    if ($("kpi-agencies")) $("kpi-agencies").textContent = fmt(uniqueValues(records, "agency").length);
    if ($("kpi-indicators")) $("kpi-indicators").textContent = fmt(uniqueValues(records, "indicator").length);
    if ($("kpi-below-50")) $("kpi-below-50").textContent = fmt(below50);
  }

  function updateInsights(records) {
    const el = $("simple-insights-list");
    if (!el) return;

    if (!records.length) {
      el.innerHTML = `<div class="simple-insight-item">No records match the selected filters.</div>`;
      return;
    }

    const indicators = groupIndicators(records);
    const topIndicator = [...indicators]
      .filter((r) => Number(r.target) > 0)
      .sort((a, b) => b.achieved - a.achieved)[0];

    const lowIndicators = indicators.filter((r) => Number(r.target) > 0 && Number(r.achieved) < 50).length;

    el.innerHTML = `
      <div class="simple-insight-item">
        <strong>${fmt(uniqueValues(records, "indicator").length)}</strong> indicators are reported across 
        <strong>${fmt(uniqueValues(records, "county").length)}</strong> counties.
      </div>

      <div class="simple-insight-item">
        Highest performing indicator is 
        <strong>${shortLabel(topIndicator?.indicator || "N/A", 70)}</strong>, achieving 
        <strong>${fmt1(topIndicator?.achieved || 0)}%</strong> of its target.
      </div>

      <div class="simple-insight-item">
        <strong>${fmt(lowIndicators)}</strong> indicator(s) are below 50% achievement against their target.
      </div>
    `;
  }

  function renderIndicatorTable(records) {
    const rows = groupIndicators(records);
    lastTables.indicatorTable = rows;

    const tbody = $("indicator-table");
    if (!tbody) return;

    tbody.innerHTML =
      rows
        .map(
          (r) => `
        <tr>
          <td>${r.indicator}</td>
          <td>${r.agencies}</td>
          <td>${fmt(r.current)}</td>
          <td>${fmt(r.target)}</td>
          <td>${fmt1(r.achieved)}%</td>
        </tr>
      `
        )
        .join("") || `<tr><td colspan="5">No data</td></tr>`;
  }

  function initMap() {
    if (map || !$("peace-map")) return;

    map = L.map("peace-map", { scrollWheelZoom: false }).setView(SOUTH_SUDAN_CENTER, 6);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
    }).addTo(map);
  }

  function updateMap(records) {
    initMap();
    if (!map) return;

    const byCounty = getIndicatorCountByCounty(records);
    const values = Object.values(byCounty).map((d) => d.indicators.size);
    const maxValue = Math.max(...values, 1);

    if (countyGeoJsonLayer) {
      map.removeLayer(countyGeoJsonLayer);
    }

    fetch("data/SouthSudan.json?v=20260501")
      .then((response) => response.json())
      .then((geojson) => {
        countyGeoJsonLayer = L.geoJSON(geojson, {
          style: function (feature) {
            const countyName = getCountyName(feature);
            const item = byCounty[countyName];
            const count = item ? item.indicators.size : 0;

            return {
              fillColor: getChoroplethColor(count, maxValue),
              weight: 0.8,
              opacity: 1,
              color: "rgba(255,255,255,0.55)",
              fillOpacity: count > 0 ? 0.88 : 0.22
            };
          },

          onEachFeature: function (feature, layer) {
            const countyName = getCountyName(feature) || "Unknown county";
            const item = byCounty[countyName];
            const count = item ? item.indicators.size : 0;
            const agencies = item ? [...item.agencies].join(", ") : "No data";

            layer.bindPopup(`
              <strong>${countyName}</strong><br/>
              Indicators reported: ${fmt(count)}<br/>
              Reporting entities: ${agencies}
            `);
          }
        }).addTo(map);

        map.fitBounds(countyGeoJsonLayer.getBounds(), {
          padding: [30, 30]
        });
      })
      .catch(() => {
        setWarning("Could not load assets/adm2.geojson. Please confirm the county boundary file exists in the assets folder.");
      });

    if ($("map-counties")) $("map-counties").textContent = fmt(Object.keys(byCounty).length);
    if ($("map-indicators")) $("map-indicators").textContent = fmt(uniqueValues(records, "indicator").length);
    if ($("map-agencies")) $("map-agencies").textContent = fmt(uniqueValues(records, "agency").length);

    const top = Object.values(byCounty)
      .map((d) => ({
        name: d.county,
        value: d.indicators.size
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    if ($("map-top-counties")) {
      $("map-top-counties").innerHTML =
        top
          .map(
            (d, i) => `
          <div class="ranked-list-item">
            <div class="ranked-left">
              <span class="rank-badge">${i + 1}</span>
              <span class="rank-name">${d.name}</span>
            </div>
            <strong class="rank-value">${fmt(d.value)}</strong>
          </div>
        `
          )
          .join("") || `<div class="ranked-list-item">No data</div>`;
    }
  }

  function renderAchievement(records) {
    const rows = groupIndicators(records).map((r) => ({
      name: r.indicator,
      value: r.achieved,
      current: r.current,
      target: r.target
    }));

    lastTables.indicatorAchievement = rows;

    const achievementRows = [...rows].sort((a, b) => b.value - a.value);

    plotBar("indicator-achievement-chart", achievementRows, "h", CHART_GREEN, "% Achieved");
  }

  function renderIndicatorSpecificCharts(records) {
    const committees = recordsForIndicator(records, [["community peace", "peace committees", "platforms"], ["operational", "conflict mitigation"]]);
    const sgbv = recordsForIndicator(records, ["duty bearers", "sgbv"]);
    const justiceServices = recordsForIndicator(records, [["access-to-justice services", "access to justice services", "legal aid"]]);
    const justiceActors = recordsForIndicator(records, ["justice sector actors"]);
    const mobileJustice = recordsForIndicator(records, [["mobile access-to-justice", "mobile access to justice"]]);
    const civicEducation = recordsForIndicator(records, ["civic education"]);

    plotBar("committees-chart", groupSum(committees, "state", "current").slice(0, 5), "v", CHART_BLUE, "Current Number");
    plotBar("sgbv-chart", groupSum(sgbv, "state", "current").slice(0, 5), "v", CHART_BLUE, "Current Number");

    const justiceServiceRows = groupStateGender(justiceServices, 5);
    if (sum(justiceServices, "male") > 0 || sum(justiceServices, "female") > 0) {
      plotStackedGender("justice-services-chart", justiceServiceRows);
    } else {
      plotBar("justice-services-chart", groupSum(justiceServices, "state", "current").slice(0, 5), "v", CHART_BLUE);
    }

    const justiceActorRows = groupStateGender(justiceActors, 5);
    if (sum(justiceActors, "male") > 0 || sum(justiceActors, "female") > 0) {
      plotStackedGender("justice-actors-chart", justiceActorRows);
    } else {
      plotBar("justice-actors-chart", groupSum(justiceActors, "state", "current").slice(0, 5), "v", CHART_BLUE);
    }

    plotBar("mobile-justice-chart", groupSum(mobileJustice, "state", "current").slice(0, 5), "v", CHART_BLUE, "Current Number");

    const civicRows = groupStateGender(civicEducation, 5);
    if (sum(civicEducation, "male") > 0 || sum(civicEducation, "female") > 0) {
      plotStackedGender("civic-education-chart", civicRows);
    } else {
      plotBar("civic-education-chart", groupSum(civicEducation, "state", "current").slice(0, 5), "v", CHART_BLUE);
    }
  }

  function renderCoverageCharts(records) {
    const stateCoverage = uniqueValues(records, "state")
      .map((state) => {
        const stateRecords = records.filter((r) => r.state === state);
        return {
          name: state,
          value: uniqueValues(stateRecords, "indicator").length
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);

    lastTables.stateCoverage = stateCoverage;

    plotBar("state-indicator-coverage-chart", stateCoverage, "h", CHART_PURPLE, "# of Indicators");
  }

  function updateDashboard() {
    const records = getFilteredRecords();

    updateKPIs(records);
    updateInsights(records);
    renderIndicatorTable(records);
    updateMap(records);
    renderAchievement(records);
    renderIndicatorSpecificCharts(records);
    renderCoverageCharts(records);
  }

  window.downloadChartPNG = function (chartId, filename) {
    if (typeof Plotly === "undefined") return;

    Plotly.downloadImage(chartId, {
      format: "png",
      filename: filename || chartId,
      height: 650,
      width: 1000,
      scale: 2
    });
  };

  window.downloadChartCSV = function (type) {
    const rows = lastTables[type] || [];
    if (!rows.length) return;

    let csv = "";

    if (type === "indicatorTable") {
      csv =
        "Indicator,Reporting UN Entities,Current Number,Target,Achieved %\n" +
        rows
          .map(
            (r) =>
              `"${String(r.indicator || "").replace(/"/g, '""')}","${String(r.agencies || "").replace(/"/g, '""')}",${r.current},${r.target},${r.achieved}`
          )
          .join("\n");
    } else if (type === "indicatorAchievement") {
      csv =
        "Indicator,Achieved %,Current Number,Target\n" +
        rows
          .map(
            (r) =>
              `"${String(r.name || "").replace(/"/g, '""')}",${r.value},${r.current},${r.target}`
          )
          .join("\n");
    } else {
      csv =
        "Name,Value\n" +
        rows.map((r) => `"${String(r.name || "").replace(/"/g, '""')}",${r.value}`).join("\n");
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `peace_governance_${type}.csv`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (!DATA.length) {
      setWarning(
        "No Peace and Governance records found. Please run generate-data-js.py and confirm the All Outputs sheet has Output = Peace and Governance."
      );
    }

    initFilters();
    initMap();
    updateDashboard();
  });
})();