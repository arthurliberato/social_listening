"""Synthetic fleet data for a fictitious delivery operation (Northgate Logistics, demo only).
All names, places and numbers are made up. Re-run with: python3 generate_fleet_data.py
"""
import csv, math, random, os
from datetime import datetime, timedelta, date

random.seed(42)
OUT = os.path.dirname(os.path.abspath(__file__))
START, END = date(2026, 4, 1), date(2026, 9, 30)
CENTER = (40.0000, -4.0000)  # placeholder depot coordinates; edit to taste
STORM_WEEK = (date(2026, 7, 13), date(2026, 7, 19))

def clip(x, lo, hi): return max(lo, min(hi, x))
def poisson(lam):
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= random.random()
        if p <= L: return k
        k += 1
def fmt(dt): return dt.strftime("%Y-%m-%d %H:%M:%S")
def write(name, rows, fields):
    with open(os.path.join(OUT, name), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)
    print(f"{name}: {len(rows)} rows")

# ---------- routes (master) ----------
ZONES = ["Harbor Row","Maple Heights","Old Mill","Riverside","Northgate","Elm Park","Cedar Point",
         "Brookfield","Stonebridge","Lakeview","Foundry District","Westfield","Granite Hill"]
ROUTES = []  # route_id, type, zone, base_stops, base_km
for i in range(6):  ROUTES.append((f"BK-{i+1:02d}", "motorbike", ZONES[i], random.randint(20, 28), random.randint(38, 65)))
for i in range(4):  ROUTES.append((f"VN-{i+1:02d}", "van", ZONES[6+i], random.randint(16, 22), random.randint(70, 115)))
for i in range(3):  ROUTES.append((f"TR-{i+1:02d}", "truck", ZONES[10+i], random.randint(7, 11), random.randint(160, 290)))
ZONE_OFFSET = {z: (random.uniform(-.06, .06), random.uniform(-.08, .08)) for z in ZONES}
INTERVAL = {"motorbike": 11, "van": 17, "truck": 45}      # planned minutes between stops
VEH = {"motorbike": dict(n=14, rated=38, tank=12, fuel="petrol", idle=0.3, brake=2.0, accel=1.5, speed=2.5, shift=None),
       "van":       dict(n=6,  rated=11, tank=60, fuel="diesel", idle=1.0, brake=2.0, accel=1.2, speed=2.0, shift="07:30"),
       "truck":     dict(n=4,  rated=3.6, tank=300, fuel="diesel", idle=2.5, brake=1.0, accel=0.6, speed=1.5, shift="06:00")}
write("routes_master.csv", [dict(route_id=r, vehicle_type=t, zone=z, typical_stops=s, typical_km=k) for r,t,z,s,k in ROUTES],
      ["route_id","vehicle_type","zone","typical_stops","typical_km"])

# ---------- drivers & vehicles ----------
FIRST = ["Alex","Sam","Jordan","Maya","Luca","Nina","Omar","Elena","Tomas","Priya","Marco","Ines","Kofi","Lena","Diego",
         "Hana","Ravi","Sofia","Mateo","Aisha","Viktor","Clara","Jon","Mei"]
LAST = ["Alder","Brook","Castell","Dunmore","Ellery","Farrow","Garner","Holt","Ivers","Jarrow","Kestrel","Lowell",
        "Marsh","Norwood","Oakes","Pryce","Quill","Rowan","Sterling","Thorne","Underhill","Vance","Wren","Yarrow"]
