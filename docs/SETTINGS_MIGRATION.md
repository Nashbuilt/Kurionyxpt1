# Settings foundation migration

This work is local-only. It has not been applied to Supabase or deployed to Vercel.

## What the migration adds

- `workspace_profiles`
- `suppliers`
- `sales_channels`
- `stock_locations`
- `product_categories`
- `expense_categories`
- `workspace_integrations`
- `list_workspace_members(workspace_id)` for a member-visible, workspace-scoped team list

All tables are workspace-scoped, have RLS enabled and use explicit grants. Workspace members can read settings. Only users whose application membership role is `owner` can insert or update settings. That role is not evidence of legal ownership, directorship or banking authority.

Settings records cannot be deleted through the browser. Configurable records use `archived_at`; active names are case-insensitively unique within a workspace.

## Legacy-data strategy

The migration does not rewrite or automatically import existing free-text values from stock, sales or expenses. The frontend suggests active configured categories and channels through datalists while still accepting an existing or new free-text value.

This avoids silently changing historical records. After deployment, an application owner can manually create reviewed settings matching the desired legacy values.

## Safe review sequence

1. Verify that Stage 1 commit and migration have been reviewed first.
2. Compare the live schema with repository migrations; do not assume Stage 1 is deployed.
3. Take or verify a recoverable Supabase backup.
4. Apply both migrations in order to a disposable Supabase branch/local environment.
5. Run `supabase/tests/stage1_inventory_ledger_test.sql` and `supabase/tests/settings_foundation_test.sql`.
6. Run Supabase database and security advisors.
7. Confirm ordinary members can read but cannot mutate settings.
8. Confirm an unrelated workspace cannot read or modify settings.
9. Confirm legacy category and marketplace strings remain unchanged.
10. Apply the database migration before deploying the frontend.

## Recovery

The migration runs in one PostgreSQL transaction, so a statement failure rolls the entire migration back. After settings are in use, prefer a reviewed forward-fix migration. Dropping tables would destroy user-entered configuration and is not provided as an automated rollback.

The frontend should not be deployed before the database migration. If its settings queries encounter a missing schema, the Settings page shows a migration-required error while the existing toolkit remains available.
