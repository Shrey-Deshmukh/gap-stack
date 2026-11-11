// Gap Stack engine. All arithmetic lives here; the UI and Claude only display results.
// Runs in the browser and in Node (tests/synthetic.test.mjs).

export const DEFAULT_ASSUMPTIONS = {
  // Buyer-side housing costs that HSC 50052.5 counts inside "affordable housing cost".
  taxRate: 0.011,        // ASSUMPTION: ~1% Prop 13 base + ~0.1% local assessments (OC Treasurer note in lane sources)
  insuranceMo: 150,      // ASSUMPTION: homeowner insurance per month
  hoaMo: 250,            // ASSUMPTION: HOA dues per month (small for-sale project)
  utilitiesMo: 250,      // ASSUMPTION: utility allowance per month
  downPct: 0.03,         // ASSUMPTION: 3% buyer down payment (Santa Ana MFH requires 3% seasoned funds)
  // Developer carrying cost while waiting (Lane 2 time cost).
  acqRate: 0.085,        // ASSUMPTION: interest on the acquisition/predevelopment loan
  holdTaxRate: 0.011,    // ASSUMPTION: property tax while holding
  holdInsuranceMo: 120,  // ASSUMPTION: builder's risk / liability per home per month
  mgmtMo: 150,           // ASSUMPTION: management and security per home per month
};

