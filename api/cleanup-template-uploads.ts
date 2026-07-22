import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type StaleObject = { bucket_id: string; object_name: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase server credentials are missing.' });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const before = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc('service_list_stale_template_uploads', {
    p_before: before,
  });
  if (error) return res.status(500).json({ error: error.message });

  const rows = (data || []) as StaleObject[];
  const byBucket = new Map<string, string[]>();
  for (const row of rows) {
    if (!['template-previews', 'template-assets'].includes(row.bucket_id)) continue;
    byBucket.set(row.bucket_id, [...(byBucket.get(row.bucket_id) || []), row.object_name]);
  }

  let removed = 0;
  const failures: string[] = [];
  for (const [bucket, paths] of byBucket) {
    const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
    if (removeError) failures.push(`${bucket}: ${removeError.message}`);
    else removed += paths.length;
  }

  return res.status(failures.length ? 500 : 200).json({ scanned: rows.length, removed, failures });
}
