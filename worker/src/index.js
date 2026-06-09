/**
 * ShadyRadio API Worker
 * Serves random audio tracks from R2 bucket by genre
 * Falls back gracefully when tracks aren't available
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
    // Returns { url, key } for a random track in that genre folder
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

      return Response.json({ url: publicUrl, key: chosen.key, total: tracks.length }, { headers: cors })
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
