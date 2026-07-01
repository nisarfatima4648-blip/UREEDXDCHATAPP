import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ─── Supabase Storage Upload ────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

let supabaseAdmin: ReturnType<typeof createClient> | null = null

function getSupabase() {
  if (!supabaseAdmin && supabaseUrl && supabaseServiceKey) {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    })
  }
  return supabaseAdmin
}

const TYPE_BUCKETS: Record<string, string> = {
  avatar: 'avatars',
  banner: 'banners',
  'gc-icon': 'gc-icons',
  attachment: 'attachments',
}

const MAX_FILE_SIZE = 10 * 1024 * 1024

const ALLOWED_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
  'application/pdf', 'text/plain',
])

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const type = (formData.get('type') as string) || 'attachment'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const bucket = TYPE_BUCKETS[type]
    if (!bucket) {
      return NextResponse.json({ error: `Invalid type: ${type}` }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Max size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 413 }
      )
    }

    const mimeType = file.type || guessMimeType(file.name)
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json({ error: `File type not allowed: ${mimeType}` }, { status: 415 })
    }

    // ─── Try Supabase Storage (production) ──────────────────────────────
    const supabase = getSupabase()
    if (supabase) {
      const ext = getExtension(file.name)
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`

      const bytes = await file.arrayBuffer()
      const { error } = await supabase.storage
        .from(bucket)
        .upload(filename, bytes, {
          contentType: mimeType,
          upsert: false,
        })

      if (error) {
        console.error('[upload] Supabase error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(filename)

      console.log(`[upload] Saved ${type} (${file.size} bytes) → ${urlData.publicUrl}`)
      return NextResponse.json({ url: urlData.publicUrl, type, size: file.size })
    }

    // ─── Fallback: local filesystem (dev only — won't work on Vercel) ────
    return NextResponse.json(
      { error: 'Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 500 }
    )
  } catch (err) {
    console.error('[upload] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    )
  }
}

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.')
  if (idx === -1) return ''
  const ext = filename.slice(idx).toLowerCase()
  if (/^\.[a-z0-9]{1,5}$/.test(ext)) return ext
  return ''
}

function guessMimeType(filename: string): string {
  const ext = getExtension(filename).slice(1)
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
    pdf: 'application/pdf', txt: 'text/plain',
  }
  return map[ext] || 'application/octet-stream'
}
