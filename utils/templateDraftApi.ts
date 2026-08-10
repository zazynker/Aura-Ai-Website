import type { WorkflowDefinition } from '../workflows/types';
import type { QuickUseDefinition } from '../workflows/quickUseTypes';
import { QUICK_USE_EXAMPLE_ASSET_KEY_PREFIX } from '../workflows/quickUseCandidates';
import { validateQuickUseDefinition } from '../workflows/quickUseValidators';
import {
  convertAndValidateBuilderWorkflow,
  type BuilderDraftStep,
  type BuilderFeatureType,
  type BuilderMaterial,
} from '../workflows/builderAdapter';
import { supabase } from './supabase';
import {
  TEMPLATE_ASSETS_BUCKET,
  TEMPLATE_PREVIEWS_BUCKET,
  removeTemplateStorageObjects,
  uploadTemplateCover,
  uploadTemplateMaterial,
  uploadTemplateVideoWithPoster,
  type TemplateStorageIdentity,
  type UploadedTemplateCover,
  type UploadedTemplateObject,
} from './templateStorage';

export interface TemplateDraftIdentity extends TemplateStorageIdentity {
  versionNumber: number;
}

export type PersistedMaterialMap = Record<string, UploadedTemplateObject>;
export type PersistedResultMap = Record<string, UploadedTemplateObject>;
export type PersistedResultPosterMap = Record<string, UploadedTemplateObject>;
export type PersistedQuickUseExampleMap = Record<string, UploadedTemplateObject>;

export interface SaveTemplateDraftInput {
  identity?: TemplateDraftIdentity | null;
  userId: string;
  title: string;
  description: string;
  workflow: WorkflowDefinition;
  steps: BuilderDraftStep[];
  finalResultUrl: string | null;
  finalResultType: 'image' | 'video' | null;
  isFinalResultManual: boolean;
  finalResultFile: File | null;
  persistedFinalResult: UploadedTemplateObject | null;
  persistedFinalResultPoster: UploadedTemplateObject | null;
  coverFile: File | null;
  coverVideoStartSeconds: number;
  persistedCover: UploadedTemplateCover | null;
  resultFiles: Record<string, File>;
  persistedResults: PersistedResultMap;
  persistedResultPosters: PersistedResultPosterMap;
  materialFiles: Record<string, File>;
  persistedMaterials: PersistedMaterialMap;
  quickUseDefinition?: QuickUseDefinition | null;
  quickUseExampleFiles?: Record<string, File>;
  persistedQuickUseExamples?: PersistedQuickUseExampleMap;
}

export interface SaveTemplateDraftResult {
  identity: TemplateDraftIdentity;
  cover: UploadedTemplateCover | null;
  finalResult: UploadedTemplateObject | null;
  finalResultPoster: UploadedTemplateObject | null;
  results: PersistedResultMap;
  resultPosters: PersistedResultPosterMap;
  materials: PersistedMaterialMap;
  materialAssetIds: Record<string, string>;
  quickUseDefinition: QuickUseDefinition | null;
  quickUseExamples: PersistedQuickUseExampleMap;
}

export interface SubmitTemplateForReviewResult {
  templateId: string;
  versionId: string;
  status: 'pending_review';
  submittedAt: string;
}

export interface LoadTemplateDraftResult {
  identity: TemplateDraftIdentity;
  title: string;
  description: string;
  steps: BuilderDraftStep[];
  finalResultUrl: string | null;
  finalResultType: 'image' | 'video' | null;
  isFinalResultManual: boolean;
  finalResult: UploadedTemplateObject | null;
  finalResultPoster: UploadedTemplateObject | null;
  cover: UploadedTemplateCover | null;
  coverUrl: string | null;
  coverType: 'image' | 'video' | null;
  results: PersistedResultMap;
  resultPosters: PersistedResultPosterMap;
  materials: PersistedMaterialMap;
  quickUseDefinition: QuickUseDefinition | null;
  quickUseExamples: PersistedQuickUseExampleMap;
  quickUseExampleUrls: Record<string, string>;
}

interface ExistingAssetRow {
  id: string;
  asset_key: string;
  storage_bucket: string | null;
  storage_path: string | null;
}

interface AssetInsertRow {
  template_id: string;
  version_id: string;
  owner_id: string;
  asset_key: string;
  asset_type: 'image' | 'video' | 'audio';
  source_kind: 'upload' | 'generation';
  generation_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  public_url: string | null;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  sort_order: number;
  is_reusable: boolean;
}

interface SavedAssetRow {
  id: string;
  asset_key: string;
  asset_type: 'image' | 'video' | 'audio';
  source_kind: 'upload' | 'generation';
  generation_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  public_url: string | null;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  is_reusable: boolean;
}

const CAPABILITY_TO_FEATURE: Record<string, BuilderFeatureType> = {
  'image.text_to_image': 'Image Generation',
  'image.replace_product': 'Replace Product',
  'image.modify': 'Modify Image',
  'video.image_to_video': 'Image to Video',
  'video.motion_control': 'Motion Control',
  'video.lip_sync_image': 'Image Lip Sync',
  'video.lip_sync_video': 'Video Lip Sync',
};

