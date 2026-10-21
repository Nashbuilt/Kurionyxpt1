import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { initSettings } from './settings.js';
import { businessPerformance, calculateProfitability, categorySpend, groupExpenses, landedUnitCost, purchasedUnitsFor } from './analysis-tools.js';

const supabase = createClient(
  'https://wszgmnngwnhtavuxqqyk.supabase.co',
  'sb_publishable_kqyjZOBwyt0rJGEQao-pgw_uiEO8-Nf'
);

const records = { stock: [], expenses: [], income: [], sales: [], shipments: [], movements: [], stockImages: [], trackingEvents: [], actors: [] };
let workspaceId = null;
let workspaceRole = null;
let currentUserId = null;
let bankLoaded = false;
let bankLoading = false;
let bankTransactions = [];
let bankIncomeTransactions = [];

const $ = selector => document.querySelector(selector);
const toolkitApp = $('#toolkit-app');
const loadingPanel = $('#tool-loading');
const accessError = $('#access-error');
const workspaceMessage = $('#workspace-message');
const connectionStatus = $('#connection-status');
const dialogs = {
  stock: $('#stock-modal'),
  sale: $('#sale-modal'),
  shipment: $('#shipment-modal'),
  expense: $('#expense-modal'),
  income: $('#income-modal'),
  movement: $('#movement-modal'),
  tracking: $('#tracking-modal')
};

const money = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value) || 0);
const number = value => new Intl.NumberFormat('en-GB').format(Number(value) || 0);
const shortDate = value => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : 'Not set';
const moneyMinor = (value, currency = 'GBP') => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format((Number(value) || 0) / 100);

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function setStatus(label, state = '') {
  connectionStatus.className = `status-pill ${state}`.trim();
  connectionStatus.innerHTML = `<i></i> ${esc(label)}`;
}

function showMessage(message, state = '') {
  workspaceMessage.className = `workspace-message ${state}`.trim();
  workspaceMessage.textContent = message;
  if (message) window.setTimeout(() => {
    if (workspaceMessage.textContent === message) workspaceMessage.textContent = '';
  }, 4500);
}

function showAccessError(message) {
  loadingPanel.hidden = true;
  toolkitApp.hidden = true;
  accessError.hidden = false;
  $('#access-error-message').textContent = message;
  setStatus('Access unavailable', 'error');
}

function actorBadge(item) {
  const actor = records.actors.find(member => member.userId === (item.updatedBy || item.createdBy));
  const timestamp = item.updatedAt || item.createdAt;
  const label = actor ? `${actor.name} · ${shortDate(timestamp)}` : `Legacy record · ${shortDate(timestamp)}`;
  return `<span class="record-actor" title="${esc(label)}" aria-label="${esc(label)}">${actor?.avatarUrl ? `<img src="${esc(actor.avatarUrl)}" alt="">` : `<i>${esc((actor?.name || '?')[0].toUpperCase())}</i>`}</span>`;
}

function view(name) {
  document.querySelectorAll('.tool-nav[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === name));
  document.querySelectorAll('.tool-view').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === name));
  $('#tool-title').textContent = name[0].toUpperCase() + name.slice(1);
  if (name === 'bank' && !bankLoaded) loadBankSummary();
}

const chartColours = ['#103f47', '#f47a24', '#6f8f94', '#d6a56f', '#7c6f91', '#4f7468', '#c66f52', '#89969a'];

function renderDonut(chartSelector, centreSelector, legendSelector, items, total, formatter = money) {
  let position = 0;
  const segments = items.map((item, index) => {
    const start = position;
    position += total ? item.total / total * 100 : 0;
    return `${chartColours[index % chartColours.length]} ${start.toFixed(2)}% ${position.toFixed(2)}%`;
  });
  $(chartSelector).style.background = segments.length ? `conic-gradient(${segments.join(',')})` : '#e7ebe7';
  $(centreSelector).textContent = formatter(total);
  $(legendSelector).innerHTML = items.length
    ? items.map((item, index) => `<div><i style="background:${chartColours[index % chartColours.length]}"></i><span>${esc(item.category)}</span><strong>${formatter(item.total)}</strong></div>`).join('')
    : '<p class="empty compact">No matching records yet.</p>';
}

function bankExpense(transactionId) {
  return records.expenses.find(item => item.externalTransactionId === transactionId && !item.archivedAt);
}

function bankIncomeRecord(transactionId) {
  return records.income.find(item => item.externalTransactionId === transactionId && !item.archivedAt);
}

function renderBankSpendChart(transactions) {
  const totals = new Map();
  transactions.filter(transaction => transaction.status === 'completed' && !transaction.refunded).forEach(transaction => {
    const linked = bankExpense(transaction.id);
    const category = linked?.category || transaction.category?.replaceAll('_', ' ') || 'Other';
    totals.set(category, (totals.get(category) || 0) + Math.abs(Number(transaction.amount) || 0) / 100);
  });
  const items = [...totals].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
  const total = items.reduce((sum, item) => sum + item.total, 0);
  $('#bank-spend-total').textContent = money(total);
  renderDonut('#bank-category-chart', '#bank-category-centre', '#bank-category-legend', items, total);
}

function renderBankTransactions(selector, transactions, emptyMessage) {
  $(selector).innerHTML = transactions.length ? transactions.map(transaction => {
    const title = transaction.merchant || transaction.description;
    const linked = bankExpense(transaction.id);
    const stateLabel = transaction.refunded ? 'Refunded' : transaction.status === 'pending' ? 'Pending authorisation' : '';
    const detail = [stateLabel, linked?.category || transaction.category?.replaceAll('_', ' '), shortDate(transaction.settled || transaction.created), linked ? `Linked to ${linked.description}` : transaction.notes].filter(Boolean).join(' · ');
    const action = transaction.amount < 0 && transaction.status === 'completed' && !transaction.refunded ? `<button class="bank-link-button" data-bank-expense="${esc(transaction.id)}">${linked ? 'Review expense' : 'Create expense'}</button>` : '';
    return `<article class="bank-transaction ${transaction.refunded ? 'refunded' : transaction.status === 'pending' ? 'pending' : ''}"><div><strong>${esc(title)}</strong><span>${esc(detail)}</span>${action}</div><b class="${transaction.amount > 0 ? 'income' : ''}">${transaction.amount > 0 ? '+' : '−'}${moneyMinor(Math.abs(transaction.amount), transaction.currency)}</b></article>`;
  }).join('') : `<p class="bank-empty">${esc(emptyMessage)}</p>`;
}

function renderBankIncomeTransactions(transactions) {
  $('#bank-income').innerHTML = transactions.length ? transactions.map(transaction => {
    const linked = bankIncomeRecord(transaction.id);
    const title = transaction.merchant || transaction.description;
    const detail = [transaction.isRefund ? 'Refund or reversal' : linked?.category || 'Unclassified income', shortDate(transaction.settled || transaction.created), linked ? `Recorded as ${linked.description}` : transaction.notes].filter(Boolean).join(' · ');
    return `<article class="bank-transaction"><div><strong>${esc(title)}</strong><span>${esc(detail)}</span><button class="bank-link-button" data-bank-income="${esc(transaction.id)}">${linked ? 'Review income' : 'Add details'}</button></div><b class="income">+${moneyMinor(Math.abs(transaction.amount), transaction.currency)}</b></article>`;
  }).join('') : '<p class="bank-empty">No recent incoming payments were returned.</p>';
}

function renderBankIncomeChart() {
  const totals = new Map();
  bankIncomeTransactions.forEach(transaction => {
    const linked = bankIncomeRecord(transaction.id);
    const category = linked?.category || (transaction.isRefund ? 'Refund or rebate' : 'Unclassified');
    totals.set(category, (totals.get(category) || 0) + Math.abs(Number(transaction.amount) || 0) / 100);
  });
  const manual = records.income.filter(item => !item.archivedAt && !item.externalTransactionId);
  manual.forEach(item => totals.set(item.category, (totals.get(item.category) || 0) + item.amount));
  const items = [...totals].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
  const total = items.reduce((sum, item) => sum + item.total, 0);
  $('#bank-income-total').textContent = money(total);
  renderDonut('#bank-income-chart', '#bank-income-centre', '#bank-income-legend', items, total);
}

