const sections = [
  ['profile', 'Business Profile'],
  ['suppliers', 'Suppliers'],
  ['channels', 'Sales Channels'],
  ['locations', 'Stock Locations'],
  ['productCategories', 'Product Categories'],
  ['expenseCategories', 'Expense Categories'],
  ['team', 'Team & Permissions'],
  ['integrations', 'Integrations']
];

const collections = {
  suppliers: {
    table: 'suppliers',
    title: 'Suppliers',
    singular: 'supplier',
    description: 'Keep the actual supplier separate from the sourcing platform used to find them.',
    searchable: true,
    fields: [
      ['name', 'Supplier name', 'text', true, 200],
      ['sourcing_platform', 'Sourcing platform', 'text', false, 120, 'Alibaba, AliExpress, 1688, distributor…'],
      ['website_url', 'Website or profile URL', 'url', false, 500],
      ['contact_name', 'Contact name', 'text', false, 160],
      ['email', 'Email', 'email', false, 254],
      ['telephone', 'Telephone', 'tel', false, 40],
      ['country', 'Country', 'text', false, 120],
      ['notes', 'Notes', 'textarea', false, 4000]
    ],
    summary: item => [item.sourcing_platform, item.contact_name, item.country].filter(Boolean).join(' · ') || 'No additional details'
  },
  channels: {
    table: 'sales_channels',
    title: 'Sales Channels',
    singular: 'sales channel',
    description: 'A channel is where a sale happens. Fulfilment methods such as FBA are configured separately in future.',
    fields: [
      ['name', 'Channel name', 'text', true, 120],
      ['channel_type', 'Channel type', 'select', true, null, null, [['marketplace', 'Marketplace'], ['webstore', 'Web store'], ['direct', 'Direct sales'], ['social', 'Social marketplace'], ['other', 'Other']]],
      ['account_display_name', 'Store / account display name', 'text', false, 160],
      ['notes', 'Notes', 'textarea', false, 2000]
    ],
    summary: item => `${labelValue(item.channel_type)}${item.account_display_name ? ` · ${item.account_display_name}` : ''}`
  },
  locations: {
    table: 'stock_locations',
    title: 'Stock Locations',
    singular: 'stock location',
    description: 'Configuration only. Quantities are not split by location until location-aware inventory movements are implemented.',
    fields: [
      ['name', 'Location name', 'text', true, 120],
      ['location_type', 'Location type', 'select', true, null, null, [['home', 'Home storage'], ['warehouse', 'External warehouse'], ['amazon_fba', 'Amazon FBA'], ['supplier', 'Supplier location'], ['other', 'Other']]],
      ['description', 'Description', 'textarea', false, 1000],
      ['address', 'Address', 'textarea', false, 1000]
    ],
    summary: item => labelValue(item.location_type)
  },
  productCategories: {
    table: 'product_categories',
    title: 'Product Categories',
    singular: 'product category',
    description: 'Configured categories are suggested on stock forms. Existing free-text categories remain unchanged.',
    fields: [['name', 'Category name', 'text', true, 100], ['notes', 'Notes', 'textarea', false, 1000]],
    summary: item => item.notes || 'Available for new inventory records'
  },
  expenseCategories: {
    table: 'expense_categories',
    title: 'Expense Categories',
    singular: 'expense category',
    description: 'Categories organise expenses; they do not change product costs or prevent cost duplication by themselves.',
    fields: [['name', 'Category name', 'text', true, 100], ['notes', 'Notes', 'textarea', false, 1000]],
    summary: item => item.notes || 'Available for new expense records'
  }
};

const state = {
  supabase: null,
  workspaceId: null,
  userId: null,
  isOwner: false,
  notify: () => {},
  activeTab: 'profile',
  profile: null,
  suppliers: [],
  channels: [],
  locations: [],
  productCategories: [],
  expenseCategories: [],
  team: [],
  integrations: [],
  search: '',
  showArchived: false,
  loaded: false
};

