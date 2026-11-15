-- LOCAL REVIEW ONLY. Safe pause, NOT destructive schema rollback.
-- Keeps the latest customer snapshot, all assets/history and C1 freezes intact.
begin;
select singleton from chefduo_private.catalog_draft for update;
select singleton from chefduo_private.catalog_head for update;
update chefduo_private.catalog_head set enabled=false where singleton;
revoke execute on function public.chefduo_catalog_admin(text,integer,jsonb),chefduo_private.catalog_operation(text,integer,jsonb) from authenticated;
revoke execute on function public.chefduo_catalog_register_asset(text,text,integer,text) from service_role;
commit;
-- Do NOT move sequence backward, drop snapshots, delete images, remove the C1
-- freeze, or revert customers to a static-price client after later publications.