export const BAND_ORDER = ['extremely_low', 'very_low', 'low', 'moderate'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function paymentFactor(annualRatePct, years = 30) {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return 1 / n;
  return r / (1 - Math.pow(1 + r, -n));
}

/** What a family in `band` can pay for a home with `bedrooms`, per HSC 50052.5(b). */
export function familyPrice({ band, bedrooms, rate, income, a = DEFAULT_ASSUMPTIONS }) {
  const st = income.statute.bands[band];
  const table = income.tables.state;
  const hh = clamp(Math.round(bedrooms) + 1, 1, 8);
  const amiAdj = table.by_household_size.median[hh - 1];
  const capMo = (st.share * st.ami_mult * amiAdj) / 12;
  const otherMo = a.insuranceMo + a.hoaMo + a.utilitiesMo;
  const availMo = Math.max(0, capMo - otherMo);
  const pf = paymentFactor(rate);
  // price P: (1-down)*P*pf + taxRate*P/12 = availMo
  const price = availMo / ((1 - a.downPct) * pf + a.taxRate / 12);
  const loan = price * (1 - a.downPct);
  return {
    price, loan, down: price * a.downPct, hh, amiAdj, capMo, availMo,
    piMo: loan * pf, taxMo: (price * a.taxRate) / 12, otherMo,
    formula: `${Math.round(st.share * 100)}% x ${Math.round(st.ami_mult * 100)}% x $${amiAdj.toLocaleString()} / 12`,
    cite: st.cite, quote: st.quote,
  };
}

export function carryingPerMonth(landCost, a = DEFAULT_ASSUMPTIONS) {
  const interest = (landCost * a.acqRate) / 12;
  const tax = (landCost * a.holdTaxRate) / 12;
  return { total: interest + tax + a.holdInsuranceMo + a.mgmtMo, interest, tax, insurance: a.holdInsuranceMo, mgmt: a.mgmtMo };
}

export function cityTimeline(timelines, juris) {
  return timelines.cities.find((c) => c.juris_name === juris) || null;
}

/** Months the project waits between approval and building permit, with provenance. */
export function waitingMonths(timelines, juris, fallbackMonths = 12) {
  const c = cityTimeline(timelines, juris);
  const m = c && c.approval_to_permit;
  if (m && m.median != null) {
    return { months: m.median, n: m.n, p25: m.p25, p75: m.p75, confidence: m.confidence, label: 'SOURCED', city: c.city };
  }
  return { months: fallbackMonths, n: m ? m.n : 0, confidence: 'unknown', label: 'ASSUMPTION', city: c ? c.city : juris };
}

function programAmount(p, price) {
  if (p.amount.kind === 'fixed') return p.amount.value;
  if (p.amount.kind === 'pct_price') return Math.min(price * p.amount.value, p.amount.cap ?? Infinity);
  return null;
}

export function eligiblePrograms(programs, { band, juris, income }) {
  const bandMax = income.statute.bands[band].max_ami;
  return programs.programs.map((p) => {
    const reasons = [];
    let eligible = true;
    if (p.max_ami != null && bandMax > p.max_ami) { eligible = false; reasons.push(`income cap ${p.max_ami}% AMI`); }
    if (p.cities && !p.cities.includes(juris)) { eligible = false; reasons.push(`only in ${p.cities.map((c) => c[0] + c.slice(1).toLowerCase()).join(', ')}`); }
    return { ...p, eligible, reasons };
  });
}

/**
 * Full gap for one home type.
 * input: { juris, band, bedrooms, cost:{land,construction,fees}, rate, months?, rentWhileWaiting,
 *          enabled: {programId: bool}, countUnconfirmed, overrides:{familyPrice,timeCost,subsidies} }
 */
export function computeHome(input, data) {
  const a = { ...DEFAULT_ASSUMPTIONS, ...(input.assumptions || {}) };
  const ov = input.overrides || {};
  const fp = familyPrice({ band: input.band, bedrooms: input.bedrooms, rate: input.rate, income: data.income, a });
  const family = ov.familyPrice ?? fp.price;

  const wait = input.months != null
    ? { months: input.months, label: 'ASSUMPTION', confidence: 'manual', n: 0 }
    : waitingMonths(data.timelines, input.juris);
  const carry = carryingPerMonth(input.cost.land, a);
  const timeCost = ov.timeCost ?? wait.months * carry.total;

  const lines = [
    { key: 'land', label: 'Land and building', value: input.cost.land, tag: input.costTag || 'ASSUMPTION' },
    { key: 'construction', label: 'Construction and repairs', value: input.cost.construction, tag: input.costTag || 'ASSUMPTION' },
    { key: 'fees', label: 'Fees, design, legal, sales', value: input.cost.fees, tag: input.costTag || 'ASSUMPTION' },
    { key: 'time', label: 'Time waiting on permits', value: timeCost, tag: ov.timeCost != null ? 'SYNTHETIC' : wait.label },
  ];
  const cost = lines.reduce((s, l) => s + l.value, 0);
  const gap = Math.max(0, cost - family);

  // Funding stack
  let remaining = gap;
  const stack = [];
  if (ov.subsidies != null) {
    const v = Math.min(remaining, ov.subsidies);
    stack.push({ id: 'synthetic_subsidies', name: 'Public subsidies (synthetic)', value: v, status: 'synthetic' });
    remaining -= v;
  } else {
    const progs = eligiblePrograms(data.programs, { band: input.band, juris: input.juris, income: data.income });
    for (const p of progs) {
      const amt = programAmount(p, family);
      const on = input.enabled ? input.enabled[p.id] !== false : true;
      const counted = p.eligible && on && amt != null && (p.status === 'confirmed' || (input.countUnconfirmed && p.status === 'funds_unconfirmed'));
      const v = counted ? Math.min(remaining, amt) : 0;
      stack.push({ id: p.id, name: p.name, value: v, potential: amt, status: p.status, eligible: p.eligible, reasons: p.reasons, on, counted, source_url: p.source_url, terms: p.terms, status_note: p.status_note });
      remaining -= v;
    }
  }
  const rent = Math.min(remaining, input.rentWhileWaiting || 0);
  remaining -= rent;
  const subsidies = stack.reduce((s, x) => s + x.value, 0);
  const fundraising = Math.max(0, remaining);
  const balance = family + subsidies + rent + fundraising - cost; // should be 0 (or >0 when family covers all)

  return { family, fp, wait, carry, timeCost, lines, cost, gap, stack, subsidies, rent, fundraising, balance, assumptions: a };
}

/** Whole project: several home types. */
export function computeProject(project, data) {
  const homes = project.homes.map((h) => {
    const r = computeHome({ ...project, band: h.band, bedrooms: h.bedrooms }, data);
    return { ...h, result: r };
  });
  const count = homes.reduce((s, h) => s + h.count, 0) || 1;
  const sum = (f) => homes.reduce((s, h) => s + f(h.result) * h.count, 0);
  const totals = {
    count,
    cost: sum((r) => r.cost), family: sum((r) => r.family), gap: sum((r) => r.gap),
    subsidies: sum((r) => r.subsidies), rent: sum((r) => r.rent), fundraising: sum((r) => r.fundraising),
    timeCost: sum((r) => r.timeCost),
  };
  const per = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, k === 'count' ? v : v / count]));
  return { homes, totals, per, wait: homes[0]?.result.wait, carry: homes[0]?.result.carry };
}

export function money(v, { compact = false } = {}) {
  if (v == null || Number.isNaN(v)) return 'unknown';
  const sign = v < 0 ? '-' : '';
  const x = Math.abs(v);
  if (compact && x >= 1e6) return `${sign}$${(x / 1e6).toFixed(2)}M`;
  if (compact && x >= 1e3) return `${sign}$${Math.round(x / 1e3)}k`;
  return `${sign}$${Math.round(x).toLocaleString('en-US')}`;
}
