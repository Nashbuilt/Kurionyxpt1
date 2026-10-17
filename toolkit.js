import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

const supabase = createClient(
  'https://wszgmnngwnhtavuxqqyk.supabase.co',
  'sb_publishable_kqyjZOBwyt0rJGEQao-pgw_uiEO8-Nf'
);

const records = { stock: [], expenses: [], sales: [], shipments: [] };
let workspaceId = null;

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
  expense: $('#expense-modal')
};

const money = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value) || 0);
const number = value => new Intl.NumberFormat('en-GB').format(Number(value) || 0);
const shortDate = value => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : 'Not set';

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

function view(name) {
  document.querySelectorAll('.tool-nav[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === name));
  document.querySelectorAll('.tool-view').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === name));
  $('#tool-title').textContent = name[0].toUpperCase() + name.slice(1);
}

async function loadWorkspaceData() {
  const [stockResult, expenseResult, salesResult, shipmentResult] = await Promise.all([
    supabase.from('stock_items').select('id, product_name, category, sku, units, unit_cost, shipping_paid, other_fees, notes, created_at').order('created_at', { ascending: false }),
    supabase.from('expenses').select('id, description, category, expense_date, amount, created_at').order('expense_date', { ascending: false }),
    supabase.from('stock_sales').select('id, stock_item_id, units, unit_sale_price, marketplace, marketplace_fees, notes, sold_at, created_at').order('sold_at', { ascending: false }),
    supabase.from('shipments').select('id, direction, status, item_name, category, units, origin, destination, carrier, tracking_number, shipping_cost, expected_date, notes, created_at').order('created_at', { ascending: false })
  ]);

  for (const result of [stockResult, expenseResult, salesResult, shipmentResult]) {
    if (result.error) throw result.error;
  }

  records.stock = (stockResult.data || []).map(item => ({
    id: item.id, product: item.product_name, category: item.category, sku: item.sku,
    units: Number(item.units), unitCost: Number(item.unit_cost), shippingPaid: Number(item.shipping_paid),
    otherFees: Number(item.other_fees), notes: item.notes, createdAt: item.created_at
  }));
  records.expenses = (expenseResult.data || []).map(item => ({
    id: item.id, description: item.description, category: item.category, date: item.expense_date,
    amount: Number(item.amount), createdAt: item.created_at
  }));
  records.sales = (salesResult.data || []).map(item => ({
    id: item.id, stockItemId: item.stock_item_id, units: Number(item.units), unitSalePrice: Number(item.unit_sale_price),
    marketplace: item.marketplace, marketplaceFees: Number(item.marketplace_fees), notes: item.notes,
    soldAt: item.sold_at, createdAt: item.created_at
  }));
  records.shipments = (shipmentResult.data || []).map(item => ({
    id: item.id, direction: item.direction, status: item.status, itemName: item.item_name, category: item.category,
    units: Number(item.units), origin: item.origin, destination: item.destination, carrier: item.carrier,
    trackingNumber: item.tracking_number, shippingCost: Number(item.shipping_cost), expectedDate: item.expected_date,
    notes: item.notes, createdAt: item.created_at
  }));
  render();
}

function stockById(id) {
  return records.stock.find(item => String(item.id) === String(id));
}

function landedCost(item) {
  return item.units * item.unitCost + item.shippingPaid + item.otherFees;
}

