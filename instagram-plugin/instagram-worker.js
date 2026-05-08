/**
 * Instagram Feed - Cloudflare Worker (CORS Proxy & Cache)
 *
 * Deploy: wrangler deploy
 * This worker fetches Instagram posts via multiple strategies and caches
 * responses in-memory (1 hour). It returns a normalized JSON array of posts.
 *
 * Environment variables (set via wrangler.toml or dashboard):
 *   INSTAGRAM_USERNAME - target username (default: macadapaleta)
 *   CACHE_TTL_SECONDS  - cache TTL in seconds (default: 3600)
 *   ALLOWED_ORIGINS    - comma-separated allowed origins (default: *)
 */

const DEFAULT_USERNAME = 'macadapaleta';
const DEFAULT_CACHE_TTL = 3600; // 1 hour

// In-memory cache (persists per worker isolate, resets on cold start)
const cache = new Map();

/**
 * Main fetch handler
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const username = env.INSTAGRAM_USERNAME || url.searchParams.get('username') || DEFAULT_USERNAME;
    const count = parseInt(url.searchParams.get('count') || '12', 10);
    const cacheTTL = parseInt(env.CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL, 10);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request, env);
    }

    // Only allow GET
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405, request, env);
    }

    // Rate limiting: basic key = IP
    const clientIP = request.headers.get('cf-connecting-ip') || 'unknown';
    if (isRateLimited(clientIP)) {
      return jsonResponse({ error: 'Rate limited. Try again later.' }, 429, request, env);
    }

    // Check cache
    const cacheKey = `ig:${username}:${count}`;
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < cacheTTL * 1000) {
      return jsonResponse({ posts: cached.data, cached: true, source: cached.source }, 200, request, env);
    }

    // Try strategies in order
    let result = null;
    let source = 'unknown';

    // Strategy 1: Instagram GraphQL (i.instagram.com)
    try {
      result = await fetchViaGraphQL(username, count);
      source = 'graphql';
    } catch (e) {
      console.log('GraphQL strategy failed:', e.message);
    }

    // Strategy 2: oEmbed approach (limited - only gets post URLs from profile page scrape)
    if (!result || result.length === 0) {
      try {
        result = await fetchViaOembed(username, count);
        source = 'oembed';
      } catch (e) {
        console.log('oEmbed strategy failed:', e.message);
      }
    }

    // Strategy 3: RSS Bridge fallback
    if (!result || result.length === 0) {
      try {
        result = await fetchViaRSSBridge(username, count);
        source = 'rssbridge';
      } catch (e) {
        console.log('RSS Bridge strategy failed:', e.message);
      }
    }

    // Strategy 4: Hardcoded fallback
    if (!result || result.length === 0) {
      result = getHardcodedPosts(username);
      source = 'hardcoded';
    }

    // Cache the result
    cache.set(cacheKey, { data: result, timestamp: Date.now(), source });

    return jsonResponse({ posts: result, cached: false, source }, 200, request, env);
  }
};

// ─── Strategy 1: Instagram GraphQL ─────────────────────────────────────────

async function fetchViaGraphQL(username, count) {
  // Step 1: Get user ID via web profile info
  const userResp = await fetch(
    `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
    {
      headers: {
        'User-Agent': 'Instagram 275.0.0.27.98 Android (30/11; 420dpi; 1080x2400; samsung; SM-A515F; a51; exynos9611; en_US; 458229258)',
        'X-IG-App-ID': '936619743392459',
        'Accept': '*/*',
        'Accept-Language': 'en-US',
      },
    }
  );

  if (!userResp.ok) throw new Error(`Web profile request failed: ${userResp.status}`);

  const userData = await userResp.json();
  const edges = userData?.data?.user?.edge_owner_to_timeline_media?.edges;

  if (!edges || edges.length === 0) throw new Error('No posts found in GraphQL response');

  return edges.slice(0, count).map(edge => {
    const node = edge.node;
    return {
      id: node.id,
      shortcode: node.shortcode,
      permalink: `https://www.instagram.com/p/${node.shortcode}/`,
      thumbnail_url: node.thumbnail_src || node.display_url,
      caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
      timestamp: new Date(node.taken_at_timestamp * 1000).toISOString(),
      likes: node.edge_liked_by?.count || 0,
      comments: node.edge_media_to_comment?.count || 0,
      is_video: node.is_video || false,
      video_url: node.video_url || null,
      dimensions: node.dimensions || { width: 1080, height: 1080 },
    };
  });
}