function renderIncomeLedger() {
  const active = records.income.filter(item => !item.archivedAt);
  $('#income-table').innerHTML = active.length ? active.map(item => `<tr><td data-label="Description"><strong>${esc(item.description)}</strong>${item.sourceProvider === 'monzo' ? '<small class="cell-detail">Matched to Monzo</small>' : '<small class="cell-detail">Manual record</small>'}</td><td data-label="Category"><span class="category-chip">${esc(item.category)}</span></td><td data-label="Reference">${esc(item.paymentReference || '—')}</td><td data-label="Date">${shortDate(item.date)}</td><td data-label="Amount"><strong>${money(item.amount)}</strong></td><td data-label="Status"><span class="data-status status-${esc(item.dataStatus)}">${esc(item.dataStatus)}</span></td><td>${actionMenu(`<button data-edit-income="${item.id}">Edit details</button><button class="delete-row" data-archive-income="${item.id}">Archive</button>`)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No income has been classified yet.</td></tr>';
}

async function loadBankSummary(force = false) {
  if (bankLoading || (bankLoaded && !force)) return;
  const ownerNotice = $('#bank-owner-notice');
  const loading = $('#bank-loading');
  const errorPanel = $('#bank-error');
  const content = $('#bank-content');
  if (workspaceRole !== 'owner') {
    ownerNotice.hidden = false;
    loading.hidden = true;
    content.hidden = true;
    return;
  }
  bankLoading = true;
  ownerNotice.hidden = true;
  errorPanel.hidden = true;
  loading.hidden = false;
  loading.querySelector('p').textContent = 'Loading live Monzo balances and transactions…';
  $('#refresh-bank').disabled = true;
  try {
    const { data, error } = await supabase.functions.invoke('monzo-bank-summary', { body: { action: 'summary' } });
    if (error) {
      let message = error.message;
      if (error.context?.json) {
        const details = await error.context.json().catch(() => null);
        if (details?.error) message = details.error;
      }
      throw new Error(message);
    }
    $('#bank-available').textContent = moneyMinor(data.balance.available, data.balance.currency);
    $('#bank-total').textContent = moneyMinor(data.balance.total, data.balance.currency);
    $('#bank-spent-today').textContent = moneyMinor(Math.abs(data.balance.spendToday), data.balance.currency);
    $('#bank-account-name').textContent = data.account.name || 'Monzo Business';
    $('#bank-refreshed').textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(data.refreshedAt));
    const warning = $('#bank-warning');
    warning.hidden = !data.warnings?.length;
    warning.textContent = data.warnings?.join(' ') || '';
    $('#bank-pots').innerHTML = data.pots.length ? data.pots.map(pot => `<article><span>${esc(pot.name)}</span><strong>${moneyMinor(pot.balance, pot.currency)}</strong></article>`).join('') : '<p class="bank-empty">No active pots were returned.</p>';
    bankTransactions = data.payments || [];
    bankIncomeTransactions = data.income || [];
    renderBankTransactions('#bank-payments', bankTransactions, 'No recent outgoing payments were returned.');
    renderBankIncomeTransactions(bankIncomeTransactions);
    renderBankSpendChart(bankTransactions);
    renderBankIncomeChart();
    renderIncomeLedger();
    bindRenderedActions();
    content.hidden = false;
    bankLoaded = true;
  } catch (error) {
    content.hidden = true;
    errorPanel.hidden = false;
    errorPanel.querySelector('p').textContent = error.message;
  } finally {
    loading.hidden = true;
    bankLoading = false;
    $('#refresh-bank').disabled = false;
  }
}

async function loadWorkspaceData() {
  const [stockResult, expenseResult, incomeResult, salesResult, shipmentResult, movementResult, imageResult, trackingResult, memberResult] = await Promise.all([
    supabase.from('stock_items').select('id, product_name, category, sku, units, unit_cost, shipping_paid, other_fees, notes, data_status, archived_at, created_at, updated_at, created_by, updated_by').order('created_at', { ascending: false }),
    supabase.from('expenses').select('id, description, category, expense_date, amount, stock_item_id, include_in_landed_cost, source_provider, external_transaction_id, payment_reference, data_status, archived_at, created_at, updated_at, created_by, updated_by').order('expense_date', { ascending: false }),
    supabase.from('income_records').select('id, description, category, income_date, amount, payment_reference, notes, source_provider, external_transaction_id, data_status, archived_at, created_at, updated_at, created_by, updated_by').order('income_date', { ascending: false }),
    supabase.from('stock_sales').select('id, stock_item_id, units, unit_sale_price, marketplace, marketplace_fees, notes, data_status, archived_at, archive_reason, sold_at, created_at, updated_at, created_by, updated_by').order('sold_at', { ascending: false }),
    supabase.from('shipments').select('id, direction, status, item_name, category, units, origin, destination, carrier, tracking_number, final_mile_carrier, final_mile_tracking_number, shipping_cost, expected_date, notes, data_status, archived_at, created_at, updated_at, created_by, updated_by').order('created_at', { ascending: false }),
    supabase.from('inventory_movements').select('id, stock_item_id, movement_type, quantity_delta, reason, data_status, occurred_at, created_at').order('occurred_at', { ascending: false }).limit(200),
    supabase.from('stock_images').select('id, stock_item_id, storage_path, alt_text, sort_order, created_at').order('sort_order').order('created_at'),
    supabase.from('shipment_tracking_events').select('id, shipment_id, event_status, description, location, occurred_at, source, created_at').order('occurred_at', { ascending: false }),
    supabase.rpc('list_workspace_members', { p_workspace_id: workspaceId })
  ]);

  for (const result of [stockResult, expenseResult, incomeResult, salesResult, shipmentResult, movementResult, imageResult, trackingResult, memberResult]) {
    if (result.error) throw result.error;
  }

  records.stock = (stockResult.data || []).map(item => ({
    id: item.id, product: item.product_name, category: item.category, sku: item.sku,
    units: Number(item.units), unitCost: Number(item.unit_cost), shippingPaid: Number(item.shipping_paid),
    otherFees: Number(item.other_fees), notes: item.notes, dataStatus: item.data_status,
    archivedAt: item.archived_at, createdAt: item.created_at, updatedAt: item.updated_at, createdBy: item.created_by, updatedBy: item.updated_by
  }));
  records.expenses = (expenseResult.data || []).map(item => ({
    id: item.id, description: item.description, category: item.category, date: item.expense_date,
    amount: Number(item.amount), stockItemId: item.stock_item_id,
    includeInLandedCost: item.include_in_landed_cost, sourceProvider: item.source_provider,
    externalTransactionId: item.external_transaction_id, paymentReference: item.payment_reference, dataStatus: item.data_status,
    archivedAt: item.archived_at, createdAt: item.created_at, updatedAt: item.updated_at, createdBy: item.created_by, updatedBy: item.updated_by
  }));
  records.income = (incomeResult.data || []).map(item => ({
    id: item.id, description: item.description, category: item.category, date: item.income_date,
    amount: Number(item.amount), paymentReference: item.payment_reference, notes: item.notes,
    sourceProvider: item.source_provider, externalTransactionId: item.external_transaction_id,
    dataStatus: item.data_status, archivedAt: item.archived_at, createdAt: item.created_at, updatedAt: item.updated_at, createdBy: item.created_by, updatedBy: item.updated_by
  }));
  records.sales = (salesResult.data || []).map(item => ({
    id: item.id, stockItemId: item.stock_item_id, units: Number(item.units), unitSalePrice: Number(item.unit_sale_price),
    marketplace: item.marketplace, marketplaceFees: Number(item.marketplace_fees), notes: item.notes, dataStatus: item.data_status,
    archivedAt: item.archived_at, archiveReason: item.archive_reason, soldAt: item.sold_at, createdAt: item.created_at, updatedAt: item.updated_at, createdBy: item.created_by, updatedBy: item.updated_by
  }));
  records.shipments = (shipmentResult.data || []).map(item => ({
    id: item.id, direction: item.direction, status: item.status, itemName: item.item_name, category: item.category,
    units: Number(item.units), origin: item.origin, destination: item.destination, carrier: item.carrier,
    trackingNumber: item.tracking_number, finalMileCarrier: item.final_mile_carrier,
    finalMileTrackingNumber: item.final_mile_tracking_number, shippingCost: Number(item.shipping_cost), expectedDate: item.expected_date,
    notes: item.notes, dataStatus: item.data_status, archivedAt: item.archived_at, createdAt: item.created_at, updatedAt: item.updated_at, createdBy: item.created_by, updatedBy: item.updated_by
  }));
  records.actors = (memberResult.data || []).map(member => ({ userId: member.user_id, name: member.display_name || member.email || 'Team member', path: member.avatar_path, avatarUrl: '' }));
  const actorPhotos = records.actors.filter(actor => actor.path);
  if (actorPhotos.length) {
    const { data: signedActors, error: actorError } = await supabase.storage.from('profile-pictures').createSignedUrls(actorPhotos.map(actor => actor.path), 3600);
    if (actorError) throw actorError;
    actorPhotos.forEach((actor, index) => { actor.avatarUrl = signedActors[index]?.signedUrl || ''; });
  }
  records.movements = (movementResult.data || []).map(item => ({
    id: item.id, stockItemId: item.stock_item_id, type: item.movement_type,
    quantityDelta: Number(item.quantity_delta), reason: item.reason,
    dataStatus: item.data_status, occurredAt: item.occurred_at, createdAt: item.created_at
  }));
  records.stockImages = (imageResult.data || []).map(item => ({
    id: item.id, stockItemId: item.stock_item_id, path: item.storage_path,
    alt: item.alt_text, sortOrder: item.sort_order, createdAt: item.created_at, url: ''
  }));
  if (records.stockImages.length) {
    const { data: signedImages, error: signedImageError } = await supabase.storage.from('stock-images').createSignedUrls(records.stockImages.map(image => image.path), 3600);
    if (signedImageError) throw signedImageError;
    signedImages.forEach((signed, index) => { records.stockImages[index].url = signed.signedUrl || ''; });
  }
  records.trackingEvents = (trackingResult.data || []).map(item => ({
    id: item.id, shipmentId: item.shipment_id, status: item.event_status,
    description: item.description, location: item.location, occurredAt: item.occurred_at, source: item.source
  }));
  render();
}

function stockById(id) {
  return records.stock.find(item => String(item.id) === String(id));
}

function currentProductCost(item, confirmedOnly = false) {
  return item.units * landedUnitCost(item, records.movements, records.expenses, confirmedOnly);
}

function renderDashboard() {
  const confirmedStock = records.stock.filter(item => item.dataStatus === 'verified' && !item.archivedAt);
  const confirmedSales = records.sales.filter(item => item.dataStatus === 'verified' && !item.archivedAt);
  const confirmedShipments = records.shipments.filter(item => item.dataStatus === 'verified' && !item.archivedAt);
  const totalUnits = confirmedStock.reduce((sum, item) => sum + item.units, 0);
  const inventoryCost = confirmedStock.reduce((sum, item) => sum + currentProductCost(item, true), 0);
  const unitsSold = confirmedSales.reduce((sum, sale) => sum + sale.units, 0);
  const revenue = confirmedSales.reduce((sum, sale) => sum + sale.units * sale.unitSalePrice, 0);
  const active = confirmedShipments.filter(item => !['delivered', 'cancelled'].includes(item.status));
  const incoming = active.filter(item => item.direction === 'incoming');
  const outgoing = active.filter(item => item.direction === 'outgoing');

  $('#metric-units').textContent = number(totalUnits);
  $('#metric-value').textContent = money(inventoryCost);
  $('#metric-sold').textContent = number(unitsSold);
  $('#metric-revenue').textContent = money(revenue);
  $('#metric-incoming').textContent = number(incoming.length);
  $('#metric-outgoing').textContent = number(outgoing.length);
  $('#flow-incoming-units').textContent = number(incoming.reduce((sum, item) => sum + item.units, 0));
  $('#flow-outgoing-units').textContent = number(outgoing.reduce((sum, item) => sum + item.units, 0));

  renderCategoryChart(totalUnits);

  const nextShipments = [...active].sort((a, b) => String(a.expectedDate || '9999').localeCompare(String(b.expectedDate || '9999'))).slice(0, 4);
  $('#shipment-preview').innerHTML = nextShipments.length
    ? nextShipments.map(item => `<div><span class="direction-dot ${item.direction}"></span><p><strong>${esc(item.itemName)}</strong><small>${item.direction === 'incoming' ? 'Incoming' : 'Outgoing'} · ${number(item.units)} units · ${shortDate(item.expectedDate)}</small></p></div>`).join('')
    : '<p class="empty compact">No active shipments.</p>';

  const topStock = [...confirmedStock].sort((a, b) => b.units - a.units).slice(0, 7);
  const maxUnits = Math.max(1, ...topStock.map(item => item.units));
  $('#stock-bars').innerHTML = topStock.length
    ? topStock.map(item => `<div class="bar-item"><div class="bar" style="height:${Math.max(8, item.units / maxUnits * 165)}px" title="${item.units} units"></div><span>${esc(item.product)}</span></div>`).join('')
    : '<p class="empty compact">Add your first stock item to see the chart.</p>';

  const activity = [
    ...confirmedSales.map(item => ({ date: item.createdAt, icon: '↗', text: `${item.units} × ${stockById(item.stockItemId)?.product || 'Stock item'} sold`, sub: item.marketplace })),
    ...confirmedShipments.map(item => ({ date: item.createdAt, icon: item.direction === 'incoming' ? '↓' : '↑', text: `${item.itemName} shipment added`, sub: `${item.direction} · ${item.status.replace('_', ' ')}` })),
    ...confirmedStock.map(item => ({ date: item.createdAt, icon: '□', text: `${item.product} added`, sub: `${item.units} units · ${item.category}` }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
  $('#activity-list').innerHTML = activity.length
    ? activity.map(item => `<div class="activity"><i>${item.icon}</i><div><p>${esc(item.text)}</p><small>${esc(item.sub)}</small></div></div>`).join('')
    : '<p class="empty compact">Your stock, sales and shipments will appear here.</p>';
}

function renderCategoryChart(totalUnits) {
  const categoryTotals = records.stock.filter(item => item.dataStatus === 'verified' && !item.archivedAt).reduce((totals, item) => {
    const category = item.category || 'Uncategorised';
    totals[category] = (totals[category] || 0) + item.units;
    return totals;
  }, {});
  const categories = Object.entries(categoryTotals).filter(([, units]) => units > 0).sort((a, b) => b[1] - a[1]);
  const colours = ['#173126', '#cbe65e', '#d79b61', '#7ba5b8', '#b587a5', '#8da66b', '#e0c24f', '#6f7d9b'];
  let position = 0;
  const segments = categories.map(([, units], index) => {
    const start = position;
    position += totalUnits ? units / totalUnits * 100 : 0;
    return `${colours[index % colours.length]} ${start.toFixed(2)}% ${position.toFixed(2)}%`;
  });
  $('#category-chart').style.background = segments.length ? `conic-gradient(${segments.join(',')})` : '#e7ebe7';
  $('#chart-centre-value').textContent = number(totalUnits);
  $('#chart-total').textContent = `${number(totalUnits)} units`;
  $('#category-legend').innerHTML = categories.length
    ? categories.map(([category, units], index) => `<div><i style="background:${colours[index % colours.length]}"></i><span>${esc(category)}</span><strong>${number(units)}</strong></div>`).join('')
    : '<p class="empty compact">No stock categories yet.</p>';
}

function renderStock() {
  const activeStock = records.stock.filter(item => !item.archivedAt);
  $('#stock-table').innerHTML = activeStock.length
    ? activeStock.map(item => { const unitLanded = landedUnitCost(item, records.movements, records.expenses); const basis = purchasedUnitsFor(item.id, records.movements, item.units); const image = records.stockImages.find(photo => String(photo.stockItemId) === String(item.id)); return `<tr><td data-label="Product"><div class="stock-product-cell">${image?.url ? `<img src="${esc(image.url)}" alt="${esc(image.alt || item.product)}" loading="lazy">` : '<span class="stock-image-placeholder" aria-hidden="true">□</span>'}<div><strong>${esc(item.product)}</strong><small class="cell-detail">${records.stockImages.filter(photo => String(photo.stockItemId) === String(item.id)).length || 'No'} photo${records.stockImages.filter(photo => String(photo.stockItemId) === String(item.id)).length === 1 ? '' : 's'}</small></div></div></td><td data-label="Category"><span class="category-chip">${esc(item.category)}</span></td><td data-label="SKU">${esc(item.sku)}</td><td data-label="Status"><span class="data-status status-${esc(item.dataStatus)}">${esc(item.dataStatus)}</span></td><td data-label="Available"><strong>${number(item.units)}</strong></td><td data-label="Landed unit cost"><strong>${money(unitLanded)}</strong><small class="cell-detail">${money(item.unitCost)} product cost + allocated costs across ${number(basis)} purchased units</small></td><td data-label="Stock value">${money(currentProductCost(item))}</td><td data-label="Notes" class="notes-cell">${esc(item.notes || '—')}</td><td><div class="row-actions"><button class="primary-row-action" data-sell-stock="${item.id}" ${item.units < 1 ? 'disabled' : ''}>Mark sold</button>${actionMenu(`<button data-stock-expense="${item.id}">Add expense</button><button data-move-stock="${item.id}">Change stock</button><button data-edit-stock="${item.id}">Edit details & photos</button><button class="delete-row" data-archive-stock="${item.id}">Remove from active stock</button>`)}</div></td></tr>`; }).join('')
    : '<tr><td colspan="9" class="empty">No active stock records yet. Use “Add stock item” to create the first one.</td></tr>';

  const stockExpenses = records.expenses.filter(item => item.stockItemId && !item.archivedAt);
  $('#stock-expense-table').innerHTML = stockExpenses.length
    ? stockExpenses.map(item => { const stock = stockById(item.stockItemId); return `<tr><td>${shortDate(item.date)}</td><td><strong>${esc(stock?.product || 'Archived stock item')}</strong><small class="cell-detail">${esc(stock?.sku || '')}</small></td><td>${esc(item.description)}</td><td>${esc(item.category)}</td><td>${money(item.amount)}</td><td>${item.includeInLandedCost ? 'Included' : 'Cash only'}</td><td><span class="data-status status-${esc(item.dataStatus)}">${esc(item.dataStatus)}</span></td><td><button class="delete-row" data-archive-record="expense" data-record-id="${item.id}">Archive</button></td></tr>`; }).join('')
    : '<tr><td colspan="8" class="empty">No expenses are linked to stock yet.</td></tr>';
}

function renderSpending() {
  const groups = groupExpenses(records.expenses, $('#spending-period').value, $('#spending-confirmed-only').checked);
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  const count = groups.reduce((sum, group) => sum + group.count, 0);
  const highest = groups.reduce((best, group) => !best || group.total > best.total ? group : best, null);
  $('#spending-total').textContent = money(total);
  $('#spending-record-count').textContent = `${number(count)} expense ${count === 1 ? 'record' : 'records'}`;
  $('#spending-average').textContent = money(groups.length ? total / groups.length : 0);
  $('#spending-period-count').textContent = `${number(groups.length)} ${groups.length === 1 ? 'period' : 'periods'}`;
  $('#spending-highest').textContent = money(highest?.total || 0);
  $('#spending-highest-label').textContent = highest?.label || 'No records';
  $('#spending-table').innerHTML = groups.length
    ? groups.map(group => `<tr><td><strong>${esc(group.label)}</strong></td><td>${number(group.count)}</td><td>${esc(Object.entries(group.categories).sort((a, b) => b[1] - a[1]).map(([category, value]) => `${category}: ${money(value)}`).join(' · '))}</td><td><strong>${money(group.total)}</strong></td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">No matching expense records.</td></tr>';
}

function renderCalculator() {
  const result = calculateProfitability(Object.fromEntries(new FormData($('#profit-calculator'))));
  $('#calculator-verdict').textContent = result.verdict.label;
  $('#calculator-verdict').className = `calculator-verdict verdict-${result.verdict.state}`;
  $('#calc-profit').textContent = money(result.profit);
  $('#calc-unit-profit').textContent = `${money(result.profit / result.units)} per unit`;
  $('#calc-revenue').textContent = money(result.revenue);
  $('#calc-total-cost').textContent = money(result.totalCost);
  $('#calc-product-cost').textContent = money(result.productCost);
  $('#calc-shipping-cost').textContent = money(result.shippingCost);
  $('#calc-platform-fees').textContent = money(result.platformFixed + result.platformPercentage);
  $('#calc-other-cost').textContent = money(result.otherCost);
  $('#calc-margin').textContent = `${result.margin.toFixed(1)}%`;
  $('#calc-roi').textContent = `${result.roi.toFixed(1)}%`;
  $('#calc-break-even').textContent = Number.isFinite(result.breakEvenUnitPrice) ? `${money(result.breakEvenUnitPrice)} / unit` : 'Unavailable';
}

function updateStockCostPreview() {
  const form = $('#stock-form');
  const existing = stockById(form.elements.id.value);
  const units = existing ? purchasedUnitsFor(existing.id, records.movements, existing.units) : Number(form.elements.initialUnits.value);
  const preview = landedUnitCost({ id: existing?.id, units, unitCost: form.elements.unitCost.value, shippingPaid: form.elements.shippingPaid.value, otherFees: form.elements.otherFees.value }, existing ? records.movements : [], existing ? records.expenses : []);
  $('#stock-cost-preview strong').textContent = money(preview);
  $('#stock-cost-preview small').textContent = units > 0 ? `Based on ${number(units)} purchased units.` : 'Enter received units to allocate batch costs.';
}

function renderMovements() {
  $('#movement-table').innerHTML = records.movements.length
    ? records.movements.map(item => { const stock = stockById(item.stockItemId); return `<tr><td>${shortDate(item.occurredAt)}</td><td><strong>${esc(stock?.product || 'Stock item')}</strong><small class="cell-detail">${esc(stock?.sku || '')}</small></td><td>${esc(item.type.replace('_', ' '))}</td><td class="quantity-${item.quantityDelta > 0 ? 'positive' : 'negative'}">${item.quantityDelta > 0 ? '+' : ''}${number(item.quantityDelta)}</td><td><span class="data-status status-${esc(item.dataStatus)}">${esc(item.dataStatus)}</span></td><td class="notes-cell">${esc(item.reason)}</td></tr>`; }).join('')
    : '<tr><td colspan="6" class="empty">No inventory movements recorded yet.</td></tr>';
}

function renderSales() {
  const activeSales = records.sales.filter(sale => !sale.archivedAt);
  $('#sales-table').innerHTML = activeSales.length
    ? activeSales.map(sale => { const item = stockById(sale.stockItemId); return `<tr><td>${shortDate(sale.soldAt)}</td><td><strong>${esc(item?.product || 'Archived stock item')}</strong><small class="cell-detail">${esc(item?.sku || '')}</small></td><td>${esc(sale.marketplace)}</td><td>${number(sale.units)}</td><td>${money(sale.units * sale.unitSalePrice)}</td><td>${money(sale.marketplaceFees)}</td><td><span class="data-status status-${esc(sale.dataStatus)}">${esc(sale.dataStatus)}</span><button class="review-status" data-classify-record="stock_sale" data-record-id="${sale.id}" data-current-status="${esc(sale.dataStatus)}">Review</button></td><td class="notes-cell">${esc(sale.notes || '—')}</td><td><button class="delete-row" data-void-sale="${sale.id}">Remove</button></td></tr>`; }).join('')
    : '<tr><td colspan="9" class="empty">No sales recorded yet. Marking an item sold will add it here and reduce its available stock.</td></tr>';
}

function shipmentCard(item) {
  const statusLabel = item.status.replace('_', ' ');
  const nextStatus = item.status === 'planned' ? 'in_transit' : item.status === 'in_transit' ? 'delivered' : '';
  const events = records.trackingEvents.filter(event => String(event.shipmentId) === String(item.id)).slice(0, 4);
  const tracking = item.finalMileTrackingNumber || item.trackingNumber;
  return `<div class="shipment-card"><div class="shipment-card-top"><span><span class="status-badge status-${item.status}">${esc(statusLabel)}</span> <span class="data-status status-${esc(item.dataStatus)}">${esc(item.dataStatus)}</span></span><span>${number(item.units)} units</span></div><h4>${esc(item.itemName)}</h4><p>${esc(item.category)}</p><dl><div><dt>Route</dt><dd>${esc(item.origin || 'Not set')} → ${esc(item.destination || 'Not set')}</dd></div><div><dt>Expected</dt><dd>${shortDate(item.expectedDate)}</dd></div><div><dt>International</dt><dd>${esc(item.carrier || 'Not set')}${item.trackingNumber ? ` · <span class="tracking-number">${esc(item.trackingNumber)}</span>` : ''}</dd></div><div><dt>Final mile</dt><dd>${esc(item.finalMileCarrier || 'Not set')}${item.finalMileTrackingNumber ? ` · <span class="tracking-number">${esc(item.finalMileTrackingNumber)}</span>` : ''}</dd></div></dl><div class="tracking-panel"><div class="tracking-panel-head"><strong>Tracking updates</strong><button data-add-tracking="${item.id}">+ Add update</button></div>${events.length ? `<ol class="tracking-timeline">${events.map((event, index) => `<li class="${index === 0 ? 'latest' : ''}"><i></i><div><strong>${esc(event.status.replaceAll('_', ' '))}</strong><p>${esc(event.description)}</p><small>${event.location ? `${esc(event.location)} · ` : ''}${shortDate(event.occurredAt)}</small></div></li>`).join('')}</ol>` : `<p class="tracking-empty">${tracking ? 'No tracking events saved yet.' : 'Add a tracking number or a manual update.'}</p>`}</div>${item.notes ? `<p class="shipment-notes">${esc(item.notes)}</p>` : ''}<div class="row-actions">${nextStatus ? `<button class="primary-row-action" data-shipment-status="${item.id}" data-next-status="${nextStatus}">${nextStatus === 'in_transit' ? 'Mark in transit' : 'Mark delivered'}</button>` : ''}${actionMenu(`<button data-edit-shipment="${item.id}">Edit shipment</button><button data-classify-record="shipment" data-record-id="${item.id}" data-current-status="${esc(item.dataStatus)}">Review status</button><button class="delete-row" data-archive-record="shipment" data-record-id="${item.id}">Archive shipment</button>`)}</div></div>`;
}

function actionMenu(actions) {
  return `<details class="action-menu"><summary aria-label="More actions" title="More actions"><span aria-hidden="true">•••</span></summary><div class="action-sheet" role="group">${actions}</div></details>`;
}

function renderActorBadges() {
  const targets = [
    ['[data-edit-stock]', records.stock, 'editStock', 'tr', '.stock-product-cell strong'],
    ['[data-edit-expense]', records.expenses, 'editExpense', 'tr', 'td strong'],
    ['[data-void-sale]', records.sales, 'voidSale', 'tr', 'td strong'],
    ['[data-edit-shipment]', records.shipments, 'editShipment', '.shipment-card', 'h4'],
    ['[data-edit-income]', records.income, 'editIncome', 'tr', 'td strong']
  ];
  targets.forEach(([selector, collection, dataKey, containerSelector, labelSelector]) => {
    document.querySelectorAll(selector).forEach(control => {
      const item = collection.find(record => String(record.id) === String(control.dataset[dataKey]));
      const label = control.closest(containerSelector)?.querySelector(labelSelector);
      if (item && label && !label.querySelector('.record-actor')) label.insertAdjacentHTML('beforeend', actorBadge(item));
    });
  });
}

function renderShipments() {
  for (const direction of ['incoming', 'outgoing']) {
    const items = records.shipments.filter(item => item.direction === direction && !item.archivedAt);
    $(`#${direction}-shipments`).innerHTML = items.length
      ? items.map(shipmentCard).join('')
      : `<p class="empty">No ${direction} shipments yet.</p>`;
  }
}

function renderExpenses() {
  const activeExpenses = records.expenses.filter(item => !item.archivedAt);
  const performance = businessPerformance(records.stock, records.sales, records.expenses, records.movements);
  const categories = categorySpend(records.expenses);
  const categoryTotal = categories.reduce((sum, item) => sum + item.total, 0);
  $('#expense-turnover').textContent = money(performance.turnover);
  $('#expense-recorded-spend').textContent = money(performance.recordedSpend);
  $('#expense-estimated-profit').textContent = money(performance.estimatedProfit);
  $('#expense-estimated-profit').classList.toggle('negative-value', performance.estimatedProfit < 0);
  $('#expense-return-on-spend').textContent = `${performance.returnOnSpend.toFixed(1)}%`;
  $('#expense-return-on-spend').classList.toggle('negative-value', performance.returnOnSpend < 0);
  $('#expense-category-total').textContent = money(categoryTotal);
  renderDonut('#expense-category-chart', '#expense-category-centre', '#expense-category-legend', categories, categoryTotal);
  const bars = [
    ['Turnover', performance.turnover],
    ['Cost of goods', performance.estimatedCostOfGoods],
    ['Operating spend', performance.operatingSpend],
    ['Estimated profit', performance.estimatedProfit]
  ];
  const scale = Math.max(1, ...bars.map(([, value]) => Math.abs(value)));
  $('#expense-performance-bars').innerHTML = bars.map(([label, value], index) => `<div><span>${esc(label)}</span><div><i class="${value < 0 ? 'negative' : ''}" style="width:${Math.max(2, Math.abs(value) / scale * 100)}%;background:${chartColours[index % chartColours.length]}"></i></div><strong class="${value < 0 ? 'negative-value' : ''}">${money(value)}</strong></div>`).join('');
  $('#expense-table').innerHTML = activeExpenses.length
    ? activeExpenses.map(item => { const stock = stockById(item.stockItemId); const reference = item.paymentReference || (item.externalTransactionId ? 'Bank payment linked' : '—'); return `<tr><td><strong>${esc(item.description)}</strong>${item.sourceProvider === 'monzo' ? '<small class="cell-detail">Matched to Monzo</small>' : ''}</td><td>${esc(item.category)}</td><td><strong>${esc(reference)}</strong>${item.externalTransactionId ? '<small class="cell-detail">Reconciled</small>' : ''}</td><td>${stock ? `<strong>${esc(stock.product)}</strong><small class="cell-detail">${item.includeInLandedCost ? 'Included in landed cost' : 'Linked only'}</small>` : '—'}</td><td>${shortDate(item.date)}</td><td>${money(item.amount)}</td><td><span class="data-status status-${esc(item.dataStatus)}">${esc(item.dataStatus)}</span><button class="review-status" data-classify-record="expense" data-record-id="${item.id}" data-current-status="${esc(item.dataStatus)}">Review</button></td><td>${actionMenu(`<button data-edit-expense="${item.id}">Edit & reconcile</button><button class="delete-row" data-archive-record="expense" data-record-id="${item.id}">Archive</button>`)}</td></tr>`; }).join('')
    : '<tr><td colspan="8" class="empty">No expenses recorded yet.</td></tr>';
}

function openExpense(stockItemId = '', expense = null, transaction = null) {
  const form = $('#expense-form');
  form.reset();
  const linkedTransaction = transaction || bankTransactions.find(item => item.id === expense?.externalTransactionId) || null;
  form.elements.id.value = expense?.id || '';
  form.elements.externalTransactionId.value = expense?.externalTransactionId || linkedTransaction?.id || '';
  form.elements.description.value = expense?.description || linkedTransaction?.merchant || linkedTransaction?.description || '';
  const category = expense?.category || (linkedTransaction?.description?.toLowerCase().includes('amazon') ? 'Amazon selling fees' : 'Other');
  if (![...form.elements.category.options].some(option => option.value === category)) form.elements.category.add(new Option(category, category));
  form.elements.category.value = category;
  form.elements.date.value = expense?.date || String(linkedTransaction?.settled || linkedTransaction?.created || new Date().toISOString()).slice(0, 10);
  form.elements.amount.value = expense?.amount ?? (linkedTransaction ? Math.abs(Number(linkedTransaction.amount) || 0) / 100 : '');
  form.elements.paymentReference.value = expense?.paymentReference || linkedTransaction?.notes || linkedTransaction?.description || '';
  form.elements.dataStatus.value = expense?.dataStatus || (linkedTransaction ? 'verified' : 'unverified');
  const activeStock = records.stock.filter(item => !item.archivedAt);
  const selectedStockId = expense?.stockItemId || stockItemId;
  form.elements.stockItemId.innerHTML = `<option value="">General expense — no stock link</option>${activeStock.map(item => `<option value="${item.id}" ${String(item.id) === String(selectedStockId) ? 'selected' : ''}>${esc(item.product)} — ${esc(item.sku)}</option>`).join('')}`;
  form.elements.includeInLandedCost.checked = expense?.includeInLandedCost ?? Boolean(stockItemId);
  const currentTransactionId = expense?.externalTransactionId || linkedTransaction?.id || '';
  const availableTransactions = bankTransactions.filter(item => !bankExpense(item.id) || item.id === currentTransactionId);
  form.elements.bankTransactionId.innerHTML = `<option value="">No bank payment linked</option>${availableTransactions.map(item => `<option value="${esc(item.id)}" ${item.id === currentTransactionId ? 'selected' : ''}>${esc(item.merchant || item.description)} — ${moneyMinor(Math.abs(item.amount), item.currency)} — ${shortDate(item.settled || item.created)}</option>`).join('')}`;
  form.elements.bankTransactionId.disabled = workspaceRole !== 'owner' || !bankLoaded;
  form.elements.paymentReference.disabled = workspaceRole !== 'owner' && Boolean(currentTransactionId);
  $('#expense-modal-title').textContent = expense ? 'Edit expense' : linkedTransaction ? 'Create expense from payment' : 'Add expense';
  prepareDialog(dialogs.expense);
}

function openIncome(income = null, transaction = null) {
  const form = $('#income-form');
  form.reset();
  const linkedTransaction = transaction || bankIncomeTransactions.find(item => item.id === income?.externalTransactionId) || null;
  form.elements.id.value = income?.id || '';
  form.elements.externalTransactionId.value = income?.externalTransactionId || linkedTransaction?.id || '';
  form.elements.description.value = income?.description || linkedTransaction?.merchant || linkedTransaction?.description || '';
  form.elements.category.value = income?.category || (linkedTransaction?.isRefund ? 'Refund or rebate' : 'Sales revenue');
  form.elements.date.value = income?.date || String(linkedTransaction?.settled || linkedTransaction?.created || new Date().toISOString()).slice(0, 10);
  form.elements.amount.value = income?.amount ?? (linkedTransaction ? Math.abs(Number(linkedTransaction.amount) || 0) / 100 : '');
  form.elements.paymentReference.value = income?.paymentReference || linkedTransaction?.notes || linkedTransaction?.description || '';
  form.elements.notes.value = income?.notes || '';
  form.elements.dataStatus.value = income?.dataStatus || (linkedTransaction ? 'verified' : 'unverified');
  const currentTransactionId = income?.externalTransactionId || linkedTransaction?.id || '';
  const available = bankIncomeTransactions.filter(item => !bankIncomeRecord(item.id) || item.id === currentTransactionId);
  form.elements.bankTransactionId.innerHTML = `<option value="">No bank payment linked</option>${available.map(item => `<option value="${esc(item.id)}" ${item.id === currentTransactionId ? 'selected' : ''}>${esc(item.merchant || item.description)} — ${moneyMinor(Math.abs(item.amount), item.currency)} — ${shortDate(item.settled || item.created)}</option>`).join('')}`;
  form.elements.bankTransactionId.disabled = workspaceRole !== 'owner' || !bankLoaded;
  $('#income-modal-title').textContent = income ? 'Edit income details' : linkedTransaction ? 'Classify incoming payment' : 'Add income details';
  prepareDialog(dialogs.income);
}

function renderSaleOptions(selectedId = '') {
  const available = records.stock.filter(item => item.units > 0 && !item.archivedAt);
  $('#sale-stock-item').innerHTML = available.length
    ? available.map(item => `<option value="${item.id}" ${String(item.id) === String(selectedId) ? 'selected' : ''}>${esc(item.product)} — ${esc(item.sku)} (${number(item.units)} available)</option>`).join('')
    : '<option value="">No stock is currently available</option>';
}

function bindRenderedActions() {
  renderActorBadges();
  document.querySelectorAll('[data-edit-stock]').forEach(button => button.onclick = () => openStock(stockById(button.dataset.editStock)));
  document.querySelectorAll('[data-sell-stock]').forEach(button => button.onclick = () => openSale(button.dataset.sellStock));
  document.querySelectorAll('[data-move-stock]').forEach(button => button.onclick = () => openMovement(stockById(button.dataset.moveStock)));
  document.querySelectorAll('[data-stock-expense]').forEach(button => button.onclick = () => openExpense(button.dataset.stockExpense));
  document.querySelectorAll('[data-edit-expense]').forEach(button => button.onclick = () => openExpense('', records.expenses.find(item => String(item.id) === button.dataset.editExpense)));
  document.querySelectorAll('[data-bank-expense]').forEach(button => { button.onclick = () => { const transaction = bankTransactions.find(item => item.id === button.dataset.bankExpense); openExpense('', bankExpense(button.dataset.bankExpense), transaction); }; });
  document.querySelectorAll('[data-bank-income]').forEach(button => { button.onclick = () => { const transaction = bankIncomeTransactions.find(item => item.id === button.dataset.bankIncome); openIncome(bankIncomeRecord(button.dataset.bankIncome), transaction); }; });
  document.querySelectorAll('[data-edit-income]').forEach(button => button.onclick = () => openIncome(records.income.find(item => String(item.id) === button.dataset.editIncome)));
  document.querySelectorAll('[data-archive-income]').forEach(button => button.onclick = () => archiveIncome(button.dataset.archiveIncome));
  document.querySelectorAll('[data-archive-stock]').forEach(button => button.onclick = () => archiveStock(button.dataset.archiveStock));
  document.querySelectorAll('[data-edit-shipment]').forEach(button => button.onclick = () => openShipment(records.shipments.find(item => String(item.id) === button.dataset.editShipment)));
  document.querySelectorAll('[data-add-tracking]').forEach(button => button.onclick = () => openTracking(records.shipments.find(item => String(item.id) === button.dataset.addTracking)));
  document.querySelectorAll('[data-archive-record]').forEach(button => button.onclick = () => archiveBusinessRecord(button.dataset.archiveRecord, button.dataset.recordId));
  document.querySelectorAll('[data-void-sale]').forEach(button => button.onclick = () => voidSale(button.dataset.voidSale));
  document.querySelectorAll('[data-shipment-status]').forEach(button => button.onclick = () => updateShipmentStatus(button.dataset.shipmentStatus, button.dataset.nextStatus));
  document.querySelectorAll('[data-classify-record]').forEach(button => button.onclick = () => classifyRecord(button.dataset.classifyRecord, button.dataset.recordId, button.dataset.currentStatus));
}

function render() {
  renderDashboard();
  renderStock();
  renderMovements();
  renderSales();
  renderShipments();
  renderExpenses();
  renderSpending();
  renderCalculator();
  renderSaleOptions();
  if (bankLoaded) {
    renderBankTransactions('#bank-payments', bankTransactions, 'No recent outgoing payments were returned.');
    renderBankIncomeTransactions(bankIncomeTransactions);
    renderBankSpendChart(bankTransactions);
    renderBankIncomeChart();
    renderIncomeLedger();
  }
  bindRenderedActions();
}

function prepareDialog(dialog) {
  dialog.querySelector('[data-form-message]').textContent = '';
  dialog.showModal();
}

function openStock(item = null) {
  const form = $('#stock-form');
  form.reset();
  form.elements.id.value = item?.id || '';
  form.elements.product.value = item?.product || '';
  form.elements.category.value = item?.category || '';
  form.elements.sku.value = item?.sku || '';
  form.elements.initialUnits.value = item ? 0 : 0;
  form.elements.initialUnits.disabled = Boolean(item);
  form.querySelector('.initial-units-field').hidden = Boolean(item);
  form.elements.unitCost.value = item?.unitCost ?? '';
  form.elements.shippingPaid.value = item?.shippingPaid ?? 0;
  form.elements.otherFees.value = item?.otherFees ?? 0;
  form.elements.notes.value = item?.notes || '';
  form.elements.dataStatus.value = item?.dataStatus || 'unverified';
  form.elements.images.value = '';
  const images = item ? records.stockImages.filter(image => String(image.stockItemId) === String(item.id)) : [];
  $('#stock-image-preview').innerHTML = images.length
    ? images.map(image => `<figure><img src="${esc(image.url)}" alt="${esc(image.alt || item.product)}"><figcaption>Saved photo</figcaption></figure>`).join('')
    : '<p>No photos saved yet.</p>';
  $('#stock-modal-title').textContent = item ? 'Update stock details' : 'Add stock item';
  updateStockCostPreview();
  prepareDialog(dialogs.stock);
}

function openMovement(item) {
  const form = $('#movement-form');
  form.reset();
  form.elements.stockItemId.value = item.id;
  form.elements.dataStatus.value = item.dataStatus || 'unverified';
  $('#movement-product').textContent = `${item.product} · ${number(item.units)} currently available`;
  prepareDialog(dialogs.movement);
}

function openSale(stockItemId = '') {
  const form = $('#sale-form');
  form.reset();
  renderSaleOptions(stockItemId);
  form.elements.marketplaceFees.value = 0;
  prepareDialog(dialogs.sale);
}

function openShipment(item = null) {
  const form = $('#shipment-form');
  form.reset();
  form.elements.id.value = item?.id || '';
  form.elements.direction.value = item?.direction || 'incoming';
  form.elements.status.value = item?.status || 'planned';
  form.elements.itemName.value = item?.itemName || '';
  form.elements.category.value = item?.category || '';
  form.elements.units.value = item?.units ?? '';
  form.elements.expectedDate.value = item?.expectedDate || '';
  form.elements.origin.value = item?.origin || '';
  form.elements.destination.value = item?.destination || '';
  form.elements.carrier.value = item?.carrier || '';
  form.elements.trackingNumber.value = item?.trackingNumber || '';
  form.elements.finalMileCarrier.value = item?.finalMileCarrier || '';
  form.elements.finalMileTrackingNumber.value = item?.finalMileTrackingNumber || '';
  form.elements.shippingCost.value = item?.shippingCost ?? 0;
  form.elements.dataStatus.value = item?.dataStatus || 'unverified';
  form.elements.notes.value = item?.notes || '';
  $('#shipment-modal-title').textContent = item ? 'Update shipment' : 'Add shipment';
  prepareDialog(dialogs.shipment);
}

function openTracking(item) {
  const form = $('#tracking-form');
  form.reset();
  form.elements.shipmentId.value = item.id;
  form.elements.occurredAt.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $('#tracking-shipment').textContent = `${item.itemName} · ${item.carrier || item.finalMileCarrier || 'carrier not set'}`;
  prepareDialog(dialogs.tracking);
}

async function uploadStockImages(stockItemId, productName, files) {
  const existingCount = records.stockImages.filter(image => String(image.stockItemId) === String(stockItemId)).length;
  if (existingCount + files.length > 4) throw new Error(`A stock item can have up to 4 photos. It already has ${existingCount}.`);
  for (const file of files) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${file.name} is not a supported image type.`);
    if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} is larger than 5 MB.`);
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${workspaceId}/${stockItemId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from('stock-images').upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error: metadataError } = await supabase.from('stock_images').insert({
      workspace_id: workspaceId, stock_item_id: Number(stockItemId), storage_path: path,
      alt_text: productName, sort_order: existingCount
    });
    if (metadataError) {
      await supabase.storage.from('stock-images').remove([path]);
      throw metadataError;
    }
  }
}

