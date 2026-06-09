const state = {
  participants: [],
  laps: [],
  selectedId: null,
  favorites: new Set(),
  search: "",
  event: "all",
  course: "all",
  group: "all",
  sort: { key: "place", dir: "asc" },
  activeChart: "cumulativeChart",
  sourceLabel: ""
};

const els = {
  raceMeta: document.querySelector("#raceMeta"),
  notice: document.querySelector("#notice"),
  srcInput: document.querySelector("#srcInput"),
  urlForm: document.querySelector("#urlForm"),
  fileInput: document.querySelector("#fileInput"),
  searchInput: document.querySelector("#searchInput"),
  eventSelect: document.querySelector("#eventSelect"),
  courseSelect: document.querySelector("#courseSelect"),
  groupSelect: document.querySelector("#groupSelect"),
  starterCount: document.querySelector("#starterCount"),
  lapCount: document.querySelector("#lapCount"),
  participantCard: document.querySelector("#participantCard"),
  chartScope: document.querySelector("#chartScope"),
  tableHead: document.querySelector("#tableHead"),
  tableBody: document.querySelector("#tableBody"),
  tabs: document.querySelectorAll(".tab"),
  charts: document.querySelectorAll(".chart")
};

const chartIds = ["cumulativeChart", "lapChart", "gapChart", "positionChart"];
const palette = ["#0f766e", "#b3261e", "#d69e2e", "#293241", "#627c85", "#6a4c93", "#2a9d8f", "#e76f51"];
const CHART_DEFAULT_LIMIT = 10;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  const urlSrc = new URLSearchParams(window.location.search).get("src");

  if (urlSrc) {
    els.srcInput.value = urlSrc;
    await loadFromUrl(urlSrc);
  } else {
    renderAll();
  }
}

function bindEvents() {
  els.urlForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const src = els.srcInput.value.trim();
    if (src) await loadFromUrl(src);
  });

  els.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) await loadFromFile(file);
  });

  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    ensureSelectedVisible();
    renderAll();
  });

  els.eventSelect.addEventListener("change", (event) => {
    state.event = event.target.value;
    state.course = "all";
    state.group = "all";
    ensureSelectedVisible();
    renderAll();
  });

  els.courseSelect.addEventListener("change", (event) => {
    state.course = event.target.value;
    state.group = "all";
    ensureSelectedVisible();
    renderAll();
  });

  els.groupSelect.addEventListener("change", (event) => {
    state.group = event.target.value;
    ensureSelectedVisible();
    renderAll();
  });

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => setActiveChart(tab.dataset.chart));
  });

  window.addEventListener("resize", debounce(() => {
    resizeActiveChart();
  }, 150));
}

async function loadFromUrl(src) {
  try {
    setNotice("");
    const response = await fetch(src, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    loadCsv(text, src);
    const url = new URL(window.location.href);
    url.searchParams.set("src", src);
    window.history.replaceState({}, "", url);
  } catch (error) {
    setNotice(`Не удалось загрузить CSV по URL: ${error.message}`);
  }
}

async function loadFromFile(file) {
  try {
    setNotice("");
    const text = await file.text();
    loadCsv(text, file.name);
    const url = new URL(window.location.href);
    url.searchParams.delete("src");
    window.history.replaceState({}, "", url);
  } catch (error) {
    setNotice(`Не удалось прочитать CSV-файл: ${error.message}`);
  }
}

function loadCsv(text, sourceLabel) {
  try {
    const parsed = parseCsv(text);
    const normalized = normalizeRows(parsed);
    state.participants = normalized.participants;
    state.laps = normalized.laps;
    state.selectedId = state.participants[0]?.id ?? null;
    state.favorites = new Set();
    state.search = "";
    state.event = "all";
    state.course = "all";
    state.group = "all";
    state.sort = { key: "place", dir: "asc" };
    state.sourceLabel = sourceLabel;
    els.searchInput.value = "";
    renderAll();
  } catch (error) {
    setNotice(error.message);
  }
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("CSV должен содержать строку заголовков и хотя бы одного участника.");

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = (values[index] ?? "").trim();
    });
    return record;
  });
}

