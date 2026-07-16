import {
  CapabilityInputSlot,
  WorkflowCapabilityDefinition,
  WorkflowCapabilityKey,
} from './types';

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/m4a',
];

const IMAGE_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
];

const sourceImageInput = (
  key = 'source_image',
  label = 'Source image',
): CapabilityInputSlot => ({
  key,
  label,
  assetType: 'image' as const,
  required: true,
  maxCount: 1,
  acceptedMimeTypes: IMAGE_MIME_TYPES,
  allowedSources: ['user_upload', 'previous_step', 'template_asset'],
});

const outputCountParameter = {
  key: 'outputCount',
  label: 'Outputs',
  type: 'number' as const,
  required: true,
  editable: true,
  defaultValue: 1,
  min: 1,
  max: 4,
  step: 1,
};

export const WORKFLOW_CAPABILITIES: Record<
  WorkflowCapabilityKey,
  WorkflowCapabilityDefinition
> = {
  'image.text_to_image': {
    key: 'image.text_to_image',
    version: 1,
    displayName: 'Text to Image',
    description: 'Create an image from a prompt and optional references.',
    editorTarget: {
      route: '/modify',
      editor: 'modify',
      featureKey: 'text2img',
    },
    inputs: [
      {
        key: 'reference_images',
        label: 'Reference images',
        assetType: 'image',
        required: false,
        maxCount: 3,
        acceptedMimeTypes: IMAGE_MIME_TYPES,
        allowedSources: ['user_upload', 'previous_step', 'template_asset'],
      },
    ],
    parameters: [
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'string',
        required: true,
        editable: true,
        defaultValue: '',
        maxLength: 2000,
      },
      {
        key: 'ratio',
        label: 'Aspect ratio',
        type: 'enum',
        required: true,
        editable: true,
        defaultValue: '1:1',
        enumValues: IMAGE_RATIOS,
      },
      {
        key: 'resolution',
        label: 'Resolution',
        type: 'enum',
        required: true,
        editable: true,
        defaultValue: '1K',
        enumValues: ['1K', '2K', '4K'],
      },
      outputCountParameter,
    ],
    output: {
      key: 'generated_image',
      assetType: 'image',
      allowUserSelection: true,
    },
    enabledForTemplates: true,
  },

  'image.replace_product': {
    key: 'image.replace_product',
    version: 1,
    displayName: 'Replace Product',
    description: 'Place a user product into an existing scene.',
    editorTarget: {
      route: '/modify',
      editor: 'modify',
      featureKey: 'replace',
    },
    inputs: [
      sourceImageInput('scene_image', 'Scene image'),
      {
        ...sourceImageInput('product_image', 'Product image'),
        allowedSources: ['user_upload', 'previous_step'],
      },
    ],
    parameters: [
      {
        key: 'prompt',
        label: 'Product description',
        type: 'string',
        required: false,
        editable: true,
        defaultValue: '',
        maxLength: 2000,
      },
      {
        key: 'extraBlend',
        label: 'Blend lighting and color',
        type: 'boolean',
        required: true,
        editable: true,
        defaultValue: true,
      },
      {
        key: 'productSizePercent',
        label: 'Product size',
        type: 'number',
        required: false,
        editable: true,
        defaultValue: 100,
        min: 10,
        max: 300,
        step: 5,
      },
      outputCountParameter,
    ],
    output: {
      key: 'generated_image',
      assetType: 'image',
      allowUserSelection: true,
    },
    enabledForTemplates: true,
  },

  'image.modify': {
    key: 'image.modify',
    version: 1,
    displayName: 'Modify Image',
    description: 'Edit an image using a prompt and optional style reference.',
    editorTarget: {
      route: '/modify',
      editor: 'modify',
      featureKey: 'modify',
    },
    inputs: [
      sourceImageInput(),
      {
        key: 'reference_image',
        label: 'Style reference',
        assetType: 'image',
        required: false,
        maxCount: 1,
        acceptedMimeTypes: IMAGE_MIME_TYPES,
        allowedSources: ['user_upload', 'previous_step', 'template_asset'],
      },
    ],
    parameters: [
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'string',
        required: true,
        editable: true,
        defaultValue: '',
        maxLength: 2000,
      },
      outputCountParameter,
    ],
    output: {
      key: 'generated_image',
      assetType: 'image',
      allowUserSelection: true,
    },
    enabledForTemplates: true,
  },

  'image.change_ratio': {
    key: 'image.change_ratio',
    version: 1,
    displayName: 'Change Ratio',
    description: 'Extend an image to a new aspect ratio.',
    editorTarget: {
      route: '/modify',
      editor: 'modify',
      featureKey: 'ratio',
    },
    inputs: [sourceImageInput()],
    parameters: [
      {
        key: 'ratio',
        label: 'Aspect ratio',
        type: 'enum',
        required: true,
        editable: true,
        defaultValue: '1:1',
        enumValues: ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'],
      },
      {
        key: 'prompt',
        label: 'Expanded area description',
        type: 'string',
        required: false,
        editable: true,
        defaultValue: '',
        maxLength: 2000,
      },
      outputCountParameter,
    ],
    output: {
      key: 'generated_image',
      assetType: 'image',
      allowUserSelection: true,
    },
    enabledForTemplates: true,
  },

  'image.enhance': {
    key: 'image.enhance',
    version: 1,
    displayName: 'Enhance Image',
    description: 'Improve image quality, lighting, and color.',
    editorTarget: {
      route: '/modify',
      editor: 'modify',
      featureKey: 'enhance',
    },
    inputs: [sourceImageInput()],
    parameters: [outputCountParameter],
    output: {
      key: 'generated_image',
      assetType: 'image',
      allowUserSelection: true,
    },
    enabledForTemplates: true,
  },

  'image.upscale': {
    key: 'image.upscale',
    version: 1,
    displayName: 'Upscale Image',
    description: 'Increase image resolution while preserving composition.',
    editorTarget: {
      route: '/modify',
      editor: 'modify',
      featureKey: 'upscale',
    },
    inputs: [sourceImageInput()],
    parameters: [
      {
        key: 'resolution',
        label: 'Resolution',
        type: 'enum',
        required: true,
        editable: true,
        defaultValue: '2K',
        enumValues: ['1K', '2K', '4K'],
      },
    ],
    output: {
      key: 'generated_image',
      assetType: 'image',
    },
    enabledForTemplates: true,
  },

  'video.image_to_video': {
    key: 'video.image_to_video',
    version: 1,
    displayName: 'Image to Video',
    description: 'Animate a first frame with an optional end frame.',
    editorTarget: {
      route: '/video',
      editor: 'video',
      featureKey: 'image-to-video',
    },
    inputs: [
      sourceImageInput('start_image', 'First frame'),
      {
        ...sourceImageInput('end_image', 'End frame'),
        required: false,
      },
    ],
    parameters: [
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'string',
        required: false,
        editable: true,
        defaultValue: '',
        maxLength: 2000,
      },
      {
        key: 'duration',
        label: 'Duration',
        type: 'number',
        required: true,
        editable: true,
        defaultValue: 3,
        min: 3,
        max: 15,
        step: 1,
      },
      {
        key: 'resolution',
        label: 'Resolution',
        type: 'enum',
        required: true,
        editable: true,
        defaultValue: '720p',
        enumValues: ['720p', '1080p'],
      },
      {
        key: 'generateAudio',
        label: 'Generate audio',
        type: 'boolean',
        required: true,
        editable: true,
        defaultValue: true,
      },
      {
        key: 'outputCount',
        label: 'Outputs',
        type: 'number',
        required: true,
        editable: false,
        defaultValue: 1,
        min: 1,
        max: 1,
      },
    ],
    output: {
      key: 'generated_video',
      assetType: 'video',
    },
    enabledForTemplates: true,
  },

  'video.motion_control': {
    key: 'video.motion_control',
    version: 1,
    displayName: 'Motion Control',
    description: 'Transfer motion from a driver video to a character image.',
    editorTarget: {
      route: '/video',
      editor: 'video',
      featureKey: 'motion-control',
    },
    inputs: [
      sourceImageInput('character_image', 'Character image'),
      {
        key: 'driver_video',
        label: 'Driver video',
        assetType: 'video',
        required: true,
        maxCount: 1,
        acceptedMimeTypes: VIDEO_MIME_TYPES,
        allowedSources: ['user_upload', 'previous_step', 'template_asset'],
      },
    ],
    parameters: [
      {
        key: 'prompt',
        label: 'Motion prompt',
        type: 'string',
        required: true,
        editable: true,
        defaultValue: '',
        maxLength: 2000,
      },
      {
        key: 'characterOrientation',
        label: 'Character orientation matches',
        type: 'enum',
        required: true,
        editable: true,
        defaultValue: 'video',
        enumValues: ['video', 'image'],
      },
      {
        key: 'resolution',
        label: 'Resolution',
        type: 'enum',
        required: true,
        editable: true,
        defaultValue: '720p',
        enumValues: ['720p', '1080p'],
      },
      {
        key: 'duration',
        label: 'Duration',
        type: 'number',
        required: true,
        editable: false,
        defaultValue: 5,
        min: 5,
        max: 5,
      },
      {
        key: 'outputCount',
        label: 'Outputs',
        type: 'number',
        required: true,
        editable: false,
        defaultValue: 1,
        min: 1,
        max: 1,
      },
    ],
    output: {
      key: 'generated_video',
      assetType: 'video',
    },
    enabledForTemplates: true,
  },

  'video.lip_sync_image': {
    key: 'video.lip_sync_image',
    version: 1,
    displayName: 'Image Lip Sync',
    description: 'Animate a single-person image using uploaded audio.',
    editorTarget: {
      route: '/video',
      editor: 'video',
      featureKey: 'lip-sync',
      submode: 'image',
    },
    inputs: [
      sourceImageInput('portrait_image', 'Single-person image'),
      {
        key: 'audio',
        label: 'Audio',
        assetType: 'audio',
        required: true,
        maxCount: 1,
        acceptedMimeTypes: AUDIO_MIME_TYPES,
        allowedSources: ['user_upload', 'previous_step', 'template_asset'],
      },
    ],
    parameters: [
      {
        key: 'prompt',
        label: 'Character performance prompt',
        type: 'string',
        required: false,
        editable: true,
        defaultValue: '',
        maxLength: 2000,
      },
    ],
    output: {
      key: 'generated_video',
      assetType: 'video',
    },
    enabledForTemplates: true,
  },

  'video.lip_sync_video': {
    key: 'video.lip_sync_video',
    version: 1,
    displayName: 'Video Lip Sync',
    description: 'Apply uploaded audio to a single-person video.',
    editorTarget: {
      route: '/video',
      editor: 'video',
      featureKey: 'lip-sync',
      submode: 'video',
    },
    inputs: [
      {
        key: 'source_video',
        label: 'Single-person video',
        assetType: 'video',
        required: true,
        maxCount: 1,
        acceptedMimeTypes: VIDEO_MIME_TYPES,
        allowedSources: ['user_upload', 'previous_step', 'template_asset'],
      },
      {
        key: 'audio',
        label: 'Audio',
        assetType: 'audio',
        required: true,
        maxCount: 1,
        acceptedMimeTypes: AUDIO_MIME_TYPES,
        allowedSources: ['user_upload', 'previous_step', 'template_asset'],
      },
    ],
    parameters: [],
    output: {
      key: 'generated_video',
      assetType: 'video',
    },
    enabledForTemplates: true,
  },
};

export function getWorkflowCapability(
  key: WorkflowCapabilityKey,
): WorkflowCapabilityDefinition {
  return WORKFLOW_CAPABILITIES[key];
}

export function listTemplateCapabilities(): WorkflowCapabilityDefinition[] {
  return Object.values(WORKFLOW_CAPABILITIES).filter(
    (capability) => capability.enabledForTemplates,
  );
}