-- LOCAL PROPOSAL ONLY. Not authorized for production installation.
-- Existing source, catalog, Auth tables, freezes and Storage policies are preserved.
begin;
select pg_catalog.pg_advisory_xact_lock(71420381);
lock table chefduo_private.admin_members,chefduo_private.admin_invitations in share row exclusive mode;
do $$ begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Owner policy requires READ COMMITTED'; end if;
 if (select count(*) from chefduo_private.admin_members where role='owner' and status='active' and enabled) not between 1 and 2 then raise exception 'Owner baseline must be one or two'; end if;
 if to_regclass('chefduo_private.owner_slots') is not null then raise exception 'Owner policy already exists; reconcile first'; end if;
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='public.chefduo_account_operation(uuid,text,uuid,text,uuid,uuid,uuid,text)'::regprocedure)<>'34c964405eb3054763204e87a15fa00b73b9803f1f6e345ce91bdd40450c039a' then raise exception 'Account operation baseline drift'; end if;
end; $$;
alter table chefduo_private.admin_invitations add column requested_role text not null default 'admin' check(requested_role in ('admin','owner'));
create table chefduo_private.owner_slots(
 slot smallint primary key check(slot in (1,2)),
 user_id uuid unique references auth.users(id) on delete restrict,
 invitation_id uuid unique references chefduo_private.admin_invitations(id) on delete cascade deferrable initially deferred,
 check((user_id is not null)::integer+(invitation_id is not null)::integer=1)
);
alter table chefduo_private.owner_slots enable row level security;
revoke all on chefduo_private.owner_slots from public,anon,authenticated,service_role;
insert into chefduo_private.owner_slots(slot,user_id)
 select row_number() over(order by user_id)::smallint,user_id from chefduo_private.admin_members where role='owner' and status='active' and enabled;

