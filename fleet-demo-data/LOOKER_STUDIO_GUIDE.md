# Looker Studio build guide: Santo Domingo fleet dashboards

No code needed. You will connect the CSVs, create a handful of calculated fields, and build four report pages.
Each page lists the charts and fields, plus the numbers it should show, so you can tell whether it's built correctly.
Allow 3 to 5 hours for all four pages.

## 0. Setup (30 minutes)

### Load the data
1. Open Google Sheets and import each CSV: File, then Import, then Upload, then "Create new spreadsheet". Name each sheet after its file, for example `fleet_route_runs`.
   - Alternative: in Looker Studio, use the **File Upload** connector. It's quicker but you can't edit the data afterwards.
2. In Looker Studio, choose Create, then Report, then add each sheet as a data source (**Google Sheets** connector).
3. For each data source, open **Edit data source** and check the field types:
   - `date`, `week` and similar fields should be **Date**. If one comes in as text, create a field `PARSE_DATE("%Y-%m-%d", date)` and use that.
   - `on_time` should be a **Number**. Its blanks (failed stops) must stay empty, because the on-time % formula relies on that.
   - `lat` and `lon` stay numeric (see the map field in section 5).
   - Set the default aggregation of measures like `actual_km` and `fuel_used_gal` to **Sum**. Keep ID fields as text.

### Data sources you need
| Source | Used in |
|---|---|
| `deliveries` | SLA page |
| `route_runs` | all pages |
| `drivers`, `vehicles` | names and vehicle details (blends) |
| `telematics_events` | safety and idling |
| `fuel_logs` | fuel anomaly |
| `tyre_pressure` | maintenance |

### Calculated fields to create
Create these once in the data source (Edit data source, then Add a field).

| Source | Name | Formula | Format |
|---|---|---|---|
| deliveries | On-time % | `AVG(on_time)` | Percent |
| deliveries | First-attempt success % | `COUNT_DISTINCT(CASE WHEN status = "Delivered" THEN delivery_id END) / COUNT_DISTINCT(delivery_id)` | Percent |
| deliveries | Late stops | `SUM(CASE WHEN on_time = 0 THEN 1 ELSE 0 END)` | Number |
| route_runs | km per gallon | `SUM(actual_km) / SUM(fuel_used_gal)` | Number, 1 decimal |
| route_runs | Fuel cost per km | `SUM(fuel_cost_dop) / SUM(actual_km)` | Number, 2 decimals |
| route_runs | Fuel cost per stop | `SUM(fuel_cost_dop) / SUM(completed_stops)` | Number, 1 decimal |
| route_runs | Stops per run | `SUM(completed_stops) / COUNT(run_id)` | Number, 1 decimal |
| route_runs | Idle min per run | `SUM(idle_minutes) / COUNT(run_id)` | Number, 0 decimals |
| tyre_pressure | Pressure ratio | `reading_bar / target_bar` | Percent |
| telematics_events | Map point | `CONCAT(CAST(lat AS TEXT), ",", CAST(lon AS TEXT))` | Type: Geo, Latitude, Longitude |

Always compute rates as a ratio of sums (like `km per gallon` above), not as the average of a per-run ratio column. Averaging ratios gives wrong numbers when runs differ in size. This is one of the first things a reviewer will check.

### Page controls (add to every page)
- **Date range control**, defaulting to the full period (1 Apr to 30 Sep 2026).
- Drop-down filters: **vehicle_type**, **route_id**, **driver_id**. Use only the ones relevant to each page.
- A small text box at the top left with the page's purpose, for example "Is the operation meeting its delivery promise, and where does it slip?"

---

## Page 1: SLA performance

**Question:** Are we meeting delivery promises, and where do we miss?

| Chart | Type | Setup |
|---|---|---|
| KPI tiles | Scorecards | On-time %, First-attempt success %, Late stops, total stops (`COUNT_DISTINCT(delivery_id)`) |
| On-time trend | Time series | Dimension: `date` (Year Month or Week); metric: On-time %; add a **reference line** at 94% |
| By service level | Bar | Dimension: `service_level`; metric: On-time %; reference lines at 94% (Standard) and 97% (Express) |
| By route | Bar, sorted ascending | Dimension: `route_id` (or `zone`); metric: On-time % |
| By weather | Bar | Needs `weather` from `route_runs`, so blend `deliveries` and `route_runs` on `run_id`; metric: On-time % |
| Failed attempts | Donut | Dimension: `failure_reason` (filter `status = Failed`); metric: record count |
| Late stops heatmap | Pivot table with heatmap | Rows: `route_id`; columns: weekday or hour; metric: Late stops |

