-- Standalone audio generations used by workflow steps and timeline assembly.
alter table public.generations
  add column if not exists audio_url text,
  add column if not exists audio_duration_seconds numeric;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.generations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%media_type%'
  loop
    execute format('alter table public.generations drop constraint %I', constraint_row.conname);
  end loop;
end $$;

alter table public.generations
  add constraint generations_media_type_check
  check (media_type is null or media_type in ('image', 'video', 'audio'));

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.generations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%capability%'
  loop
    execute format('alter table public.generations drop constraint %I', constraint_row.conname);
  end loop;
end $$;

alter table public.generations
  add constraint generations_capability_check
  check (
    capability is null or capability in (
      'image.text_to_image',
      'image.replace_product',
      'image.modify',
      'image.change_ratio',
      'image.enhance',
      'image.upscale',
      'video.image_to_video',
      'video.motion_control',
      'video.lip_sync_image',
      'video.lip_sync_video',
      'audio.text_to_speech'
    )
  );

comment on column public.generations.audio_url is
  'URL for standalone audio generation output.';
comment on column public.generations.audio_duration_seconds is
  'Duration of standalone audio output in seconds.';

notify pgrst, 'reload schema';