random.shuffle(LAST)
drivers, vehicles = [], []
d_idx = v_idx = 0
for vt, spec in VEH.items():
    for _ in range(spec["n"]):
        d_idx += 1; v_idx += 1
        did, vid = f"D{d_idx:02d}", f"V{v_idx:02d}"
        shift = spec["shift"] or random.choice(["07:30", "12:30"])
        drv = dict(driver_id=did, name=f"{FIRST[d_idx-1]} {LAST[d_idx-1]}", vehicle_type=vt,
                   license_class={"motorbike":"A2","van":"B","truck":"C"}[vt],
                   hire_date=(date(2026,4,1) - timedelta(days=random.randint(120, 2600))).isoformat(),
                   shift_start=shift, home_depot="Central Depot", assigned_vehicle=vid,
                   # hidden behavior params
                   step=clip(random.gauss(0.7, 0.12), 0.45, 0.95), fuelf=random.gauss(1.0, 0.025),
                   evm=clip(random.gauss(1.0, 0.25), 0.5, 1.5), idlem=clip(random.gauss(1.0, 0.2), .6, 1.4),
                   detour=clip(random.gauss(0.03, 0.01), 0.01, 0.05))
        drivers.append(drv)
        rated = spec["rated"] * random.gauss(1, 0.04)
        vehicles.append(dict(vehicle_id=vid, vehicle_type=vt, fuel_type=spec["fuel"], tank_liters=spec["tank"],
                             rated_km_per_l=round(rated, 1), model_year=random.randint(2016, 2025),
                             odometer_start=random.randint(*{"motorbike":(8000,40000),"van":(30000,120000),"truck":(90000,350000)}[vt]),
                             maintenance_due=(date(2026,10,1)+timedelta(days=random.randint(5,120))).isoformat(),
                             _rated=rated))
D = {d["driver_id"]: d for d in drivers}
# planted patterns
for did, ch in {"D03": dict(step=1.35), "D09": dict(step=1.15, evm=1.8),     # weak punctuality (bikes)
                "D05": dict(step=0.15, evm=0.4, fuelf=1.05), "D17": dict(step=0.2, evm=0.5, fuelf=1.04),  # top performers
                "D12": dict(fuelf=0.88, evm=3.0, detour=0.10),                  # wasteful, risky
                "D21": dict(idlem=2.6)}.items():                                # truck idling
    D[did].update(ch)
write("drivers.csv", [{k: v for k, v in d.items() if k in ("driver_id","name","vehicle_type","license_class","hire_date","shift_start","home_depot","assigned_vehicle")} for d in drivers],
      ["driver_id","name","vehicle_type","license_class","hire_date","shift_start","home_depot","assigned_vehicle"])
write("vehicles.csv", [{k: v for k, v in x.items() if not k.startswith("_")} for x in vehicles],
      ["vehicle_id","vehicle_type","fuel_type","tank_liters","rated_km_per_l","model_year","odometer_start","maintenance_due"])
V = {v["vehicle_id"]: v for v in vehicles}

# ---------- price & weather ----------
def price(d, fuel):
    base = 1.72 if fuel == "petrol" else 1.58
    return base * (1 + 0.04 * math.sin((d - START).days / 28)) + random.gauss(0, 0.01)
def weather(d):
    if STORM_WEEK[0] <= d <= STORM_WEEK[1]: return "Storm" if d.weekday() in (1, 3) else "Rain"
    r = random.random(); return "Clear" if r < .72 else "Rain" if r < .97 else "Storm"
W_STEP = {"Clear": 0, "Rain": 0.3, "Storm": 0.8}; W_FUEL = {"Clear": 1, "Rain": .96, "Storm": .92}
W_FAIL = {"Clear": .04, "Rain": .06, "Storm": .10}; W_EV = {"Clear": 1, "Rain": 1.2, "Storm": 1.4}
FAIL_REASONS = ["Customer absent", "Address not found", "Access blocked", "Refused delivery"]

