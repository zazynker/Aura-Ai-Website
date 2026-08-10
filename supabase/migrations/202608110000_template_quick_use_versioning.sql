-- Version-scoped Quick Use configuration for workflow templates.
--
-- The foundational workflow-template schema predates the checked-in migration
-- history. These guards pin the live schema assumptions audited on 2026-08-11
-- before this migration changes any database object.

begin;

do $schema_guard$
begin
  if to_regclass('public.templates') is null
     or to_regclass('public.template_versions') is null
     or to_regclass('public.template_assets') is null then
    raise exception 'Workflow template tables are missing; restore the audited baseline before applying this migration.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'template_versions'
      and column_name = 'workflow'
      and udt_name = 'jsonb'
      and is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'template_versions'
      and column_name = 'version_status'
      and udt_name = 'text'
      and is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'templates'
      and column_name = 'draft_version_id'
      and udt_name = 'uuid'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'template_assets'
      and column_name = 'asset_key'
      and udt_name = 'text'
      and is_nullable = 'NO'
  ) then
    raise exception 'Workflow template schema differs from the audited 2026-08-11 baseline.';
  end if;

  if to_regprocedure('public.open_template_edit_draft(uuid)') is null
     or to_regprocedure('public.submit_template_for_review(uuid,uuid)') is null
     or to_regprocedure('public.admin_review_template(uuid,uuid,text,text)') is null then
    raise exception 'Workflow template lifecycle RPCs are missing or have unexpected signatures.';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.template_assets'::regclass
      and conname = 'template_assets_template_id_version_id_asset_key_key'
  ) then
    raise exception 'Version-scoped template asset uniqueness constraint is missing.';
  end if;
end;
$schema_guard$;

alter table public.template_versions
  add column if not exists quick_use_definition jsonb;

alter table public.template_versions
  drop constraint if exists template_versions_quick_use_definition_check;

alter table public.template_versions
  add constraint template_versions_quick_use_definition_check
  check (
    quick_use_definition is null
    or jsonb_typeof(quick_use_definition) = 'object'
  );

comment on column public.template_versions.quick_use_definition is
  'Version-scoped Quick Use definition. NULL preserves legacy workflow-template behavior.';

-- A published version body is immutable. The existing review lifecycle is
-- allowed to archive the previously published version when a replacement is
-- approved, but it cannot change workflow/configuration/content fields.
create or replace function public.guard_published_template_version_immutability()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if old.version_status in ('published', 'archived') then
      raise exception 'Published template versions cannot be deleted.' using errcode = '55000';
    end if;
    return old;
  end if;

  if old.version_status = 'archived' then
    raise exception 'Archived published template versions cannot be modified.' using errcode = '55000';
  end if;

  if old.version_status = 'published' then
    if new.version_status not in ('published', 'archived')
       or (
         to_jsonb(new) - array['version_status', 'updated_at']::text[]
       ) is distinct from (
         to_jsonb(old) - array['version_status', 'updated_at']::text[]
       ) then
      raise exception 'Published template version content is immutable.' using errcode = '55000';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists template_versions_guard_published_immutability
  on public.template_versions;
create trigger template_versions_guard_published_immutability
before update or delete on public.template_versions
for each row execute function public.guard_published_template_version_immutability();

-- Assets are part of the version body. New drafts clone the rows and keep the
-- stable asset_key, so no published asset row needs to be mutated in place.
create or replace function public.guard_published_template_asset_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.version_id is not null then
    select version_status into v_status
    from public.template_versions
    where id = old.version_id;

    if v_status in ('published', 'archived') then
      raise exception 'Assets belonging to a published template version are immutable.' using errcode = '55000';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.version_id is not null then
    select version_status into v_status
    from public.template_versions
    where id = new.version_id;

    if v_status in ('published', 'archived') then
      raise exception 'Assets belonging to a published template version are immutable.' using errcode = '55000';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists template_assets_guard_published_immutability
  on public.template_assets;
create trigger template_assets_guard_published_immutability
before insert or update or delete on public.template_assets
for each row execute function public.guard_published_template_asset_immutability();

-- Keep the complete lifecycle function in version control. A newly opened
-- draft clones workflow, Quick Use definition, and every version-scoped asset.
create or replace function public.open_template_edit_draft(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_user_id uuid := auth.uid();
  v_template public.templates%rowtype;
  v_source_id uuid;
  v_new_id uuid := gen_random_uuid();
  v_number integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_template
  from public.templates
  where id = p_template_id and creator_id = v_user_id
  for update;

  if v_template.id is null then
    raise exception 'Template not found or not owned by current user' using errcode = 'P0002';
  end if;

  if v_template.draft_version_id is not null then
    select version_number into v_number
    from public.template_versions
    where id = v_template.draft_version_id and template_id = p_template_id;
    return jsonb_build_object(
      'template_id', p_template_id,
      'version_id', v_template.draft_version_id,
      'version_number', v_number,
      'created', false
    );
  end if;

  v_source_id := coalesce(v_template.submitted_version_id, v_template.current_version_id);
  if v_source_id is null then
    raise exception 'Template has no version to edit' using errcode = 'P0002';
  end if;

  select coalesce(max(version_number), 0) + 1
    into v_number
  from public.template_versions
  where template_id = p_template_id;

  insert into public.template_versions (
    id, template_id, version_number, schema_version, workflow,
    quick_use_definition, change_summary, created_by, version_status,
    name, display_name, description, image_url, thumb_url, cover_type,
    cover_url, preview_url, updated_at
  )
  select
    v_new_id, template_id, v_number, schema_version, workflow,
    quick_use_definition,
    'Editable update cloned from version ' || version_number::text,
    v_user_id, 'draft', name, display_name, description, image_url,
    thumb_url, cover_type, cover_url, preview_url, now()
  from public.template_versions
  where id = v_source_id and template_id = p_template_id;

  if not found then
    raise exception 'Source version not found' using errcode = 'P0002';
  end if;

  insert into public.template_assets (
    template_id, version_id, owner_id, asset_key, asset_type, source_kind,
    generation_id, storage_bucket, storage_path, public_url, mime_type,
    byte_size, width, height, duration_seconds, sort_order, is_reusable
  )
  select
    template_id, v_new_id, owner_id, asset_key, asset_type, source_kind,
    generation_id, storage_bucket, storage_path, public_url, mime_type,
    byte_size, width, height, duration_seconds, sort_order, is_reusable
  from public.template_assets
  where template_id = p_template_id and version_id = v_source_id;

  update public.templates
  set draft_version_id = v_new_id,
      updated_at = now()
  where id = p_template_id;

  return jsonb_build_object(
    'template_id', p_template_id,
    'version_id', v_new_id,
    'version_number', v_number,
    'created', true
  );
end;
$function$;

revoke all on function public.open_template_edit_draft(uuid)
  from public, anon;
grant execute on function public.open_template_edit_draft(uuid)
  to authenticated;

revoke all on function public.guard_published_template_version_immutability()
  from public, anon, authenticated;
revoke all on function public.guard_published_template_asset_immutability()
  from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