function normalizeRows(rows) {
  const required = ["place", "bib", "name", "gender"];
  const headers = Object.keys(rows[0] ?? {});
  const lowerMap = new Map(headers.map((header) => [header.toLowerCase(), header]));
  const missing = required.filter((field) => !lowerMap.has(field));
  if (missing.length) throw new Error(`В CSV нет обязательных колонок: ${missing.join(", ")}.`);

  const lapHeaders = headers.filter((header) => /^lap\d*$/i.test(header.trim()));
  if (!lapHeaders.length) throw new Error("В CSV должны быть колонки кругов: lap1, lap2, lap3 и так далее.");

  const eventHeader = findHeader(lowerMap, ["event", "event_id", "eventid", "race", "race_id", "raceid", "meet", "competition", "date", "day", "соревнование", "гонка", "старт", "дата", "протокол"]);
  const groupHeader = findHeader(lowerMap, ["group", "group_id", "groupid", "category", "division", "class", "wave", "зачет", "зачёт", "группа", "класс", "категория"]);
  const courseHeader = findHeader(lowerMap, ["course", "course_id", "courseid", "track", "track_id", "track_type", "route", "distance", "layout", "трасса", "дистанция", "маршрут", "тип_трассы"]);

  const participants = rows.map((row, index) => {
    const get = (field) => row[lowerMap.get(field)] ?? "";
    const gender = normalizeGender(get("gender"));
    const event = normalizeEvent(eventHeader ? row[eventHeader] : "");
    const group = normalizeResultGroup(groupHeader ? row[groupHeader] : get("gender"), gender);
    const course = normalizeCourse(courseHeader ? row[courseHeader] : group.label);
    const cumulative = lapHeaders.map((header) => parseTimestamp(row[header], header, index));
    const laps = cumulative.map((time, lapIndex) => {
      if (time == null) return null;
      const previous = lapIndex === 0 ? 0 : cumulative[lapIndex - 1];
      if (previous == null) return null;
      const lap = time - previous;
      if (lap < 0) {
        throw new Error(`Кумулятивное время в строке ${index + 2}, ${lapHeaders[lapIndex]} меньше предыдущей отметки.`);
      }
      return lap;
    });

    return {
      id: `${get("bib") || "row"}-${index}`,
      place: numberOrNull(get("place")) ?? index + 1,
      bib: get("bib"),
      name: get("name") || `Участник ${index + 1}`,
      gender: get("gender"),
      genderLabel: gender.label,
      eventKey: event.key,
      eventLabel: event.label,
      groupKey: group.key,
      groupLabel: group.label,
      courseKey: course.key,
      courseLabel: course.label,
      scoreKey: `${event.key}::${course.key}::${group.key}`,
      laps,
      cumulative,
      total: lastNumber(cumulative),
      bestLap: minNumber(laps),
      avgLap: average(laps),
      lapSpread: spread(laps),
      completedLaps: cumulative.filter((time) => time != null).length
    };
  });

  const positionsByLap = computePositionsByGroup(participants, lapHeaders.length);
  const leadersByLap = computeLeadersByGroup(participants, lapHeaders.length);
  participants.forEach((participant) => {
    participant.positions = positionsByLap.get(participant.id);
    participant.gaps = participant.cumulative.map((time, lapIndex) => {
      const leaderTime = leadersByLap.get(participant.scoreKey)?.[lapIndex];
      return time == null || leaderTime == null ? null : time - leaderTime;
    });
    participant.finishGap = lastNumber(participant.gaps);
  });

  return { participants, laps: lapHeaders.map(lapLabel) };
}

function findHeader(lowerMap, candidates) {
  return candidates.map((candidate) => lowerMap.get(candidate)).find(Boolean) ?? null;
}

function lapLabel(header) {
  const match = String(header).match(/\d+/);
  return match ? `Круг ${match[0]}` : header;
}

function normalizeGender(value) {
  const raw = String(value ?? "").trim();
  const normalized = raw.toLowerCase();

  if (["f", "female", "w", "woman", "women", "ж", "жен", "женщина", "женщины"].includes(normalized)) {
    return { key: "F", label: "Женщины" };
  }

  if (["m", "male", "man", "men", "м", "муж", "мужчина", "мужчины"].includes(normalized)) {
    return { key: "M", label: "Мужчины" };
  }

  return { key: normalized || "unknown", label: raw || "Не указан" };
}

