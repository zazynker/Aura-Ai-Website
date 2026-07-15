import { useState, useEffect } from 'react';

export interface WorkflowStep {
  id: string;
  stepNumber: number;
  feature: string;
  targetRoute: string;
  reusableMaterials: boolean;
  prompt: string;
  settings: Record<string, any>;
  result: {
    type: 'image' | 'video';
    url: string;
  };
}

export const MOCK_WORKFLOW_STEPS: WorkflowStep[] = [
  {
    id: 's1',
    stepNumber: 1,
    feature: 'Text to Image',
    targetRoute: '/modify',
    reusableMaterials: false,
    prompt: 'A modern minimalist product shot, clean background, soft studio lighting, high resolution.',
    settings: { style: 'Photorealistic', ratio: '1:1' },
    result: { type: 'image', url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80' }
  },
  {
    id: 's2',
    stepNumber: 2,
    feature: 'Replace Product',
    targetRoute: '/modify',
    reusableMaterials: true,
    prompt: 'Place the product on a sleek wooden table with subtle plant shadows.',
    settings: { preserveScale: true },
    result: { type: 'image', url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80' }
  },
  {
    id: 's3',
    stepNumber: 3,
    feature: 'Modify Image',
    targetRoute: '/modify',
    reusableMaterials: true,
    prompt: 'Make the lighting warmer and add a subtle lens flare.',
    settings: { strength: 0.5 },
    result: { type: 'image', url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80' }
  },
  {
    id: 's4',
    stepNumber: 4,
    feature: 'Image to Video',
    targetRoute: '/video',
    reusableMaterials: true,
    prompt: 'Smooth slow pan from left to right, cinematic depth of field.',
    settings: { motion: 'pan_right', duration: 4 },
    result: { type: 'video', url: 'https://www.w3schools.com/html/mov_bbb.mp4' }
  }
];

export const startWorkflow = () => {
  sessionStorage.setItem('lazora_active_workflow', JSON.stringify(MOCK_WORKFLOW_STEPS));
  sessionStorage.setItem('lazora_active_step', 's1');
  sessionStorage.setItem('lazora_workflow_minimized', 'false');
  window.dispatchEvent(new Event('workflow-changed'));
};

export const clearWorkflow = () => {
  sessionStorage.removeItem('lazora_active_workflow');
  sessionStorage.removeItem('lazora_active_step');
  sessionStorage.removeItem('lazora_workflow_minimized');
  window.dispatchEvent(new Event('workflow-changed'));
};

export const getWorkflowState = () => {
  try {
    const steps = JSON.parse(sessionStorage.getItem('lazora_active_workflow') || 'null');
    const activeStepId = sessionStorage.getItem('lazora_active_step') || null;
    const minimized = sessionStorage.getItem('lazora_workflow_minimized') === 'true';
    return { steps, activeStepId, minimized };
  } catch {
    return { steps: null, activeStepId: null, minimized: false };
  }
};

export const setActiveStep = (stepId: string) => {
  sessionStorage.setItem('lazora_active_step', stepId);
  window.dispatchEvent(new Event('workflow-changed'));
};

export const setWorkflowMinimized = (minimized: boolean) => {
  sessionStorage.setItem('lazora_workflow_minimized', String(minimized));
  window.dispatchEvent(new Event('workflow-changed'));
};

export const useWorkflowState = () => {
  const [state, setState] = useState(getWorkflowState());

  useEffect(() => {
    const handleUpdate = () => {
      setState(getWorkflowState());
    };
    window.addEventListener('workflow-changed', handleUpdate);
    return () => window.removeEventListener('workflow-changed', handleUpdate);
  }, []);

  return state;
};

