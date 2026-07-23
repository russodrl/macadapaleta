/**
 * Instagram Feed Worker
 * Cloudflare Worker para buscar as últimas postagens públicas do Instagram.
 *
 * Secrets opcionais:
 *   INSTAGRAM_SESSIONID, melhora a taxa de sucesso do web_profile_info.
 * Vars opcionais:
 *   INSTAGRAM_USERNAME, CACHE_TTL_SECONDS, ALLOWED_ORIGINS
 */

const DEFAULT_USERNAME = 'macadapaleta';
const DEFAULT_CACHE_TTL = 3600;
const FALLBACK_POSTS = [
  { id: 'DXr7SYAjNDJ', shortcode: 'DXr7SYAjNDJ', permalink: 'https://www.instagram.com/reel/DXr7SYAjNDJ/', thumbnail_url: 'assets/photos/google-maps-pratos.jpg', caption: 'Terça é dia de chopp em dobro aqui no Maçã da Paleta.', timestamp: '', likes: 0, comments: 0, is_video: true },
  { id: 'DXNWGTOjWx1', shortcode: 'DXNWGTOjWx1', permalink: 'https://www.instagram.com/reel/DXNWGTOjWx1/', thumbnail_url: 'assets/photos/google-maps-sobre.jpg', caption: 'Lugar ideal para compartilhar bons momentos com amigos e família.', timestamp: '', likes: 0, comments: 0, is_video: true },
  { id: 'DXNWhk6jZZj', shortcode: 'DXNWhk6jZZj', permalink: 'https://www.instagram.com/reel/DXNWhk6jZZj/', thumbnail_url: 'assets/photos/google-maps-tomahawk.jpg', caption: 'Cortes que chegam à mesa e chamam atenção no primeiro olhar.', timestamp: '', likes: 0, comments: 0, is_video: true },
  { id: 'DUoTSNPkr0U', shortcode: 'DUoTSNPkr0U', permalink: 'https://www.instagram.com/p/DUoTSNPkr0U/', thumbnail_url: 'assets/photos/google-maps-picanha.jpg', caption: 'Cardápio novo, mais opções e mais sabor.', timestamp: '', likes: 0, comments: 0, is_video: false },
  { id: 'DVWFAZIArb6', shortcode: 'DVWFAZIArb6', permalink: 'https://www.instagram.com/reel/DVWFAZIArb6/', thumbnail_url: 'assets/photos/google-maps-baby-beef.jpg', caption: 'Cortes nobres no ponto perfeito para o seu paladar.', timestamp: '', likes: 0, comments: 0, is_video: true },
  { id: 'DWHnqP7EVVD', shortcode: 'DWHnqP7EVVD', permalink: 'https://www.instagram.com/reel/DWHnqP7EVVD/', thumbnail_url: 'assets/photos/google-maps-costela.jpg', caption: 'A casa está aberta. Cortes nobres, no ponto perfeito.', timestamp: '', likes: 0, comments: 0, is_video: true }
];

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return optionsResponse(request, env);
    if (request.method !== 'GET') return jsonResponse({ success: false, error: 'Method not allowed' }, 405, request, env);

    const url = new URL(request.url);
    const username = sanitizeUsername(url.searchParams.get('username') || env.INSTAGRAM_USERNAME || DEFAULT_USERNAME);
    const count = clamp(parseInt(url.searchParams.get('count') || '6', 10), 1, 24);
    const ttl = clamp(parseInt(env.CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL, 10), 300, 86400);
    const cacheKey = new Request(`${url.origin}/cache/${username}/${count}`);
    const cache = caches.default;

    const cached = await cache.match(cacheKey);
    if (cached) {
      const data = await cached.json();
      return jsonResponse({ ...data, cached: true }, 200, request, env);
    }

    const attempts = [
      ['web_profile_info', () => fetchViaWebProfile(username, count, env)],
      ['profile_html', () => fetchViaProfileHtml(username, count)],
      ['rss', () => fetchViaRss(username, count)],
      ['fallback', async () => FALLBACK_POSTS.slice(0, count)]
    ];

    let posts = [];
    let source = 'fallback';
    let lastError = '';

    for (const [name, fn] of attempts) {
      try {
        posts = await fn();
        if (posts && posts.length) {
          source = name;
          break;
        }
      } catch (error) {
        lastError = error.message || String(error);
      }
    }

    posts = normalizePosts(posts).slice(0, count);
    const payload = { success: true, username, source, cached: false, updated_at: new Date().toISOString(), posts, last_error: lastError || undefined };
    const responseForCache = jsonResponse(payload, 200, request, env, { 'Cache-Control': `public, max-age=${ttl}` });
    ctx.waitUntil(cache.put(cacheKey, responseForCache.clone()));
    return responseForCache;
  }
};