**Expected values (full period, no filters):**
- On-time **93.1%**, first-attempt success **95.1%**, about **65,700** stops.
- Express **72.3%** (target 97%), Standard **98.3%** (target 94%).
- By weather: Clear **95.4%**, Rain **91.1%**, Storm **75.0%**.
- August is the weakest month at **91.7%**, because of the storm week.
- Weakest routes: BK-05 (Santo Domingo Norte) and the long-haul trucks, with BK-02 (Zona Colonial) hurt in the rain.

**Insight to write up:** Standard deliveries meet the SLA but Express fails by about 25 points. Recommend a tighter dispatch priority for Express, earlier departure on the Norte route, and a rain contingency for the Zona Colonial.

---

## Page 2: Driver scorecard

**Question:** Who needs coaching, who should be recognized, and who is ready for a bigger vehicle?

Build a blend called **Driver performance**:
- Source A: `route_runs` (join key `driver_id`; metrics: sum of `actual_km`, `fuel_used_gal`, `completed_stops`, `on_time_stops`).
- Source B: `telematics_events` (join key `driver_id`; metric: record count of `event_id`, filtered to `event_type` in harsh_braking, harsh_acceleration, speeding).
- Source C: `drivers` (join key `driver_id`; dimensions: `name`, `vehicle_type`, `shift_start`).
- Join type: **Left outer** from A. A blend aggregates each source before joining, so km won't be double counted.

Calculated fields on the blend:
- **Risky events per 100 km** = `SUM(event count) / SUM(actual_km) * 100`
- **Safety score** = `MAX(0, 100 - 5 * Risky events per 100 km)`
- **Punctuality** = `SUM(on_time_stops) / SUM(completed_stops) * 100`
- **Driver score** = `0.6 * Punctuality + 0.4 * Safety score`. The weights are your own choice, so explain them on the page.

| Chart | Type | Setup |
|---|---|---|
| Scorecard table | Table with heatmap | Rows: `name`, `vehicle_type`; metrics: Punctuality, Risky events per 100 km, km per gallon, Idle min per run, Driver score; sort by Driver score |
| Punctuality vs safety | Scatter | X: Punctuality; Y: Risky events per 100 km; bubble: driver; color: `vehicle_type` |
| Risky event mix | Stacked bar | Dimension: `name`; breakdown: `event_type`; metric: count |
| Recognition list | Table filtered to top 5 | Sort by Driver score descending |

**Expected values:**
- Fleet average **4.8** risky events per 100 km.
- The riskiest driver is **D12** at about **20.7**, followed by **D09** at about **11**.
- Weakest punctuality is among **D03 (84.9%)**, **D24**, **D23** and **D09 (88.2%)**. D23 and D24 are truck drivers on long-haul runs, so compare drivers only within a vehicle type.
- Best performers: **D05** and **D17**, with about 98% punctuality and very few risky events.

**Insight to write up:** Name 2 drivers for coaching (D12 for safety, D09 for both), 2 for recognition (D05, D17), and one for a vehicle step-up (D05 is a motorbike driver with the best punctuality and safety, so a natural candidate for a van; D17 plays that role for a van driver moving toward trucks). Note that you must compare like with like: a truck driver's punctuality is not comparable to a motorbike driver's.

---

## Page 3: Fuel and maintenance

**Question:** Where are we losing fuel, and which vehicles need attention?

| Chart | Type | Setup |
|---|---|---|
| KPI tiles | Scorecards | km per gallon, Fuel cost per km, total Fuel cost (`SUM(fuel_cost_dop)`), total Idle minutes |
| km per gallon by vehicle | Bar | Dimension: `vehicle_id`; metric: km per gallon; color or filter by `vehicle_type` (compare within a type) |
| V07 trend | Time series | Dimension: `date` (Year Month); metric: km per gallon; filter `vehicle_id = V07` |
| Idling by driver | Bar | Dimension: `driver_id`; metric: Idle min per run; filter to `vehicle_type = truck` |
| Planned vs actual km | Time series, two metrics | Sum of `planned_km` and `actual_km`; plus a table of `AVG(km_deviation_pct)` by driver |
| Fuel bought vs fuel used | Blend + table | See below |
| Tyre pressure | Pivot table with heatmap | Rows: `vehicle_id`, `position`; columns: week; metric: Pressure ratio; conditional format: below 90% amber, below 80% red |

