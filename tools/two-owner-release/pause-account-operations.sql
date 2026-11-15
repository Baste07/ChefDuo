-- LOCAL PROPOSAL ONLY. Separate emergency production authorization required.
-- Preserve the two-seat cap, all identities, roles, sessions, audit and catalog.
-- This pauses the trusted account RPC, including roster/invitation/role operations.
begin;
select pg_catalog.pg_advisory_xact_lock(71420381);
revoke execute on function public.chefduo_account_operation(uuid,text,uuid,text,uuid,uuid,uuid,text) from service_role;
commit;
