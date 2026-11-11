"""Write data/income_limits.json, data/pmms.json and data/programs.json.

Income limits were read from the HCD PDFs (page numbers below) on 2026-11-07.
Rates come from the Freddie Mac PMMS history CSV (data/pmms.csv, committed).
Program terms were read on each program's own page on 2026-11-07.
"""
import csv
import json
import os
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "data")
CHECKED = "2026-11-07"

income = {
    "county": "Orange",
    "checked": CHECKED,
    "tables": {
        "state": {
            "name": "HCD 2026 State Income Limits (Revised)",
            "revision_date": "2026-06-23",
            "replaces": "2026 State Income Limits dated 2026-05-29",
            "source_url": "https://www.hcd.ca.gov/sites/default/files/docs/grants-and-funding/income-limits-2026.pdf",
            "page": 11,
            "area_median_income_4p": 138600,
            "by_household_size": {
                "extremely_low": [27600, 31550, 35500, 39400, 42600, 45750, 50040, 55720],
                "very_low": [65150, 74450, 83750, 93050, 100500, 107950, 115400, 122850],
                "low": [104200, 119100, 134000, 148850, 160800, 172700, 184600, 196500],
                "median": [97000, 110900, 124750, 138600, 149700, 160800, 171850, 182950],
                "moderate": [116400, 133050, 149650, 166300, 179600, 192900, 206200, 219500],
            },
            "note": "In the PDF text layer the 4-person median (138,600) prints at the end of the row; it is placed at index 3 here, matching the stated Area Median Income.",
        },
        "home": {
            "name": "HCD 2026 State HOME Income Limits",
            "revision_date": "2026-06-01",
            "source_url": "https://www.hcd.ca.gov/sites/default/files/docs/grants-and-funding/2026-california-HOME-income-limits_0.pdf",
            "page": 2,
            "by_household_size": {
                "very_low_50": [65150, 74450, 83750, 93050, 100500, 107950, 115400, 122850],
                "low_80": [104200, 119100, 134000, 148850, 160800, 172700, 184600, 196500],
            },
        },
    },
}

# Health and Safety Code 50052.5(b), owner-occupied housing assisted on or after 1991-01-01.
statute = {
    "section": "Health and Safety Code 50052.5(b)",
    "url": "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=HSC&sectionNum=50052.5",
    "read_via": "https://codes.findlaw.com/ca/health-and-safety-code/hsc-sect-50052-5/ (leginfo blocks scripts)",
    "checked": CHECKED,
    "bands": {
        "extremely_low": {"label": "Extremely low income", "share": 0.30, "ami_mult": 0.30, "max_ami": 30, "cite": "50052.5(b)(1)",
                          "quote": "the product of 30 percent times 30 percent of the area median income adjusted for family size appropriate for the unit"},
        "very_low": {"label": "Very low income", "share": 0.30, "ami_mult": 0.50, "max_ami": 50, "cite": "50052.5(b)(2)",
                     "quote": "the product of 30 percent times 50 percent of the area median income adjusted for family size appropriate for the unit"},
        "low": {"label": "Lower income (to 80% AMI)", "share": 0.30, "ami_mult": 0.70, "max_ami": 80, "cite": "50052.5(b)(3)",
                "quote": "the product of 30 percent times 70 percent of the area median income adjusted for family size appropriate for the unit"},
        "moderate": {"label": "Moderate income (to 120% AMI)", "share": 0.35, "ami_mult": 1.10, "max_ami": 120, "cite": "50052.5(b)(4)",
                     "quote": "nor exceed the product of 35 percent times 110 percent of area median income adjusted for family size appropriate for the unit"},
    },
    "family_size_rule": "Family size appropriate for the unit = bedrooms + 1 (HCD regulation, 25 CCR 6932). Treat as ASSUMPTION until checked against the regulation text.",
}
income["statute"] = statute

