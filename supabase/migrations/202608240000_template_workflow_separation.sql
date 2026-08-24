-- Keep one-shot Templates and hand-driven Workflows separate at the database
-- boundary. Also restores the authenticated cancel ACL after deployments that
-- recreated cancel_template_run after the earlier ACL hardening migration.

begin;

do $schema_guard$
begin
  if to_regclass('public.templates') is null
     or to_regclass('public.template_versions') is null
     or to_regclass('public.template_runs') is null then
    raise exception 'Template runtime tables are missing.';
  end if;
  if to_regprocedure('public.start_template_run(uuid,text)') is null then
    raise exception 'start_template_run(uuid,text) is missing.';
  end if;
end;
$schema_guard$;

-- Start the run with its final type already written. This closes the window in
-- which a Quick Use run existed as the default `workflow` type and could be
-- picked up by the app-wide Workflow Dock restore listener.
create or replace function public.start_template_run_in_mode(
  p_template_id uuid,
  p_idempotency_key text,
  p_run_mode text default 'workflow'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_run jsonb;
  v_run_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_run_mode not in ('workflow', 'quick_use') then
    raise exception 'Unknown run mode: %', p_run_mode using errcode = '22023';
  end if;

  v_run := public.start_template_run(p_template_id, p_idempotency_key);
  v_run_id := nullif(v_run ->> 'id', '')::uuid;
  if v_run_id is null then
    raise exception 'The started run response has no id';
  end if;

  update public.template_runs
  set run_mode = p_run_mode,
      updated_at = now()
  where id = v_run_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Workflow run not found' using errcode = 'P0002';
  end if;
  return v_run;
end;
$function$;

revoke all on function public.start_template_run_in_mode(uuid, text, text) from public, anon;
grant execute on function public.start_template_run_in_mode(uuid, text, text) to authenticated;

-- Read through a narrow owner-checked function rather than relying on table
-- RLS. A failed lookup must never be guessed to mean `workflow` by clients.
create or replace function public.get_template_run_mode(p_run_id uuid)
returns text
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  select r.run_mode
  from public.template_runs r
  where r.id = p_run_id
    and r.user_id = auth.uid()
  limit 1
$function$;

revoke all on function public.get_template_run_mode(uuid) from public, anon;
grant execute on function public.get_template_run_mode(uuid) to authenticated;

-- Public marketplace classification only. No authoring definition, creator,
-- use count, or private version data is exposed to anonymous visitors.
create or replace function public.list_published_quick_use_template_ids(
  p_template_ids uuid[]
)
returns table(template_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select t.id
  from public.templates t
  join public.template_versions v
    on v.id = t.current_version_id
   and v.template_id = t.id
   and v.version_status = 'published'
  where t.status = 'published'
    and t.id = any(coalesce(p_template_ids, array[]::uuid[]))
    and jsonb_typeof(v.quick_use_definition -> 'blocks') = 'array'
    and jsonb_array_length(v.quick_use_definition -> 'blocks') > 0
$function$;

revoke all on function public.list_published_quick_use_template_ids(uuid[]) from public;
grant execute on function public.list_published_quick_use_template_ids(uuid[]) to anon, authenticated;

-- cancel_template_run is owner-checked inside the function. Grant every
-- deployed overload so a recreated signature cannot silently lose the ACL.
do $cancel_acl$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'cancel_template_run'
  loop
    execute format('revoke all on function %s from public, anon', fn.signature);
    execute format('grant execute on function %s to authenticated', fn.signature);
  end loop;
end;
$cancel_acl$;

commit;

notify pgrst, 'reload schema';
