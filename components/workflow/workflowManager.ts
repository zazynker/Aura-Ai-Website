import { useEffect, useState } from 'react';
import { cancelTemplateRun, type TemplateRunStatus } from '../../utils/templateRunApi';

export interface WorkflowStep {
  id: string;
  runStepId: string;
  stepNumber: number;
  capability: string;
  feature: string;
  targetRoute: string;
  reusableMaterials: boolean;
  prompt: string;
  settings: Record<string, unknown>;
  result?: {
    type: 'image' | 'video';
    url: string;
    thumbnail?: string;
  };
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

const notifyWorkflowChanged = () => {
  window.dispatchEvent(new Event('workflow-changed'));
};

export const startWorkflow = (session: WorkflowSession) => {
  if (!session.runId || session.steps.length === 0) {
    throw new Error('The workflow run has no executable steps.');
  }
  sessionStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(session));
  sessionStorage.setItem(ACTIVE_STEP_STORAGE_KEY, session.steps[0].id);
  sessionStorage.setItem(MINIMIZED_STORAGE_KEY, 'false');
  notifyWorkflowChanged();
};

const clearStoredWorkflow = () => {
  sessionStorage.removeItem(WORKFLOW_STORAGE_KEY);
  sessionStorage.removeItem(ACTIVE_STEP_STORAGE_KEY);
  sessionStorage.removeItem(MINIMIZED_STORAGE_KEY);
  notifyWorkflowChanged();
};

export const getWorkflowState = (): StoredWorkflowState => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(WORKFLOW_STORAGE_KEY) || 'null');
    // Old UI-only builds stored a bare array of mock Unsplash steps. Ignore it
    // so a stale browser session can never masquerade as a real template run.
    const session = stored && !Array.isArray(stored) && stored.runId
      ? stored as WorkflowSession
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

export const setActiveStep = (stepId: string) => {
  sessionStorage.setItem(ACTIVE_STEP_STORAGE_KEY, stepId);
  notifyWorkflowChanged();
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