function renderDashboard() {
  const totalUnits = records.stock.reduce((sum, item) => sum + item.units, 0);
  const inventoryCost = records.stock.reduce((sum, item) => sum + landedCost(item), 0);
  const unitsSold = records.sales.reduce((sum, sale) => sum + sale.units, 0);
  const revenue = records.sales.reduce((sum, sale) => sum + sale.units * sale.unitSalePrice, 0);
  const active = records.shipments.filter(item => !['delivered', 'cancelled'].includes(item.status));
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

  const topStock = [...records.stock].sort((a, b) => b.units - a.units).slice(0, 7);
  const maxUnits = Math.max(1, ...topStock.map(item => item.units));
  $('#stock-bars').innerHTML = topStock.length
    ? topStock.map(item => `<div class="bar-item"><div class="bar" style="height:${Math.max(8, item.units / maxUnits * 165)}px" title="${item.units} units"></div><span>${esc(item.product)}</span></div>`).join('')
    : '<p class="empty compact">Add your first stock item to see the chart.</p>';

  const activity = [
    ...records.sales.map(item => ({ date: item.createdAt, icon: '↗', text: `${item.units} × ${stockById(item.stockItemId)?.product || 'Stock item'} sold`, sub: item.marketplace })),
    ...records.shipments.map(item => ({ date: item.createdAt, icon: item.direction === 'incoming' ? '↓' : '↑', text: `${item.itemName} shipment added`, sub: `${item.direction} · ${item.status.replace('_', ' ')}` })),
    ...records.stock.map(item => ({ date: item.createdAt, icon: '□', text: `${item.product} added`, sub: `${item.units} units · ${item.category}` }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
  $('#activity-list').innerHTML = activity.length
    ? activity.map(item => `<div class="activity"><i>${item.icon}</i><div><p>${esc(item.text)}</p><small>${esc(item.sub)}</small></div></div>`).join('')
    : '<p class="empty compact">Your stock, sales and shipments will appear here.</p>';
}

function renderCategoryChart(totalUnits) {
  const categoryTotals = records.stock.reduce((totals, item) => {
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
  $('#stock-table').innerHTML = records.stock.length
    ? records.stock.map(item => `<tr><td><strong>${esc(item.product)}</strong></td><td><span class="category-chip">${esc(item.category)}</span></td><td>${esc(item.sku)}</td><td><strong>${number(item.units)}</strong></td><td>${money(landedCost(item))}<small class="cell-detail">${money(item.unitCost)} per unit + costs</small></td><td class="notes-cell">${esc(item.notes || '—')}</td><td><div class="row-actions"><button data-sell-stock="${item.id}" ${item.units < 1 ? 'disabled' : ''}>Mark sold</button><button data-edit-stock="${item.id}">Edit</button><button class="delete-row" data-delete-stock="${item.id}">Remove</button></div></td></tr>`).join('')
    : '<tr><td colspan="7" class="empty">No stock records yet. Use “Add stock” to create the first one.</td></tr>';
}

function renderSales() {
  $('#sales-table').innerHTML = records.sales.length
    ? records.sales.map(sale => { const item = stockById(sale.stockItemId); return `<tr><td>${shortDate(sale.soldAt)}</td><td><strong>${esc(item?.product || 'Removed stock item')}</strong><small class="cell-detail">${esc(item?.sku || '')}</small></td><td>${esc(sale.marketplace)}</td><td>${number(sale.units)}</td><td>${money(sale.units * sale.unitSalePrice)}</td><td>${money(sale.marketplaceFees)}</td><td class="notes-cell">${esc(sale.notes || '—')}</td></tr>`; }).join('')
    : '<tr><td colspan="7" class="empty">No sales recorded yet. Marking an item sold will add it here and reduce its available stock.</td></tr>';
}

function shipmentCard(item) {
  const statusLabel = item.status.replace('_', ' ');
  const nextStatus = item.status === 'planned' ? 'in_transit' : item.status === 'in_transit' ? 'delivered' : '';
  return `<div class="shipment-card"><div class="shipment-card-top"><span class="status-badge status-${item.status}">${esc(statusLabel)}</span><span>${number(item.units)} units</span></div><h4>${esc(item.itemName)}</h4><p>${esc(item.category)}</p><dl><div><dt>Route</dt><dd>${esc(item.origin || 'Not set')} → ${esc(item.destination || 'Not set')}</dd></div><div><dt>Expected</dt><dd>${shortDate(item.expectedDate)}</dd></div><div><dt>Carrier</dt><dd>${esc(item.carrier || 'Not set')}</dd></div><div><dt>Tracking</dt><dd>${esc(item.trackingNumber || 'Not set')}</dd></div></dl>${item.notes ? `<p class="shipment-notes">${esc(item.notes)}</p>` : ''}<div class="row-actions">${nextStatus ? `<button data-shipment-status="${item.id}" data-next-status="${nextStatus}">${nextStatus === 'in_transit' ? 'Mark in transit' : 'Mark delivered'}</button>` : ''}<button data-edit-shipment="${item.id}">Edit</button><button class="delete-row" data-delete-shipment="${item.id}">Remove</button></div></div>`;
}

function renderShipments() {
  for (const direction of ['incoming', 'outgoing']) {
    const items = records.shipments.filter(item => item.direction === direction);
    $(`#${direction}-shipments`).innerHTML = items.length
      ? items.map(shipmentCard).join('')
      : `<p class="empty">No ${direction} shipments yet.</p>`;
  }
}

function renderExpenses() {
  $('#expense-table').innerHTML = records.expenses.length
    ? records.expenses.map(item => `<tr><td><strong>${esc(item.description)}</strong></td><td>${esc(item.category)}</td><td>${shortDate(item.date)}</td><td>${money(item.amount)}</td><td><button class="delete-row" data-delete-expense="${item.id}">Remove</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">No general expenses recorded yet.</td></tr>';
}

function renderSaleOptions(selectedId = '') {
  const available = records.stock.filter(item => item.units > 0);
  $('#sale-stock-item').innerHTML = available.length
    ? available.map(item => `<option value="${item.id}" ${String(item.id) === String(selectedId) ? 'selected' : ''}>${esc(item.product)} — ${esc(item.sku)} (${number(item.units)} available)</option>`).join('')
    : '<option value="">No stock is currently available</option>';
}

function bindRenderedActions() {
  document.querySelectorAll('[data-edit-stock]').forEach(button => button.onclick = () => openStock(stockById(button.dataset.editStock)));
  document.querySelectorAll('[data-sell-stock]').forEach(button => button.onclick = () => openSale(button.dataset.sellStock));
  document.querySelectorAll('[data-delete-stock]').forEach(button => button.onclick = () => removeRecord('stock_items', button.dataset.deleteStock, 'Stock record removed.'));
  document.querySelectorAll('[data-edit-shipment]').forEach(button => button.onclick = () => openShipment(records.shipments.find(item => String(item.id) === button.dataset.editShipment)));
  document.querySelectorAll('[data-delete-shipment]').forEach(button => button.onclick = () => removeRecord('shipments', button.dataset.deleteShipment, 'Shipment removed.'));
  document.querySelectorAll('[data-delete-expense]').forEach(button => button.onclick = () => removeRecord('expenses', button.dataset.deleteExpense, 'Expense removed.'));
  document.querySelectorAll('[data-shipment-status]').forEach(button => button.onclick = () => updateShipmentStatus(button.dataset.shipmentStatus, button.dataset.nextStatus));
}

function render() {
  renderDashboard();
  renderStock();
  renderSales();
  renderShipments();
  renderExpenses();
  renderSaleOptions();
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
  form.elements.units.value = item?.units ?? '';
  form.elements.unitCost.value = item?.unitCost ?? '';
  form.elements.shippingPaid.value = item?.shippingPaid ?? 0;
  form.elements.otherFees.value = item?.otherFees ?? 0;
  form.elements.notes.value = item?.notes || '';
  $('#stock-modal-title').textContent = item ? 'Update stock' : 'Add stock';
  prepareDialog(dialogs.stock);
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
  form.elements.shippingCost.value = item?.shippingCost ?? 0;
  form.elements.notes.value = item?.notes || '';
  $('#shipment-modal-title').textContent = item ? 'Update shipment' : 'Add shipment';
  prepareDialog(dialogs.shipment);
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
    workspace_id: workspaceId,
    product_name: String(values.get('product')).trim(),
    category: String(values.get('category')).trim(),
    sku: String(values.get('sku')).trim(),
    units: Number(values.get('units')),
    unit_cost: Number(values.get('unitCost')),
    shipping_paid: Number(values.get('shippingPaid')),
    other_fees: Number(values.get('otherFees')),
    notes: String(values.get('notes')).trim()
  };
  const query = id ? supabase.from('stock_items').update(payload).eq('id', id).eq('workspace_id', workspaceId) : supabase.from('stock_items').insert(payload);
  await saveForm(form, query, id ? 'Stock updated.' : 'Stock added.', dialogs.stock);
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
    notes: String(values.get('notes')).trim()
  });
  await saveForm(form, query, 'Sale recorded and available stock reduced.', dialogs.sale);
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
    shipping_cost: Number(values.get('shippingCost')),
    notes: String(values.get('notes')).trim()
  };
  const query = id ? supabase.from('shipments').update(payload).eq('id', id).eq('workspace_id', workspaceId) : supabase.from('shipments').insert(payload);
  await saveForm(form, query, id ? 'Shipment updated.' : 'Shipment added.', dialogs.shipment);
});

$('#expense-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const query = supabase.from('expenses').insert({
    workspace_id: workspaceId,
    description: String(values.get('description')).trim(),
    category: String(values.get('category')),
    expense_date: String(values.get('date')),
    amount: Number(values.get('amount'))
  });
  await saveForm(form, query, 'Expense saved.', dialogs.expense);
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

async function removeRecord(table, id, successMessage) {
  if (!window.confirm('Remove this record from the shared Kurionyx workspace?')) return;
  setStatus('Saving changes');
  const { error } = await supabase.from(table).delete().eq('id', id).eq('workspace_id', workspaceId);
  if (error) {
    setStatus('Save failed', 'error');
    showMessage(error.message, 'error');
    return;
  }
  await loadWorkspaceData();
  setStatus('Cloud data connected', 'connected');
  showMessage(successMessage, 'success');
}

async function signOut() {
  await supabase.auth.signOut();
  window.location.replace('login.html');
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => view(button.dataset.view)));
document.querySelectorAll('[data-view-jump]').forEach(button => button.addEventListener('click', () => view(button.dataset.viewJump)));
document.querySelectorAll('[data-open-stock]').forEach(button => button.addEventListener('click', () => openStock()));
document.querySelectorAll('[data-open-sale]').forEach(button => button.addEventListener('click', () => openSale()));
document.querySelectorAll('[data-open-shipment]').forEach(button => button.addEventListener('click', () => openShipment()));
document.querySelectorAll('[data-open-expense]').forEach(button => button.addEventListener('click', () => {
  const form = $('#expense-form');
  form.reset();
  form.elements.date.value = new Date().toISOString().slice(0, 10);
  prepareDialog(dialogs.expense);
}));
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('#sign-out').addEventListener('click', signOut);
$('#error-sign-out').addEventListener('click', signOut);

async function start() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) return showAccessError(sessionError.message);
  if (!session?.user) return window.location.replace('login.html');

  $('#account-email').textContent = session.user.email || 'Team member';
  setStatus('Loading workspace');
  const { data: membership, error: membershipError } = await supabase.from('workspace_members').select('workspace_id, role').limit(1).maybeSingle();
  if (membershipError) return showAccessError(`We could not verify your workspace access: ${membershipError.message}`);
  if (!membership) return showAccessError('This login is valid, but it has not been added to the Kurionyx workspace.');

  workspaceId = membership.workspace_id;
  $('#account-role').textContent = membership.role === 'owner' ? 'Workspace owner' : 'Team member';
  try {
    await loadWorkspaceData();
    loadingPanel.hidden = true;
    toolkitApp.hidden = false;
    setStatus('Cloud data connected', 'connected');
  } catch (error) {
    showAccessError(`Your account is connected, but the operations data could not be loaded: ${error.message}`);
  }
}

supabase.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') window.location.replace('login.html');
});

start();
