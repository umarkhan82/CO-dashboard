document.addEventListener("DOMContentLoaded", () => {
  const warningBox = document.getElementById("data-warning");

  if (
    typeof CO_DATA === "undefined" ||
    !CO_DATA.basicServices ||
    !Array.isArray(CO_DATA.basicServices.records)
  ) {
    showWarning("Basic Services data was not loaded. Please make sure CO_DATA.basicServices.records exists in js/data.js.");
    return;
  }

  let currentSector = "Education";

  const ADMIN_AREAS = CO_DATA.basicServices.adminAreas || [
    "Abyei Region",
    "Pibor Administrative Area",
    "Ruweng Administrative Area",
    "Abyei",
    "Pibor",
    "Ruweng"
  ];

  const records = CO_DATA.basicServices.records.map(normalizeRecord);

  const indicatorFilter = document.getElementById("indicator-filter");
  const agencyFilter = document.getElementById("agency-filter");
  const stateFilter = document.getElementById("state-filter");
  const countyFilter = document.getElementById("county-filter");
  const resetBtn = document.getElementById("reset-filters");

  let basicMap = null;
  let countyLayer = null;
  let countyGeoJson = null;
  let mapInitialized = false;

  function clean(value) {
    const v = value === undefined || value === null ? "" : String(value).trim();
    return v || "Unknown";
  }

  function toNumber(value) {
    if (value === undefined || value === null || value === "") return 0;
    const n = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeRecord(r) {
    return {
      sector: clean(r.sector || r.subCategory || r.category),
      indicator: clean(r.indicator),
      agency: clean(r.agency),
      state: clean(r.state),
      county: clean(r.county),
      period: clean(r.period),
      current: toNumber(r.current),
      target: toNumber(r.target),
      male: toNumber(r.male),
      female: toNumber(r.female)
    };
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[m]));
  }

  function normText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normName(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\s+county$/i, "")
      .replace("pibor administrative area", "pibor")
      .replace("ruweng administrative area", "ruweng")
      .replace("abyei region", "abyei");
  }

  function uniqueSorted(arr) {
    return [...new Set(arr.filter(v => v && v !== "Unknown"))].sort((a, b) =>
      a.localeCompare(b)
    );
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setOptions(select, values, allLabel = "All") {
    if (!select) return;

    const current = select.value || "All";

    select.innerHTML =
      `<option value="All">${allLabel}</option>` +
      values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");

    select.value = [...select.options].some(o => o.value === current) ? current : "All";
  }

  function sectorRecords() {
    return records.filter(r => r.sector.toLowerCase() === currentSector.toLowerCase());
  }

  function isTotalAncRow(r) {
    return (
      currentSector === "Health" &&
      normText(r.indicator) === "total % antenatal care coverage"
    );
  }

  function isAncCoverageRow(r) {
    return (
      currentSector === "Health" &&
      normText(r.indicator) === "antenatal care coverage"
    );
  }

  function isCombinedAncAgency(r) {
    return (
      currentSector === "Health" &&
      normText(r.agency) === "unicef/unfpa/who"
    );
  }

  function isGeoFilterActive() {
    return (
      (stateFilter.value && stateFilter.value !== "All") ||
      (countyFilter.value && countyFilter.value !== "All")
    );
  }

  function isGeoRow(r) {
    const state = normText(r.state);
    const county = normText(r.county);

    return !(
      state === "country wide" ||
      state === "countrywide" ||
      county === "nationwide" ||
      isTotalAncRow(r)
    );
  }

  function geoRows(rows) {
    return rows.filter(isGeoRow);
  }

  function agencyCountRows(rows) {
    return rows.filter(r => !isCombinedAncAgency(r));
  }

  function progressRows(rows) {
    if (currentSector !== "Health") return rows;

    const selectedIndicator = indicatorFilter.value || "All";

    if (selectedIndicator !== "All") {
      return rows;
    }

    const geoActive = isGeoFilterActive();

    return rows.filter(r => {
      if (geoActive) {
        return !isTotalAncRow(r);
      }

      return !isAncCoverageRow(r);
    });
  }

  function getBeneficiaryValue(r) {
    if (isAncCoverageRow(r)) {
      return Number(r.female || 0);
    }

    return Number(r.current || 0);
  }

  function getHealthBeneficiaryTotal(rows) {
    const fromNumber = rows
      .filter(r => normText(r.indicator) === "people accessing health services")
      .reduce((s, r) => s + Number(r.current || 0), 0);

    const fromFemale = rows
      .filter(r => normText(r.indicator) === "total % antenatal care coverage")
      .reduce((s, r) => s + Number(r.female || 0), 0);

    if (fromFemale === 0 && isGeoFilterActive()) {
      const geoAnc = geoRows(rows)
        .filter(r => isAncCoverageRow(r))
        .reduce((s, r) => s + Number(r.female || 0), 0);

      return fromNumber + geoAnc;
    }

    return fromNumber + fromFemale;
  }

  function getFilteredRecords() {
    const indicator = indicatorFilter.value || "All";
    const agency = agencyFilter.value || "All";
    const state = stateFilter.value || "All";
    const county = countyFilter.value || "All";

    return sectorRecords().filter(r =>
      (indicator === "All" || r.indicator === indicator) &&
      (agency === "All" || r.agency === agency) &&
      (state === "All" || r.state === state) &&
      (county === "All" || r.county === county)
    );
  }

  function refreshDependentFilters(changedFilter = "") {
    const baseSector = sectorRecords();

    if (changedFilter === "sector") {
      indicatorFilter.value = "All";
      agencyFilter.value = "All";
      stateFilter.value = "All";
      countyFilter.value = "All";
    }

    if (changedFilter === "indicator" || changedFilter === "agency") {
      stateFilter.value = "All";
      countyFilter.value = "All";
    }

    if (changedFilter === "state") {
      countyFilter.value = "All";
    }

    setOptions(indicatorFilter, uniqueSorted(baseSector.map(r => r.indicator)));

    let agencyBase = baseSector.filter(r =>
      indicatorFilter.value === "All" || r.indicator === indicatorFilter.value
    );

    if (currentSector === "Health" && indicatorFilter.value === "All") {
      agencyBase = agencyCountRows(geoRows(agencyBase));
    }

    setOptions(agencyFilter, uniqueSorted(agencyBase.map(r => r.agency)));

    const stateBase = baseSector.filter(r =>
      (indicatorFilter.value === "All" || r.indicator === indicatorFilter.value) &&
      (agencyFilter.value === "All" || r.agency === agencyFilter.value)
    );

    setOptions(stateFilter, uniqueSorted(geoRows(stateBase).map(r => r.state)));

    const countyBase = stateBase.filter(r =>
      stateFilter.value === "All" || r.state === stateFilter.value
    );

    setOptions(countyFilter, uniqueSorted(geoRows(countyBase).map(r => r.county)));
  }

  function groupSum(rows, field) {
    return rows.reduce((out, r) => {
      const key = r[field] || "Unknown";
      out[key] = (out[key] || 0) + getBeneficiaryValue(r);
      return out;
    }, {});
  }

  function groupIndicators(rows) {
    const grouped = {};

    rows.forEach(r => {
      if (!grouped[r.indicator]) {
        grouped[r.indicator] = {
          indicator: r.indicator,
          agencies: new Set(),
          current: 0,
          target: Number(r.target || 0),
          count: 0,
          isCoverage: isAncCoverageRow(r) || isTotalAncRow(r)
        };
      }

      grouped[r.indicator].agencies.add(r.agency);

      if (grouped[r.indicator].isCoverage) {
        grouped[r.indicator].current += Number(r.current || 0);
        grouped[r.indicator].count += 1;
      } else {
        grouped[r.indicator].current += Number(r.current || 0);
      }

      if (!grouped[r.indicator].target && r.target) {
        grouped[r.indicator].target = Number(r.target || 0);
      }
    });

    return Object.values(grouped)
      .map(d => {
        if (d.isCoverage && d.count > 1) {
          d.current = d.current / d.count;
        }
        return d;
      })
      .sort((a, b) => b.current - a.current);
  }

  function groupCountyFull(rows) {
    const grouped = {};

    rows.forEach(r => {
      const key = normName(r.county);
      if (!key || key === "unknown") return;

      if (!grouped[key]) {
        grouped[key] = {
          county: r.county,
          state: r.state,
          agencies: new Set(),
          indicators: new Set(),
          current: 0,
          male: 0,
          female: 0
        };
      }

      if (!isCombinedAncAgency(r)) grouped[key].agencies.add(r.agency);
      grouped[key].indicators.add(r.indicator);
      grouped[key].current += getBeneficiaryValue(r);
      grouped[key].male += r.male;
      grouped[key].female += r.female;
    });

    return grouped;
  }

  function renderKpis(rows) {
    const rowsForGeo = geoRows(rows);
    const rowsForAgencyCount = agencyCountRows(rowsForGeo);

    const states = new Set();
    const adminAreas = new Set();
    const counties = new Set();
    const agencies = new Set();

    rowsForGeo.forEach(r => {
      if (ADMIN_AREAS.includes(r.state)) {
        adminAreas.add(r.state);
      } else if (r.state !== "Unknown") {
        states.add(r.state);
      }

      if (r.county !== "Unknown") counties.add(r.county);
    });

    rowsForAgencyCount.forEach(r => {
      if (r.agency !== "Unknown") agencies.add(r.agency);
    });

    const totalBeneficiaries =
      currentSector === "Health"
        ? getHealthBeneficiaryTotal(rows)
        : rowsForGeo.reduce((s, r) => s + getBeneficiaryValue(r), 0);

    setText("snapshot-title", `${currentSector} Snapshot`);
    setText("kpi-states", fmt(states.size));
    setText("kpi-admin-areas", fmt(adminAreas.size));
    setText("kpi-counties", fmt(counties.size));
    setText("kpi-agencies", fmt(agencies.size));
    setText("kpi-current", fmt(totalBeneficiaries));
    setText("kpi-male", fmt(rowsForGeo.reduce((s, r) => s + r.male, 0)));
    setText("kpi-female", fmt(rowsForGeo.reduce((s, r) => s + r.female, 0)));
  }

  function renderTable(rows) {
    const tbody = document.getElementById("indicator-table");
    if (!tbody) return;

    const grouped = groupIndicators(rows);

    if (!grouped.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No records match the selected filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = grouped.map(d => {
      const achieved = d.target ? `${((d.current / d.target) * 100).toFixed(1)}%` : "—";

      return `
        <tr>
          <td>${escapeHtml(currentSector)}</td>
          <td>${escapeHtml(d.indicator)}</td>
          <td>${escapeHtml([...d.agencies].sort().join(", "))}</td>
          <td class="total-col">${d.isCoverage ? d.current.toFixed(1) : fmt(d.current)}</td>
          <td>${fmt(d.target)}</td>
          <td class="total-col">${achieved}</td>
        </tr>
      `;
    }).join("");
  }

  function renderBarChart(id, obj, limit = 12, color = "#00AEEF") {
    const el = document.getElementById(id);
    if (!el || typeof Plotly === "undefined") return;

    const entries = Object.entries(obj)
      .filter(([name, value]) => name && name !== "Unknown" && Number(value) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, limit)
      .reverse();

    if (!entries.length) {
      Plotly.purge(id);
      el.innerHTML = `<div class="empty-chart">No data available</div>`;
      return;
    }

    const maxValue = Math.max(...entries.map(d => d[1]));

    Plotly.newPlot(id, [{
      type: "bar",
      orientation: "h",
      y: entries.map(d => d[0]),
      x: entries.map(d => d[1]),
      marker: {
        color,
        line: { color: "rgba(255,255,255,0.15)", width: 1 }
      },
      text: entries.map(d => fmt(d[1])),
      textposition: "outside",
      cliponaxis: false,
      hovertemplate: "<b>%{y}</b><br>%{x:,}<extra></extra>"
    }], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 18, r: maxValue > 999999 ? 105 : 80, b: 42, l: 190 },
      bargap: 0.32,
      xaxis: {
        gridcolor: "rgba(0,158,219,0.12)",
        zeroline: false,
        tickfont: { size: 11 },
        automargin: true
      },
      yaxis: {
        automargin: true,
        tickfont: { size: 11 }
      }
    }, {
      displayModeBar: false,
      responsive: true
    });
  }

  function renderGenderChart(rows) {
    const el = document.getElementById("gender-chart");
    if (!el || typeof Plotly === "undefined") return;

    const male = rows.reduce((s, r) => s + r.male, 0);
    const female = rows.reduce((s, r) => s + r.female, 0);

    if (!male && !female) {
      Plotly.purge("gender-chart");
      el.innerHTML = `<div class="empty-chart">No gender data available</div>`;
      return;
    }

    Plotly.newPlot("gender-chart", [{
      type: "pie",
      labels: ["Male", "Female"],
      values: [male, female],
      hole: 0.62,
      marker: {
        colors: ["#60a5fa", "#f472b6"],
        line: { color: "#122a4d", width: 2 }
      },
      textinfo: "percent",
      textfont: { color: "#e8f1fa", size: 13 },
      hovertemplate: "<b>%{label}</b><br>%{value:,}<br>%{percent}<extra></extra>"
    }], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 15, r: 20, b: 15, l: 20 },
      legend: { orientation: "v", x: 1, y: 0.5, font: { size: 12 } },
      annotations: [{
        text: `<b>${fmt(male + female)}</b><br><span style="font-size:11px;color:#8ba8c4">Total</span>`,
        showarrow: false,
        x: 0.5,
        y: 0.5,
        font: { color: "#e8f1fa", size: 15 }
      }]
    }, {
      displayModeBar: false,
      responsive: true
    });
  }

  function renderIndicatorAgencyChart(rows) {
  const el = document.getElementById("indicator-agency-chart");
  if (!el || typeof Plotly === "undefined") return;

  const indicatorMap = {};
  const agencies = new Set();

  rows.forEach(r => {
    const indicator = r.indicator || "Unknown";
    const agency = r.agency || "Unknown";

    if (!indicatorMap[indicator]) {
      indicatorMap[indicator] = {
        indicator,
        target: Number(r.target || 0),
        total: 0,
        agencies: {},
        isCoverage: isAncCoverageRow(r) || isTotalAncRow(r),
        count: 0
      };
    }

    if (indicatorMap[indicator].isCoverage) {
      indicatorMap[indicator].total += Number(r.current || 0);
      indicatorMap[indicator].count += 1;
      indicatorMap[indicator].agencies[agency] =
        (indicatorMap[indicator].agencies[agency] || 0) + Number(r.current || 0);
    } else {
      indicatorMap[indicator].total += Number(r.current || 0);
      indicatorMap[indicator].agencies[agency] =
        (indicatorMap[indicator].agencies[agency] || 0) + Number(r.current || 0);
    }

    agencies.add(agency);

    if (!indicatorMap[indicator].target && r.target) {
      indicatorMap[indicator].target = Number(r.target || 0);
    }
  });

  const indicators = Object.values(indicatorMap)
    .map(d => {
      if (d.isCoverage && d.count > 1) {
        d.total = d.total / d.count;

        Object.keys(d.agencies).forEach(a => {
          d.agencies[a] = d.agencies[a] / d.count;
        });
      }

      return d;
    })
    .filter(d => d.indicator !== "Unknown" && d.total > 0 && d.target > 0)
    .sort((a, b) => (b.total / b.target) - (a.total / a.target));

  if (!indicators.length) {
    Plotly.purge("indicator-agency-chart");
    el.innerHTML = `<div class="empty-chart">No indicator achievement data available</div>`;
    return;
  }

  const agencyList = [...agencies].filter(a => a !== "Unknown").sort();

  const palette = [
    "#00AEEF",
    "#2ED3B7",
    "#F472B6",
    "#A66CFF",
    "#F4C542",
    "#60A5FA",
    "#FB923C"
  ];

  const yLabels = indicators.map(d => d.indicator).reverse();
  const reversedIndicators = indicators.slice().reverse();

  const traces = agencyList.map((agency, index) => ({
    type: "bar",
    orientation: "h",
    name: agency,
    y: yLabels,
    x: reversedIndicators.map(d => {
      const value = d.agencies[agency] || 0;
      return d.target ? (value / d.target) * 100 : 0;
    }),
    customdata: reversedIndicators.map(d => {
      const value = d.agencies[agency] || 0;
      return [
        value,
        d.target,
        d.target ? (value / d.target) * 100 : 0
      ];
    }),
    marker: {
      color: palette[index % palette.length],
      line: { color: "rgba(255,255,255,0.16)", width: 1 }
    },
    hovertemplate:
      `<b>${agency}</b><br>` +
      `%{y}<br>` +
      `Contribution: %{customdata[0]:,.1f}<br>` +
      `Target: %{customdata[1]:,}<br>` +
      `Contribution to target: %{customdata[2]:.1f}%` +
      `<extra></extra>`
  }));

  const totalLabels = {
    type: "scatter",
    mode: "text",
    showlegend: false,
    y: yLabels,
    x: reversedIndicators.map(d => d.target ? (d.total / d.target) * 100 : 0),
    text: reversedIndicators.map(d => d.target ? `${((d.total / d.target) * 100).toFixed(1)}%` : "—"),
    textposition: "middle right",
    textfont: {
      color: "#B8D9F7",
      size: 12,
      family: "Inter, sans-serif"
    },
    hoverinfo: "skip",
    cliponaxis: false
  };

  const maxAchieved = Math.max(
    120,
    ...reversedIndicators.map(d => d.target ? (d.total / d.target) * 100 : 0)
  );

  Plotly.newPlot("indicator-agency-chart", [...traces, totalLabels], {
    barmode: "stack",
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#8ba8c4", family: "Inter, sans-serif" },
    margin: { t: 22, r: 150, b: 70, l: 330 },
    bargap: 0.35,
    xaxis: {
      range: [0, maxAchieved * 1.12],
      ticksuffix: "%",
      gridcolor: "rgba(0,158,219,0.13)",
      zeroline: false,
      tickfont: { size: 11 },
      automargin: true
    },
    yaxis: {
      automargin: true,
      tickfont: { size: 11 }
    },
    shapes: [{
      type: "line",
      x0: 100,
      x1: 100,
      y0: -0.5,
      y1: yLabels.length - 0.5,
      xref: "x",
      yref: "y",
      line: {
        color: "rgba(255,255,255,0.75)",
        width: 2,
        dash: "dot"
      }
    }],
    annotations: [{
      x: 100,
      y: yLabels.length - 0.35,
      xref: "x",
      yref: "y",
      text: "100% target",
      showarrow: false,
      font: { color: "#ffffff", size: 11 },
      xanchor: "left",
      yanchor: "bottom"
    }],
    legend: {
      orientation: "h",
      x: 0,
      y: -0.22,
      font: { size: 12 },
      bgcolor: "rgba(0,0,0,0)"
    }
  }, {
    displayModeBar: false,
    responsive: true
  });

  }

  function getColor(value, minValue, maxValue) {
    if (!value || value <= 0) return "#3b3b3b";
    if (maxValue === minValue) return "#2f6fae";

    const ratio = (value - minValue) / (maxValue - minValue);

    if (ratio >= 0.85) return "#1f4e79";
    if (ratio >= 0.70) return "#2f6fae";
    if (ratio >= 0.55) return "#4f93c9";
    if (ratio >= 0.40) return "#76b5d8";
    if (ratio >= 0.25) return "#9ccbe6";
    if (ratio >= 0.10) return "#b9d8ec";
    return "#d6e8f5";
  }

  async function initBasicMap() {
    if (mapInitialized || typeof L === "undefined") return;

    const mapEl = document.getElementById("basic-map");
    if (!mapEl) return;

    basicMap = L.map("basic-map", {
      zoomControl: true,
      attributionControl: false
    }).setView([7.6, 30.2], 6);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 12
    }).addTo(basicMap);

    L.control.attribution({ prefix: false })
      .addAttribution("&copy; OpenStreetMap &copy; CARTO")
      .addTo(basicMap);

    try {
      const res = await fetch("data/SouthSudan.json?v=20260503");
      if (!res.ok) throw new Error("Could not load data/SouthSudan.json");

      countyGeoJson = await res.json();
      mapInitialized = true;

      setTimeout(() => basicMap.invalidateSize(), 150);
    } catch (err) {
      showWarning("Map boundary file was not loaded. Please place SouthSudan.json inside the data folder.");
      console.error(err);
    }
  }

  function styleCounty(feature, countyData, minValue, maxValue) {
    const countyName = feature.properties.ADM2_EN || "";
    const d = countyData[normName(countyName)];
    const value = d ? d.current : 0;

    return {
      fillColor: getColor(value, minValue, maxValue),
      weight: 0.9,
      opacity: 1,
      color: value > 0 ? "rgba(220,235,250,0.75)" : "rgba(160,160,160,0.35)",
      fillOpacity: value > 0 ? 0.85 : 0.42
    };
  }

  function createPopupHtml(countyName, stateName, d) {
    if (!d) {
      return `
        <div class="leaflet-popup-custom">
          <div class="popup-title">${escapeHtml(countyName)}</div>
          <div class="popup-subtitle">${escapeHtml(stateName)}</div>
          <div class="popup-row"><span>Beneficiaries</span><strong>No data</strong></div>
        </div>
      `;
    }

    const indicatorsSummary = [...d.indicators]
      .filter(Boolean)
      .sort()
      .map(i => `<div class="popup-bullet">• ${escapeHtml(i)}</div>`)
      .join("");

    const agenciesSummary = [...d.agencies].filter(Boolean).sort().join(", ");

    return `
      <div class="leaflet-popup-custom">
        <div class="popup-title">${escapeHtml(countyName)}</div>
        <div class="popup-subtitle">${escapeHtml(stateName)}</div>
        <div class="popup-row"><span>Beneficiaries</span><strong>${fmt(d.current)}</strong></div>
        <div class="popup-row"><span>Male</span><strong>${fmt(d.male)}</strong></div>
        <div class="popup-row"><span>Female</span><strong>${fmt(d.female)}</strong></div>
        <div class="popup-section">
          <div class="popup-section-title">Reporting Agencies</div>
          <div class="popup-text">${escapeHtml(agenciesSummary || "—")}</div>
        </div>
        <div class="popup-section">
          <div class="popup-section-title">Indicators</div>
          ${indicatorsSummary || `<div class="popup-text">—</div>`}
        </div>
      </div>
    `;
  }

  function autoZoomMapToFilteredData(countyData, layerGroup) {
    if (!basicMap || !layerGroup) return;

    const filteredCountyNames = new Set(
      Object.values(countyData)
        .filter(d => d.current > 0)
        .map(d => normName(d.county))
    );

    const matchingLayers = [];

    layerGroup.eachLayer(layer => {
      const countyName = layer.feature?.properties?.ADM2_EN || "";
      if (filteredCountyNames.has(normName(countyName))) {
        matchingLayers.push(layer);
      }
    });

    try {
      if (matchingLayers.length > 0) {
        const bounds = L.featureGroup(matchingLayers).getBounds();
        basicMap.fitBounds(bounds, {
          padding: [45, 45],
          maxZoom: matchingLayers.length === 1 ? 8.8 : 7.6,
          animate: true,
          duration: 1.2
        });
      } else {
        basicMap.fitBounds(layerGroup.getBounds(), {
          padding: [25, 25],
          maxZoom: 6.2,
          animate: true,
          duration: 1.2
        });
      }

      setTimeout(() => basicMap.invalidateSize(), 150);
    } catch (e) {
      basicMap.setView([7.6, 30.2], 6);
    }
  }

  function renderBasicMap(rows) {
    if (!basicMap || !countyGeoJson) return;

    const countyData = groupCountyFull(rows);
    const values = Object.values(countyData).map(d => d.current).filter(v => v > 0);

    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 0;

    if (countyLayer) {
      basicMap.removeLayer(countyLayer);
    }

    countyLayer = L.geoJSON(countyGeoJson, {
      style: feature => styleCounty(feature, countyData, minValue, maxValue),
      onEachFeature: (feature, layer) => {
        const countyName = feature.properties.ADM2_EN || "Unknown";
        const stateName = feature.properties.ADM1_EN || "Unknown";
        const d = countyData[normName(countyName)];

        layer.bindPopup(createPopupHtml(countyName, stateName, d), {
          maxWidth: 340,
          minWidth: 280,
          className: "food-popup"
        });

        layer.on({
          mouseover: e => {
            e.target.setStyle({
              weight: 2,
              color: "#ffffff",
              fillOpacity: 0.95
            });
            e.target.bringToFront();
          },
          mouseout: e => {
            countyLayer.resetStyle(e.target);
          }
        });
      }
    }).addTo(basicMap);

    autoZoomMapToFilteredData(countyData, countyLayer);
    renderMapSummary(countyData);
  }

  function renderMapSummary(countyData) {
    const counties = Object.values(countyData).filter(d => d.current > 0);

    setText("map-counties", fmt(counties.length));
    setText("map-beneficiaries", fmt(counties.reduce((s, d) => s + d.current, 0)));
    setText("map-male", fmt(counties.reduce((s, d) => s + d.male, 0)));
    setText("map-female", fmt(counties.reduce((s, d) => s + d.female, 0)));

    const top = counties.sort((a, b) => b.current - a.current).slice(0, 5);
    const topEl = document.getElementById("map-top-counties");
    if (!topEl) return;

    topEl.innerHTML = top.length
      ? top.map((d, i) => `
          <div class="top-row">
            <div class="top-rank">${i + 1}</div>
            <div class="top-name">${escapeHtml(d.county)}</div>
            <div class="top-value">${fmt(d.current)}</div>
          </div>
        `).join("")
      : `<div class="top-empty">No county data available</div>`;
  }

  function renderSimpleInsights(rows, rowsForGeo) {
    const container = document.getElementById("simple-insights-list");
    if (!container) return;

    const beneficiaryRows =
      currentSector === "Health"
        ? rowsForGeo.filter(r =>
            normText(r.indicator) === "people accessing health services" ||
            normText(r.indicator) === "antenatal care coverage"
          )
        : rowsForGeo;

    const total =
      currentSector === "Health"
        ? getHealthBeneficiaryTotal(rows)
        : beneficiaryRows.reduce((s, r) => s + getBeneficiaryValue(r), 0);

    if (!beneficiaryRows.length || total <= 0) {
      container.innerHTML = `<div class="simple-insight-item">No records match the selected filters.</div>`;
      return;
    }

    const stateTotals = groupSum(beneficiaryRows, "state");
    const countyTotals = groupSum(beneficiaryRows, "county");
    const agencyTotals = groupSum(agencyCountRows(beneficiaryRows), "agency");

    const topState = Object.entries(stateTotals).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1])[0];
    const topCounty = Object.entries(countyTotals).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1])[0];
    const topAgency = Object.entries(agencyTotals).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1])[0];

    const rowsForProgress = progressRows(rows);

    const indicatorGrouped = groupIndicators(rowsForProgress)
      .filter(d => d.target && d.current > 0)
      .map(d => ({ ...d, pct: (d.current / d.target) * 100 }))
      .sort((a, b) => a.pct - b.pct);

    const weakest = indicatorGrouped[0];
    const strongest = indicatorGrouped[indicatorGrouped.length - 1];

    const entityCount = new Set(
      agencyCountRows(beneficiaryRows)
        .map(r => r.agency)
        .filter(a => a && a !== "Unknown")
    ).size;

    container.innerHTML = `
      <div class="simple-insight-item"><strong>${escapeHtml(topState ? topState[0] : "N/A")}</strong> accounts for <span class="insight-blue">${topState ? ((topState[1] / total) * 100).toFixed(1) : "0.0"}%</span> of ${currentSector.toLowerCase()} beneficiaries in the current selection.</div>
      <div class="simple-insight-item">The highest county is <strong>${escapeHtml(topCounty ? topCounty[0] : "N/A")}</strong>, contributing <span class="insight-blue">${topCounty ? ((topCounty[1] / total) * 100).toFixed(1) : "0.0"}%</span> of selected beneficiaries.</div>
      <div class="simple-insight-item">Leading reporting entity: <strong>${escapeHtml(topAgency ? topAgency[0] : "N/A")}</strong> with <span class="insight-blue">${topAgency ? ((topAgency[1] / total) * 100).toFixed(1) : "0.0"}%</span> of selected beneficiaries.</div>
      <div class="simple-insight-item">${strongest ? `<strong>${escapeHtml(strongest.indicator)}</strong> is the strongest target-linked indicator at <span class="${strongest.pct >= 100 ? "insight-good" : "insight-blue"}">${strongest.pct.toFixed(1)}%</span> of target.` : `No target-linked indicator is available for comparison.`}</div>
      <div class="simple-insight-item">${weakest ? `<strong>${escapeHtml(weakest.indicator)}</strong> is the lowest target-linked indicator at <span class="${weakest.pct >= 100 ? "insight-good" : "insight-warn"}">${weakest.pct.toFixed(1)}%</span> of target.` : `Target-linked performance could not be calculated because target values are missing.`}</div>
      <div class="simple-insight-item">Selected data covers <strong>${fmt(new Set(beneficiaryRows.map(r => r.county).filter(c => c && c !== "Unknown")).size)}</strong> county/counties and <strong>${fmt(entityCount)}</strong> reporting entity/entities.</div>
    `;
  }

  async function renderDashboard(changedFilter = "") {
    refreshDependentFilters(changedFilter);

    const rows = getFilteredRecords();
    const rowsForGeo = geoRows(rows);
    const rowsForProgress = progressRows(rows);
    const rowsForAgencyCharts = agencyCountRows(rowsForGeo);

    renderKpis(rows);
    renderSimpleInsights(rows, rowsForGeo);
    renderTable(rowsForProgress);
    renderIndicatorAgencyChart(rowsForProgress);

    renderBarChart("state-chart", groupSum(rowsForGeo, "state"), 13, "#00AEEF");
    renderBarChart("county-chart", groupSum(rowsForGeo, "county"), 12, "#00AEEF");
    renderBarChart("agency-chart", groupSum(rowsForAgencyCharts, "agency"), 10, "#2ED3B7");
    renderGenderChart(rowsForGeo);

    if (!mapInitialized) {
      await initBasicMap();
    }

    renderBasicMap(rowsForGeo);
  }

  function initializeFilters() {
    setOptions(indicatorFilter, uniqueSorted(sectorRecords().map(r => r.indicator)));

    let agencyBase = sectorRecords();
    if (currentSector === "Health") agencyBase = agencyCountRows(geoRows(agencyBase));

    setOptions(agencyFilter, uniqueSorted(agencyBase.map(r => r.agency)));
    setOptions(stateFilter, uniqueSorted(geoRows(sectorRecords()).map(r => r.state)));
    setOptions(countyFilter, uniqueSorted(geoRows(sectorRecords()).map(r => r.county)));

    indicatorFilter.addEventListener("change", () => renderDashboard("indicator"));
    agencyFilter.addEventListener("change", () => renderDashboard("agency"));
    stateFilter.addEventListener("change", () => renderDashboard("state"));
    countyFilter.addEventListener("change", () => renderDashboard("county"));

    resetBtn.addEventListener("click", () => {
      indicatorFilter.value = "All";
      agencyFilter.value = "All";
      stateFilter.value = "All";
      countyFilter.value = "All";
      renderDashboard();
    });

    document.querySelectorAll(".sector-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        currentSector = btn.dataset.sector;
        document.querySelectorAll(".sector-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderDashboard("sector");
      });
    });
  }

  function showWarning(message) {
    if (!warningBox) return;
    warningBox.textContent = message;
    warningBox.style.display = "block";
  }

  window.toggleBasicIndicatorTable = function () {
    const panel = document.getElementById("indicator-table-panel");
    const btn = document.getElementById("indicator-table-toggle");
    if (!panel || !btn) return;

    const isHidden = panel.style.display === "none" || panel.style.display === "";
    panel.style.display = isHidden ? "block" : "none";
    btn.textContent = isHidden ? "Hide Detailed Table" : "Show Detailed Table";
  };

  function rowsToCsv(rows) {
    return rows.map(row => row.map(value => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(",")).join("\n");
  }

  function triggerCsvDownload(filename, csvText) {
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  window.downloadBasicChartCSV = function (type) {
    const rows = getFilteredRecords();
    const rowsForGeo = geoRows(rows);
    const rowsForProgress = progressRows(rows);
    const rowsForAgency = agencyCountRows(rowsForGeo);
    let csvRows = [];

    if (type === "state") {
      csvRows = [["State/Admin Area", "Beneficiaries"]];
      Object.entries(groupSum(rowsForGeo, "state")).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1]).forEach(([n, v]) => csvRows.push([n, v]));
    }

    if (type === "county") {
      csvRows = [["County", "Beneficiaries"]];
      Object.entries(groupSum(rowsForGeo, "county")).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1]).forEach(([n, v]) => csvRows.push([n, v]));
    }

    if (type === "agency") {
      csvRows = [["Reporting Entity", "Beneficiaries"]];
      Object.entries(groupSum(rowsForAgency, "agency")).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1]).forEach(([n, v]) => csvRows.push([n, v]));
    }

    if (type === "gender") {
      csvRows = [
        ["Gender", "Number"],
        ["Male", rowsForGeo.reduce((s, r) => s + r.male, 0)],
        ["Female", rowsForGeo.reduce((s, r) => s + r.female, 0)]
      ];
    }

    if (type === "indicatorAgency") {
      csvRows = [["Sector", "Indicator", "Reporting Agencies", "Current Number", "Target", "Achievement %"]];

      groupIndicators(rowsForProgress).forEach(d => {
        csvRows.push([
          currentSector,
          d.indicator,
          [...d.agencies].sort().join(", "),
          d.isCoverage ? d.current.toFixed(1) : d.current,
          d.target,
          d.target ? ((d.current / d.target) * 100).toFixed(1) : ""
        ]);
      });
    }

    if (csvRows.length) {
      triggerCsvDownload(
        `basic_services_${currentSector.toLowerCase()}_${type}_chart_data.csv`,
        rowsToCsv(csvRows)
      );
    }
  };

  window.downloadBasicChartPNG = function (chartId, fileName) {
    if (typeof Plotly === "undefined") return;

    const chart = document.getElementById(chartId);
    if (!chart || !chart.data) return;

    Plotly.downloadImage(chart, {
      format: "png",
      filename: fileName,
      height: 850,
      width: 1400,
      scale: 2
    });
  };

  initializeFilters();
  renderDashboard();

  window.addEventListener("resize", () => {
    ["state-chart", "county-chart", "indicator-agency-chart", "agency-chart", "gender-chart"].forEach(id => {
      const el = document.getElementById(id);
      if (el && typeof Plotly !== "undefined") Plotly.Plots.resize(el);
    });

    if (basicMap) {
      setTimeout(() => basicMap.invalidateSize(), 150);
    }
  });
});