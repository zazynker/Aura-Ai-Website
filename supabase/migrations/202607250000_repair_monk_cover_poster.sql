-- Repair the published Monk wisdom cover whose browser-generated poster was a
-- fully transparent WebP. Reuse the already generated current-version final
-- result poster so no private source asset is copied or made public.

begin;

do $repair_cover$
declare
  target_template_id constant uuid := '8b06a7bc-e651-4699-a355-22dd44bf0b91';
  target_version_id uuid;
  valid_poster public.template_assets%rowtype;
begin
  select current_version_id
  into target_version_id
  from public.templates
  where id = target_template_id
    and status = 'published';

  if target_version_id is null then
    raise exception 'Published Monk wisdom template/version was not found.';
  end if;

  select *
  into valid_poster
  from public.template_assets
  where template_id = target_template_id
    and version_id = target_version_id
    and asset_key = 'final-result-thumbnail'
    and asset_type = 'image'
    and public_url is not null
  limit 1;

  if valid_poster.id is null then
    raise exception 'A valid final-result thumbnail was not found.';
  end if;

  update public.templates
  set thumb_url = valid_poster.public_url,
      image_url = valid_poster.public_url,
      updated_at = now()
  where id = target_template_id
    and current_version_id = target_version_id;

  update public.template_versions
  set thumb_url = valid_poster.public_url,
      image_url = valid_poster.public_url
  where id = target_version_id
    and template_id = target_template_id;

  update public.template_assets
  set storage_bucket = valid_poster.storage_bucket,
      storage_path = valid_poster.storage_path,
      public_url = valid_poster.public_url,
      mime_type = valid_poster.mime_type,
      byte_size = valid_poster.byte_size,
      width = valid_poster.width,
      height = valid_poster.height
  where template_id = target_template_id
    and version_id = target_version_id
    and asset_key = 'cover-thumbnail';
end
$repair_cover$;

commit;

notify pgrst, 'reload schema';