function normalizeResultGroup(value, fallback) {
  const raw = String(value ?? "").trim();
  if (!raw) return { key: fallback.key, label: fallback.label };
  return {
    key: raw.toLowerCase(),
    label: raw
  };
}

function normalizeEvent(value) {
  const raw = String(value ?? "").trim();
  return {
    key: (raw || "default-event").toLowerCase(),
    label: raw || "Соревнование не указано"
  };
}

function normalizeCourse(value) {
  const raw = String(value ?? "").trim();
  return {
    key: (raw || "default-course").toLowerCase(),
    label: raw || "Трасса не указана"
  };
}

function parseTimestamp(value, header, rowIndex) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(raw)) {
    throw new Error(`Некорректная отметка времени в строке ${rowIndex + 2}, ${header}: ${raw}. Используйте формат [HH:]MM:SS.`);
  }

  const parts = raw.split(":").map(Number);
  if (parts.length === 2) {
    if (parts[1] > 59) throw new Error(`Некорректная отметка времени в строке ${rowIndex + 2}, ${header}: ${raw}.`);
    return parts[0] * 60 + parts[1];
  }
  if (parts[1] > 59 || parts[2] > 59) throw new Error(`Некорректная отметка времени в строке ${rowIndex + 2}, ${header}: ${raw}.`);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function lastNumber(values) {
  return [...values].reverse().find((value) => Number.isFinite(value)) ?? null;
}

function minNumber(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? Math.min(...valid) : null;
}

function maxNumber(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? Math.max(...valid) : null;
}