runs, deliveries, events = [], [], []
run_n = del_n = ev_n = 0
d = START
while d <= END:
    if d.weekday() == 6: d += timedelta(days=1); continue
    wx = weather(d)
    for di, drv in enumerate(drivers):
        if d.weekday() == 5 and di % 2: continue          # half the fleet works Saturdays
        if random.random() < 0.04: continue               # absence
        vt, vid = drv["vehicle_type"], drv["assigned_vehicle"]
        route = random.choice([r for r in ROUTES if r[1] == vt]); rid, _, zone, bstops, bkm = route
        spec, veh = VEH[vt], V[vid]
        run_n += 1; run_id = f"R{run_n:05d}"
        n = clip(bstops + random.randint(-2, 2), 4, 40)
        sh, sm = map(int, drv["shift_start"].split(":"))
        start = datetime(d.year, d.month, d.day, sh, sm) + timedelta(minutes=random.randint(0, 10))
        step_extra = {"motorbike": 0, "van": 0.35, "truck": 1.6}[vt] + W_STEP[wx] * (3 if rid == "BK-02" else 1) + (0.4 if rid == "BK-05" else 0)  # BK-02 rain-sensitive, BK-05 chronically late
        cum, on_time, failed, last = 0.0, 0, 0, start
        for i in range(1, n + 1):
            planned = start + timedelta(minutes=i * INTERVAL[vt])
            express = random.random() < .2; tol = 10 if express else 20
            cum = max(-6, 0.9 * cum + random.gauss(drv["step"] + step_extra, 2.0))
            at = planned + timedelta(minutes=cum); promised = planned + timedelta(minutes=tol)
            fail = random.random() < W_FAIL[wx]; last = at; del_n += 1
            if fail: failed += 1
            ot = None if fail else int(at <= promised); on_time += ot or 0
            deliveries.append(dict(delivery_id=f"DL{del_n:06d}", run_id=run_id, date=d.isoformat(), route_id=rid, zone=zone,
                driver_id=drv["driver_id"], vehicle_id=vid, stop_seq=i, service_level="Express" if express else "Standard",
                promised_by=fmt(promised), delivered_at=fmt(at), status="Failed" if fail else "Delivered",
                failure_reason=random.choice(FAIL_REASONS) if fail else "", on_time="" if ot is None else ot,
                minutes_vs_promise=round((at - promised).total_seconds() / 60, 1)))
        end = last + timedelta(minutes=INTERVAL[vt])
        pkm = round(bkm * n / bstops, 1)
        akm = round(pkm * (1 + drv["detour"] + (0.03 if wx != "Clear" else 0) + random.gauss(0, 0.015)), 1)
        # telematics events
        k100 = akm / 100; evm = drv["evm"] * W_EV[wx]; idle_min = 0
        lo, hi = (8, 30) if vt == "truck" else (5, 18)
        spans = (end - start).total_seconds()
        def ev(etype, val, unit):
            global ev_n; ev_n += 1
            zo = ZONE_OFFSET[zone]
            events.append(dict(event_id=f"EV{ev_n:06d}", run_id=run_id, driver_id=drv["driver_id"], vehicle_id=vid,
                event_time=fmt(start + timedelta(seconds=random.uniform(0, spans))), event_type=etype, value=val, unit=unit,
                lat=round(CENTER[0] + zo[0] + random.gauss(0, .01), 5), lon=round(CENTER[1] + zo[1] + random.gauss(0, .01), 5)))
        for _ in range(poisson(spec["brake"] * k100 * evm)): ev("harsh_braking", round(random.uniform(.35, .7), 2), "g")
        for _ in range(poisson(spec["accel"] * k100 * evm)): ev("harsh_acceleration", round(random.uniform(.3, .6), 2), "g")
        for _ in range(poisson(spec["speed"] * k100 * evm)): ev("speeding", random.randint(5, 30), "km/h over limit")
        for _ in range(poisson(1.2 * drv["idlem"] * (1.2 if wx != "Clear" else 1))):
            m = random.randint(lo, hi); idle_min += m; ev("excessive_idling", m, "min")
        rated = veh["_rated"] * (0.78 if (vid == "V07" and d >= date(2026, 8, 1)) else 1)   # V07 develops an engine issue
        kml = rated * drv["fuelf"] * W_FUEL[wx] * random.gauss(1, .025)
        fuel = akm / kml + idle_min / 60 * spec["idle"]
        runs.append(dict(run_id=run_id, date=d.isoformat(), weekday=d.strftime("%a"), route_id=rid, zone=zone, driver_id=drv["driver_id"],
            vehicle_id=vid, vehicle_type=vt, weather=wx, start_time=fmt(start), end_time=fmt(end), planned_stops=n,
            completed_stops=n - failed, failed_stops=failed, on_time_stops=on_time,
            on_time_pct=round(100 * on_time / max(1, n - failed), 1), planned_km=pkm, actual_km=akm,
            km_deviation_pct=round(100 * (akm - pkm) / pkm, 1), idle_minutes=idle_min, fuel_used_l=round(fuel, 2),
            km_per_l=round(akm / fuel, 2), fuel_cost_est=round(fuel * price(d, spec["fuel"]), 2)))
    d += timedelta(days=1)

write("route_runs.csv", runs, list(runs[0].keys()))
write("deliveries.csv", deliveries, list(deliveries[0].keys()))
write("telematics_events.csv", events, list(events[0].keys()))

