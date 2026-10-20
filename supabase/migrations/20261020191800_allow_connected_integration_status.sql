-- The Settings foundation predates live OAuth connections and only allowed
-- planning states. Monzo reaches secure storage before this constraint rejects
-- the final `connected` status update.
begin;
select pg_advisory_xact_lock(hashtext('kurionyx:integration_status_values'));

alter table public.workspace_integrations
  drop constraint if exists workspace_integrations_status_check;

alter table public.workspace_integrations
  add constraint workspace_integrations_status_check
  check (status in (
    'not_connected',
    'planned',
    'configuration_required',
    'connected',
    'reauthorisation_required',
    'disconnected'
  )) not valid;

alter table public.workspace_integrations
  validate constraint workspace_integrations_status_check;

commit;
