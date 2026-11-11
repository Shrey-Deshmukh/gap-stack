# Gap Stack

> **Our tool shows a nonprofit how big the funding gap is on each home, how much of it comes from waiting on the city, and who can help pay for the rest.**

**Lane:** 3 Fund it
**Built at:** Claude Impact Lab: UCI × SoCal Affordable Housing, November 7, 2026
**Live demo:** <https://gap-stack.onrender.com> (free plan: first visit after sleep takes 30–50 seconds)

---

## The problem

Building an affordable home in Orange County costs more than the family buying it can afford. The difference is called the gap, and the nonprofit has to find that money from government programs and donors.

A big, hidden part of the gap is **waiting**. While the city reviews permits, the nonprofit keeps paying loan interest, taxes and insurance — often for months or years. That cost gets added to the gap. Most pro formas never show it.

---

## What our tool does

A nonprofit enters a project — like "8 homes in Santa Ana" — and the tool answers four questions:

1. **What can the family afford?** Worked out from state law (HSC 50052.5b), current HCD income limits, and today's live mortgage rate.
2. **How much is the gap per home?** Cost to build minus what the family can pay.
3. **How much of that gap is from waiting on the city?** Based on how long that city actually took on past projects, using HCD Annual Progress Report state data.
4. **Who can fill the rest?** A list of funding programs, each marked confirmed or "check first," plus how much is left to fundraise.

Every number shows where it came from. Anything estimated is labeled as a guess.

---

## Who it's for

The finance lead at a small housing nonprofit. Today this takes them **weeks of spreadsheets and phone calls**. With Gap Stack it takes about **10 minutes**.

---

## Why it matters

It shows something nobody can see today: how much of a home's cost is just time spent waiting. That helps nonprofits choose where to build, and gives them hard numbers to take to the city and to funders.

---

## What we built

One page that balances the equation for a real project:

> family price + programs + rent while waiting + fundraising − cost to create = **$0**

- **Family price** from HSC 50052.5(b), HCD 2026 OC income limits (rev. Jun 23), and live Freddie Mac 30-year rate via FRED API
- **Time to permit** from 53,578 HCD APR Table A2 rows across OC, joined into 21,477 projects — median months per city × carrying cost = a real dollar line on the bill
- **Funding stack** of 6 programs with amounts read from their own pages: Santa Ana My First Home ($120k), FHLBank SF WISH ($32,837), CalHFA MyHome (3.5%), CalHFA Dream For All (20%, max $150k), CalHome and OC Housing Finance Trust (amounts unknown, listed never counted)
- **What is left to fundraise**, as an animated waterfall stacking up to the cost line

Plus three scenarios:
- **M01** which sources can I stack — toggle programs on/off, count unconfirmed funds or not
- **M02** rate slider over two years of live weekly rates from FRED
- **M03** donor view — what a gift covers in months of waiting costs and share of the gap

---

## How Claude is used

- **Built with Claude Code** — data pipeline, engine, tests and UI written with Claude
- **Funder memo** — the engine's output goes to Claude, which writes a one-page board memo. Claude never does arithmetic: the system prompt forbids new numbers. A person reads it before use
- **Program reader** — paste a program page and Claude drafts a `programs.json` row with evidence quotes. A person approves it before it enters the stack; it shows a "Claude draft" badge
- Without an API key both features fall back gracefully to a template

---

## Try it

Needs **Node 18+**. No `npm install` — zero dependencies.

```bash
git clone https://github.com/ani-sha/claude-impactlab-hackathon.git
cd claude-impactlab-hackathon
node server.mjs
```

Open <http://localhost:5173>.

To enable Claude and live mortgage rates, copy `.env.example` to `.env`:

```
ANTHROPIC_API_KEY=your_key_here   # from console.anthropic.com
FRED_API_KEY=your_key_here        # free at fred.stlouisfed.org
```

Run the tests:

```bash
node --test tests/synthetic.test.mjs
```

Rebuild the data (optional, needs Python 3.9+):

```bash
python delay/build_static_data.py
python delay/build_timelines.py --refresh
```

All data is committed in `data/` — the app runs fully offline without any API keys.

### Deploy on Vercel (free)

The repo is ready for Vercel with no changes: `vercel.json` copies `data/` into the static site at build time, and the four server routes run as Vercel functions in `api/` (sharing their logic with `server.mjs` through `lib/core.mjs`).

1. In Vercel, choose **Add New → Project** and import this repo. Leave the framework as **Other**; `vercel.json` sets the build command and output folder.
2. Optional: under **Settings → Environment Variables**, add `ANTHROPIC_API_KEY` (turns on the Claude memo and program reader) and `FRED_API_KEY` (live mortgage rates). Without them, the memo uses a template and rates come from `data/pmms.json`.
3. Deploy. Check `/api/health` on your new URL.

---

## Sources and assumptions

| Item | Source | Checked |
|---|---|---|
| OC income limits | [HCD 2026 State Income Limits, rev. 2026-06-23](https://www.hcd.ca.gov/sites/default/files/docs/grants-and-funding/income-limits-2026.pdf) | 2026-11-07 |
| Affordable owner cost formula | [HSC 50052.5(b)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=HSC&sectionNum=50052.5) | 2026-11-07 |
| Mortgage rate | [Freddie Mac PMMS via FRED](https://fred.stlouisfed.org/series/MORTGAGE30US), 7.18% on 2026-11-05 | 2026-11-07 |
| Months to permit by city | [HCD APR Table A2 via data.ca.gov](https://data.ca.gov/dataset/housing-element-annual-progress-report-apr-data-by-jurisdiction-and-year) | 2026-11-07 |
| Santa Ana My First Home | [santa-ana.org/my-first-home](https://santa-ana.org/my-first-home): up to $120,000, 0%, 80% AMI | 2026-11-07 |
| FHLBank SF WISH | [fhlbsf.com](https://fhlbsf.com/products/community-programs-grants/wish): up to $32,837, 80% AMI | 2026-11-07 |
| CalHFA MyHome | [calhfa.ca.gov](https://www.calhfa.ca.gov/homebuyer/programs/myhome.htm): up to 3.5% | 2026-11-07 |
| CalHFA Dream For All | [calhfa.ca.gov/dream](https://calhfa.ca.gov/dream/): up to 20%, max $150k, voucher drawing | 2026-11-07 |
| Cost lines (land $360k, construction $40k, fees $50k) | ASSUMPTION — organizers' synthetic example | |
| Buyer costs (tax, insurance, HOA, utilities, down payment) | ASSUMPTION — editable in the tool | |
| Carrying cost (loan rate, tax, insurance, management) | ASSUMPTION — editable in the tool | |

---

## Known limitations

- Table A2 starts at entitlement approval — time from application to approval (often the longest wait) is not counted. Real time costs are likely higher.
- Some cities record approval and permit on the same day, showing 0 months. That is a reporting pattern, not proof the city is instant.
- Medians mix tenures and project sizes. Cities with 5–9 projects are flagged low confidence; under 5 are unknown.
- Program funding status changes — "funds unconfirmed" means call before counting it.

---

## Next steps

- Add Table A (applications) to measure application-to-approval time
- Let a nonprofit upload its own pro forma instead of default cost lines
- Confirm the "two weeks → 10 minutes" estimate with a real practitioner
- City-staff view: "your median wait costs each affordable home $X"

---

## Data and privacy

Uses only public data. Commits only city-level aggregates — never project rows. Contains no personal information about real tenants, buyers or residents.

## License

MIT — see [LICENSE](LICENSE).