async function saveForm(form, query, successMessage, dialog) {
  const button = form.querySelector('[type="submit"]');
  const message = form.querySelector('[data-form-message]');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Saving…';
  message.textContent = '';
  const { error } = await query;
  button.disabled = false;
  button.textContent = original;
  if (error) {
    message.textContent = error.code === '23505' ? 'That SKU already exists in this workspace.' : error.message;
    return;
  }
  dialog.close();
  setStatus('Refreshing data');
  await loadWorkspaceData();
  setStatus('Cloud data connected', 'connected');
  showMessage(successMessage, 'success');
}

$('#stock-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const id = values.get('id');
  const payload = {
    product_name: String(values.get('product')).trim(),
    category: String(values.get('category')).trim(),
    sku: String(values.get('sku')).trim(),
    unit_cost: Number(values.get('unitCost')),
    shipping_paid: Number(values.get('shippingPaid')),
    other_fees: Number(values.get('otherFees')),
    notes: String(values.get('notes')).trim(),
    data_status: String(values.get('dataStatus'))
  };
  const query = id
    ? supabase.from('stock_items').update(payload).eq('id', id).eq('workspace_id', workspaceId).select('id').single()
    : supabase.rpc('create_stock_item', {
        p_workspace_id: workspaceId,
        p_product_name: payload.product_name,
        p_category: payload.category,
        p_sku: payload.sku,
        p_initial_units: Number(values.get('initialUnits')),
        p_unit_cost: payload.unit_cost,
        p_shipping_paid: payload.shipping_paid,
        p_other_fees: payload.other_fees,
        p_notes: payload.notes,
        p_data_status: payload.data_status
      });
  const button = form.querySelector('[type="submit"]');
  const message = form.querySelector('[data-form-message]');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Saving…';
  message.textContent = '';
  const { data, error } = await query;
  if (error) {
    button.disabled = false;
    button.textContent = original;
    message.textContent = error.code === '23505' ? 'That SKU already exists in this workspace.' : error.message;
    return;
  }
  const stockItemId = id || data?.id || data;
  try {
    await uploadStockImages(stockItemId, payload.product_name, [...form.elements.images.files]);
  } catch (imageError) {
    button.disabled = false;
    button.textContent = original;
    message.textContent = `The stock record was saved, but its photo was not: ${imageError.message}`;
    await loadWorkspaceData();
    return;
  }
  button.disabled = false;
  button.textContent = original;
  dialogs.stock.close();
  setStatus('Refreshing data');
  await loadWorkspaceData();
  setStatus('Cloud data connected', 'connected');
  showMessage(id ? 'Stock details and photos updated.' : 'Stock item, photos and initial receipt recorded.', 'success');
});

