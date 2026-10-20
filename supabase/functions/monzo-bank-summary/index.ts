import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const cors = {
  'Access-Control-Allow-Origin': 'https://kurionyx.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});
type Connection = { account_id: string; account_name: string; account_type: string; access_token: string;
  refresh_token: string | null; token_expires_at: string | null; status: string };
const monzoFetch = (path: string, token: string) => fetch(`https://api.monzo.com${path}`, {
  headers: { Authorization: `Bearer ${token}` }
});

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const clientId = Deno.env.get('MONZO_CLIENT_ID')?.trim();
  const clientSecret = Deno.env.get('MONZO_CLIENT_SECRET')?.trim();
  if (!supabaseUrl || !anonKey || !serviceKey || !clientId || !clientSecret) return json({ error: 'Server configuration is incomplete.' }, 500);

  const authorization = req.headers.get('Authorization') || '';
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Authentication required.' }, 401);
  const { data: membership, error: membershipError } = await userClient.from('workspace_members').select('workspace_id, role').limit(1).maybeSingle();
  if (membershipError) return json({ error: 'Could not verify workspace access.' }, 500);
  if (!membership) return json({ error: 'Workspace access required.' }, 403);
  if (membership.role !== 'owner') return json({ error: 'Bank information is restricted to the workspace owner.' }, 403);

  const { data: connectionRows, error: connectionError } = await admin.rpc('get_monzo_connection_for_sync', { p_workspace_id: membership.workspace_id });
  if (connectionError) {
    console.error('Monzo connection lookup failed', connectionError.code || 'database_error');
    return json({ error: 'The secure Monzo connection could not be opened.' }, 500);
  }
  const connection = (Array.isArray(connectionRows) ? connectionRows[0] : connectionRows) as Connection | undefined;
  if (!connection || connection.status === 'disconnected') return json({ error: 'Monzo Business is not connected.', code: 'not_connected' }, 409);

  let accessToken = connection.access_token;
  const shouldRefresh = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() <= Date.now() + 60_000 : false;
  if (shouldRefresh) {
    if (!connection.refresh_token) {
      await admin.rpc('set_monzo_connection_sync_state', { p_workspace_id: membership.workspace_id, p_status: 'reauthorisation_required', p_synced: false });
      return json({ error: 'Monzo requires reconnection by the workspace owner.', code: 'reauthorisation_required' }, 409);
    }
    const refreshResponse = await fetch('https://api.monzo.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: connection.refresh_token })
    });
    if (!refreshResponse.ok) {
      console.error('Monzo token refresh failed with status', refreshResponse.status);
      await admin.rpc('set_monzo_connection_sync_state', { p_workspace_id: membership.workspace_id, p_status: 'reauthorisation_required', p_synced: false });
      return json({ error: 'Monzo requires reconnection by the workspace owner.', code: 'reauthorisation_required' }, 409);
    }
    const refreshed = await refreshResponse.json();
    accessToken = String(refreshed.access_token || '');
    if (!accessToken) return json({ error: 'Monzo returned an incomplete refreshed session.' }, 502);
    const expiresAt = refreshed.expires_in ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString() : null;
    const { error: rotateError } = await admin.rpc('rotate_monzo_connection_tokens', {
      p_workspace_id: membership.workspace_id, p_access_token: accessToken,
      p_refresh_token: String(refreshed.refresh_token || ''), p_expires_at: expiresAt
    });
    if (rotateError) {
      console.error('Monzo refreshed token storage failed', rotateError.code || 'database_error');
      return json({ error: 'The refreshed Monzo session could not be stored securely.' }, 500);
    }
  }

  const accountId = encodeURIComponent(connection.account_id);
  // Monzo enforces a strict 90-day window after the first five minutes of an
  // OAuth session. Use 89 days to avoid boundary/clock-skew rejections.
  const since = encodeURIComponent(new Date(Date.now() - 89 * 24 * 60 * 60 * 1000).toISOString());
  const [balanceResponse, potsResponse, transactionsResponse] = await Promise.all([
    monzoFetch(`/balance?account_id=${accountId}`, accessToken),
    monzoFetch(`/pots?current_account_id=${accountId}`, accessToken),
    monzoFetch(`/transactions?account_id=${accountId}&limit=50&since=${since}`, accessToken)
  ]);
  console.log('Monzo bank summary statuses', balanceResponse.status, potsResponse.status, transactionsResponse.status);
  if (balanceResponse.status === 401 || balanceResponse.status === 403) {
    await admin.rpc('set_monzo_connection_sync_state', { p_workspace_id: membership.workspace_id, p_status: 'reauthorisation_required', p_synced: false });
    return json({ error: 'Monzo requires reconnection by the workspace owner.', code: 'reauthorisation_required' }, 409);
  }
  if (!balanceResponse.ok) {
    console.error('Monzo bank summary request failed', balanceResponse.status, potsResponse.status, transactionsResponse.status);
    return json({ error: 'Monzo could not provide the latest bank information.' }, 502);
  }

  const [balance, potsBody, transactionsBody] = await Promise.all([
    balanceResponse.json(),
    potsResponse.ok ? potsResponse.json() : Promise.resolve({ pots: [] }),
    transactionsResponse.ok ? transactionsResponse.json() : Promise.resolve({ transactions: [] })
  ]);
  const pots = (Array.isArray(potsBody.pots) ? potsBody.pots : []).filter((pot: Record<string, unknown>) => !pot.deleted).map((pot: Record<string, unknown>) => ({
    id: String(pot.id || ''), name: String(pot.name || 'Pot'), balance: Number(pot.balance || 0), currency: String(pot.currency || 'GBP')
  }));
  const transactions = (Array.isArray(transactionsBody.transactions) ? transactionsBody.transactions : []).map((transaction: Record<string, any>) => ({
    id: String(transaction.id || ''), amount: Number(transaction.amount || 0), currency: String(transaction.currency || 'GBP'),
    description: String(transaction.description || 'Transaction'), merchant: typeof transaction.merchant === 'object' ? String(transaction.merchant?.name || '') : '',
    category: String(transaction.category || 'general'), created: String(transaction.created || ''), settled: String(transaction.settled || ''), notes: String(transaction.notes || '')
  }));
  await admin.rpc('set_monzo_connection_sync_state', { p_workspace_id: membership.workspace_id, p_status: 'connected', p_synced: true });
  return json({
    account: { name: connection.account_name, type: connection.account_type },
    balance: { available: Number(balance.balance || 0), total: Number(balance.total_balance || balance.balance || 0), currency: String(balance.currency || 'GBP'), spendToday: Number(balance.spend_today || 0) },
    pots,
    payments: transactions.filter((transaction: { amount: number }) => transaction.amount < 0).slice(0, 12),
    income: transactions.filter((transaction: { amount: number }) => transaction.amount > 0).slice(0, 12),
    warnings: [
      ...(!potsResponse.ok ? ['Monzo did not make pots available for this account.'] : []),
      ...(!transactionsResponse.ok ? ['Monzo did not make recent transactions available for this session.'] : [])
    ],
    refreshedAt: new Date().toISOString()
  });
});
