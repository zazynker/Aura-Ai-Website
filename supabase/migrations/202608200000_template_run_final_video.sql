-- Workflow final video assembly + template step reuse.
--
-- Adds:
--   * template_runs.final_* columns so one run can own a merged deliverable
--     alongside its per-step results (step results stay visible for review).
--   * template_run_steps.execution_mode / result_url so a step served from the
--     template's own demo asset is auditable and costs no credits.
--   * public.reuse_template_run_step(...) so the browser can close a reused
--     step without inventing a generation row.
--   * a public storage bucket for assembled final videos.
--
-- The foundational workflow-run schema predates the checked-in migration
-- history, so the guards below pin the assumptions this migration relies on
-- and the RPC body is generated against the column names actually present.

begin;

do $schema_guard$
begin
  if to_regclass('public.template_runs') is null
     or to_regclass('public.template_run_steps') is null then
    raise exception 'Workflow run tables are missing; restore the audited baseline before applying this migration.';
  end if;

  if to_regprocedure('public.complete_template_run_step(uuid,text,uuid)') is null then
    raise exception 'public.complete_template_run_step(uuid,text,uuid) is missing or has an unexpected signature.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'template_run_steps'
      and column_name = 'step_id'
  ) then
    raise exception 'template_run_steps.step_id is missing; the audited baseline differs.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'template_run_steps'
      and column_name in ('run_id', 'template_run_id')
  ) then
    raise exception 'template_run_steps has no run foreign key column (run_id / template_run_id).';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'template_runs'
      and column_name in ('user_id', 'owner_id')
  ) then
    raise exception 'template_runs has no owner column (user_id / owner_id).';
  end if;
end;
$schema_guard$;

-- ---------------------------------------------------------------------------
-- Run-level final deliverable
-- ---------------------------------------------------------------------------

alter table public.template_runs
  add column if not exists final_media_type text,
  add column if not exists final_video_url text,
  add column if not exists final_thumbnail_url text,
  add column if not exists final_video_step_ids jsonb,
  add column if not exists final_video_duration_seconds numeric,
  add column if not exists assembled_at timestamptz;

alter table public.template_runs
  drop constraint if exists template_runs_final_media_type_check;
alter table public.template_runs
  add constraint template_runs_final_media_type_check
  check (final_media_type is null or final_media_type in ('image', 'video'));

alter table public.template_runs
  drop constraint if exists template_runs_final_video_step_ids_check;
alter table public.template_runs
  add constraint template_runs_final_video_step_ids_check
  check (
    final_video_step_ids is null
    or jsonb_typeof(final_video_step_ids) = 'array'
  );

comment on column public.template_runs.final_video_url is
  'Assembled deliverable produced by joining the clips listed in final_video_step_ids. NULL means the run delivers its last step result directly.';
comment on column public.template_runs.final_video_step_ids is
  'Ordered authored workflow step ids whose video results were joined, as stored on the locked Quick Use definition.';

-- ---------------------------------------------------------------------------
-- Step-level execution mode
-- ---------------------------------------------------------------------------

alter table public.template_run_steps
  add column if not exists execution_mode text not null default 'generated',
  add column if not exists result_url text;

alter table public.template_run_steps
  drop constraint if exists template_run_steps_execution_mode_check;
alter table public.template_run_steps
  add constraint template_run_steps_execution_mode_check
  check (execution_mode in ('generated', 'reused_template_result'));

comment on column public.template_run_steps.execution_mode is
  'generated = a provider call was made and charged. reused_template_result = the template''s own demo result was served because the user changed nothing bound to this step.';
comment on column public.template_run_steps.result_url is
  'Result URL for a reused step. Generated steps keep their URL on the linked generations row.';

create index if not exists template_run_steps_execution_mode_idx
  on public.template_run_steps (execution_mode);

-- ---------------------------------------------------------------------------
-- reuse_template_run_step
-- ---------------------------------------------------------------------------
--
-- Closes one step without a generation row. Ownership is enforced against
-- auth.uid() exactly like the other run RPCs, and the step must be pending or
-- active so a completed step can never be silently downgraded to a reuse.

do $build_reuse_rpc$
declare
  v_run_col   text;
  v_owner_col text;
begin
  select column_name into v_run_col
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'template_run_steps'
    and column_name in ('run_id', 'template_run_id')
  order by case column_name when 'run_id' then 0 else 1 end
  limit 1;

  select column_name into v_owner_col
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'template_runs'
    and column_name in ('user_id', 'owner_id')
  order by case column_name when 'user_id' then 0 else 1 end
  limit 1;

  execute format($fn$
    create or replace function public.reuse_template_run_step(
      p_run_id uuid,
      p_step_id text,
      p_result_url text
    )
    returns void
    language plpgsql
    security definer
    set search_path = public, auth, pg_temp
    as $function$
    declare
      v_user_id uuid := auth.uid();
      v_owner   uuid;
      v_status  text;
    begin
      if v_user_id is null then
        raise exception 'Authentication required' using errcode = '42501';
      end if;
      if p_result_url is null or length(btrim(p_result_url)) = 0 then
        raise exception 'A reused step needs a result URL' using errcode = '22023';
      end if;

      select r.%2$I, r.status
        into v_owner, v_status
      from public.template_runs r
      where r.id = p_run_id
      for update;

      if v_owner is null then
        raise exception 'Workflow run not found' using errcode = 'P0002';
      end if;
      if v_owner <> v_user_id then
        raise exception 'Workflow run does not belong to the current user' using errcode = '42501';
      end if;
      if v_status <> 'started' then
        raise exception 'Workflow run is not running' using errcode = '55000';
      end if;

      update public.template_run_steps
      set status         = 'completed',
          execution_mode = 'reused_template_result',
          result_url     = p_result_url,
          generation_id  = null,
          credits_used   = 0,
          error_code     = null
      where %1$I = p_run_id
        and step_id = p_step_id
        and status in ('pending', 'active');

      if not found then
        raise exception 'Workflow step is not open for reuse: %%', p_step_id
          using errcode = 'P0002';
      end if;
    end;
    $function$;
  $fn$, v_run_col, v_owner_col);
end;
$build_reuse_rpc$;

revoke all on function public.reuse_template_run_step(uuid, text, text)
  from public, anon;
grant execute on function public.reuse_template_run_step(uuid, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Storage for assembled final videos
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workflow-final-videos',
  'workflow-final-videos',
  true,
  536870912,
  array['video/mp4', 'video/webm', 'video/quicktime', 'image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = excluded.public;

drop policy if exists "workflow final videos are publicly readable"
  on storage.objects;
create policy "workflow final videos are publicly readable"
  on storage.objects
  for select
  using (bucket_id = 'workflow-final-videos');

-- Writes happen through the service role in api/finalize-workflow-video.ts,
-- which bypasses RLS. No insert/update policy is granted to end users.

commit;

notify pgrst, 'reload schema';