function spread(values) {
  const min = minNumber(values);
  const max = maxNumber(values);
  return min == null || max == null ? null : max - min;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function computeLeaders(participants, lapCount) {
  return Array.from({ length: lapCount }, (_, lapIndex) => {
    const times = participants
      .map((participant) => participant.cumulative[lapIndex])
      .filter((time) => Number.isFinite(time));
    return times.length ? Math.min(...times) : null;
  });
}

function computePositions(participants, lapCount) {
  const positions = new Map(participants.map((participant) => [participant.id, Array(lapCount).fill(null)]));

  for (let lapIndex = 0; lapIndex < lapCount; lapIndex += 1) {
    const ranked = participants
      .map((participant) => ({ id: participant.id, time: participant.cumulative[lapIndex] }))
      .filter((item) => Number.isFinite(item.time))
      .sort((a, b) => a.time - b.time);

    ranked.forEach((item, index) => {
      positions.get(item.id)[lapIndex] = index + 1;
    });
  }

  return positions;
}

function computePositionsByGroup(participants, lapCount) {
  const positions = new Map(participants.map((participant) => [participant.id, Array(lapCount).fill(null)]));

  groupParticipants(participants).forEach((groupParticipantsList) => {
    const groupPositions = computePositions(groupParticipantsList, lapCount);
    groupPositions.forEach((value, key) => positions.set(key, value));
  });

  return positions;
}

function computeLeadersByGroup(participants, lapCount) {
  const leaders = new Map();
  groupParticipants(participants).forEach((groupParticipantsList, groupKey) => {
    leaders.set(groupKey, computeLeaders(groupParticipantsList, lapCount));
  });
  return leaders;
}

function groupParticipants(participants) {
  return participants.reduce((groups, participant) => {
    if (!groups.has(participant.scoreKey)) groups.set(participant.scoreKey, []);
    groups.get(participant.scoreKey).push(participant);
    return groups;
  }, new Map());
}

function renderAll() {
  renderEventOptions();
  renderCourseOptions();
  renderGroupOptions();
  ensureSelectedVisible();
  renderSummary();
  renderCard();
  renderTable();
  renderCharts();
  setActiveChart(state.activeChart);
}

function renderSummary() {
  const participants = getScopeParticipants();
  els.raceMeta.innerHTML = state.participants.length
    ? `
      <span>${escapeHtml(state.sourceLabel)}</span>
      <span>${escapeHtml(scopeLabel())}</span>
      <span>${participants.length} участников</span>
    `
    : "<span>Загрузите CSV по ссылке или файлом</span>";
  els.starterCount.textContent = participants.length;
  els.lapCount.textContent = lapCountLabel(participants);
}

function lapCountLabel(participants) {
  const counts = [...new Set(participants.map((participant) => participant.completedLaps))].sort((a, b) => a - b);
  if (!counts.length) return "0";
  if (counts.length === 1) return String(counts[0]);
  return counts.join(" / ");
}

function renderCard() {
  const participant = getSelectedParticipant();
  if (!participant) {
    els.participantCard.innerHTML = `<span class="muted">Выберите участника</span>`;
    return;
  }

  const favorite = state.favorites.has(participant.id);
  const trend = getTrend(participant);

  els.participantCard.innerHTML = `
    <header>
      <div>
        <h2>${escapeHtml(participant.name)}</h2>
      </div>
      <button class="favorite-btn ${favorite ? "is-on" : ""}" type="button" aria-label="Избранное" title="Избранное">★</button>
    </header>
    <dl class="record-meta">
      <div>
        <dt>Номер</dt>
        <dd>#${escapeHtml(participant.bib)}</dd>
      </div>
      <div>
        <dt>Соревнование</dt>
        <dd>${escapeHtml(participant.eventLabel)}</dd>
      </div>
      <div>
        <dt>Зачет</dt>
        <dd>${escapeHtml(participant.groupLabel)}</dd>
      </div>
      <div>
        <dt>Трасса</dt>
        <dd>${escapeHtml(participant.courseLabel)}</dd>
      </div>
      <div>
        <dt>Пол</dt>
        <dd>${escapeHtml(participant.genderLabel)}</dd>
      </div>
    </dl>
    <div class="card-stats">
      <div><span>Место</span><strong>${participant.place}</strong></div>
      <div><span>Финиш</span><strong>${formatTime(participant.total)}</strong></div>
      <div><span>Отставание</span><strong>${formatGap(participant.finishGap)}</strong></div>
      <div><span>Лучший круг</span><strong>${formatTime(participant.bestLap)}</strong></div>
      <div><span>Разброс кругов</span><strong>${formatTime(participant.lapSpread)}</strong></div>
    </div>
    <p class="pace-note">${trend}</p>
  `;

  els.participantCard.querySelector(".favorite-btn").addEventListener("click", () => {
    toggleFavorite(participant.id);
  });
}

function renderTable() {
  const headers = [
    { key: "favorite", label: "" },
    { key: "place", label: "Место" },
    { key: "bib", label: "Номер" },
    { key: "name", label: "Имя" },
    { key: "eventLabel", label: "Соревнование" },
    { key: "genderLabel", label: "Пол" },
    { key: "groupLabel", label: "Зачет" },
    { key: "courseLabel", label: "Трасса" },
    { key: "total", label: "Финиш" },
    { key: "bestLap", label: "Лучший круг" },
    ...state.laps.map((lap, index) => ({ key: `lap-${index}`, label: lap }))
  ];

  els.tableHead.innerHTML = headers.map((header) => {
    if (header.key === "favorite") return `<th><span class="chart-column-title">График</span></th>`;
    const arrow = state.sort.key === header.key ? (state.sort.dir === "asc" ? "↑" : "↓") : "";
    return `<th><button type="button" data-sort="${header.key}">${header.label} ${arrow}</button></th>`;
  }).join("");

  els.tableHead.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => toggleSort(button.dataset.sort));
  });

  const visible = getVisibleParticipants();
  els.tableBody.innerHTML = visible.map((participant) => {
    const favorite = state.favorites.has(participant.id);
    const selected = participant.id === state.selectedId;
    const lapCells = participant.laps.map((lap) => `<td>${formatTime(lap)}</td>`).join("");
    return `
      <tr data-id="${participant.id}" class="${selected ? "is-selected" : ""} ${favorite ? "is-favorite" : ""}">
        <td>
          <button
            class="row-favorite ${favorite ? "is-on" : ""}"
            type="button"
            data-favorite="${participant.id}"
            aria-pressed="${favorite}"
            aria-label="${favorite ? "Убрать с графиков" : "Показать на графиках"}"
            title="${favorite ? "Убрать с графиков" : "Показать на графиках"}"
          >${favorite ? "★" : "☆"}</button>
        </td>
        <td>${participant.place}</td>
        <td>${escapeHtml(participant.bib)}</td>
        <td>${escapeHtml(participant.name)}</td>
        <td>${escapeHtml(participant.eventLabel)}</td>
        <td>${escapeHtml(participant.genderLabel)}</td>
        <td>${escapeHtml(participant.groupLabel)}</td>
        <td>${escapeHtml(participant.courseLabel)}</td>
        <td>${formatTime(participant.total)}</td>
        <td>${formatTime(participant.bestLap)}</td>
        ${lapCells}
      </tr>
    `;
  }).join("");

  els.tableBody.querySelectorAll("tr").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedId = row.dataset.id;
      renderAll();
    });
  });

  els.tableBody.querySelectorAll("[data-favorite]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFavorite(button.dataset.favorite);
    });
  });
}