$('#sale-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const query = supabase.from('stock_sales').insert({
    workspace_id: workspaceId,
    stock_item_id: Number(values.get('stockItemId')),
    units: Number(values.get('units')),
    unit_sale_price: Number(values.get('unitSalePrice')),
    marketplace: String(values.get('marketplace')),
    marketplace_fees: Number(values.get('marketplaceFees')),
    data_status: String(values.get('dataStatus')),
    notes: String(values.get('notes')).trim()
  });
  await saveForm(form, query, 'Sale recorded and available stock reduced.', dialogs.sale);
});

$('#movement-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const movementType = String(values.get('movementType'));
  const quantity = Number(values.get('quantity'));
  if (movementType !== 'adjustment' && quantity < 1) {
    form.querySelector('[data-form-message]').textContent = 'Receipts and returns must use a positive quantity.';
    return;
  }
  const query = supabase.rpc('record_inventory_movement', {
    p_stock_item_id: Number(values.get('stockItemId')),
    p_movement_type: movementType,
    p_quantity: quantity,
    p_reason: String(values.get('reason')).trim(),
    p_data_status: String(values.get('dataStatus'))
  });
  await saveForm(form, query, 'Inventory movement recorded.', dialogs.movement);
});

$('#shipment-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const id = values.get('id');
  const payload = {
    workspace_id: workspaceId,
    direction: String(values.get('direction')),
    status: String(values.get('status')),
    item_name: String(values.get('itemName')).trim(),
    category: String(values.get('category')).trim(),
    units: Number(values.get('units')),
    expected_date: values.get('expectedDate') || null,
    origin: String(values.get('origin')).trim(),
    destination: String(values.get('destination')).trim(),
    carrier: String(values.get('carrier')).trim(),
    tracking_number: String(values.get('trackingNumber')).trim(),
    final_mile_carrier: String(values.get('finalMileCarrier')).trim(),
    final_mile_tracking_number: String(values.get('finalMileTrackingNumber')).trim(),
    shipping_cost: Number(values.get('shippingCost')),
    data_status: String(values.get('dataStatus')),
    notes: String(values.get('notes')).trim()
  };
  const query = id ? supabase.from('shipments').update(payload).eq('id', id).eq('workspace_id', workspaceId) : supabase.from('shipments').insert(payload);
  await saveForm(form, query, id ? 'Shipment updated.' : 'Shipment added.', dialogs.shipment);
});

