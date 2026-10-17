import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

const supabase = createClient(
  'https://wszgmnngwnhtavuxqqyk.supabase.co',
  'sb_publishable_kqyjZOBwyt0rJGEQao-pgw_uiEO8-Nf'
);

let records = { stock: [], expenses: [] };
let currentType = 'stock';
let workspaceId = null;

const toolkitApp = document.querySelector('#toolkit-app');
const loadingPanel = document.querySelector('#tool-loading');
const accessError = document.querySelector('#access-error');
const accessErrorMessage = document.querySelector('#access-error-message');
const connectionStatus = document.querySelector('#connection-status');
const accountEmail = document.querySelector('#account-email');
const accountRole = document.querySelector('#account-role');
const workspaceMessage = document.querySelector('#workspace-message');
const modal = document.querySelector('#entry-modal');
const entryForm = document.querySelector('#entry-form');
const entryMessage = document.querySelector('#entry-message');

const money = value => new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP'
}).format(Number(value) || 0);

function esc(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
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
  accessErrorMessage.textContent = message;
  setStatus('Access unavailable', 'error');
}

function view(name) {
  document.querySelectorAll('.tool-nav[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === name));
  document.querySelectorAll('.tool-view').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === name));
  document.querySelector('#tool-title').textContent = name[0].toUpperCase() + name.slice(1);
}

async function loadWorkspaceData() {
  const [stockResult, expenseResult] = await Promise.all([
    supabase.from('stock_items').select('id, product_name, sku, units, unit_cost, created_at').order('created_at', { ascending: false }),
    supabase.from('expenses').select('id, description, category, expense_date, amount, created_at').order('expense_date', { ascending: false })
  ]);

  if (stockResult.error) throw stockResult.error;
  if (expenseResult.error) throw expenseResult.error;

  records.stock = (stockResult.data || []).map(item => ({
    id: item.id,
    product: item.product_name,
    sku: item.sku,
    units: Number(item.units),
    unitCost: Number(item.unit_cost),
    createdAt: item.created_at
  }));
  records.expenses = (expenseResult.data || []).map(item => ({
    id: item.id,
    description: item.description,
    category: item.category,
    date: item.expense_date,
    amount: Number(item.amount),
    createdAt: item.created_at
  }));
  render();
}