const DEFAULT_MATERIAL_TYPES: Record<BuilderFeatureType, BuilderMaterial['type'][]> = {
  'Image Generation': ['Image'],
  'Replace Product': ['Image', 'Image'],
  'Modify Image': ['Image'],
  'Image to Video': ['Image'],
  'Motion Control': ['Image', 'Video'],
  'Image Lip Sync': ['Image', 'Audio'],
  'Video Lip Sync': ['Video', 'Audio'],
};

const VIDEO_FEATURES = new Set<BuilderFeatureType>([
  'Image to Video',
  'Motion Control',
  'Image Lip Sync',
  'Video Lip Sync',
]);

interface QuickUseMediaExampleBinding {
  assetKey: string;
  assetType: 'image' | 'video' | 'audio';
}

function assertValidQuickUseDefinitionForWorkflow(
  workflow: WorkflowDefinition,
  definition: QuickUseDefinition | null | undefined,
): void {
  if (definition === null || definition === undefined) return;
  const validation = validateQuickUseDefinition(workflow, definition);
  if (!validation.valid) {
    throw new Error(
      validation.issues[0]?.message || 'The Quick Use definition is invalid.',
    );
  }
}

function getQuickUseMediaExamples(
  definition: QuickUseDefinition | null | undefined,
): QuickUseMediaExampleBinding[] {
  if (!definition) return [];
  return definition.blocks.flatMap((block) => (
    block.example?.kind === 'media'
      ? [{
          assetKey: block.example.assetKey,
          assetType: block.example.assetType,
        }]
      : []
  ));
}

