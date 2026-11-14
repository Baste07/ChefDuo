-- REVIEW ONLY. Install disabled; preserve existing C2 freezes.
begin;
lock table public.menu_products,public.menu_categories in share mode;
do $$ begin
 if (select prosrc from pg_proc where oid='public.chefduo_catalog_snapshot()'::regprocedure) is distinct from '
declare catalog jsonb;
begin
 perform set_config(''response.headers'',''[{"Cache-Control":"no-store"}]'',true);
 select jsonb_build_object(
 ''categories'',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.menu_categories c where c.status=''published''),''[]''),
 ''products'',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.menu_products p
 join public.menu_categories c on c.id=p.category_id where p.status=''published'' and c.status=''published''),''[]'')
 ) into catalog;
 return jsonb_build_object(''sequence'',1,''state'',''available'',
 ''digest'',''d30c63afea0fb69e48974a83c4a5ff71dbc94e376e706594cebd684275154ce9'',''payload'',catalog);
end;
' then raise exception 'Stage A function body drift'; end if;
 if (select prosecdef from pg_proc where oid='public.chefduo_catalog_snapshot()'::regprocedure) then raise exception 'Unexpected snapshot privilege mode'; end if;
 if (select count(*) from public.menu_products)<>38 or (select count(*) from public.menu_categories)<>8 then raise exception 'Wrong initial catalog counts'; end if;
 if to_regclass('chefduo_private.catalog_head') is not null then raise exception 'Revision publisher already exists; reconcile first'; end if;
 if to_regprocedure('public.chefduo_catalog_snapshot()') is null then raise exception 'Stage A endpoint missing'; end if;
 if (select count(*) from pg_trigger where tgname='c1_catalog_freeze' and tgenabled='A')<>2 then raise exception 'Freeze baseline mismatch'; end if;
 if (select count(*) from pg_policies where schemaname='storage' and policyname in ('c1_public_images_no_insert','c1_public_images_no_update','c1_public_images_no_delete'))<>3 then raise exception 'Storage baseline mismatch'; end if;
 if public.chefduo_catalog_snapshot()->>'digest'<>'d30c63afea0fb69e48974a83c4a5ff71dbc94e376e706594cebd684275154ce9' then raise exception 'Stage A revision mismatch'; end if;
end; $$;
-- LOCAL D1 PROPOSAL ONLY. Never run against hosted CHEFDUO under D1.
-- Additive transition: C1 catalog/Storage freezes and existing tables stay intact.

create table chefduo_private.catalog_draft (
 singleton boolean primary key default true check(singleton),
 version integer not null default 1 check(version>0), payload jsonb not null
);
create table chefduo_private.catalog_revisions (
 sequence integer primary key check(sequence>0), digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 payload jsonb not null, state text not null check(state in ('available','unavailable')),
 actor_id uuid, published_at timestamptz not null default now(), draft_version integer not null
);
create table chefduo_private.catalog_head (
 singleton boolean primary key default true check(singleton),
 sequence integer not null references chefduo_private.catalog_revisions(sequence), enabled boolean not null default false
);
create table chefduo_private.catalog_events (
 id bigint generated always as identity primary key, actor_id uuid not null,
 occurred_at timestamptz not null default now(), action text not null,
 version integer not null, before_value jsonb, after_value jsonb
);
create table chefduo_private.catalog_assets (
 url text primary key, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer not null check(bytes between 1 and 5242880),
 mime text not null check(mime in ('image/jpeg','image/png','image/webp')),
 verified_at timestamptz not null default now()
);
alter table chefduo_private.catalog_draft enable row level security;
alter table chefduo_private.catalog_revisions enable row level security;
alter table chefduo_private.catalog_head enable row level security;
alter table chefduo_private.catalog_events enable row level security;
alter table chefduo_private.catalog_assets enable row level security;
revoke all on chefduo_private.catalog_draft,chefduo_private.catalog_revisions,
 chefduo_private.catalog_head,chefduo_private.catalog_events,chefduo_private.catalog_assets from public,anon,authenticated,service_role;