**Fuel bought vs fuel used blend:**
- Source A: `fuel_logs` (join keys: `vehicle_id` and month of `date`; metric: sum of `gallons`).
- Source B: `route_runs` (join keys: `vehicle_id` and month of `date`; metric: sum of `fuel_used_gal`).
- Calculated field: **Bought / used** = `SUM(gallons) / SUM(fuel_used_gal)`.
- Filter or format so that anything above 110% is flagged red.

**Expected values:**
- Fleet km per gallon: motorbikes about **129.5**, vans about **39.9**, trucks about **13.4**.
- **V07** drops from about **131 to 105 km per gallon** (about 20%) from August onward (an engine issue).
- **D21** idles about **63 minutes per run**, against 20 to 26 for the other truck drivers.
- **V18** shows bought / used of about **127%** from August (about 99% before), which is a fuel-loss red flag.
- **V22** position RR2: pressure falls from 24 Aug to critical in mid-September, then recovers after 21 Sep.
- **D12** is the worst fuel performer among motorbike drivers, at about **111 km per gallon** against a motorbike average near 130.

**Insight to write up:** Propose an idling policy for trucks, an inspection for V07, a fuel-card audit and refill reconciliation for V18, and a weekly tyre-pressure alert for trucks. Estimate the savings, for example "if D21 idled like the other truck drivers, the fleet would save X gallons a month". Use the data to compute X.

---

## Page 4: Motorbike vs van vs truck

**Question:** What changes when a driver moves to a bigger vehicle?

| Chart | Type | Setup |
|---|---|---|
| Comparison table | Table | Rows: `vehicle_type`; metrics: Stops per run, km per run (`SUM(actual_km)/COUNT(run_id)`), km per gallon, Fuel cost per km, Fuel cost per stop, On-time %, Idle min per run |
| Fuel cost per stop | Bar | Dimension: `vehicle_type`; metric: Fuel cost per stop |
| On-time by type | Bar | Dimension: `vehicle_type`; metric: On-time % (blend with `deliveries`, join on `run_id`) |
| Long-haul routes | Table | Filter `vehicle_type = truck`; rows: `route_id`, `zone`; metrics: on-time %, Fuel cost per km, km per run |
| Corridor map | Google Maps bubble map | Source: `telematics_events`; field: Map point; filter: truck events; color by `event_type` |

**Expected values:**
- Fuel cost per km: motorbike about **DOP 2.24**, van about **DOP 6.14**, truck about **DOP 18.30**.
- Fuel cost per stop: motorbike about **DOP 4.6**, van about **DOP 37.9**, truck about **DOP 717**. The truck figure is high because each truck run has few stops across a very long distance. That is expected for long-haul loads and is not a flaw in the data.
- On-time %: van about **95.1%**, motorbike about **92.9%**, truck about **88.9%**. Trucks also have the most idle minutes per run (about 34, against 15 for the others).

**Caveat to state on the page:** this compares **fuel cost only**. A real comparison would add driver pay, maintenance, tolls, insurance and cargo volume per trip. Add a small note box saying so, and optionally add a Google Sheet with those assumptions as editable inputs.

**Insight to write up:** What a motorbike driver would need to learn to move to trucks: licence class, load and weight rules, trip planning for long corridors, idling discipline and fuel economy, and tyre checks.

---

## Finish and publish

1. **Consistency:** one color per vehicle type across all pages, and the same date range control on each page.
2. **Insights box:** on every page, add a text box titled "What I found / What I'd do", with three bullets from the insight notes above.
3. **Theme:** use a light theme with large readable numbers. Avoid more than 6 colors on a page.
4. **Sharing:** Share, then "Manage access", and choose "Anyone with the link can view". Test the link in a private browser window.
5. **Portfolio:** add the report link, one screenshot per page, and a one-paragraph summary to the profile. Say plainly that the data is synthetic.

## Checks before sharing
- [ ] Page 1 shows 93.1% on-time and about 65.7k stops with no filters.
- [ ] Page 2 puts D12 at the top of the risky-events list.
- [ ] Page 3 shows V18 above 120% bought / used from August, and V22's tyre dip.
- [ ] Page 4 compares vehicle types on rates (per km, per stop), not on totals.
- [ ] No filter is left on by accident when you publish.
- [ ] The synthetic-data disclaimer is visible on the first page.

## If something looks off
- **Percentages above 100% or tiny decimals:** set the field format to Percent, not Number.
- **Numbers doubled in a blend:** check that you selected the same join keys on both sides and don't mix totals from different grains.
- **Blank on-time:** `on_time` was imported as text, so change its type to Number.
- **Dates sorted alphabetically:** the date field is text, so convert it with `PARSE_DATE("%Y-%m-%d", date)`.
- **Map shows nothing:** the `Map point` field must be typed Geo, Latitude, Longitude.
