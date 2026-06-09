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
  activeChart: "cumulativeChart"
};

const els = {
  notice: document.querySelector("#notice"),
  srcInput: document.querySelector("#srcInput"),
  urlForm: document.querySelector("#urlForm"),
  fileInput: document.querySelector("#fileInput"),
  fileName: document.querySelector(".file-picker strong"),
  srcButton: document.querySelector("#urlForm button[type='submit']"),
  searchInput: document.querySelector("#searchInput"),
  eventSelect: document.querySelector("#eventSelect"),
  courseSelect: document.querySelector("#courseSelect"),
  groupSelect: document.querySelector("#groupSelect"),
  starterCount: document.querySelector("#starterCount"),
  lapCount: document.querySelector("#lapCount"),
  participantCard: document.querySelector("#participantCard"),
  chartScope: document.querySelector("#chartScope"),
  chartRow: document.querySelector(".chart-row"),
  comparisonPanel: document.querySelector("#comparisonPanel"),
  tableHead: document.querySelector("#tableHead"),
  tableBody: document.querySelector("#tableBody"),
  tabs: document.querySelectorAll(".tab"),
  charts: document.querySelectorAll(".chart")
};

const chartIds = ["cumulativeChart", "lapChart", "positionChart"];
const palette = ["#0f766e", "#b3261e", "#d69e2e", "#293241", "#627c85", "#6a4c93", "#2a9d8f", "#e76f51"];
const CHART_DEFAULT_LIMIT = 10;

let activeLoadSeq = 0;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  const urlSrc = new URLSearchParams(window.location.search).get("src");

  renderAll();

  if (urlSrc) {
    els.srcInput.value = urlSrc;
    await loadFromUrl(urlSrc);
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
    if (file) {
      els.fileName.textContent = file.name;
      await loadFromFile(file);
    }
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
    tab.addEventListener("click", () => {
      if (tab.getAttribute("aria-disabled") === "true") return;
      setActiveChart(tab.dataset.chart);
    });
    tab.addEventListener("mouseenter", () => showTabHint(tab));
    tab.addEventListener("mouseleave", hideTabHint);
    tab.addEventListener("focus", () => showTabHint(tab));
    tab.addEventListener("blur", hideTabHint);
  });

  window.addEventListener("resize", debounce(() => {
    resizeActiveChart();
  }, 150));
}

