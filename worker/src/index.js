/**
 * ShadyRadio API Worker
 * Serves random audio tracks from R2 bucket by genre
 * Returns BPM + Camelot key from manifest.json for each track
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors })
    }

    // GET /api/audio/<key> — stream audio directly from R2 (no public bucket needed)
    if (url.pathname.startsWith('/api/audio/')) {
      const key = decodeURIComponent(url.pathname.replace('/api/audio/', ''))
      const obj = await env.AUDIO_BUCKET.get(key)
      if (!obj) return new Response('not found', { status: 404, headers: cors })
      const ext = key.split('.').pop().toLowerCase()
      const mime = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav' }[ext] || 'audio/mpeg'
      return new Response(obj.body, {
        headers: {
          ...cors,
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=86400',
          'Accept-Ranges': 'bytes',
        }
      })
    }

    // GET /api/random?genre=<slug>
    if (url.pathname === '/api/random') {
      const genre = url.searchParams.get('genre')
      if (!genre) {
        return Response.json({ error: 'genre required' }, { status: 400, headers: cors })
      }

      const list = await env.AUDIO_BUCKET.list({ prefix: `${genre}/`, limit: 1000 })
      const tracks = list.objects.filter(o =>
        o.key.endsWith('.mp3') || o.key.endsWith('.aac') || o.key.endsWith('.ogg') || o.key.endsWith('.m4a') || o.key.endsWith('.wav')
      )

      if (tracks.length === 0) {
        return Response.json({ error: 'no tracks found', genre }, { status: 404, headers: cors })
      }

      const chosen = tracks[Math.floor(Math.random() * tracks.length)]

      // Build a worker-served URL so no public bucket needed
      const workerUrl = new URL(request.url)
      const audioUrl = `${workerUrl.origin}/api/audio/${encodeURIComponent(chosen.key)}`

      const manifest = await getManifest(env)
      const trackMeta = manifest?.genres?.[genre]?.find(t => chosen.key.endsWith(t.file.replace(`${genre}/`, '')))
        || manifest?.genres?.[genre]?.find(t => t.file === chosen.key)

      return Response.json({
        url: audioUrl,
        key: chosen.key,
        bpm: trackMeta?.bpm || null,
        camelot: trackMeta?.key || null,
        energy: trackMeta?.energy || null,
        title: trackMeta?.title || chosen.key.split('/').pop().replace(/\.[^.]+$/, ''),
        artist: trackMeta?.artist || null,
      }, { headers: cors })
    }

    // GET /api/genres
    if (url.pathname === '/api/genres') {
      const list = await env.AUDIO_BUCKET.list({ delimiter: '/' })
      const genres = list.delimitedPrefixes.map(p => p.replace('/', ''))
      return Response.json({ genres }, { headers: cors })
    }

    return new Response('not found', { status: 404, headers: cors })
  }
}

let manifestCache = null
let manifestCacheTime = 0

async function getManifest(env) {
  const now = Date.now()
  if (manifestCache && (now - manifestCacheTime) < 60000) return manifestCache
  try {
    const obj = await env.AUDIO_BUCKET.get('manifest.json')
    if (!obj) return null
    manifestCache = await obj.json()
    manifestCacheTime = now
    return manifestCache
  } catch {
    return null
  }
}
