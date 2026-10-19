# Monzo integration status

Kurionyx now has database fields that can safely identify future Monzo-imported
expenses without duplicating a bank transaction. No Monzo account is connected,
no credentials are stored, and no transactions are imported by this change.

## Intended connection

Use the Monzo Developer API only for a Kurionyx account owned by, or explicitly
allowed for, the small internal user group. Monzo states that this API is not for
public applications. A regulated Open Banking integration is a separate route and
requires the appropriate third-party-provider authorisation.

The connection must be owner-only inside the application. The workspace `owner`
role is application authorisation; it does not prove legal ownership or banking
authority. Before connecting an account, Kurionyx must decide which adult has
authority to grant bank access.

## Required server-side design

1. Register a confidential client in Monzo's developer tools.
2. Add an HTTPS Vercel Function for the OAuth start and callback routes.
3. Store `MONZO_CLIENT_ID`, `MONZO_CLIENT_SECRET` and `MONZO_REDIRECT_URI` as
   Vercel server-side secret/config environment variables, never in browser code.
4. Generate and verify an unguessable OAuth `state` value.
5. Store refresh/access tokens only in a server-only encrypted store. Do not put
   them in `public` Supabase tables or return them to the browser.
6. Verify the signed-in Supabase user and the workspace owner role on every
   connect, sync and disconnect request.
7. Import debit transactions idempotently using `source_provider = 'monzo'` and
   `external_transaction_id`. Imported records should begin as `unverified` and
   require review before being linked to stock or included in landed cost.
8. Add token refresh, disconnect/revocation, audit logging and webhook verification
   before enabling automatic background imports.

## Environment variable names

- `MONZO_CLIENT_ID`
- `MONZO_CLIENT_SECRET`
- `MONZO_REDIRECT_URI`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The service-role key is server-only and must never appear in static JavaScript.

