document.addEventListener("DOMContentLoaded", () => {
  const warningBox = document.getElementById("data-warning");

  if (
    typeof CO_DATA === "undefined" ||
    !CO_DATA.durableSolutions ||
    !Array.isArray(CO_DATA.durableSolutions.records)
  ) {
    showWarning("Durable Solutions data was not loaded. Please make sure CO_DATA.durableSolutions.records exists in js/data.js.");
    return;
  }

  let currentCategory = "DS-BS";

  const CATEGORY_LABELS = {
    "DS-BS": "DS Basic Services",
    "DS-LHE": "DS Livelihoods & Economic Inclusion",
    "DS-Sec": "DS Security"
  };

  const ADMIN_AREAS = CO_DATA.durableSolutions.adminAreas || [
    "Abyei Region",
    "Pibor Administrative Area",
    "Ruweng Administrative Area",
    "Abyei",
    "Pibor",
    "Ruweng"
  ];

  const records = CO_DATA.durableSolutions.records.map(normalizeRecord);

  const indicatorFilter = document.getElementById("indicator-filter");
  const agencyFilter = document.getElementById("agency-filter");
  const stateFilter = document.getElementById("state-filter");
  const countyFilter = document.getElementById("county-filter");
  const resetBtn = document.getElementById("reset-filters");

  let durableMap = null;
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
      category: clean(r.category),
      sector: clean(r.sector),
      indicator: clean(r.indicator),
      supportType: clean(r.supportType),
      agency: clean(r.agency),
      state: clean(r.state),
      county: clean(r.county),
      period: clean(r.period),
      current: toNumber(r.current),
      male: toNumber(r.male),
      female: toNumber(r.female),
      idps: toNumber(r.idps),
      returnees: toNumber(r.returnees),
      hostCommunity: toNumber(r.hostCommunity)
    };
  }

  function beneficiaryValue(r) {
    return Number(r.male || 0) + Number(r.female || 0);
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, m => ({
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

  function categoryRecords() {
    return records.filter(r => r.category === currentCategory);
  }

  function isGeoRow(r) {
    const state = normText(r.state);
    const county = normText(r.county);

    return !(
      state === "country wide" ||
      state === "countrywide" ||
      county === "nationwide" ||
      state === "unknown" ||
      county === "unknown"
    );
  }

  function geoRows(rows) {
    return rows.filter(isGeoRow);
  }

  function getFilteredRecords() {
    const indicator = indicatorFilter.value || "All";
    const agency = agencyFilter.value || "All";
    const state = stateFilter.value || "All";
    const county = countyFilter.value || "All";

    return categoryRecords().filter(r =>
      (indicator === "All" || r.indicator === indicator) &&
      (agency === "All" || r.agency === agency) &&
      (state === "All" || r.state === state) &&
      (county === "All" || r.county === county)
    );
  }

  function refreshDependentFilters(changedFilter = "") {
    const baseCategory = categoryRecords();

    if (changedFilter === "category") {
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

    setOptions(indicatorFilter, uniqueSorted(baseCategory.map(r => r.indicator)));

    const agencyBase = baseCategory.filter(r =>
      indicatorFilter.value === "All" || r.indicator === indicatorFilter.value
    );
    setOptions(agencyFilter, uniqueSorted(agencyBase.map(r => r.agency)));

    const stateBase = baseCategory.filter(r =>
      (indicatorFilter.value === "All" || r.indicator === indicatorFilter.value) &&
      (agencyFilter.value === "All" || r.agency === agencyFilter.value)
    );
    setOptions(stateFilter, uniqueSorted(geoRows(stateBase).map(r => r.state)));

    const countyBase = stateBase.filter(r =>
      stateFilter.value === "All" || r.state === stateFilter.value
    );
    setOptions(countyFilter, uniqueSorted(geoRows(countyBase).map(r => r.county)));
  }

  function groupSum(rows, field, useBeneficiaries = false) {
    return rows.reduce((out, r) => {
      const key = r[field] || "Unknown";
      out[key] = (out[key] || 0) + (useBeneficiaries ? beneficiaryValue(r) : Number(r.current || 0));
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
          beneficiaries: 0
        };
      }

      grouped[r.indicator].agencies.add(r.agency);
      grouped[r.indicator].current += Number(r.current || 0);
      grouped[r.indicator].beneficiaries += beneficiaryValue(r);
    });

    return Object.values(grouped).sort((a, b) => b.current - a.current);
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
          female: 0,
          idps: 0,
          returnees: 0,
          hostCommunity: 0
        };
      }

      grouped[key].agencies.add(r.agency);
      grouped[key].indicators.add(r.indicator);

      // For map and map summary, current = beneficiaries = male + female
      grouped[key].current += beneficiaryValue(r);

      grouped[key].male += r.male;
      grouped[key].female += r.female;
      grouped[key].idps += r.idps;
      grouped[key].returnees += r.returnees;
      grouped[key].hostCommunity += r.hostCommunity;
    });

    return grouped;
  }

  function renderKpis(rows) {
    const rowsForGeo = geoRows(rows);

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
      if (r.agency !== "Unknown") agencies.add(r.agency);
    });

    setText("snapshot-title", `${CATEGORY_LABELS[currentCategory]} Snapshot`);
    setText("kpi-states", fmt(states.size));
    setText("kpi-admin-areas", fmt(adminAreas.size));
    setText("kpi-counties", fmt(counties.size));
    setText("kpi-agencies", fmt(agencies.size));
    setText("kpi-current", fmt(rowsForGeo.reduce((s, r) => s + beneficiaryValue(r), 0)));
    setText("kpi-male", fmt(rowsForGeo.reduce((s, r) => s + r.male, 0)));
    setText("kpi-female", fmt(rowsForGeo.reduce((s, r) => s + r.female, 0)));
  }

  function renderSimpleInsights(rows, rowsForGeo) {
    const container = document.getElementById("simple-insights-list");
    if (!container) return;

    const totalBeneficiaries = rowsForGeo.reduce((s, r) => s + beneficiaryValue(r), 0);

    if (!rowsForGeo.length || totalBeneficiaries <= 0) {
      container.innerHTML = `<div class="simple-insight-item">No records match the selected filters.</div>`;
      return;
    }

    const stateTotals = groupSum(rowsForGeo, "state", true);
    const countyTotals = groupSum(rowsForGeo, "county", true);
    const agencyTotals = groupSum(rowsForGeo, "agency", true);
    const indicatorTotals = groupSum(rowsForGeo, "indicator", true);

    const topState = Object.entries(stateTotals).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1])[0];
    const topCounty = Object.entries(countyTotals).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1])[0];
    const topAgency = Object.entries(agencyTotals).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1])[0];
    const topIndicator = Object.entries(indicatorTotals).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1])[0];

    const entityCount = new Set(rowsForGeo.map(r => r.agency).filter(a => a && a !== "Unknown")).size;
    const countyCount = new Set(rowsForGeo.map(r => r.county).filter(c => c && c !== "Unknown")).size;

    container.innerHTML = `
      <div class="simple-insight-item"><strong>${escapeHtml(topState ? topState[0] : "N/A")}</strong> accounts for <span class="insight-blue">${topState ? ((topState[1] / totalBeneficiaries) * 100).toFixed(1) : "0.0"}%</span> of beneficiaries in the current ${CATEGORY_LABELS[currentCategory].toLowerCase()} selection.</div>
      <div class="simple-insight-item">The highest county is <strong>${escapeHtml(topCounty ? topCounty[0] : "N/A")}</strong>, contributing <span class="insight-blue">${topCounty ? ((topCounty[1] / totalBeneficiaries) * 100).toFixed(1) : "0.0"}%</span> of selected beneficiaries.</div>
      <div class="simple-insight-item">Leading reporting entity: <strong>${escapeHtml(topAgency ? topAgency[0] : "N/A")}</strong> with <span class="insight-blue">${topAgency ? ((topAgency[1] / totalBeneficiaries) * 100).toFixed(1) : "0.0"}%</span> of selected beneficiaries.</div>
      <div class="simple-insight-item">Top indicator by beneficiaries: <strong>${escapeHtml(topIndicator ? topIndicator[0] : "N/A")}</strong> with <span class="insight-blue">${topIndicator ? fmt(topIndicator[1]) : "0"}</span> beneficiaries.</div>
      <div class="simple-insight-item">Durable Solutions targets are <strong>not yet agreed</strong>, so this page shows reported results and beneficiaries only.</div>
      <div class="simple-insight-item">Selected data covers <strong>${fmt(countyCount)}</strong> county/counties and <strong>${fmt(entityCount)}</strong> reporting entity/entities.</div>
    `;
  }

 function renderIndicatorTable(rows) {
  const tbody = document.getElementById("indicator-table");
  if (!tbody) return;

  const grouped = {};

  rows.forEach(r => {
    const key = `${r.supportType}||${r.indicator}||${r.agency}`;

    if (!grouped[key]) {
      grouped[key] = {
        supportType: r.supportType,
        indicator: r.indicator,
        agencies: new Set(),
        beneficiaries: 0
      };
    }

    grouped[key].agencies.add(r.agency);
    grouped[key].beneficiaries += beneficiaryValue(r);
  });

  const data = Object.values(grouped).sort((a, b) => b.beneficiaries - a.beneficiaries);

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No records match the selected filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(d => `
    <tr>
      <td>${escapeHtml(d.supportType)}</td>
      <td>${escapeHtml(d.indicator)}</td>
      <td>${escapeHtml([...d.agencies].sort().join(", "))}</td>
      <td class="total-col">${fmt(d.beneficiaries)}</td>
    </tr>
  `).join("");
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
      hovertemplate: "<b>%{y}</b><br>Beneficiaries: %{x:,}<extra></extra>"
    }], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 18, r: maxValue > 999999 ? 105 : 80, b: 42, l: 230 },
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

  function renderPopulationChart(rows) {
    const el = document.getElementById("population-chart");
    if (!el || typeof Plotly === "undefined") return;

    const values = {
      IDPs: rows.reduce((s, r) => s + r.idps, 0),
      Returnees: rows.reduce((s, r) => s + r.returnees, 0),
      "Host community": rows.reduce((s, r) => s + r.hostCommunity, 0)
    };

    const entries = Object.entries(values).filter(([, v]) => v > 0);

    if (!entries.length) {
      Plotly.purge("population-chart");
      el.innerHTML = `<div class="empty-chart">No population group data available</div>`;
      return;
    }

    Plotly.newPlot("population-chart", [{
      type: "bar",
      x: entries.map(d => d[0]),
      y: entries.map(d => d[1]),
      marker: {
        color: "#00AEEF",
        line: { color: "rgba(255,255,255,0.15)", width: 1 }
      },
      text: entries.map(d => fmt(d[1])),
      textposition: "outside",
      hovertemplate: "<b>%{x}</b><br>%{y:,}<extra></extra>"
    }], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 18, r: 35, b: 55, l: 70 },
      yaxis: {
        gridcolor: "rgba(0,158,219,0.12)",
        zeroline: false,
        tickfont: { size: 11 }
      },
      xaxis: {
        tickfont: { size: 11 }
      }
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
      if (!indicatorMap[r.indicator]) {
        indicatorMap[r.indicator] = {
          indicator: r.indicator,
          total: 0,
          agencies: {}
        };
      }

      const value = beneficiaryValue(r);

      indicatorMap[r.indicator].total += value;
      indicatorMap[r.indicator].agencies[r.agency] =
        (indicatorMap[r.indicator].agencies[r.agency] || 0) + value;

      agencies.add(r.agency);
    });

    const indicators = Object.values(indicatorMap)
      .filter(d => d.indicator !== "Unknown" && d.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);

    if (!indicators.length) {
      Plotly.purge("indicator-agency-chart");
      el.innerHTML = `<div class="empty-chart">No indicator data available</div>`;
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
      "#FB923C",
      "#34D399",
      "#C084FC"
    ];

    const yLabels = indicators.map(d => d.indicator).reverse();
    const reversedIndicators = indicators.slice().reverse();

    const traces = agencyList.map((agency, index) => ({
      type: "bar",
      orientation: "h",
      name: agency,
      y: yLabels,
      x: reversedIndicators.map(d => d.agencies[agency] || 0),
      marker: {
        color: palette[index % palette.length],
        line: { color: "rgba(255,255,255,0.16)", width: 1 }
      },
      hovertemplate:
        `<b>${agency}</b><br>` +
        `%{y}<br>` +
        `Beneficiaries: %{x:,}` +
        `<extra></extra>`
    }));

    Plotly.newPlot("indicator-agency-chart", traces, {
      barmode: "stack",
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 22, r: 80, b: 70, l: 330 },
      bargap: 0.35,
      xaxis: {
        gridcolor: "rgba(0,158,219,0.13)",
        zeroline: false,
        tickfont: { size: 11 },
        automargin: true
      },
      yaxis: {
        automargin: true,
        tickfont: { size: 11 }
      },
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

  async function initDurableMap() {
    if (mapInitialized || typeof L === "undefined") return;

    const mapEl = document.getElementById("durable-map");
    if (!mapEl) return;

    durableMap = L.map("durable-map", {
      zoomControl: true,
      attributionControl: false
    }).setView([7.6, 30.2], 6);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 12
    }).addTo(durableMap);

    L.control.attribution({ prefix: false })
      .addAttribution("&copy; OpenStreetMap &copy; CARTO")
      .addTo(durableMap);

    try {
      const res = await fetch("data/SouthSudan.json?v=20260503");
      if (!res.ok) throw new Error("Could not load data/SouthSudan.json");

      countyGeoJson = await res.json();
      mapInitialized = true;

      setTimeout(() => durableMap.invalidateSize(), 150);
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
        <div class="popup-row"><span>IDPs</span><strong>${fmt(d.idps)}</strong></div>
        <div class="popup-row"><span>Returnees</span><strong>${fmt(d.returnees)}</strong></div>
        <div class="popup-row"><span>Host community</span><strong>${fmt(d.hostCommunity)}</strong></div>
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
    if (!durableMap || !layerGroup) return;

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
        durableMap.fitBounds(bounds, {
          padding: [45, 45],
          maxZoom: matchingLayers.length === 1 ? 8.8 : 7.6,
          animate: true,
          duration: 1.2
        });
      } else {
        durableMap.fitBounds(layerGroup.getBounds(), {
          padding: [25, 25],
          maxZoom: 6.2,
          animate: true,
          duration: 1.2
        });
      }

      setTimeout(() => durableMap.invalidateSize(), 150);
    } catch (e) {
      durableMap.setView([7.6, 30.2], 6);
    }
  }

  function renderDurableMap(rows) {
    if (!durableMap || !countyGeoJson) return;

    const countyData = groupCountyFull(rows);
    const values = Object.values(countyData).map(d => d.current).filter(v => v > 0);

    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 0;

    if (countyLayer) {
      durableMap.removeLayer(countyLayer);
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
    }).addTo(durableMap);

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

  async function renderDashboard(changedFilter = "") {
    refreshDependentFilters(changedFilter);

    const rows = getFilteredRecords();
    const rowsForGeo = geoRows(rows);

    renderKpis(rows);
    renderSimpleInsights(rows, rowsForGeo);
    renderIndicatorTable(rows);
    renderIndicatorAgencyChart(rowsForGeo);

    renderBarChart("state-chart", groupSum(rowsForGeo, "state", true), 13, "#00AEEF");
    renderBarChart("county-chart", groupSum(rowsForGeo, "county", true), 12, "#00AEEF");
    renderBarChart("agency-chart", groupSum(rowsForGeo, "agency", true), 10, "#2ED3B7");
    renderPopulationChart(rowsForGeo);

    if (!mapInitialized) {
      await initDurableMap();
    }

    renderDurableMap(rowsForGeo);
  }

  function initializeFilters() {
    setOptions(indicatorFilter, uniqueSorted(categoryRecords().map(r => r.indicator)));
    setOptions(agencyFilter, uniqueSorted(categoryRecords().map(r => r.agency)));
    setOptions(stateFilter, uniqueSorted(geoRows(categoryRecords()).map(r => r.state)));
    setOptions(countyFilter, uniqueSorted(geoRows(categoryRecords()).map(r => r.county)));

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
        currentCategory = btn.dataset.category;
        document.querySelectorAll(".sector-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderDashboard("category");
      });
    });
  }

  function showWarning(message) {
    if (!warningBox) return;
    warningBox.textContent = message;
    warningBox.style.display = "block";
  }

  window.toggleDurableIndicatorTable = function () {
    const panel = document.getElementById("indicator-table-panel");
    const btn = document.getElementById("indicator-table-toggle");
    if (!panel || !btn) return;

    const isHidden = panel.style.display === "none" || panel.style.display === "";
    panel.style.display = isHidden ? "block" : "none";
    btn.textContent = isHidden ? "Hide Detailed Table" : "Show Detailed Table";
  };

  initializeFilters();
  renderDashboard();

  window.addEventListener("resize", () => {
    ["state-chart", "county-chart", "indicator-agency-chart", "agency-chart", "population-chart"].forEach(id => {
      const el = document.getElementById(id);
      if (el && typeof Plotly !== "undefined") Plotly.Plots.resize(el);
    });

    if (durableMap) {
      setTimeout(() => durableMap.invalidateSize(), 150);
    }
  });
});