function render() {
  const units = records.stock.reduce((sum, item) => sum + item.units, 0);
  const stockValue = records.stock.reduce((sum, item) => sum + item.units * item.unitCost, 0);
  const expenses = records.expenses.reduce((sum, item) => sum + item.amount, 0);
  document.querySelector('#metric-units').textContent = units;
  document.querySelector('#metric-value').textContent = money(stockValue);
  document.querySelector('#metric-expenses').textContent = money(expenses);
  document.querySelector('#metric-position').textContent = money(stockValue - expenses);

  document.querySelector('#stock-table').innerHTML = records.stock.length
    ? records.stock.map(item => `<tr><td><strong>${esc(item.product)}</strong></td><td>${esc(item.sku)}</td><td>${item.units}</td><td>${money(item.unitCost)}</td><td>${money(item.units * item.unitCost)}</td><td><button class="delete-row" data-delete-stock="${item.id}">Remove</button></td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">No stock records yet. Use “Add stock” to create the first one.</td></tr>';

  document.querySelector('#expense-table').innerHTML = records.expenses.length
    ? records.expenses.map(item => `<tr><td><strong>${esc(item.description)}</strong></td><td>${esc(item.category)}</td><td>${esc(item.date)}</td><td>${money(item.amount)}</td><td><button class="delete-row" data-delete-expense="${item.id}">Remove</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">No expenses recorded yet. Use “Add expense” to create the first one.</td></tr>';

  const maxUnits = Math.max(1, ...records.stock.map(item => item.units));
  document.querySelector('#stock-bars').innerHTML = records.stock.length
    ? records.stock.map(item => `<div class="bar-item"><div class="bar" style="height:${Math.max(8, item.units / maxUnits * 165)}px" title="${item.units} units"></div><span>${esc(item.product)}</span></div>`).join('')
    : '<p class="empty">Add your first stock item to see the chart.</p>';

  const activity = [
    ...records.stock.map(item => ({ type: 'stock', text: `${item.units} units of ${item.product}`, sub: 'Stock record', date: item.createdAt })),
    ...records.expenses.map(item => ({ type: 'expense', text: `${money(item.amount)} — ${item.description}`, sub: 'Expense record', date: item.createdAt }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

  document.querySelector('#activity-list').innerHTML = activity.length
    ? activity.map(item => `<div class="activity"><i>${item.type === 'stock' ? '□' : '£'}</i><div><p>${esc(item.text)}</p><small>${item.sub}</small></div></div>`).join('')
    : '<p class="empty">Your saved stock and expenses will appear here.</p>';

  document.querySelectorAll('[data-delete-stock]').forEach(button => {
    button.onclick = () => removeRecord('stock_items', button.dataset.deleteStock, 'Stock record removed.');
  });
  document.querySelectorAll('[data-delete-expense]').forEach(button => {
    button.onclick = () => removeRecord('expenses', button.dataset.deleteExpense, 'Expense removed.');
  });
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
document.querySelector('#sign-out').addEventListener('click', signOut);
document.querySelector('#error-sign-out').addEventListener('click', signOut);
document.querySelector('#close-modal').addEventListener('click', () => modal.close());

document.querySelectorAll('[data-open-modal]').forEach(button => {
  button.addEventListener('click', () => {
    currentType = button.dataset.openModal;
    const isStock = currentType === 'stock';
    document.querySelector('#modal-title').textContent = isStock ? 'Add stock' : 'Add expense';
    document.querySelector('#stock-fields').style.display = isStock ? 'block' : 'none';
    document.querySelector('#expense-fields').style.display = isStock ? 'none' : 'block';
    entryMessage.textContent = '';
    entryForm.querySelectorAll('input, select').forEach(field => {
      field.disabled = Boolean(isStock ? field.closest('#expense-fields') : field.closest('#stock-fields'));
    });
    if (!isStock) entryForm.elements.date.value = new Date().toISOString().slice(0, 10);
    modal.showModal();
  });
});

entryForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!workspaceId) return;
  const formData = new FormData(entryForm);
  const submitButton = entryForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Saving…';
  entryMessage.textContent = '';

  const query = currentType === 'stock'
    ? supabase.from('stock_items').insert({
        workspace_id: workspaceId,
        product_name: String(formData.get('product')).trim(),
        sku: String(formData.get('sku')).trim(),
        units: Number(formData.get('units')),
        unit_cost: Number(formData.get('unitCost'))
      })
    : supabase.from('expenses').insert({
        workspace_id: workspaceId,
        description: String(formData.get('description')).trim(),
        category: String(formData.get('category')),
        expense_date: String(formData.get('date')),
        amount: Number(formData.get('amount'))
      });

  const { error } = await query;
  submitButton.disabled = false;
  submitButton.textContent = 'Save record';
  if (error) {
    entryMessage.textContent = error.code === '23505' ? 'That SKU already exists in this workspace.' : error.message;
    return;
  }

  entryForm.reset();
  modal.close();
  await loadWorkspaceData();
  setStatus('Cloud data connected', 'connected');
  showMessage(currentType === 'stock' ? 'Stock record saved.' : 'Expense saved.', 'success');
});

async function start() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    showAccessError(sessionError.message);
    return;
  }
  if (!session?.user) {
    window.location.replace('login.html');
    return;
  }

  accountEmail.textContent = session.user.email || 'Team member';
  setStatus('Loading workspace');
  const { data: membership, error: membershipError } = await supabase
    .from('workspace_members')
    .select('workspace_id, role')
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    showAccessError(`We could not verify your workspace access: ${membershipError.message}`);
    return;
  }
  if (!membership) {
    showAccessError('This login is valid, but it has not been added to the Kurionyx workspace. Ask the workspace owner to add it.');
    return;
  }

  workspaceId = membership.workspace_id;
  accountRole.textContent = membership.role === 'owner' ? 'Workspace owner' : 'Team member';
  try {
    await loadWorkspaceData();
    loadingPanel.hidden = true;
    toolkitApp.hidden = false;
    setStatus('Cloud data connected', 'connected');
  } catch (error) {
    showAccessError(`Your account is connected, but the records could not be loaded: ${error.message}`);
  }
}

supabase.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') window.location.replace('login.html');
});

start();
