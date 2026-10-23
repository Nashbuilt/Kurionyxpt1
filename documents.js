const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const categoryLabels = { legal: 'Legal documents', receipt: 'Receipts', other: 'Other documents' };

const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const shortDate = value => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : 'No date';
const fileSize = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function initDocuments({ supabase, workspaceId, userId, notify }) {
  const state = { documents: [], signatures: [] };
  const root = document.querySelector('#document-vault');
  const uploadDialog = document.querySelector('#document-modal');
  const signDialog = document.querySelector('#document-sign-modal');
  const uploadForm = document.querySelector('#document-form');
  const signForm = document.querySelector('#document-sign-form');

  async function load() {
    const [documentResult, signatureResult] = await Promise.all([
      supabase.from('business_documents').select('*').is('archived_at', null).order('created_at', { ascending: false }),
      supabase.from('document_signatures').select('*').order('signed_at')
    ]);
    if (documentResult.error) throw documentResult.error;
    if (signatureResult.error) throw signatureResult.error;
    state.documents = documentResult.data || [];
    state.signatures = signatureResult.data || [];
    if (state.documents.length) {
      const { data: signedFiles, error: signedError } = await supabase.storage.from('business-documents').createSignedUrls(state.documents.map(item => item.storage_path), 604800);
      if (signedError) throw signedError;
      state.documents.forEach((item, index) => { item.signedUrl = signedFiles[index]?.signedUrl || ''; });
    }
    render();
  }

  function documentCard(item) {
    const signatures = state.signatures.filter(signature => Number(signature.document_id) === Number(item.id));
    const signedByCurrentUser = signatures.some(signature => signature.signer_user_id === userId);
    const icon = item.mime_type === 'application/pdf' ? 'PDF' : 'IMG';
    return `<article class="document-card"><div class="document-file-icon">${icon}</div><div class="document-card-body"><div class="document-card-top"><span>${esc(shortDate(item.document_date || item.created_at))}</span><span>Version ${item.version_number}</span></div><h3>${esc(item.title)}</h3><p>${esc(item.original_file_name)} · ${fileSize(item.size_bytes)}</p>${item.notes ? `<p class="document-notes">${esc(item.notes)}</p>` : ''}${item.category === 'legal' ? `<div class="signature-summary"><strong>${signatures.length} electronic signature${signatures.length === 1 ? '' : 's'}</strong>${signatures.length ? signatures.map(signature => `<span>✓ ${esc(signature.signer_name)} · ${esc(shortDate(signature.signed_at))}</span>`).join('') : '<span>Awaiting signatures</span>'}</div>` : ''}<div class="document-actions">${item.signedUrl ? `<a class="button secondary small" href="${esc(item.signedUrl)}" target="_blank" rel="noopener">Open document</a>` : '<span class="document-unavailable">File unavailable</span>'}${item.category === 'legal' && !signedByCurrentUser ? `<button class="button primary small" type="button" data-sign-document="${item.id}">Sign</button>` : item.category === 'legal' ? '<span class="signed-chip">Signed by you</span>' : ''}<button class="document-more" type="button" data-archive-document="${item.id}" aria-label="Archive document">•••</button></div></div></article>`;
  }

  function renderSection(category) {
    const documents = state.documents.filter(item => item.category === category);
    const descriptions = { legal: 'Agreements, contracts and formal records', receipt: 'Purchase receipts and proof of payment', other: 'Supplier files, certificates and supporting material' };
    return `<section class="document-section"><div class="document-section-head"><div><p>${esc(descriptions[category])}</p><h3>${esc(categoryLabels[category])}</h3></div><button class="button secondary small" type="button" data-upload-category="${category}">+ Upload</button></div><div class="document-grid">${documents.length ? documents.map(documentCard).join('') : `<div class="document-empty"><strong>No ${categoryLabels[category].toLowerCase()} yet</strong><span>Upload the first file for this section.</span></div>`}</div></section>`;
  }

  function render() {
    root.innerHTML = ['legal', 'receipt', 'other'].map(renderSection).join('');
  }

  function openUpload(category = 'other') {
    uploadForm.reset();
    uploadForm.elements.category.value = category;
    uploadForm.elements.documentDate.value = new Date().toISOString().slice(0, 10);
    uploadForm.querySelector('[data-form-message]').textContent = '';
    uploadDialog.showModal();
  }

  function openSign(documentId) {
    const item = state.documents.find(document => Number(document.id) === Number(documentId));
    if (!item) return;
    signForm.reset();
    signForm.elements.documentId.value = item.id;
    signDialog.querySelector('#document-sign-name').textContent = item.title;
    signForm.querySelector('[data-form-message]').textContent = '';
    signDialog.showModal();
  }

  async function sha256(file) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  uploadForm.addEventListener('submit', async event => {
    event.preventDefault();
    const file = uploadForm.elements.file.files?.[0];
    const message = uploadForm.querySelector('[data-form-message]');
    const button = uploadForm.querySelector('[type="submit"]');
    if (!file || !allowedTypes.includes(file.type)) return message.textContent = 'Choose a PDF, JPG, PNG or WebP file.';
    if (file.size > 20 * 1024 * 1024) return message.textContent = 'Documents must be 20 MB or smaller.';
    button.disabled = true; button.textContent = 'Securing document…'; message.textContent = '';
    let storagePath = '';
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-180);
      storagePath = `${workspaceId}/${userId}/${crypto.randomUUID()}-${safeName}`;
      const hash = await sha256(file);
      const { error: uploadError } = await supabase.storage.from('business-documents').upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: recordError } = await supabase.rpc('create_business_document', {
        p_workspace_id: workspaceId, p_category: uploadForm.elements.category.value,
        p_title: uploadForm.elements.title.value.trim(), p_document_date: uploadForm.elements.documentDate.value || null,
        p_notes: uploadForm.elements.notes.value.trim(), p_original_file_name: file.name,
        p_storage_path: storagePath, p_mime_type: file.type, p_size_bytes: file.size, p_sha256_hex: hash
      });
      if (recordError) throw recordError;
      uploadDialog.close();
      await load();
      notify('Document uploaded securely.', 'success');
    } catch (error) {
      if (storagePath) await supabase.storage.from('business-documents').remove([storagePath]);
      message.textContent = error.message;
    } finally {
      button.disabled = false; button.textContent = 'Upload document';
    }
  });

  signForm.addEventListener('submit', async event => {
    event.preventDefault();
    const message = signForm.querySelector('[data-form-message]');
    const button = signForm.querySelector('[type="submit"]');
    button.disabled = true; button.textContent = 'Recording signature…'; message.textContent = '';
    const { error } = await supabase.rpc('sign_business_document', {
      p_document_id: Number(signForm.elements.documentId.value),
      p_consent: signForm.elements.consent.checked,
      p_confirmation: signForm.elements.confirmation.value
    });
    button.disabled = false; button.textContent = 'Sign this document';
    if (error) return message.textContent = error.message;
    signDialog.close();
    await load();
    notify('Your electronic signature was recorded against this exact document version.', 'success');
  });

  root.addEventListener('click', async event => {
    const upload = event.target.closest('[data-upload-category]');
    if (upload) return openUpload(upload.dataset.uploadCategory);
    const sign = event.target.closest('[data-sign-document]');
    if (sign) return openSign(sign.dataset.signDocument);
    const archive = event.target.closest('[data-archive-document]');
    if (archive && window.confirm('Archive this document? Its file and signatures will be preserved.')) {
      const { error } = await supabase.rpc('archive_business_document', { p_document_id: Number(archive.dataset.archiveDocument) });
      if (error) return notify(error.message, 'error');
      await load();
      notify('Document archived. Its file and signature history were preserved.', 'success');
    }
  });

  document.querySelectorAll('[data-open-document]').forEach(button => button.addEventListener('click', () => openUpload('other')));
  return load();
}
