import type { WorkflowDefinition } from '../workflows/types';
import {
  convertAndValidateBuilderWorkflow,
  type BuilderDraftStep,
} from '../workflows/builderAdapter';
import { supabase } from './supabase';
import {
  TEMPLATE_ASSETS_BUCKET,
  TEMPLATE_PREVIEWS_BUCKET,
  removeTemplateStorageObjects,
  uploadTemplateCover,
  uploadTemplateMaterial,
  type TemplateStorageIdentity,
  type UploadedTemplateCover,
  type UploadedTemplateObject,
} from './templateStorage';

export interface TemplateDraftIdentity extends TemplateStorageIdentity {
  versionNumber: number;
}

export type PersistedMaterialMap = Record<string, UploadedTemplateObject>;

export interface SaveTemplateDraftInput {
  identity?: TemplateDraftIdentity | null;
  userId: string;
  title: string;
  description: string;
  workflow: WorkflowDefinition;
  steps: BuilderDraftStep[];
  finalResultUrl: string | null;
  coverFile: File | null;
  persistedCover: UploadedTemplateCover | null;
  materialFiles: Record<string, File>;
  persistedMaterials: PersistedMaterialMap;
}

export interface SaveTemplateDraftResult {
  identity: TemplateDraftIdentity;
  cover: UploadedTemplateCover | null;
  materials: PersistedMaterialMap;
  materialAssetIds: Record<string, string>;
}

export interface SubmitTemplateForReviewResult {
  templateId: string;
  versionId: string;
  status: 'pending_review';
  submittedAt: string;
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
  const templatePayload = {
    name,
    display_name: name,
    image_url: input.finalResultUrl || '',
    category: 'Workflow',
    tags: [],
    is_pro: false,
    prompt_template: input.workflow.steps[0]?.instruction || null,
    creator_id: input.userId,
    slug: slugify(name, identity.templateId),
    description: input.description.trim() || null,
    template_kind: inferTemplateKind(input.workflow),
    status: 'draft',
    updated_at: new Date().toISOString(),
  };

  if (!input.identity) {
    const { error } = await supabase.from('templates').insert({
      id: identity.templateId,
      ...templatePayload,
      cover_type: 'image',
      cover_url: null,
      preview_url: input.finalResultUrl,
    });
    if (error) throw new Error(`Could not create the draft: ${error.message}`);
  } else {
    const { error } = await supabase
      .from('templates')
      .update(templatePayload)
      .eq('id', identity.templateId);
    if (error) throw new Error(`Could not update the draft: ${error.message}`);
  }

  const { error: versionError } = await supabase.from('template_versions').upsert(
    {
      id: identity.versionId,
      template_id: identity.templateId,
      version_number: identity.versionNumber,
      schema_version: input.workflow.schemaVersion,
      workflow: input.workflow,
      change_summary: 'Builder draft save',
      created_by: input.userId,
    },
    { onConflict: 'template_id,version_number' },
  );
  if (versionError) {
    throw new Error(`Could not save the workflow version: ${versionError.message}`);
  }

  const { error: linkError } = await supabase
    .from('templates')
    .update({ current_version_id: identity.versionId })
    .eq('id', identity.templateId);
  if (linkError) throw new Error(`Could not link the workflow version: ${linkError.message}`);
}

async function replaceAssetRows(
  identity: TemplateDraftIdentity,
  rows: AssetInsertRow[],
): Promise<{ previous: ExistingAssetRow[]; current: Array<{ id: string; asset_key: string }> }> {
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
  const stale = (previous || []).filter((row) => !activeKeys.has(row.asset_key));
  if (stale.length > 0) {
    const { error: deleteError } = await supabase
      .from('template_assets')
      .delete()
      .in('id', stale.map((row) => row.id));
    if (deleteError) throw new Error(`Could not remove stale asset records: ${deleteError.message}`);
  }
  const { data: current, error: currentError } = await supabase
    .from('template_assets')
    .select('id,asset_key')
    .eq('template_id', identity.templateId)
    .eq('version_id', identity.versionId);
  if (currentError) throw new Error(`Could not verify saved draft assets: ${currentError.message}`);
  return {
    previous: (previous || []) as ExistingAssetRow[],
    current: (current || []) as Array<{ id: string; asset_key: string }>,
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

  await ensureDraftRows(identity, input);

  let cover = input.persistedCover;
  const materialUploads: PersistedMaterialMap = { ...input.persistedMaterials };
  const newlyUploaded: Array<{ bucket: string; path: string }> = [];
  let assetPersistenceStarted = false;

  try {
    if (input.coverFile) {
      cover = await uploadTemplateCover(identity, input.coverFile);
      newlyUploaded.push(
        { bucket: cover.original.bucket, path: cover.original.path },
        { bucket: cover.thumbnail.bucket, path: cover.thumbnail.path },
      );
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

    input.steps.forEach((step, stepIndex) => {
      if (step.resultGenerationId && step.resultUrl) {
        rows.push(
          generationRow(
            identity,
            input.userId,
            `step-${stepIndex + 1}-result`,
            step.feature === 'Image to Video' ? 'video' : 'image',
            step.resultGenerationId,
            step.resultUrl,
            sortOrder++,
            false,
          ),
        );
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

    assetPersistenceStarted = true;
    const { previous, current } = await replaceAssetRows(identity, rows);
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
    const { error: workflowLinkError } = await supabase
      .from('template_versions')
      .update({ workflow: boundWorkflow.workflow })
      .eq('id', identity.versionId);
    if (workflowLinkError) {
      throw new Error(`Could not link saved assets to the workflow: ${workflowLinkError.message}`);
    }

    if (cover) {
      const { error: coverError } = await supabase
        .from('templates')
        .update({
          image_url: cover.thumbnail.publicUrl || cover.original.publicUrl || input.finalResultUrl || '',
          thumb_url: cover.thumbnail.publicUrl,
          cover_type: cover.coverType,
          cover_url: cover.original.publicUrl,
          preview_url: cover.original.publicUrl,
        })
        .eq('id', identity.templateId);
      if (coverError) throw new Error(`Could not save the cover metadata: ${coverError.message}`);
    }

    await cleanReplacedObjects(previous, rows);
    return { identity, cover, materials: materialUploads, materialAssetIds };
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
