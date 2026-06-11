# Racelytics Project Spec

This file exists for development and review, especially when the context of previous discussions is lost. `README.md` describes how to use the application, while this document captures architectural decisions, the data model, expected behavior, and verification scenarios.

## Goal

Racelytics is a lightweight static dashboard for analyzing lap-based race results.

Principles:

- no backend, accounts, database, or history;
- a single static HTML page suitable for GitHub Pages;
- data comes from a CSV via a direct link or a local file picker;
- Google Sheets can be a convenient CSV source via a published CSV link;
- the application must be understandable to people who don't program.

## Technology

- `index.html` — static page markup;
- `styles.css` — the entire UI;
- `app.js` — CSV parsing, data normalization, filters, table, participant card, charts;
- `racelytics.lang.js` — UI string dictionaries (locales), loaded before `app.js`;
- Plotly via CDN — charts;
- `results.csv` — demo/test data, not a required part of the runtime.

Do not add a backend without an explicit decision. New dependencies need a clear payoff: the project is intentionally vanilla JS.

## Data Loading

Two ways are supported:

- a URL from `?src=` or the `CSV file link` field;
- a local CSV via `<input type="file">`.

URLs are loaded with a direct `fetch(src)`. There is no special handling for Yandex.Disk, the Google Drive API, or other providers, and there must not be by default. For Google Sheets, a ready-made CSV link is expected, like `.../pub?...&output=csv` or `.../export?format=csv&gid=...`.

A local file is read in the browser via `file.text()`, is never sent anywhere, and also works on GitHub Pages.

While loading, the interface enters a "busy" state (`setBusy`): the load button and file picker are disabled, and data content is dimmed and ignores clicks so the user doesn't work with stale data. The dimming transition is delayed by ~200 ms, so fast loads don't flicker. Parallel loads are guarded by the `activeLoadSeq` counter: only the result of the most recently started load is applied; a stale response (even if it arrives later) is discarded and does not overwrite fresh data.

## CSV Model

Core columns:

```csv
event,place,bib,name,gender,group,course,lap1,lap2,lap3...
```

Meaning:

- `event` — a specific competition, date, start, or protocol;
- `place` — the place within the group of that event: a positive integer or a fixed non-finish status `DNF`/`DNS`/`DSQ`;
- `bib` — the participant's number in a specific event;
- `name` — the participant's name;
- `gender` — an attribute of the participant, not a scoring group by itself;
- `group` — the scoring group within which places, finish gaps, and positions are calculated;
- `course` — the course/distance format for analytical comparison;
- `lap1...lapN` — cumulative time splits at the end of each lap.

`lap1...lapN` are not lap durations. Example:

```csv
lap1,lap2,lap3
3:07,6:17,9:24
```

Inside the application this becomes laps:

```text
1: 3:07
2: 3:10
3: 3:07
```

Time format in the CSV: `[HH:]MM:SS`. Seconds without a colon are intentionally unsupported to avoid mixing old and new formats.

## Compatibility Keys

An important separation:

- `group` defines the official scoring;
- `course` defines course compatibility for analytics;
- `event` separates different competitions/years.

The official result key:

```text
event + course + group
```

This means:

- results from different years can live in one CSV;
- if the course is the same, `course` must be identical;
- official places, finish gaps, and positions are never mixed across different `event`s;
- time/lap charts may compare several `event`s on the same course.

Do not put the year into `group` when `event` exists. Correct:

```csv
event=2026-06-07, group=М 7.2 км
event=2025-06-08, group=М 7.2 км
```

Undesirable:

```csv
group=М 7.2 км 2026
group=М 7.2 км 2025
```

## Strict CSV Format

Backward compatibility with older CSVs is currently not a goal. Do not add implicit value substitutions without an explicit decision.

Required columns:

```text
event, place, bib, name, gender, group, course
```

At least one `lapN` column is also required. Lap columns must be sequential without gaps or duplicates (`lap1, lap2, lap3...`); anything else is a top-level error rather than a silently accepted ordering.

If a required column is missing or a row has an empty required value, the application must show an error. That is better than silently guessing the group or course and producing incorrect analytics.

