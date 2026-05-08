# Instagram Feed Plugin for @macadapaleta

A lightweight, dependency-free JavaScript plugin that fetches and displays Instagram posts in a responsive grid. Uses a Cloudflare Worker as a CORS proxy/cache to bypass browser restrictions.

## Files

- **`instagram-feed.js`** — Frontend plugin (UMD module, works in any setup)
- **`instagram-worker.js`** — Cloudflare Worker backend (CORS proxy + caching)
- **`instagram-embed.html`** — Standalone demo/test page
- **`README.md`** — This file

## Quick Start

### 1. Deploy the Cloudflare Worker

**Prerequisites:** [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) installed and authenticated.

```bash
# Create a wrangler.toml in instagram-plugin/
cat > wrangler.toml << 'EOF'
name = "instagram-feed"
main = "instagram-worker.js"
compatibility_date = "2024-01-01"

[vars]
INSTAGRAM_USERNAME = "macadapaleta"
CACHE_TTL_SECONDS = "3600"
ALLOWED_ORIGINS = "*"
EOF

# Deploy
wrangler deploy
```

Note the output URL, e.g. `https://instagram-feed.your-subdomain.workers.dev`.

### 2. Add the Plugin to Your Page

**Option A: Script tag + JavaScript API**

```html
<script src="instagram-feed.js"></script>
<div id="my-feed"></div>
<script>
  const feed = new InstagramFeed({
    container: '#my-feed',
    username: 'macadapaleta',
    workerUrl: 'https://instagram-feed.your-subdomain.workers.dev',
    count: 9,
    columns: 3,
  });
  feed.load();
</script>
```

**Option B: Data attributes (auto-init)**

```html
<script src="instagram-feed.js"></script>
<div
  data-instagram-feed
  data-ig-username="macadapaleta"
  data-ig-worker="https://instagram-feed.your-subdomain.workers.dev"
  data-ig-count="9"
  data-ig-columns="3"
></div>
```

## Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `container` | string/DOMElement | — | CSS selector or element (required) |
| `workerUrl` | string | — | Cloudflare Worker URL (required) |
| `username` | string | `macadapaleta` | Instagram username |
| `count` | number | `9` | Number of posts to fetch |
| `columns` | number | `3` | Grid columns (1–6) |
| `gap` | number | `8` | Grid gap in pixels |
| `showCaption` | boolean | `false` | Show caption overlay on hover |
| `captionLength` | number | `100` | Max caption characters |
| `showStats` | boolean | `false` | Show likes/comments count |
| `openInNewTab` | boolean | `true` | Open posts in new tab |
| `lazyLoad` | boolean | `true` | Lazy load images via IntersectionObserver |
| `onLoad` | function | `null` | Callback: `function(posts) {}` |
| `onError` | function | `null` | Callback: `function(error) {}` |
| `onPostClick` | function | `null` | Callback: `function(post, event) {}` — return `false` to prevent navigation |

## Methods

```js
const feed = new InstagramFeed(options);

feed.load();       // Fetch and render — returns Promise<posts>
feed.refresh();    // Re-fetch and re-render
feed.destroy();    // Remove widget and clean up
feed.update({ count: 12 }); // Update options and re-render
```

## Data Attributes

When using the auto-init approach, configure via these attributes:

- `data-instagram-feed` — marks the element for auto-init
- `data-ig-username` — Instagram username
- `data-ig-worker` — Worker URL
- `data-ig-count` — Number of posts
- `data-ig-columns` — Grid columns
- `data-ig-gap` — Grid gap (px)
- `data-ig-caption` — Show captions (`"true"` / `"false"`)
- `data-ig-stats` — Show stats (`"true"` / `"false"`)

## Cloudflare Worker Details

The worker tries multiple strategies to fetch Instagram data:

1. **Instagram GraphQL API** (`i.instagram.com`) — Best quality data; may require valid session cookies
2. **oEmbed API** — Scrapes post shortcodes from profile HTML, then uses oEmbed for metadata
3. **RSS Bridge** — Falls back to public RSS bridge instances
4. **Hardcoded fallback** — Returns placeholder posts if all strategies fail

### Worker Environment Variables

| Variable | Default | Description |
|---|---|---|
| `INSTAGRAM_USERNAME` | `macadapaleta` | Default username |
| `CACHE_TTL_SECONDS` | `3600` | Cache duration (1 hour) |
| `ALLOWED_ORIGINS` | `*` | Comma-separated allowed origins |

### Rate Limiting

The worker enforces 30 requests/minute per IP address. Returns HTTP 429 when exceeded.

### Response Format

```json
{
  "posts": [
    {
      "id": "1234567890",
      "shortcode": "ABC123",
      "permalink": "https://www.instagram.com/p/ABC123/",
      "thumbnail_url": "https://...",
      "caption": "Post text here",
      "timestamp": "2024-01-15T12:00:00.000Z",
      "likes": 150,
      "comments": 12,
      "is_video": false,
      "video_url": null,
      "dimensions": { "width": 1080, "height": 1080 }
    }
  ],
  "cached": false,
  "source": "graphql"
}
```

## Demo Page

Open `instagram-embed.html` in a browser to test the plugin interactively. Enter your deployed Worker URL and click "Load Feed".

## Notes

- Instagram has significantly restricted public API access. The GraphQL strategy may fail without valid authentication. The worker degrades gracefully through fallback strategies.
- For production use, consider using the [Instagram Basic Display API](https://developers.facebook.com/docs/instagram-basic-display-api) or [Instagram Graph API](https://developers.facebook.com/docs/instagram-api) with a proper Facebook App for reliable access.
- The worker caches responses in-memory (per isolate). On cold starts, the cache is empty. For persistent caching, consider adding Cloudflare KV or Cache API.
- All strategies respect rate limits and include proper error handling.

## License

MIT
