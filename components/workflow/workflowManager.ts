import { useEffect, useState } from 'react';
import {
  cancelTemplateRun,
  fetchActiveTemplateRun,
  fetchReusableTemplateAssets,
  setTemplateRunCurrentStep,
  type StartedTemplateRun,
  type TemplateRunStatus,
  type TemplateRunStepStatus,
  type TemplateRunMaterial,
} from '../../utils/templateRunApi';

export interface WorkflowStep {
  id: string;
  runStepId: string;
  stepNumber: number;
  capability: string;
  feature: string;
  targetRoute: string;
  reusableMaterials: boolean;
  materials: WorkflowMaterial[];
  prompt: string;
  settings: Record<string, unknown>;
  status: TemplateRunStepStatus;
  result?: {
    type: 'image' | 'video';
    url: string;
    thumbnail?: string;
  };
}

export interface WorkflowMaterial {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  slot?: string;
}

export type WorkflowHandoffAction = 'all' | 'materials' | 'prompt';

export interface WorkflowHandoff {
  nonce: string;
  runId: string;
  stepId: string;
  capability: string;
  action: WorkflowHandoffAction;
  materials: WorkflowMaterial[];
  prompt: string;
  settings: Record<string, unknown>;
}

export interface WorkflowSession {
  runId: string;
  templateId: string;
  templateVersionId: string;
  status: TemplateRunStatus;
  steps: WorkflowStep[];
}

interface StoredWorkflowState {
  session: WorkflowSession | null;
  steps: WorkflowStep[] | null;
  activeStepId: string | null;
  minimized: boolean;
  runId: string | null;
  status: TemplateRunStatus | null;
}

const WORKFLOW_STORAGE_KEY = 'lazora_active_workflow';
const ACTIVE_STEP_STORAGE_KEY = 'lazora_active_step';
const MINIMIZED_STORAGE_KEY = 'lazora_workflow_minimized';
const WORKFLOW_HANDOFF_STORAGE_KEY = 'lazora_workflow_handoff';

const notifyWorkflowChanged = () => {
  window.dispatchEvent(new Event('workflow-changed'));
};

export const getWorkflowTargetRoute = (capability: string): string => {
  if (capability === 'video.motion_control') return '/video?mode=motion-control';
  if (capability === 'video.lip_sync_image') return '/video?mode=lip-sync&input=image';
  if (capability === 'video.lip_sync_video') return '/video?mode=lip-sync&input=video';
  if (capability === 'video.image_to_video') return '/video?mode=image-to-video';
  return capability.startsWith('video.') ? '/video' : '/modify';
};

const buildSessionFromRun = (
  run: StartedTemplateRun,
  existingSession?: WorkflowSession | null,
  availableMaterials: TemplateRunMaterial[] = [],
): WorkflowSession => ({
  runId: run.id,
  templateId: run.templateId,
  templateVersionId: run.templateVersionId,
  status: run.status,
  steps: run.steps.map((runStep, index) => {
    const savedStep = run.workflow.steps.find((step) => step.id === runStep.stepId)
      || run.workflow.steps[index];
    const existingStep = existingSession?.runId === run.id
      ? existingSession.steps.find((step) => step.id === runStep.stepId)
      : undefined;
    const savedInputs = savedStep?.inputs || [];
    const stepMaterials = availableMaterials
      .filter((asset) => savedInputs.some((input) => input.templateAssetId === asset.id))
      .map((asset) => {
        const binding = savedInputs.find((input) => input.templateAssetId === asset.id);
        return {
          id: asset.id,
          name: asset.name,
          type: asset.type,
          url: asset.url,
          slot: typeof binding?.slot === 'string' ? binding.slot : undefined,
        };
      });
    return {
      id: runStep.stepId,
      runStepId: runStep.id,
      stepNumber: runStep.stepOrder,
      capability: runStep.capability,
      feature: existingStep?.feature || savedStep?.title || runStep.capability,
      targetRoute: getWorkflowTargetRoute(runStep.capability),
      reusableMaterials: stepMaterials.length > 0 || existingStep?.reusableMaterials || false,
      materials: stepMaterials.length > 0 ? stepMaterials : existingStep?.materials || [],
      prompt: existingStep?.prompt || savedStep?.instruction || '',
      settings: Object.keys(existingStep?.settings || {}).length > 0
        ? existingStep!.settings
        : savedStep?.parameters || {},
      status: runStep.status,
      result: existingStep?.result,
    };
  }),
});

const persistWorkflow = (
  session: WorkflowSession,
  activeStepId: string,
  resetMinimized: boolean,
) => {
  sessionStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(session));
  sessionStorage.setItem(ACTIVE_STEP_STORAGE_KEY, activeStepId);
  if (resetMinimized || sessionStorage.getItem(MINIMIZED_STORAGE_KEY) === null) {
    sessionStorage.setItem(MINIMIZED_STORAGE_KEY, 'false');
  }
  notifyWorkflowChanged();
};

