-- REVIEW ONLY. Separate authorization; enables existing-item non-image drafts/publishing.
begin;
select singleton from chefduo_private.catalog_draft for update;
select singleton from chefduo_private.catalog_head for update;
do $$ begin
 if (select sequence from chefduo_private.catalog_head)<>1 or (select version from chefduo_private.catalog_draft)<>1 then raise exception 'Activation baseline drift'; end if;
 perform chefduo_private.catalog_validate((select payload from chefduo_private.catalog_draft));
 if (select count(*) from pg_trigger where tgname='c1_catalog_freeze' and tgenabled='A')<>2 then raise exception 'Freeze missing'; end if;
end; $$;
update chefduo_private.catalog_head set enabled=true where singleton;
commit;