create function chefduo_private.claim_owner_slot(p_user uuid,p_invitation uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(71420381);
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Owner capacity requires READ COMMITTED'; end if;
 if (p_user is not null)::integer+(p_invitation is not null)::integer<>1 then raise exception 'Invalid Owner seat identity'; end if;
 insert into chefduo_private.owner_slots(slot,user_id,invitation_id)
 select n::smallint,p_user,p_invitation from generate_series(1,2) n
 where not exists(select 1 from chefduo_private.owner_slots where slot=n) order by n limit 1
 on conflict do nothing;
 if not found then raise exception 'Two Owner slots are full (active or reserved invitations)' using errcode='23514'; end if;
end; $$;

create function chefduo_private.sync_owner_member_slot() returns trigger
language plpgsql security definer set search_path='' as $$
declare was_owner boolean:=false; is_owner boolean:=false;
begin
 perform pg_catalog.pg_advisory_xact_lock(71420381);
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Owner membership changes require READ COMMITTED'; end if;
 if tg_op<>'INSERT' then was_owner:=old.role='owner' and old.status='active' and old.enabled; end if;
 if tg_op<>'DELETE' then is_owner:=new.role='owner' and new.status='active' and new.enabled; end if;
 if was_owner and not is_owner then
  if not exists(select 1 from chefduo_private.owner_slots where user_id is not null and user_id<>old.user_id)
  then raise exception 'The final active Owner cannot be disabled, revoked, deleted or demoted'; end if;
  delete from chefduo_private.owner_slots where user_id=old.user_id;
 elsif is_owner and not was_owner then
  -- Transfer, never release/re-claim: pending Owner acceptance consumes its reserved seat.
  update chefduo_private.owner_slots s set invitation_id=null,user_id=new.user_id
  from chefduo_private.admin_invitations i
  where s.invitation_id=i.id and i.user_id=new.user_id and i.requested_role='owner' and i.status in ('provisioning','sent','failed');
  if not found then perform chefduo_private.claim_owner_slot(new.user_id,null); end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end; $$;

create function chefduo_private.sync_owner_invitation_slot() returns trigger
language plpgsql security definer set search_path='' as $$
declare was_reserved boolean:=false; is_reserved boolean:=false;
begin
 perform pg_catalog.pg_advisory_xact_lock(71420381);
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Owner invitation changes require READ COMMITTED'; end if;
 if tg_op<>'INSERT' then was_reserved:=old.requested_role='owner' and old.status in ('provisioning','sent','failed'); end if;
 if tg_op<>'DELETE' then is_reserved:=new.requested_role='owner' and new.status in ('provisioning','sent','failed'); end if;
 if tg_op='UPDATE' then
  if new.requested_role<>old.requested_role then raise exception 'Invitation role is immutable'; end if;
  if old.status in ('accepted','revoked') and new.status in ('provisioning','sent','failed') then raise exception 'Terminal invitation cannot be reused'; end if;
  if old.requested_role='owner' and old.user_id is not null and new.user_id is distinct from old.user_id
    and not(new.user_id is null and old.status in ('accepted','revoked')) then raise exception 'Owner invitation identity is immutable'; end if;
 end if;
 if was_reserved and not is_reserved then
  -- Do NOT delete a user-bound seat already transferred during acceptance.
  delete from chefduo_private.owner_slots where invitation_id=old.id;
 elsif is_reserved and not was_reserved then perform chefduo_private.claim_owner_slot(null,new.id);
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end; $$;

create function chefduo_private.assert_owner_slots() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(71420381);
 if not exists(select 1 from chefduo_private.admin_members where role='owner' and status='active' and enabled) then raise exception 'At least one active Owner is required'; end if;
 if exists(select 1 from chefduo_private.admin_members m where m.role='owner' and m.status='active' and m.enabled
  and not exists(select 1 from chefduo_private.owner_slots s where s.user_id=m.user_id))
 or exists(select 1 from chefduo_private.admin_invitations i where i.requested_role='owner' and i.status in ('provisioning','sent','failed')
  and not exists(select 1 from chefduo_private.owner_slots s where s.invitation_id=i.id))
 or exists(select 1 from chefduo_private.owner_slots s where
  (s.user_id is not null and not exists(select 1 from chefduo_private.admin_members m where m.user_id=s.user_id and m.role='owner' and m.status='active' and m.enabled))
  or (s.invitation_id is not null and not exists(select 1 from chefduo_private.admin_invitations i where i.id=s.invitation_id and i.requested_role='owner' and i.status in ('provisioning','sent','failed'))))
 or exists(select 1 from chefduo_private.admin_invitations i where i.requested_role='owner' and i.status in ('provisioning','sent','failed') and i.user_id is not null
  and not exists(select 1 from chefduo_private.admin_members m where m.user_id=i.user_id and m.role='owner' and m.status='invited' and not m.enabled))
 then raise exception 'Owner seat invariant mismatch'; end if;
 return null;
end; $$;

create function chefduo_private.block_owner_truncate() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'Owner policy tables cannot be truncated'; end; $$;
revoke all on function chefduo_private.claim_owner_slot(uuid,uuid),chefduo_private.sync_owner_member_slot(),chefduo_private.sync_owner_invitation_slot(),chefduo_private.assert_owner_slots(),chefduo_private.block_owner_truncate() from public,anon,authenticated,service_role;
create trigger a_owner_member_capacity after insert or update or delete on chefduo_private.admin_members for each row execute function chefduo_private.sync_owner_member_slot();
create trigger a_owner_invitation_capacity after insert or update or delete on chefduo_private.admin_invitations for each row execute function chefduo_private.sync_owner_invitation_slot();
create constraint trigger owner_member_consistency after insert or update or delete on chefduo_private.admin_members deferrable initially deferred for each row execute function chefduo_private.assert_owner_slots();
create constraint trigger owner_invitation_consistency after insert or update or delete on chefduo_private.admin_invitations deferrable initially deferred for each row execute function chefduo_private.assert_owner_slots();
create constraint trigger owner_slot_consistency after insert or update or delete on chefduo_private.owner_slots deferrable initially deferred for each row execute function chefduo_private.assert_owner_slots();
create trigger owner_members_no_truncate before truncate on chefduo_private.admin_members for each statement execute function chefduo_private.block_owner_truncate();
create trigger owner_invitations_no_truncate before truncate on chefduo_private.admin_invitations for each statement execute function chefduo_private.block_owner_truncate();
create trigger owner_slots_no_truncate before truncate on chefduo_private.owner_slots for each statement execute function chefduo_private.block_owner_truncate();

CREATE OR REPLACE FUNCTION public.chefduo_account_operation(p_actor uuid, p_action text, p_target uuid DEFAULT NULL::uuid, p_email text DEFAULT NULL::text, p_invitation uuid DEFAULT NULL::uuid, p_user uuid DEFAULT NULL::uuid, p_lease uuid DEFAULT NULL::uuid, p_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv chefduo_private.admin_invitations;member chefduo_private.admin_members;email_value text;u auth.users;doc jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Account operations require READ COMMITTED isolation';end if;
 perform pg_catalog.pg_advisory_xact_lock(71420381);
 perform set_config('chefduo.actor',p_actor::text,true);
 if p_actor is null then raise exception 'Verified account required';end if;
 if p_action in ('prepare_accept','accept') then
  select * into u from auth.users where id=p_actor;
  select * into inv from chefduo_private.admin_invitations where user_id=p_actor and status='sent' and flow_version=1 and expires_at>now() for update;
  if inv.requested_role='owner' and not exists(select 1 from chefduo_private.admin_members where user_id=inv.requested_by and role='owner' and status='active' and enabled) then raise exception 'Inviting Owner is no longer authorized';end if;
  if inv.id is null or u.email_confirmed_at is null or lower(u.email)<>inv.email then raise exception 'A valid invitation, confirmed email and self-set password are required';end if;
  if p_action='prepare_accept' then
   update chefduo_private.admin_invitations set acceptance_lease=gen_random_uuid() where id=inv.id returning * into inv;
   return jsonb_build_object('id',inv.id,'lease',inv.acceptance_lease,'requested_role',inv.requested_role);
  end if;
  if p_lease is null or inv.acceptance_lease is distinct from p_lease then raise exception 'A fresh trusted password-setup operation is required';end if;
  update chefduo_private.admin_members set enabled=true,status='active' where user_id=p_actor and role=inv.requested_role and status='invited';
  if not found then raise exception 'Invitation membership is unavailable';end if;
  update chefduo_private.admin_invitations set status='accepted',acceptance_lease=null where id=inv.id;
  return jsonb_build_object('accepted',true,'role',inv.requested_role,'status','active');
 end if;
 if p_action='fail_invite' then
  update chefduo_private.admin_invitations set status='failed' where id=p_invitation and lease=p_lease and requested_by=p_actor and status='provisioning';
  return jsonb_build_object('recorded',found);
 end if;
 if not exists(select 1 from chefduo_private.admin_members where user_id=p_actor and role='owner' and enabled and status='active') then raise exception 'Active Owner permission required';end if;
 if p_action='cancel_invite' then
  select * into inv from chefduo_private.admin_invitations where id=p_invitation and status in ('provisioning','sent','failed') for update;
  if inv.id is null then raise exception 'Pending invitation not found';end if;
  update chefduo_private.admin_members set status='revoked',enabled=false where user_id=inv.user_id and status='invited';
  update chefduo_private.admin_invitations set status='revoked',acceptance_lease=null where id=inv.id;
  return jsonb_build_object('cancelled',true);
 end if;
 if p_action='list' then
  select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',listed_user.email,'role',m.role,'status',m.status,'added_at',m.added_at,'invitation_status',i.status,'invitation_id',i.id) order by m.added_at),'[]') into doc
  from chefduo_private.admin_members m join auth.users listed_user on listed_user.id=m.user_id left join chefduo_private.admin_invitations i on i.user_id=m.user_id;
  return jsonb_build_object('members',doc,'invitations',(select coalesce(jsonb_agg(to_jsonb(i)-'lease'-'acceptance_lease'),'[]') from chefduo_private.admin_invitations i where i.user_id is null),'owner_capacity',jsonb_build_object('active',(select count(*) from chefduo_private.owner_slots where user_id is not null),'reserved',(select count(*) from chefduo_private.owner_slots where invitation_id is not null),'limit',2));
 elsif p_action='begin_invite' then
  if p_role is not null and p_role not in ('admin','owner') then raise exception 'Invalid invitation role';end if;
  email_value=lower(trim(p_email));
  if email_value is null or length(email_value)>254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Valid email required';end if;
  select * into u from auth.users where lower(email)=email_value;
  if u.id is not null and not exists(select 1 from chefduo_private.admin_invitations i where i.email=email_value and i.user_id=u.id and i.flow_version=1 and i.status in ('sent','failed') and u.email_confirmed_at is null and coalesce(u.encrypted_password,'')='' and u.invited_at is not null and not coalesce(u.is_anonymous,false)) then raise exception 'Pre-existing identities require trusted review; only this application own unconfirmed password-empty invitation can be resent';end if;
  select * into inv from chefduo_private.admin_invitations where email=email_value for update;
  if inv.id is not null and p_role is not null and inv.requested_role<>p_role then raise exception 'Invitation role cannot change';end if;
  if inv.status in ('accepted','revoked') then raise exception 'Invitation cannot be reused';end if;
  if inv.id is not null and inv.attempted_at>now()-interval '60 seconds' then raise exception 'Wait at least 60 seconds before resending';end if;
  insert into chefduo_private.admin_invitations(email,status,requested_by,flow_version,requested_role) values(email_value,'provisioning',p_actor,1,coalesce(p_role,'admin'))
  on conflict(email) do update set status='provisioning',flow_version=1,requested_by=p_actor,lease=gen_random_uuid(),attempted_at=now(),expires_at=now()+interval '24 hours'
  returning * into inv;
  return jsonb_build_object('id',inv.id,'lease',inv.lease,'email',inv.email,'requested_role',inv.requested_role);
 elsif p_action='finish_invite' then
  select * into inv from chefduo_private.admin_invitations where id=p_invitation and lease=p_lease and requested_by=p_actor and status='provisioning' for update;
  select * into u from auth.users where id=p_user;
  if inv.id is null or u.id is null or lower(u.email)<>inv.email or u.email_confirmed_at is not null or coalesce(u.encrypted_password,'')<>'' or u.invited_at is null or coalesce(u.is_anonymous,false) then raise exception 'Invitation provisioning mismatch';end if;
  insert into chefduo_private.admin_members(user_id,role,status,enabled) values(u.id,inv.requested_role,'invited',false)
  on conflict(user_id) do update set status='invited',enabled=false where admin_members.status='invited' and admin_members.role=inv.requested_role;
  if not found then raise exception 'Existing membership cannot be replaced';end if;
  update chefduo_private.admin_invitations set user_id=u.id,status='sent' where id=inv.id;
  return jsonb_build_object('sent',true);
 elsif p_action in ('disable','restore','revoke','role') then
  select * into member from chefduo_private.admin_members where user_id=p_target for update;
  if member.user_id is null then raise exception 'Administrator not found';end if;
  if member.status='revoked' then raise exception 'Revoked access cannot be restored; trusted reauthorization is required';end if;
  if p_action='disable' and member.status<>'active' then raise exception 'Only active administrators can be suspended';end if;
  if p_action='restore' and member.status<>'disabled' then raise exception 'Only suspended active members can be restored';end if;
  if p_action='role' and (p_role not in ('owner','admin') or p_role is null or member.status<>'active') then raise exception 'Invalid role change';end if;
  update chefduo_private.admin_members set
   role=case when p_action='role' then p_role else role end,
   status=case p_action when 'disable' then 'disabled' when 'restore' then 'active' when 'revoke' then 'revoked' else status end,
   enabled=case p_action when 'disable' then false when 'restore' then true when 'revoke' then false else enabled end where user_id=p_target;
  if p_action='revoke' then update chefduo_private.admin_invitations set status='revoked' where user_id=p_target and status<>'revoked';end if;
  return jsonb_build_object('updated',true);
 end if;
 raise exception 'Unsupported account operation';
end;$function$;

notify pgrst,'reload schema';
commit;