export const startWorkflow = (session: WorkflowSession) => {
  if (!session.runId || session.steps.length === 0) {
    throw new Error('The workflow run has no executable steps.');
  }
  persistWorkflow(session, session.steps[0].id, true);
};

export const queueWorkflowHandoff = (
  step: WorkflowStep,
  action: WorkflowHandoffAction,
): WorkflowHandoff => {
  const nonce = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const handoff: WorkflowHandoff = {
    nonce,
    runId: getWorkflowState().runId || '',
    stepId: step.id,
    capability: step.capability,
    action,
    materials: step.materials || [],
    prompt: step.prompt || '',
    settings: step.settings || {},
  };
  sessionStorage.setItem(WORKFLOW_HANDOFF_STORAGE_KEY, JSON.stringify(handoff));
  return handoff;
};

export const consumeWorkflowHandoff = (): WorkflowHandoff | null => {
  try {
    const raw = sessionStorage.getItem(WORKFLOW_HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(WORKFLOW_HANDOFF_STORAGE_KEY);
    const handoff = JSON.parse(raw) as WorkflowHandoff;
    return handoff?.stepId && handoff?.action ? handoff : null;
  } catch {
    sessionStorage.removeItem(WORKFLOW_HANDOFF_STORAGE_KEY);
    return null;
  }
};

const clearStoredWorkflow = () => {
  sessionStorage.removeItem(WORKFLOW_STORAGE_KEY);
  sessionStorage.removeItem(ACTIVE_STEP_STORAGE_KEY);
  sessionStorage.removeItem(MINIMIZED_STORAGE_KEY);
  sessionStorage.removeItem(WORKFLOW_HANDOFF_STORAGE_KEY);
  notifyWorkflowChanged();
};

export const getWorkflowState = (): StoredWorkflowState => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(WORKFLOW_STORAGE_KEY) || 'null');
    // Old UI-only builds stored a bare array of mock Unsplash steps. Ignore it
    // so a stale browser session can never masquerade as a real template run.
    const session = stored && !Array.isArray(stored) && stored.runId
      ? {
          ...stored,
          steps: Array.isArray(stored.steps)
            ? stored.steps.map((step: WorkflowStep) => ({ ...step, materials: step.materials || [] }))
            : [],
        } as WorkflowSession
      : null;
    const activeStepId = sessionStorage.getItem(ACTIVE_STEP_STORAGE_KEY) || null;
    const minimized = sessionStorage.getItem(MINIMIZED_STORAGE_KEY) === 'true';
    return {
      session,
      steps: session?.steps || null,
      activeStepId,
      minimized,
      runId: session?.runId || null,
      status: session?.status || null,
    };
  } catch {
    return {
      session: null,
      steps: null,
      activeStepId: null,
      minimized: false,
      runId: null,
      status: null,
    };
  }
};

export const clearWorkflow = async (cancelRun = true) => {
  const { session } = getWorkflowState();
  if (cancelRun && session?.runId && session.status === 'started') {
    await cancelTemplateRun(session.runId);
  }
  clearStoredWorkflow();
};

export const restoreActiveWorkflow = async (): Promise<WorkflowSession | null> => {
  const existingSession = getWorkflowState().session;
  const run = await fetchActiveTemplateRun();
  if (!run || run.status !== 'started') {
    clearStoredWorkflow();
    return null;
  }

  const materials = await fetchReusableTemplateAssets(run.templateId, run.templateVersionId);
  const session = buildSessionFromRun(run, existingSession, materials);
  const activeStep = run.steps.find((step) => step.stepOrder === run.currentStep)
    || run.steps.find((step) => step.status === 'active')
    || run.steps[0];
  if (!activeStep) {
    clearStoredWorkflow();
    return null;
  }
  persistWorkflow(session, activeStep.stepId, false);
  return session;
};

export const setActiveStep = async (stepId: string): Promise<void> => {
  const existingSession = getWorkflowState().session;
  if (!existingSession?.runId) {
    throw new Error('This workflow is no longer active.');
  }
  const run = await setTemplateRunCurrentStep(existingSession.runId, stepId);
  const session = buildSessionFromRun(run, existingSession);
  persistWorkflow(session, stepId, false);
};

export const setWorkflowMinimized = (minimized: boolean) => {
  sessionStorage.setItem(MINIMIZED_STORAGE_KEY, String(minimized));
  notifyWorkflowChanged();
};

export const useWorkflowState = () => {
  const [state, setState] = useState(getWorkflowState());

  useEffect(() => {
    const handleUpdate = () => setState(getWorkflowState());
    window.addEventListener('workflow-changed', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('workflow-changed', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  return state;
};