const readNumberParameter = (
  parameters: Record<string, unknown>,
  key: string,
  fallback: number,
): number => {
  const value = parameters[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

function newUuid(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('This browser cannot create a secure draft identifier.');
  }
  return globalThis.crypto.randomUUID();
}

function createIdentity(userId: string): TemplateDraftIdentity {
  return {
    userId,
    templateId: newUuid(),
    versionId: newUuid(),
    versionNumber: 1,
  };
}

function slugify(title: string, templateId: string): string {
  const base = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'workflow-template';
  return `${base}-${templateId.slice(0, 8)}`;
}

function inferTemplateKind(
  workflow: WorkflowDefinition,
): 'workflow_image' | 'workflow_video' | 'workflow_mixed' {
  const outputTypes = new Set(workflow.steps.map((step) => step.output.assetType));
  if (outputTypes.has('image') && outputTypes.has('video')) return 'workflow_mixed';
  if (outputTypes.has('video')) return 'workflow_video';
  return 'workflow_image';
}

function uploadRow(
  identity: TemplateDraftIdentity,
  userId: string,
  assetKey: string,
  assetType: 'image' | 'video' | 'audio',
  object: UploadedTemplateObject,
  sortOrder: number,
  isReusable: boolean,
): AssetInsertRow {
  return {
    template_id: identity.templateId,
    version_id: identity.versionId,
    owner_id: userId,
    asset_key: assetKey,
    asset_type: assetType,
    source_kind: 'upload',
    generation_id: null,
    storage_bucket: object.bucket,
    storage_path: object.path,
    public_url: object.publicUrl,
    mime_type: object.mimeType,
    byte_size: object.byteSize,
    width: object.width,
    height: object.height,
    duration_seconds: object.durationSeconds,
    sort_order: sortOrder,
    is_reusable: isReusable,
  };
}

function generationRow(
  identity: TemplateDraftIdentity,
  userId: string,
  assetKey: string,
  assetType: 'image' | 'video' | 'audio',
  generationId: string,
  url: string,
  sortOrder: number,
  isReusable: boolean,
): AssetInsertRow {
  return {
    template_id: identity.templateId,
    version_id: identity.versionId,
    owner_id: userId,
    asset_key: assetKey,
    asset_type: assetType,
    source_kind: 'generation',
    generation_id: generationId,
    storage_bucket: null,
    storage_path: null,
    public_url: url,
    mime_type: null,
    byte_size: null,
    width: null,
    height: null,
    duration_seconds: null,
    sort_order: sortOrder,
    is_reusable: isReusable,
  };
}

async function ensureDraftRows(
  identity: TemplateDraftIdentity,
  input: SaveTemplateDraftInput,
): Promise<void> {
  const name = input.title.trim() || 'Untitled workflow template';
  const durableFinalResultUrl = input.finalResultUrl?.startsWith('blob:')
    ? ''
    : input.finalResultUrl || '';
  const templatePayload = {
    name,
    display_name: name,
    image_url: durableFinalResultUrl,
    category: 'Workflow',
    tags: [],
    is_pro: false,
    prompt_template: input.workflow.steps[0]?.instruction || null,
    creator_id: input.userId,
    slug: slugify(name, identity.templateId),
    description: input.description.trim() || null,
    template_kind: inferTemplateKind(input.workflow),
    updated_at: new Date().toISOString(),
  };

  if (!input.identity) {
    const { error } = await supabase.from('templates').insert({
      id: identity.templateId,
      ...templatePayload,
      status: 'draft',
      cover_type: 'image',
      cover_url: null,
      preview_url: durableFinalResultUrl || null,
    });
    if (error) throw new Error(`Could not create the draft: ${error.message}`);
  } else {
    const { error } = await supabase
      .from('templates')
      .update({ updated_at: templatePayload.updated_at })
      .eq('id', identity.templateId);
    if (error) throw new Error(`Could not update the draft: ${error.message}`);

    const { error: fallbackError } = await supabase
      .from('templates')
      // Saving an editable version must not withdraw the version that is
      // already in review. The versioned submit RPC is the only operation
      // allowed to replace submitted_version_id or change review state.
      .update(templatePayload)
      .eq('id', identity.templateId)
      .is('current_version_id', null);
    if (fallbackError) throw new Error(`Could not update draft metadata: ${fallbackError.message}`);
  }

  const mutableVersionPayload: Record<string, unknown> = {
    schema_version: input.workflow.schemaVersion,
    workflow: input.workflow,
    change_summary: 'Builder draft save',
    version_status: 'draft',
    name,
    display_name: name,
    description: input.description.trim() || null,
    image_url: durableFinalResultUrl,
    updated_at: new Date().toISOString(),
  };
  if (input.quickUseDefinition !== undefined) {
    mutableVersionPayload.quick_use_definition = input.quickUseDefinition;
  }

  if (!input.identity) {
    const { error: versionError } = await supabase.from('template_versions').insert({
      id: identity.versionId,
      template_id: identity.templateId,
      version_number: identity.versionNumber,
      created_by: input.userId,
      ...mutableVersionPayload,
    });
    if (versionError) {
      throw new Error(`Could not create the workflow version: ${versionError.message}`);
    }
  } else {
    // open_template_edit_draft already created and linked this immutable-ID
    // draft. UPDATE it directly: an UPSERT first exercises the INSERT RLS
    // policy even when the conflict ultimately updates the existing row.
    const { data: updatedVersion, error: versionError } = await supabase
      .from('template_versions')
      .update(mutableVersionPayload)
      .eq('id', identity.versionId)
      .eq('template_id', identity.templateId)
      .eq('created_by', input.userId)
      .select('id')
      .maybeSingle();
    if (versionError) {
      throw new Error(`Could not save the workflow version: ${versionError.message}`);
    }
    if (!updatedVersion) {
      throw new Error('This workflow version is no longer the editable draft. Refresh Dashboard and open it again.');
    }
  }

  const { error: linkError } = await supabase
    .from('templates')
    .update({ draft_version_id: identity.versionId })
    .eq('id', identity.templateId);
  if (linkError) throw new Error(`Could not link the workflow version: ${linkError.message}`);
}

async function replaceAssetRows(
  identity: TemplateDraftIdentity,
  rows: AssetInsertRow[],
  preservedAssetKeys = new Set<string>(),
  preserveAllQuickUseExamples = false,
): Promise<{ previous: ExistingAssetRow[]; current: SavedAssetRow[] }> {
  const { data: previous, error: readError } = await supabase
    .from('template_assets')
    .select('id,asset_key,storage_bucket,storage_path')
    .eq('template_id', identity.templateId)
    .eq('version_id', identity.versionId);
  if (readError) throw new Error(`Could not read existing draft assets: ${readError.message}`);

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from('template_assets')
      .upsert(rows, { onConflict: 'template_id,version_id,asset_key' });
    if (upsertError) throw new Error(`Could not save draft assets: ${upsertError.message}`);
  }

  const activeKeys = new Set(rows.map((row) => row.asset_key));
  const stale = (previous || []).filter(
    (row) => (
      !activeKeys.has(row.asset_key)
      && !preservedAssetKeys.has(row.asset_key)
      && !(
        preserveAllQuickUseExamples
        && row.asset_key.startsWith(QUICK_USE_EXAMPLE_ASSET_KEY_PREFIX)
      )
    ),
  );
  if (stale.length > 0) {
    const { error: deleteError } = await supabase
      .from('template_assets')
      .delete()
      .in('id', stale.map((row) => row.id));
    if (deleteError) throw new Error(`Could not remove stale asset records: ${deleteError.message}`);
  }
  const { data: current, error: currentError } = await supabase
    .from('template_assets')
    .select('id,asset_key,asset_type,source_kind,generation_id,storage_bucket,storage_path,public_url,mime_type,byte_size,width,height,duration_seconds,is_reusable')
    .eq('template_id', identity.templateId)
    .eq('version_id', identity.versionId);
  if (currentError) throw new Error(`Could not verify saved draft assets: ${currentError.message}`);
  return {
    previous: (previous || []) as ExistingAssetRow[],
    current: (current || []) as SavedAssetRow[],
  };
}

async function cleanReplacedObjects(
  previous: ExistingAssetRow[],
  rows: AssetInsertRow[],
): Promise<void> {
  const current = new Set(
    rows
      .filter((row) => row.storage_bucket && row.storage_path)
      .map((row) => `${row.storage_bucket}:${row.storage_path}`),
  );
  const previewPaths: string[] = [];
  const assetPaths: string[] = [];
  for (const row of previous) {
    if (!row.storage_bucket || !row.storage_path) continue;
    if (current.has(`${row.storage_bucket}:${row.storage_path}`)) continue;
    const { count, error } = await supabase
      .from('template_assets')
      .select('id', { count: 'exact', head: true })
      .eq('storage_bucket', row.storage_bucket)
      .eq('storage_path', row.storage_path);
    if (error || Number(count || 0) > 0) continue;
    if (row.storage_bucket === TEMPLATE_PREVIEWS_BUCKET) previewPaths.push(row.storage_path);
    if (row.storage_bucket === TEMPLATE_ASSETS_BUCKET) assetPaths.push(row.storage_path);
  }
  await Promise.all([
    removeTemplateStorageObjects(TEMPLATE_PREVIEWS_BUCKET, previewPaths),
    removeTemplateStorageObjects(TEMPLATE_ASSETS_BUCKET, assetPaths),
  ]);
}