function renderCharts() {
  if (!window.Plotly) {
    setTimeout(renderCharts, 50);
    return;
  }

  if (!state.participants.length) {
    renderChartScope([]);
    renderEmptyCharts("Загрузите CSV, чтобы построить графики");
    return;
  }

  if (!isCourseComparable()) {
    renderChartScope([]);
    renderEmptyCharts("Выберите одну трассу, чтобы построить графики");
    return;
  }

  const chartParticipants = getChartParticipants();
  renderChartScope(chartParticipants);

  if (!chartParticipants.length) {
    renderEmptyCharts("Нет участников для графика");
    return;
  }

  const participants = withGroupMetrics(chartParticipants);
  const officialGroupSelected = state.group !== "all" || groupLabels().length === 1;
  const x = state.laps;
  const commonLayout = {
    margin: { t: 18, r: 22, b: 48, l: 56 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "#fbfcfa",
    hovermode: "x unified",
    legend: { orientation: "h", y: -0.22 },
    font: { family: "Inter, system-ui, sans-serif", color: "#17201c" },
    xaxis: { title: "Круг", gridcolor: "#e2e8e2", zeroline: false },
    yaxis: { gridcolor: "#e2e8e2", zeroline: false }
  };
  const config = { responsive: true, displayModeBar: false };

  clearChartPlaceholder("cumulativeChart");
  Plotly.react("cumulativeChart", traces(participants, x, "cumulative", "time"), {
    ...commonLayout,
    yaxis: { ...commonLayout.yaxis, title: "Суммарное время", ...timeTickConfig(participants.flatMap((participant) => participant.cumulative)) }
  }, config);

  clearChartPlaceholder("lapChart");
  Plotly.react("lapChart", traces(participants, x, "laps", "time"), {
    ...commonLayout,
    yaxis: { ...commonLayout.yaxis, title: "Время круга", ...timeTickConfig(participants.flatMap((participant) => participant.laps)) }
  }, config);

  if (officialGroupSelected) {
    clearChartPlaceholder("gapChart");
    Plotly.react("gapChart", traces(participants, x, "gaps", "time"), {
      ...commonLayout,
      yaxis: { ...commonLayout.yaxis, title: "Отставание от лидера зачета", ...timeTickConfig(participants.flatMap((participant) => participant.gaps)) }
    }, config);

    clearChartPlaceholder("positionChart");
    Plotly.react("positionChart", traces(participants, x, "positions", "position"), {
      ...commonLayout,
      yaxis: { ...commonLayout.yaxis, title: "Позиция в зачете", autorange: "reversed", dtick: 1 }
    }, config);
  } else {
    renderEmptyChart("gapChart", "Выберите зачет, чтобы увидеть отставания");
    renderEmptyChart("positionChart", "Выберите зачет, чтобы увидеть позиции");
  }
}

function renderEmptyCharts(message) {
  chartIds.forEach((id) => renderEmptyChart(id, message));
}

function renderEmptyChart(id, message) {
  const chart = document.querySelector(`#${id}`);
  Plotly.purge(chart);
  chart.innerHTML = `<div class="chart-empty">${escapeHtml(message)}</div>`;
}

function clearChartPlaceholder(id) {
  const chart = document.querySelector(`#${id}`);
  chart.querySelector(".chart-empty")?.remove();
}

function renderChartScope(participants) {
  const favoriteCount = getVisibleParticipants().filter((participant) => state.favorites.has(participant.id)).length;

  if (!state.participants.length) {
    els.chartScope.textContent = "Графики появятся после загрузки CSV.";
    return;
  }

  if (!isCourseComparable()) {
    els.chartScope.textContent = "Графики скрыты: выберите одну трассу.";
    return;
  }

  if (state.favorites.size) {
    els.chartScope.textContent = favoriteCount
      ? `На графиках: избранные участники (${participants.length}). Звездочка в таблице добавляет или убирает линию.`
      : "На графиках нет линий: избранные участники не попали в текущий фильтр.";
    return;
  }

  els.chartScope.textContent = `На графиках: топ-${Math.min(CHART_DEFAULT_LIMIT, participants.length)} по текущей сортировке таблицы. Отметьте участников звездой, чтобы сравнить только их.`;
}

function getChartParticipants() {
  const visible = getVisibleParticipants();
  const favoriteParticipants = visible.filter((participant) => state.favorites.has(participant.id));
  if (state.favorites.size) return favoriteParticipants;
  return visible.slice(0, CHART_DEFAULT_LIMIT);
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
  } else {
    state.favorites.add(id);
  }
  renderAll();
}

