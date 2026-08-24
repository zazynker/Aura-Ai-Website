-- Privacy-light registration funnel analytics. No email, IP address, prompt,
-- uploaded asset, or other user content is stored here.
create table if not exists public.auth_funnel_events (
  id bigint generated always as identity primary key,
  event_name text not null,
  session_id uuid not null,
  auth_method text,
  entry_context text,
  error_code text,
  created_at timestamptz not null default now(),
  constraint auth_funnel_event_name_check check (event_name in (
    'signup_viewed', 'login_viewed', 'signup_google_clicked', 'login_google_clicked',
    'signup_email_submitted', 'login_email_submitted', 'signup_validation_failed',
    'signup_email_sent', 'signup_failed', 'login_success', 'login_failed',
    'confirmation_resend_requested', 'confirmation_resent',
    'confirmation_resend_failed', 'auth_success', 'signup_completed', 'quick_use_auth_requested',
    'quick_use_restored'
  ))
);

create index if not exists auth_funnel_events_created_at_idx
  on public.auth_funnel_events (created_at desc);
create index if not exists auth_funnel_events_session_idx
  on public.auth_funnel_events (session_id, created_at desc);

alter table public.auth_funnel_events enable row level security;
revoke all on table public.auth_funnel_events from public, anon, authenticated;

create or replace function public.log_auth_funnel_event(
  p_event_name text,
  p_session_id uuid,
  p_auth_method text default null,
  p_entry_context text default null,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (
    select count(*)
    from public.auth_funnel_events
    where session_id = p_session_id
      and created_at > now() - interval '1 minute'
  ) >= 30 then
    return;
  end if;

  insert into public.auth_funnel_events (
    event_name, session_id, auth_method, entry_context, error_code
  ) values (
    p_event_name,
    p_session_id,
    left(nullif(p_auth_method, ''), 32),
    left(nullif(p_entry_context, ''), 64),
    left(nullif(p_error_code, ''), 80)
  );
exception
  when check_violation or invalid_text_representation then
    return;
end;
$$;

create or replace function public.admin_get_auth_funnel(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 90));
  v_since timestamptz;
  v_steps jsonb;
  v_errors jsonb;
begin
  if auth.uid() is null or not public.is_current_user_admin() then
    return jsonb_build_object('success', false, 'error', 'Admin access required');
  end if;

  v_since := now() - make_interval(days => v_days);

  select coalesce(jsonb_agg(jsonb_build_object(
    'event_name', event_name,
    'sessions', sessions
  ) order by event_name), '[]'::jsonb)
  into v_steps
  from (
    select event_name, count(distinct session_id)::bigint as sessions
    from public.auth_funnel_events
    where created_at >= v_since
    group by event_name
  ) grouped;

  select coalesce(jsonb_agg(jsonb_build_object(
    'error_code', error_code,
    'sessions', sessions
  ) order by sessions desc), '[]'::jsonb)
  into v_errors
  from (
    select error_code, count(distinct session_id)::bigint as sessions
    from public.auth_funnel_events
    where created_at >= v_since and error_code is not null
    group by error_code
    order by sessions desc
    limit 8
  ) grouped;

  return jsonb_build_object('success', true, 'days', v_days, 'steps', v_steps, 'errors', v_errors);
end;
$$;

revoke all on function public.log_auth_funnel_event(text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_get_auth_funnel(integer) from public, anon, authenticated;
grant execute on function public.log_auth_funnel_event(text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.admin_get_auth_funnel(integer) to authenticated;
