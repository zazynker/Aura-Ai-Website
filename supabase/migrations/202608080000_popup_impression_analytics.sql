-- Count guest auth-gate impressions without exposing analytics data publicly.
create table if not exists public.popup_impression_counters (
  popup_key text primary key,
  impression_count bigint not null default 0 check (impression_count >= 0),
  first_shown_at timestamptz,
  last_shown_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.popup_impression_counters enable row level security;
revoke all on table public.popup_impression_counters from public, anon, authenticated;

create or replace function public.log_popup_impression(p_popup_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count bigint;
begin
  if p_popup_key <> 'template_detail_auth_gate' then
    return jsonb_build_object('success', false, 'error', 'Unsupported popup key');
  end if;

  insert into public.popup_impression_counters (
    popup_key,
    impression_count,
    first_shown_at,
    last_shown_at,
    updated_at
  )
  values (p_popup_key, 1, now(), now(), now())
  on conflict (popup_key) do update
  set impression_count = public.popup_impression_counters.impression_count + 1,
      first_shown_at = coalesce(public.popup_impression_counters.first_shown_at, excluded.first_shown_at),
      last_shown_at = excluded.last_shown_at,
      updated_at = excluded.updated_at
  returning impression_count into v_count;

  return jsonb_build_object('success', true, 'impression_count', v_count);
end;
$$;

create or replace function public.admin_get_popup_impression_count(p_popup_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count bigint;
  v_last_shown_at timestamptz;
begin
  if auth.uid() is null or not public.is_current_user_admin() then
    return jsonb_build_object('success', false, 'error', 'Admin access required');
  end if;

  select impression_count, last_shown_at
    into v_count, v_last_shown_at
  from public.popup_impression_counters
  where popup_key = p_popup_key;

  return jsonb_build_object(
    'success', true,
    'impression_count', coalesce(v_count, 0),
    'last_shown_at', v_last_shown_at
  );
end;
$$;

revoke all on function public.log_popup_impression(text) from public, anon, authenticated;
revoke all on function public.admin_get_popup_impression_count(text) from public, anon, authenticated;

grant execute on function public.log_popup_impression(text) to anon, authenticated;
grant execute on function public.admin_get_popup_impression_count(text) to authenticated;
