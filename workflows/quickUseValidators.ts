import {
  createQuickUseExampleAssetKey,
  deriveQuickUseCandidates,
  getSuggestedQuickUseControl,
} from './quickUseCandidates.js';
import {
  QUICK_USE_FINAL_VIDEO_MAX_CLIPS,
  QUICK_USE_FINAL_VIDEO_MIN_CLIPS,
} from './quickUseFinalVideo.js';
import {
  QUICK_USE_TIMELINE_MAX_AUDIO_CLIPS,
  QUICK_USE_TIMELINE_MAX_START_MS,
  QUICK_USE_TIMELINE_MAX_VIDEO_CLIPS,
} from './quickUseTimeline.js';
import {
  QUICK_USE_SCHEMA_VERSION,
  type QuickUseBlockDefinition,
  type QuickUseCandidate,
  type QuickUseControlType,
  type QuickUseDefinition,
  type QuickUseValidationIssue,
  type QuickUseValidationResult,
} from './quickUseTypes.js';

const PROMPT_INPUT_KINDS = new Set(['text', 'textarea', 'dialogue']);
const FINAL_VIDEO_TRANSITIONS = new Set(['none']);
const CONTROL_TYPES = new Set<QuickUseControlType>([
  'image_upload',
  'video_upload',
  'audio_upload',
  'text',
  'textarea',
  'dialogue',
  'number',
  'select',
  'toggle',
]);

export function validateQuickUseDefinition(
  workflow: unknown,
  definitionValue: unknown,
): QuickUseValidationResult {
  const issues: QuickUseValidationIssue[] = [];
  if (!isRecord(definitionValue)) {
    return invalid('$', 'invalid_type', 'Quick Use definition must be an object.');
  }
  if (!isJsonSerializable(definitionValue)) {
    return invalid('$', 'not_serializable', 'Quick Use definition must contain only JSON-serializable data.');
  }

  validateDefinitionShape(definitionValue, issues);
  if (issues.length > 0) return { valid: false, issues };

  const definition = definitionValue as unknown as QuickUseDefinition;
  const derivation = deriveQuickUseCandidates(workflow, definition);
  issues.push(...derivation.issues);
  if (!derivation.valid) return { valid: false, issues };

  validateBlocks(definition.blocks, derivation.candidates, issues);
  validateFinalVideo(workflow, definition, issues);
  validateTimeline(workflow, definition, issues);
  return { valid: issues.length === 0, issues };
}