Row errors are collected in a single pass and shown as a list, not one by one: `normalizeRows` validates all rows, accumulates messages, and throws an error with an `issues` field, while `showCsvIssues` renders them as a list with row numbers. The user sees all problems at once and can fix the file in one go. Missing required columns are a separate top-level error (without `issues`), because per-row validation is pointless without the columns.

`place` accepts a positive integer or a fixed non-finish status (`DNF`, `DNS`, `DSQ`, case-insensitive — `normalizePlace`). Statuses are valid data: the participant is displayed, their place renders as the status, and in sorting they go after everyone with a numeric place (`place` is stored as `null`). Status records do not participate in official finish-gap and position calculations, even if they have intermediate splits. Any other value is an error, not a silent substitution. The status set is intentionally closed and without local synonyms, so a typo in `place` cannot pass as a "status".

## UI Behavior

Top area:

- brand;
- direct CSV link field;
- compact local file picker;
- language switcher (`RU`/`EN`).

Do not show a technical summary with the source file link in the header. Long Google Sheets URLs look like garbage and eat the first screen.

Filters:

- free search by `bib` or `name`;
- fixed selects `Event`, `Course`, `Group`;
- `Participants` and `Laps` metrics.

If the data contains only one `event` or `course`, the select may show that single option without the generic `All...`.

Table:

- sortable;
- the first column `Chart` with a star;
- the star in the table controls which participants appear on the charts;
- with no stars, charts show the top 10 by place;
- with stars, charts show only the starred participants within the current filter.

Participant card:

- record attributes are shown as a column, not as one line with separators;
- key stats: `Place`, `Finish` (or `Last split` for status records), `Gap`, `Best lap`, `Lap spread`;
- below — a short heuristic phrase about pace.

## Charts

Charts are built only when the selected scope is compatible by `course`.

Tabs:

- `Total time` — cumulative splits;
- `Laps` — computed lap times;
- `Position` — position per lap.

If all groups are selected, the total time and lap charts are allowed as course analytics. `Position` is shown only in the context of an official group, because position is computed within `event + course + group`.

Display modes:

- without stars — `Overview`: charts show a stable top 10 by place in the current selection, independent of table sorting;
- with stars — `Comparison`: charts show only the starred participants.

Lap axis labels and headers are short: `1`, `2`, `3`, not `Lap 1`.

## Active Chart Table

If 2+ participants are starred within the current filter, the application shows a table with the active tab's data under the chart.

Rules:

- comparison is available only within a single `course`;
- different `event`s and `group`s may be compared, because this is course analytics rather than official scoring;
- `Total time` — cumulative difference to the best of the starred at each split: `+0:12` means the participant was 12 seconds slower than the best at that split, `0:00` — best at that split;
- `Laps` — difference to the best lap among the starred on each lap;
- `Position` — per-split positions, the same values as on the chart;
- status records (`DNF`, `DNS`, `DSQ`) can be compared by their available intermediate splits.

## Pace Heuristics

Heuristics must be simple and must not look like "AI magic". Percentages are computed internally but never shown in the UI.

Values used:

- `firstLap` — first valid lap;
- `lastLap` — last valid lap;
- `bestLap` — best lap;
- `worstLap` — worst lap;
- `lapSpread = worstLap - bestLap`;
- `finishGap` — finish gap to the leader of the official group; it is a participant card stat, not a separate chart.

Finish phrase (English wording; Russian equivalents live in `I18N.ru`):

- if the last lap differs from the first by no more than 2%: `Finished at first-lap pace.`;
- if the last lap is more than 2% faster than the first: `Sped up toward the finish: the last lap was X faster than the first.`;
- if the last lap is more than 2% slower than the first: `Pace dropped toward the end: the last lap was X slower than the first.`;

Consistency phrase:

- `lapSpread / bestLap <= 3%`: `Lap times were very consistent.`;
- `<= 7%`: `Pace was fairly even.`;
- `> 7%`: `Pace was inconsistent.`;

Outlier:

- the slowest lap is compared to the average of the other laps;
- if it is more than 7% worse, `Slowest lap: N.` is added;
- the outlier is only computed with three or more valid laps.