export async function saveTemplateDraft(
  input: SaveTemplateDraftInput,
): Promise<SaveTemplateDraftResult> {
  const identity = input.identity ?? createIdentity(input.userId);
  if (identity.userId !== input.userId) {
    throw new Error('This draft belongs to a different account.');
  }

  assertValidQuickUseDefinitionForWorkflow(input.workflow, input.quickUseDefinition);

  await ensureDraftRows(identity, input);

  let cover = input.persistedCover;
  let finalResultUpload = input.isFinalResultManual ? input.persistedFinalResult : null;
  let finalResultPosterUpload = input.isFinalResultManual
    ? input.persistedFinalResultPoster
    : null;
  const resultUploads: PersistedResultMap = { ...input.persistedResults };
  const resultPosterUploads: PersistedResultPosterMap = { ...input.persistedResultPosters };
  const materialUploads: PersistedMaterialMap = { ...input.persistedMaterials };
  const quickUseExampleUploads: PersistedQuickUseExampleMap = {
    ...(input.persistedQuickUseExamples || {}),
  };
  const quickUseMediaExamples = getQuickUseMediaExamples(input.quickUseDefinition);
  const newlyUploaded: Array<{ bucket: string; path: string }> = [];
  let assetPersistenceStarted = false;

  try {
    if (input.coverFile) {
      cover = await uploadTemplateCover(
        identity,
        input.coverFile,
        input.coverVideoStartSeconds,
      );
      newlyUploaded.push(
        { bucket: cover.original.bucket, path: cover.original.path },
        { bucket: cover.thumbnail.bucket, path: cover.thumbnail.path },
      );
    }

    if (input.isFinalResultManual && input.finalResultFile) {
      const assetType = input.finalResultFile.type.startsWith('video/') ? 'video' : 'image';
      if (assetType === 'video') {
        const uploaded = await uploadTemplateVideoWithPoster(
          identity,
          input.finalResultFile,
          'final-result',
        );
        finalResultUpload = uploaded.original;
        finalResultPosterUpload = uploaded.poster;
        newlyUploaded.push(
          { bucket: uploaded.original.bucket, path: uploaded.original.path },
          { bucket: uploaded.poster.bucket, path: uploaded.poster.path },
        );
      } else {
        finalResultUpload = await uploadTemplateMaterial(
          identity,
          input.finalResultFile,
          'image',
          'final-result',
        );
        finalResultPosterUpload = null;
        newlyUploaded.push({
          bucket: finalResultUpload.bucket,
          path: finalResultUpload.path,
        });
      }
    }

    for (const step of input.steps) {
      const file = input.resultFiles[step.id];
      if (!file || step.resultGenerationId) continue;
      const assetType = file.type.startsWith('video/') ? 'video' : 'image';
      if (assetType === 'video') {
        const uploaded = await uploadTemplateVideoWithPoster(
          identity,
          file,
          `${step.id}-result`,
        );
        resultUploads[step.id] = uploaded.original;
        resultPosterUploads[step.id] = uploaded.poster;
        newlyUploaded.push(
          { bucket: uploaded.original.bucket, path: uploaded.original.path },
          { bucket: uploaded.poster.bucket, path: uploaded.poster.path },
        );
      } else {
        const uploaded = await uploadTemplateMaterial(
          identity,
          file,
          assetType,
          `${step.id}-result`,
        );
        resultUploads[step.id] = uploaded;
        delete resultPosterUploads[step.id];
        newlyUploaded.push({ bucket: uploaded.bucket, path: uploaded.path });
      }
    }

    for (const example of quickUseMediaExamples) {
      const file = input.quickUseExampleFiles?.[example.assetKey];
      if (!file) continue;
      const uploaded = await uploadTemplateMaterial(
        identity,
        file,
        example.assetType,
        example.assetKey,
      );
      quickUseExampleUploads[example.assetKey] = uploaded;
      newlyUploaded.push({ bucket: uploaded.bucket, path: uploaded.path });
    }

    for (const step of input.steps) {
      for (const material of step.materials) {
        const file = input.materialFiles[material.id];
        if (!file || material.sourceGenerationId) continue;
        const uploaded = await uploadTemplateMaterial(
          identity,
          file,
          material.type.toLowerCase() as 'image' | 'video' | 'audio',
          `${step.id}-${material.id}`,
        );
        materialUploads[material.id] = uploaded;
        newlyUploaded.push({ bucket: uploaded.bucket, path: uploaded.path });
      }
    }

    const rows: AssetInsertRow[] = [];
    const materialAssetKeys: Record<string, string> = {};
    let sortOrder = 0;
    if (cover) {
      rows.push(
        uploadRow(
          identity,
          input.userId,
          'cover-original',
          cover.coverType,
          cover.original,
          sortOrder++,
          false,
        ),
        uploadRow(
          identity,
          input.userId,
          'cover-thumbnail',
          'image',
          cover.thumbnail,
          sortOrder++,
          false,
        ),
      );
    }
    if (input.isFinalResultManual && finalResultUpload) {
      const finalAssetType = input.finalResultType
        || (finalResultUpload.mimeType.startsWith('video/') ? 'video' : 'image');
      rows.push(
        uploadRow(
          identity,
          input.userId,
          'final-result',
          finalAssetType,
          finalResultUpload,
          sortOrder++,
          false,
        ),
      );
      if (finalAssetType === 'video' && finalResultPosterUpload) {
        rows.push(
          uploadRow(
            identity,
            input.userId,
            'final-result-thumbnail',
            'image',
            finalResultPosterUpload,
            sortOrder++,
            false,
          ),
        );
      }
    }

    input.steps.forEach((step, stepIndex) => {
      if (step.resultGenerationId && step.resultUrl) {
        rows.push(
          generationRow(
            identity,
            input.userId,
            `step-${stepIndex + 1}-result`,
            step.resultType || (VIDEO_FEATURES.has(step.feature) ? 'video' : 'image'),
            step.resultGenerationId,
            step.resultUrl,
            sortOrder++,
            false,
          ),
        );
        if (step.resultType === 'video' && step.resultThumbnailUrl) {
          rows.push(
            generationRow(
              identity,
              input.userId,
              `step-${stepIndex + 1}-result-thumbnail`,
              'image',
              step.resultGenerationId,
              step.resultThumbnailUrl,
              sortOrder++,
              false,
            ),
          );
        }
      } else if (step.resultUrl && resultUploads[step.id]) {
        const uploaded = resultUploads[step.id];
        rows.push(
          uploadRow(
            identity,
            input.userId,
            `step-${stepIndex + 1}-result`,
            step.resultType || (uploaded.mimeType.startsWith('video/') ? 'video' : 'image'),
            uploaded,
            sortOrder++,
            false,
          ),
        );
        const poster = resultPosterUploads[step.id];
        if ((step.resultType === 'video' || uploaded.mimeType.startsWith('video/')) && poster) {
          rows.push(
            uploadRow(
              identity,
              input.userId,
              `step-${stepIndex + 1}-result-thumbnail`,
              'image',
              poster,
              sortOrder++,
              false,
            ),
          );
        }
      }

      step.materials.forEach((material, materialIndex) => {
        const key = `step-${stepIndex + 1}-material-${materialIndex + 1}`;
        materialAssetKeys[material.id] = key;
        const assetType = material.type.toLowerCase() as 'image' | 'video' | 'audio';
        if (material.sourceGenerationId && material.url) {
          rows.push(
            generationRow(
              identity,
              input.userId,
              key,
              assetType,
              material.sourceGenerationId,
              material.url,
              sortOrder++,
              material.allowDownload,
            ),
          );
          return;
        }
        const uploaded = materialUploads[material.id];
        if (uploaded) {
          rows.push(
            uploadRow(
              identity,
              input.userId,
              key,
              assetType,
              uploaded,
              sortOrder++,
              material.allowDownload,
            ),
          );
        }
      });
    });

    for (const example of quickUseMediaExamples) {
      const uploaded = quickUseExampleUploads[example.assetKey];
      if (!uploaded) continue;
      rows.push(
        uploadRow(
          identity,
          input.userId,
          example.assetKey,
          example.assetType,
          uploaded,
          sortOrder++,
          false,
        ),
      );
    }

    assetPersistenceStarted = true;
    const preservedQuickUseExampleKeys = new Set(
      quickUseMediaExamples.map((example) => example.assetKey),
    );
    const { previous, current } = await replaceAssetRows(
      identity,
      rows,
      preservedQuickUseExampleKeys,
      input.quickUseDefinition === undefined,
    );
    const currentAssetKeys = new Set(current.map((asset) => asset.asset_key));
    for (const example of quickUseMediaExamples) {
      if (!currentAssetKeys.has(example.assetKey)) {
        throw new Error(`Quick Use example asset is missing: ${example.assetKey}.`);
      }
    }
    const assetIdByKey = Object.fromEntries(
      current.map((asset) => [asset.asset_key, asset.id]),
    );
    const materialAssetIds: Record<string, string> = {};
    for (const [materialId, assetKey] of Object.entries(materialAssetKeys)) {
      const assetId = assetIdByKey[assetKey];
      if (assetId) materialAssetIds[materialId] = assetId;
    }
    const boundSteps = input.steps.map((step) => ({
      ...step,
      materials: step.materials.map((material) => ({
        ...material,
        templateAssetId: materialAssetIds[material.id],
      })),
    }));
    const boundWorkflow = convertAndValidateBuilderWorkflow(boundSteps);
    if (!boundWorkflow.validation.valid) {
      throw new Error(
        boundWorkflow.validation.issues[0]?.message ||
        'Saved assets could not be linked to the workflow.',
      );
    }
    assertValidQuickUseDefinitionForWorkflow(
      boundWorkflow.workflow,
      input.quickUseDefinition,
    );
    const versionLinkPayload: Record<string, unknown> = {
      workflow: boundWorkflow.workflow,
    };
    if (input.quickUseDefinition !== undefined) {
      versionLinkPayload.quick_use_definition = input.quickUseDefinition;
    }
    const { data: savedVersion, error: workflowLinkError } = await supabase
      .from('template_versions')
      .update(versionLinkPayload)
      .eq('id', identity.versionId)
      .select('quick_use_definition')
      .single();
    if (workflowLinkError) {
      throw new Error(`Could not link saved assets to the workflow: ${workflowLinkError.message}`);
    }
    const savedQuickUseDefinition = savedVersion.quick_use_definition == null
      ? null
      : savedVersion.quick_use_definition as QuickUseDefinition;
    assertValidQuickUseDefinitionForWorkflow(
      boundWorkflow.workflow,
      savedQuickUseDefinition,
    );

    if (cover) {
      const coverMetadata = {
        image_url: cover.thumbnail.publicUrl || cover.original.publicUrl || input.finalResultUrl || '',
        thumb_url: cover.thumbnail.publicUrl,
        cover_type: cover.coverType,
        cover_url: cover.original.publicUrl,
        preview_url: cover.original.publicUrl,
      };
      const { error: versionCoverError } = await supabase
        .from('template_versions')
        .update(coverMetadata)
        .eq('id', identity.versionId);
      if (versionCoverError) {
        throw new Error(`Could not save version cover metadata: ${versionCoverError.message}`);
      }
      const { error: coverError } = await supabase
        .from('templates')
        .update({
          ...coverMetadata,
          width: cover.thumbnail.width || cover.original.width,
          height: cover.thumbnail.height || cover.original.height,
        })
        .eq('id', identity.templateId)
        .is('current_version_id', null);
      if (coverError) throw new Error(`Could not save the cover metadata: ${coverError.message}`);
    }

    await cleanReplacedObjects(previous, rows);
    return {
      identity,
      cover,
      finalResult: finalResultUpload,
      finalResultPoster: finalResultPosterUpload,
      results: resultUploads,
      resultPosters: resultPosterUploads,
      materials: materialUploads,
      materialAssetIds,
      quickUseDefinition: savedQuickUseDefinition,
      quickUseExamples: Object.fromEntries(
        current.flatMap((asset) => {
          if (
            !asset.asset_key.startsWith(QUICK_USE_EXAMPLE_ASSET_KEY_PREFIX)
            || (
              input.quickUseDefinition !== undefined
              && !preservedQuickUseExampleKeys.has(asset.asset_key)
            )
          ) {
            return [];
          }
          const stored = savedObject(asset);
          return stored ? [[asset.asset_key, stored] as const] : [];
        }),
      ),
    };
  } catch (error) {
    if (assetPersistenceStarted) throw error;
    const previewPaths = newlyUploaded
      .filter((item) => item.bucket === TEMPLATE_PREVIEWS_BUCKET)
      .map((item) => item.path);
    const assetPaths = newlyUploaded
      .filter((item) => item.bucket === TEMPLATE_ASSETS_BUCKET)
      .map((item) => item.path);
    await Promise.allSettled([
      removeTemplateStorageObjects(TEMPLATE_PREVIEWS_BUCKET, previewPaths),
      removeTemplateStorageObjects(TEMPLATE_ASSETS_BUCKET, assetPaths),
    ]);
    throw error;
  }
}