function withGroupMetrics(participants) {
  const scope = state.group === "all" ? getCourseParticipants() : getScopeParticipants();
  const positionsByLap = computePositionsByGroup(scope, state.laps.length);
  const leadersByLap = computeLeadersByGroup(scope, state.laps.length);

  return participants.map((participant) => ({
    ...participant,
    positions: positionsByLap.get(participant.id) ?? participant.positions,
    gaps: participant.cumulative.map((time, lapIndex) => {
      const leaderTime = leadersByLap.get(participant.scoreKey)?.[lapIndex];
      return time == null || leaderTime == null ? null : time - leaderTime;
    })
  }));
}

function traces(participants, x, key, mode) {
  const showEvent = new Set(participants.map((participant) => participant.eventKey)).size > 1;
  return participants.map((participant, index) => {
    const favorite = state.favorites.has(participant.id);
    const selected = participant.id === state.selectedId;
    const width = selected ? 4 : favorite ? 3 : 2;
    const opacity = selected || favorite || state.favorites.size === 0 ? 1 : 0.35;
    return {
      x,
      y: participant[key],
      type: "scatter",
      mode: "lines+markers",
      name: `${showEvent ? `${participant.eventLabel} · ` : ""}${participant.bib} ${participant.name}`,
      line: { color: palette[index % palette.length], width },
      marker: { size: selected ? 8 : 6 },
      opacity,
      hovertemplate: `%{fullData.name}<br>%{x}: ${mode === "position" ? "%{y}" : "%{customdata}"}<extra></extra>`,
      customdata: participant[key].map((value) => mode === "position" ? value : formatTime(value))
    };
  });
}

function timeTickConfig(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return {};

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const span = Math.max(1, max - min);
  const step = niceTimeStep(span / 5);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const tickvals = [];

  for (let value = start; value <= end + step * 0.5; value += step) {
    tickvals.push(Math.round(value * 10) / 10);
  }

  return {
    tickmode: "array",
    tickvals,
    ticktext: tickvals.map(formatTime)
  };
}

function niceTimeStep(target) {
  return [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
    .find((step) => step >= target) ?? 7200;
}

function setActiveChart(id) {
  state.activeChart = id;
  els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.chart === id));
  els.charts.forEach((chart) => chart.classList.toggle("is-active", chart.id === id));
  if (window.Plotly) requestAnimationFrame(resizeActiveChart);
}

function resizeActiveChart() {
  const chart = document.querySelector(".chart.is-active");
  if (chart?.clientWidth && chart?.clientHeight) {
    Plotly.Plots.resize(chart);
  }
}

function toggleSort(key) {
  if (state.sort.key === key) {
    state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
  } else {
    state.sort = { key, dir: key === "name" ? "asc" : "asc" };
  }
  renderTable();
}