$('#tracking-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const status = String(values.get('eventStatus'));
  const query = supabase.from('shipment_tracking_events').insert({
    workspace_id: workspaceId,
    shipment_id: Number(values.get('shipmentId')),
    event_status: status,
    description: String(values.get('description')).trim(),
    location: String(values.get('location')).trim(),
    occurred_at: new Date(String(values.get('occurredAt'))).toISOString(),
    source: 'manual'
  });
  await saveForm(form, query, 'Tracking update added.', dialogs.tracking);
});

$('#expense-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const id = values.get('id');
  const stockItemId = values.get('stockItemId');
  const includeInLandedCost = values.get('includeInLandedCost') === 'on';
  if (includeInLandedCost && !stockItemId) {
    form.querySelector('[data-form-message]').textContent = 'Choose a stock item before including an expense in landed cost.';
    return;
  }
  const payload = {
    description: String(values.get('description')).trim(),
    category: String(values.get('category')),
    expense_date: String(values.get('date')),
    amount: Number(values.get('amount')),
    stock_item_id: stockItemId ? Number(stockItemId) : null,
    include_in_landed_cost: includeInLandedCost,
    payment_reference: String(form.elements.paymentReference.value || '').trim() || null
  };
  const selectedTransactionId = String(form.elements.bankTransactionId.value || '');
  const existingTransactionId = String(values.get('externalTransactionId') || '');
  const usesBankReconciliation = workspaceRole === 'owner' && (selectedTransactionId || existingTransactionId);
  const query = usesBankReconciliation
    ? supabase.rpc('save_bank_expense', {
      p_workspace_id: workspaceId,
      p_expense_id: id ? Number(id) : null,
      p_description: payload.description,
      p_category: payload.category,
      p_expense_date: payload.expense_date,
      p_amount: payload.amount,
      p_stock_item_id: payload.stock_item_id,
      p_include_in_landed_cost: payload.include_in_landed_cost,
      p_data_status: String(values.get('dataStatus')),
      p_external_transaction_id: selectedTransactionId || null,
      p_payment_reference: payload.payment_reference
    })
    : id
      ? supabase.from('expenses').update(payload).eq('id', id).eq('workspace_id', workspaceId)
      : supabase.from('expenses').insert({ ...payload, workspace_id: workspaceId, data_status: String(values.get('dataStatus')) });
  await saveForm(form, query, id ? 'Expense updated.' : selectedTransactionId ? 'Payment linked and expense created.' : 'Expense saved.', dialogs.expense);
});