## Localization

The interface is bilingual: Russian and English.

- All UI strings live in the `I18N` dictionary in `racelytics.lang.js` (`ru`, `en`), a plain script loaded before `app.js` (no fetch, so it also works over `file://`). The `t(key, params)` helper in `app.js` substitutes parameters into `{name}` placeholders. A dictionary value may be a function — used for Russian plural forms (`pluralRu` lives in the same file).
- Adding a language means adding one locale object to `racelytics.lang.js`: the header switcher (`.lang-switch`) is generated by `renderLangSwitch` from the dictionary keys, so no markup changes are needed.
- Static texts in `index.html` are marked with `data-i18n` (text), `data-i18n-placeholder`, and `data-i18n-aria-label` attributes; `applyTranslations` updates them along with `<html lang>`.
- The selected language is persisted in `localStorage` under the `racelytics.lang` key; the default comes from `navigator.language` (`ru*` — Russian, otherwise English).
- CSV error messages are produced in the language active at load time; switching the language does not re-translate an already shown error panel — a deliberate simplification.
- A participant's gender is stored as a key (`F`/`M`/`null` plus the raw value) and translated at render time (`formatGender`).
- Code comments are in English. This spec and `README.md` are in English; `CSV_GUIDE.md` is a guide for Russian-speaking protocol makers and stays in Russian.

## Current Limitations

- The CSV parser is simple but supports quotes and commas inside quoted fields.
- No XLSX import.
- Favorites are not preserved across loads.
- No backend or authorization.
- No automatic retrieval of data from private documents.
- `?src=` must point to a publicly accessible CSV or to a file next to the page.
- When opened via `file://`, remote CSVs may be subject to CORS/browser restrictions; use a local HTTP server for testing.

## Verification Scenario

Minimal check after changes:

1. Syntax check of `app.js` (e.g. `node --check app.js`).
2. Open the page via a local server, e.g. `http://127.0.0.1:4175/?src=results.csv`.
3. Confirm the table loads.
4. Check the `Event`, `Course`, `Group` filters.
5. In overview mode on a single course, confirm the time/lap charts render.
6. Select a single group and check `Position`.
7. Star participants in the table and confirm the charts show only the starred ones.
8. Check the participant card: place, finish, gap, best lap, spread, pace phrase.
9. Switch the language in the header: UI texts change, and the choice survives a page reload.
10. Check the mobile viewport: no horizontal scrolling of the whole page; the table may scroll internally.

## Review Checklist

When reviewing changes, watch for:

- whether the `event + course + group` model is broken;
- whether official places are mixed across different `event`s;
- whether provider-specific loaders appeared without need;
- whether long technical URLs are shown in the main UI;
- whether the empty state without a CSV behaves correctly;
- whether local file loading is broken;
- whether new UI strings are added to both `I18N` locales;
- whether pace heuristics turn into overconfident "insights";
- whether the mobile layout regressed.

## Key Code Locations

- `I18N`, `pluralRu` (in `racelytics.lang.js`) — translation dictionaries; `t`, `applyTranslations`, `setLang`, `renderLangSwitch` (in `app.js`) — language switching;
- `normalizeRows` — CSV reading, single-pass collection of all row errors, position and finish-gap calculation;
- `buildParticipant` — strict validation and normalization of one row into a participant;
- `normalizePlace` — `place` parsing: a positive integer or a `DNF`/`DNS`/`DSQ` status, otherwise an error;
- `showCsvIssues` — the list of all problem rows in the error panel;
- `computePositionsByGroup`, `computeLeadersByGroup`, `groupParticipants` — official positions and finish gaps by `scoreKey`;
- `renderEventOptions`, `renderCourseOptions`, `renderGroupOptions` — filters;
- `renderTable` — table and favorites;
- `renderCard` — participant card;
- `renderComparisonPanel`, `comparisonTableForActiveChart`, `comparisonRow` — the active chart's table data for starred participants;
- `renderCharts`, `withGroupMetrics`, `traces` — Plotly charts;
- `getTrend`, `getSlowLapOutlier` — heuristic phrases.
