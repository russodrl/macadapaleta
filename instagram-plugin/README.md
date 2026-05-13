# Plugin de Instagram, Maçã da Paleta

Este plugin exibe as últimas postagens do perfil `@macadapaleta` no site.

## Como funciona

- `instagram-feed.js`: roda no site, renderiza o grid e tenta buscar posts atualizados.
- `instagram-worker.js`: Cloudflare Worker opcional, usado para buscar posts reais do Instagram com cache.
- `instagram-fallback.json`: fallback local, garante que a seção nunca fique vazia.

## Uso no HTML

```html
<div id="instagram-feed"></div>
<script src="instagram-plugin/instagram-feed.js"></script>
<script>
new InstagramFeed({
  container: '#instagram-feed',
  username: 'macadapaleta',
  workerUrl: 'https://SEU-WORKER.workers.dev',
  count: 6,
  columns: 3,
  showCaption: true,
  showStats: false
}).load();
</script>
```

Se `workerUrl` ficar vazio, o plugin usa `instagram-fallback.json` e posts curados.

## Deploy do Worker

```bash
cd instagram-plugin
npx wrangler login
npx wrangler deploy
```

Configurar segredo opcional para melhorar a chance de capturar posts reais:

```bash
npx wrangler secret put INSTAGRAM_SESSIONID
```

Use um `sessionid` de uma conta secundária, nunca da conta principal do cliente.

## Observações importantes

- O Instagram bloqueia automações com frequência.
- O Worker tem cache de 1 hora para evitar bloqueios.
- O site sempre continua funcionando por causa do fallback local.
- Para produção, recomendo Cloudflare Worker com uma conta secundária de Instagram só para leitura.
