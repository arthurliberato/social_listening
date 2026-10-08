# Demo fleet dataset: Santo Domingo, Punta Cana and Santiago

Fictitious delivery operation based at a "Central Depot" in Greater Santo Domingo, 1 Apr to 30 Sep 2026.
The company, drivers and customers are invented.

What is realistic:
- Zone coordinates are approximate area centers (lat, lon) in the Dominican Republic.
- Rain is more likely from May, and there is a tropical-storm week in August.

What is modeled, not measured:
- Distances are approximations, not driven on a road network.
- GPS trails for trucks run in a straight line along the corridor.
- Fuel prices are illustrative DOP per US gallon, not official prices.
- Public holidays are not modeled.

Units: km, US gallons, DOP, bar.

Fleet: 24 drivers and 24 vehicles (14 motorbikes, 6 vans, 4 trucks), 13 routes, Mon to Sat.
Regenerate with `python3 generate_fleet_data.py` (seeded, so the output is identical every run).

## Routes
| Type | Route | Zone |
|---|---|---|
| Motorbike | BK-01 to BK-06 | Distrito Nacional, Zona Colonial, Santo Domingo Este, Oeste, Norte, Los Alcarrizos |
| Van | VN-01 to VN-04 | Boca Chica, San Cristóbal, Villa Altagracia, Haina |
| Truck | TR-01 / TR-02 / TR-03 | Punta Cana-Bávaro / Santiago / La Romana (long-haul, out and back) |

## Tables
| File | Rows | Grain | Key columns |
|---|---|---|---|
| `drivers.csv` | 24 | one per driver | driver_id, vehicle_type, license_class, shift_start, assigned_vehicle |
| `vehicles.csv` | 24 | one per vehicle | vehicle_id, fuel_type, tank_gallons, rated_km_per_gal, maintenance_due |
| `routes_master.csv` | 13 | one per route | route_id, zone, typical_stops, typical_km |
| `route_runs.csv` | ~3.3k | one per driver per day | run_id, date, weather, planned/actual_km, idle_minutes, fuel_used_gal, km_per_gal, fuel_cost_dop, on_time_pct |
| `deliveries.csv` | ~65k | one per stop | run_id, service_level, promised_by, delivered_at, status, on_time, minutes_vs_promise |
| `telematics_events.csv` | ~22k | one per event | run_id, event_type (harsh_braking, harsh_acceleration, speeding, excessive_idling), value, lat, lon |
| `fuel_logs.csv` | ~650 | one per refill | vehicle_id, gallons, price_per_gal_dop, total_cost_dop, odometer_km |
| `tyre_pressure.csv` | ~2k | weekly per tyre | vehicle_id, position, target_bar, reading_bar, status |
| `gps_pings_sample.csv` | ~2.8k | one per ping, 12 sample runs only | run_id, ping_time, lat, lon, speed_kmh, fuel_level_pct |

Joins: `driver_id`, `vehicle_id`, `route_id` and `run_id` link the tables.

## KPI definitions
- **On-time delivery:** `on_time = 1` when `delivered_at <= promised_by`. Failed attempts are excluded.
- **First-attempt success:** share of stops with `status = Delivered`.
- **SLA targets:** Standard 94%, Express 97%. Express has a 10-minute window and Standard has a 20-minute window.
- **Fuel efficiency:** `km_per_gal = actual_km / fuel_used_gal`. Idle fuel is included. Divide by 3.785 for km/l.
- **Driver safety score:** harsh braking, harsh acceleration and speeding events per 100 km.

## Planted findings for the dashboards to uncover
These are the answers. Don't show them in the dashboards themselves.
1. **Weak punctuality:** D03 and D09 (motorbikes) run well below the rest.
2. **Top performers:** D05 and D17 have the best punctuality, the fewest risky events and good fuel economy.
3. **Late route:** BK-05 (Santo Domingo Norte) is chronically late and BK-02 (Zona Colonial) degrades in the rain.
4. **Storm week:** 17 to 23 Aug shows an on-time dip across the whole fleet.
5. **Risky and wasteful driver:** D12 has about 3 times the risky events and clearly worse km/gal than comparable riders.
6. **Idling:** truck driver D21 idles about 2.6 times more than the other truck drivers.
7. **Engine issue:** V07's km/gal drops about 20% from 1 Aug.
8. **Possible fuel loss:** V18 buys about 28% more fuel than its trips explain from 1 Aug (compare `fuel_logs` with `route_runs.fuel_used_gal`).
9. **Tyre leak:** V22 position RR2 loses pressure from 24 Aug and is fixed on 21 Sep.
10. **Long-haul economics:** compare cost per stop and per km across motorbike, van and truck, and the on-time gap on the Santiago and Punta Cana runs (TR-01 to TR-03).

## Loading into Google Sheets and Looker Studio
1. In Google Sheets, use File, then Import, then Upload for each CSV and choose "Create new spreadsheet". Files are UTF-8, so accented names import correctly. `deliveries.csv` is about 8 MB and imports fine.
2. In Looker Studio, add each sheet as a data source.
3. Set date fields to type Date and datetime fields to Date & Time.
4. Set `lat` and `lon` to a Latitude, Longitude geo field if you want a map.
5. Use Blend Data to join `route_runs` with `drivers` and `vehicles`.
