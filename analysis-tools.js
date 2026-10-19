const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function mixedTotal(value, mode, units) {
  const amount = Math.max(0, finite(value));
  return mode === 'per_unit' ? amount * Math.max(0, finite(units)) : amount;
}

export function calculateProfitability(input) {
  const units = Math.max(1, Math.trunc(finite(input.units) || 1));
  const revenue = mixedTotal(input.salePrice, input.salePriceMode, units);
  const productCost = mixedTotal(input.productCost, input.productCostMode, units);
  const shippingCost = mixedTotal(input.shippingCost, input.shippingCostMode, units);
  const platformFixed = mixedTotal(input.platformFixed, input.platformFixedMode, units);
  const otherCost = mixedTotal(input.otherCost, input.otherCostMode, units);
  const platformRate = Math.min(100, Math.max(0, finite(input.platformPercent))) / 100;
  const platformPercentage = revenue * platformRate;
  const costBeforePercentage = productCost + shippingCost + platformFixed + otherCost;
  const totalCost = costBeforePercentage + platformPercentage;
  const profit = revenue - totalCost;
  const margin = revenue > 0 ? profit / revenue * 100 : 0;
  const roi = totalCost > 0 ? profit / totalCost * 100 : 0;
  const breakEvenUnitPrice = platformRate < 1 ? costBeforePercentage / units / (1 - platformRate) : Infinity;
  const verdict = profit <= 0
    ? { label: 'Not worthwhile at these figures', state: 'negative' }
    : margin < 15
      ? { label: 'Profitable, but the margin is slim', state: 'warning' }
      : { label: 'Potentially worthwhile', state: 'positive' };
  return { units, revenue, productCost, shippingCost, platformFixed, platformPercentage, otherCost, totalCost, profit, margin, roi, breakEvenUnitPrice, verdict };
}

export function purchasedUnitsFor(stockItemId, movements, fallbackUnits = 0) {
  const purchased = movements
    .filter(item => String(item.stockItemId) === String(stockItemId) && ['opening_balance', 'receipt'].includes(item.type) && item.quantityDelta > 0)
    .reduce((sum, item) => sum + finite(item.quantityDelta), 0);
  return purchased > 0 ? purchased : Math.max(0, finite(fallbackUnits));
}

export function landedUnitCost(item, movements = []) {
  const basisUnits = purchasedUnitsFor(item.id, movements, item.units);
  const allocatedBatchCosts = finite(item.shippingPaid) + finite(item.otherFees);
  return Math.max(0, finite(item.unitCost)) + (basisUnits > 0 ? allocatedBatchCosts / basisUnits : 0);
}

function periodDetails(dateValue, period) {
  const date = new Date(`${String(dateValue).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  if (period === 'day') {
    const key = date.toISOString().slice(0, 10);
    return { key, label: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date) };
  }
  if (period === 'week') {
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    const key = date.toISOString().slice(0, 10);
    return { key, label: `Week of ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)}` };
  }
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return { key, label: new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(date) };
}

export function groupExpenses(expenses, period = 'month', confirmedOnly = true) {
  const groups = new Map();
  expenses
    .filter(item => !item.archivedAt && (!confirmedOnly || item.dataStatus === 'verified'))
    .forEach(item => {
      const details = periodDetails(item.date, period);
      if (!details) return;
      const current = groups.get(details.key) || { ...details, total: 0, count: 0, categories: {} };
      current.total += Math.max(0, finite(item.amount));
      current.count += 1;
      current.categories[item.category || 'Other'] = (current.categories[item.category || 'Other'] || 0) + Math.max(0, finite(item.amount));
      groups.set(details.key, current);
    });
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
}
