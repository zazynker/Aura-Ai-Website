begin;

-- Internal-only audit trail. Creators never receive this source marker; their
-- notification and celebration payload is deliberately identical to a real
-- template reward.
create table if not exists public.template_admin_boost_events (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  template_id uuid not null,
  creator_id uuid,
  action_type text not null check (action_type in ('set_use_count', 'encouragement')),
  virtual_username text,
  use_count_before bigint not null,
  use_count_after bigint not null,
  reward_credits integer not null default 0 check (reward_credits >= 0),
  synthetic_run_id uuid,
  synthetic_generation_id uuid,
  reward_id uuid,
  reward_purchase_id uuid,
  notification_id uuid,
  internal_note text,
  created_at timestamptz not null default now()
);

alter table public.template_admin_boost_events enable row level security;
revoke all on table public.template_admin_boost_events from public, anon, authenticated;
grant select on table public.template_admin_boost_events to authenticated;

drop policy if exists "Admins can view template boost audit" on public.template_admin_boost_events;
create policy "Admins can view template boost audit"
on public.template_admin_boost_events for select to authenticated
using (public.is_current_user_admin());

-- Every future real reward notification receives the real consumer's public
-- username. Admin encouragement supplies a virtual username through the same
-- metadata key, so both paths render through exactly the same UI.
create or replace function public.decorate_creator_reward_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id uuid;
  v_username text;
  v_template_name text;
  v_credits integer;
begin
  if new.type <> 'creator_credits_earned' then
    return new;
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  v_username := nullif(btrim(new.metadata ->> 'consumer_username'), '');

  if v_username is null then
    begin
      v_run_id := nullif(new.metadata ->> 'run_id', '')::uuid;
    exception when invalid_text_representation then
      v_run_id := null;
    end;

    if v_run_id is not null then
      select coalesce(
        nullif(btrim(profile.username), ''),
        nullif(btrim(consumer.name), ''),
        nullif(split_part(consumer.email, '@', 1), ''),
        'Someone'
      )
      into v_username
      from public.template_runs run
      join public.users consumer on consumer.id = run.user_id
      left join public.user_profiles profile on profile.user_id = consumer.id
      where run.id = v_run_id;
    end if;
  end if;

  v_username := coalesce(v_username, 'Someone');
  select coalesce(nullif(btrim(template.display_name), ''), template.name, 'your template')
  into v_template_name
  from public.templates template
  where template.id = new.template_id;
  v_template_name := coalesce(v_template_name, 'your template');

  v_credits := case
    when (new.metadata ->> 'credits') ~ '^[0-9]+$'
      then (new.metadata ->> 'credits')::integer
    else 0
  end;

  new.metadata := new.metadata || jsonb_build_object(
    'consumer_username', v_username,
    'template_name', v_template_name,
    'usage_count', case
      when (new.metadata ->> 'usage_count') ~ '^[0-9]+$'
        then greatest((new.metadata ->> 'usage_count')::integer, 1)
      else 1
    end
  );
  new.title := 'Credits earned';
  new.body := format(
    '%s used your template "%s". You earned %s %s.',
    v_username,
    v_template_name,
    v_credits,
    case when v_credits = 1 then 'credit' else 'credits' end
  );
  return new;
end;
$$;

revoke all on function public.decorate_creator_reward_notification() from public, anon, authenticated;

drop trigger if exists decorate_creator_reward_notification_trigger on public.notifications;
create trigger decorate_creator_reward_notification_trigger
before insert on public.notifications
for each row execute function public.decorate_creator_reward_notification();

-- Bring existing real reward notifications onto the same display contract so
-- an older unread item cannot reveal which backend path created a newer one.
update public.notifications notification
set metadata = notification.metadata || jsonb_build_object(
      'consumer_username', coalesce(
        nullif(btrim(profile.username), ''),
        nullif(btrim(consumer.name), ''),
        nullif(split_part(consumer.email, '@', 1), ''),
        'Someone'
      ),
      'template_name', coalesce((
        select coalesce(nullif(btrim(t.display_name), ''), t.name)
        from public.templates t
        where t.id = notification.template_id
      ), 'your template'),
      'usage_count', 1
    ),
    title = 'Credits earned',
    body = format(
      '%s used your template "%s". You earned %s %s.',
      coalesce(
        nullif(btrim(profile.username), ''),
        nullif(btrim(consumer.name), ''),
        nullif(split_part(consumer.email, '@', 1), ''),
        'Someone'
      ),
      coalesce((
        select coalesce(nullif(btrim(t.display_name), ''), t.name)
        from public.templates t
        where t.id = notification.template_id
      ), 'your template'),
      case
        when (notification.metadata ->> 'credits') ~ '^[0-9]+$'
          then (notification.metadata ->> 'credits')::integer
        else 0
      end,
      case
        when (notification.metadata ->> 'credits') = '1' then 'credit'
        else 'credits'
      end
    )
