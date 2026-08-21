-- Fixes the run bookkeeping that 202608200000 left incomplete.
--
-- What went wrong: reuse_template_run_step closed a step but never performed
-- the end-of-run rollup that complete_template_run_step performs. A run whose
-- steps were all reused therefore stayed status='started' forever, which made
-- resume_active_template_run keep handing it to the Workflow Dock, which in
-- turn let the user cancel a run that had already finished.
--
-- This migration:
--   1. rewrites reuse_template_run_step with the full rollup,
--   2. adds template_runs.run_mode so a Quick Use run is never mistaken for a
--      hand-driven Workflow run,
--   3. repairs runs already stuck in 'started'.

begin;

do $schema_guard$
begin
  if to_regclass('public.template_runs') is null
     or to_regclass('public.template_run_steps') is null then
    raise exception 'Workflow run tables are missing.';
  end if;

  if to_regprocedure('public.reuse_template_run_step(uuid,text,text)') is null then
    raise exception 'Apply 202608200000_template_run_final_video.sql before this migration.';
  end if;

  -- Columns the rollup writes. If any is missing the baseline is not the one
  -- this migration was written against, and a silent partial update would be
  -- worse than a failed migration.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'template_run_steps'
      and column_name in ('completed_at', 'updated_at', 'started_at', 'engaged_at', 'engaged_action')
    group by table_name
    having count(*) = 5
  ) then
    raise exception 'template_run_steps is missing the columns the run rollup writes.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'template_runs'
      and column_name in ('current_step', 'total_credits_used', 'completed_at', 'updated_at')
    group by table_name
    having count(*) = 4
  ) then
    raise exception 'template_runs is missing the columns the run rollup writes.';
  end if;
end;
$schema_guard$;

-- ---------------------------------------------------------------------------
-- 1. run_mode
-- ---------------------------------------------------------------------------

alter table public.template_runs
  add column if not exists run_mode text not null default 'workflow';

alter table public.template_runs
  drop constraint if exists template_runs_run_mode_check;
alter table public.template_runs
  add constraint template_runs_run_mode_check
  check (run_mode in ('workflow', 'quick_use'));

comment on column public.template_runs.run_mode is
  'workflow = the hand-driven Workflow Dock flow. quick_use = a one-shot Template run. The dock must ignore quick_use runs.';

create index if not exists template_runs_run_mode_idx
  on public.template_runs (run_mode);

create or replace function public.set_template_run_mode(
  p_run_id uuid,
  p_mode text
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_mode not in ('workflow', 'quick_use') then
    raise exception 'Unknown run mode: %', p_mode using errcode = '22023';
  end if;

  update public.template_runs
  set run_mode = p_mode,
      updated_at = now()
  where id = p_run_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Workflow run not found' using errcode = 'P0002';
  end if;
end;
$function$;

revoke all on function public.set_template_run_mode(uuid, text) from public, anon;
grant execute on function public.set_template_run_mode(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. reuse_template_run_step, with the rollup
-- ---------------------------------------------------------------------------
--
-- Deliberately mirrors complete_template_run_step, minus everything that only
-- applies to a real generation: no capability match, no request id, no credit
-- deduction lookup, no reward settlement. A reused step costs nothing, so
-- there is nothing to settle. Everything after that point — activating the
-- next step, recomputing total_credits_used, closing the run, bumping
-- use_count — is identical, because a reused step advances the run exactly
-- like a generated one.

drop function if exists public.reuse_template_run_step(uuid, text, text);

create or replace function public.reuse_template_run_step(
  p_run_id uuid,
  p_step_id text,
  p_result_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_step_order integer;
  v_step_status text;
  v_run_status text;
  v_template_id uuid;
  v_next_step_order integer;
  v_creator_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_result_url is null or length(btrim(p_result_url)) = 0 then
    raise exception 'A reused step needs a result URL';
  end if;

  select s.step_order, s.status, r.status, r.template_id
    into v_step_order, v_step_status, v_run_status, v_template_id
  from public.template_run_steps s
  join public.template_runs r on r.id = s.run_id
  where s.run_id = p_run_id
    and s.step_id = p_step_id
    and r.user_id = auth.uid()
  for update of s;

  if v_step_order is null then
    raise exception 'Active workflow step not found';
  end if;

  -- Idempotent: replaying the same reuse is a no-op rather than an error, so a
  -- retried network call cannot double-bump use_count.
  if v_step_status = 'completed' then
    return jsonb_build_object(
      'runId', p_run_id, 'stepId', p_step_id,
      'status', 'completed', 'alreadyCompleted', true
    );
  end if;
  if v_run_status <> 'started' then
    raise exception 'Workflow run is no longer active';
  end if;

  update public.template_run_steps
  set status = 'completed',
      execution_mode = 'reused_template_result',
      result_url = p_result_url,
      generation_id = null,
      credits_used = 0,
      error_code = null,
      engaged_at = null,
      engaged_action = null,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where run_id = p_run_id
    and step_id = p_step_id
    and status <> 'completed';

  select coalesce(
    min(step_order) filter (where step_order > v_step_order),
    min(step_order)
  ) into v_next_step_order
  from public.template_run_steps
  where run_id = p_run_id
    and step_order <> v_step_order
    and status in ('pending', 'active', 'failed');

  if v_next_step_order is not null then
    update public.template_run_steps
    set status = 'active',
        error_code = null,
        started_at = coalesce(started_at, now()),
        completed_at = null,
        updated_at = now()
    where run_id = p_run_id
      and step_order = v_next_step_order
      and status <> 'completed';
  end if;

  update public.template_runs
  set current_step = coalesce(v_next_step_order, v_step_order),
      total_credits_used = (
        select coalesce(sum(credits_used), 0)
        from public.template_run_steps where run_id = p_run_id
      ),
      status = case when v_next_step_order is null then 'completed' else status end,
      completed_at = case
        when v_next_step_order is null then coalesce(completed_at, now())
        else completed_at
      end,
      updated_at = now()
  where id = p_run_id and user_id = auth.uid() and status = 'started';

  if v_next_step_order is null then
    select creator_id into v_creator_id from public.templates where id = v_template_id;
    if v_creator_id is distinct from auth.uid() then
      update public.templates
      set use_count = coalesce(use_count, 0) + 1
      where id = v_template_id;
    end if;
  end if;

  return jsonb_build_object(
    'runId', p_run_id, 'stepId', p_step_id, 'status', 'completed',
    'nextStep', v_next_step_order, 'executionMode', 'reused_template_result'
  );
end;
$function$;

revoke all on function public.reuse_template_run_step(uuid, text, text) from public, anon;
grant execute on function public.reuse_template_run_step(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Repair runs stranded by the missing rollup
-- ---------------------------------------------------------------------------

update public.template_runs r
set status = 'completed',
    current_step = (
      select max(step_order) from public.template_run_steps s where s.run_id = r.id
    ),
    total_credits_used = (
      select coalesce(sum(credits_used), 0)
      from public.template_run_steps s where s.run_id = r.id
    ),
    completed_at = coalesce(r.completed_at, now()),
    updated_at = now()
where r.status = 'started'
  and exists (select 1 from public.template_run_steps s where s.run_id = r.id)
  and not exists (
    select 1 from public.template_run_steps s
    where s.run_id = r.id and s.status not in ('completed', 'skipped')
  );

-- Runs that already produced a final video were Quick Use runs by definition.
update public.template_runs
set run_mode = 'quick_use'
where final_video_url is not null
  and run_mode = 'workflow';

commit;

notify pgrst, 'reload schema';