export function assertValidQuickUseDefinition(
  workflow: unknown,
  definition: unknown,
): asserts definition is QuickUseDefinition {
  const result = validateQuickUseDefinition(workflow, definition);
  if (!result.valid) {
    const summary = result.issues
      .slice(0, 5)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Quick Use definition. ${summary}`);
  }
}

function validateDefinitionShape(
  value: Record<string, unknown>,
  issues: QuickUseValidationIssue[],
): void {
  if (value.schemaVersion !== QUICK_USE_SCHEMA_VERSION) {
    issues.push({
      path: '$.schemaVersion',
      code: 'unsupported_schema_version',
      message: `Quick Use schema version must be ${QUICK_USE_SCHEMA_VERSION}.`,
    });
  }
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) {
    issues.push({
      path: '$.title',
      code: 'invalid_title',
      message: 'Quick Use title is required and must be at most 120 characters.',
    });
  }
  if (value.subtitle !== undefined && (
    typeof value.subtitle !== 'string' || value.subtitle.length > 300
  )) {
    issues.push({
      path: '$.subtitle',
      code: 'invalid_subtitle',
      message: 'Quick Use subtitle must be at most 300 characters.',
    });
  }
  if (!Array.isArray(value.replaceableMaterials)) {
    issues.push({
      path: '$.replaceableMaterials',
      code: 'invalid_type',
      message: 'Replaceable materials must be an array.',
    });
  } else {
    value.replaceableMaterials.forEach((item, index) => {
      const path = `$.replaceableMaterials[${index}]`;
      if (!isRecord(item) || !isWorkflowInputBinding(item.binding)) {
        issues.push({
          path: `${path}.binding`,
          code: 'invalid_input_binding',
          message: 'Replaceable material must bind to a workflow step and input slot.',
        });
      }
    });
  }
  if (value.editableSettings !== undefined) {
    if (!Array.isArray(value.editableSettings)) {
      issues.push({
        path: '$.editableSettings',
        code: 'invalid_type',
        message: 'Editable settings must be an array.',
      });
    } else {
      value.editableSettings.forEach((item, index) => {
        const path = `$.editableSettings[${index}]`;
        if (!isRecord(item)
          || item.kind !== 'workflow_parameter'
          || typeof item.stepId !== 'string'
          || !item.stepId.trim()
          || typeof item.parameterKey !== 'string'
          || !item.parameterKey.trim()) {
          issues.push({
            path,
            code: 'invalid_parameter_binding',
            message: 'Editable setting must bind to a workflow step parameter.',
          });
        }
      });
    }
  }
  if (!Array.isArray(value.promptTemplates)) {
    issues.push({
      path: '$.promptTemplates',
      code: 'invalid_type',
      message: 'Prompt templates must be an array.',
    });
  } else {
    value.promptTemplates.forEach((item, index) => {
      validatePromptTemplateShape(item, index, issues);
    });
  }
  if (!Array.isArray(value.blocks)) {
    issues.push({
      path: '$.blocks',
      code: 'invalid_type',
      message: 'Quick Use blocks must be an array.',
    });
  } else {
    value.blocks.forEach((item, index) => {
      validateBlockShape(item, index, issues);
    });
  }
  if (value.finalVideo !== undefined) {
    validateFinalVideoShape(value.finalVideo, issues);
  }
  if (value.timeline !== undefined) validateTimelineShape(value.timeline, issues);
  if (value.stepReuse !== undefined) {
    if (!isRecord(value.stepReuse) || typeof value.stepReuse.enabled !== 'boolean') {
      issues.push({
        path: '$.stepReuse.enabled',
        code: 'invalid_type',
        message: 'Step reuse must be an object with a boolean enabled flag.',
      });
    }
  }
}

function validateTimelineShape(value: unknown, issues: QuickUseValidationIssue[]): void {
  const path = '$.timeline';
  if (!isRecord(value)) {
    issues.push({ path, code: 'invalid_type', message: 'Timeline configuration must be an object.' });
    return;
  }
  if (typeof value.enabled !== 'boolean') {
    issues.push({ path: `${path}.enabled`, code: 'invalid_type', message: 'Timeline enabled flag must be boolean.' });
  }
  if (value.preserveVideoAudio !== true) {
    issues.push({ path: `${path}.preserveVideoAudio`, code: 'invalid_value', message: 'Timeline must preserve the source video audio.' });
  }
  if (!Array.isArray(value.videoClips) || !Array.isArray(value.audioClips)) {
    issues.push({ path, code: 'invalid_type', message: 'Timeline videoClips and audioClips must be arrays.' });
    return;
  }
  if (value.videoClips.length > QUICK_USE_TIMELINE_MAX_VIDEO_CLIPS) {
    issues.push({ path: `${path}.videoClips`, code: 'too_many_clips', message: `Timeline supports at most ${QUICK_USE_TIMELINE_MAX_VIDEO_CLIPS} video clips.` });
  }
  if (value.audioClips.length > QUICK_USE_TIMELINE_MAX_AUDIO_CLIPS) {
    issues.push({ path: `${path}.audioClips`, code: 'too_many_clips', message: `Timeline supports at most ${QUICK_USE_TIMELINE_MAX_AUDIO_CLIPS} audio clips.` });
  }
  const ids = new Set<string>();
  const assetTypes = new Map<string, string>();
  const validateClip = (clip: unknown, clipPath: string, assetType: 'video' | 'audio') => {
    if (!isRecord(clip) || typeof clip.id !== 'string' || !clip.id.trim()) {
      issues.push({ path: `${clipPath}.id`, code: 'invalid_clip_id', message: 'Timeline clip id is required.' });
      return;
    }
    if (ids.has(clip.id)) issues.push({ path: `${clipPath}.id`, code: 'duplicate_clip_id', message: `Timeline clip id must be unique: ${clip.id}.` });
    ids.add(clip.id);
    if (!isRecord(clip.source) || (clip.source.kind !== 'template_asset' && clip.source.kind !== 'step_result')) {
      issues.push({ path: `${clipPath}.source`, code: 'invalid_source', message: 'Timeline clip source is invalid.' });
    } else if (clip.source.kind === 'template_asset') {
      if (typeof clip.source.assetKey !== 'string' || !clip.source.assetKey.trim()) {
        issues.push({ path: `${clipPath}.source.assetKey`, code: 'invalid_asset_key', message: 'Template asset key is required.' });
      } else {
        const previousType = assetTypes.get(clip.source.assetKey);
        if (previousType && previousType !== assetType) {
          issues.push({ path: `${clipPath}.source.assetKey`, code: 'asset_type_conflict', message: 'One timeline asset key cannot be both video and audio.' });
        }
        assetTypes.set(clip.source.assetKey, assetType);
      }
    } else if (typeof clip.source.stepId !== 'string' || !clip.source.stepId.trim()) {
      issues.push({ path: `${clipPath}.source.stepId`, code: 'invalid_step_id', message: 'Step result source requires a step id.' });
    }
    if (assetType === 'audio' && (
      typeof clip.startMs !== 'number'
      || !Number.isInteger(clip.startMs)
      || clip.startMs < 0
      || clip.startMs > QUICK_USE_TIMELINE_MAX_START_MS
    )) {
      issues.push({ path: `${clipPath}.startMs`, code: 'invalid_start_time', message: 'Audio start time must be a non-negative whole number of milliseconds.' });
    }
  };
  value.videoClips.forEach((clip, index) => validateClip(clip, `${path}.videoClips[${index}]`, 'video'));
  value.audioClips.forEach((clip, index) => validateClip(clip, `${path}.audioClips[${index}]`, 'audio'));
}

function validateTimeline(
  workflow: unknown,
  definition: QuickUseDefinition,
  issues: QuickUseValidationIssue[],
): void {
  const timeline = definition.timeline;
  if (!timeline) return;
  if (timeline.enabled && definition.finalVideo?.enabled) {
    issues.push({ path: '$.timeline.enabled', code: 'assembly_mode_conflict', message: 'Timeline and legacy final video cannot both be enabled.' });
  }
  if (timeline.enabled && timeline.videoClips.length === 0) {
    issues.push({ path: '$.timeline.videoClips', code: 'missing_video_clip', message: 'An enabled timeline needs at least one video clip.' });
  }
  const steps = readWorkflowSteps(workflow);
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const validateSource = (source: { kind: string; stepId?: string }, path: string, assetType: 'video' | 'audio') => {
    if (source.kind !== 'step_result' || !source.stepId) return;
    const step = stepById.get(source.stepId);
    if (!step) {
      issues.push({ path, code: 'unknown_timeline_step', message: `Timeline references a step that is not in this workflow: ${source.stepId}.` });
    } else if (step.outputAssetType !== assetType) {
      issues.push({ path, code: 'timeline_step_type_mismatch', message: `Timeline ${assetType} clip requires a ${assetType}-producing step.` });
    }
  };
  timeline.videoClips.forEach((clip, index) => validateSource(clip.source, `$.timeline.videoClips[${index}].source`, 'video'));
  timeline.audioClips.forEach((clip, index) => validateSource(clip.source, `$.timeline.audioClips[${index}].source`, 'audio'));
}

function validateFinalVideoShape(
  value: unknown,
  issues: QuickUseValidationIssue[],
): void {
  const path = '$.finalVideo';
  if (!isRecord(value)) {
    issues.push({ path, code: 'invalid_type', message: 'Final video configuration must be an object.' });
    return;
  }
  if (typeof value.enabled !== 'boolean') {
    issues.push({ path: `${path}.enabled`, code: 'invalid_type', message: 'Final video enabled flag must be boolean.' });
  }
  if (typeof value.transition !== 'string' || !FINAL_VIDEO_TRANSITIONS.has(value.transition)) {
    issues.push({
      path: `${path}.transition`,
      code: 'invalid_final_video_transition',
      message: 'Final video transition must be "none".',
    });
  }
  if (!Array.isArray(value.stepIds)) {
    issues.push({ path: `${path}.stepIds`, code: 'invalid_type', message: 'Final video step ids must be an array.' });
    return;
  }
  if (value.stepIds.length > QUICK_USE_FINAL_VIDEO_MAX_CLIPS) {
    issues.push({
      path: `${path}.stepIds`,
      code: 'too_many_final_video_clips',
      message: `A final video can join at most ${QUICK_USE_FINAL_VIDEO_MAX_CLIPS} clips.`,
    });
  }
  const seen = new Set<string>();
  value.stepIds.forEach((stepId, index) => {
    if (typeof stepId !== 'string' || !stepId) {
      issues.push({
        path: `${path}.stepIds[${index}]`,
        code: 'invalid_step_id',
        message: 'Final video step id must be a non-empty string.',
      });
      return;
    }
    if (seen.has(stepId)) {
      issues.push({
        path: `${path}.stepIds[${index}]`,
        code: 'duplicate_final_video_step',
        message: `A step can only appear once in the final video: ${stepId}.`,
      });
    }
    seen.add(stepId);
  });
}

/**
 * Cross-checks the final cut against the workflow it belongs to. Only a step
 * whose capability output is a video may contribute a clip, and an enabled
 * final cut must actually join something.
 */
function validateFinalVideo(
  workflow: unknown,
  definition: QuickUseDefinition,
  issues: QuickUseValidationIssue[],
): void {
  const finalVideo = definition.finalVideo;
  if (!finalVideo) return;

  const steps = readWorkflowSteps(workflow);
  const stepById = new Map(steps.map((step) => [step.id, step]));

  finalVideo.stepIds.forEach((stepId, index) => {
    const step = stepById.get(stepId);
    if (!step) {
      issues.push({
        path: `$.finalVideo.stepIds[${index}]`,
        code: 'unknown_final_video_step',
        message: `Final video references a step that is not in this workflow: ${stepId}.`,
      });
      return;
    }
    if (step.outputAssetType !== 'video') {
      issues.push({
        path: `$.finalVideo.stepIds[${index}]`,
        code: 'final_video_step_not_video',
        message: `Only a video step can be part of the final video: ${stepId}.`,
      });
    }
  });

  const orderedIds = steps
    .filter((step) => finalVideo.stepIds.includes(step.id) && step.outputAssetType === 'video')
    .map((step) => step.id);
  const authoredOrder = finalVideo.stepIds.filter((stepId) => orderedIds.includes(stepId));
  if (authoredOrder.some((stepId, index) => orderedIds[index] !== stepId)) {
    issues.push({
      path: '$.finalVideo.stepIds',
      code: 'final_video_order_mismatch',
      message: 'Final video step ids must be stored in workflow order.',
    });
  }

  if (finalVideo.enabled && orderedIds.length < QUICK_USE_FINAL_VIDEO_MIN_CLIPS) {
    issues.push({
      path: '$.finalVideo.stepIds',
      code: 'not_enough_final_video_clips',
      message: `Turn off the final video or include at least ${QUICK_USE_FINAL_VIDEO_MIN_CLIPS} video steps.`,
    });
  }
}

interface WorkflowStepSummary {
  id: string;
  order: number;
  outputAssetType: string;
}

function readWorkflowSteps(workflow: unknown): WorkflowStepSummary[] {
  if (!isRecord(workflow) || !Array.isArray(workflow.steps)) return [];
  return workflow.steps
    .flatMap((step): WorkflowStepSummary[] => {
      if (!isRecord(step) || typeof step.id !== 'string') return [];
      const output = isRecord(step.output) ? step.output : {};
      return [{
        id: step.id,
        order: typeof step.order === 'number' ? step.order : Number.MAX_SAFE_INTEGER,
        outputAssetType: typeof output.assetType === 'string' ? output.assetType : '',
      }];
    })
    .sort((left, right) => left.order - right.order);
}

function validatePromptTemplateShape(
  value: unknown,
  index: number,
  issues: QuickUseValidationIssue[],
): void {
  const path = `$.promptTemplates[${index}]`;
  if (!isRecord(value)) {
    issues.push({ path, code: 'invalid_type', message: 'Prompt template must be an object.' });
    return;
  }
  if (typeof value.stepId !== 'string' || !value.stepId) {
    issues.push({ path: `${path}.stepId`, code: 'invalid_step_id', message: 'Prompt template step id is required.' });
  }
  if (typeof value.parameterKey !== 'string' || !value.parameterKey) {
    issues.push({ path: `${path}.parameterKey`, code: 'invalid_parameter_key', message: 'Prompt parameter key is required.' });
  }
  if (typeof value.template !== 'string') {
    issues.push({ path: `${path}.template`, code: 'invalid_type', message: 'Prompt template must be a string.' });
  }
  if (!Array.isArray(value.variables)) {
    issues.push({ path: `${path}.variables`, code: 'invalid_type', message: 'Prompt variables must be an array.' });
    return;
  }
  value.variables.forEach((variable, variableIndex) => {
    const variablePath = `${path}.variables[${variableIndex}]`;
    if (!isRecord(variable)) {
      issues.push({ path: variablePath, code: 'invalid_type', message: 'Prompt variable must be an object.' });
      return;
    }
    if (typeof variable.key !== 'string') {
      issues.push({ path: `${variablePath}.key`, code: 'invalid_type', message: 'Prompt variable key must be a string.' });
    }
    if (typeof variable.label !== 'string') {
      issues.push({ path: `${variablePath}.label`, code: 'invalid_type', message: 'Prompt variable label must be a string.' });
    }
    if (typeof variable.defaultValue !== 'string') {
      issues.push({ path: `${variablePath}.defaultValue`, code: 'invalid_type', message: 'Prompt variable default must be a string.' });
    }
    if (typeof variable.inputKind !== 'string' || !PROMPT_INPUT_KINDS.has(variable.inputKind)) {
      issues.push({ path: `${variablePath}.inputKind`, code: 'invalid_input_kind', message: 'Prompt variable input kind is invalid.' });
    }
    if (typeof variable.required !== 'boolean') {
      issues.push({ path: `${variablePath}.required`, code: 'invalid_type', message: 'Prompt variable required flag must be boolean.' });
    }
    if (variable.dialogue !== undefined) {
      validateDialogueShape(variable.dialogue, `${variablePath}.dialogue`, issues);
    }
  });
}

function validateDialogueShape(
  value: unknown,
  path: string,
  issues: QuickUseValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({ path, code: 'invalid_type', message: 'Dialogue definition must be an object.' });
    return;
  }
  if (typeof value.allowUserRenameCharacters !== 'boolean') {
    issues.push({ path: `${path}.allowUserRenameCharacters`, code: 'invalid_type', message: 'Character rename permission must be boolean.' });
  }
  if (!Array.isArray(value.characters) || value.characters.length < 1 || value.characters.length > 8) {
    issues.push({ path: `${path}.characters`, code: 'invalid_dialogue_characters', message: 'Dialogue must define between 1 and 8 characters.' });
    return;
  }
  const characterIds = new Set<string>();
  value.characters.forEach((character, index) => {
    const characterPath = `${path}.characters[${index}]`;
    if (!isRecord(character) || typeof character.id !== 'string' || !/^character_[1-9][0-9]*$/.test(character.id)) {
      issues.push({ path: `${characterPath}.id`, code: 'invalid_dialogue_character_id', message: 'Character id must be a stable character_N id.' });
      return;
    }
    if (characterIds.has(character.id)) {
      issues.push({ path: `${characterPath}.id`, code: 'duplicate_dialogue_character_id', message: 'Dialogue character ids must be unique.' });
    }
    characterIds.add(character.id);
    if (typeof character.defaultName !== 'string' || !character.defaultName.trim() || character.defaultName.length > 80) {
      issues.push({ path: `${characterPath}.defaultName`, code: 'invalid_dialogue_character_name', message: 'Character name is required and must be at most 80 characters.' });
    }
  });
  if (!Array.isArray(value.turns) || value.turns.length < 1 || value.turns.length > 12) {
    issues.push({ path: `${path}.turns`, code: 'invalid_dialogue_turns', message: 'Dialogue must define between 1 and 12 default turns.' });
    return;
  }
  const turnIds = new Set<string>();
  value.turns.forEach((turn, index) => {
    const turnPath = `${path}.turns[${index}]`;
    if (!isRecord(turn) || typeof turn.id !== 'string' || !/^turn_[1-9][0-9]*$/.test(turn.id)) {
      issues.push({ path: `${turnPath}.id`, code: 'invalid_dialogue_turn_id', message: 'Turn id must be a stable turn_N id.' });
      return;
    }
    if (turnIds.has(turn.id)) {
      issues.push({ path: `${turnPath}.id`, code: 'duplicate_dialogue_turn_id', message: 'Dialogue turn ids must be unique.' });
    }
    turnIds.add(turn.id);
    if (typeof turn.characterId !== 'string' || !characterIds.has(turn.characterId)) {
      issues.push({ path: `${turnPath}.characterId`, code: 'unknown_dialogue_character', message: 'Dialogue turn must reference a defined character.' });
    }
    if (typeof turn.text !== 'string' || !turn.text.trim() || turn.text.length > 240) {
      issues.push({ path: `${turnPath}.text`, code: 'invalid_dialogue_text', message: 'Dialogue text is required and must be at most 240 characters.' });
    }
  });
}

function validateBlockShape(
  value: unknown,
  index: number,
  issues: QuickUseValidationIssue[],
): void {
  const path = `$.blocks[${index}]`;
  if (!isRecord(value)) {
    issues.push({ path, code: 'invalid_type', message: 'Quick Use block must be an object.' });
    return;
  }
  if (typeof value.candidateId !== 'string' || !value.candidateId) {
    issues.push({ path: `${path}.candidateId`, code: 'invalid_candidate_id', message: 'Block candidate id is required.' });
  }
  if (!Number.isInteger(value.order) || value.order !== index + 1) {
    issues.push({ path: `${path}.order`, code: 'invalid_block_order', message: `Block order must be ${index + 1}.` });
  }
  if (typeof value.control !== 'string' || !CONTROL_TYPES.has(value.control as QuickUseControlType)) {
    issues.push({ path: `${path}.control`, code: 'invalid_control', message: 'Block control type is invalid.' });
  }
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) {
    issues.push({ path: `${path}.title`, code: 'invalid_block_title', message: 'Block title is required and must be at most 120 characters.' });
  }
  if (value.subtitle !== undefined && (typeof value.subtitle !== 'string' || value.subtitle.length > 300)) {
    issues.push({ path: `${path}.subtitle`, code: 'invalid_block_subtitle', message: 'Block subtitle must be at most 300 characters.' });
  }
  if (value.placeholder !== undefined && (typeof value.placeholder !== 'string' || value.placeholder.length > 200)) {
    issues.push({ path: `${path}.placeholder`, code: 'invalid_placeholder', message: 'Block placeholder must be at most 200 characters.' });
  }
  ['primary', 'required', 'openByDefault'].forEach((key) => {
    if (typeof value[key] !== 'boolean') {
      issues.push({ path: `${path}.${key}`, code: 'invalid_type', message: `${key} must be boolean.` });
    }
  });
  if (value.defaultValue !== undefined && !isJsonPrimitive(value.defaultValue)) {
    issues.push({ path: `${path}.defaultValue`, code: 'invalid_default_value', message: 'Block default must be a JSON primitive.' });
  }
  if (value.example !== undefined) validateExampleShape(value.example, `${path}.example`, issues);
}

function validateExampleShape(
  value: unknown,
  path: string,
  issues: QuickUseValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({ path, code: 'invalid_type', message: 'Block example must be an object.' });
    return;
  }
  if (value.kind === 'text') {
    if (typeof value.value !== 'string') {
      issues.push({ path: `${path}.value`, code: 'invalid_type', message: 'Text example value must be a string.' });
    }
    return;
  }
  if (value.kind === 'media') {
    if (!['image', 'video', 'audio'].includes(String(value.assetType))) {
      issues.push({ path: `${path}.assetType`, code: 'invalid_asset_type', message: 'Media example asset type is invalid.' });
    }
    if (typeof value.assetKey !== 'string' || !value.assetKey) {
      issues.push({ path: `${path}.assetKey`, code: 'invalid_asset_key', message: 'Media example asset key is required.' });
    }
    return;
  }
  issues.push({ path: `${path}.kind`, code: 'invalid_example_kind', message: 'Block example kind is invalid.' });
}

function validateBlocks(
  blocks: QuickUseBlockDefinition[],
  candidates: QuickUseCandidate[],
  issues: QuickUseValidationIssue[],
): void {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const seenCandidateIds = new Set<string>();
  let primaryCount = 0;

  blocks.forEach((block, index) => {
    const path = `$.blocks[${index}]`;
    if (seenCandidateIds.has(block.candidateId)) {
      issues.push({
        path: `${path}.candidateId`,
        code: 'duplicate_exposed_candidate',
        message: `Candidate is exposed more than once: ${block.candidateId}.`,
      });
      return;
    }
    seenCandidateIds.add(block.candidateId);
    const candidate = candidatesById.get(block.candidateId);
    if (!candidate) {
      issues.push({
        path: `${path}.candidateId`,
        code: 'unknown_candidate',
        message: `Block references a candidate that is not available: ${block.candidateId}.`,
      });
      return;
    }

    if (!isControlCompatible(block.control, candidate)) {
      issues.push({
        path: `${path}.control`,
        code: 'incompatible_control',
        message: `Control ${block.control} is incompatible with ${candidate.kind} candidate ${candidate.id}.`,
      });
    }
    if (candidate.required && !block.required) {
      issues.push({
        path: `${path}.required`,
        code: 'required_candidate_made_optional',
        message: 'A required workflow candidate cannot be made optional.',
      });
    }
    if (block.primary) primaryCount += 1;
    if (
      block.example?.kind === 'media'
      && block.example.assetKey !== createQuickUseExampleAssetKey(block.candidateId)
    ) {
      issues.push({
        path: `${path}.example.assetKey`,
        code: 'unstable_example_asset_key',
        message: 'Media example asset key must be derived from the block candidate id.',
      });
    }
    validateBlockDefault(block, candidate, path, issues);
  });

  if (primaryCount > 1) {
    issues.push({
      path: '$.blocks',
      code: 'multiple_primary_blocks',
      message: 'Quick Use definition can contain at most one primary block.',
    });
  }
}

function isControlCompatible(
  control: QuickUseControlType,
  candidate: QuickUseCandidate,
): boolean {
  const suggested = getSuggestedQuickUseControl(candidate);
  if (control === suggested) return true;
  if (candidate.kind === 'prompt_variable') {
    if (candidate.dialogue) return false;
    return ['text', 'textarea', 'dialogue'].includes(control);
  }
  if (candidate.kind === 'setting' && candidate.parameterType === 'string') {
    return control === 'text' || control === 'textarea';
  }
  return false;
}

function validateBlockDefault(
  block: QuickUseBlockDefinition,
  candidate: QuickUseCandidate,
  path: string,
  issues: QuickUseValidationIssue[],
): void {
  if (block.defaultValue === undefined) return;
  if (candidate.kind === 'material') {
    issues.push({
      path: `${path}.defaultValue`,
      code: 'media_default_not_supported',
      message: 'Media upload blocks use the workflow asset as their default and cannot store a primitive default.',
    });
    return;
  }
  if (candidate.kind === 'prompt_variable') {
    if (typeof block.defaultValue !== 'string') {
      issues.push({ path: `${path}.defaultValue`, code: 'invalid_default_type', message: 'Prompt variable default must be a string.' });
    }
    return;
  }

  const value = block.defaultValue;
  const expectedType = candidate.parameterType === 'enum' ? null : candidate.parameterType;
  if (expectedType && typeof value !== expectedType) {
    issues.push({
      path: `${path}.defaultValue`,
      code: 'invalid_default_type',
      message: `Setting default must be a ${expectedType}.`,
    });
    return;
  }
  if (candidate.parameterType === 'enum' && !candidate.enumValues?.includes(value)) {
    issues.push({
      path: `${path}.defaultValue`,
      code: 'invalid_default_value',
      message: 'Setting default is not an allowed enum value.',
    });
  }
  if (typeof value === 'number') {
    if (candidate.min !== undefined && value < candidate.min) {
      issues.push({ path: `${path}.defaultValue`, code: 'default_too_small', message: `Setting default must be at least ${candidate.min}.` });
    }
    if (candidate.max !== undefined && value > candidate.max) {
      issues.push({ path: `${path}.defaultValue`, code: 'default_too_large', message: `Setting default must be at most ${candidate.max}.` });
    }
  }
  if (typeof value === 'string' && candidate.maxLength !== undefined && value.length > candidate.maxLength) {
    issues.push({ path: `${path}.defaultValue`, code: 'default_too_long', message: `Setting default must be at most ${candidate.maxLength} characters.` });
  }
}

function isWorkflowInputBinding(value: unknown): boolean {
  return isRecord(value)
    && value.kind === 'workflow_input'
    && typeof value.stepId === 'string'
    && Boolean(value.stepId)
    && typeof value.slot === 'string'
    && Boolean(value.slot);
}

function isJsonSerializable(value: unknown, seen = new Set<object>()): boolean {
  if (isJsonPrimitive(value)) return true;
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = value.every((item) => isJsonSerializable(item, seen));
    seen.delete(value);
    return valid;
  }
  if (!isRecord(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Object.values(value).every((item) => isJsonSerializable(item, seen));
  seen.delete(value);
  return valid;
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null
    || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))
    || typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(path: string, code: string, message: string): QuickUseValidationResult {
  return { valid: false, issues: [{ path, code, message }] };
}
