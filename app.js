import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

const SUPABASE_URL = 'https://wszgmnngwnhtavuxqqyk.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_kqyjZOBwyt0rJGEQao-pgw_uiEO8-Nf';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let data = { stock: [], expenses: [] };
let currentType = 'stock';
let workspaceId = null;

const toolkit = document.querySelector('#toolkit');
const toolkitApp = document.querySelector('#toolkit-app');
const authGate = document.querySelector('#auth-gate');
const connectionStatus = document.querySelector('#connection-status');
const accountEmail = document.querySelector('#account-email');
const signOutButton = document.querySelector('#sign-out');
const loginForm = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');
const modal = document.querySelector('#entry-modal');
const entryForm = document.querySelector('#entry-form');

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

function showSignedOut() {
  workspaceId = null;
  data = { stock: [], expenses: [] };
  authGate.hidden = false;
  toolkitApp.hidden = true;
  accountEmail.textContent = '';
  signOutButton.hidden = true;
  setStatus('Sign in required');
  render();
}

async function showSignedIn(user) {
  authGate.hidden = true;
  toolkitApp.hidden = false;
  accountEmail.textContent = user.email || 'Team member';
  signOutButton.hidden = false;
  setStatus('Loading workspace');

  const { data: memberships, error: membershipError } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .limit(1);

  if (membershipError) {
    setStatus('Connection error', 'error');
    throw membershipError;
  }

  if (!memberships?.length) {
    authGate.hidden = false;
    toolkitApp.hidden = true;
    loginMessage.textContent = 'Your login exists, but it has not yet been added to the Kurionyx workspace.';
    setStatus('Access not assigned', 'error');
    return;
  }

  workspaceId = memberships[0].workspace_id;
  await loadWorkspaceData();
  setStatus('Cloud data connected', 'connected');
}

async function loadWorkspaceData() {
  const [stockResult, expenseResult] = await Promise.all([
    supabase.from('stock_items').select('id, product_name, sku, units, unit_cost, created_at').order('created_at', { ascending: false }),
    supabase.from('expenses').select('id, description, category, expense_date, amount, created_at').order('expense_date', { ascending: false })
  ]);

  if (stockResult.error) throw stockResult.error;
  if (expenseResult.error) throw expenseResult.error;

  data.stock = (stockResult.data || []).map(item => ({
    id: item.id,
    product: item.product_name,
    sku: item.sku,
    units: Number(item.units),
    unitCost: Number(item.unit_cost),
    createdAt: item.created_at
  }));
  data.expenses = (expenseResult.data || []).map(item => ({
    id: item.id,
    description: item.description,
    category: item.category,
    date: item.expense_date,
    amount: Number(item.amount),
    createdAt: item.created_at
  }));
  render();
}

async function openToolkit() {
  toolkit.classList.add('open');
  toolkit.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user && !workspaceId) {
    try {
      await showSignedIn(session.user);
    } catch (error) {
      setStatus('Connection error', 'error');
      loginMessage.textContent = error.message;
    }
  }
}

function closeToolkit() {
  toolkit.classList.remove('open');
  toolkit.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function view(name) {
  document.querySelectorAll('.tool-nav').forEach(item => item.classList.toggle('active', item.dataset.view === name));
  document.querySelectorAll('.tool-view').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === name));
  document.querySelector('#tool-title').textContent = name[0].toUpperCase() + name.slice(1);
}

