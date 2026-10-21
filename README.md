# Kurionyx

First-stage website prototype for Kurionyx, combining:

- a public business landing page;
- sample customer-facing product categories;
- an introductory investor page; and
- a separate private stock and expense toolkit.

## Running locally

Serve the folder with any static web server, then open the local URL in a browser. No build step is required. The Supabase browser client is loaded as a pinned ES module.

- `/` is the public business website and contains no link to the internal tools.
- `/login.html` is the private team sign-in page.
- `/toolkit.html` is the authenticated operations workspace and redirects signed-out visitors to the login page.

The private routes are marked `noindex` and intentionally unlinked from the public site. The operations toolkit uses Supabase Auth and a shared Postgres workspace. Row Level Security is the security boundary and limits records to approved workspace members. The browser uses only the project's publishable key; never add a Supabase secret or service-role key to this repository.

The database definition used for the initial project is in `supabase/schema.sql`. Apply `supabase/inventory_expansion.sql` after it to add product categories, notes, landed costs, sales-led stock reduction, and incoming/outgoing shipment tracking. The reviewed Stage 1 additive migration is `supabase/migrations/202610170001_stage1_inventory_integrity.sql`; follow `docs/STAGE1_INVENTORY_MIGRATION.md` before applying it anywhere. Amazon, Starling, Monzo, and OpenAI remain roadmap integrations.

The database-backed Settings foundation is in `supabase/migrations/202610170002_settings_foundation.sql`. It must be reviewed and applied after Stage 1. Follow `docs/SETTINGS_MIGRATION.md`; the migration preserves existing free-text operational records.

The dashboard groups variations and colours by their category. Confirmed KPIs include only records explicitly marked as verified. Recording a sale is an atomic database action: the sales record and its inventory movement are saved only when enough units exist, and the matching stock quantity is reduced in the same transaction.

The internal toolkit also includes a browser-local profitability calculator that accepts mixed per-unit and whole-batch inputs, plus a spending view that groups the existing expense ledger by day, week or month. Stock landed unit cost allocates recorded supplier shipping and product fees across opening-balance and receipt units so selling stock does not inflate the per-unit cost.

Expenses can also be linked to a stock item and explicitly included in its landed unit cost. Historical expenses remain unchanged, and general operating expenses remain available in the main expense ledger. The owner-only Monzo Developer API connection provides read-only business balances, pots and recent transactions through server-side credentials; see `docs/MONZO_INTEGRATION.md`.

The reviewed bank reconciliation migration is `supabase/migrations/20261021121542_bank_expense_reconciliation.sql`. It lets the workspace owner match a Monzo payment to one expense, keeps the payment reference visible on both Bank and Expenses, and seeds useful expense categories without rewriting historical values. The Expenses page compares confirmed turnover, recorded spend, estimated profit and return on spend using currently available sales and stock-cost data. Follow `docs/BANK_EXPENSE_RECONCILIATION.md` before applying or deploying it.

## Stage 1 checks

Run the dependency-free repository checks with `node --test tests/*.test.mjs` and JavaScript syntax checks with `node --check analysis-tools.js`, `node --check toolkit.js` and `node --check settings.js`. The SQL integration tests in `supabase/tests/` must be run only against a disposable local or branch database after applying all migrations.

## Prototype status

Product information, figures, and the contact email are placeholders and should be replaced before the site is published publicly.
