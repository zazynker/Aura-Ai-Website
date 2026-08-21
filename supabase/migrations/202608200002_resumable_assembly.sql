-- Makes final-video assembly resumable so it can never hit a function timeout.
--
-- Assembly is a chain of provider round trips (probe -> pad -> merge -> store).
-- Holding one HTTP request open for the whole chain makes the feature depend on
-- the platform's function duration limit. Instead, each invocation works for a
-- fixed slice, checkpoints its progress here, and returns "pending"; the browser
-- calls again and the next invocation picks up exactly where the last stopped.
--
-- Nothing here is user-visible. The column is scratch space that is cleared the
-- moment the run has its final video.

begin;

do $schema_guard$
begin
  if to_regclass('public.template_runs') is null then
    raise exception 'template_runs is missing.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'template_runs'
      and column_name = 'final_video_url'
  ) then
    raise exception 'Apply 202608200000_template_run_final_video.sql before this migration.';
  end if;
end;
$schema_guard$;

alter table public.template_runs
  add column if not exists assembly_state jsonb;

comment on column public.template_runs.assembly_state is
  'Checkpoint for a partially finished final-video assembly: current phase plus the provider job URLs already submitted. Written only by the finalize endpoint (service role) and cleared when the run has its final video.';

commit;

notify pgrst, 'reload schema';
