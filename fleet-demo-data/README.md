# Northgate Logistics: synthetic fleet dataset

Fictitious delivery operation, 1 Apr to 30 Sep 2026. All names, places and numbers are made up.
Units are km, liters and bar. Prices are in an unnamed currency.

Fleet: 24 drivers and 24 vehicles (14 motorbikes, 6 vans, 4 trucks), 13 routes, Mon to Sat.
Regenerate with `python3 generate_fleet_data.py` (seeded, so the output is identical every run).

## Tables
| File | Rows | Grain | Key columns |
|---|---|---|---|
| `drivers.csv` | 24 | one per driver | driver_id, vehicle_type, license_class, shift_start, assigned_vehicle |
| `vehicles.csv` | 24 | one per vehicle | vehicle_id, fuel_type, tank_liters, rated_km_per_l, maintenance_due |
| `routes_master.csv` | 13 | one per route | route_id, zone, typical_stops, typical_km |
| `route_runs.csv` | ~3.3k | one per driver per day | run_id, date, weather, planned/actual_km, idle_minutes, fuel_used_l, km_per_l, on_time_pct |
| `deliveries.csv` | ~65k | one per stop | run_id, service_level, promised_by, delivered_at, status, on_time, minutes_vs_promise |
| `telematics_events.csv` | ~21k | one per event | run_id, event_type (harsh_braking, harsh_acceleration, speeding, excessive_idling), value, lat, lon |
| `fuel_logs.csv` | ~590 | one per refill | vehicle_id, liters, price_per_l, odometer_km |
| `tyre_pressure.csv` | ~2k | weekly per tyre | vehicle_id, position, target_bar, reading_bar, status |
| `gps_pings_sample.csv` | ~2k | one per ping, 12 sample runs only | run_id, ping_time, lat, lon, speed_kmh, fuel_level_pct |

Joins: `driver_id`, `vehicle_id`, `route_id` and `run_id` link the tables.

## KPI definitions
- **On-time delivery:** `on_time = 1` when `delivered_at <= promised_by`. Failed attempts are excluded.
- **First-attempt success:** share of stops with `status = Delivered`.
- **SLA targets:** Standard 94%, Express 97%. Express has a 10-minute window and Standard has a 20-minute window.
- **Fuel efficiency:** `km_per_l = actual_km / fuel_used_l`. Idle fuel is included.
- **Driver safety score:** harsh braking, harsh acceleration and speeding events per 100 km.

## Planted findings for the dashboards to uncover
These are the answers. Don't show them in the dashboards themselves.
1. **Weak punctuality:** D03 and D09 (motorbikes) run well below the rest.
2. **Top performers:** D05 and D17 have the best punctuality, the fewest risky events and good fuel economy.
3. **Late route:** BK-05 is chronically late and BK-02 degrades in the rain.
4. **Storm week:** 13 to 19 Jul shows an on-time dip across the whole fleet.
5. **Risky and wasteful driver:** D12 has about 3 times the risky events and clearly worse km/l than comparable riders.
6. **Idling:** truck driver D21 idles about 2.6 times more than the other truck drivers.
7. **Engine issue:** V07's km/l drops about 20% from 1 Aug.
8. **Possible fuel loss:** V18 buys about 29% more fuel than its trips explain from 1 Aug (compare `fuel_logs` with `route_runs.fuel_used_l`).
9. **Tyre leak:** V22 position RR2 loses pressure from 24 Aug and is fixed on 21 Sep.
10. **Vehicle class economics:** compare cost per stop and per km across motorbike, van and truck.

## Loading into Google Sheets and Looker Studio
1. In Google Sheets, use File, then Import, then Upload for each CSV and choose "Create new spreadsheet". `deliveries.csv` is about 8 MB and imports fine.
2. In Looker Studio, add each sheet as a data source.
3. Set date fields to type Date and datetime fields to Date & Time.
4. Use Blend Data to join `route_runs` with `drivers` and `vehicles`.
