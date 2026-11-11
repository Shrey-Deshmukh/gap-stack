// Run: node --test tests/
// The design doc's check: the organizers' synthetic deal must return the $95k fundraising gap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeHome, familyPrice, paymentFactor } from '../public/engine.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)));
const data = { income: load('income_limits.json'), timelines: load('city_timelines.json'), programs: load('programs.json') };
const deal = load('synthetic_deal.json');

test('synthetic deal returns the $95k fundraising gap', () => {
  const c = deal.cost_to_create, p = deal.paid_by;
  const r = computeHome({
    juris: 'SANTA ANA', band: 'low', bedrooms: 3, rate: 7.18,
    cost: { land: c.land_and_building_purchase.value, construction: c.construction_and_repairs.value, fees: c.fees_design_legal_sales.value },
    rentWhileWaiting: p.rent_earned_while_waiting.value,
    overrides: { familyPrice: p.family_price.value, timeCost: c.time_costs_while_waiting.value, subsidies: p.public_subsidies.value },
  }, data);
  assert.equal(r.cost, 535000);
  assert.equal(r.gap, 250000);
  assert.equal(Math.round(r.fundraising), 95000);
  assert.equal(Math.round(r.balance), 0);
});

test('payment factor matches a standard 30-year amortization', () => {
  // $100k at 6% for 30 years = $599.55 per month
  assert.equal(Math.round(100000 * paymentFactor(6) * 100) / 100, 599.55);
});

test('family price follows HSC 50052.5(b)(3) for a lower-income family of 4', () => {
  const fp = familyPrice({ band: 'low', bedrooms: 3, rate: 7.18, income: data.income });
  // cap = 30% x 70% x 138,600 / 12 = 2,425.50 per month
  assert.equal(Math.round(fp.capMo * 100) / 100, 2425.5);
  assert.equal(fp.hh, 4);
  assert.ok(fp.price > 200000 && fp.price < 320000, `price ${fp.price}`);
});

test('higher rate means a lower family price, so a bigger gap', () => {
  const lo = familyPrice({ band: 'moderate', bedrooms: 3, rate: 7.18, income: data.income }).price;
  const hi = familyPrice({ band: 'moderate', bedrooms: 3, rate: 7.40, income: data.income }).price;
  assert.ok(hi < lo);
});

test('unknown program amounts are never counted', () => {
  const r = computeHome({ juris: 'IRVINE', band: 'low', bedrooms: 3, rate: 7.18, cost: { land: 360000, construction: 40000, fees: 50000 }, countUnconfirmed: true }, data);
  for (const s of r.stack.filter((x) => x.status === 'unknown')) assert.equal(s.value, 0);
});