$('#income-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const id = values.get('id');
  const selectedTransactionId = String(form.elements.bankTransactionId.value || '');
  const query = supabase.rpc('save_bank_income', {
    p_workspace_id: workspaceId,
    p_income_id: id ? Number(id) : null,
    p_description: String(values.get('description')).trim(),
    p_category: String(values.get('category')),
    p_income_date: String(values.get('date')),
    p_amount: Number(values.get('amount')),
    p_payment_reference: String(values.get('paymentReference')).trim() || null,
    p_notes: String(values.get('notes')).trim(),
    p_data_status: String(values.get('dataStatus')),
    p_external_transaction_id: selectedTransactionId || null
  });
  await saveForm(form, query, id ? 'Income details updated.' : selectedTransactionId ? 'Incoming payment classified.' : 'Income recorded.', dialogs.income);
});

async function updateShipmentStatus(id, status) {
  setStatus('Saving changes');
  const { error } = await supabase.from('shipments').update({ status }).eq('id', id).eq('workspace_id', workspaceId);
  if (error) {
    setStatus('Save failed', 'error');
    showMessage(error.message, 'error');
    return;
  }
  await loadWorkspaceData();
  setStatus('Cloud data connected', 'connected');
  showMessage(status === 'delivered' ? 'Shipment marked delivered.' : 'Shipment marked in transit.', 'success');
}

