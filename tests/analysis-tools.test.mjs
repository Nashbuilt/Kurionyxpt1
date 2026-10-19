import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateProfitability, groupExpenses, landedUnitCost, mixedTotal } from '../analysis-tools.js';

const [html, toolkit] = await Promise.all([
  readFile(new URL('../toolkit.html', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.js', import.meta.url), 'utf8')
]);

test('mixed batch and unit inputs produce a complete profit estimate', () => {
  const result = calculateProfitability({ units: 100, salePrice: 15, salePriceMode: 'per_unit', productCost: 500, productCostMode: 'batch', shippingCost: 1, shippingCostMode: 'per_unit', platformFixed: 25, platformFixedMode: 'batch', platformPercent: 10, otherCost: 50, otherCostMode: 'batch' });
  assert.equal(result.revenue, 1500);
  assert.equal(result.totalCost, 825);
  assert.equal(result.profit, 675);
  assert.equal(result.breakEvenUnitPrice, 7.5);
});

test('batch and per-unit modes normalize predictably', () => {
  assert.equal(mixedTotal(4.5, 'per_unit', 20), 90);
  assert.equal(mixedTotal(90, 'batch', 20), 90);
});

test('landed unit cost allocates batch costs across purchased units', () => {
  const item = { id: 1, units: 7, unitCost: 5, shippingPaid: 20, otherFees: 10 };
  const movements = [{ stockItemId: 1, type: 'receipt', quantityDelta: 10 }, { stockItemId: 1, type: 'sale', quantityDelta: -3 }];
  assert.equal(landedUnitCost(item, movements), 8);
});

test('linked expenses affect landed cost only when explicitly included', () => {
  const item = { id: 1, units: 10, unitCost: 5, shippingPaid: 0, otherFees: 0 };
  const movements = [{ stockItemId: 1, type: 'receipt', quantityDelta: 10 }];
  const expenses = [
    { stockItemId: 1, amount: 20, includeInLandedCost: true, dataStatus: 'verified' },
    { stockItemId: 1, amount: 100, includeInLandedCost: false, dataStatus: 'verified' },
    { stockItemId: 1, amount: 30, includeInLandedCost: true, dataStatus: 'unverified' }
  ];
  assert.equal(landedUnitCost(item, movements, expenses), 10);
  assert.equal(landedUnitCost(item, movements, expenses, true), 7);
});

test('expense analysis excludes demonstration and unverified records by default', () => {
  const expenses = [{ date: '2026-10-01', amount: 10, category: 'Software', dataStatus: 'verified' }, { date: '2026-10-02', amount: 100, category: 'Demo', dataStatus: 'demonstration' }, { date: '2026-10-03', amount: 30, category: 'Other', dataStatus: 'unverified' }];
  assert.equal(groupExpenses(expenses, 'month')[0].total, 10);
  assert.equal(groupExpenses(expenses, 'month', false)[0].total, 140);
});

test('toolkit exposes calculator and spending tabs with live stock costing', () => {
  assert.match(html, /data-view="calculator"/);
  assert.match(html, /data-panel="calculator"/);
  assert.match(html, /data-view="spending"/);
  assert.match(html, /data-panel="spending"/);
  assert.match(html, /id="stock-cost-preview"/);
  assert.match(toolkit, /landedUnitCost\(item, records\.movements, records\.expenses/);
  assert.match(toolkit, /groupExpenses\(records\.expenses/);
});
