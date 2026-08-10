import type { WorkflowDefinition } from './types';
import type { QuickUseDefinition } from './quickUseTypes';

export type TemplateDatabaseStatus =
  | 'draft'
  | 'pending_review'
  | 'published'
  | 'rejected'
  | 'archived';

export type TemplateUiStatus =
  | 'Draft'
  | 'In review'
  | 'Published'
  | 'Changes requested'
  | 'Archived';

export type TemplateKind =
  | 'legacy_image'
  | 'workflow_image'
  | 'workflow_video'
  | 'workflow_mixed';

export type TemplateCoverType = 'image' | 'video' | 'animated';
export type TemplateAssetType = 'image' | 'video' | 'audio';

// Logical MVP permission. It is kept in the frontend domain now and can be
// persisted once template_assets receives its permission column in M5-2.
export type TemplateAssetPermission =
  | 'private'
  | 'preview'
  | 'reusable'
  | 'downloadable';

export interface TemplateRow {
  id: string;
  name: string;
  image_url: string | null;
  category: string;
  tags: string[] | null;
  is_pro: boolean | null;
  width: number | null;
  height: number | null;
  prompt_template: string | null;
  created_at: string | null;
  thumb_url: string | null;
  display_name: string | null;
  scene: string | null;
  model: string | null;
  mood: string | null;
  holiday: string | null;
  creator_id: string | null;
  slug: string;
  description: string | null;
  template_kind: TemplateKind;
  status: TemplateDatabaseStatus;
  cover_type: TemplateCoverType;
  cover_url: string | null;
  preview_url: string | null;
  use_count: number;
  submitted_at: string | null;
  published_at: string | null;
  updated_at: string;
  current_version_id: string | null;
}

export interface TemplateVersionRow {
  id: string;
  template_id: string;
  version_number: number;
  schema_version: number;
  workflow: WorkflowDefinition;
  quick_use_definition: QuickUseDefinition | null;
  change_summary: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TemplateAssetRow {
  id: string;
  template_id: string;
  version_id: string | null;
  owner_id: string;
  asset_key: string;
  asset_type: TemplateAssetType;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  sort_order: number;
  created_at: string;
}

export interface TemplateReviewLogRow {
  id: string;
  template_id: string;
  version_id: string | null;
  actor_id: string | null;
  action: 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'archived';
  note: string | null;
  created_at: string;
}

export interface TemplateRecord {
  id: string;
  title: string;
  description: string;
  slug: string;
  kind: TemplateKind;
  databaseStatus: TemplateDatabaseStatus;
  status: TemplateUiStatus;
  coverType: TemplateCoverType;
  coverUrl: string | null;
  creatorId: string | null;
  currentVersionId: string | null;
  useCount: number;
  createdAt: string | null;
  updatedAt: string;
  submittedAt: string | null;
  publishedAt: string | null;
}

export const TEMPLATE_STATUS_TO_UI: Record<
  TemplateDatabaseStatus,
  TemplateUiStatus
> = {
  draft: 'Draft',
  pending_review: 'In review',
  published: 'Published',
  rejected: 'Changes requested',
  archived: 'Archived',
};

export const TEMPLATE_STATUS_TO_DATABASE: Record<
  TemplateUiStatus,
  TemplateDatabaseStatus
> = {
  Draft: 'draft',
  'In review': 'pending_review',
  Published: 'published',
  'Changes requested': 'rejected',
  Archived: 'archived',
};

export function toTemplateUiStatus(
  status: TemplateDatabaseStatus,
): TemplateUiStatus {
  return TEMPLATE_STATUS_TO_UI[status];
}

export function toTemplateDatabaseStatus(
  status: TemplateUiStatus,
): TemplateDatabaseStatus {
  return TEMPLATE_STATUS_TO_DATABASE[status];
}

export function mapTemplateRow(row: TemplateRow): TemplateRecord {
  return {
    id: row.id,
    title: row.name || row.display_name || 'Untitled template',
    description: row.description ?? '',
    slug: row.slug,
    kind: row.template_kind,
    databaseStatus: row.status,
    status: toTemplateUiStatus(row.status),
    coverType: row.cover_type,
    coverUrl:
      row.cover_url ??
      row.preview_url ??
      row.thumb_url ??
      row.image_url ??
      null,
    creatorId: row.creator_id,
    currentVersionId: row.current_version_id,
    useCount: Number(row.use_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    publishedAt: row.published_at,
  };
}

export function isEditableTemplateStatus(
  status: TemplateDatabaseStatus,
): boolean {
  return status === 'draft' || status === 'pending_review' || status === 'rejected';
}

export function isPublishedTemplateStatus(
  status: TemplateDatabaseStatus,
): boolean {
  return status === 'published';
}
