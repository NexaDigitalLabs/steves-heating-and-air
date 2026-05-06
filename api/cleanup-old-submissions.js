// /api/cleanup-old-submissions.js — Vercel cron endpoint
// Runs daily (configured in vercel.json). Deletes diagnose_submissions rows
// older than 48 hours along with their associated storage objects.
//
// Auth: Vercel cron sends a known secret in the authorization header. Set
// CRON_SECRET in Vercel env vars to a random string — only requests with
// that bearer token will be accepted, blocking external callers.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const STORAGE_BUCKET = 'diagnose-photos';
const RETENTION_HOURS = 48;

export default async function handler(req, res) {
  // Auth — Vercel cron passes Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.authorization || '';
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000).toISOString();

  // Find old rows + their media paths
  const { data: oldRows, error: selectErr } = await supabase
    .from('diagnose_submissions')
    .select('id, photo_paths, video_path')
    .lt('created_at', cutoff);

  if (selectErr) {
    console.error('Cleanup select failed:', selectErr);
    return res.status(500).json({ error: 'Select failed' });
  }

  if (!oldRows || oldRows.length === 0) {
    return res.status(200).json({ deleted: 0, mediaRemoved: 0 });
  }

  // Collect every storage path to delete
  const allPaths = oldRows.flatMap(row => [
    ...(Array.isArray(row.photo_paths) ? row.photo_paths : []),
    row.video_path
  ].filter(Boolean));

  // Delete storage objects (Supabase accepts batch)
  let mediaRemoved = 0;
  if (allPaths.length > 0) {
    const { data: removeData, error: removeErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(allPaths);
    if (removeErr) console.error('Storage remove failed:', removeErr);
    else mediaRemoved = removeData?.length || 0;
  }

  // Delete the DB rows
  const { error: deleteErr } = await supabase
    .from('diagnose_submissions')
    .delete()
    .lt('created_at', cutoff);

  if (deleteErr) {
    console.error('Cleanup delete failed:', deleteErr);
    return res.status(500).json({ error: 'Delete failed', mediaRemoved });
  }

  return res.status(200).json({
    deleted: oldRows.length,
    mediaRemoved,
    cutoff
  });
}