// ─── Strategy 2: oEmbed Approach ───────────────────────────────────────────

async function fetchViaOembed(username, count) {
  // Fetch the profile page HTML to extract post shortcodes
  const profileResp = await fetch(`https://www.instagram.com/${username}/`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    redirect: 'follow',
  });

  if (!profileResp.ok) throw new Error(`Profile page fetch failed: ${profileResp.status}`);

  const html = await profileResp.text();

  // Extract shortcodes from HTML
  const shortcodeRegex = /"shortcode":"([A-Za-z0-9_-]+)"/g;
  const shortcodes = [];
  let match;
  while ((match = shortcodeRegex.exec(html)) !== null) {
    if (!shortcodes.includes(match[1])) {
      shortcodes.push(match[1]);
    }
  }

  if (shortcodes.length === 0) throw new Error('No shortcodes found in profile page');

  // Use oEmbed for each shortcode to get metadata
  const posts = [];
  for (const shortcode of shortcodes.slice(0, count)) {
    try {
      const oembedResp = await fetch(
        `https://api.instagram.com/oembed/?url=https://www.instagram.com/p/${shortcode}/&omitscript=true`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; InstagramFeedBot/1.0)',
          },
        }
      );

      if (oembedResp.ok) {
        const data = await oembedResp.json();
        posts.push({
          id: shortcode,
          shortcode: shortcode,
          permalink: `https://www.instagram.com/p/${shortcode}/`,
          thumbnail_url: data.thumbnail_url || '',
          caption: data.title || '',
          timestamp: data.upload_date || new Date().toISOString(),
          likes: 0,
          comments: 0,
          is_video: false,
          video_url: null,
          dimensions: { width: data.thumbnail_width || 1080, height: data.thumbnail_height || 1080 },
        });
      }
    } catch (e) {
      // Skip individual post failures
      console.log(`oEmbed failed for ${shortcode}:`, e.message);
    }
  }

  return posts;
}

// ─── Strategy 3: RSS Bridge ────────────────────────────────────────────────

