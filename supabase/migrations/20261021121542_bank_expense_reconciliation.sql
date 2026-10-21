-- Bank-to-expense reconciliation and useful expense category defaults.
-- Additive only: historical expenses and bank records are not rewritten.

begin;

select pg_advisory_xact_lock(hashtext('kurionyx:bank_expense_reconciliation'));

do $$
declare
  missing_objects text[] := array[]::text[];
begin
  if to_regclass('public.expenses') is null then missing_objects := array_append(missing_objects, 'public.expenses'); end if;
  if to_regclass('public.expense_categories') is null then missing_objects := array_append(missing_objects, 'public.expense_categories'); end if;
  if to_regclass('public.workspace_members') is null then missing_objects := array_append(missing_objects, 'public.workspace_members'); end if;
  if array_length(missing_objects, 1) is not null then
    raise exception 'Bank expense reconciliation prerequisites are missing: %', array_to_string(missing_objects, ', ')
      using hint = 'Apply the repository migrations in order before continuing.';
  end if;
end $$;

alter table public.expenses
  add column if not exists payment_reference text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_payment_reference_length_check'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_payment_reference_length_check
      check (payment_reference is null or char_length(payment_reference) <= 240);
  end if;
end $$;

create index if not exists expenses_workspace_payment_reference_idx
  on public.expenses (workspace_id, payment_reference)
  where payment_reference is not null;

insert into public.expense_categories (workspace_id, name, notes)
select workspace.id, seed.name, seed.notes
from public.workspaces as workspace
cross join (values
  ('Communications', 'Phone, internet, postage and business communication.'),
  ('Transport', 'Local travel, fuel, parking and courier journeys.'),
  ('Professional services', 'Accounting, legal, consulting and specialist services.'),
  ('Subscriptions', 'Recurring tools, memberships and paid services.'),
  ('Stock purchases', 'Goods bought for resale.'),
  ('Shipping & customs', 'Supplier freight, duties, customs and delivery charges.'),
  ('Marketplace fees', 'Amazon, eBay and other selling-platform charges.'),
  ('Software & tools', 'Non-recurring software, apps and operational tools.'),
  ('Marketing & advertising', 'Advertising, promotions, design and content.'),
  ('Packaging & fulfilment', 'Boxes, labels, preparation and fulfilment supplies.'),
  ('Insurance', 'Business and product insurance.'),
  ('Banking & payment fees', 'Bank, card-processing and currency-conversion fees.'),
  ('Office & equipment', 'Office supplies, devices and equipment.'),
  ('Travel & accommodation', 'Business travel beyond routine local transport.'),
  ('Training & research', 'Courses, samples, research and professional learning.'),
  ('Taxes & compliance', 'Registration, licences, tax and compliance charges.'),
  ('Refunds & returns', 'Customer refunds, return postage and related costs.'),
  ('Other', 'Costs that do not fit another active category.')
) as seed(name, notes)
where not exists (
  select 1 from public.expense_categories as category
  where category.workspace_id = workspace.id
    and category.archived_at is null
    and lower(category.name) = lower(seed.name)
);

create or replace function public.save_bank_expense(
  p_workspace_id bigint,
  p_expense_id bigint,
  p_description text,
  p_category text,
  p_expense_date date,
  p_amount numeric,
  p_stock_item_id bigint,
  p_include_in_landed_cost boolean,
  p_data_status text,
  p_external_transaction_id text,
  p_payment_reference text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id bigint;
  transaction_id text := nullif(trim(coalesce(p_external_transaction_id, '')), '');
  reference text := nullif(trim(coalesce(p_payment_reference, '')), '');
begin
  if auth.uid() is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = p_workspace_id
      and member.user_id = auth.uid()
      and member.role = 'owner'
  ) then
    raise exception 'Only the workspace owner can reconcile bank payments.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_description, ''))) not between 1 and 240 then raise exception 'Expense description is required.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_category, ''))) not between 1 and 80 then raise exception 'Expense category is required.' using errcode = '22023'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Expense amount cannot be negative.' using errcode = '22023'; end if;
  if p_data_status not in ('verified', 'unverified', 'demonstration') then raise exception 'Invalid record status.' using errcode = '22023'; end if;
  if p_include_in_landed_cost and p_stock_item_id is null then raise exception 'Landed-cost expenses require a stock item.' using errcode = '22023'; end if;
  if p_expense_id is null and transaction_id is null then raise exception 'A bank transaction is required for a new reconciled expense.' using errcode = '22023'; end if;

  if p_expense_id is null then
    insert into public.expenses (
      workspace_id, description, category, expense_date, amount, stock_item_id,
      include_in_landed_cost, source_provider, external_transaction_id,
      payment_reference, data_status
    ) values (
      p_workspace_id, trim(p_description), trim(p_category), p_expense_date, p_amount,
      p_stock_item_id, p_include_in_landed_cost, 'monzo', transaction_id, reference,
      p_data_status
    ) returning id into saved_id;
  else
    update public.expenses as expense
    set description = trim(p_description), category = trim(p_category),
        expense_date = p_expense_date, amount = p_amount,
        stock_item_id = p_stock_item_id,
        include_in_landed_cost = p_include_in_landed_cost,
        source_provider = case when transaction_id is null then 'manual' else 'monzo' end,
        external_transaction_id = transaction_id,
        payment_reference = reference,
        data_status = p_data_status
    where expense.id = p_expense_id and expense.workspace_id = p_workspace_id
    returning expense.id into saved_id;
    if saved_id is null then raise exception 'Expense not found in this workspace.' using errcode = 'P0002'; end if;
  end if;

  return saved_id;
end;
$$;

revoke all on function public.save_bank_expense(bigint, bigint, text, text, date, numeric, bigint, boolean, text, text, text) from public, anon;
grant execute on function public.save_bank_expense(bigint, bigint, text, text, date, numeric, bigint, boolean, text, text, text) to authenticated;

revoke insert, update on table public.expenses from authenticated;
grant select on table public.expenses to authenticated;
grant insert (
  workspace_id, description, category, expense_date, amount,
  stock_item_id, include_in_landed_cost, payment_reference, data_status
) on table public.expenses to authenticated;
grant update (
  description, category, expense_date, amount,
  stock_item_id, include_in_landed_cost, payment_reference
) on table public.expenses to authenticated;

commit;
