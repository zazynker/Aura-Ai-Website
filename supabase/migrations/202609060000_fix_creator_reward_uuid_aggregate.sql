-- PostgreSQL has no min(uuid) aggregate. Keep the same deterministic
-- single-template selection while ordering UUID values through array_agg.
create or replace function public.claim_creator_reward_celebration_v2()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_claimed_at timestamptz := now();
  v_ids uuid[];
  v_result jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('hasRewards', false);
  end if;

  select array_agg(candidate.id)
  into v_ids
  from (
    select notification.id
    from public.notifications notification
    where notification.user_id = v_user_id
      and notification.type = 'creator_credits_earned'
      and notification.celebrated_at is null
      and case
        when (notification.metadata ->> 'credits') ~ '^[0-9]+$'
          then (notification.metadata ->> 'credits')::integer > 0
        else false
      end
    order by notification.created_at asc
    for update skip locked
  ) candidate;

  if coalesce(cardinality(v_ids), 0) = 0 then
    return jsonb_build_object('hasRewards', false);
  end if;

  update public.notifications
  set celebrated_at = v_claimed_at
  where id = any(v_ids);

  with claimed as (
    select
      notification.*,
      case
        when (notification.metadata ->> 'credits') ~ '^[0-9]+$'
          then (notification.metadata ->> 'credits')::integer
        else 0
      end as credits,
      case
        when (notification.metadata ->> 'usage_count') ~ '^[0-9]+$'
          then greatest((notification.metadata ->> 'usage_count')::integer, 1)
        else 1
      end as usage_count,
      coalesce(nullif(notification.metadata ->> 'consumer_username', ''), 'Someone') as consumer_username,
      coalesce(
        nullif(notification.metadata ->> 'template_name', ''),
        nullif(template.display_name, ''),
        template.name,
        'your template'
      ) as template_name
    from public.notifications notification
    left join public.templates template on template.id = notification.template_id
    where notification.id = any(v_ids)
  ),
  template_summaries as (
    select
      claimed.template_id,
      max(claimed.template_name) as template_name,
      sum(claimed.credits)::integer as credits_earned,
      sum(claimed.usage_count)::integer as user_count,
      to_jsonb(array_remove(array_agg(distinct claimed.consumer_username), null)) as usernames
    from claimed
    group by claimed.template_id
  ),
  aggregate_values as (
    select
      count(*)::integer as notification_count,
      sum(claimed.usage_count)::integer as user_count,
      count(distinct claimed.template_id)::integer as template_count,
      sum(claimed.credits)::integer as credits_earned,
      case when count(distinct claimed.template_id) = 1
        then (array_agg(distinct claimed.template_id))[1]::text
        else null
      end as primary_template_id,
      to_jsonb(array_remove(array_agg(distinct claimed.consumer_username), null)) as usernames
    from claimed
  )
  select jsonb_build_object(
    'hasRewards', true,
    'claimedAt', v_claimed_at,
    'notificationCount', aggregate_values.notification_count,
    'userCount', aggregate_values.user_count,
    'templateCount', aggregate_values.template_count,
    'creditsEarned', aggregate_values.credits_earned,
    'primaryTemplateId', aggregate_values.primary_template_id,
    'usernames', aggregate_values.usernames,
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'templateId', template_summaries.template_id,
        'templateName', template_summaries.template_name,
        'creditsEarned', template_summaries.credits_earned,
        'userCount', template_summaries.user_count,
        'usernames', template_summaries.usernames
      ) order by template_summaries.credits_earned desc, template_summaries.template_name)
      from template_summaries
    ), '[]'::jsonb)
  )
  into v_result
  from aggregate_values;

  return v_result;
end;
$$;

revoke all on function public.claim_creator_reward_celebration_v2() from public, anon, authenticated;
grant execute on function public.claim_creator_reward_celebration_v2() to authenticated;
