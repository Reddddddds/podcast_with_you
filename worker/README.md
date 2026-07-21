# podcast-resolver (Cloudflare Worker)

播客链接解析器,部署到 Cloudflare Workers(免费层每天 10 万次请求)。

把"小宇宙 / Apple Podcasts / pod.link"等链接解析成可直接 `<audio src>` 播放的 m4a / mp3 直链。

调用:
```
GET /?url=<encoded podcast url>
→ 200 { ok: true, audioUrl, title, image, sourceType }
→ 4xx { ok: false, code, reason }
```

支持输入:
- **小宇宙**:`https://www.xiaoyuzhoufm.com/episode/...`(核心支持)
- **Apple Podcasts**:`https://podcasts.apple.com/cn/podcast/...`
- **pod.link / Pocket Casts**:`https://pod.link/...`
- **直接音频 URL**:`*.mp3` / `*.m4a` / `*.aac` / `*.ogg` / `*.wav` / `*.m3u8`(直接放行)
- 不支持(返回 404):Spotify / YouTube / Bilibili(都反爬严苛,且没有 og:audio 资源)

## 部署步骤

### 一次性

1. 注册 Cloudflare 账号(免费):[dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up),不用绑卡

2. 拿 API 权限:在本地电脑跑
   ```bash
   npx wrangler login
   ```
   浏览器弹窗授权。这个把 OAuth 凭据缓存到 `~/.wrangler/config/default.toml`,**不需要 token**。

3. 在 worker 目录装依赖:
   ```bash
   cd worker
   npm install
   ```

4. 部署:
   ```bash
   npx wrangler deploy
   ```
   成功后 console 会显示 `Published podcast-resolver (...)` 和 URL `https://podcast-resolver.<你的子域>.workers.dev`

5. 把 Worker URL 配到前端:
   在项目根目录建 `.env`:
   ```bash
   VITE_RESOLVE_URL=https://podcast-resolver.<你的子域>.workers.dev
   ```
   然后 `npm run build` 推到 GitHub Pages 就生效了。

### 本地开发(可选)

两终端:

终端 A:
```bash
cd worker
npm run dev       # 在 http://127.0.0.1:8787
```

终端 B:
```bash
npm run dev       # vite 在 :5173,自动通过 proxy 调 worker
```

vite.config.ts 已配:`/api/resolve/*` → `127.0.0.1:8787/*`

## 文件清单

```
worker/
  package.json     wrangler + tsx
  tsconfig.json    Worker TS 配置
  wrangler.toml    部署配置(无 token)
  src/index.ts     Worker 主体
```

## 代码做了什么

```ts
fetch(target_url, {
  headers: {
    "User-Agent": "...Safari/17...",
    "Referer": target_origin + "/"  // 防盗链关键
  }
})
→ 正则提 og:audio / og:title / og:image
→ 兜底找 <link rel="enclosure" href="...">
→ 返回 JSON
```

小宇宙和 Apple Podcasts 都遵循 Open Graph 协议,SSR HTML 里就有 og:audio,所以不需要 cheerio 这种重武器,纯正则就够。

## 关于防盗链

- 小宇宙的音频 CDN 是 `media.xyzcdn.net`,**实测对 `<audio>` 标签跨域是允许的** —— 无需反代流。
- Worker 没反代音频流,只反代 HTML 解析 og。这是和 yenche123/podcast-together 同样的做法。
- 如果哪天防盗链收紧(403),再加一个 `?proxy=1` 选项让 Worker 流转发音频字节即可(改 30 行)。

## 限额与监控

- 免费层:10 万次/天,够个人 / 中等团队用一年。
- 超限:返回 429,你也不用做什么。
- 看实时日志:`npx wrangler tail`