-- Stage D1 immutable identity/image bindings survive removals and restoration.
create table chefduo_private.catalog_image_bindings (
 kind text not null check(kind in ('products','categories')), id uuid not null,
 image_url text, image_path text, identity_key text, primary key(kind,id)
);
alter table chefduo_private.catalog_image_bindings enable row level security;
revoke all on chefduo_private.catalog_image_bindings from public,anon,authenticated,service_role;
insert into chefduo_private.catalog_image_bindings select 'products',id,image_url,image_path,legacy_key from public.menu_products
 union all select 'categories',id,image_url,image_path,slug from public.menu_categories;
create function chefduo_private.catalog_image_hold(v jsonb) returns void language plpgsql set search_path='' as $$
begin
 if exists(select 1 from unnest(array['products','categories']) as kinds(kind)
 cross join lateral jsonb_array_elements(v->kinds.kind) entry
 left join chefduo_private.catalog_image_bindings b on b.kind=kinds.kind and b.id=(entry->>'id')::uuid
 where b.id is null or b.image_url is distinct from entry->>'image_url'
 or b.image_path is distinct from entry->>'image_path'
 or b.identity_key is distinct from entry->>case when kinds.kind='products' then 'legacy_key' else 'slug' end)
 then raise exception 'Stage D1 image/identity hold: existing items only; image references cannot change' using errcode='42501'; end if;
end; $$;
revoke all on function chefduo_private.catalog_image_hold(jsonb) from public,anon,authenticated,service_role;

-- Canonicalization matches catalog-core.js: omit updated_at, object keys sorted C,
-- arrays retain order. Payload row arrays are sorted by UUID before hashing.
create function chefduo_private.catalog_canonical(v jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare result text;
begin
 if jsonb_typeof(v)='object' then
  select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||chefduo_private.catalog_canonical(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(v) where key<>'updated_at';
 elsif jsonb_typeof(v)='array' then
  select '['||coalesce(string_agg(chefduo_private.catalog_canonical(value),',' order by ord),'')||']' into result from jsonb_array_elements(v) with ordinality a(value,ord);
 else result=v::text;
 end if;
 return result;
end; $$;
create function chefduo_private.catalog_hash(v jsonb) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(chefduo_private.catalog_canonical(jsonb_build_array(
  coalesce((select jsonb_agg(value order by value->>'id') from jsonb_array_elements(v->'categories')),'[]'),
  coalesce((select jsonb_agg(value order by value->>'id') from jsonb_array_elements(v->'products')),'[]'))),'UTF8')),'hex');
$$;
-- Explicit typed session ID and session expiry; no reliance on stale role claims.
create function chefduo_private.catalog_staff() returns void language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.chefduo_is_admin(),false) or not exists(
  select 1 from auth.sessions s where s.user_id=auth.uid()
   and s.id::text=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')
   and (s.not_after is null or s.not_after>now())
 ) then raise exception 'Active staff session required' using errcode='42501'; end if;
end; $$;