function getVisibleParticipants() {
  const query = state.search;
  return getScopeParticipants()
    .filter((participant) => {
      if (!query) return true;
      return participant.bib.toLowerCase().includes(query) || participant.name.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      const dir = state.sort.dir === "asc" ? 1 : -1;
      return compareSortValue(a, b, state.sort.key) * dir;
    });
}

function getEventParticipants() {
  if (state.event === "all") return [...state.participants];
  return state.participants.filter((participant) => participant.eventKey === state.event);
}

function getCourseParticipants() {
  const participants = getEventParticipants();
  if (state.course === "all") return participants;
  return participants.filter((participant) => participant.courseKey === state.course);
}

function getScopeParticipants() {
  const participants = getCourseParticipants();
  if (state.group === "all") return participants;
  return participants.filter((participant) => participant.groupKey === state.group);
}

function isCourseComparable() {
  return new Set(getScopeParticipants().map((participant) => participant.courseKey)).size <= 1;
}

function isScopeComparable() {
  return isCourseComparable() && new Set(getScopeParticipants().map((participant) => participant.scoreKey)).size <= 1;
}

function courseLabels() {
  return [...new Set(getScopeParticipants().map((participant) => participant.courseLabel))];
}

function eventLabels() {
  return [...new Set(getScopeParticipants().map((participant) => participant.eventLabel))];
}

function groupLabels() {
  return [...new Set(getScopeParticipants().map((participant) => participant.groupLabel))];
}

function renderEventOptions() {
  if (!state.participants.length) {
    els.eventSelect.innerHTML = `<option value="all">Нет данных</option>`;
    els.eventSelect.value = "all";
    return;
  }

  const events = [...new Map(state.participants.map((participant) => [
    participant.eventKey,
    participant.eventLabel
  ])).entries()];

  if (events.length === 1) {
    state.event = events[0][0];
    els.eventSelect.innerHTML = `<option value="${escapeHtml(events[0][0])}">${escapeHtml(events[0][1])}</option>`;
    els.eventSelect.value = state.event;
    return;
  }

  const eventExists = state.event === "all" || events.some(([key]) => key === state.event);
  if (!eventExists) state.event = "all";

  els.eventSelect.innerHTML = [
    `<option value="all">Все соревнования</option>`,
    ...events.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`)
  ].join("");
  els.eventSelect.value = state.event;
}

function renderCourseOptions() {
  if (!state.participants.length) {
    els.courseSelect.innerHTML = `<option value="all">Нет данных</option>`;
    els.courseSelect.value = "all";
    return;
  }

  const courses = [...new Map(getEventParticipants().map((participant) => [
    participant.courseKey,
    participant.courseLabel
  ])).entries()];
  if (courses.length === 1) {
    state.course = courses[0][0];
    els.courseSelect.innerHTML = `<option value="${escapeHtml(courses[0][0])}">${escapeHtml(courses[0][1])}</option>`;
    els.courseSelect.value = state.course;
    return;
  }

  const courseExists = state.course === "all" || courses.some(([key]) => key === state.course);
  if (!courseExists) state.course = "all";

  els.courseSelect.innerHTML = [
    `<option value="all">Все трассы</option>`,
    ...courses.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`)
  ].join("");
  els.courseSelect.value = state.course;
}