# ---------- fuel logs (refills reconstructed from consumption; V18 gets a planted mismatch) ----------
STATIONS = ["Northgate Fuel", "Riverside Pump", "Highway 9 Services", "Central Depot Tank"]
logs, fl = [], 0
for v in vehicles:
    acc, odo = 0.0, v["odometer_start"]
    for r in sorted((r for r in runs if r["vehicle_id"] == v["vehicle_id"]), key=lambda r: r["run_id"]):
        acc += r["fuel_used_l"]; odo += r["actual_km"]
        if acc >= 0.7 * v["tank_liters"]:
            dd = date.fromisoformat(r["date"]); liters = acc * random.gauss(1, .01)
            if v["vehicle_id"] == "V18" and dd >= date(2026, 8, 1): liters *= 1.28
            p = price(dd, v["fuel_type"]); fl += 1
            logs.append(dict(fuel_log_id=f"FL{fl:05d}", date=dd.isoformat(), vehicle_id=v["vehicle_id"], station=random.choice(STATIONS),
                             liters=round(liters, 1), price_per_l=round(p, 3), total_cost=round(liters * p, 2), odometer_km=int(odo)))
            acc = 0.0
write("fuel_logs.csv", logs, list(logs[0].keys()))

# ---------- tyre pressure (weekly) ----------
POS = {"motorbike": ["F", "R"], "van": ["FL", "FR", "RL", "RR"], "truck": ["FL", "FR", "RL1", "RL2", "RR1", "RR2"]}
TGT = {"motorbike": 2.2, "van": 3.2, "truck": 8.0}
tyres, w = [], START
while w <= END:
    for v in vehicles:
        for pos in POS[v["vehicle_type"]]:
            t = TGT[v["vehicle_type"]]; f = random.gauss(0.99, 0.02)
            if v["vehicle_id"] == "V22" and pos == "RR2":                      # slow leak, fixed 21 Sep
                if date(2026, 8, 24) <= w < date(2026, 9, 21): f = 0.99 - 0.075 * ((w - date(2026, 8, 24)).days / 7 + 1)
            if random.random() < .01: f = random.uniform(.8, .88)
            rd = round(t * f, 2); ratio = rd / t
            tyres.append(dict(date=w.isoformat(), vehicle_id=v["vehicle_id"], position=pos, target_bar=t, reading_bar=rd,
                              status="OK" if ratio >= .9 else "LOW" if ratio >= .8 else "CRITICAL"))
    w += timedelta(days=7)
write("tyre_pressure.csv", tyres, list(tyres[0].keys()))

# ---------- GPS pings for a handful of sample runs ----------
pings = []
for vt in ("motorbike", "van", "truck"):
    for r in [x for x in runs if x["vehicle_type"] == vt and x["date"] >= "2026-09-15"][:4]:
        st, en = datetime.fromisoformat(r["start_time"]), datetime.fromisoformat(r["end_time"])
        zo = ZONE_OFFSET[r["zone"]]; tank = VEH[vt]["tank"]; lvl = random.uniform(70, 95); t = st; i = 0
        total = max(1, (en - st).total_seconds() / 120)
        while t <= en:
            frac = i / total; wob = math.sin(frac * math.pi * 6) * .01
            lat = CENTER[0] + zo[0] * math.sin(min(1, frac * 2) * math.pi / 2 if frac < .5 else (1 - frac) * math.pi) + wob + random.gauss(0, .001)
            lon = CENTER[1] + zo[1] * math.sin(min(1, frac * 2) * math.pi / 2 if frac < .5 else (1 - frac) * math.pi) + wob + random.gauss(0, .001)
            stopped = random.random() < .18
            pings.append(dict(run_id=r["run_id"], vehicle_id=r["vehicle_id"], ping_time=fmt(t), lat=round(lat, 5), lon=round(lon, 5),
                              speed_kmh=0 if stopped else round(random.uniform(12, 55 if vt != "truck" else 80), 0), ignition="on",
                              fuel_level_pct=round(lvl - frac * 100 * float(r["fuel_used_l"]) / tank, 1)))
            t += timedelta(minutes=2); i += 1
write("gps_pings_sample.csv", pings, list(pings[0].keys()))