async function archiveStock(id) {
  const item = stockById(id);
  const remaining = Number(item?.units || 0);
  const reason = window.prompt(remaining > 0
    ? `Remove this item from active records? Its remaining ${number(remaining)} units will be recorded as a removal adjustment. Enter a reason:`
    : 'Remove this item from active records? Enter a reason:');
  if (reason === null) return;
  if (reason.trim().length < 3) {
    showMessage('Enter a removal reason of at least 3 characters.', 'error');
    return;
  }
  setStatus('Saving changes');
  const { error } = await supabase.rpc('archive_stock_item', { p_stock_item_id: Number(id), p_reason: reason.trim() });
  if (error) {
    setStatus('Save failed', 'error');
    showMessage(error.message, 'error');
    return;
  }
  await loadWorkspaceData();
  setStatus('Cloud data connected', 'connected');
  showMessage('Stock item removed from active records. Its history has been preserved.', 'success');
}

async function classifyRecord(recordType, recordId, currentStatus) {
  const suggestedStatus = currentStatus === 'demonstration' ? 'unverified' : currentStatus;
  const status = window.prompt('Set record status: verified or unverified', suggestedStatus);
  if (status === null) return;
  const normalized = status.trim().toLowerCase();
  if (!['verified', 'unverified'].includes(normalized)) {
    showMessage('Status must be verified or unverified.', 'error');
    return;
  }
  setStatus('Saving changes');
  const { error } = await supabase.rpc('set_record_data_status', {
    p_record_type: recordType,
    p_record_id: Number(recordId),
    p_data_status: normalized
  });
  if (error) {
    setStatus('Save failed', 'error');
    showMessage(error.message, 'error');
    return;
  }
  await loadWorkspaceData();
  setStatus('Cloud data connected', 'connected');
  showMessage('Record status updated after review.', 'success');
}

