"""Build data/city_timelines.json from HCD Annual Progress Report Table A2.

Source: HCD Housing Element APR data, Table A2 (entitlements, building permits,
certificates of occupancy), served by data.ca.gov's CKAN datastore.
Resource id fe505d9b-8c36-42ba-ba30-08bc4f34e022.

Gotcha: each date is only filled in the APR year it happened, so one project
spans several rows across years. We join rows on (jurisdiction, APN), falling
back to the local tracking id when the APN is blank, and take the earliest date
of each kind.

Run:  python delay/build_timelines.py            (uses raw/ cache if present)
      python delay/build_timelines.py --refresh  (re-downloads, ~54k rows)
"""
import json
import os
import statistics as st
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date

RESOURCE = "fe505d9b-8c36-42ba-ba30-08bc4f34e022"
API = "https://data.ca.gov/api/3/action/datastore_search_sql"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "raw", "apr_a2_orange.json")
OUT = os.path.join(ROOT, "data", "city_timelines.json")
CHECKED = "2026-11-07"
MIN_N = 10       # below this we flag low confidence
MIN_SHOW = 5     # below this we say "unknown"
MAX_MONTHS = 120 # drop data-entry outliers longer than 10 years


def download():
    fields = ('"_id","JURIS_NAME","YEAR","APN","JURS_TRACKING_ID","UNIT_CAT","TENURE",'
              '"ENT_APPROVE_DT1","BP_ISSUE_DT1","CO_ISSUE_DT1","NO_ENTITLEMENTS",'
              '"NO_BUILDING_PERMITS","APPROVE_SB35"')
    rows, off = [], 0
    while True:
        sql = (f'SELECT {fields} FROM "{RESOURCE}" WHERE "CNTY_NAME"=\'Orange\' '
               f'ORDER BY "_id" LIMIT 10000 OFFSET {off}')
        url = API + "?" + urllib.parse.urlencode({"sql": sql})
        req = urllib.request.Request(url, headers={"User-Agent": "impactlab-hackathon"})
        data = json.load(urllib.request.urlopen(req, timeout=120))
        recs = data["result"]["records"]
        rows += recs
        if len(recs) < 10000:
            break
        off += 10000
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(rows, open(CACHE, "w"))
    return rows


def parse(s):
    try:
        return date.fromisoformat(s[:10]) if s else None
    except ValueError:
        return None


def months(a, b):
    return (b - a).days / 30.44


def summarize(vals):
    vals = sorted(vals)
    n = len(vals)
    if n < MIN_SHOW:
        return {"median": None, "n": n, "p25": None, "p75": None, "confidence": "unknown"}
    q = st.quantiles(vals, n=4)
    return {"median": round(st.median(vals), 1), "n": n, "p25": round(q[0], 1),
            "p75": round(q[2], 1), "confidence": "ok" if n >= MIN_N else "low"}


def main():
    rows = download() if ("--refresh" in sys.argv or not os.path.exists(CACHE)) else json.load(open(CACHE))
    proj = defaultdict(lambda: {"ent": None, "bp": None, "co": None, "cat": set(), "units": 0})
    for r in rows:
        apn = (r["APN"] or "").strip()
        key = apn if apn and apn.upper() not in ("N/A", "NA", "0") else "T:" + str(r["JURS_TRACKING_ID"])
        p = proj[(r["JURIS_NAME"], key)]
        for f, col in (("ent", "ENT_APPROVE_DT1"), ("bp", "BP_ISSUE_DT1"), ("co", "CO_ISSUE_DT1")):
            v = parse(r[col])
            if v and (p[f] is None or v < p[f]):
                p[f] = v
        p["cat"].add(r["UNIT_CAT"])
        p["units"] += r["NO_BUILDING_PERMITS"] or 0

    def span(ps, a, b):
        out = []
        for p in ps:
            if p[a] and p[b]:
                m = months(p[a], p[b])
                if 0 <= m <= MAX_MONTHS:
                    out.append(m)
        return out

    cities = []
    for city in sorted({j for j, _ in proj}):
        ps = [p for (j, _), p in proj.items() if j == city]
        homes = [p for p in ps if not p["cat"] <= {"ADU"}]
        adus = [p for p in ps if p["cat"] <= {"ADU"}]
        cities.append({
            "city": city.title() if city != "ORANGE COUNTY" else "Unincorporated Orange County",
            "juris_name": city,
            "projects_joined": len(ps),
            "approval_to_permit": summarize(span(homes, "ent", "bp")),
            "permit_to_completion": summarize(span(homes, "bp", "co")),
            "approval_to_completion": summarize(span(homes, "ent", "co")),
            "adu_approval_to_permit": summarize(span(adus, "ent", "bp")),
        })

    out = {
        "about": ("Median months between milestones for housing projects in each Orange County "
                  "jurisdiction, computed from HCD Annual Progress Report Table A2. Non-ADU projects "
                  "only unless the field says adu. Months = days / 30.44."),
        "source": "HCD Housing Element Annual Progress Report, Table A2, via data.ca.gov",
        "source_url": "https://data.ca.gov/dataset/housing-element-annual-progress-report-apr-data-by-jurisdiction-and-year",
        "resource_id": RESOURCE,
        "rows_read": len(rows),
        "projects_joined": len(proj),
        "method": "Rows joined across APR years on (jurisdiction, APN), tracking id fallback; earliest date of each milestone kept; spans of 0 to 120 months kept.",
        "limits": [
            "Starts at entitlement approval. Time from application to approval (often the longest wait) is not in Table A2.",
            "Cities report differently; some record entitlement and permit on the same day, which shows as 0 months.",
            "Mixes tenures and project sizes. Fewer than 5 projects shows as unknown; 5 to 9 is flagged low confidence.",
        ],
        "checked": CHECKED,
        "cities": cities,
    }
    json.dump(out, open(OUT, "w"), indent=1)
    print(f"wrote {OUT}: {len(cities)} jurisdictions from {len(rows)} rows / {len(proj)} projects")


if __name__ == "__main__":
    main()
