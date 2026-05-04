document.addEventListener("DOMContentLoaded", () => {
  const warningBox = document.getElementById("data-warning");

  if (typeof CO_DATA === "undefined" || !CO_DATA.foodSecurity || !Array.isArray(CO_DATA.foodSecurity.records)) {
    showWarning("Data was not loaded. Please regenerate js/data.js from the updated Excel file, then refresh the page with Ctrl + Shift + R.");
    return;
  }

  const data = CO_DATA.foodSecurity;
  const records = (data.records || []).map(normalizeRecord);

  const ADMIN_AREAS = data.adminAreas || [
    "Abyei Region",
    "Pibor Administrative Area",
    "Ruweng Administrative Area",
    "Abyei",
    "Pibor",
    "Ruweng"
  ];

  const indicatorFilter = document.getElementById("indicator-filter");
  const agencyFilter = document.getElementById("agency-filter");
  const stateFilter = document.getElementById("state-filter");
  const countyFilter = document.getElementById("county-filter");
  const resetBtn = document.getElementById("reset-filters");

  let foodMap = null;
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
      indicator: clean(r.indicator),
      agency: clean(r.agency),
      state: clean(r.state),
      county: clean(r.county),
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
    return [...new Set(arr.filter(v => v && v !== "Unknown"))].sort((a, b) => a.localeCompare(b));
  }

  function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;

  const target = Number(String(value).replace(/,/g, ""));
  if (isNaN(target)) {
    el.textContent = value;
    return;
  }

  animateCount(el, target);
}
function animateCount(el, target) {
  const duration = 900; // ms
  const startTime = performance.now();
  const startValue = 0;

  function update(now) {
    const progress = Math.min((now - startTime) / duration, 1);

    // easeOut effect (smooth)
    const eased = 1 - Math.pow(1 - progress, 3);

    const current = Math.floor(startValue + (target - startValue) * eased);
    el.textContent = current.toLocaleString();

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.textContent = target.toLocaleString();
    }
  }

  requestAnimationFrame(update);
}

  function setOptions(select, values, allLabel = "All") {
    if (!select) return;

    const current = select.value || "All";

    select.innerHTML =
      `<option value="All">${allLabel}</option>` +
      values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");

    select.value = [...select.options].some(o => o.value === current) ? current : "All";
  }

  function getFilteredRecords() {
    const indicator = indicatorFilter.value || "All";
    const agency = agencyFilter.value || "All";
    const state = stateFilter.value || "All";
    const county = countyFilter.value || "All";

    return records.filter(r =>
      (indicator === "All" || r.indicator === indicator) &&
      (agency === "All" || r.agency === agency) &&
      (state === "All" || r.state === state) &&
      (county === "All" || r.county === county)
    );
  }

  function refreshDependentFilters(changedFilter = "") {
    if (changedFilter === "indicator" || changedFilter === "agency") {
      stateFilter.value = "All";
      countyFilter.value = "All";
    }

    if (changedFilter === "state") {
      countyFilter.value = "All";
    }

    const stateBase = records.filter(r =>
      (indicatorFilter.value === "All" || r.indicator === indicatorFilter.value) &&
      (agencyFilter.value === "All" || r.agency === agencyFilter.value)
    );

    setOptions(stateFilter, uniqueSorted(stateBase.map(r => r.state)), "All");

    const countyBase = stateBase.filter(r =>
      (stateFilter.value === "All" || r.state === stateFilter.value)
    );

    setOptions(countyFilter, uniqueSorted(countyBase.map(r => r.county)), "All");
  }

  function groupSum(rows, field) {
    return rows.reduce((out, r) => {
      const key = r[field] || "Unknown";
      out[key] = (out[key] || 0) + Number(r.current || 0);
      return out;
    }, {});
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

      grouped[key].agencies.add(r.agency);
      grouped[key].indicators.add(r.indicator);
      grouped[key].current += r.current;
      grouped[key].male += r.male;
      grouped[key].female += r.female;
    });

    return grouped;
  }

  function groupIndicators(rows) {
    const grouped = {};

    rows.forEach(r => {
      if (!grouped[r.indicator]) {
        grouped[r.indicator] = {
          indicator: r.indicator,
          agencies: new Set(),
          current: 0,
          target: Number(r.target || 0)
        };
      }

      grouped[r.indicator].agencies.add(r.agency);
      grouped[r.indicator].current += Number(r.current || 0);

      if (!grouped[r.indicator].target && r.target) {
        grouped[r.indicator].target = Number(r.target || 0);
      }
    });

    return Object.values(grouped).sort((a, b) => b.current - a.current);
  }

  function renderKpis(rows) {
    const states = new Set();
    const adminAreas = new Set();
    const counties = new Set();
    const agencies = new Set();

    rows.forEach(r => {
      if (ADMIN_AREAS.includes(r.state)) {
        adminAreas.add(r.state);
      } else if (r.state !== "Unknown") {
        states.add(r.state);
      }

      if (r.county !== "Unknown") counties.add(r.county);
      if (r.agency !== "Unknown") agencies.add(r.agency);
    });

    setText("kpi-states", fmt(states.size));
    setText("kpi-admin-areas", fmt(adminAreas.size));
    setText("kpi-counties", fmt(counties.size));
    setText("kpi-agencies", fmt(agencies.size));
    setText("kpi-current", fmt(rows.reduce((s, r) => s + r.current, 0)));
    setText("kpi-male", fmt(rows.reduce((s, r) => s + r.male, 0)));
    setText("kpi-female", fmt(rows.reduce((s, r) => s + r.female, 0)));
  }

  function renderTable(rows) {
    const tbody = document.getElementById("indicator-table");
    if (!tbody) return;

    const grouped = groupIndicators(rows);

    if (!grouped.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No records match the selected filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = grouped.map(d => {
      const achieved = d.target ? `${((d.current / d.target) * 100).toFixed(1)}%` : "—";

      return `
        <tr>
          <td>${escapeHtml(d.indicator)}</td>
          <td>${escapeHtml([...d.agencies].sort().join(", "))}</td>
          <td class="total-col">${fmt(d.current)}</td>
          <td>${fmt(d.target)}</td>
          <td class="total-col">${achieved}</td>
        </tr>
      `;
    }).join("");
  }

  function renderBarChart(id, obj, limit = 12, color = "#009EDB") {
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
    const rightMargin = maxValue > 999999 ? 105 : 80;

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
      margin: { t: 18, r: rightMargin, b: 42, l: 190 },
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
      legend: {
        orientation: "v",
        x: 1,
        y: 0.5,
        font: { size: 12 }
      },
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

  async function initFoodMap() {
    if (mapInitialized || typeof L === "undefined") return;

    const mapEl = document.getElementById("food-map");
    if (!mapEl) return;

    foodMap = L.map("food-map", {
      zoomControl: true,
      attributionControl: false
    }).setView([7.6, 30.2], 6);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 12
    }).addTo(foodMap);

    L.control.attribution({
      prefix: false
    }).addAttribution("&copy; OpenStreetMap &copy; CARTO").addTo(foodMap);

    try {
      const res = await fetch("data/SouthSudan.json?v=20260501");
      if (!res.ok) throw new Error("Could not load data/SouthSudan.json");

      countyGeoJson = await res.json();
      mapInitialized = true;

      setTimeout(() => foodMap.invalidateSize(), 150);
    } catch (err) {
      showWarning("Map boundary file was not loaded. Please place SouthSudan.json inside the data folder: data/SouthSudan.json");
      console.error(err);
    }
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

    const agenciesSummary = [...d.agencies]
      .filter(Boolean)
      .sort()
      .join(", ");

    return `
      <div class="leaflet-popup-custom">
        <div class="popup-title">${escapeHtml(countyName)}</div>
        <div class="popup-subtitle">${escapeHtml(stateName)}</div>

        <div class="popup-row">
          <span>Beneficiaries</span>
          <strong>${fmt(d.current)}</strong>
        </div>

        <div class="popup-row">
          <span>Male</span>
          <strong>${fmt(d.male)}</strong>
        </div>

        <div class="popup-row">
          <span>Female</span>
          <strong>${fmt(d.female)}</strong>
        </div>

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
    if (!foodMap || !layerGroup) return;

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

        foodMap.fitBounds(bounds, {
  padding: [45, 45],
  maxZoom: matchingLayers.length === 1 ? 8.8 : 7.6,
  animate: true,
  duration: 1.2   // 👈 slower (seconds)
});
      } else {
        foodMap.fitBounds(layerGroup.getBounds(), {
  padding: [25, 25],
  maxZoom: 6.2,
  animate: true,
  duration: 1.2
});
      }

      setTimeout(() => foodMap.invalidateSize(), 150);
    } catch (e) {
      foodMap.setView([7.6, 30.2], 6);
    }
  }

  function renderFoodMap(rows) {
    if (!foodMap || !countyGeoJson) return;

    const countyData = groupCountyFull(rows);
    const values = Object.values(countyData)
      .map(d => d.current)
      .filter(v => v > 0);

    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 0;

    if (countyLayer) {
      foodMap.removeLayer(countyLayer);
    }

    countyLayer = L.geoJSON(countyGeoJson, {
      style: feature => styleCounty(feature, countyData, minValue, maxValue),
      onEachFeature: (feature, layer) => {
        const countyName = feature.properties.ADM2_EN || "Unknown";
        const stateName = feature.properties.ADM1_EN || "Unknown";
        const d = countyData[normName(countyName)];
        const popupHtml = createPopupHtml(countyName, stateName, d);

        layer.bindPopup(popupHtml, {
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
    }).addTo(foodMap);

    autoZoomMapToFilteredData(countyData, countyLayer);
    renderMapSummary(countyData);
  }

  function renderMapSummary(countyData) {
    const counties = Object.values(countyData).filter(d => d.current > 0);

    setText("map-counties", fmt(counties.length));
    setText("map-beneficiaries", fmt(counties.reduce((s, d) => s + d.current, 0)));
    setText("map-male", fmt(counties.reduce((s, d) => s + d.male, 0)));
    setText("map-female", fmt(counties.reduce((s, d) => s + d.female, 0)));

    const top = counties
      .sort((a, b) => b.current - a.current)
      .slice(0, 5);

    const topEl = document.getElementById("map-top-counties");
    if (!topEl) return;

    if (!top.length) {
      topEl.innerHTML = `<div class="top-empty">No county data available</div>`;
      return;
    }

    topEl.innerHTML = top.map((d, i) => `
      <div class="top-row">
        <div class="top-rank">${i + 1}</div>
        <div class="top-name">${escapeHtml(d.county)}</div>
        <div class="top-value">${fmt(d.current)}</div>
      </div>
    `).join("");
  }

  async function renderDashboard(changedFilter = "") {
    refreshDependentFilters(changedFilter);

    const rows = getFilteredRecords();

    renderKpis(rows);
    renderSimpleInsights(rows);
    renderTable(rows);
    renderIndicatorAgencyChart(rows);
    renderBarChart("state-chart", groupSum(rows, "state"), 13, "#00AEEF");
    renderBarChart("county-chart", groupSum(rows, "county"), 12, "#00AEEF");
    renderBarChart("agency-chart", groupSum(rows, "agency"), 10, "#2ED3B7");
    renderGenderChart(rows);

    if (!mapInitialized) {
      await initFoodMap();
    }

    renderFoodMap(rows);
  }

  function initializeFilters() {
    setOptions(indicatorFilter, uniqueSorted(records.map(r => r.indicator)), "All");
    setOptions(agencyFilter, uniqueSorted(records.map(r => r.agency)), "All");
    setOptions(stateFilter, uniqueSorted(records.map(r => r.state)), "All");
    setOptions(countyFilter, uniqueSorted(records.map(r => r.county)), "All");

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
  }

  function showWarning(message) {
    if (!warningBox) return;
    warningBox.textContent = message;
    warningBox.style.display = "block";
  }


  function renderSimpleInsights(rows) {
    const container = document.getElementById("simple-insights-list");
    if (!container) return;

    const total = rows.reduce((s, r) => s + Number(r.current || 0), 0);

    if (!rows.length || total <= 0) {
      container.innerHTML = `<div class="simple-insight-item">No records match the selected filters.</div>`;
      return;
    }

    const stateTotals = groupSum(rows, "state");
    const countyTotals = groupSum(rows, "county");
    const agencyTotals = groupSum(rows, "agency");

    const topState = Object.entries(stateTotals).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1])[0];
    const topCounty = Object.entries(countyTotals).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1])[0];
    const topAgency = Object.entries(agencyTotals).filter(([n, v]) => n && n !== "Unknown" && v > 0).sort((a, b) => b[1] - a[1])[0];

    const indicatorGrouped = groupIndicators(rows)
      .filter(d => d.target && d.current > 0)
      .map(d => ({ ...d, pct: (d.current / d.target) * 100 }))
      .sort((a, b) => a.pct - b.pct);

    const weakestIndicator = indicatorGrouped[0];
    const strongestIndicator = indicatorGrouped[indicatorGrouped.length - 1];

    const topStateShare = topState ? (topState[1] / total) * 100 : 0;
    const topCountyShare = topCounty ? (topCounty[1] / total) * 100 : 0;
    const topAgencyShare = topAgency ? (topAgency[1] / total) * 100 : 0;

    const strongestText = strongestIndicator
      ? `<strong>${escapeHtml(strongestIndicator.indicator)}</strong> is the strongest target-linked indicator at <span class="${strongestIndicator.pct >= 100 ? "insight-good" : "insight-blue"}">${strongestIndicator.pct.toFixed(1)}%</span> of target.`
      : `No target-linked indicator is available for comparison.`;

    const performanceText = weakestIndicator
      ? `<strong>${escapeHtml(weakestIndicator.indicator)}</strong> is the lowest target-linked indicator at <span class="${weakestIndicator.pct >= 100 ? "insight-good" : "insight-warn"}">${weakestIndicator.pct.toFixed(1)}%</span> of target.`
      : `Target-linked performance could not be calculated because target values are missing for the selected data.`;

    container.innerHTML = `
      <div class="simple-insight-item"><strong>${escapeHtml(topState ? topState[0] : "N/A")}</strong> accounts for <span class="insight-blue">${topStateShare.toFixed(1)}%</span> of beneficiaries in the current selection.</div>
      <div class="simple-insight-item">The highest county is <strong>${escapeHtml(topCounty ? topCounty[0] : "N/A")}</strong>, contributing <span class="insight-blue">${topCountyShare.toFixed(1)}%</span> of selected beneficiaries.</div>
      <div class="simple-insight-item">Leading reporting entity: <strong>${escapeHtml(topAgency ? topAgency[0] : "N/A")}</strong> with <span class="insight-blue">${topAgencyShare.toFixed(1)}%</span> of selected beneficiaries.</div>
      <div class="simple-insight-item">${strongestText}</div>
      <div class="simple-insight-item">${performanceText}</div>
      <div class="simple-insight-item">Selected data covers <strong>${fmt(new Set(rows.map(r => r.county).filter(c => c && c !== "Unknown")).size)}</strong> county/counties and <strong>${fmt(new Set(rows.map(r => r.agency).filter(a => a && a !== "Unknown")).size)}</strong> reporting entity/entities.</div>
    `;
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
        indicatorMap[indicator] = { indicator, target: Number(r.target || 0), total: 0, agencies: {} };
      }

      indicatorMap[indicator].total += Number(r.current || 0);
      indicatorMap[indicator].agencies[agency] = (indicatorMap[indicator].agencies[agency] || 0) + Number(r.current || 0);
      agencies.add(agency);

      if (!indicatorMap[indicator].target && r.target) {
        indicatorMap[indicator].target = Number(r.target || 0);
      }
    });

    const indicators = Object.values(indicatorMap)
      .filter(d => d.indicator !== "Unknown" && d.total > 0 && d.target > 0)
      .sort((a, b) => (b.total / b.target) - (a.total / a.target));

    if (!indicators.length) {
      Plotly.purge("indicator-agency-chart");
      el.innerHTML = `<div class="empty-chart">No indicator achievement data available</div>`;
      return;
    }

    const agencyList = [...agencies].filter(a => a !== "Unknown").sort();
    const palette = ["#00AEEF", "#2ED3B7", "#F472B6", "#A66CFF", "#F4C542", "#60A5FA", "#FB923C"];

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
        return [value, d.target];
      }),
      marker: { color: palette[index % palette.length], line: { color: "rgba(255,255,255,0.16)", width: 1 } },
      hovertemplate: `<b>${agency}</b><br>%{y}<br>Contribution: %{x:.1f}% of target<br>Current: %{customdata[0]:,}<br>Target: %{customdata[1]:,}<extra></extra>`
    }));

    const targetMarkers = {
      type: "scatter",
      mode: "markers",
      name: "Target 100%",
      y: yLabels,
      x: reversedIndicators.map(() => 100),
      marker: { symbol: "line-ns-open", size: 24, color: "#FFFFFF", line: { color: "#FFFFFF", width: 3 } },
      hovertemplate: "<b>Target</b><br>%{y}<br>100%<extra></extra>"
    };

    const totalLabels = {
      type: "scatter",
      mode: "text",
      showlegend: false,
      y: yLabels,
      x: reversedIndicators.map(d => d.target ? (d.total / d.target) * 100 : 0),
      text: reversedIndicators.map(d => d.target ? `${((d.total / d.target) * 100).toFixed(1)}%` : "—"),
      textposition: "middle right",
      textfont: { color: "#B8D9F7", size: 12, family: "Inter, sans-serif" },
      hoverinfo: "skip",
      cliponaxis: false
    };

    const maxAchieved = Math.max(120, ...reversedIndicators.map(d => d.target ? (d.total / d.target) * 100 : 0));

    Plotly.newPlot("indicator-agency-chart", [...traces, targetMarkers, totalLabels], {
      barmode: "stack",
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#8ba8c4", family: "Inter, sans-serif" },
      margin: { t: 22, r: 150, b: 58, l: 310 },
      bargap: 0.35,
      xaxis: { range: [0, maxAchieved * 1.12], ticksuffix: "%", gridcolor: "rgba(0,158,219,0.13)", zeroline: false, tickfont: { size: 11 }, automargin: true },
      yaxis: { automargin: true, tickfont: { size: 11 } },
      shapes: [{
        type: "line", x0: 100, x1: 100, y0: -0.5, y1: yLabels.length - 0.5,
        xref: "x", yref: "y",
        line: { color: "rgba(255,255,255,0.75)", width: 2, dash: "dot" }
      }],
      annotations: [{
        x: 100, y: yLabels.length - 0.35, xref: "x", yref: "y",
        text: "100% target", showarrow: false, font: { color: "#ffffff", size: 11 },
        xanchor: "left", yanchor: "bottom"
      }],
      legend: { orientation: "h", x: 0, y: -0.18, font: { size: 12 }, bgcolor: "rgba(0,0,0,0)" }
    }, { displayModeBar: false, responsive: true });
  }

  window.toggleIndicatorTable = function() {
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

  window.downloadChartPNG = function(chartId, fileName) {
    if (typeof Plotly === "undefined") return;

    const chart = document.getElementById(chartId);
    if (!chart || !chart.data) return;

    const chartWrap = chart.closest(".chart-wrap");
    const titleText = chartWrap?.querySelector(".chart-title")?.textContent?.trim() || "Food Security Chart";
    const subtitleText = chartWrap?.querySelector(".chart-subtitle")?.textContent?.trim() || "Calculated from filtered Excel records.";

    const originalLayout = chart.layout || {};
    const exportLayout = {
      ...originalLayout,
      title: {
        text: `<b>${titleText}</b><br><span style='font-size:13px;color:#8ba8c4'>${subtitleText}</span>`,
        x: 0.02, xanchor: "left", y: 0.98, yanchor: "top",
        font: { family: "Inter, sans-serif", size: 22, color: "#ffffff" }
      },
      paper_bgcolor: "#0c1f3a",
      plot_bgcolor: "#0c1f3a",
      margin: {
        ...(originalLayout.margin || {}),
        t: 110,
        r: Math.max((originalLayout.margin?.r || 80), 110),
        l: Math.max((originalLayout.margin?.l || 160), chartId === "gender-chart" ? 70 : 170),
        b: Math.max((originalLayout.margin?.b || 60), 90)
      }
    };

    Plotly.downloadImage({ data: chart.data, layout: exportLayout }, {
      format: "png", filename: fileName, height: 850, width: 1400, scale: 2
    });
  };

  window.downloadChartCSV = function(type) {
    const rows = getFilteredRecords();
    let csvRows = [];

    if (type === "state") {
      csvRows = [["State/Admin Area", "Current Number"]];
      Object.entries(groupSum(rows, "state")).filter(([n,v]) => n && n !== "Unknown" && v > 0).sort((a,b) => b[1]-a[1]).forEach(([n,v]) => csvRows.push([n,v]));
    }

    if (type === "county") {
      csvRows = [["County", "Current Number"]];
      Object.entries(groupSum(rows, "county")).filter(([n,v]) => n && n !== "Unknown" && v > 0).sort((a,b) => b[1]-a[1]).forEach(([n,v]) => csvRows.push([n,v]));
    }

    if (type === "agency") {
      csvRows = [["Reporting Entity", "Current Number"]];
      Object.entries(groupSum(rows, "agency")).filter(([n,v]) => n && n !== "Unknown" && v > 0).sort((a,b) => b[1]-a[1]).forEach(([n,v]) => csvRows.push([n,v]));
    }

    if (type === "gender") {
      csvRows = [["Gender", "Number"], ["Male", rows.reduce((s,r) => s + r.male, 0)], ["Female", rows.reduce((s,r) => s + r.female, 0)]];
    }

    if (type === "indicatorAgency") {
      const grouped = {};
      rows.forEach(r => {
        const key = `${r.indicator}||${r.agency}`;
        if (!grouped[key]) grouped[key] = { indicator: r.indicator, agency: r.agency, current: 0, target: Number(r.target || 0) };
        grouped[key].current += Number(r.current || 0);
        if (!grouped[key].target && r.target) grouped[key].target = Number(r.target || 0);
      });
      csvRows = [["Indicator", "Reporting Entity", "Current Number", "Target", "Achievement %"]];
      Object.values(grouped).sort((a,b) => a.indicator.localeCompare(b.indicator) || b.current - a.current).forEach(d => {
        const pct = d.target ? (d.current / d.target) * 100 : 0;
        csvRows.push([d.indicator, d.agency, d.current, d.target, pct.toFixed(1)]);
      });
    }

    if (!csvRows.length) return;
    triggerCsvDownload(`food_security_${type}_chart_data.csv`, rowsToCsv(csvRows));
  };


  initializeFilters();
  renderDashboard();

  window.addEventListener("resize", () => {
    ["state-chart", "county-chart", "indicator-agency-chart", "agency-chart", "gender-chart"].forEach(id => {
      const el = document.getElementById(id);
      if (el && typeof Plotly !== "undefined") Plotly.Plots.resize(el);
    });

    if (foodMap) {
      setTimeout(() => foodMap.invalidateSize(), 150);
    }
  });
});
