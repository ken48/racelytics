# Racelytics

A lightweight static CSV dashboard for lap and pace analysis.

## Usage

Open `index.html` directly or serve the folder with any static server.

Data can be loaded in these ways:

- `?src=https://example.com/results.csv`
- the `CSV file link` field
- local file upload

The interface language (Russian/English) is switched with the `RU`/`EN` buttons in the header; the choice is remembered by the browser.

## Google Sheets

> Preparing data without being a programmer? See the step-by-step guide for protocol makers (in Russian): [CSV_GUIDE.md](CSV_GUIDE.md) — focused on Google Sheets.

A convenient option for a live protocol is to keep the table in Google Sheets and give Racelytics the link to its CSV export.

The most reliable way:

1. Create a sheet with the required columns.
2. Open `File` → `Share` → `Publish to web`.
3. Pick the sheet you need.
4. Publish format: `CSV`.
5. Copy the published link and paste it into the `CSV file link` field.

The link usually looks something like this:

```text
https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?gid=0&single=true&output=csv
```

The same link can be passed via `?src=`:

```text
https://your-site.example/racelytics/?src=https%3A%2F%2Fdocs.google.com%2Fspreadsheets%2Fd%2Fe%2F2PACX-...%2Fpub%3Fgid%3D0%26single%3Dtrue%26output%3Dcsv
```

If the sheet is simply shared by link, the short export link sometimes works too:

```text
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv&gid=0
```

For a public dashboard, prefer the `Publish to web` option: it doesn't require viewers to have an account and is more reliable as a remote CSV.

Expected columns:

```csv
event,place,bib,name,gender,group,course,lap1,lap2,lap3,lap4
2026-06-07,1,104,Maya Chen,Ж,Ж 2 круга,Лыжероллерный круг 1.2 км,4:12,8:19,,
2025-06-08,1,117,Luca Rossi,Ж,Ж 2 круга,Лыжероллерный круг 1.2 км,4:18,8:31,,
2026-06-07,1,217,Luca Rossi,М,М 4 круга,Лыжероллерный круг 1.2 км,4:10,8:26,12:39,16:58
```

`event` is a specific competition, date, or protocol. For example `2026-06-07`, `Control training 2026`, `Club cup 2025`. Place, finish gap, and position are computed separately within `event + course + group`. Column aliases are also supported: `race`, `competition`, `date`, `соревнование`, `гонка`, `старт`, `дата`, `протокол`.

`gender` is an attribute of the participant. You can pass `M/F`, `male/female`, `м/ж`, `мужчины/женщины`.

`group` is the result scoring group: for example `Ж`, `М`, `U18`, `Open`. Don't put the year into the group name — that's what `event` is for. Column aliases are also supported: `group_id`, `category`, `division`, `class`, `wave`, `зачет`, `группа`, `класс`, `категория`.

`course` defines course/distance compatibility for charts: for example `Лыжероллерный круг 1.2 км`, `A loop`, `B loop`. Participants with different `course` values cannot be drawn together on one chart correctly. If the course is the same across years, keep the same `course`: the application can then compare pace on the course while official places stay separated by `event`. Aliases are also supported: `course_id`, `track`, `route`, `distance`, `трасса`, `дистанция`, `маршрут`.

The columns `event`, `place`, `bib`, `name`, `gender`, `group`, `course` are required. If one of them is missing or a row has an empty value, the file is considered invalid.

`place` is a positive integer (place within the group) or a fixed non-finish status: `DNF`, `DNS`, `DSQ` (case-insensitive). Participants with a status are shown in the table and sorted after everyone with a numeric place. They do not affect official positions in the group. Any other value in `place` is treated as an error, not guessed.

UI rules:

- `All courses`: table and summary only, charts are hidden.
- One `course`, all events and all groups: without stars, charts work in `Overview` mode and show a stable top 10 by place in the current selection.
- One `course` and one `group`: position is available, computed separately within each `event`.
- If at least one participant is starred, charts switch to `Comparison` mode and show only the starred ones. With 2+ participants, a comparison table appears under the active chart: for total time — the difference to the best of the starred at each split, for laps — the difference to the best starred lap on each lap, for position — the same series as on the chart.

The columns `lap1`, `lap2`, `lap3` and so on contain cumulative time splits at the end of each lap, not lap durations. For example `lap2=8:19` means the participant completed two laps in 8 minutes 19 seconds. The application computes each lap duration as the difference between adjacent splits.

Time format in the CSV: `[HH:]MM:SS`, for example `4:12`, `18:56`, `1:02:03`. Seconds without a colon are not supported.
