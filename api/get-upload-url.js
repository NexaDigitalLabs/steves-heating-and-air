// /api/get-upload-url.js — Vercel serverless function
// Issues a presigned Supabase upload URL so the client can PUT the video file
// directly to Storage, bypassing Vercel's 4.5 MB function-body limit. Used
// only for video; photos are still small enough to ship as base64 in the main
// /api/diagnose body.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = 'diagnose-photos';
const ALLOWED_VIDEO_EXT = ['mp4', 'mov', 'webm', 'm4v'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const { extension } = req.body || {};
  const ext = String(extension || '').toLowerCase().replace(/^\./, '');
  if (!ALLOWED_VIDEO_EXT.includes(ext)) {
    return res.status(400).json({ error: 'Unsupported video extension' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  const id = `vid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `${new Date().toISOString().slice(0, 10)}/${id}.${ext}`;

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(path);

  if (error) {
    console.error('createSignedUploadUrl failed:', error);
    return res.status(500).json({ error: 'Could not create upload URL' });
  }

  return res.status(200).json({
    path,
    token: data.token,
    signedUrl: data.signedUrl
  });
}