function renderGroupOptions() {
  if (!state.participants.length) {
    els.groupSelect.innerHTML = `<option value="all">Нет данных</option>`;
    els.groupSelect.value = "all";
    return;
  }

  const groups = [...new Map(getCourseParticipants().map((participant) => [
    participant.groupKey,
    participant.groupLabel
  ])).entries()];
  const groupExists = state.group === "all" || groups.some(([key]) => key === state.group);
  if (!groupExists) state.group = "all";

  els.groupSelect.innerHTML = [
    `<option value="all">Все зачеты</option>`,
    ...groups.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`)
  ].join("");
  els.groupSelect.value = state.group;
}

function ensureSelectedVisible() {
  const visible = getVisibleParticipants();
  if (!visible.length) {
    state.selectedId = null;
    return;
  }

  if (!visible.some((participant) => participant.id === state.selectedId)) {
    state.selectedId = visible[0].id;
  }
}

function scopeLabel() {
  const parts = [eventLabel(), courseLabel()];
  if (state.group !== "all") parts.push(getScopeParticipants()[0]?.groupLabel ?? "Выбранный зачет");
  return parts.filter(Boolean).join(" / ");
}

function eventLabel() {
  if (state.event === "all") {
    const labels = eventLabels();
    return labels.length === 1 ? labels[0] : "Все соревнования";
  }
  return getEventParticipants()[0]?.eventLabel ?? "Выбранное соревнование";
}

function courseLabel() {
  if (state.course === "all") return "Все трассы";
  return getCourseParticipants()[0]?.courseLabel ?? "Выбранная трасса";
}

function groupLabel() {
  if (state.group === "all") {
    const labels = groupLabels();
    return labels.length === 1 ? labels[0] : "Все зачеты";
  }
  return getScopeParticipants()[0]?.groupLabel ?? "Выбранный зачет";
}

function prioritizeParticipants(participants) {
  if (!state.favorites.size) return participants.slice(0, 12);
  const highlighted = participants.filter((participant) => state.favorites.has(participant.id) || participant.id === state.selectedId);
  const rest = participants.filter((participant) => !highlighted.includes(participant));
  return [...highlighted, ...rest].slice(0, 12);
}

function compareSortValue(a, b, key) {
  if (key.startsWith("lap-")) {
    const index = Number(key.split("-")[1]);
    return compareValues(a.laps[index], b.laps[index]);
  }
  return compareValues(a[key], b[key]);
}

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function getSelectedParticipant() {
  return getVisibleParticipants().find((participant) => participant.id === state.selectedId) ?? getVisibleParticipants()[0] ?? null;
}

function getTrend(participant) {
  const first = participant.laps.find((lap) => Number.isFinite(lap));
  const last = lastNumber(participant.laps);
  const best = participant.bestLap;
  const spreadValue = participant.lapSpread;
  const notes = [];

  if (first != null && last != null && first > 0) {
    const finishDelta = last - first;
    const finishDeltaRatio = finishDelta / first;
    if (Math.abs(finishDeltaRatio) <= 0.02) {
      notes.push("Финишировал в темпе первого круга.");
    } else if (finishDeltaRatio < 0) {
      notes.push(`Ускорился к финишу: последний круг быстрее первого на ${formatTime(Math.abs(finishDelta))}.`);
    } else {
      notes.push(`Темп к концу снизился: последний круг медленнее первого на ${formatTime(finishDelta)}.`);
    }
  }

  if (spreadValue != null && best != null && best > 0) {
    const spreadRatio = spreadValue / best;
    if (spreadRatio <= 0.03) {
      notes.push("Круги прошел очень ровно.");
    } else if (spreadRatio <= 0.07) {
      notes.push("Темп был достаточно ровный.");
    } else {
      notes.push("Темп был нестабильным.");
    }
  }

  const outlier = getSlowLapOutlier(participant);
  if (outlier) {
    notes.push(`Самый долгий круг - ${outlier.label}.`);
  }

  return notes.join(" ") || "Пока мало данных, чтобы оценить темп по кругам.";
}

function getSlowLapOutlier(participant) {
  const laps = participant.laps
    .map((lap, index) => ({ lap, index }))
    .filter((item) => Number.isFinite(item.lap));

  if (laps.length < 3) return null;

  const slowest = laps.reduce((max, item) => item.lap > max.lap ? item : max, laps[0]);
  const otherLaps = laps.filter((item) => item.index !== slowest.index).map((item) => item.lap);
  const baseline = average(otherLaps);

  if (!baseline || (slowest.lap - baseline) / baseline < 0.07) return null;

  return {
    label: state.laps[slowest.index] ?? `Круг ${slowest.index + 1}`,
    time: slowest.lap
  };
}

function formatTime(value) {
  if (!Number.isFinite(value)) return "-";
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute - minutes * 60;
  const padded = seconds < 10 ? `0${seconds.toFixed(seconds % 1 ? 1 : 0)}` : seconds.toFixed(seconds % 1 ? 1 : 0);
  return `${sign}${minutes}:${padded}`;
}

function formatGap(value) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) < 0.5) return "0:00";
  return `+${formatTime(value)}`;
}

function setNotice(message) {
  els.notice.textContent = message;
  els.notice.classList.toggle("is-hidden", !message);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}