const root = () => document.querySelector('#settings-root');
const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const labelValue = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export async function initSettings(options) {
  Object.assign(state, options);
  const monzoResult = new URLSearchParams(window.location.search).get('monzo');
  if (monzoResult) {
    state.activeTab = 'integrations';
    const messages = {
      connected: ['Monzo business account connected successfully.', 'success'],
      no_business_account: ['Monzo did not return a business account. No personal account was connected.', 'error'],
      invalid_state: ['The Monzo connection expired or was already used. Start a fresh connection and complete it within 10 minutes.', 'error'],
      invalid_callback: ['Monzo returned an incomplete connection. Start a fresh connection from Kurionyx.', 'error'],
      access_denied: ['The Monzo request was cancelled. No account was connected.', 'error'],
      token_failed: ['Monzo could not verify the client details. Check the client ID, secret and exact redirect URL.', 'error'],
      approval_required: ['Monzo did not confirm approval within two minutes. Do not reuse an older email link. Start once, keep the Kurionyx page open, use the newest email, then approve that same request in the Monzo app.', 'error'],
      accounts_failed: ['Monzo authorised the login but the business-account lookup failed. No personal account was connected.', 'error'],
      storage_failed: ['The business account was found, but Kurionyx could not securely save the connection.', 'error']
    };
    const [message, level] = messages[monzoResult] || ['The Monzo connection could not be completed.', 'error'];
    state.notify(message, level);
    window.history.replaceState({}, '', window.location.pathname);
  }
  bindSettingsEvents();
  enhanceOperationalForms();
  await loadSettings();
}

async function loadSettings() {
  const results = await Promise.all([
    state.supabase.from('workspace_profiles').select('*').eq('workspace_id', state.workspaceId).maybeSingle(),
    state.supabase.from('suppliers').select('*').eq('workspace_id', state.workspaceId).order('name'),
    state.supabase.from('sales_channels').select('*').eq('workspace_id', state.workspaceId).order('name'),
    state.supabase.from('stock_locations').select('*').eq('workspace_id', state.workspaceId).order('name'),
    state.supabase.from('product_categories').select('*').eq('workspace_id', state.workspaceId).order('name'),
    state.supabase.from('expense_categories').select('*').eq('workspace_id', state.workspaceId).order('name'),
    state.supabase.rpc('list_workspace_members', { p_workspace_id: state.workspaceId }),
    state.supabase.from('workspace_integrations').select('*').eq('workspace_id', state.workspaceId).order('display_name')
  ]);

  const failed = results.find(result => result.error);
  if (failed) {
    root().innerHTML = `<div class="settings-error"><strong>Settings are not available yet.</strong><p>${esc(failed.error.message)}</p><small>Apply and verify the Settings migration before deploying this frontend.</small></div>`;
    return;
  }

  state.profile = results[0].data;
  state.suppliers = results[1].data || [];
  state.channels = results[2].data || [];
  state.locations = results[3].data || [];
  state.productCategories = results[4].data || [];
  state.expenseCategories = results[5].data || [];
  state.team = results[6].data || [];
  state.integrations = results[7].data || [];
  state.loaded = true;
  updateReferenceLists();
  renderSettings();
}

function renderSettings() {
  root().innerHTML = `<div class="settings-layout">
    <nav class="settings-nav" aria-label="Settings sections">${sections.map(([key, label]) => `<button type="button" data-settings-tab="${key}" class="${state.activeTab === key ? 'active' : ''}">${esc(label)}</button>`).join('')}</nav>
    <div class="settings-content">${renderActiveSection()}</div>
  </div>`;
}

function renderActiveSection() {
  if (state.activeTab === 'profile') return renderProfile();
  if (state.activeTab === 'team') return renderTeam();
  if (state.activeTab === 'integrations') return renderIntegrations();
  return renderCollection(state.activeTab);
}

