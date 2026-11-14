-- REVIEW ONLY. Safe read-only restoration; preserves all additive tables/history.
begin;
select singleton from chefduo_private.catalog_draft for update;
select singleton from chefduo_private.catalog_head for update;
do $$ begin
 if (select sequence from chefduo_private.catalog_head)<>1 or exists(select 1 from chefduo_private.catalog_revisions where sequence<>1) or exists(select 1 from chefduo_private.catalog_events where action='PUBLISH') then raise exception 'Cannot return to frozen Stage A after a newer publication'; end if;
 if (select digest from chefduo_private.catalog_revisions where sequence=1)<>'d30c63afea0fb69e48974a83c4a5ff71dbc94e376e706594cebd684275154ce9' then raise exception 'Initial revision drift'; end if;
end; $$;
-- LOCAL REVIEW ONLY. Safe pause, NOT destructive schema rollback.
-- Keeps the latest customer snapshot, all assets/history and C1 freezes intact.

select singleton from chefduo_private.catalog_draft for update;
select singleton from chefduo_private.catalog_head for update;
update chefduo_private.catalog_head set enabled=false where singleton;
revoke execute on function public.chefduo_catalog_admin(text,integer,jsonb),chefduo_private.catalog_operation(text,integer,jsonb) from authenticated;
revoke execute on function public.chefduo_catalog_register_asset(text,text,integer,text) from service_role;

-- Do NOT move sequence backward, drop snapshots, delete images, remove the C1
-- freeze, or revert customers to a static-price client after later publications.


-- Preserve the C2 freeze. This endpoint has no draft or write capability.
create or replace function public.chefduo_catalog_snapshot() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare catalog jsonb;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 select jsonb_build_object(
 'categories',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.menu_categories c where c.status='published'),'[]'),
 'products',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.menu_products p
 join public.menu_categories c on c.id=p.category_id where p.status='published' and c.status='published'),'[]')
 ) into catalog;
 return jsonb_build_object('sequence',1,'state','available',
 'digest','d30c63afea0fb69e48974a83c4a5ff71dbc94e376e706594cebd684275154ce9','payload',catalog);
end;
$$;
revoke all on function public.chefduo_catalog_snapshot() from public,anon,authenticated,service_role;
grant execute on function public.chefduo_catalog_snapshot() to anon,authenticated;

notify pgrst, 'reload schema';
commit;
