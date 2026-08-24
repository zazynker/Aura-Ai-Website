import { supabase } from './supabase';

export interface PublicTemplateRow {
  id: string;
  slug: string;
  name: string;
  display_name: string | null;
  image_url: string;
  thumb_url: string | null;
  category: string;
  tags: string[] | null;
  is_pro: boolean | null;
  width: number | null;
  height: number | null;
  scene: string | null;
  model: string | null;
  mood: string | null;
  holiday: string | null;
  template_kind: string;
  cover_type: string;
  cover_url: string | null;
  preview_url: string | null;
  use_count: number | string | null;
  published_at: string | null;
  creator_id: string | null;
  author_name: string | null;
  has_quick_use: boolean;
}

const PUBLIC_TEMPLATE_COLUMNS = [
  'id',
  'slug',
  'name',
  'display_name',
  'image_url',
  'thumb_url',
  'category',
  'tags',
  'is_pro',
  'width',
  'height',
  'scene',
  'model',
  'mood',
  'holiday',
  'template_kind',
  'cover_type',
  'cover_url',
  'preview_url',
  'use_count',
  'published_at',
  'creator_id',
].join(',');

/**
 * Loads the public marketplace feed.
 *
 * The RPC is preferred because it supplies a privacy-safe creator display
 * name. The direct query is intentionally kept as a deployment-order fallback,
 * but it still filters status=published so an author's draft or rejected
 * template can never leak into Home through the owner's broader RLS policy.
 */
export async function fetchPublishedTemplates(
  limit = 24,
  offset = 0,
): Promise<PublicTemplateRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const safeOffset = Math.max(0, Math.floor(offset));
  // The RPC is kept for the first page because it includes a privacy-safe
  // author name. Subsequent pages use the published-only query so this code
  // also works with deployments where the RPC has no offset argument.
  const { data: rpcData, error: rpcError } = safeOffset === 0
    ? await supabase.rpc('list_published_templates', { p_limit: safeLimit })
    : { data: null, error: { message: 'Use the paged query after the first page.' } };

  if (!rpcError) {
    return enrichQuickUseAvailability((rpcData || []) as PublicTemplateRow[]);
  }

  if (safeOffset === 0) {
    console.warn(
      'list_published_templates is unavailable; using the published-only fallback.',
      rpcError.message,
    );
  }
  const { data, error } = await supabase
    .from('templates')
    .select(PUBLIC_TEMPLATE_COLUMNS)
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (error) {
    throw new Error(`Could not load published templates: ${error.message}`);
  }

  const rows = (data || []) as unknown as Array<Omit<PublicTemplateRow, 'author_name' | 'has_quick_use'>>;
  const mappedRows = rows.map((row) => ({
    ...row,
    author_name: row.creator_id ? 'Lazora creator' : 'Lazora',
    has_quick_use: false,
  })) as PublicTemplateRow[];
  return enrichQuickUseAvailability(mappedRows);
}

async function enrichQuickUseAvailability(
  rows: PublicTemplateRow[],
): Promise<PublicTemplateRow[]> {
  if (rows.length === 0) return rows;
  const ids = rows.map((row) => row.id);

  // This RPC deliberately exposes only the ids of published Templates. It is
  // available to signed-out visitors, unlike the authoring tables below.
  // Without it, an anonymous RLS denial was interpreted as "no Quick Use" and
  // every Template badge incorrectly became Workflow.
  const { data: publicQuickUseIds, error: publicQuickUseError } = await supabase.rpc(
    'list_published_quick_use_template_ids',
    { p_template_ids: ids },
  );
  if (!publicQuickUseError) {
    const quickUseIds = new Set(
      ((publicQuickUseIds || []) as Array<{ template_id?: unknown }>)
        .map((row) => typeof row.template_id === 'string' ? row.template_id : '')
        .filter(Boolean),
    );
    return rows.map((row) => ({ ...row, has_quick_use: quickUseIds.has(row.id) }));
  }

  const { data: pointers, error: pointerError } = await supabase
    .from('templates')
    .select('id,current_version_id')
    .in('id', ids)
    .eq('status', 'published');
  if (pointerError) {
    console.warn('Could not resolve Quick Use availability.', pointerError.message);
    // Preserve the value supplied by list_published_templates. False is not a
    // safe fallback here: for guests it changes the product type in the UI.
    return rows;
  }
  const versionIds = (pointers || [])
    .map((pointer) => pointer.current_version_id as string | null)
    .filter((versionId): versionId is string => Boolean(versionId));
  if (versionIds.length === 0) {
    return rows;
  }
  const { data: versions, error: versionError } = await supabase
    .from('template_versions')
    .select('id,quick_use_definition')
    .in('id', versionIds)
    .eq('version_status', 'published');
  if (versionError) {
    console.warn('Could not load Quick Use availability.', versionError.message);
    return rows;
  }
  const quickUseVersionIds = new Set(
    (versions || [])
      .filter((version) => {
        const definition = version.quick_use_definition as { blocks?: unknown } | null;
        return Array.isArray(definition?.blocks) && definition.blocks.length > 0;
      })
      .map((version) => version.id as string),
  );
  const versionByTemplateId = new Map(
    (pointers || []).map((pointer) => [pointer.id as string, pointer.current_version_id as string | null]),
  );
  return rows.map((row) => ({
    ...row,
    has_quick_use: quickUseVersionIds.has(versionByTemplateId.get(row.id) || ''),
  }));
}
