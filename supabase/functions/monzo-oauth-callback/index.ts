import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const cors = {
  'Access-Control-Allow-Origin': 'https://kurionyx.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const appUrl = 'https://kurionyx.vercel.app/toolkit.html';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const clientId = Deno.env.get('MONZO_CLIENT_ID');
  const clientSecret = Deno.env.get('MONZO_CLIENT_SECRET');
  const redirectUri = Deno.env.get('MONZO_REDIRECT_URI');
  if (!supabaseUrl || !anonKey || !serviceKey || !clientId || !clientSecret || !redirectUri) return json({ error: 'Server configuration is incomplete.' }, 500);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.has('code')) {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!state || !code) return Response.redirect(`${appUrl}?monzo=invalid_callback`, 302);
    const { data: pending } = await admin.from('monzo_oauth_states').select('*').eq('state', state).is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!pending) return Response.redirect(`${appUrl}?monzo=invalid_state`, 302);
    await admin.from('monzo_oauth_states').update({ used_at: new Date().toISOString() }).eq('state', state).is('used_at', null);

    const tokenResponse = await fetch('https://api.monzo.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code })
    });
    if (!tokenResponse.ok) return Response.redirect(`${appUrl}?monzo=token_failed`, 302);
    const token = await tokenResponse.json();
    const accountsResponse = await fetch('https://api.monzo.com/accounts', { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!accountsResponse.ok) return Response.redirect(`${appUrl}?monzo=accounts_failed`, 302);
    const accountsBody = await accountsResponse.json();
    const accounts = Array.isArray(accountsBody.accounts) ? accountsBody.accounts : [];
    const business = accounts.find((account: Record<string, unknown>) => /business/i.test(String(account.type || account.account_type || account.description || '')));
    if (!business) return Response.redirect(`${appUrl}?monzo=no_business_account`, 302);
    const expiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null;
    const { error } = await admin.rpc('store_monzo_connection', {
      p_workspace_id: pending.workspace_id,
      p_account_id: String(business.id),
      p_account_name: String(business.description || 'Monzo Business'),
      p_account_type: String(business.type || business.account_type || 'business'),
      p_access_token: String(token.access_token),
      p_refresh_token: String(token.refresh_token || ''),
      p_expires_at: expiresAt,
      p_connected_by: pending.user_id
    });
    if (error) return Response.redirect(`${appUrl}?monzo=storage_failed`, 302);
    return Response.redirect(`${appUrl}?monzo=connected`, 302);
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