async function fetchViaWebProfile(username, count, env) {
  const headers = {
    'Accept': 'application/json,text/plain,*/*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'X-IG-App-ID': '936619743392459'
  };
  if (env.INSTAGRAM_SESSIONID) headers.Cookie = `sessionid=${env.INSTAGRAM_SESSIONID};`;

  const response = await fetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, { headers });
  if (!response.ok) throw new Error(`web_profile_info ${response.status}`);
  const data = await response.json();
  const edges = data?.data?.user?.edge_owner_to_timeline_media?.edges || [];
  if (!edges.length) throw new Error('sem edges no web_profile_info');

  return edges.slice(0, count).map(edge => {
    const n = edge.node;
    return {
      id: n.id,
      shortcode: n.shortcode,
      permalink: `https://www.instagram.com/${n.is_video ? 'reel' : 'p'}/${n.shortcode}/`,
      thumbnail_url: n.thumbnail_src || n.display_url,
      caption: n.edge_media_to_caption?.edges?.[0]?.node?.text || '',
      timestamp: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000).toISOString() : '',
      likes: n.edge_liked_by?.count || 0,
      comments: n.edge_media_to_comment?.count || 0,
      is_video: Boolean(n.is_video)
    };
  });
}

async function fetchViaProfileHtml(username, count) {
  const response = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    }
  });
  if (!response.ok) throw new Error(`profile_html ${response.status}`);
  const html = await response.text();
  const shortcodes = [...html.matchAll(/"shortcode"\s*:\s*"([A-Za-z0-9_-]+)"/g)].map(m => m[1]);
  const displayUrls = [...html.matchAll(/"display_url"\s*:\s*"([^"]+)"/g)].map(m => safeJsonString(m[1]));
  const unique = [...new Set(shortcodes)].slice(0, count);
  if (!unique.length) throw new Error('sem shortcodes no HTML');
  return unique.map((shortcode, i) => ({
    id: shortcode,
    shortcode,
    permalink: `https://www.instagram.com/p/${shortcode}/`,
    thumbnail_url: displayUrls[i] || '',
    caption: '',
    timestamp: '',
    likes: 0,
    comments: 0,
    is_video: false
  }));
}

async function fetchViaRss(username, count) {
  const endpoints = [
    `https://rss.app/feeds/v1.1/ig/${encodeURIComponent(username)}.json`,
    `https://rsshub.app/instagram/user/${encodeURIComponent(username)}`
  ];

  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, { headers: { 'Accept': 'application/json,application/rss+xml,text/xml' } });
    if (!response.ok) continue;
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      const items = json.items || json.data || [];
      if (items.length) return items.slice(0, count).map(item => ({
        id: item.id || item.url || item.link,
        shortcode: extractShortcode(item.url || item.link || ''),
        permalink: item.url || item.link,
        thumbnail_url: item.image || item.thumbnail || item.enclosure?.url || '',
        caption: item.title || item.content_text || item.content || '',
        timestamp: item.date_published || item.pubDate || '',
        likes: 0,
        comments: 0,
        is_video: String(item.url || item.link || '').includes('/reel/')
      }));
    } catch (_) {}
  }
  throw new Error('rss indisponível');
}

function normalizePosts(posts) {
  return (posts || []).map((post, index) => {
    const shortcode = post.shortcode || extractShortcode(post.permalink || post.url || '') || post.id || `post-${index}`;
    return {
      id: String(post.id || shortcode),
      shortcode: String(shortcode),
      permalink: post.permalink || post.url || `https://www.instagram.com/p/${shortcode}/`,
      thumbnail_url: post.thumbnail_url || post.thumbnail || post.display_url || post.image || '',
      caption: cleanText(post.caption || post.title || ''),
      timestamp: post.timestamp || post.date || '',
      likes: Number(post.likes || 0),
      comments: Number(post.comments || 0),
      is_video: Boolean(post.is_video || String(post.permalink || post.url || '').includes('/reel/'))
    };
  });
}

function jsonResponse(data, status, request, env, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env),
      ...extraHeaders
    }
  });
}

function optionsResponse(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '*';
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map(v => v.trim()).filter(Boolean);
  const allowOrigin = allowed.includes('*') || allowed.includes(origin) ? origin : allowed[0] || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
    'Vary': 'Origin'
  };
}

function sanitizeUsername(value) {
  return String(value || DEFAULT_USERNAME).replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 40) || DEFAULT_USERNAME;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractShortcode(url) {
  const match = String(url || '').match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : '';
}

function safeJsonString(value) {
  try { return JSON.parse(`"${value}"`); } catch (_) { return value; }
}