async function loadFromUrl(src) {
  const seq = ++activeLoadSeq;
  setBusy(true);
  try {
    setNotice("Загружаем данные...", "loading");
    const response = await fetch(src, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (seq !== activeLoadSeq) return;
    if (!loadCsv(text)) return;
    setNotice("");
    els.fileInput.value = "";
    els.fileName.textContent = "Выбрать CSV";
    const url = new URL(window.location.href);
    url.searchParams.set("src", src);
    window.history.replaceState({}, "", url);
  } catch (error) {
    if (seq === activeLoadSeq) setNotice(`Не удалось загрузить CSV по URL: ${error.message}`);
  } finally {
    if (seq === activeLoadSeq) setBusy(false);
  }
}

async function loadFromFile(file) {
  const seq = ++activeLoadSeq;
  setBusy(true);
  try {
    setNotice("Читаем файл...", "loading");
    const text = await file.text();
    if (seq !== activeLoadSeq) return;
    if (!loadCsv(text)) return;
    setNotice("");
    els.srcInput.value = "";
    const url = new URL(window.location.href);
    url.searchParams.delete("src");
    window.history.replaceState({}, "", url);
  } catch (error) {
    if (seq === activeLoadSeq) setNotice(`Не удалось прочитать CSV-файл: ${error.message}`);
  } finally {
    if (seq === activeLoadSeq) setBusy(false);
  }
}

function setBusy(busy) {
  els.srcButton.disabled = busy;
  els.fileInput.disabled = busy;
  document.body.classList.toggle("is-busy", busy);
}

function loadCsv(text) {
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
    els.searchInput.value = "";
    renderAll();
    return true;
  } catch (error) {
    if (error.issues) showCsvIssues(error.issues);
    else setNotice(error.message);
    return false;
  }
}

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
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
  const required = ["event", "place", "bib", "name", "gender", "group", "course"];
  const headers = Object.keys(rows[0] ?? {});
  const lowerMap = new Map(headers.map((header) => [header.toLowerCase(), header]));

  const lapHeaders = headers.filter((header) => /^lap\d*$/i.test(header.trim()));
  if (!lapHeaders.length) throw new Error("В CSV должны быть колонки кругов: lap1, lap2, lap3 и так далее.");

  const eventHeader = findHeader(lowerMap, ["event", "event_id", "eventid", "race", "race_id", "raceid", "meet", "competition", "date", "day", "соревнование", "гонка", "старт", "дата", "протокол"]);
  const groupHeader = findHeader(lowerMap, ["group", "group_id", "groupid", "category", "division", "class", "wave", "зачет", "зачёт", "группа", "класс", "категория"]);
  const courseHeader = findHeader(lowerMap, ["course", "course_id", "courseid", "track", "track_id", "track_type", "route", "distance", "layout", "трасса", "дистанция", "маршрут", "тип_трассы"]);
  const resolvedHeaders = {
    event: eventHeader,
    place: lowerMap.get("place"),
    bib: lowerMap.get("bib"),
    name: lowerMap.get("name"),
    gender: lowerMap.get("gender"),
    group: groupHeader,
    course: courseHeader
  };
  const missing = required.filter((field) => !resolvedHeaders[field]);
  if (missing.length) throw new Error(`В CSV нет обязательных колонок: ${missing.join(", ")}.`);

  const participants = [];
  const issues = [];
  rows.forEach((row, index) => {
    try {
      participants.push(buildParticipant(row, index, lapHeaders, resolvedHeaders));
    } catch (error) {
      issues.push(error.message);
    }
  });

  if (issues.length) {
    const error = new Error(`Проблемных строк: ${issues.length}.`);
    error.issues = issues;
    throw error;
  }

  const officialParticipants = participants.filter(isOfficialFinisher);
  const positionsByLap = computePositionsByGroup(officialParticipants, lapHeaders.length);
  const leadersByLap = computeLeadersByGroup(officialParticipants, lapHeaders.length);
  participants.forEach((participant) => {
    participant.positions = positionsByLap.get(participant.id) ?? Array(lapHeaders.length).fill(null);
    participant.finishGap = isOfficialFinisher(participant)
      ? getFinishGap(participant, leadersByLap)
      : null;
  });

  return { participants, laps: lapHeaders.map(lapLabel) };
}

function buildParticipant(row, index, lapHeaders, resolvedHeaders) {
  const requireCell = (field, header) => {
    const value = row[header] ?? "";
    if (!String(value).trim()) throw new Error(`В строке ${index + 2} пустое обязательное поле ${field}.`);
    return value;
  };
  const place = normalizePlace(requireCell("place", resolvedHeaders.place), index);
  const bib = requireCell("bib", resolvedHeaders.bib);
  const name = requireCell("name", resolvedHeaders.name);
  const gender = normalizeGender(requireCell("gender", resolvedHeaders.gender));
  const event = normalizeEvent(requireCell("event", resolvedHeaders.event));
  const group = normalizeResultGroup(requireCell("group", resolvedHeaders.group));
  const course = normalizeCourse(requireCell("course", resolvedHeaders.course));
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
    id: `${bib}-${index}`,
    place: place.value,
    placeLabel: place.label,
    placeStatus: place.status,
    bib,
    name,
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
}

function findHeader(lowerMap, candidates) {
  return candidates.map((candidate) => lowerMap.get(candidate)).find(Boolean) ?? null;
}

function lapLabel(header) {
  const match = String(header).match(/\d+/);
  return match ? match[0] : header;
}

const PLACE_STATUSES = new Set(["DNF", "DNS", "DSQ"]);