async function fetchViaRSSBridge(username, count) {
  // Try multiple public RSS Bridge instances
  const bridges = [
    `https://rss.app/feeds/v1.1/ig/${username}.json`,
    `https://rsshub.app/instagram/user/${username}`,
    `https://bridge.suumitsa.social/?action=display&bridge=Instagram&u=${username}&format=json`,
  ];

  for (const bridgeUrl of bridges) {
    try {
      const resp = await fetch(bridgeUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; InstagramFeedBot/1.0)',
          'Accept': 'application/json, application/rss+xml, application/xml, text/xml',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) continue;

      const contentType = resp.headers.get('content-type') || '';
      const text = await resp.text();

      if (contentType.includes('json')) {
        const data = JSON.parse(text);
        // Try common JSON structures
        const items = data.items || data.data || data.posts || [];
        if (items.length > 0) {
          return items.slice(0, count).map(item => ({
            id: item.id || item.guid || item.link?.split('/p/')?.[1]?.replace('/', '') || Math.random().toString(36).slice(2),
            shortcode: item.link?.split('/p/')?.[1]?.replace('/', '') || '',
            permalink: item.link || item.url || '',
            thumbnail_url: item.thumbnail || item.image || item.enclosure?.url || '',
            caption: item.title || item.description || item.caption || '',
            timestamp: item.pubDate || item.published || item.date || new Date().toISOString(),
            likes: 0,
            comments: 0,
            is_video: false,
            video_url: null,
            dimensions: { width: 1080, height: 1080 },
          }));
        }
      } else if (contentType.includes('xml') || text.trim().startsWith('<?xml') || text.trim().startsWith('<rss')) {
        // Parse RSS/XML
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        const posts = [];
        let itemMatch;
        while ((itemMatch = itemRegex.exec(text)) !== null && posts.length < count) {
          const itemXml = itemMatch[1];
          const title = extractXmlTag(itemXml, 'title') || '';
          const link = extractXmlTag(itemXml, 'link') || '';
          const pubDate = extractXmlTag(itemXml, 'pubDate') || '';
          const description = extractXmlTag(itemXml, 'description') || '';
          const enclosureMatch = itemXml.match(/<enclosure[^>]+url="([^"]+)"/);
          const thumbnail = enclosureMatch ? enclosureMatch[1] : '';

          posts.push({
            id: link.split('/p/')?.[1]?.replace('/', '') || Math.random().toString(36).slice(2),
            shortcode: link.split('/p/')?.[1]?.replace('/', '') || '',
            permalink: link,
            thumbnail_url: thumbnail,
            caption: title || description,
            timestamp: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
            likes: 0,
            comments: 0,
            is_video: false,
            video_url: null,
            dimensions: { width: 1080, height: 1080 },
          });
        }
        if (posts.length > 0) return posts;
      }
    } catch (e) {
      console.log(`RSS Bridge ${bridgeUrl} failed:`, e.message);
    }
  }

  throw new Error('All RSS Bridge attempts failed');
}

function extractXmlTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

// ─── Strategy 4: Hardcoded Fallback ────────────────────────────────────────

function getHardcodedPosts(username) {
  // These are placeholder posts - replace with real data if API access changes
  return [
    {
      id: 'fallback_1',
      shortcode: 'example1',
      permalink: `https://www.instagram.com/${username}/`,
      thumbnail_url: '',
      caption: '🧊 ¡Paletas artesanales de Macadania! Sabor único y natural 🌿',
      timestamp: new Date().toISOString(),
      likes: 0,
      comments: 0,
      is_video: false,
      video_url: null,
      dimensions: { width: 1080, height: 1080 },
    },
    {
      id: 'fallback_2',
      shortcode: 'example2',
      permalink: `https://www.instagram.com/${username}/`,
      thumbnail_url: '',
      caption: '🍫 Chocolate y macadamia: la combinación perfecta',
      timestamp: new Date(Date.now() - 86400000).toISOString(),
      likes: 0,
      comments: 0,
      is_video: false,
      video_url: null,
      dimensions: { width: 1080, height: 1080 },
    },
    {
      id: 'fallback_3',
      shortcode: 'example3',
      permalink: `https://www.instagram.com/${username}/`,
      thumbnail_url: '',
      caption: '🌴 Naturaleza en cada bocado. Hecho con amor ❤️',
      timestamp: new Date(Date.now() - 172800000).toISOString(),
      likes: 0,
      comments: 0,
      is_video: false,
      video_url: null,
      dimensions: { width: 1080, height: 1080 },
    },
  ];
}

// ─── Rate Limiting ─────────────────────────────────────────────────────────

const rateLimitMap = new Map();
const RATE_LIMIT = 30; // requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

function isRateLimited(key) {
  const now = Date.now();
  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return false;
  }

  const entry = rateLimitMap.get(key);
  if (now - entry.windowStart > RATE_WINDOW) {
    entry.count = 1;
    entry.windowStart = now;
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT;
}

// ─── CORS & Response Helpers ───────────────────────────────────────────────

function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '*';
  const allowedOrigins = (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
  const allowedOrigin = allowedOrigins.includes('*') ? origin : (
    allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
  );

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
  };
}

function handleOptions(request, env) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request, env),
  });
}

function jsonResponse(data, status, request, env) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...getCorsHeaders(request, env),
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${DEFAULT_CACHE_TTL}`,
    },
  });
}