# PMMS
rows = []
with open(os.path.join(D, "pmms.csv"), newline="") as f:
    for r in csv.DictReader(f):
        if r.get("pmms30"):
            dt = datetime.strptime(r["date"], "%m/%d/%Y").date()
            rows.append({"date": dt.isoformat(), "rate30": float(r["pmms30"])})
rows.sort(key=lambda x: x["date"])
pmms = {
    "source": "Freddie Mac Primary Mortgage Market Survey (PMMS), 30-year fixed",
    "source_url": "https://www.freddiemac.com/pmms/docs/PMMS_history.csv",
    "checked": CHECKED,
    "latest": rows[-1],
    "weekly_last_2y": rows[-104:],
}

programs = {
    "checked": CHECKED,
    "note": "Only amounts read on the program's own page are counted. 'unknown' amounts are listed but never added to the stack.",
    "programs": [
        {"id": "santa_ana_mfh", "name": "Santa Ana My First Home", "type": "buyer",
         "amount": {"kind": "fixed", "value": 120000}, "terms": "Up to $120,000, 0% interest, 30 or 45-year deferred loan",
         "max_ami": 80, "cities": ["SANTA ANA"], "status": "confirmed",
         "status_note": "Page says applications are open, currently only for 80% AMI households.",
         "source_url": "https://santa-ana.org/my-first-home"},
        {"id": "fhlb_wish", "name": "FHLBank San Francisco WISH", "type": "buyer",
         "amount": {"kind": "fixed", "value": 32837}, "terms": "2026: up to $32,837 matching grant for first-time buyers at or below 80% of HUD AMI",
         "max_ami": 80, "cities": None, "status": "funds_unconfirmed",
         "status_note": "Allocated through participating member banks; confirm the buyer's lender still has 2026 WISH funds.",
         "source_url": "https://fhlbsf.com/products/community-programs-grants/wish"},
        {"id": "calhfa_myhome", "name": "CalHFA MyHome", "type": "buyer",
         "amount": {"kind": "pct_price", "value": 0.035}, "terms": "Deferred junior loan up to the lesser of 3.5% of price (FHA) or 3% (conventional)",
         "max_ami": None, "cities": None, "status": "confirmed",
         "status_note": "Program page live. CalHFA income limits apply (not modeled; check the CalHFA table).",
         "source_url": "https://www.calhfa.ca.gov/homebuyer/programs/myhome.htm"},
        {"id": "calhfa_dream", "name": "CalHFA Dream For All", "type": "buyer",
         "amount": {"kind": "pct_price", "value": 0.20, "cap": 150000}, "terms": "Shared-appreciation loan up to 20% of price, max $150,000; voucher and randomized drawing",
         "max_ami": 150, "cities": None, "status": "funds_unconfirmed",
         "status_note": "Funds go out by voucher drawing; reports say earlier rounds ran out. Never count as certain money.",
         "source_url": "https://calhfa.ca.gov/dream/"},
        {"id": "calhome", "name": "HCD CalHome (via Homeownership Super NOFA)", "type": "developer",
         "amount": {"kind": "unknown"}, "terms": "State loans to nonprofits and local agencies for down payment, rehab and self-help housing",
         "max_ami": 80, "cities": None, "status": "unknown",
         "status_note": "Award size and round dates not confirmed today. Listed, not counted.",
         "source_url": "https://www.hcd.ca.gov/grants-and-funding/programs-active/calhome"},
        {"id": "ochft", "name": "Orange County Housing Finance Trust", "type": "developer",
         "amount": {"kind": "unknown"}, "terms": "Countywide housing NOFAs; homeownership terms not confirmed",
         "max_ami": None, "cities": None, "status": "unknown",
         "status_note": "Programs page shows a NOFA; no homeownership amount confirmed. Listed, not counted.",
         "source_url": "https://ochft.org/programs"},
    ],
}

json.dump(income, open(os.path.join(D, "income_limits.json"), "w"), indent=1)
json.dump(pmms, open(os.path.join(D, "pmms.json"), "w"), indent=1)
json.dump(programs, open(os.path.join(D, "programs.json"), "w"), indent=1)
print("latest rate", pmms["latest"])
