-- Close the three public-table exposures reported by Supabase Security Advisor
-- without changing the frontend's existing query shapes.

begin;

-- Subscription details are private. The browser only needs to read the signed-in
-- user's own active subscription; all writes continue through trusted backend
-- code and service-role/database functions.
alter table public.active_subscriptions enable row level security;

revoke all on table public.active_subscriptions from public, anon, authenticated;
grant select on table public.active_subscriptions to authenticated;

drop policy if exists active_subscriptions_select_own
  on public.active_subscriptions;
create policy active_subscriptions_select_own
  on public.active_subscriptions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- The allowed-domain list is consumed by SECURITY DEFINER auth hooks. It is not
-- a client API and therefore deliberately has no anon/authenticated policy.
alter table public.allowed_email_domains enable row level security;

revoke all on table public.allowed_email_domains from public, anon, authenticated;

-- Collection item calls remain client-side, but ownership is inherited from the
-- parent collection. Update is intentionally omitted because the UI adds/removes
-- items instead of mutating an existing relationship.
alter table public.collection_items enable row level security;

revoke all on table public.collection_items from public, anon, authenticated;
grant select, insert, delete on table public.collection_items to authenticated;

drop policy if exists collection_items_select_own
  on public.collection_items;
create policy collection_items_select_own
  on public.collection_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.collections collection
      where collection.id = collection_items.collection_id
        and collection.user_id = (select auth.uid())
    )
  );

drop policy if exists collection_items_insert_own
  on public.collection_items;
create policy collection_items_insert_own
  on public.collection_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.collections collection
      where collection.id = collection_items.collection_id
        and collection.user_id = (select auth.uid())
    )
  );

drop policy if exists collection_items_delete_own
  on public.collection_items;
create policy collection_items_delete_own
  on public.collection_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.collections collection
      where collection.id = collection_items.collection_id
        and collection.user_id = (select auth.uid())
    )
  );

-- Preserve every function's signature and body while pinning name resolution to
-- trusted schemas. This removes mutable-search-path warnings without changing
-- frontend RPC names, parameters, return types, or execution grants.
do $function_search_path$
declare
  function_record record;
begin
  for function_record in
    select function_proc.oid::regprocedure as signature
    from pg_proc function_proc
    join pg_namespace function_schema
      on function_schema.oid = function_proc.pronamespace
    where function_schema.nspname = 'public'
      and not exists (
        select 1
        from unnest(coalesce(function_proc.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  loop
    execute format(
      'alter function %s set search_path = public, auth, extensions, pg_temp',
      function_record.signature
    );
  end loop;
end
$function_search_path$;

commit;

notify pgrst, 'reload schema';
