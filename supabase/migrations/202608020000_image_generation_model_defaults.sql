-- Existing workflow templates predate model selection and therefore represent
-- GPT Image 2 behavior. Backfill that explicit default so Builder, Template
-- Detail, and Workdock all read the same durable parameter.
with rewritten_versions as (
  select
    version.id,
    jsonb_set(
      version.workflow,
      '{steps}',
      (
        select jsonb_agg(
          case
            when step.value ->> 'capability' = 'image.text_to_image' then
              jsonb_set(
                jsonb_set(
                  step.value,
                  '{parameters,model}',
                  to_jsonb('gpt-image-2'::text),
                  true
                ),
                '{title}',
                to_jsonb('Image Generation'::text),
                true
              )
            else step.value
          end
          order by step.ordinality
        )
        from jsonb_array_elements(version.workflow -> 'steps')
          with ordinality as step(value, ordinality)
      ),
      true
    ) as workflow
  from public.template_versions as version
  where jsonb_typeof(version.workflow -> 'steps') = 'array'
    -- A database that already has the later versioning hardening correctly
    -- rejects content changes to published/archived versions. Runtime readers
    -- already use GPT Image 2 when this legacy field is absent, so only
    -- mutable versions need the explicit backfill.
    and version.version_status not in ('published', 'archived')
)
update public.template_versions as version
set workflow = rewritten.workflow
from rewritten_versions as rewritten
where version.id = rewritten.id
  and version.workflow is distinct from rewritten.workflow;
