import { useEffect, useState } from 'react';
import {
  cancelTemplateRun,
  fetchActiveTemplateRun,
  fetchTemplateRun,
  fetchTemplateRunMode,
  engageTemplateRunStep,
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
    type: 'image' | 'video' | 'audio';
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
  engagedStepId: string | null;
  minimized: boolean;
  runId: string | null;
  status: TemplateRunStatus | null;
}

const WORKFLOW_STORAGE_KEY = 'lazora_active_workflow';
const ACTIVE_STEP_STORAGE_KEY = 'lazora_active_step';
const ENGAGED_STEP_STORAGE_KEY = 'lazora_engaged_template_step';
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

const getWorkflowFeatureName = (capability: string, fallback?: string): string =>
  capability === 'image.text_to_image' ? 'Image Generation' : fallback || capability;

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
      .filter((asset) => asset.isReusable && savedInputs.some((input) => input.templateAssetId === asset.id))
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
    const referenceResult = availableMaterials.find(
      (asset) => asset.assetKey === `step-${runStep.stepOrder}-result`,
    );
    const savedResult = referenceResult
      ? {
          type: savedStep?.output?.assetType === 'video'
            ? 'video' as const
            : savedStep?.output?.assetType === 'audio'
              ? 'audio' as const
              : 'image' as const,
          url: referenceResult.url,
        }
      : undefined;
    return {
      id: runStep.stepId,
      runStepId: runStep.id,
      stepNumber: runStep.stepOrder,
      capability: runStep.capability,
      feature: getWorkflowFeatureName(
        runStep.capability,
        existingStep?.feature || savedStep?.title,
      ),
      targetRoute: getWorkflowTargetRoute(runStep.capability),
      reusableMaterials: stepMaterials.length > 0 || existingStep?.reusableMaterials || false,
      materials: stepMaterials.length > 0 ? stepMaterials : existingStep?.materials || [],
      prompt: existingStep?.prompt || savedStep?.instruction || '',
      settings: Object.keys(existingStep?.settings || {}).length > 0
        ? existingStep!.settings
        : savedStep?.parameters || {},
      status: runStep.status,
      result: existingStep?.result || savedResult,
    };
  }),
});

const persistWorkflow = (
  session: WorkflowSession,
  activeStepId: string,
  resetMinimized: boolean,
  engagedStepId?: string | null,
) => {
  sessionStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(session));
  sessionStorage.setItem(ACTIVE_STEP_STORAGE_KEY, activeStepId);
  if (engagedStepId === null) {
    sessionStorage.removeItem(ENGAGED_STEP_STORAGE_KEY);
  } else if (engagedStepId) {
    sessionStorage.setItem(ENGAGED_STEP_STORAGE_KEY, engagedStepId);
  }
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

export const queueWorkflowHandoff = async (
  step: WorkflowStep,
  action: WorkflowHandoffAction,
): Promise<WorkflowHandoff> => {
  const nonce = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const runId = getWorkflowState().runId || '';
  if (!runId) throw new Error('This workflow is no longer active.');
  await engageTemplateRunStep(runId, step.id, action);
  const handoff: WorkflowHandoff = {
    nonce,
    runId,
    stepId: step.id,
    capability: step.capability,
    action,
    materials: step.materials || [],
    prompt: step.prompt || '',
    settings: step.settings || {},
  };
  sessionStorage.setItem(WORKFLOW_HANDOFF_STORAGE_KEY, JSON.stringify(handoff));
  // A template step only becomes attributable after an explicit reuse action:
  // Use template, the main bead, or a materials/prompt quick bead.
  sessionStorage.setItem(ENGAGED_STEP_STORAGE_KEY, step.id);
  notifyWorkflowChanged();
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
  sessionStorage.removeItem(ENGAGED_STEP_STORAGE_KEY);
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
    const engagedStepId = sessionStorage.getItem(ENGAGED_STEP_STORAGE_KEY) || null;
    const minimized = sessionStorage.getItem(MINIMIZED_STORAGE_KEY) === 'true';
    return {
      session,
      steps: session?.steps || null,
      activeStepId,
      engagedStepId,
      minimized,
      runId: session?.runId || null,
      status: session?.status || null,
    };
  } catch {
    return {
      session: null,
      steps: null,
      activeStepId: null,
      engagedStepId: null,
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

  // A Template (Quick Use) run is not a Workflow. It runs to completion on its
  // own and has no step-by-step dock; adopting it here used to show a 1-2-3
  // stepper over the Templates page and let the user cancel a finished run.
  const runMode = await fetchTemplateRunMode(run.id);
  if (runMode === 'quick_use') {
    if (existingSession?.runId === run.id) clearStoredWorkflow();
    return null;
  }

  // Never promote an unknown run into the Workflow Dock. A denied/old
  // run_mode lookup used to default to Workflow, which is exactly how Quick
  // Use Templates became briefly visible in this dock. A locally-started
  // Workflow is already authoritative and can remain visible while a rolling
  // database migration finishes.
  if (runMode === null) {
    return existingSession?.runId === run.id ? existingSession : null;
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

export const refreshWorkflowRun = async (runId: string): Promise<WorkflowSession | null> => {
  const state = getWorkflowState();
  // A background video may finish after the user has opened another template run.
  // Never let that callback replace the workflow currently shown in the dock.
  if (!state.session || state.session.runId !== runId) return state.session;

  const run = await fetchTemplateRun(runId);
  if (run.status !== 'started') {
    clearStoredWorkflow();
    return null;
  }
  const materials = await fetchReusableTemplateAssets(run.templateId, run.templateVersionId);
  const session = buildSessionFromRun(run, state.session, materials);
  const activeStep = run.steps.find((step) => step.stepOrder === run.currentStep)
    || run.steps.find((step) => step.status === 'active')
    || run.steps[0];
  if (!activeStep) return null;
  const engagedStep = state.engagedStepId === activeStep.stepId
    ? state.engagedStepId
    : null;
  persistWorkflow(session, activeStep.stepId, false, engagedStep);
  return session;
};

export const clearEngagedWorkflowStep = (runId: string, stepId: string): void => {
  const state = getWorkflowState();
  if (state.runId !== runId || state.engagedStepId !== stepId) return;
  sessionStorage.removeItem(ENGAGED_STEP_STORAGE_KEY);
  notifyWorkflowChanged();
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