async function archiveBusinessRecord(recordType, recordId) {
  const reason = window.prompt(`Why is this ${recordType} being archived?`);
  if (reason === null) return;
  if (reason.trim().length < 3) {
    showMessage('Enter an archive reason of at least 3 characters.', 'error');
    return;
  }
  setStatus('Saving changes');
  const { error } = await supabase.rpc('archive_business_record', {
    p_record_type: recordType,
    p_record_id: Number(recordId),
    p_reason: reason.trim()
  });
  if (error) {
    setStatus('Save failed', 'error');
    showMessage(error.message, 'error');
    return;
  }
  await loadWorkspaceData();
  setStatus('Cloud data connected', 'connected');
  showMessage('Record archived. Its history has been preserved.', 'success');
}

async function archiveIncome(id) {
  const reason = window.prompt('Why is this income record being archived?');
  if (reason === null) return;
  if (reason.trim().length < 3) return showMessage('Enter an archive reason of at least 3 characters.', 'error');
  setStatus('Saving changes');
  const { error } = await supabase.rpc('archive_income_record', { p_income_id: Number(id), p_reason: reason.trim() });
  if (error) {
    setStatus('Save failed', 'error');
    return showMessage(error.message, 'error');
  }
  await loadWorkspaceData();
  setStatus('Cloud data connected', 'connected');
  showMessage('Income record archived; its history has been preserved.', 'success');
}

async function voidSale(recordId) {
  const reason = window.prompt('Why is this sale being removed? Its stock will be restored.');
  if (reason === null) return;
  if (reason.trim().length < 3) {
    showMessage('Enter a removal reason of at least 3 characters.', 'error');
    return;
  }
  if (!window.confirm('Remove this sale and restore its units to available stock?')) return;
  setStatus('Saving changes');
  const { error } = await supabase.rpc('void_stock_sale', {
    p_sale_id: Number(recordId),
    p_reason: reason.trim()
  });
  if (error) {
    setStatus('Save failed', 'error');
    showMessage(error.message, 'error');
    return;
  }
  await loadWorkspaceData();
  setStatus('Cloud data connected', 'connected');
  showMessage('Sale removed and its stock restored. History has been preserved.', 'success');
}

async function signOut() {
  await supabase.auth.signOut();
  window.location.replace('login.html');
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => view(button.dataset.view)));
document.querySelectorAll('select[name="dataStatus"] option[value="demonstration"]').forEach(option => option.remove());
document.querySelectorAll('[data-view-jump]').forEach(button => button.addEventListener('click', () => view(button.dataset.viewJump)));
document.querySelectorAll('[data-open-stock]').forEach(button => button.addEventListener('click', () => openStock()));
document.querySelectorAll('[data-open-sale]').forEach(button => button.addEventListener('click', () => openSale()));
document.querySelectorAll('[data-open-shipment]').forEach(button => button.addEventListener('click', () => openShipment()));
document.querySelectorAll('[data-open-expense]').forEach(button => button.addEventListener('click', () => openExpense()));
document.querySelectorAll('[data-open-income]').forEach(button => button.addEventListener('click', () => openIncome()));
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('#profit-calculator').addEventListener('input', renderCalculator);
$('#profit-calculator').addEventListener('change', renderCalculator);
$('#spending-period').addEventListener('change', renderSpending);
$('#spending-confirmed-only').addEventListener('change', renderSpending);
$('#expense-form').elements.stockItemId.addEventListener('change', event => {
  if (!event.currentTarget.value) $('#expense-form').elements.includeInLandedCost.checked = false;
});

$('#expense-form').elements.bankTransactionId.addEventListener('change', event => {
  const form = $('#expense-form');
  const transaction = bankTransactions.find(item => item.id === event.currentTarget.value);
  form.elements.externalTransactionId.value = transaction?.id || '';
  if (!transaction) return;
  form.elements.description.value = transaction.merchant || transaction.description || form.elements.description.value;
  form.elements.amount.value = Math.abs(Number(transaction.amount) || 0) / 100;
  form.elements.date.value = String(transaction.settled || transaction.created || form.elements.date.value).slice(0, 10);
  form.elements.paymentReference.value = transaction.notes || transaction.description || '';
  form.elements.dataStatus.value = 'verified';
});
$('#income-form').elements.bankTransactionId.addEventListener('change', event => {
  const form = $('#income-form');
  const transaction = bankIncomeTransactions.find(item => item.id === event.currentTarget.value);
  form.elements.externalTransactionId.value = transaction?.id || '';
  if (!transaction) return;
  form.elements.description.value = transaction.merchant || transaction.description || form.elements.description.value;
  form.elements.amount.value = Math.abs(Number(transaction.amount) || 0) / 100;
  form.elements.date.value = String(transaction.settled || transaction.created || form.elements.date.value).slice(0, 10);
  form.elements.paymentReference.value = transaction.notes || transaction.description || '';
  form.elements.dataStatus.value = 'verified';
});
['initialUnits', 'unitCost', 'shippingPaid', 'otherFees'].forEach(name => $('#stock-form').elements[name].addEventListener('input', updateStockCostPreview));
$('#stock-form').elements.images.addEventListener('change', event => {
  const files = [...event.currentTarget.files];
  if (files.length > 4) {
    event.currentTarget.value = '';
    $('#stock-image-preview').innerHTML = '<p class="form-error">Choose no more than 4 photos.</p>';
    return;
  }
  $('#stock-image-preview').innerHTML = files.length
    ? files.map(file => `<figure><img src="${URL.createObjectURL(file)}" alt="Preview of ${esc(file.name)}"><figcaption>${esc(file.name)}</figcaption></figure>`).join('')
    : '<p>No new photos selected.</p>';
});
$('#sign-out').addEventListener('click', signOut);
$('#error-sign-out').addEventListener('click', signOut);
$('#refresh-bank').addEventListener('click', () => loadBankSummary(true));

const profileSetupDialog = $('#profile-setup-modal');
profileSetupDialog.addEventListener('cancel', event => event.preventDefault());
$('#profile-setup-form').elements.avatar.addEventListener('change', event => {
  const file = event.currentTarget.files?.[0];
  $('#profile-setup-preview').innerHTML = file ? `<img src="${URL.createObjectURL(file)}" alt="Profile picture preview"><span>${esc(file.name)}</span>` : 'No picture selected';
});
$('#profile-setup-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.querySelector('[data-form-message]');
  const button = form.querySelector('button[type="submit"]');
  const file = form.elements.avatar.files?.[0];
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return message.textContent = 'Choose a JPG, PNG or WebP image.';
  if (file.size > 5 * 1024 * 1024) return message.textContent = 'Profile pictures must be 5 MB or smaller.';
  const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[file.type];
  const path = `${workspaceId}/${currentUserId}/${crypto.randomUUID()}.${extension}`;
  button.disabled = true;
  button.textContent = 'Saving picture…';
  const { error: uploadError } = await supabase.storage.from('profile-pictures').upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) { button.disabled = false; button.textContent = 'Save picture and continue'; return message.textContent = uploadError.message; }
  const { error: saveError } = await supabase.rpc('set_my_workspace_avatar', { p_workspace_id: workspaceId, p_avatar_path: path });
  if (saveError) {
    await supabase.storage.from('profile-pictures').remove([path]);
    button.disabled = false;
    button.textContent = 'Save picture and continue';
    return message.textContent = saveError.message;
  }
  profileSetupDialog.close();
  await loadWorkspaceData();
  showMessage('Profile picture saved. Your future activity will show your avatar.', 'success');
});

async function start() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) return showAccessError(sessionError.message);
  if (!session?.user) return window.location.replace('login.html');

  currentUserId = session.user.id;

  $('#account-email').textContent = session.user.email || 'Team member';
  setStatus('Loading workspace');
  const { data: membership, error: membershipError } = await supabase.from('workspace_members').select('workspace_id, role, avatar_path').limit(1).maybeSingle();
  if (membershipError) return showAccessError(`We could not verify your workspace access: ${membershipError.message}`);
  if (!membership) return showAccessError('This login is valid, but it has not been added to the Kurionyx workspace.');

  workspaceId = membership.workspace_id;
  workspaceRole = membership.role;
  $('#account-role').textContent = membership.role === 'owner' ? 'Workspace owner' : 'Team member';
  try {
    await loadWorkspaceData();
    try {
      await initSettings({
        supabase,
        workspaceId,
        userId: session.user.id,
        isOwner: membership.role === 'owner',
        notify: showMessage
      });
    } catch (settingsError) {
      const settingsRoot = $('#settings-root');
      settingsRoot.innerHTML = '<div class="settings-error"><strong>Settings could not be loaded.</strong><p></p><small>The existing operations toolkit remains available.</small></div>';
      settingsRoot.querySelector('p').textContent = settingsError.message;
    }
    loadingPanel.hidden = true;
    toolkitApp.hidden = false;
    setStatus('Cloud data connected', 'connected');
    if (!membership.avatar_path) profileSetupDialog.showModal();
  } catch (error) {
    showAccessError(`Your account is connected, but the operations data could not be loaded: ${error.message}`);
  }
}

supabase.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') window.location.replace('login.html');
});

start();
