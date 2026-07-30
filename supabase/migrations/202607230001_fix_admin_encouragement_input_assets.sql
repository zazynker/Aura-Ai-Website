-- Fix synthetic generation rows created by the admin encouragement flow.
-- generations.input_assets is constrained to a JSON array; the original
-- function used an empty JSON object, causing the entire reward transaction
-- to roll back.
begin;

do $migration$
declare
  v_signature regprocedure :=
    'public.admin_issue_template_encouragement(uuid,text,integer,integer,text)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_signature) into v_definition;

  if position('''{}''::jsonb,' in v_definition) > 0 then
    v_definition := replace(
      v_definition,
      '''{}''::jsonb,' || chr(10) || '    ''{}''::jsonb,',
      '''[]''::jsonb,' || chr(10) || '    ''{}''::jsonb,'
    );
    execute v_definition;
  end if;
end;
$migration$;

notify pgrst, 'reload schema';

commit;