-- Reuse the existing typed constraints, variant trigger and FK validation on
-- isolated temporary tables; never mutate the C1 frozen tables.
create function chefduo_private.catalog_validate(v jsonb) returns void language plpgsql set search_path='' as $$
begin
 if v is null or jsonb_typeof(v->'categories') is distinct from 'array' or jsonb_typeof(v->'products') is distinct from 'array'
  or octet_length(v::text)>2097152 or jsonb_array_length(v->'categories')>100 or jsonb_array_length(v->'products')>1000 then raise exception 'Invalid draft shape or size'; end if;
 if exists(select 1 from jsonb_array_elements(v->'categories') r where jsonb_typeof(r)<>'object' or (r->>'id')!~'^[a-f0-9-]{36}$')
 or exists(select 1 from jsonb_array_elements(v->'products') r where jsonb_typeof(r)<>'object' or (r->>'id')!~'^[a-f0-9-]{36}$'
  or jsonb_typeof(r->'legacy_key') is distinct from 'string' or length(r->>'legacy_key') not between 1 and 160
  or jsonb_typeof(r->'flavors') is distinct from 'array' or jsonb_array_length(r->'flavors')>50)
 then raise exception 'Invalid catalog identifiers or fields'; end if;
 if exists(select 1 from jsonb_array_elements(v->'products') p cross join lateral jsonb_array_elements(p->'flavors') f where jsonb_typeof(f)<>'string' or length(f#>>'{}') not between 1 and 120)
 then raise exception 'Invalid flavor'; end if;
 perform chefduo_private.catalog_image_hold(v);
 drop table if exists pg_temp.d1_products,pg_temp.d1_categories;
 create temporary table d1_categories(like public.menu_categories including constraints including defaults) on commit drop;
 create temporary table d1_products(like public.menu_products including constraints including defaults) on commit drop;
 truncate pg_temp.d1_categories,pg_temp.d1_products;
 insert into pg_temp.d1_categories select * from jsonb_populate_recordset(null::public.menu_categories,v->'categories');
 insert into pg_temp.d1_products select * from jsonb_populate_recordset(null::public.menu_products,v->'products');
 if exists(select 1 from pg_temp.d1_products p where not exists(select 1 from pg_temp.d1_categories c where c.id=p.category_id))
  or exists(select 1 from pg_temp.d1_categories group by id having count(*)>1)
  or exists(select 1 from pg_temp.d1_categories group by slug having count(*)>1)
  or exists(select 1 from pg_temp.d1_products group by id having count(*)>1)
  or exists(select 1 from pg_temp.d1_products where legacy_key is not null group by legacy_key having count(*)>1)
  or exists(select 1 from pg_temp.d1_products where featured_order is not null group by featured_order having count(*)>1)
 then raise exception 'Duplicate or orphan catalog item'; end if;
 if exists(select 1 from jsonb_array_elements(v->'products') p where p ? 'available' and jsonb_typeof(p->'available') is distinct from 'boolean') then raise exception 'Invalid availability'; end if;
 if exists(select 1 from pg_temp.d1_products p where jsonb_typeof(variants) is distinct from 'array' or jsonb_array_length(variants)>30
  or (price_cents is null)=(jsonb_array_length(variants)=0)) then raise exception 'Invalid price variants'; end if;
 if exists(select 1 from pg_temp.d1_products p cross join lateral jsonb_array_elements(p.variants) variant where jsonb_typeof(variant->'name') is distinct from 'string'
  or length(trim(variant->>'name')) not between 1 and 120 or jsonb_typeof(variant->'price_cents') is distinct from 'number'
  or (variant->>'price_cents')!~'^[0-9]+$' or (variant->>'price_cents')::numeric>100000000)
 then raise exception 'Invalid variant price'; end if;
 if exists(select 1 from pg_temp.d1_products p where exists(select 1 from jsonb_array_elements(p.variants) x group by lower(trim(x->>'name')) having count(*)>1)) then raise exception 'Duplicate variant label'; end if;
 if exists(select 1 from (select image_url,image_path from pg_temp.d1_products union all select image_url,image_path from pg_temp.d1_categories) r
  where r.image_path is not null or not exists(select 1 from chefduo_private.catalog_assets a where a.url=r.image_url))
 then raise exception 'Image is not a verified immutable asset'; end if;
end; $$;

create function chefduo_private.catalog_visible(v jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('categories',coalesce((select jsonb_agg(c order by c->>'id') from jsonb_array_elements(v->'categories') c where c->>'status'='published'),'[]'),
 'products',coalesce((select jsonb_agg(p order by p->>'id') from jsonb_array_elements(v->'products') p where p->>'status'='published' and coalesce((p->>'available')::boolean,true)
 and exists(select 1 from jsonb_array_elements(v->'categories') c where c->>'id'=p->>'category_id' and c->>'status'='published')),'[]'));
$$;
create function chefduo_private.catalog_operation(p_action text,p_expected integer default null,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d chefduo_private.catalog_draft; h chefduo_private.catalog_head; s chefduo_private.catalog_revisions; v jsonb;
begin
 perform chefduo_private.catalog_staff();
 select * into d from chefduo_private.catalog_draft where singleton for update;
 select * into h from chefduo_private.catalog_head where singleton for update;
 if not h.enabled then raise exception 'Catalog editing is not activated'; end if;
 if p_action='read' then return jsonb_build_object('version',d.version,'sequence',h.sequence,'catalog',d.payload,'image_editing',false,'existing_items_only',true); end if;
 if p_action='events' then return coalesce((select jsonb_agg(e order by e.id desc) from (
  select e.id,e.actor_id,e.occurred_at,e.action,e.version,
    jsonb_build_object('version',e.version-1) as before_value,
    jsonb_build_object('version',e.version) as after_value,
    case when e.action='PUBLISH' then 'Revision '||(e.after_value->>'sequence')
      else coalesce((select string_agg(label, ', ' order by label) from (
        select distinct coalesce(new_item->>'name',old_item->>'name') as label
        from unnest(array['categories','products']) as kind
        cross join lateral (
          select a.value as old_item,b.value as new_item
          from jsonb_array_elements(e.before_value->kind) a
          full join jsonb_array_elements(e.after_value->kind) b
          on a.value->>'id'=b.value->>'id'
          where a.value is distinct from b.value
        ) items
        order by label limit 10
      ) names),'Catalog draft') end as entity_type
    from (select * from chefduo_private.catalog_events order by id desc limit 100) e) e),'[]'); end if;
 if p_expected is distinct from d.version then raise exception 'Draft conflict; refresh before saving' using errcode='40001'; end if;
 if p_action='save' then
  perform chefduo_private.catalog_validate(p_payload);
  -- Permanent slugs preserve category deep links.
  if exists(select 1 from jsonb_array_elements(d.payload->'categories') old join jsonb_array_elements(p_payload->'categories') new on old->>'id'=new->>'id' where old->>'slug'<>new->>'slug') then raise exception 'Category identifiers are permanent'; end if;
  update chefduo_private.catalog_draft set payload=p_payload,version=d.version+1 where singleton;
  insert into chefduo_private.catalog_events(actor_id,action,version,before_value,after_value) values(auth.uid(),'DRAFT_SAVE',d.version+1,d.payload,p_payload);
  return jsonb_build_object('version',d.version+1);
 elsif p_action='publish' then
  perform chefduo_private.catalog_validate(d.payload);
  v=chefduo_private.catalog_visible(d.payload);
  insert into chefduo_private.catalog_revisions(sequence,digest,payload,state,actor_id,draft_version)
   values(h.sequence+1,chefduo_private.catalog_hash(v),v,case when jsonb_array_length(v->'products')=0 then 'unavailable' else 'available' end,auth.uid(),d.version) returning * into s;
  update chefduo_private.catalog_head set sequence=s.sequence where singleton;
  -- Advance draft version too: duplicate/lost-ack publish cannot create two revisions.
  update chefduo_private.catalog_draft set version=d.version+1 where singleton;
  insert into chefduo_private.catalog_events(actor_id,action,version,before_value,after_value) values(auth.uid(),'PUBLISH',d.version+1,jsonb_build_object('sequence',h.sequence),jsonb_build_object('sequence',s.sequence,'digest',s.digest));
  return to_jsonb(s)-'actor_id';
 elsif p_action='restore' then
  select before_value into v from chefduo_private.catalog_events where id=(p_payload->>'event_id')::bigint and action='DRAFT_SAVE';
  if v is null then raise exception 'Recovery event not found'; end if;
  perform chefduo_private.catalog_validate(v);
  update chefduo_private.catalog_draft set payload=v,version=d.version+1 where singleton;
  insert into chefduo_private.catalog_events(actor_id,action,version,before_value,after_value) values(auth.uid(),'DRAFT_RESTORE',d.version+1,d.payload,v);
  return jsonb_build_object('version',d.version+1);
 end if;
 raise exception 'Unsupported catalog operation';
end; $$;
create function public.chefduo_catalog_admin(p_action text,p_expected integer default null,p_payload jsonb default null)
returns jsonb language sql security invoker set search_path='' as $$ select chefduo_private.catalog_operation(p_action,p_expected,p_payload); $$;
create function chefduo_private.catalog_snapshot() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('sequence',r.sequence,'digest',r.digest,'payload',r.payload,'state',r.state)
 from chefduo_private.catalog_head h join chefduo_private.catalog_revisions r on r.sequence=h.sequence where h.singleton;
$$;
create or replace function public.chefduo_catalog_snapshot() returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return chefduo_private.catalog_snapshot();
end; $$;

revoke all on function chefduo_private.catalog_canonical(jsonb),chefduo_private.catalog_hash(jsonb),chefduo_private.catalog_staff(),chefduo_private.catalog_validate(jsonb),chefduo_private.catalog_visible(jsonb),chefduo_private.catalog_operation(text,integer,jsonb),chefduo_private.catalog_snapshot(),public.chefduo_catalog_admin(text,integer,jsonb),public.chefduo_catalog_snapshot() from public,anon,authenticated,service_role;
grant execute on function chefduo_private.catalog_operation(text,integer,jsonb),public.chefduo_catalog_admin(text,integer,jsonb) to authenticated;
grant execute on function chefduo_private.catalog_snapshot(),public.chefduo_catalog_snapshot() to anon,authenticated;

-- New immutable image namespace: no direct browser writes, including stale staff JWTs.
-- Provision the separate public bucket via supported Storage API / Dashboard, 5 MiB / JPEG PNG WebP.
create policy d1_revision_images_no_insert on storage.objects as restrictive for insert to public with check(bucket_id not in ('menu-images','menu-images-public','menu-images-revisions'));
create policy d1_revision_images_no_update on storage.objects as restrictive for update to public using(bucket_id not in ('menu-images','menu-images-public','menu-images-revisions')) with check(bucket_id not in ('menu-images','menu-images-public','menu-images-revisions'));
create policy d1_revision_images_no_delete on storage.objects as restrictive for delete to public using(bucket_id not in ('menu-images','menu-images-public','menu-images-revisions'));
create function public.chefduo_catalog_register_asset(p_url text,p_sha256 text,p_bytes integer,p_mime text) returns void
language plpgsql security definer set search_path='' as $$
begin
 raise exception 'Stage D1 image registration is disabled' using errcode='42501';
 if p_url is distinct from ('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-revisions/assets/'||p_sha256||'.'||case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'invalid' end) then raise exception 'Invalid immutable asset URL'; end if;
 insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values(p_url,p_sha256,p_bytes,p_mime) on conflict(url) do nothing;
 if not exists(select 1 from chefduo_private.catalog_assets where url=p_url and sha256=p_sha256 and bytes=p_bytes and mime=p_mime) then raise exception 'Asset registry conflict'; end if;
end; $$;
revoke all on function public.chefduo_catalog_register_asset(text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.chefduo_catalog_register_asset(text,text,integer,text) to service_role;
-- Session lookup for the trusted account/image adapters AFTER getUser verifies JWT.
create function public.chefduo_session_active(p_actor uuid,p_session uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=p_session and s.user_id=p_actor and not u.is_anonymous and (s.not_after is null or s.not_after>now()));
$$;
revoke all on function public.chefduo_session_active(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.chefduo_session_active(uuid,uuid) to service_role;

-- Exact frozen initial state is copied; its table and audit rows are untouched.
insert into chefduo_private.catalog_draft(singleton,payload) select true,jsonb_build_object(
 'categories',(select jsonb_agg(to_jsonb(c) order by id) from public.menu_categories c),
 'products',(select jsonb_agg(to_jsonb(p) order by id) from public.menu_products p));
insert into chefduo_private.catalog_revisions(sequence,digest,payload,state,draft_version)
 select 1,chefduo_private.catalog_hash(chefduo_private.catalog_visible(payload)),chefduo_private.catalog_visible(payload),'available',version from chefduo_private.catalog_draft;
insert into chefduo_private.catalog_head(singleton,sequence,enabled) values(true,1,false);
-- Asset registry MUST be filled from the independently verified B3 manifest by
-- the separate generated bootstrap SQL. No URL-prefix-only image approval.

-- LOCAL D1 trusted bootstrap proposal. Apply only after independent byte re-verification.

insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/5f9261532206dc4a4e27775189d2e0f3d3bd821394d7474dbe89497ba134825c/CheesyRice.jpg','5f9261532206dc4a4e27775189d2e0f3d3bd821394d7474dbe89497ba134825c',452613,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/af6f60a1467f2820d9ff609db973361ce1a65cf1ed26942abbc03f9d14a616d7/ChickenSriracha.jpg','af6f60a1467f2820d9ff609db973361ce1a65cf1ed26942abbc03f9d14a616d7',2239283,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/f9cba163e8307b6a141614c03c82232e3a1ecda12205565aec0aa778f0f25b24/Coffee.jpg','f9cba163e8307b6a141614c03c82232e3a1ecda12205565aec0aa778f0f25b24',58559,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/54362911d29f07c2f937b8ff5b9dbcf0dfe3af65f38ce794e8be9182f094526b/FoodImg15.jpg','54362911d29f07c2f937b8ff5b9dbcf0dfe3af65f38ce794e8be9182f094526b',69597,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/e615c8a2d9f53a126388572819628e438685355bc072fdb92bab1a3c6bc165e9/FoodImg2.jpg','e615c8a2d9f53a126388572819628e438685355bc072fdb92bab1a3c6bc165e9',487901,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/119b8d9deba4240ebb9dc05812618f38463fc9cba8289bd2aec5ce68bab6bb12/FoodImg7.jpg','119b8d9deba4240ebb9dc05812618f38463fc9cba8289bd2aec5ce68bab6bb12',506498,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/632aa92d4223aa78f8fbc41b54f16c1647b3aef879e3c1771b8b64eeb037386d/Frappe.jpg','632aa92d4223aa78f8fbc41b54f16c1647b3aef879e3c1771b8b64eeb037386d',436054,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/687d84309ade4205618f9dbd575829a833a71b01e4bd48eebd36e231175833be/GarlicRice.jpg','687d84309ade4205618f9dbd575829a833a71b01e4bd48eebd36e231175833be',491102,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/eff663245f032175d8f00619aee644f08cd35dd308287b038207e2ab9534ae4e/MiniCheesecake.png','eff663245f032175d8f00619aee644f08cd35dd308287b038207e2ab9534ae4e',962433,'image/png');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/d9258ee3b842485b454085a93dc84b862e165618f1f40e872ee1889b7db75b45/PlainRice.jpg','d9258ee3b842485b454085a93dc84b862e165618f1f40e872ee1889b7db75b45',407357,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/5415ddedab315c0cfb839036d28a96e0b5c4e063196dcd02ff4eef33178558ee/PoppersAndRice.jpg','5415ddedab315c0cfb839036d28a96e0b5c4e063196dcd02ff4eef33178558ee',2359152,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/a707faa034455647fe7cdbdcbd2162794b3d354c69ecf3cb5928d4133f7fb342/SpicyRice.jpg','a707faa034455647fe7cdbdcbd2162794b3d354c69ecf3cb5928d4133f7fb342',544942,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/12a8c62d22194d88cc17aca22d249f5e0918f5d6393a2ba07b40ec592148c3e7/SpicyTapa.jpg','12a8c62d22194d88cc17aca22d249f5e0918f5d6393a2ba07b40ec592148c3e7',2417032,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/5c752b722ba1f3ed1440d1283dafaab0e1999abcdee33e9bad4861f24fb2eeb3/Waffle.jpg','5c752b722ba1f3ed1440d1283dafaab0e1999abcdee33e9bad4861f24fb2eeb3',743873,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/479140d4da9bbfb720f0554551d4f208846e1014a9b606fc4b0d4b1f1c7436fd/all-sushi-preview-960.webp','479140d4da9bbfb720f0554551d4f208846e1014a9b606fc4b0d4b1f1c7436fd',137592,'image/webp');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/4b575e6302f0dd27dba00ff9ab9d826ce791804ab6dd6a278e5006e5b99eb56f/beefmami.jpg','4b575e6302f0dd27dba00ff9ab9d826ce791804ab6dd6a278e5006e5b99eb56f',242208,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/c44eb5fbb3ef001cb5e202d9452da030dba542c138b05b17b9931e4a7252c5b3/california-maki-960.webp','c44eb5fbb3ef001cb5e202d9452da030dba542c138b05b17b9931e4a7252c5b3',156872,'image/webp');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/3a2f0201b5e283caa359f50eb3b0e35b40fb489fac649481370477cfb602bb8e/cheesy-tapa.jpg','3a2f0201b5e283caa359f50eb3b0e35b40fb489fac649481370477cfb602bb8e',2377444,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/3280567ae0c9f4946b2b3a452ee260745dfd5a68d934ee0477239fd959ac1ca8/chicken-fries.jpg','3280567ae0c9f4946b2b3a452ee260745dfd5a68d934ee0477239fd959ac1ca8',1291598,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/d251d07def45b1971c4f965506a1f4f21a6087180d23902461734a858192bf48/diablo.jpg','d251d07def45b1971c4f965506a1f4f21a6087180d23902461734a858192bf48',192496,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/506912b2a940ee8cf6fb60cfb7c2b71c27e773c4073fdd208f0bf7c3f8dd71c4/fruitsoda.jpg','506912b2a940ee8cf6fb60cfb7c2b71c27e773c4073fdd208f0bf7c3f8dd71c4',231860,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/bcb6e82dc719ca9c22aa139fd45f786ab7fa9fe172618253b362134a85fc7109/mango-kani-maki-960.webp','bcb6e82dc719ca9c22aa139fd45f786ab7fa9fe172618253b362134a85fc7109',120064,'image/webp');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/c1a2238042ead7df89aca9c9aca68842b80239a8735439de42480897d3a68bd0/marinated.jpg','c1a2238042ead7df89aca9c9aca68842b80239a8735439de42480897d3a68bd0',1237698,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/60fdd53f72b7b7a1d24cc66eda1bb03abd64f3d80d7def83439214b0ac5172c3/menu1.jpg','60fdd53f72b7b7a1d24cc66eda1bb03abd64f3d80d7def83439214b0ac5172c3',754498,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/49e52b00153400bd1dbcfd9d79475ec5fdb83efdb26555e0e109c71181ae0cae/menu2.jpg','49e52b00153400bd1dbcfd9d79475ec5fdb83efdb26555e0e109c71181ae0cae',616399,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/2347a7d2dd88ff71dba7df49dba63ec7f004f6583c6a3c389a3dfe2c2c64fdac/menu3.jpg','2347a7d2dd88ff71dba7df49dba63ec7f004f6583c6a3c389a3dfe2c2c64fdac',635602,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/47904f7c087366863a44cb074db8b34751efed3f7d51271da92a19d32456450e/menu4.jpg','47904f7c087366863a44cb074db8b34751efed3f7d51271da92a19d32456450e',137344,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/dcd5e934d0b05b543fc32a22bfcd51ffd5c34a1b1ca0f342d37a8133d55807d7/menu5.jpg','dcd5e934d0b05b543fc32a22bfcd51ffd5c34a1b1ca0f342d37a8133d55807d7',643833,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/0067bc3675bbf4cd8633ceaeb426c615b23e4213b85ed708a893069b40e6b661/og-tapa.jpg','0067bc3675bbf4cd8633ceaeb426c615b23e4213b85ed708a893069b40e6b661',2210366,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/7e095cd1f2465443787f0a904f6da6fe053c4bcd0d73872a6cd76960dc0f29f7/pancit-canton.jpg','7e095cd1f2465443787f0a904f6da6fe053c4bcd0d73872a6cd76960dc0f29f7',344380,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/9bbb2b9c5bc1659b70a9771ed83ba372ddd1fe306d41b419b0f572049773b1f4/pancitbihon.jpg','9bbb2b9c5bc1659b70a9771ed83ba372ddd1fe306d41b419b0f572049773b1f4',624210,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/ff3ef87e48efeae80510e8acee396ce52468d216dbeb90e5c5056e12d9085d4b/pancitmix.jpg','ff3ef87e48efeae80510e8acee396ce52468d216dbeb90e5c5056e12d9085d4b',455316,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/8aae1475472bee849f007bacbff7edf4762fe06a33d6f885923d61b275099e09/pitcher.jpg','8aae1475472bee849f007bacbff7edf4762fe06a33d6f885923d61b275099e09',251105,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/4d347f22fd78b8bbddc9a23b64d16ee18a661841f72667227eb76ce5b26c7668/poppers-series.jpg','4d347f22fd78b8bbddc9a23b64d16ee18a661841f72667227eb76ce5b26c7668',1708242,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/535e4b7e6a7efbadbb566d0b443799f678233a9b9a7f60f077f010c85f84f458/poppersfries.jpg','535e4b7e6a7efbadbb566d0b443799f678233a9b9a7f60f077f010c85f84f458',1239928,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/d619163530264877a9a4e02f6a625995c3e1a12b6d7527086fed5b8b013bca6c/sisig.jpg','d619163530264877a9a4e02f6a625995c3e1a12b6d7527086fed5b8b013bca6c',341079,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/2ff41c9f484769b50ec30828dd761d1671466c131a3c7288eaa04284ea7c652d/solofries.png','2ff41c9f484769b50ec30828dd761d1671466c131a3c7288eaa04284ea7c652d',712955,'image/png');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/3b79a3eb4a131f68df0c7b9025e9eff945c5e72a4ba5f3c7af62c441cdb35ff9/tapa-puluts.jpg','3b79a3eb4a131f68df0c7b9025e9eff945c5e72a4ba5f3c7af62c441cdb35ff9',141146,'image/jpeg');
insert into chefduo_private.catalog_assets(url,sha256,bytes,mime) values('https://mprtxauuwvhkicjpkhvw.supabase.co/storage/v1/object/public/menu-images-public/approval-b/v1/0c933682f4cf82883fc2207d1e10ab0ee9180eeffd847c463b4b9886b2569d6e/volcano-maki-960.webp','0c933682f4cf82883fc2207d1e10ab0ee9180eeffd847c463b4b9886b2569d6e',155208,'image/webp');
do $$ begin if (select digest from chefduo_private.catalog_revisions where sequence=1) <> 'd30c63afea0fb69e48974a83c4a5ff71dbc94e376e706594cebd684275154ce9' then raise exception 'Initial revision mismatch'; end if; end; $$;

do $$ begin
 if (select count(*) from chefduo_private.catalog_assets)<>39 then raise exception 'Asset count mismatch'; end if;
 perform chefduo_private.catalog_validate((select payload from chefduo_private.catalog_draft));
 if (select enabled from chefduo_private.catalog_head) then raise exception 'Must install disabled'; end if;
 if has_function_privilege('anon','public.chefduo_catalog_admin(text,integer,jsonb)','execute') then raise exception 'Anonymous writer privilege'; end if;
end; $$;
notify pgrst, 'reload schema';
commit;
