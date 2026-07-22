begin;

-- Every workflow-template accounting table is private by default. Service-role
-- settlement functions bypass RLS; clients receive no direct write policy.
alter table if exists public.template_user_reward_caps enable row level security;

-- Review history is append-only through the checked submit/review RPCs.
drop policy if exists "Creators can log submission actions" on public.template_review_logs;

-- Published template metadata is public, but version bodies and private asset
-- rows require an authenticated user (or the creator/admin paths below).
drop policy if exists "Visible template versions are viewable" on public.template_versions;
create policy "Authenticated users can view visible template versions"
on public.template_versions for select to authenticated
using (
  exists (
    select 1 from public.templates t
    where t.id = template_versions.template_id
      and (t.status = 'published' or t.creator_id = auth.uid() or public.is_current_user_admin())
  )
);

drop policy if exists "Visible template assets are viewable" on public.template_assets;
create policy "Authenticated users can view visible template assets"
on public.template_assets for select to authenticated
using (
  exists (
    select 1 from public.templates t
    where t.id = template_assets.template_id
      and (t.status = 'published' or t.creator_id = auth.uid() or public.is_current_user_admin())
  )
);

-- Remove legacy bucket-wide allow rules. They had no bucket or owner predicate.
drop policy if exists "Allow authenticated uploads eo0l0b_0" on storage.objects;
drop policy if exists "Allow public read eo0l0b_0" on storage.objects;
drop policy if exists "Allow users to delete own files eo0l0b_0" on storage.objects;
drop policy if exists "Allow users to delete own files eo0l0b_1" on storage.objects;
drop policy if exists "Visible template assets can be read" on storage.objects;
drop policy if exists "Authenticated users can sign visible template assets" on storage.objects;
create policy "Authenticated users can sign visible template assets"
on storage.objects for select to authenticated
using (
  bucket_id = 'template-assets'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_current_user_admin()
    or exists (
      select 1
      from public.template_assets asset
      join public.templates template on template.id = asset.template_id
      where asset.storage_bucket = storage.objects.bucket_id
        and asset.storage_path = storage.objects.name
        and template.status = 'published'
    )
  )
);

-- Bucket-level enforcement complements browser validation. File names are
-- generated from the MIME type and all mutable paths start with auth.uid().
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm']
where id = 'template-previews';

update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','image/avif',
      'video/mp4','video/webm','video/quicktime',
      'audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/mp4'
    ]
where id = 'template-assets';

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id = 'user-uploads';

drop policy if exists "Users can upload own template previews" on storage.objects;
drop policy if exists "Users can upload own template assets" on storage.objects;
drop policy if exists "Users can upload own template files" on storage.objects;
create policy "Validated owner template uploads"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('template-previews', 'template-assets')
  and (storage.foldername(name))[1] = auth.uid()::text
  and (
    (bucket_id = 'template-previews' and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','avif','mp4','webm'))
    or
    (bucket_id = 'template-assets' and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','avif','mp4','webm','mov','mp3','wav','ogg','m4a'))
  )
);

-- Generations remain publicly displayable, but uploads/deletes are scoped to
-- the authenticated owner's first path segment.
drop policy if exists "Public can view generations" on storage.objects;
create policy "Public can view generations"
on storage.objects for select to public
using (bucket_id = 'generations');

drop policy if exists "Users can upload own generations" on storage.objects;
create policy "Users can upload own generations"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'generations'
  and (storage.foldername(name))[1] = auth.uid()::text
  and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','gif','mp4','webm')
);

drop policy if exists "Users can delete own generations" on storage.objects;
create policy "Users can delete own generations"
on storage.objects for delete to authenticated
using (bucket_id = 'generations' and (storage.foldername(name))[1] = auth.uid()::text);

-- SECURITY DEFINER functions do not inherit a safe execution ACL. Remove the
-- implicit PUBLIC grant, then explicitly expose only the intended surface.
do $acl$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (
      p.proname like 'admin_%'
      or p.proname = any(array[
        'archive_creator_template','begin_template_run_step','cancel_template_run',
        'complete_template_run_step','engage_template_run_step','fail_template_run_step',
        'get_template_run','mark_all_notifications_read','mark_notification_read',
        'open_template_edit_draft','resume_active_template_run','set_template_run_current_step',
        'start_template_run','submit_template_for_review',
        'charge_template_run_step','charge_video_generation','complete_template_run',
        'complete_video_generation','deduct_generation_credits','enforce_generation_limit',
        'refund_failed_video_generation','refund_generation_credit_deduction',
        'refund_template_run_step','settle_template_step_reward'
      ])
    )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
  end loop;

  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (
      p.proname like 'admin_%'
      or p.proname = any(array[
        'archive_creator_template','begin_template_run_step','cancel_template_run',
        'complete_template_run_step','engage_template_run_step','fail_template_run_step',
        'get_template_run','mark_all_notifications_read','mark_notification_read',
        'open_template_edit_draft','resume_active_template_run','set_template_run_current_step',
        'start_template_run','submit_template_for_review'
      ])
    )
  loop
    execute format('grant execute on function %s to authenticated', fn.signature);
  end loop;
end
$acl$;

-- The daily Vercel cron receives only orphan object names older than 72 hours;
-- deletion still happens through the Storage API so blobs and metadata stay in sync.
create or replace function public.service_list_stale_template_uploads(
  p_before timestamptz default (now() - interval '72 hours')
)
returns table(bucket_id text, object_name text)
language sql
security definer
set search_path = public, storage, pg_temp
as $$
  select o.bucket_id, o.name
  from storage.objects o
  left join public.template_assets a
    on a.storage_bucket = o.bucket_id and a.storage_path = o.name
  where o.bucket_id in ('template-previews', 'template-assets')
    and o.created_at < p_before
    and a.id is null
  order by o.created_at asc
  limit 1000;
$$;
revoke all on function public.service_list_stale_template_uploads(timestamptz) from public, anon, authenticated;
grant execute on function public.service_list_stale_template_uploads(timestamptz) to service_role;

commit;
