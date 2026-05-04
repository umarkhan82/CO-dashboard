(function () {
  const DATA =
    (window.CO_DATA &&
      window.CO_DATA.rapidResponse &&
      window.CO_DATA.rapidResponse.records) ||
    [];

  const SOUTH_SUDAN_CENTER = [7.3, 30.2];

  const COUNTY_COORDS = {
    Uror: [8.25, 32.05],
    Ulang: [8.77, 33.15],
    Fangak: [8.15, 31.85],
    Akobo: [7.78, 33.0],
    Lainya: [4.6, 30.0],
    Torit: [4.41, 32.57],
    Panyijiar: [7.25, 30.25],
    Ayod: [8.12, 31.4],
    Lafon: [5.25, 32.35],
    "Kajo-Keji": [3.85, 31.65],
    Juba: [4.86, 31.57],
    Yei: [4.09, 30.68],
    "Bor South": [6.21, 31.56],
    Renk: [11.74, 32.8],
    Malakal: [9.53, 31.66],
    Rubkona: [9.25, 29.8],
    Pibor: [6.8, 33.13],
    Wau: [7.7, 28.0]
  };

  const CATEGORY_COLORS = {
    Conflict: "#d64161",
    "Disease outbreak": "#e0b437",
    Other: "#8e8e8e"
  };

  const CHART_BLUE = "#3BA4F7";

  let map = null;
  let markersLayer = null;
  let lastTables = {};

  const $ = (id) => document.getElementById(id);

  function fmt(n) {
    return (Number(n) || 0).toLocaleString(undefined, {
      maximumFractionDigits: 0
    });
  }

  function fmt1(n) {
    return (Number(n) || 0).toLocaleString(undefined, {
      maximumFractionDigits: 1
    });
  }

  function uniqueValues(records, field) {
    return [...new Set(records.map((r) => r[field]).filter(Boolean))].sort();
  }

  function sum(records, field) {
    return records.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
  }

  function avg(values) {
    const nums = values.map(Number).filter((v) => !isNaN(v) && v > 0);
    if (!nums.length) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
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

  function allServices(records) {
    const services = new Set();

    records.forEach((r) => {
      (r.services || []).forEach((s) => {
        if (Number(s.value || 0) > 0) services.add(s.service);
      });
    });

    return [...services].sort();
  }

  function initFilters() {
    populateSelect("category-filter", uniqueValues(DATA, "category"), "Shock Types");
    populateSelect("status-filter", uniqueValues(DATA, "status"), "Statuses");
    populateSelect("agency-filter", uniqueValues(DATA, "agency"), "Agencies");
    populateSelect("state-filter", uniqueValues(DATA, "state"), "States/Admin Areas");
    populateSelect("county-filter", uniqueValues(DATA, "county"), "Counties");
    populateSelect("service-filter", allServices(DATA), "Services");

    [
      "category-filter",
      "status-filter",
      "agency-filter",
      "state-filter",
      "county-filter",
      "service-filter"
    ].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("change", onFilterChange);
    });

    const reset = $("reset-filters");
    if (reset) {
      reset.addEventListener("click", () => {
        [
          "category-filter",
          "status-filter",
          "agency-filter",
          "state-filter",
          "county-filter",
          "service-filter"
        ].forEach((id) => {
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
    const category = $("category-filter")?.value || "All";
    const status = $("status-filter")?.value || "All";
    const agency = $("agency-filter")?.value || "All";
    const state = $("state-filter")?.value || "All";
    const county = $("county-filter")?.value || "All";
    const service = $("service-filter")?.value || "All";

    return DATA.filter((r) => {
      const serviceMatch =
        service === "All" ||
        (r.services || []).some(
          (s) => s.service === service && Number(s.value || 0) > 0
        );

      return (
        (category === "All" || r.category === category) &&
        (status === "All" || r.status === status) &&
        (agency === "All" || r.agency === agency) &&
        (state === "All" || r.state === state) &&
        (county === "All" || r.county === county) &&
        serviceMatch
      );
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

  function groupCount(records, key) {
    const out = {};

    records.forEach((r) => {
      const k = r[key] || "Not specified";
      out[k] = (out[k] || 0) + 1;
    });

    return Object.entries(out)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }

  function groupSumWithCategory(records, key, valueField) {
    const out = {};

    records.forEach((r) => {
      const k = r[key] || "Not specified";

      if (!out[k]) {
        out[k] = {
          name: k,
          value: 0,
          categoryValues: {}
        };
      }

      out[k].value += Number(r[valueField]) || 0;

      const cat = r.category || "Other";
      out[k].categoryValues[cat] =
        (out[k].categoryValues[cat] || 0) + (Number(r[valueField]) || 0);
    });

    return Object.values(out)
      .map((d) => {
        const topCategory =
          Object.entries(d.categoryValues).sort((a, b) => b[1] - a[1])[0]?.[0] ||
          "Other";

        return {
          ...d,
          category: topCategory,
          color: CATEGORY_COLORS[topCategory] || CATEGORY_COLORS.Other
        };
      })
      .sort((a, b) => b.value - a.value);
  }

  function serviceSummary(records) {
    const out = {};

    records.forEach((r) => {
      (r.services || []).forEach((s) => {
        const value = Number(s.value) || 0;

        if (!out[s.service]) {
          out[s.service] = {
            service: s.service,
            responseCount: 0,
            people: 0,
            concluded: 0,
            ongoing: 0
          };
        }

        if (value > 0) {
          out[s.service].responseCount += 1;
          out[s.service].people += value;

          const status = (r.status || "").toLowerCase();
          if (status.includes("concluded")) out[s.service].concluded += 1;
          if (status.includes("ongoing")) out[s.service].ongoing += 1;
        }
      });
    });

    return Object.values(out).sort((a, b) => b.people - a.people);
  }

  function updateKPIs(records) {
    const responses = records.length;

    const concluded = records.filter((r) =>
      (r.status || "").toLowerCase().includes("concluded")
    ).length;

    const ongoing = records.filter((r) =>
      (r.status || "").toLowerCase().includes("ongoing")
    ).length;

    const within14 = records.filter(
      (r) => Number(r.daysToRespond) > 0 && Number(r.daysToRespond) <= 14
    ).length;

    const within14Pct = responses ? (within14 / responses) * 100 : 0;

    if ($("kpi-states"))
      $("kpi-states").textContent = fmt(uniqueValues(records, "state").length);

    if ($("kpi-counties"))
      $("kpi-counties").textContent = fmt(uniqueValues(records, "county").length);

    if ($("kpi-single-count"))
      $("kpi-single-count").textContent = fmt(sum(records, "singleCount"));

    if ($("kpi-responses"))
      $("kpi-responses").textContent = fmt(responses);

    if ($("kpi-concluded"))
      $("kpi-concluded").textContent = fmt(concluded);

    if ($("kpi-ongoing"))
      $("kpi-ongoing").textContent = fmt(ongoing);

    if ($("kpi-avg-days"))
      $("kpi-avg-days").textContent = fmt1(avg(records.map((r) => r.daysToRespond)));

    if ($("kpi-within-14"))
      $("kpi-within-14").textContent = `${fmt1(within14Pct)}%`;
  }

  function updateInsights(records) {
    const el = $("simple-insights-list");
    if (!el) return;

    if (!records.length) {
      el.innerHTML = `<div class="simple-insight-item">No records match the selected filters.</div>`;
      return;
    }

    const topState = groupSum(records, "state", "singleCount")[0];
    const topCounty = groupSum(records, "county", "singleCount")[0];
    const topShock = groupSum(records, "category", "singleCount")[0];

    const within14Pct = records.length
      ? (records.filter(
          (r) => Number(r.daysToRespond) > 0 && Number(r.daysToRespond) <= 14
        ).length /
          records.length) *
        100
      : 0;

    el.innerHTML = `
      <div class="simple-insight-item"><strong>${fmt(
        sum(records, "singleCount")
      )}</strong> single count beneficiaries are reported across <strong>${fmt(
      uniqueValues(records, "county").length
    )}</strong> counties.</div>
      <div class="simple-insight-item">The highest beneficiary caseload is in <strong>${
        topState?.name || "N/A"
      }</strong>, with <strong>${fmt(topState?.value || 0)}</strong> people reached.</div>
      <div class="simple-insight-item">Top county: <strong>${
        topCounty?.name || "N/A"
      }</strong> with <strong>${fmt(topCounty?.value || 0)}</strong> people reached.</div>
      <div class="simple-insight-item">Main shock type by beneficiaries: <strong>${
        topShock?.name || "N/A"
      }</strong>.</div>
      <div class="simple-insight-item">Average response time is <strong>${fmt1(
        avg(records.map((r) => r.daysToRespond))
      )}</strong> days; <strong>${fmt1(
      within14Pct
    )}%</strong> of responses were within 14 days.</div>
    `;
  }

  function initMap() {
    if (map || !$("rapid-map")) return;

    map = L.map("rapid-map", { scrollWheelZoom: false }).setView(
      SOUTH_SUDAN_CENTER,
      6
    );

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
  }

  function updateMap(records) {
    initMap();
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();

    const byCounty = {};

    records.forEach((r) => {
      const key = r.county;

      if (!byCounty[key]) {
        byCounty[key] = {
          county: r.county,
          state: r.state,
          value: 0,
          male: 0,
          female: 0,
          categories: new Set()
        };
      }

      byCounty[key].value += Number(r.singleCount) || 0;
      byCounty[key].male += Number(r.male) || 0;
      byCounty[key].female += Number(r.female) || 0;

      if (r.category) byCounty[key].categories.add(r.category);
    });

    const points = Object.values(byCounty).filter((d) => COUNTY_COORDS[d.county]);
    const maxValue = Math.max(...points.map((d) => d.value), 1);
    const bounds = [];

    points.forEach((d) => {
      const coords = COUNTY_COORDS[d.county];
      const mainCategory = [...d.categories][0] || "Other";
      const color = CATEGORY_COLORS[mainCategory] || CATEGORY_COLORS.Other;
      const radius = 7 + Math.sqrt(d.value / maxValue) * 28;

      const marker = L.circleMarker(coords, {
        radius,
        color,
        fillColor: color,
        fillOpacity: 0.65,
        weight: 1
      }).bindPopup(`
        <strong>${d.county}</strong><br/>
        State: ${d.state}<br/>
        Beneficiaries: ${fmt(d.value)}<br/>
        Male: ${fmt(d.male)}<br/>
        Female: ${fmt(d.female)}<br/>
        Shock type: ${[...d.categories].join(", ")}
      `);

      marker.addTo(markersLayer);
      bounds.push(coords);
    });

    if (bounds.length) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 });
    } else {
      map.setView(SOUTH_SUDAN_CENTER, 6);
    }

    if ($("map-counties"))
      $("map-counties").textContent = fmt(uniqueValues(records, "county").length);

    if ($("map-beneficiaries"))
      $("map-beneficiaries").textContent = fmt(sum(records, "singleCount"));

    if ($("map-male"))
      $("map-male").textContent = fmt(sum(records, "male"));

    if ($("map-female"))
      $("map-female").textContent = fmt(sum(records, "female"));

    const top = groupSum(records, "county", "singleCount").slice(0, 5);

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

    const selectedCategory = $("category-filter")?.value || "All";
    const categoriesInData = [
      ...new Set(DATA.map((r) => r.category).filter(Boolean))
    ].sort();

    if ($("map-legend")) {
      $("map-legend").innerHTML = categoriesInData
        .map((cat) => {
          const color = CATEGORY_COLORS[cat] || CATEGORY_COLORS.Other;
          const active = selectedCategory === cat;

          return `
            <div class="legend-click-item ${active ? "legend-active" : ""}" data-category="${cat}">
              <span>
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;"></span>
                ${cat}
              </span>
            </div>
          `;
        })
        .join("");

      document.querySelectorAll(".legend-click-item").forEach((item) => {
        item.addEventListener("click", () => {
          const category = item.getAttribute("data-category");
          const filter = $("category-filter");

          if (!filter) return;

          filter.value = filter.value === category ? "All" : category;
          updateDashboard();
        });
      });
    }
  }

  function renderServiceTable(records) {
    const rows = serviceSummary(records);
    lastTables.service = rows;

    const tbody = $("service-table");
    if (!tbody) return;

    tbody.innerHTML =
      rows
        .map(
          (r) => `
        <tr>
          <td>${r.service}</td>
          <td>${fmt(r.responseCount)}</td>
          <td>${fmt(r.people)}</td>
          <td>${fmt(r.concluded)}</td>
          <td>${fmt(r.ongoing)}</td>
        </tr>
      `
        )
        .join("") || `<tr><td colspan="5">No data</td></tr>`;
  }

  function darkPlotLayout(extra = {}) {
    return {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: {
        color: "#e8f1fa",
        family: "Inter, sans-serif",
        size: 11
      },
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

  function plotBar(id, rows, orientation = "h", colorMode = "blue") {
    const el = $(id);
    if (!el || typeof Plotly === "undefined") return;

    if (!rows.length) {
      Plotly.newPlot(
        id,
        [],
        darkPlotLayout({
          title: {
            text: "No data",
            font: { color: "#e8f1fa", size: 13 }
          },
          margin: { t: 30, r: 20, b: 40, l: 120 }
        }),
        { displayModeBar: false, responsive: true }
      );
      return;
    }

    const chartRows = orientation === "h" ? [...rows].reverse() : rows;

    const colors =
      colorMode === "category"
        ? chartRows.map((d) => d.color || CATEGORY_COLORS[d.category] || CHART_BLUE)
        : CHART_BLUE;

    const trace =
      orientation === "h"
        ? {
            type: "bar",
            orientation: "h",
            y: chartRows.map((d) => d.name),
            x: chartRows.map((d) => d.value),
            text: chartRows.map((d) => fmt(d.value)),
            textposition: "auto",
            marker: { color: colors },
            hovertemplate: "%{y}<br>%{x:,}<extra></extra>"
          }
        : {
            type: "bar",
            x: chartRows.map((d) => d.name),
            y: chartRows.map((d) => d.value),
            text: chartRows.map((d) => fmt(d.value)),
            textposition: "auto",
            marker: { color: colors },
            hovertemplate: "%{x}<br>%{y:,}<extra></extra>"
          };

    Plotly.newPlot(
      id,
      [trace],
      darkPlotLayout({
        margin: {
          t: 25,
          r: 25,
          b: orientation === "h" ? 40 : 90,
          l: orientation === "h" ? 160 : 55
        },
        xaxis: {
          title: orientation === "h" ? "Beneficiaries" : "",
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

  function renderCharts(records) {
    const shock = groupSumWithCategory(records, "category", "singleCount");
    const statusCounts = groupCount(records, "status");
    const state = groupSumWithCategory(records, "state", "singleCount").slice(0, 12);
    const county = groupSumWithCategory(records, "county", "singleCount").slice(0, 12);

    lastTables.shock = shock;
    lastTables.status = statusCounts;
    lastTables.state = state;
    lastTables.county = county;
    lastTables.gender = [
      { name: "Male", value: sum(records, "male") },
      { name: "Female", value: sum(records, "female") }
    ];

    plotBar("shock-chart", shock, "h", "category");
    plotBar("status-chart", statusCounts, "h", "blue");
    plotBar("state-chart", state, "h", "category");
    plotBar("county-chart", county, "h", "category");

    const daysByState = uniqueValues(records, "state")
      .map((st) => {
        const stateRecords = records.filter((r) => r.state === st);
        const topCategory =
          groupSum(stateRecords, "category", "singleCount")[0]?.name || "Other";

        return {
          name: st,
          value: avg(stateRecords.map((r) => r.daysToRespond)),
          category: topCategory,
          color: CATEGORY_COLORS[topCategory] || CATEGORY_COLORS.Other
        };
      })
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);

    lastTables.days = daysByState;
    plotBar("response-days-chart", daysByState, "h", "category");

    if ($("gender-chart") && typeof Plotly !== "undefined") {
      Plotly.newPlot(
        "gender-chart",
        [
          {
            type: "pie",
            labels: ["Male", "Female"],
            values: [sum(records, "male"), sum(records, "female")],
            hole: 0.35,
            textinfo: "label+percent",
            marker: {
              colors: ["#60a5fa", "#f472b6"]
            },
            hovertemplate: "%{label}<br>%{value:,}<br>%{percent}<extra></extra>"
          }
        ],
        darkPlotLayout({
          margin: { t: 20, r: 20, b: 20, l: 20 },
          showlegend: true,
          legend: {
            font: { color: "#e8f1fa" }
          }
        }),
        { displayModeBar: false, responsive: true }
      );
    }
  }

  function renderRemarks(records) {
    const tbody = $("remarks-table");
    if (!tbody) return;

    const rows = records.filter((r) => r.remarks).slice(0, 50);
    lastTables.remarks = rows;

    tbody.innerHTML =
      rows
        .map(
          (r) => `
        <tr>
          <td>${r.state || ""}</td>
          <td>${r.county || ""}</td>
          <td>${r.category || ""}</td>
          <td>${r.status || ""}</td>
          <td>${fmt(r.daysToRespond)}</td>
          <td>${r.remarks || ""}</td>
        </tr>
      `
        )
        .join("") ||
      `<tr><td colspan="6">No remarks reported for selected filters.</td></tr>`;
  }

  function updateDashboard() {
    const records = getFilteredRecords();

    updateKPIs(records);
    updateInsights(records);
    updateMap(records);
    renderServiceTable(records);
    renderCharts(records);
    renderRemarks(records);
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

    if (type === "service") {
      csv =
        "Service,Service Response Count,People Reached by Service,Concluded Service Responses,Ongoing Service Responses\n" +
        rows
          .map(
            (r) =>
              `"${r.service}",${r.responseCount},${r.people},${r.concluded},${r.ongoing}`
          )
          .join("\n");
    } else if (type === "remarks") {
      csv =
        "State,County,Shock Type,Status,Days to Respond,Remarks\n" +
        rows
          .map(
            (r) =>
              `"${r.state}","${r.county}","${r.category}","${r.status}",${r.daysToRespond},"${(
                r.remarks || ""
              ).replace(/"/g, '""')}"`
          )
          .join("\n");
    } else {
      csv =
        "Name,Value,Category\n" +
        rows
          .map((r) => `"${r.name}",${r.value},"${r.category || ""}"`)
          .join("\n");
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `rapid_response_${type}.csv`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  };

  document.addEventListener("DOMContentLoaded", () => {
    initFilters();
    initMap();
    updateDashboard();
  });
})();