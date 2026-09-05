export const WORKFLOW_SCHEMA_VERSION = 1 as const;
export const WORKFLOW_MIN_STEPS = 1 as const;
export const WORKFLOW_MAX_STEPS = 8 as const;
export const WORKFLOW_MAX_TITLE_LENGTH = 80 as const;
export const WORKFLOW_MAX_INSTRUCTION_LENGTH = 500 as const;
export const WORKFLOW_MAX_STEP_ID_LENGTH = 64 as const;

// Structural JSON Schema for storage/API validation. Capability-specific input
// and parameter rules are enforced by validateWorkflowDefinition.
export const WORKFLOW_DEFINITION_JSON_SCHEMA = {
  $id: 'https://lazora.ai/schemas/workflow-definition-v1.json',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'steps'],
  properties: {
    schemaVersion: { const: WORKFLOW_SCHEMA_VERSION },
    steps: {
      type: 'array',
      minItems: WORKFLOW_MIN_STEPS,
      maxItems: WORKFLOW_MAX_STEPS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'order',
          'capability',
          'capabilityVersion',
          'title',
          'instruction',
          'inputs',
          'parameters',
          'output',
        ],
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            maxLength: WORKFLOW_MAX_STEP_ID_LENGTH,
            pattern: '^[a-zA-Z0-9_-]+$',
          },
          order: { type: 'integer', minimum: 1 },
          capability: { type: 'string', minLength: 1 },
          capabilityVersion: { type: 'integer', minimum: 1 },
          title: {
            type: 'string',
            minLength: 1,
            maxLength: WORKFLOW_MAX_TITLE_LENGTH,
          },
          instruction: {
            type: 'string',
            maxLength: WORKFLOW_MAX_INSTRUCTION_LENGTH,
          },
          inputs: { type: 'array' },
          parameters: { type: 'object' },
          output: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'assetType'],
            properties: {
              key: { type: 'string', minLength: 1, maxLength: 64 },
              assetType: { enum: ['image', 'video', 'audio'] },
              allowUserSelection: { type: 'boolean' },
              resultOptions: {
                type: 'array',
                maxItems: 8,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'label', 'assetType'],
                  properties: {
                    id: { type: 'string', minLength: 1, maxLength: 128 },
                    label: { type: 'string', minLength: 1, maxLength: 120 },
                    assetType: { enum: ['image', 'video', 'audio'] },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