function normalizePlace(value, index) {
  const raw = String(value ?? "").trim();
  const numeric = numberOrNull(raw);
  if (numeric != null && Number.isInteger(numeric) && numeric > 0) {
    return { value: numeric, label: String(numeric), status: null };
  }

  const status = raw.toUpperCase();
  if (PLACE_STATUSES.has(status)) return { value: null, label: status, status };

  throw new Error(`В строке ${index + 2} место должно быть положительным целым числом или статусом (DNF, DNS, DSQ): ${raw}.`);
}

function normalizeGender(value) {
  const raw = String(value ?? "").trim();
  const normalized = raw.toLowerCase();

  if (["f", "female", "w", "woman", "women", "ж", "жен", "женщина", "женщины"].includes(normalized)) {
    return { key: "F", label: "Ж" };
  }

  if (["m", "male", "man", "men", "м", "муж", "мужчина", "мужчины"].includes(normalized)) {
    return { key: "M", label: "М" };
  }

  return { key: normalized || "unknown", label: raw || "Не указан" };
}

function normalizeResultGroup(value) {
  const raw = String(value ?? "").trim();
  return {
    key: raw.toLowerCase(),
    label: raw
  };
}

function normalizeEvent(value) {
  const raw = String(value ?? "").trim();
  return {
    key: raw.toLowerCase(),
    label: raw
  };
}

function normalizeCourse(value) {
  const raw = String(value ?? "").trim();
  return {
    key: raw.toLowerCase(),
    label: raw
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

function isOfficialFinisher(participant) {
  return !participant.placeStatus;
}

function getFinishGap(participant, leadersByLap) {
  const lapIndex = lastFiniteIndex(participant.cumulative);
  if (lapIndex < 0) return null;
  const leaderTime = leadersByLap.get(participant.scoreKey)?.[lapIndex];
  const time = participant.cumulative[lapIndex];
  return Number.isFinite(time) && Number.isFinite(leaderTime) ? time - leaderTime : null;
}

function lastFiniteIndex(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(values[index])) return index;
  }
  return -1;
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

function computeLeaders(participants, lapCount) {
  return Array.from({ length: lapCount }, (_, lapIndex) => {
    const times = participants
      .map((participant) => participant.cumulative[lapIndex])
      .filter((time) => Number.isFinite(time));
    return times.length ? Math.min(...times) : null;
  });
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
    if (!state.participants.length) {
      els.participantCard.innerHTML = `<p class="muted">Загрузите CSV по ссылке или с диска, чтобы увидеть результаты.</p>`;
      return;
    }
    els.participantCard.innerHTML = `<span class="muted">Выберите участника</span>`;
    return;
  }

  const favorite = state.favorites.has(participant.id);
  const trend = getTrend(participant);
  const finishLabel = isOfficialFinisher(participant) ? "Финиш" : "Последняя отметка";
  const finishValue = isOfficialFinisher(participant)
    ? formatTime(participant.total)
    : formatStatusProgress(participant);

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
      <div><span>Место</span><strong>${escapeHtml(participant.placeLabel)}</strong></div>
      <div><span>${finishLabel}</span><strong>${escapeHtml(finishValue)}</strong></div>
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
        <td>${escapeHtml(participant.placeLabel)}</td>
        <td>${escapeHtml(participant.bib)}</td>
        <td>${escapeHtml(participant.name)}</td>
        <td>${escapeHtml(participant.eventLabel)}</td>
        <td>${escapeHtml(participant.genderLabel)}</td>
        <td>${escapeHtml(participant.groupLabel)}</td>
        <td>${escapeHtml(participant.courseLabel)}</td>
        <td>${formatTableFinish(participant)}</td>
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

  const officialGroupSelected = state.group !== "all" || groupLabels().length === 1;
  updateChartTabs(officialGroupSelected);

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
    clearChartPlaceholder("positionChart");
    Plotly.react("positionChart", traces(participants, x, "positions", "position"), {
      ...commonLayout,
      yaxis: { ...commonLayout.yaxis, title: "Позиция в зачете", autorange: "reversed", dtick: 1 }
    }, config);
  } else {
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
  const favoriteCount = getFilteredParticipants().filter((participant) => state.favorites.has(participant.id)).length;

  if (!state.participants.length) {
    els.chartScope.textContent = "Графики появятся после загрузки CSV.";
    return;
  }

  if (!isCourseComparable()) {
    els.chartScope.textContent = "Графики скрыты: выберите одну трассу.";
    return;
  }

  if (state.favorites.size) {
    els.chartScope.innerHTML = favoriteCount
      ? `<strong>Сравнение</strong><span>На графиках только отмеченные участники (${participants.length}). Звездочка в таблице добавляет или убирает линию.</span>`
      : `<strong>Сравнение</strong><span>На графиках нет линий: отмеченные участники не попали в текущий фильтр.</span>`;
    return;
  }

  els.chartScope.innerHTML = `<strong>Обзор</strong><span>На графиках топ-${Math.min(CHART_DEFAULT_LIMIT, participants.length)} по месту в текущей выборке. Отметьте участников звездой, чтобы перейти к сравнению.</span>`;
}

