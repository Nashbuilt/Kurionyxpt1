import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const cors = {
  'Access-Control-Allow-Origin': 'https://kurionyx.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const appUrl = 'https://kurionyx.vercel.app/toolkit.html';
const redirectResult = (result: string) => Response.redirect(`${appUrl}?monzo=${encodeURIComponent(result)}`, 302);
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function fetchApprovedBusinessAccounts(accessToken: string) {
  const accountsUrl = new URL('https://api.monzo.com/accounts');
  accountsUrl.searchParams.set('account_type', 'uk_business');
  let response: Response | null = null;
  // Monzo issues the OAuth code before the user has necessarily approved the
  // new token in the mobile app. Recheck the same token so approval is not
  // discarded by starting a second OAuth attempt with a different token.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    response = await fetch(accountsUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (response.ok || ![401, 403].includes(response.status)) return response;
    if (attempt < 11) await wait(5000);
  }
  return response;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  // Dashboard copy/paste can include an invisible trailing newline. Monzo
  // treats OAuth credentials and redirect URIs as exact strings, so normalize
  // surrounding whitespace before constructing either OAuth request.
  const clientId = Deno.env.get('MONZO_CLIENT_ID')?.trim();
  const clientSecret = Deno.env.get('MONZO_CLIENT_SECRET')?.trim();
  const redirectUri = Deno.env.get('MONZO_REDIRECT_URI')?.trim();
  if (!supabaseUrl || !anonKey || !serviceKey || !clientId || !clientSecret || !redirectUri) return json({ error: 'Server configuration is incomplete.' }, 500);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.has('error')) {
    return redirectResult(url.searchParams.get('error') === 'access_denied' ? 'access_denied' : 'invalid_callback');
  }

  if (req.method === 'GET' && url.searchParams.has('code')) {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!state || !code) return redirectResult('invalid_callback');
    const { data: pending } = await admin.from('monzo_oauth_states').select('*').eq('state', state).is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!pending) return redirectResult('invalid_state');
    await admin.from('monzo_oauth_states').update({ used_at: new Date().toISOString() }).eq('state', state).is('used_at', null);

    const tokenResponse = await fetch('https://api.monzo.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code })
    });
    if (!tokenResponse.ok) {
      console.error('Monzo OAuth token exchange failed with status', tokenResponse.status);
      return redirectResult('token_failed');
    }
    const token = await tokenResponse.json();
    if (!token?.access_token) return redirectResult('token_failed');

    // Ask Monzo for business accounts specifically. The unfiltered endpoint's
    // public response does not reliably expose an account-type field, so
    // guessing from a user-facing description can reject a valid business
    // account or, worse, select the wrong account.
    const accountsResponse = await fetchApprovedBusinessAccounts(String(token.access_token));
    if (!accountsResponse) return redirectResult('accounts_failed');
    if (!accountsResponse.ok) {
      console.error('Monzo business account lookup failed with status', accountsResponse.status);
      return redirectResult(accountsResponse.status === 401 || accountsResponse.status === 403 ? 'approval_required' : 'accounts_failed');
    }
    const accountsBody = await accountsResponse.json();
    const accounts = Array.isArray(accountsBody.accounts) ? accountsBody.accounts : [];
    const business = accounts.find((account: Record<string, unknown>) => typeof account.id === 'string' && account.id.length > 0);
    if (!business) return redirectResult('no_business_account');
    const expiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null;
    const { error } = await admin.rpc('store_monzo_connection', {
      p_workspace_id: pending.workspace_id,
      p_account_id: String(business.id),
      p_account_name: String(business.description || 'Monzo Business'),
      p_account_type: 'uk_business',
      p_access_token: String(token.access_token),
      p_refresh_token: String(token.refresh_token || ''),
      p_expires_at: expiresAt,
      p_connected_by: pending.user_id
    });
    if (error) {
      console.error('Monzo connection storage failed', error.code || 'database_error');
      return redirectResult('storage_failed');
    }
    const { data: savedConnection, error: verificationError } = await admin
      .from('monzo_connections')
      .select('workspace_id, account_id, account_type, status')
      .eq('workspace_id', pending.workspace_id)
      .eq('account_id', String(business.id))
      .eq('account_type', 'uk_business')
      .eq('status', 'connected')
      .maybeSingle();
    if (verificationError || !savedConnection) {
      console.error('Monzo connection verification failed', verificationError?.code || 'missing_connection');
      return redirectResult('storage_failed');
    }
    return redirectResult('connected');
  }

  const authorization = req.headers.get('Authorization') || '';
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Authentication required.' }, 401);
  const { data: membership, error: membershipError } = await userClient
    .from('workspace_members')
    .select('workspace_id, role')
    .limit(1)
    .maybeSingle();
  if (membershipError) return json({ error: 'Could not verify workspace access.' }, 500);
  if (!membership) return json({ error: 'Workspace access required.' }, 403);

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  if (body.action === 'status') {
    const { data: connection } = await admin.from('monzo_connections').select('account_name, account_type, status, connected_at, last_synced_at').eq('workspace_id', membership.workspace_id).maybeSingle();
    return json({ connection });
  }
  if (body.action !== 'start') return json({ error: 'Unsupported action.' }, 400);
  if (membership.role !== 'owner') return json({ error: 'Only the workspace owner can connect a bank account.' }, 403);
  const state = crypto.randomUUID();
  const { error: stateError } = await admin.from('monzo_oauth_states').insert({ state, workspace_id: membership.workspace_id, user_id: user.id, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  if (stateError) return json({ error: 'Could not begin the connection.' }, 500);
  const authUrl = new URL('https://auth.monzo.com/');
  authUrl.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', state }).toString();
  return json({ url: authUrl.toString() });
});
