-- Add practical e-commerce expense categories without rewriting existing records.
begin;
select pg_advisory_xact_lock(hashtext('kurionyx:expand_expense_categories'));

insert into public.expense_categories (workspace_id, name, notes)
select workspace.id, seed.name, seed.notes
from public.workspaces workspace
cross join (values
  ('Amazon selling fees', 'Amazon referral, closing and selling-plan charges.'),
  ('FBA fulfilment fees', 'Amazon fulfilment and per-order handling charges.'),
  ('Amazon storage fees', 'FBA monthly storage and aged-inventory charges.'),
  ('Amazon advertising', 'Sponsored listings and other Amazon advertising.'),
  ('Shipping to Amazon', 'Transporting prepared stock to an Amazon fulfilment centre.'),
  ('Customer delivery', 'Postage or courier charges for direct customer orders.'),
  ('Supplier shipping & customs', 'Inbound freight, import duty and customs handling.'),
  ('Packaging materials', 'Boxes, mailers, tape, void fill and protective packaging.'),
  ('Stock preparation & labelling', 'Product preparation, bagging, barcodes and FNSKU labels.'),
  ('Amazon returns & reimbursements', 'Return processing costs and Amazon reimbursements.'),
  ('Marketplace fees', 'Fees charged by Amazon, eBay or another sales platform.'),
  ('Banking & payment fees', 'Bank, card processing and foreign-exchange charges.')
) seed(name, notes)
where not exists (
  select 1 from public.expense_categories category
  where category.workspace_id = workspace.id and category.archived_at is null and lower(category.name) = lower(seed.name)
);

commit;