function renderComparisonPanel() {
  const selected = getChartParticipants();

  if (!state.participants.length || !state.favorites.size || selected.length < 2) {
    hideComparisonPanel();
    return;
  }

  els.comparisonPanel.classList.remove("is-hidden");
  els.chartRow.classList.add("has-comparison");

  if (!isCourseComparable()) {
    els.comparisonPanel.innerHTML = `
      <header class="comparison-header">
        <div>
          <h2>Сравнение выбранных</h2>
          <p>Выберите одну трассу, чтобы сравнить отмеченных участников по времени.</p>
        </div>
      </header>
    `;
    return;
  }

  const participants = withGroupMetrics(selected);
  const table = comparisonTableForActiveChart(participants);
  const showContext = hasMixedComparisonContext(participants);
  const headers = state.laps.map((lap) => `<th>${escapeHtml(lap)}</th>`).join("");
  const rows = participants.map((participant) => comparisonRow(participant, table)).join("");

  els.comparisonPanel.innerHTML = `
    <header class="comparison-header">
      <div>
        <h2>${escapeHtml(table.title)}</h2>
        <p>${escapeHtml(table.note)}${showContext ? " Сравнение по трассе, без учета зачета." : ""}</p>
      </div>
    </header>
    <div class="comparison-table-wrap">
      <table class="comparison-table">
        <thead>
          <tr>
            <th>Участник</th>
            ${headers}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function hideComparisonPanel() {
  els.comparisonPanel.classList.add("is-hidden");
  els.comparisonPanel.innerHTML = "";
  els.chartRow.classList.remove("has-comparison");
}

function hasMixedComparisonContext(participants) {
  return new Set(participants.map((participant) => participant.eventKey)).size > 1
    || new Set(participants.map((participant) => participant.groupKey)).size > 1;
}

function participantLabel(participant) {
  return `#${participant.bib} ${participant.name}`;
}

function comparisonTableForActiveChart(participants) {
  if (state.activeChart === "lapChart") {
    const leaders = state.laps.map((_, index) => minNumber(participants.map((participant) => participant.laps[index])));
    return {
      title: "Таблица: круги",
      note: "Разница к лучшему кругу среди выбранных на каждом круге.",
      values: (participant) => participant.laps.map((time, index) => compareTime(time, leaders[index])),
      format: formatComparisonDelta,
      className: comparisonClass
    };
  }

  if (state.activeChart === "positionChart") {
    return {
      title: "Таблица: позиция",
      note: "Те же позиции по отметкам, что на графике.",
      values: (participant) => participant.positions,
      format: formatPosition,
      className: () => "is-even"
    };
  }

  const leaders = state.laps.map((_, index) => minNumber(participants.map((participant) => participant.cumulative[index])));
  return {
    title: "Таблица: суммарное время",
    note: "Нарастание разницы к лучшему из выбранных на каждой отметке.",
    values: (participant) => participant.cumulative.map((time, index) => compareTime(time, leaders[index])),
    format: formatComparisonDelta,
    className: comparisonClass
  };
}

