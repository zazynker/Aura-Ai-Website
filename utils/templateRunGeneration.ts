import {
  beginTemplateRunStep,
  completeTemplateRunStep,
  failTemplateRunStep,
} from './templateRunApi';
import {
  getWorkflowState,
  clearEngagedWorkflowStep,
  refreshWorkflowRun,
} from '../components/workflow/workflowManager';

export interface TemplateGenerationContext {
  templateRunId: string;
  templateStepId: string;
  templateCapability: string;
}

const normalizeErrorCode = (value: unknown): string => {
  const message = value instanceof Error ? value.message : String(value || 'generation_failed');
  return message.trim().slice(0, 240) || 'generation_failed';
};

const LIP_SYNC_CAPABILITIES = new Set([
  'video.lip_sync_image',
  'video.lip_sync_video',
]);

/**
 * A template Lip Sync step remains attributable when the user replaces the
 * reusable character material and that changes only the Lip Sync input mode.
 * Every other capability boundary stays strict.
 */
export const areTemplateCapabilitiesCompatible = (
  templateCapability: string,
  generationCapability: string,
): boolean => (
  templateCapability === generationCapability
  || (
    LIP_SYNC_CAPABILITIES.has(templateCapability)
    && LIP_SYNC_CAPABILITIES.has(generationCapability)
  )
);

export const getActiveTemplateGenerationContext = (
  capability: string,
): TemplateGenerationContext | null => {
  const state = getWorkflowState();
  if (
    !state.session
    || state.status !== 'started'
    || !state.activeStepId
    || state.engagedStepId !== state.activeStepId
  ) return null;
  const step = state.session.steps.find((item) => item.id === state.activeStepId);
  if (
    !step
    || !areTemplateCapabilitiesCompatible(step.capability, capability)
    || step.status === 'completed'
    || step.status === 'skipped'
  ) return null;
  return {
    templateRunId: state.session.runId,
    templateStepId: step.id,
    templateCapability: step.capability,
  };
};

export const beginActiveTemplateGeneration = async (
  capability: string,
): Promise<TemplateGenerationContext | null> => {
  const context = getActiveTemplateGenerationContext(capability);
  if (!context) return null;
  await beginTemplateRunStep(context.templateRunId, context.templateStepId);
  return context;
};

export const completeTemplateGeneration = async (
  context: TemplateGenerationContext | null | undefined,
  generationId: string,
): Promise<void> => {
  if (!context?.templateRunId || !context.templateStepId || !generationId) return;
  await completeTemplateRunStep(context.templateRunId, context.templateStepId, generationId);
  clearEngagedWorkflowStep(context.templateRunId, context.templateStepId);
  await refreshWorkflowRun(context.templateRunId);
};

export const failTemplateGeneration = async (
  context: TemplateGenerationContext | null | undefined,
  error: unknown,
): Promise<void> => {
  if (!context?.templateRunId || !context.templateStepId) return;
  await failTemplateRunStep(
    context.templateRunId,
    context.templateStepId,
    normalizeErrorCode(error),
  );
  await refreshWorkflowRun(context.templateRunId);
};