from public.template_runs run
join public.users consumer on consumer.id = run.user_id
left join public.user_profiles profile on profile.user_id = consumer.id
where notification.type = 'creator_credits_earned'
  and notification.metadata ->> 'run_id' = run.id::text
  and nullif(notification.metadata ->> 'consumer_username', '') is null;

create or replace function public.admin_set_template_use_count(
  p_template_id uuid,
  p_use_count bigint,
  p_internal_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := auth.uid();
  v_creator_id uuid;
  v_previous bigint;
  v_event_id uuid;
begin
  if v_admin_id is null or not public.is_current_user_admin() then
    return jsonb_build_object('success', false, 'error', 'Admin privileges required.');
  end if;
  if p_use_count < 0 or p_use_count > 100000000 then
    return jsonb_build_object('success', false, 'error', 'Use count must be between 0 and 100,000,000.');
  end if;
  if length(coalesce(p_internal_note, '')) > 500 then
    return jsonb_build_object('success', false, 'error', 'Internal note is too long.');
  end if;

  select creator_id, use_count
  into v_creator_id, v_previous
  from public.templates
  where id = p_template_id
  for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Template not found.');
  end if;

  update public.templates
  set use_count = p_use_count, updated_at = now()
  where id = p_template_id;

  insert into public.template_admin_boost_events (
    admin_id, template_id, creator_id, action_type,
    use_count_before, use_count_after, internal_note
  ) values (
    v_admin_id, p_template_id, v_creator_id, 'set_use_count',
    v_previous, p_use_count, nullif(btrim(p_internal_note), '')
  ) returning id into v_event_id;

  return jsonb_build_object(
    'success', true,
    'eventId', v_event_id,
    'previousUseCount', v_previous,
    'newUseCount', p_use_count
  );
end;
$$;

create or replace function public.admin_issue_template_encouragement(
  p_template_id uuid,
  p_virtual_username text,
  p_reward_credits integer,
  p_usage_delta integer default 1,
  p_internal_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := auth.uid();
  v_creator_id uuid;
  v_version_id uuid;
  v_template_name text;
  v_status text;
  v_generation_image_url text;
  v_previous_use_count bigint;
  v_new_use_count bigint;
  v_creator_email text;
  v_balance_before integer;
  v_balance_after integer;
  v_event_id uuid := gen_random_uuid();
  v_run_id uuid := gen_random_uuid();
  v_reward_id uuid := gen_random_uuid();
  v_purchase_id uuid := gen_random_uuid();
  v_notification_id uuid := gen_random_uuid();
  v_generation_id uuid := gen_random_uuid();
  v_eligible_credits integer;
  v_username text := btrim(coalesce(p_virtual_username, ''));
begin
  if v_admin_id is null or not public.is_current_user_admin() then
    return jsonb_build_object('success', false, 'error', 'Admin privileges required.');
  end if;
  if v_username !~ '^[A-Za-z0-9_.]{2,30}$' then
    return jsonb_build_object('success', false, 'error', 'Virtual username must be 2-30 letters, numbers, underscores, or dots.');
  end if;
  if p_reward_credits < 1 or p_reward_credits > 10000 then
    return jsonb_build_object('success', false, 'error', 'Reward credits must be between 1 and 10,000.');
  end if;
  if p_usage_delta < 1 or p_usage_delta > 1000 then
    return jsonb_build_object('success', false, 'error', 'Usage increment must be between 1 and 1,000.');
  end if;
  if length(coalesce(p_internal_note, '')) > 500 then
    return jsonb_build_object('success', false, 'error', 'Internal note is too long.');
  end if;

  select
    template.creator_id,
    template.current_version_id,
    coalesce(nullif(btrim(template.display_name), ''), template.name),
    template.status,
    template.use_count,
    coalesce(template.thumb_url, template.image_url, template.cover_url, '')
  into
    v_creator_id,
    v_version_id,
    v_template_name,
    v_status,
    v_previous_use_count,
    v_generation_image_url
  from public.templates template
  where template.id = p_template_id
  for update;

  if not found or v_creator_id is null then
    return jsonb_build_object('success', false, 'error', 'Creator template not found.');
  end if;
  if v_status <> 'published' or v_version_id is null then
    return jsonb_build_object('success', false, 'error', 'Only published templates can receive encouragement rewards.');
  end if;

  select email, credits
  into v_creator_email, v_balance_before
  from public.users
  where id = v_creator_id
  for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Template creator account not found.');
  end if;

  v_new_use_count := v_previous_use_count + p_usage_delta;
  v_balance_after := v_balance_before + p_reward_credits;
  -- Keep the same 10% reward shape used by real settlements while allowing
  -- the admin to choose the final visible reward amount.
  v_eligible_credits := p_reward_credits * 10;

  insert into public.template_admin_boost_events (
    id, admin_id, template_id, creator_id, action_type, virtual_username,
    use_count_before, use_count_after, reward_credits, internal_note
  ) values (
    v_event_id, v_admin_id, p_template_id, v_creator_id, 'encouragement', v_username,
    v_previous_use_count, v_new_use_count, p_reward_credits, nullif(btrim(p_internal_note), '')
  );

  insert into public.template_runs (
    id, template_id, template_version_id, user_id, status, current_step,
    total_credits_used, eligible_paid_credits, creator_reward_credits,
    idempotency_key, final_generation_id, started_at, completed_at, created_at, updated_at
  ) values (
    v_run_id, p_template_id, v_version_id, v_admin_id, 'completed', 1,
    v_eligible_credits, v_eligible_credits, p_reward_credits,
    'admin-encouragement:' || v_event_id::text, null, now(), now(), now(), now()
  );

  insert into public.generations (
    id, user_id, template_id, template_name, image_url, prompt,
    credits_used, media_type, input_assets, generation_parameters,
    request_id, created_at
  ) values (
    v_generation_id,
    v_admin_id,
    p_template_id::text,
    v_template_name,
    v_generation_image_url,
    '',
    v_eligible_credits,
    'image',
    '{}'::jsonb,
    '{}'::jsonb,
    gen_random_uuid()::text,
    now()
  );

  update public.template_runs
  set final_generation_id = v_generation_id
  where id = v_run_id;

  insert into public.template_step_rewards (
    id, run_id, step_id, generation_id, template_id, template_version_id,
    user_id, creator_id, credits_used, eligible_credits, reward_credits, created_at
  ) values (
    v_reward_id, v_run_id, 'admin-encouragement', v_generation_id, p_template_id, v_version_id,
    v_admin_id, v_creator_id, v_eligible_credits, v_eligible_credits, p_reward_credits, now()
  );

  -- This purchase row is the FIFO credit lot. It is intentionally not reward
  -- eligible, matching real creator rewards and preventing recursive rewards.
  insert into public.purchases (
    id, user_id, user_email, product_type, amount_cents,
    credits_granted, credits_remaining, is_refunded,
    credit_source, reward_eligible, source_reference, created_at
  ) values (
    v_purchase_id, v_creator_id, v_creator_email, 'template_creator_reward', 0,
    p_reward_credits, p_reward_credits, false,
    'template_creator_reward', false, 'template-step-reward:' || v_reward_id::text, now()
  );

  update public.users
  set credits = v_balance_after, updated_at = now()
  where id = v_creator_id;

  update public.templates
  set use_count = v_new_use_count, updated_at = now()
  where id = p_template_id;

  insert into public.notifications (
    id, user_id, type, template_id, reward_id, title, body,
    metadata, event_key, created_at
  ) values (
    v_notification_id,
    v_creator_id,
    'creator_credits_earned',
    p_template_id,
    v_reward_id,
    'Credits earned',
    '',
    jsonb_build_object(
      'link', '/dashboard?tab=templates',
      'run_id', v_run_id,
      'credits', p_reward_credits,
      'step_id', 'admin-encouragement',
      'generation_id', v_generation_id,
      'consumer_username', v_username,
      'template_name', v_template_name,
      'usage_count', p_usage_delta
    ),
    'creator-reward:' || v_reward_id::text,
    now()
  );

  update public.template_admin_boost_events
  set synthetic_run_id = v_run_id,
      synthetic_generation_id = v_generation_id,
      reward_id = v_reward_id,
      reward_purchase_id = v_purchase_id,
      notification_id = v_notification_id
  where id = v_event_id;

  return jsonb_build_object(
    'success', true,
    'eventId', v_event_id,
    'templateId', p_template_id,
    'creatorId', v_creator_id,
    'virtualUsername', v_username,
    'rewardCredits', p_reward_credits,
    'previousUseCount', v_previous_use_count,
    'newUseCount', v_new_use_count,
    'previousBalance', v_balance_before,
    'newBalance', v_balance_after
  );
end;
$$;

-- v2 claims the same notification rows as the existing function and adds only
-- public display usernames to the aggregate used by the celebration modal.
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
      coalesce(
        nullif(notification.metadata ->> 'consumer_username', ''),
        'Someone'
      ) as consumer_username,
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
        then min(claimed.template_id)::text
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

revoke all on function public.admin_set_template_use_count(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.admin_issue_template_encouragement(uuid, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.claim_creator_reward_celebration_v2() from public, anon, authenticated;
grant execute on function public.admin_set_template_use_count(uuid, bigint, text) to authenticated;
grant execute on function public.admin_issue_template_encouragement(uuid, text, integer, integer, text) to authenticated;
grant execute on function public.claim_creator_reward_celebration_v2() to authenticated;

commit;
