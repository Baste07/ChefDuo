-- READ ONLY. Verify the external project URL/ref separately before running.
select current_user,session_user,current_setting('supautils.version',true) as supautils_version,
 current_setting('supautils.policy_grants',true)::jsonb->current_user ? 'storage.objects' as delegated_policy_authority,
 (select rolsuper from pg_roles where rolname=current_user) as superuser,
 (select pg_get_userbyid(relowner) from pg_class where oid='storage.objects'::regclass) as storage_owner;
select encode(sha256(convert_to(prosrc,'UTF8')),'hex') as snapshot_body_sha256,prosecdef,proacl
 from pg_proc where oid=to_regprocedure('public.chefduo_catalog_snapshot()');
select public.chefduo_catalog_snapshot()-'payload' as published_revision;
select count(*) as expected_two_always_freezes from pg_trigger where tgname='c1_catalog_freeze' and tgenabled='A';