function comparisonRow(participant, table) {
  const cells = table.values(participant).map((value) => (
    `<td class="${table.className(value)}">${escapeHtml(table.format(value))}</td>`
  )).join("");

  return `
    <tr>
      <th scope="row">
        <span>${escapeHtml(participantLabel(participant))}</span>
      </th>
      ${cells}
    </tr>
  `;
}

function compareTime(value, baseValue) {
  return Number.isFinite(value) && Number.isFinite(baseValue) ? value - baseValue : null;
}

function getChartParticipants() {
  const filtered = getFilteredParticipants();
  const favoriteParticipants = filtered.filter((participant) => state.favorites.has(participant.id));
  if (state.favorites.size) return favoriteParticipants;
  return getOverviewParticipants(filtered);
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
  const scope = (state.group === "all" ? getCourseParticipants() : getScopeParticipants())
    .filter(isOfficialFinisher);
  const positionsByLap = computePositionsByGroup(scope, state.laps.length);

  return participants.map((participant) => ({
    ...participant,
    positions: positionsByLap.get(participant.id) ?? participant.positions
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
      name: sanitizeTraceName(`${showEvent ? `${participant.eventLabel} · ` : ""}${participant.bib} ${participant.name}`),
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

const OFFICIAL_CHART_IDS = ["positionChart"];

function updateChartTabs(officialGroupSelected) {
  els.tabs.forEach((tab) => {
    const locked = OFFICIAL_CHART_IDS.includes(tab.dataset.chart) && !officialGroupSelected;
    tab.classList.toggle("is-disabled", locked);
    tab.setAttribute("aria-disabled", String(locked));
    if (locked) {
      tab.dataset.hint = "Покажет, как менялась позиция в зачёте по кругам. Доступно для одного зачёта — выберите его в фильтре «Зачёт».";
    } else {
      delete tab.dataset.hint;
      if (tabHintEl && tabHintEl.dataset.for === tab.dataset.chart) hideTabHint();
    }
  });

  if (!officialGroupSelected && OFFICIAL_CHART_IDS.includes(state.activeChart)) {
    setActiveChart("cumulativeChart");
  }
}

let tabHintEl = null;

function showTabHint(tab) {
  const hint = tab.dataset.hint;
  if (!hint) return;
  if (!tabHintEl) {
    tabHintEl = document.createElement("div");
    tabHintEl.className = "tab-hint";
    document.body.appendChild(tabHintEl);
  }
  tabHintEl.textContent = hint;
  tabHintEl.dataset.for = tab.dataset.chart;
  tabHintEl.style.visibility = "hidden";
  tabHintEl.classList.add("is-visible");

  const rect = tab.getBoundingClientRect();
  const left = Math.max(10, Math.min(rect.left, window.innerWidth - tabHintEl.offsetWidth - 10));
  tabHintEl.style.left = `${left}px`;
  tabHintEl.style.top = `${rect.bottom + 8}px`;
  tabHintEl.style.visibility = "visible";
}

function hideTabHint() {
  if (tabHintEl) tabHintEl.classList.remove("is-visible");
}

function setActiveChart(id) {
  state.activeChart = id;
  els.tabs.forEach((tab) => {
    const active = tab.dataset.chart === id;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  els.charts.forEach((chart) => chart.classList.toggle("is-active", chart.id === id));
  renderComparisonPanel();
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
    state.sort = { key, dir: "asc" };
  }
  renderTable();
}

function getVisibleParticipants() {
  return getFilteredParticipants()
    .sort((a, b) => {
      const dir = state.sort.dir === "asc" ? 1 : -1;
      return compareSortValue(a, b, state.sort.key) * dir;
    });
}

function getFilteredParticipants() {
  const query = state.search;
  return getScopeParticipants().filter((participant) => {
    if (!query) return true;
    return participant.bib.toLowerCase().includes(query) || participant.name.toLowerCase().includes(query);
  });
}

function getOverviewParticipants(participants) {
  return [...participants]
    .sort(compareOverviewParticipants)
    .slice(0, CHART_DEFAULT_LIMIT);
}

function compareOverviewParticipants(a, b) {
  const official = compareValues(isOfficialFinisher(a) ? 0 : 1, isOfficialFinisher(b) ? 0 : 1);
  return official
    || compareValues(a.place, b.place)
    || compareValues(b.completedLaps, a.completedLaps)
    || compareValues(a.total, b.total)
    || compareValues(a.eventLabel, b.eventLabel)
    || compareValues(a.groupLabel, b.groupLabel)
    || compareValues(a.name, b.name);
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

function compareSortValue(a, b, key) {
  if (key.startsWith("lap-")) {
    const index = Number(key.split("-")[1]);
    return compareValues(a.laps[index], b.laps[index]);
  }
  if (key === "total") {
    return compareValues(isOfficialFinisher(a) ? a.total : null, isOfficialFinisher(b) ? b.total : null);
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
  const official = isOfficialFinisher(participant);

  if (first != null && last != null && first > 0) {
    const finishDelta = last - first;
    const finishDeltaRatio = finishDelta / first;
    if (Math.abs(finishDeltaRatio) <= 0.02) {
      notes.push(official ? "Финишировал в темпе первого круга." : "Отмеченные круги прошел в ровном темпе.");
    } else if (finishDeltaRatio < 0) {
      notes.push(official
        ? `Ускорился к финишу: последний круг быстрее первого на ${formatTime(Math.abs(finishDelta))}.`
        : `Последний отмеченный круг быстрее первого на ${formatTime(Math.abs(finishDelta))}.`);
    } else {
      notes.push(official
        ? `Темп к концу снизился: последний круг медленнее первого на ${formatTime(finishDelta)}.`
        : `Темп на последнем отмеченном круге снизился: он медленнее первого на ${formatTime(finishDelta)}.`);
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

function formatPosition(value) {
  return Number.isFinite(value) ? String(value) : "-";
}

function formatGap(value) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) < 0.5) return "0:00";
  return `+${formatTime(value)}`;
}

function formatStatusProgress(participant) {
  return Number.isFinite(participant.total) ? formatTime(participant.total) : participant.placeLabel;
}

function formatTableFinish(participant) {
  return isOfficialFinisher(participant)
    ? formatTime(participant.total)
    : escapeHtml(participant.placeLabel);
}

function formatComparisonDelta(value) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) < 0.5) return "0:00";
  return value > 0 ? `+${formatTime(value)}` : formatTime(value);
}

function comparisonClass(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.5) return "is-even";
  return value > 0 ? "is-behind" : "is-ahead";
}

function setNotice(message, variant = "error") {
  els.notice.textContent = message;
  els.notice.classList.toggle("is-hidden", !message);
  els.notice.classList.toggle("is-loading", Boolean(message) && variant === "loading");
}

function showCsvIssues(issues) {
  const limit = 50;
  const shown = issues.slice(0, limit);
  const extra = issues.length - shown.length;
  const list = shown.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("");
  const more = extra > 0
    ? `<p class="notice-more">...и еще ${extra} ${pluralRu(extra, "строка", "строки", "строк")}.</p>`
    : "";

  els.notice.innerHTML = `
    <p class="notice-title">Файл не загружен. Проблемных строк: ${issues.length}. Исправьте их и загрузите снова.</p>
    <ul class="notice-list">${list}</ul>
    ${more}
  `;
  els.notice.classList.remove("is-hidden", "is-loading");
}

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function sanitizeTraceName(value) {
  return String(value ?? "").replace(/[<>]/g, " ").trim();
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
