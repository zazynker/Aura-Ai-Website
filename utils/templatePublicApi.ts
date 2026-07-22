import { supabase } from './supabase';
import { fetchPublicProfiles } from './profileApi';

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
  limit = 1000,
): Promise<PublicTemplateRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'list_published_templates',
    { p_limit: safeLimit },
  );

  if (!rpcError) {
    const rows = (rpcData || []) as PublicTemplateRow[];
    const profiles = await fetchPublicProfiles(
      rows.map((row) => row.creator_id).filter((id): id is string => Boolean(id)),
    );
    return rows.map((row) => ({
      ...row,
      author_name: (row.creator_id && profiles.get(row.creator_id)?.username) || row.author_name,
    }));
  }

  console.warn(
    'list_published_templates is unavailable; using the published-only fallback.',
    rpcError.message,
  );
  const { data, error } = await supabase
    .from('templates')
    .select(PUBLIC_TEMPLATE_COLUMNS)
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Could not load published templates: ${error.message}`);
  }

  const rows = (data || []) as unknown as Array<Omit<PublicTemplateRow, 'author_name'>>;
  const profiles = await fetchPublicProfiles(
    rows.map((row) => row.creator_id).filter((id): id is string => Boolean(id)),
  );
  return rows.map((row) => ({
    ...row,
    author_name: (row.creator_id && profiles.get(row.creator_id)?.username)
      || (row.creator_id ? 'Lazora creator' : 'Lazora'),
  })) as PublicTemplateRow[];
}