function savedObject(row: SavedAssetRow): UploadedTemplateObject | null {
  if (!row.storage_bucket || !row.storage_path) return null;
  return {
    bucket: row.storage_bucket,
    path: row.storage_path,
    publicUrl: row.storage_bucket === TEMPLATE_PREVIEWS_BUCKET ? row.public_url : null,
    mimeType: row.mime_type || 'application/octet-stream',
    byteSize: Number(row.byte_size || 0),
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds,
  };
}

async function readableAssetUrls(
  assets: SavedAssetRow[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  await Promise.all(
    assets.map(async (asset) => {
      if (asset.public_url) {
        urls.set(asset.id, asset.public_url);
        return;
      }
      if (!asset.storage_bucket || !asset.storage_path) return;
      const { data, error } = await supabase.storage
        .from(asset.storage_bucket)
        .createSignedUrl(asset.storage_path, 5 * 60);
      if (!error && data?.signedUrl) urls.set(asset.id, data.signedUrl);
    }),
  );
  return urls;
}

export async function loadTemplateDraft(
  templateId: string,
  userId: string,
): Promise<LoadTemplateDraftResult> {
  const { data: opened, error: openError } = await supabase.rpc('open_template_edit_draft', {
    p_template_id: templateId,
  });
  if (openError || !opened?.version_id) {
    throw new Error(`This template could not be opened for editing: ${openError?.message || 'No editable version was returned.'}`);
  }

  const { data: template, error: templateError } = await supabase
    .from('templates')
    .select('id,name,display_name,description,status,current_version_id,draft_version_id,cover_type,cover_url')
    .eq('id', templateId)
    .eq('creator_id', userId)
    .single();
  if (templateError || !template) {
    throw new Error('This editable template draft could not be found.');
  }
  const editableVersionId = template.draft_version_id || opened.version_id;
  if (!editableVersionId) {
    throw new Error('This draft has no workflow version yet.');
  }

  const [{ data: version, error: versionError }, { data: assetData, error: assetError }] =
    await Promise.all([
      supabase
        .from('template_versions')
        .select('id,version_number,workflow,quick_use_definition,name,display_name,description,cover_type,cover_url')
        .eq('id', editableVersionId)
        .eq('template_id', templateId)
        .single(),
      supabase
        .from('template_assets')
        .select('id,asset_key,asset_type,source_kind,generation_id,storage_bucket,storage_path,public_url,mime_type,byte_size,width,height,duration_seconds,is_reusable')
        .eq('template_id', templateId)
        .eq('version_id', editableVersionId)
        .order('sort_order', { ascending: true }),
    ]);
  if (versionError || !version) {
    throw new Error('The saved workflow version could not be loaded.');
  }
  if (assetError) {
    throw new Error(`The saved template materials could not be loaded: ${assetError.message}`);
  }

  const assets = (assetData || []) as SavedAssetRow[];
  const urls = await readableAssetUrls(assets);
  const workflow = version.workflow as WorkflowDefinition;
  if (!workflow || !Array.isArray(workflow.steps)) {
    throw new Error('The saved workflow has an invalid format.');
  }
  const quickUseDefinition = version.quick_use_definition == null
    ? null
    : version.quick_use_definition as QuickUseDefinition;
  assertValidQuickUseDefinitionForWorkflow(workflow, quickUseDefinition);

  const persistedMaterials: PersistedMaterialMap = {};
  const persistedResults: PersistedResultMap = {};
  const persistedResultPosters: PersistedResultPosterMap = {};
  const persistedQuickUseExamples: PersistedQuickUseExampleMap = {};
  const quickUseExampleUrls: Record<string, string> = {};
  assets
    .filter((asset) => asset.asset_key.startsWith(QUICK_USE_EXAMPLE_ASSET_KEY_PREFIX))
    .forEach((asset) => {
      if (asset.source_kind === 'upload') {
        const stored = savedObject(asset);
        if (stored) persistedQuickUseExamples[asset.asset_key] = stored;
      }
      const url = urls.get(asset.id) || asset.public_url;
      if (url) quickUseExampleUrls[asset.asset_key] = url;
    });

  for (const example of getQuickUseMediaExamples(quickUseDefinition)) {
    if (!quickUseExampleUrls[example.assetKey]) {
      throw new Error(`The saved Quick Use example asset is missing: ${example.assetKey}.`);
    }
  }
  const steps: BuilderDraftStep[] = workflow.steps.map((workflowStep, stepIndex) => {
    const feature = CAPABILITY_TO_FEATURE[workflowStep.capability];
    if (!feature) {
      throw new Error(`This draft uses an unsupported feature: ${workflowStep.capability}`);
    }
    const resultAsset = assets.find(
      (asset) => asset.asset_key === `step-${stepIndex + 1}-result`,
    );
    const resultThumbnailAsset = assets.find(
      (asset) => asset.asset_key === `step-${stepIndex + 1}-result-thumbnail`,
    );
    if (resultAsset?.source_kind === 'upload') {
      const stored = savedObject(resultAsset);
      if (stored) persistedResults[workflowStep.id] = stored;
    }
    if (resultThumbnailAsset?.source_kind === 'upload') {
      const stored = savedObject(resultThumbnailAsset);
      if (stored) persistedResultPosters[workflowStep.id] = stored;
    }
    const materialAssets = assets.filter((asset) =>
      asset.asset_key.startsWith(`step-${stepIndex + 1}-material-`),
    );
    const materials: BuilderMaterial[] = materialAssets.map((asset, materialIndex) => {
      const materialId = `loaded-${workflowStep.id}-material-${materialIndex + 1}`;
      const stored = savedObject(asset);
      if (stored && asset.source_kind === 'upload') {
        persistedMaterials[materialId] = stored;
      }
      const input = workflowStep.inputs.find((candidate) => candidate.templateAssetId === asset.id);
      return {
        id: materialId,
        type: `${asset.asset_type[0].toUpperCase()}${asset.asset_type.slice(1)}` as BuilderMaterial['type'],
        url: urls.get(asset.id) || asset.public_url,
        allowDownload: Boolean(asset.is_reusable),
        templateAssetId: asset.id,
        sourceGenerationId: asset.generation_id || undefined,
        referenceRole:
          input?.slot === 'style_reference' ? 'style'
            : input?.slot === 'omni_reference' ? 'omni'
              : input?.slot === 'image_reference' || input?.slot === 'reference_images' ? 'image'
                : undefined,
      };
    });
    if (materials.length === 0) {
      DEFAULT_MATERIAL_TYPES[feature].forEach((type, materialIndex) => {
        materials.push({
          id: `loaded-${workflowStep.id}-material-${materialIndex + 1}`,
          type,
          url: null,
          allowDownload: true,
        });
      });
    }
    const parameters = workflowStep.parameters || {};
    return {
      id: workflowStep.id,
      feature,
      resultUrl: resultAsset ? urls.get(resultAsset.id) || resultAsset.public_url : null,
      resultType: resultAsset
        ? resultAsset.asset_type === 'video' ? 'video' : 'image'
        : undefined,
      resultThumbnailUrl: resultThumbnailAsset
        ? urls.get(resultThumbnailAsset.id) || resultThumbnailAsset.public_url || undefined
        : undefined,
      resultGenerationId: resultAsset?.generation_id || undefined,
      materials,
      prompt:
        typeof parameters.prompt === 'string'
          ? parameters.prompt
          : workflowStep.instruction || '',
      videoParams: feature === 'Image to Video'
        ? {
            duration: `${Number(parameters.duration || 3)}s`,
            resolution: String(parameters.resolution || '720p'),
            generateAudio: parameters.generateAudio !== false,
          }
        : undefined,
      imageParams: feature === 'Image Generation'
        ? {
            model: parameters.model === 'mj-v8.1' ? 'mj-v8.1' as const : 'gpt-image-2' as const,
            ratio: String(parameters.ratio || '1:1'),
            resolution: String(parameters.resolution || '1K'),
            quality: parameters.quality === 'hd' ? 'hd' as const : 'standard' as const,
            stylize: readNumberParameter(parameters, 'stylize', 100),
            chaos: readNumberParameter(parameters, 'chaos', 0),
            experimental: readNumberParameter(parameters, 'experimental', 0),
            raw: parameters.raw === true,
            seed: parameters.seed === undefined ? '' : String(parameters.seed),
            referenceMode:
              parameters.referenceMode === 'style' || parameters.referenceMode === 'omni'
                ? parameters.referenceMode
                : 'image' as const,
            imageWeight: readNumberParameter(parameters, 'imageWeight', 1),
            styleWeight: readNumberParameter(parameters, 'styleWeight', 100),
            omniWeight: readNumberParameter(parameters, 'omniWeight', 100),
          }
        : undefined,
      inputBindings: workflowStep.inputs.map((input) => ({ ...input })),
    };
  });

  const coverOriginalRow = assets.find((asset) => asset.asset_key === 'cover-original');
  const coverThumbnailRow = assets.find((asset) => asset.asset_key === 'cover-thumbnail');
  const finalResultRow = assets.find((asset) => asset.asset_key === 'final-result');
  const finalResultThumbnailRow = assets.find(
    (asset) => asset.asset_key === 'final-result-thumbnail',
  );
  const original = coverOriginalRow ? savedObject(coverOriginalRow) : null;
  const thumbnail = coverThumbnailRow ? savedObject(coverThumbnailRow) : null;
  const cover = original && thumbnail
    ? {
        coverType: version.cover_type === 'video' ? 'video' as const : 'image' as const,
        original,
        thumbnail,
      }
    : null;
  const finalStep = steps[steps.length - 1];
  const savedFinalResult = finalResultRow ? savedObject(finalResultRow) : null;
  const savedFinalResultPoster = finalResultThumbnailRow
    ? savedObject(finalResultThumbnailRow)
    : null;
  const manualFinalResultUrl = finalResultRow
    ? urls.get(finalResultRow.id) || finalResultRow.public_url
    : null;
  const manualFinalResultType = finalResultRow
    ? finalResultRow.asset_type === 'video' ? 'video' as const : 'image' as const
    : null;

  return {
    identity: {
      userId,
      templateId,
      versionId: version.id,
      versionNumber: version.version_number,
    },
    title: version.display_name || version.name || template.display_name || template.name,
    description: version.description || template.description || '',
    steps,
    finalResultUrl: manualFinalResultUrl || finalStep?.resultUrl || null,
    finalResultType: manualFinalResultType || finalStep?.resultType || (finalStep
      ? VIDEO_FEATURES.has(finalStep.feature) ? 'video' : 'image'
      : null),
    isFinalResultManual: Boolean(finalResultRow && manualFinalResultUrl),
    finalResult: savedFinalResult,
    finalResultPoster: savedFinalResultPoster,
    cover,
    coverUrl: version.cover_url || (coverOriginalRow ? urls.get(coverOriginalRow.id) : null) || template.cover_url || null,
    coverType: version.cover_type === 'video' ? 'video' : 'image',
    results: persistedResults,
    resultPosters: persistedResultPosters,
    materials: persistedMaterials,
    quickUseDefinition,
    quickUseExamples: persistedQuickUseExamples,
    quickUseExampleUrls,
  };
}

export async function submitTemplateForReview(
  identity: TemplateDraftIdentity,
): Promise<SubmitTemplateForReviewResult> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getUser();
  if (sessionError || !sessionData.user) {
    throw new Error('Please log in before submitting a template for review.');
  }
  if (sessionData.user.id !== identity.userId) {
    throw new Error('This draft belongs to a different account.');
  }

  const { count: coverCount, error: coverError } = await supabase
    .from('template_assets')
    .select('id', { count: 'exact', head: true })
    .eq('template_id', identity.templateId)
    .eq('version_id', identity.versionId)
    .eq('asset_key', 'cover-original');
  if (coverError) {
    throw new Error(`Could not verify the template cover: ${coverError.message}`);
  }
  if (!coverCount) {
    throw new Error('A template cover is required before submitting for review.');
  }

  const { data, error } = await supabase.rpc('submit_template_for_review', {
    p_template_id: identity.templateId,
    p_version_id: identity.versionId,
  });
  if (error) {
    throw new Error(`Could not submit the template for review: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.status !== 'pending_review') {
    throw new Error('The review submission returned an unexpected response.');
  }

  return {
    templateId: row.template_id,
    versionId: row.version_id,
    status: row.status,
    submittedAt: row.submitted_at,
  };
}
