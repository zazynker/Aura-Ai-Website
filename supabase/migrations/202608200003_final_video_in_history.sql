-- Gives the joined video a permanent home in the user's history, and collapses
-- everything one template run produced into a single card.
--
-- Dashboard already groups generations that share a groupId into one stacked
-- card with a thumbnail strip. Until now the rows from one template run had no
-- shared key — each step carried its own request_id — so a three-step run spread
-- itself across three tiles and the joined video was not saved at all.
--
-- template_run_id is that shared key. It was already being passed from the
-- browser and silently dropped for want of a column.

begin;

do $schema_guard$
begin
  if to_regclass('public.generations') is null then
    raise exception 'generations table is missing.';
  end if;
  if to_regclass('public.template_runs') is null then
    raise exception 'template_runs table is missing.';
  end if;
end;
$schema_guard$;

-- ---------------------------------------------------------------------------
-- 1. The grouping key
-- ---------------------------------------------------------------------------
-- Deliberately no foreign key: generations is a large, hot table and history
-- must outlive a deleted run rather than be cascaded away with it.

alter table public.generations
  add column if not exists template_run_id uuid;

comment on column public.generations.template_run_id is
  'The template run that produced this row. Shared by every step result and by the run''s joined final video, which is what lets the dashboard show one run as one card.';

create index if not exists generations_template_run_id_idx
  on public.generations (user_id, template_run_id)
  where template_run_id is not null;

-- ---------------------------------------------------------------------------
-- 2. One joined video per run, ever
-- ---------------------------------------------------------------------------
-- The final video is marked inside generation_parameters rather than with a new
-- capability value: the capability check constraint is a closed list that the
-- workflow registry mirrors, and a synthetic entry there would have to be
-- taught to every capability switch in the app. This row is not a capability.

create unique index if not exists generations_one_final_video_per_run_idx
  on public.generations (template_run_id)
  where template_run_id is not null
    and (generation_parameters ->> 'finalVideo') = 'true';

-- ---------------------------------------------------------------------------
-- 3. Backfill, so existing history collapses too
-- ---------------------------------------------------------------------------
-- The link already existed in the credit ledger, which records the run and step
-- every charged generation belongs to.

do $backfill$
begin
  if to_regclass('public.generation_credit_deductions') is null then
    raise notice 'No credit ledger present; skipping template_run_id backfill.';
    return;
  end if;

  update public.generations g
  set template_run_id = d.template_run_id
  from public.generation_credit_deductions d
  where g.template_run_id is null
    and g.request_id is not null
    and d.request_id = g.request_id
    and d.user_id = g.user_id
    and d.template_run_id is not null;
end;
$backfill$;

commit;

notify pgrst, 'reload schema';
