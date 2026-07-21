# Podcast With You

让两个人异地同步听同一段播客:任一方按下播放 / 暂停 / seek,另一方实时跟随。
基于 **WebRTC DataChannel** 传输控制信号(每帧 < 100 字节),音频在双方各自本地播放,不传音频流,不消耗额外带宽。

## 输入支持

粘贴以下任一种链接即可创建房间:

| 链接 | 处理 |
| ---- | ---- |
| `https://www.xiaoyuzhoufm.com/episode/...` | Cloudflare Worker 解析 og:audio |
| `https://podcasts.apple.com/cn/...` | 同上 |
| `https://pod.link/...` | 同上 |
| `https://.../*.mp3` / `*.m4a` / `*.aac` / `*.ogg` / `*.wav` / `*.m3u8` 直链 | 直接播放 |

## 本地开发

需要两个终端:

**终端 A —— Cloudflare Worker(播客链接解析器)**:
```bash
cd worker
npm install
npm run dev      # http://127.0.0.1:8787
```

**终端 B —— 前端(Vite)**:
```bash
npm install
npm run dev      # http://localhost:5173
```

vite dev 通过 proxy 把 `/api/resolve/*` 转到 worker 的 8787 端口,你不需要额外配置。

## 部署

部署分两步:**Worker 部分**(用来解析小宇宙等链接) + **前端静态资源**(已经配好 GitHub Actions 自动部署)。

### 1. Worker 部分(解析小宇宙等)

部署到 Cloudflare Workers(免费),参见 [worker/README.md](./worker/README.md)的部署步骤。

总结:
```bash
cd worker
npm install
npx wrangler login        # 浏览器弹窗授权(就一次)
npx wrangler deploy
# 输出会显示 Worker URL,类似:
# https://podcast-resolver.<你的子域>.workers.dev
```

把 URL 填到根目录的 `.env`:
```
VITE_RESOLVE_URL=https://podcast-resolver.<你的子域>.workers.dev
```

### 2. 前端(已经配好)

推到 `main`,GitHub Actions 自动 build + 部署到 GitHub Pages:

```bash
git add .
git commit -m "..."
git push
```

部署地址:`https://<user>.github.io/<repo>/`(一般在 repo 的 Settings → Pages 查看)。

如果只支持直链 mp3 / m4a,可以跳过 Worker 部署 —— Worker 是空时,粘贴小宇宙 URL 会提示"解析失败,请用直链"。

## 完整使用流程(线上版)

1. 打开部署好的 Pages 链接
2. 粘贴一个播客链接(小宇宙 / Apple Podcasts / 直链都 OK)
3. 点"生成房间号" → 拿到 6 位房间号 + 邀请链接
4. 把链接发给对方
5. 进入房间,任一方播放/暂停/seek,另一方实时同步

## 工作原理

```
[手机 A (主持人)]                   [手机 B (参与者)]
     |                                     |
     |  peer.connect("pwy-XXXXXX-host")     |
     | <---------- WebRTC P2P ------->      |
     |                                     |
     |  { type: "track", url: "..." }       |   (同步当前播放内容)
     |  { type: "state", playing, time }    |   (播放状态 / 进度)
     |  { type: "seek",  time }             |   (拖动进度)
     |  { type: "rate",  rate }             |   (倍速)
     |                                     |
     |                                     |
[各自的 <audio src={url} />]       [各自的 <audio src={url} />]
[本地解码,本地播放]                [本地解码,本地播放]

URL 解析流程(只在创建房间时跑一次):
  [前端粘 URL] → [vite proxy → wrangler dev / production worker] → [fetch + og 提取] → JSON
```

信令用 [PeerJS 公共 broker](https://peerjs.com)(`0.peerjs.com`)。
URL 解析用 Cloudflare Worker,代码见 [`worker/`](./worker/)。

## 项目结构

```
src/                          前端 (React + Vite + TS)
  App.tsx                     路由 + 状态机
  main.tsx                    入口
  styles.css                  mobile-first CSS
  components/
    RoomGate.tsx              创建/加入入口
    Player.tsx                播放器卡片
  hooks/
    usePeerRoom.ts            PeerJS 连接管理
    useSyncPlayback.ts        本地 audio 事件 ↔ DataChannel 双向桥
  lib/
    sync.ts                   房间号 + 直链识别
    resolvePodcast.ts         调 Worker 的封装

worker/                       Cloudflare Worker(URL 解析)
  src/index.ts                fetch + 正则提取 og:audio
  wrangler.toml               部署配置
  README.md                   部署指南

.github/workflows/
  deploy.yml                  前端自动部署到 Pages

public/
  icon-{192,512}.png          PWA 图标
```

## 已知限制

1. **iOS Safari 后台断连**:WebRTC 几秒无前台会断。回到前台自动重连。
2. **不支持 YouTube / Spotify / 网易云**:反爬严苛 + 没有 og:audio meta。
3. **音频 CDN 防盗链**:小宇宙 CDN 允许跨域 `<audio>` 加载;如果哪天收紧,worker 加反代流约 30 行代码。
4. **PeerJS 公共 broker 限流**:有需要的话可以自建 server。

## License

MIT