function ownerNotice() {
  return state.isOwner ? '' : '<div class="settings-notice">You can view these settings. Changes are restricted to the application workspace owner role.</div>';
}

function renderProfile() {
  const profile = state.profile || {};
  return `<section class="settings-section"><div class="settings-heading"><div><p>Business identity</p><h3>Business Profile</h3><span>These details describe the operation; they do not establish incorporation, ownership or banking authority.</span></div></div>${ownerNotice()}
    <form id="business-profile-form" class="settings-profile-form">
      <div class="field-row"><label>Business display name<input name="display_name" required maxlength="120" value="${esc(profile.display_name || 'Kurionyx')}"></label><label>Trading name<input name="trading_name" maxlength="120" value="${esc(profile.trading_name)}"></label></div>
      <div class="field-row"><label>Contact email<input name="contact_email" type="email" maxlength="254" value="${esc(profile.contact_email)}"></label><label>Contact telephone<input name="contact_telephone" type="tel" maxlength="40" value="${esc(profile.contact_telephone)}"></label></div>
      <div class="field-row"><label>Website<input name="website" type="url" maxlength="500" value="${esc(profile.website)}"></label><label>Default currency<select name="default_currency"><option value="GBP" selected>GBP — Pound sterling</option></select></label></div>
      <div class="field-row"><label>Business status<select name="business_status">${[['pre_incorporation', 'Pre-incorporation'], ['sole_trader', 'Sole trader'], ['partnership', 'Partnership'], ['limited_company', 'Limited company'], ['other', 'Other']].map(([value, label]) => `<option value="${value}" ${profile.business_status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Company registration number<input name="company_registration_number" maxlength="32" value="${esc(profile.company_registration_number)}" placeholder="Optional"></label></div>
      <div class="field-row"><label class="check-label"><input name="vat_registered" type="checkbox" ${profile.vat_registered ? 'checked' : ''}> VAT registered</label><label>VAT registration number<input name="vat_registration_number" maxlength="32" value="${esc(profile.vat_registration_number)}" placeholder="Optional"></label></div>
      <label>General business notes<textarea name="notes" maxlength="4000">${esc(profile.notes)}</textarea></label>
      <p class="form-message" data-profile-message role="status"></p>
      <button class="button primary" type="submit" ${state.isOwner ? '' : 'disabled'}>Save profile</button>
    </form></section>`;
}

function renderCollection(key) {
  const config = collections[key];
  const allItems = state[key] || [];
  const search = state.search.trim().toLowerCase();
  const items = allItems.filter(item => (state.showArchived || !item.archived_at) && (!search || JSON.stringify(item).toLowerCase().includes(search)));
  return `<section class="settings-section"><div class="settings-heading"><div><p>Configurable records</p><h3>${esc(config.title)}</h3><span>${esc(config.description)}</span></div><button type="button" class="button primary small" data-settings-add="${key}" ${state.isOwner ? '' : 'disabled'}>+ Add ${esc(config.singular)}</button></div>${ownerNotice()}
    <div class="settings-toolbar">${config.searchable ? '<label class="settings-search">Search<input type="search" data-settings-search placeholder="Search suppliers" value="' + esc(state.search) + '"></label>' : '<span></span>'}<label class="check-label"><input type="checkbox" data-show-archived ${state.showArchived ? 'checked' : ''}> Show archived</label></div>
    <div class="settings-records">${items.length ? items.map(item => renderRecordCard(key, config, item)).join('') : `<div class="settings-empty"><strong>No ${esc(config.title.toLowerCase())} found.</strong><p>Add the first record or change the current filters.</p></div>`}</div>
  </section>`;
}

function renderRecordCard(key, config, item) {
  const viewButton = `<button type="button" data-settings-edit="${key}" data-record-id="${item.id}">${state.isOwner && !item.archived_at ? 'Edit' : 'View'}</button>`;
  const stateButton = item.archived_at
    ? `<button type="button" data-settings-restore="${key}" data-record-id="${item.id}" ${state.isOwner ? '' : 'disabled'}>Restore</button>`
    : `<button type="button" class="delete-row" data-settings-archive="${key}" data-record-id="${item.id}" ${state.isOwner ? '' : 'disabled'}>Archive</button>`;
  return `<article class="settings-record ${item.archived_at ? 'archived' : ''}"><div><span class="record-state">${item.archived_at ? 'Archived' : 'Active'}</span><h4>${esc(item.name)}</h4><p>${esc(config.summary(item))}</p></div><div class="row-actions">${viewButton}${stateButton}</div></article>`;
}

function renderTeam() {
  return `<section class="settings-section"><div class="settings-heading"><div><p>Workspace access</p><h3>Team & Permissions</h3><span>Membership is application access only. It does not establish legal ownership, directorship or banking authority.</span></div></div><div class="settings-notice">Invitations, account creation and role changes are not available in this stage because they require a separately reviewed administration workflow.</div><div class="team-list">${state.team.map(member => `<article><div class="team-avatar">${esc((member.display_name || member.email || '?')[0].toUpperCase())}</div><div><strong>${esc(member.display_name || member.email || member.user_id)}</strong><span>${member.email ? `${esc(member.email)} · ` : ''}${member.user_id === state.userId ? 'Current account · ' : ''}${member.role === 'owner' ? 'Application workspace owner' : 'Team member'}</span></div><span class="data-status status-${member.role === 'owner' ? 'verified' : 'unverified'}">${esc(member.role)}</span></article>`).join('') || '<p class="empty compact">No workspace members returned.</p>'}</div></section>`;
}

function renderIntegrations() {
  const statusText = { not_connected: 'Not connected', planned: 'Planned', configuration_required: 'Ready to connect', connected: 'Connected' };
  return `<section class="settings-section"><div class="settings-heading"><div><p>Secure connections</p><h3>Integrations</h3><span>Credentials and bank tokens remain server-side. Connecting Monzo grants read access only to the account you approve.</span></div></div>${ownerNotice()}<div class="settings-integration-grid">${state.integrations.map(item => `<article><span class="integration-state">${esc(statusText[item.status] || labelValue(item.status))}</span><h4>${esc(item.display_name)}</h4><p>${esc(item.notes)}</p>${item.provider_key === 'monzo_developer_api' ? (item.status === 'connected' ? '<p class="integration-confirmed">Monzo Business is connected securely. No further action is required.</p>' : `<button type="button" class="button primary small" data-connect-monzo ${state.isOwner ? '' : 'disabled'}>Connect Monzo</button>`) : ''}</article>`).join('') || '<p class="empty compact">No integration records found.</p>'}</div></section>`;
}

async function connectMonzo(button) {
  button.disabled = true;
  button.textContent = 'Opening Monzo…';
  const { data, error } = await state.supabase.functions.invoke('monzo-oauth-callback', { body: { action: 'start' } });
  if (error || !data?.url) {
    let functionMessage = data?.error;
    if (error?.context && typeof error.context.json === 'function') {
      try {
        const response = await error.context.json();
        functionMessage = response?.error || functionMessage;
      } catch {
        // Fall back to the SDK message when the function did not return JSON.
      }
    }
    button.disabled = false;
    button.textContent = 'Connect Monzo';
    state.notify(functionMessage || error?.message || 'Could not start the Monzo connection.', 'error');
    return;
  }
  window.location.assign(data.url);
}

function bindSettingsEvents() {
  root().addEventListener('click', event => {
    const tab = event.target.closest('[data-settings-tab]');
    if (tab) {
      state.activeTab = tab.dataset.settingsTab;
      state.search = '';
      state.showArchived = false;
      renderSettings();
      return;
    }
    const add = event.target.closest('[data-settings-add]');
    if (add) return openSettingsModal(add.dataset.settingsAdd);
    const edit = event.target.closest('[data-settings-edit]');
    if (edit) return openSettingsModal(edit.dataset.settingsEdit, Number(edit.dataset.recordId));
    const archive = event.target.closest('[data-settings-archive]');
    if (archive) return archiveRecord(archive.dataset.settingsArchive, Number(archive.dataset.recordId));
    const restore = event.target.closest('[data-settings-restore]');
    if (restore) return restoreRecord(restore.dataset.settingsRestore, Number(restore.dataset.recordId));
    const monzo = event.target.closest('[data-connect-monzo]');
    if (monzo) return connectMonzo(monzo);
  });
  root().addEventListener('input', event => {
    if (event.target.matches('[data-settings-search]')) {
      state.search = event.target.value;
      renderSettings();
      const searchInput = root().querySelector('[data-settings-search]');
      searchInput?.focus();
      searchInput?.setSelectionRange(state.search.length, state.search.length);
    }
  });
  root().addEventListener('change', event => {
    if (event.target.matches('[data-show-archived]')) {
      state.showArchived = event.target.checked;
      renderSettings();
    }
  });
  root().addEventListener('submit', event => {
    if (event.target.id === 'business-profile-form') saveProfile(event);
  });
  document.querySelector('#settings-form').addEventListener('submit', saveCollectionRecord);
}

function openSettingsModal(key, id = null) {
  const config = collections[key];
  const item = id ? state[key].find(record => Number(record.id) === id) : null;
  const form = document.querySelector('#settings-form');
  form.reset();
  form.dataset.collection = key;
  form.elements.id.value = item?.id || '';
  document.querySelector('#settings-modal-eyebrow').textContent = config.title;
  const readOnly = !state.isOwner || Boolean(item?.archived_at);
  document.querySelector('#settings-modal-title').textContent = `${readOnly ? 'View' : item ? 'Edit' : 'Add'} ${config.singular}`;
  document.querySelector('#settings-form-fields').innerHTML = config.fields.map(field => renderField(field, item?.[field[0]] ?? '')).join('');
  form.querySelector('[data-form-message]').textContent = '';
  form.querySelectorAll('#settings-form-fields input, #settings-form-fields select, #settings-form-fields textarea').forEach(control => { control.disabled = readOnly; });
  form.querySelector('[type="submit"]').hidden = readOnly;
  document.querySelector('#settings-modal').showModal();
  form.querySelector('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)')?.focus();
}

function renderField([name, label, type, required, maxLength, placeholder, options], value) {
  const requiredAttr = required ? 'required' : '';
  const maxAttr = maxLength ? `maxlength="${maxLength}"` : '';
  const placeholderAttr = placeholder ? `placeholder="${esc(placeholder)}"` : '';
  if (type === 'textarea') return `<label>${esc(label)}<textarea name="${name}" ${requiredAttr} ${maxAttr} ${placeholderAttr}>${esc(value)}</textarea></label>`;
  if (type === 'select') return `<label>${esc(label)}<select name="${name}" ${requiredAttr}>${options.map(([optionValue, optionLabel]) => `<option value="${optionValue}" ${value === optionValue ? 'selected' : ''}>${esc(optionLabel)}</option>`).join('')}</select></label>`;
  return `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${requiredAttr} ${maxAttr} ${placeholderAttr}></label>`;
}

async function saveProfile(event) {
  event.preventDefault();
  if (!state.isOwner) return;
  const form = event.target;
  const values = new FormData(form);
  const payload = {
    workspace_id: state.workspaceId,
    display_name: String(values.get('display_name')).trim(),
    trading_name: String(values.get('trading_name')).trim(),
    contact_email: String(values.get('contact_email')).trim(),
    contact_telephone: String(values.get('contact_telephone')).trim(),
    website: String(values.get('website')).trim(),
    default_currency: String(values.get('default_currency')),
    business_status: String(values.get('business_status')),
    company_registration_number: String(values.get('company_registration_number')).trim(),
    vat_registered: values.get('vat_registered') === 'on',
    vat_registration_number: String(values.get('vat_registration_number')).trim(),
    notes: String(values.get('notes')).trim()
  };
  await runMutation(form, state.supabase.from('workspace_profiles').upsert(payload, { onConflict: 'workspace_id' }), 'Business profile saved.');
}

async function saveCollectionRecord(event) {
  event.preventDefault();
  if (!state.isOwner) return;
  const form = event.target;
  const key = form.dataset.collection;
  const config = collections[key];
  const values = new FormData(form);
  const id = Number(values.get('id')) || null;
  const payload = { workspace_id: state.workspaceId };
  for (const [name] of config.fields) payload[name] = String(values.get(name) || '').trim();
  const query = id
    ? state.supabase.from(config.table).update(payload).eq('id', id).eq('workspace_id', state.workspaceId)
    : state.supabase.from(config.table).insert(payload);
  const success = `${config.singular[0].toUpperCase()}${config.singular.slice(1)} ${id ? 'updated' : 'added'}.`;
  if (await runMutation(form, query, success)) document.querySelector('#settings-modal').close();
}

async function archiveRecord(key, id) {
  if (!state.isOwner || !window.confirm('Archive this record? Historical references will be preserved.')) return;
  const config = collections[key];
  const { error } = await state.supabase.from(config.table).update({ archived_at: new Date().toISOString(), archived_by: state.userId }).eq('id', id).eq('workspace_id', state.workspaceId);
  if (error) return state.notify(error.message, 'error');
  state.notify('Record archived.', 'success');
  await loadSettings();
}

async function restoreRecord(key, id) {
  if (!state.isOwner) return;
  const config = collections[key];
  const { error } = await state.supabase.from(config.table).update({ archived_at: null, archived_by: null }).eq('id', id).eq('workspace_id', state.workspaceId);
  if (error) return state.notify(error.code === '23505' ? 'An active record already uses that name.' : error.message, 'error');
  state.notify('Record restored.', 'success');
  await loadSettings();
}

async function runMutation(form, query, successMessage) {
  const button = form.querySelector('[type="submit"]');
  const message = form.querySelector('[data-form-message], [data-profile-message]');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Saving…';
  message.textContent = '';
  const { error } = await query;
  button.disabled = false;
  button.textContent = original;
  if (error) {
    message.textContent = error.code === '23505' ? 'An active record with that name already exists.' : error.message;
    return false;
  }
  state.notify(successMessage, 'success');
  await loadSettings();
  return true;
}

function updateReferenceLists() {
  setDatalist('product-category-options', state.productCategories);
  setDatalist('sales-channel-options', state.channels);
  setDatalist('expense-category-options', state.expenseCategories);
}

function setDatalist(id, items) {
  document.querySelector(`#${id}`).innerHTML = items.filter(item => !item.archived_at).map(item => `<option value="${esc(item.name)}"></option>`).join('');
}

function enhanceOperationalForms() {
  const stockCategory = document.querySelector('#stock-form [name="category"]');
  stockCategory.setAttribute('list', 'product-category-options');
  stockCategory.placeholder = 'Select or retain a legacy category';
  replaceSelectWithDatalist('#sale-form [name="marketplace"]', 'sales-channel-options', 80, 'Select or enter a legacy channel');
  replaceSelectWithDatalist('#expense-form [name="category"]', 'expense-category-options', 80, 'Select or retain a legacy category');
}

function replaceSelectWithDatalist(selector, listId, maxLength, placeholder) {
  const existing = document.querySelector(selector);
  if (!existing || existing.tagName === 'INPUT') return;
  const input = document.createElement('input');
  input.name = existing.name;
  input.required = true;
  input.maxLength = maxLength;
  input.setAttribute('list', listId);
  input.placeholder = placeholder;
  existing.replaceWith(input);
}
