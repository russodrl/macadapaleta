/**
 * Instagram Feed Plugin
 * Maçã da Paleta, @macadapaleta
 *
 * Frontend leve para mostrar as últimas postagens do Instagram.
 * Para buscar posts reais, informe workerUrl apontando para o Cloudflare Worker.
 * Sem worker, ele usa cache local, JSON local e fallback curado.
 */
(function () {
  'use strict';

  const DEFAULT_POSTS = [
    {
      id: 'DXr7SYAjNDJ',
      shortcode: 'DXr7SYAjNDJ',
      permalink: 'https://www.instagram.com/reel/DXr7SYAjNDJ/',
      thumbnail_url: 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=900&q=85&auto=format&fit=crop',
      caption: 'Terça é dia de chopp em dobro aqui no Maçã da Paleta. Chopp gelado, brasa acesa e bons momentos em Piracicaba.',
      timestamp: '',
      likes: 0,
      comments: 0,
      is_video: true
    },
    {
      id: 'DXNWGTOjWx1',
      shortcode: 'DXNWGTOjWx1',
      permalink: 'https://www.instagram.com/reel/DXNWGTOjWx1/',
      thumbnail_url: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=900&q=85&auto=format&fit=crop',
      caption: 'O Maçã da Paleta é o lugar ideal para compartilhar bons momentos com amigos e família.',
      timestamp: '',
      likes: 0,
      comments: 0,
      is_video: true
    },
    {
      id: 'DXNWhk6jZZj',
      shortcode: 'DXNWhk6jZZj',
      permalink: 'https://www.instagram.com/reel/DXNWhk6jZZj/',
      thumbnail_url: 'https://images.unsplash.com/photo-1558030006-450675393462?w=900&q=85&auto=format&fit=crop',
      caption: 'Cortes que chegam à mesa e chamam atenção no primeiro olhar. Sabor direto da brasa, no ponto certo.',
      timestamp: '',
      likes: 0,
      comments: 0,
      is_video: true
    },
    {
      id: 'DUoTSNPkr0U',
      shortcode: 'DUoTSNPkr0U',
      permalink: 'https://www.instagram.com/p/DUoTSNPkr0U/',
      thumbnail_url: 'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=900&q=85&auto=format&fit=crop',
      caption: 'Cardápio novo, mais opções, mais sabor e mais motivos para visitar o Maçã da Paleta.',
      timestamp: '',
      likes: 0,
      comments: 0,
      is_video: false
    },
    {
      id: 'DVWFAZIArb6',
      shortcode: 'DVWFAZIArb6',
      permalink: 'https://www.instagram.com/reel/DVWFAZIArb6/',
      thumbnail_url: 'https://images.unsplash.com/photo-1588168333986-5078d3ae3976?w=900&q=85&auto=format&fit=crop',
      caption: 'Cortes nobres no ponto perfeito para o seu paladar. Reservas pelo WhatsApp.',
      timestamp: '',
      likes: 0,
      comments: 0,
      is_video: true
    },
    {
      id: 'DWHnqP7EVVD',
      shortcode: 'DWHnqP7EVVD',
      permalink: 'https://www.instagram.com/reel/DWHnqP7EVVD/',
      thumbnail_url: 'https://images.unsplash.com/photo-1615937722923-67f6deaf2cc9?w=900&q=85&auto=format&fit=crop',
      caption: 'A casa está aberta. Cortes nobres, no ponto perfeito, do seu jeito.',
      timestamp: '',
      likes: 0,
      comments: 0,
      is_video: true
    }
  ];

  class InstagramFeed {
    constructor(options = {}) {
      this.username = options.username || 'macadapaleta';
      this.container = typeof options.container === 'string' ? document.querySelector(options.container) : options.container;
      this.workerUrl = (options.workerUrl || '').trim();
      this.fallbackJson = options.fallbackJson || 'instagram-plugin/instagram-fallback.json';
      this.count = Number(options.count || options.posts || 6);
      this.columns = Number(options.columns || 3);
      this.showCaption = options.showCaption !== false;
      this.showStats = options.showStats === true;
      this.openInNewTab = options.openInNewTab !== false;
      this.cacheMinutes = Number(options.cacheMinutes || 30);
      this.onLoad = typeof options.onLoad === 'function' ? options.onLoad : null;
      this.onError = typeof options.onError === 'function' ? options.onError : null;
      this.cacheKey = `ig-feed:${this.username}:${this.count}`;
    }

    async load() {
      if (!this.container) {
        console.error('InstagramFeed: container não encontrado');
        return [];
      }

      this.injectStyles();
      this.renderLoading();

      try {
        const cached = this.readCache();
        if (cached && cached.length) {
          this.render(cached, 'cache');
        }

        const posts = await this.fetchPosts();
        const normalized = this.normalizePosts(posts).slice(0, this.count);

        if (!normalized.length) throw new Error('Nenhum post retornado');

        this.writeCache(normalized);
        this.render(normalized, this.workerUrl ? 'instagram' : 'fallback');
        if (this.onLoad) this.onLoad(normalized);
        return normalized;
      } catch (error) {
        const fallback = this.normalizePosts(DEFAULT_POSTS).slice(0, this.count);
        this.render(fallback, 'fallback');
        if (this.onError) this.onError(error);
        return fallback;
      }
    }

    async fetchPosts() {
      if (this.workerUrl) {
        const url = new URL(this.workerUrl);
        url.searchParams.set('username', this.username);
        url.searchParams.set('count', String(this.count));
        const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Worker retornou ${response.status}`);
        const data = await response.json();
        if (data && data.posts) return data.posts;
        if (Array.isArray(data)) return data;
      }

      const response = await fetch(this.fallbackJson, { headers: { Accept: 'application/json' } });
      if (response.ok) {
        const data = await response.json();
        if (data && data.posts) return data.posts;
        if (Array.isArray(data)) return data;
      }

      return DEFAULT_POSTS;
    }

    normalizePosts(posts) {
      return (posts || []).map((post, index) => {
        const shortcode = post.shortcode || post.code || post.id || `post-${index}`;
        const permalink = post.permalink || post.url || `https://www.instagram.com/p/${shortcode}/`;
        return {
          id: post.id || shortcode,
          shortcode,
          permalink,
          thumbnail_url: post.thumbnail_url || post.thumbnail || post.display_url || post.image || '',
          caption: this.cleanText(post.caption || post.title || ''),
          timestamp: post.timestamp || post.taken_at || post.date || '',
          likes: Number(post.likes || post.like_count || 0),
          comments: Number(post.comments || post.comment_count || 0),
          is_video: Boolean(post.is_video || post.type === 'video' || permalink.includes('/reel/'))
        };
      }).filter(post => post.permalink);
    }

    render(posts, source) {
      const target = this.openInNewTab ? ' target="_blank" rel="noopener"' : '';
      const items = posts.map(post => {
        const caption = this.escapeHtml(this.truncate(post.caption || 'Ver postagem no Instagram', 110));
        const image = post.thumbnail_url ? `<img src="${this.escapeAttr(post.thumbnail_url)}" alt="${caption}" loading="lazy" decoding="async">` : `<div class="ig-feed-placeholder">@${this.username}</div>`;
        const stats = this.showStats ? `<div class="ig-feed-stats">${post.likes ? `♥ ${post.likes}` : ''}${post.comments ? ` · 💬 ${post.comments}` : ''}</div>` : '';
        return `
          <a href="${this.escapeAttr(post.permalink)}"${target} class="ig-feed-item" aria-label="Abrir post do Instagram">
            ${image}
            ${post.is_video ? '<span class="ig-feed-video-badge">▶ Reel</span>' : ''}
            <span class="ig-feed-overlay">
              <span class="ig-feed-icon">◎</span>
              ${this.showCaption ? `<span class="ig-feed-caption">${caption}</span>` : ''}
              ${stats}
            </span>
          </a>`;
      }).join('');

      const sourceLabel = source === 'instagram' ? 'Atualizado automaticamente' : 'Feed com fallback seguro';
      this.container.innerHTML = `
        <div class="ig-feed-header">
          <a href="https://www.instagram.com/${this.username}/" target="_blank" rel="noopener">@${this.username} no Instagram</a>
          <p>${sourceLabel}. Clique em uma foto para abrir no Instagram.</p>
        </div>
        <div class="ig-feed-grid" style="--ig-columns:${this.columns}">${items}</div>`;
    }

    renderLoading() {
      this.container.innerHTML = `
        <div class="ig-feed-header"><p>Carregando últimas postagens...</p></div>
        <div class="ig-feed-grid" style="--ig-columns:${this.columns}">
          ${Array.from({ length: this.count }).map(() => '<div class="ig-feed-skeleton"></div>').join('')}
        </div>`;
    }

    readCache() {
      try {
        const raw = localStorage.getItem(this.cacheKey);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        const age = Date.now() - cached.savedAt;
        if (age > this.cacheMinutes * 60 * 1000) return null;
        return cached.posts;
      } catch (_) {
        return null;
      }
    }

    writeCache(posts) {
      try {
        localStorage.setItem(this.cacheKey, JSON.stringify({ savedAt: Date.now(), posts }));
      } catch (_) {}
    }

    injectStyles() {
      if (document.getElementById('instagram-feed-plugin-styles')) return;
      const style = document.createElement('style');
      style.id = 'instagram-feed-plugin-styles';
      style.textContent = `
        .ig-feed-header { text-align:center; margin-bottom:24px; }
        .ig-feed-header a { color:var(--accent-gold,#cd853f); text-decoration:none; font-weight:700; font-size:1.1rem; }
        .ig-feed-header p { color:var(--text-muted,#999); margin-top:8px; font-size:.95rem; }
        .ig-feed-grid { display:grid; grid-template-columns:repeat(var(--ig-columns,3),minmax(0,1fr)); gap:14px; max-width:100%; }
        .ig-feed-item, .ig-feed-skeleton { position:relative; overflow:hidden; border-radius:18px; aspect-ratio:1; background:#1d1d1d; box-shadow:0 12px 35px rgba(0,0,0,.28); }
        .ig-feed-item { display:block; text-decoration:none; color:#fff; transform:translateZ(0); }
        .ig-feed-item img { width:100%; height:100%; object-fit:cover; display:block; transition:transform .45s ease, filter .45s ease; }
        .ig-feed-item:hover img { transform:scale(1.08); filter:saturate(1.12) contrast(1.06); }
        .ig-feed-overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:18px; text-align:center; background:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.82)); opacity:0; transition:opacity .3s ease; }
        .ig-feed-item:hover .ig-feed-overlay { opacity:1; }
        .ig-feed-icon { font-size:34px; line-height:1; font-weight:700; }
        .ig-feed-caption { display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; font-size:13px; line-height:1.35; color:#fff; }
        .ig-feed-stats { font-size:12px; color:#f2d0a8; }
        .ig-feed-video-badge { position:absolute; top:10px; right:10px; background:rgba(0,0,0,.72); color:#fff; border:1px solid rgba(255,255,255,.18); padding:5px 9px; border-radius:999px; font-size:12px; font-weight:700; }
        .ig-feed-placeholder { height:100%; display:flex; align-items:center; justify-content:center; color:#cd853f; font-weight:700; background:radial-gradient(circle at 20% 20%,#40220d,#111 65%); }
        .ig-feed-skeleton { animation:igPulse 1.2s ease-in-out infinite; }
        @keyframes igPulse { 0%,100%{opacity:.45} 50%{opacity:1} }
        @media (max-width:768px) { .ig-feed-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; } }
      `;
      document.head.appendChild(style);
    }

    truncate(text, maxLen) {
      if (!text) return '';
      return text.length > maxLen ? text.slice(0, maxLen - 1).trim() + '…' : text;
    }

    cleanText(text) {
      return String(text || '').replace(/\s+/g, ' ').trim();
    }

    escapeHtml(value) {
      return String(value || '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    }

    escapeAttr(value) {
      return this.escapeHtml(value).replace(/'/g, '&#039;');
    }

    refresh() {
      localStorage.removeItem(this.cacheKey);
      return this.load();
    }
  }

  window.InstagramFeed = InstagramFeed;

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-instagram-feed]').forEach(el => {
      new InstagramFeed({
        container: el,
        username: el.dataset.igUsername || 'macadapaleta',
        workerUrl: el.dataset.igWorker || '',
        fallbackJson: el.dataset.igFallback || 'instagram-plugin/instagram-fallback.json',
        count: el.dataset.igCount || 6,
        columns: el.dataset.igColumns || 3,
        showCaption: el.dataset.igCaption !== 'false',
        showStats: el.dataset.igStats === 'true'
      }).load();
    });
  });
})();
