import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

const supabase = createClient(
  'https://wszgmnngwnhtavuxqqyk.supabase.co',
  'sb_publishable_kqyjZOBwyt0rJGEQao-pgw_uiEO8-Nf'
);

const form = document.querySelector('#login-form');
const message = document.querySelector('#login-message');
const submitButton = form.querySelector('[type="submit"]');

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) window.location.replace('toolkit.html');

form.addEventListener('submit', async event => {
  event.preventDefault();
  message.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = 'Signing in…';

  const formData = new FormData(form);
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email')).trim(),
    password: String(formData.get('password'))
  });

  if (error) {
    message.textContent = error.message === 'Invalid login credentials'
      ? 'The email or password is incorrect. Please try again.'
      : error.message;
    submitButton.disabled = false;
    submitButton.textContent = 'Sign in to toolkit';
    return;
  }

  message.classList.add('success');
  message.textContent = 'Signed in. Opening the toolkit…';
  window.location.replace('toolkit.html');
});