function render() {
  const units = data.stock.reduce((sum, item) => sum + item.units, 0);
  const value = data.stock.reduce((sum, item) => sum + item.units * item.unitCost, 0);
  const expenses = data.expenses.reduce((sum, item) => sum + item.amount, 0);
  document.querySelector('#metric-units').textContent = units;
  document.querySelector('#metric-value').textContent = money(value);
  document.querySelector('#metric-expenses').textContent = money(expenses);
  document.querySelector('#metric-position').textContent = money(value - expenses);

  document.querySelector('#stock-table').innerHTML = data.stock.length
    ? data.stock.map(item => `<tr><td><strong>${esc(item.product)}</strong></td><td>${esc(item.sku)}</td><td>${item.units}</td><td>${money(item.unitCost)}</td><td>${money(item.units * item.unitCost)}</td><td><button class="delete-row" data-delete-stock="${item.id}">Remove</button></td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">No stock records yet.</td></tr>';

  document.querySelector('#expense-table').innerHTML = data.expenses.length
    ? data.expenses.map(item => `<tr><td><strong>${esc(item.description)}</strong></td><td>${esc(item.category)}</td><td>${item.date}</td><td>${money(item.amount)}</td><td><button class="delete-row" data-delete-expense="${item.id}">Remove</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">No expenses recorded yet.</td></tr>';

  const maxUnits = Math.max(1, ...data.stock.map(item => item.units));
  document.querySelector('#stock-bars').innerHTML = data.stock.length
    ? data.stock.map(item => `<div class="bar-item"><div class="bar" style="height:${Math.max(8, item.units / maxUnits * 165)}px" title="${item.units} units"></div><span>${esc(item.product)}</span></div>`).join('')
    : '<p class="empty">Add stock to see the chart.</p>';

  const activity = [
    ...data.stock.map(item => ({ id: item.id, type: 'stock', text: `${item.units} units of ${item.product}`, sub: 'Stock record' })),
    ...data.expenses.map(item => ({ id: item.id, type: 'expense', text: `${money(item.amount)} — ${item.description}`, sub: 'Expense record' }))
  ].sort((a, b) => b.id - a.id).slice(0, 5);

  document.querySelector('#activity-list').innerHTML = activity.length
    ? activity.map(item => `<div class="activity"><i>${item.type === 'stock' ? '□' : '£'}</i><div><p>${esc(item.text)}</p><small>${item.sub}</small></div></div>`).join('')
    : '<p class="empty">No activity yet.</p>';

  document.querySelectorAll('[data-delete-stock]').forEach(button => {
    button.onclick = () => removeRecord('stock_items', button.dataset.deleteStock);
  });
  document.querySelectorAll('[data-delete-expense]').forEach(button => {
    button.onclick = () => removeRecord('expenses', button.dataset.deleteExpense);
  });
}

async function removeRecord(table, id) {
  if (!window.confirm('Remove this record from the shared Kurionyx workspace?')) return;
  const { error } = await supabase.from(table).delete().eq('id', id).eq('workspace_id', workspaceId);
  if (error) {
    window.alert(error.message);
    return;
  }
  await loadWorkspaceData();
}

document.querySelectorAll('[data-open-toolkit]').forEach(button => button.onclick = openToolkit);
document.querySelectorAll('[data-close-toolkit]').forEach(button => button.onclick = closeToolkit);
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => view(button.dataset.view));
document.querySelectorAll('[data-view-jump]').forEach(button => button.onclick = () => view(button.dataset.viewJump));

document.querySelectorAll('[data-open-modal]').forEach(button => {
  button.onclick = () => {
    currentType = button.dataset.openModal;
    const isStock = currentType === 'stock';
    document.querySelector('#modal-title').textContent = isStock ? 'Add stock' : 'Add expense';
    document.querySelector('#stock-fields').style.display = isStock ? 'block' : 'none';
    document.querySelector('#expense-fields').style.display = isStock ? 'none' : 'block';
    entryForm.querySelectorAll('input,select').forEach(field => {
      field.disabled = Boolean(isStock ? field.closest('#expense-fields') : field.closest('#stock-fields'));
    });
    if (!isStock) entryForm.elements.date.value = new Date().toISOString().slice(0, 10);
    modal.showModal();
  };
});

entryForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!workspaceId) return;
  const formData = new FormData(entryForm);
  const submitButton = entryForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Saving…';

  const query = currentType === 'stock'
    ? supabase.from('stock_items').insert({
        workspace_id: workspaceId,
        product_name: formData.get('product'),
        sku: formData.get('sku'),
        units: Number(formData.get('units')),
        unit_cost: Number(formData.get('unitCost'))
      })
    : supabase.from('expenses').insert({
        workspace_id: workspaceId,
        description: formData.get('description'),
        category: formData.get('category'),
        expense_date: formData.get('date'),
        amount: Number(formData.get('amount'))
      });

  const { error } = await query;
  submitButton.disabled = false;
  submitButton.textContent = 'Save record';
  if (error) {
    window.alert(error.message);
    return;
  }

  entryForm.reset();
  modal.close();
  await loadWorkspaceData();
});

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginMessage.textContent = '';
  const submitButton = loginForm.querySelector('[type="submit"]');
  const formData = new FormData(loginForm);
  submitButton.disabled = true;
  submitButton.textContent = 'Signing in…';
  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email'),
    password: formData.get('password')
  });
  submitButton.disabled = false;
  submitButton.textContent = 'Sign in';
  if (error) loginMessage.textContent = error.message;
});

signOutButton.addEventListener('click', async () => {
  await supabase.auth.signOut();
});

supabase.auth.onAuthStateChange((event, session) => {
  setTimeout(async () => {
    if (session?.user) {
      try {
        await showSignedIn(session.user);
      } catch (error) {
        setStatus('Connection error', 'error');
        loginMessage.textContent = error.message;
      }
    } else {
      showSignedOut();
    }
  }, 0);
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toolkit.classList.contains('open') && !modal.open) closeToolkit();
});

showSignedOut();
