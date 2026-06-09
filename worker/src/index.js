/**
 * ShadyRadio API Worker
 * Serves random audio tracks from R2 bucket by genre
 * Returns BPM + Camelot key from manifest.json for each track
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // CORS headers for all responses
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors })
    }

    // GET /api/random?genre=<slug>
    // Returns { url, key, bpm, camelot, energy, title, artist }
    if (url.pathname === '/api/random') {
      const genre = url.searchParams.get('genre')
      if (!genre) {
        return Response.json({ error: 'genre required' }, { status: 400, headers: cors })
      }

      // List up to 1000 objects under genre/ prefix
      const list = await env.AUDIO_BUCKET.list({ prefix: `${genre}/`, limit: 1000 })
      const tracks = list.objects.filter(o =>
        o.key.endsWith('.mp3') || o.key.endsWith('.aac') || o.key.endsWith('.ogg') || o.key.endsWith('.m4a')
      )

      if (tracks.length === 0) {
        return Response.json({ error: 'no tracks found', genre }, { status: 404, headers: cors })
      }

      const chosen = tracks[Math.floor(Math.random() * tracks.length)]
      const publicUrl = `${env.R2_PUBLIC_URL}/${chosen.key}`

      // Look up metadata from manifest.json
      const manifest = await getManifest(env)
      const trackMeta = manifest?.genres?.[genre]?.find(t => chosen.key.endsWith(t.file.replace(`${genre}/`, '')))
        || manifest?.genres?.[genre]?.find(t => t.file === chosen.key)

      return Response.json({
        url: publicUrl,
        key: chosen.key,
        bpm: trackMeta?.bpm || null,
        camelot: trackMeta?.key || null,
        energy: trackMeta?.energy || null,
        title: trackMeta?.title || null,
        artist: trackMeta?.artist || null,
      }, { headers: cors })
    }

    // GET /api/genres — list available genre folders
    if (url.pathname === '/api/genres') {
      const list = await env.AUDIO_BUCKET.list({ delimiter: '/' })
      const genres = list.delimitedPrefixes.map(p => p.replace('/', ''))
      return Response.json({ genres }, { headers: cors })
    }

    return new Response('not found', { status: 404, headers: cors })
  }
}

// Cache manifest in memory across requests
let manifestCache = null
let manifestCacheTime = 0

async function getManifest(env) {
  const now = Date.now()
  // Refresh cache every 60 seconds
  if (manifestCache && (now - manifestCacheTime) < 60000) {
    return manifestCache
  }
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
