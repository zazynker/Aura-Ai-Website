-- Unique migration version; this SQL was originally applied manually on 2026-07-22.
-- Keep Admin template review cards in sync with the creator's public profile.
-- The previous RPC returned only creator_email, which forced the UI to show an
-- email prefix and made it impossible to render a profile avatar.

create or replace function public.admin_list_template_reviews(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_pending jsonb;
  v_recent jsonb;
begin
  if not public.is_current_user_admin() then
    return jsonb_build_object('success', false, 'error', 'Admin privileges required.');
  end if;

  select coalesce(jsonb_agg(to_jsonb(item)), '[]'::jsonb)
  into v_pending
  from (
    select
      t.id,
      t.creator_id,
      t.submitted_version_id as version_id,
      coalesce(v.display_name, v.name, t.display_name, t.name) as name,
      coalesce(v.cover_url, t.cover_url) as cover_url,
      coalesce(v.thumb_url, t.thumb_url) as thumb_url,
      coalesce(v.image_url, t.image_url) as image_url,
      coalesce(v.description, t.description) as description,
      v.submitted_at,
      creator.email as creator_email,
      coalesce(
        profile.username,
        creator.raw_user_meta_data ->> 'name',
        split_part(creator.email, '@', 1)
      ) as creator_username,
      coalesce(
        profile.avatar_url,
        creator.raw_user_meta_data ->> 'avatar_url'
      ) as creator_avatar_url,
      v.workflow,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'asset_key', a.asset_key,
          'asset_type', a.asset_type,
          'public_url', a.public_url,
          'storage_bucket', a.storage_bucket,
          'storage_path', a.storage_path,
          'is_reusable', a.is_reusable
        ) order by a.sort_order)
        from public.template_assets a
        where a.template_id = t.id
          and a.version_id = t.submitted_version_id
      ), '[]'::jsonb) as assets
    from public.templates t
    join public.template_versions v on v.id = t.submitted_version_id
    left join auth.users creator on creator.id = t.creator_id
    left join public.user_profiles profile on profile.user_id = t.creator_id
    where t.review_status = 'pending'
      and t.submitted_version_id is not null
    order by v.submitted_at asc nulls last
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) item;

  select coalesce(jsonb_agg(to_jsonb(item)), '[]'::jsonb)
  into v_recent
  from (
    select
      t.id,
      t.creator_id,
      t.name,
      creator.email as creator_email,
      coalesce(
        profile.username,
        creator.raw_user_meta_data ->> 'name',
        split_part(creator.email, '@', 1)
      ) as creator_username,
      coalesce(
        profile.avatar_url,
        creator.raw_user_meta_data ->> 'avatar_url'
      ) as creator_avatar_url,
      l.action,
      l.created_at as reviewed_at
    from public.template_review_logs l
    join public.templates t on t.id = l.template_id
    left join auth.users creator on creator.id = t.creator_id
    left join public.user_profiles profile on profile.user_id = t.creator_id
    where l.action in ('approved', 'rejected')
    order by l.created_at desc
    limit 20
  ) item;

  return jsonb_build_object(
    'success', true,
    'pending', v_pending,
    'recent', v_recent
  );
end;
$function$;
