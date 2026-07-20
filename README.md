# Podcast With You

让两个人异地同步听同一段播客:任一方按下播放 / 暂停 / seek,另一方实时跟随。
基于 **WebRTC DataChannel** 传输控制信号(每帧 < 100 字节),音频在双方各自本地播放,不传音频流,不消耗额外带宽。

## 使用

### 主持人(host)流程

1. 打开部署后的页面(首次使用)
2. 在「创建」标签里粘贴一个播客音频 URL(支持 `mp3` / `m4a` / `aac` / `ogg` / `wav` / `m3u8` 直链)
3. 点「生成房间号」获得 6 位房间号 + 邀请链接
4. 把邀请链接(或房间号)发给对方
5. 点「进入房间」开始

### 参与者(guest)流程

1. 点击主持人发来的链接(URL 自动带 `?room=ABCXYZ`)
2. 页面自动切换到「加入」模式,房间号已预填
3. 点「加入房间」即开始同步

或者手动:直接在「加入」标签填入对方给的房间号。

### 同步什么

| 操作 | 是否同步 |
| ---- | -------- |
| 主持人选播的音频 URL | 自动(参与者无需自己找) |
| 播放 / 暂停 | 实时 |
| 拖动进度条 (seek) | 实时 |
| 倍速 (1x / 1.25x / 1.5x / 1.75x / 2x) | 实时 |
| 锁屏 / 通知栏上的 Media Session 控件 | 同步触发 |

任一方控制都行,不强制主从。

## 开发

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 输出到 dist/
npm run preview  # 本地预览生产构建
```

## 部署

这是个纯静态网站。`npm run build` 生成的 `dist/` 可以丢到任何静态托管上:

- **Vercel / Netlify**:直接拖 dist/ 或者 `vercel --prod` / `netlify deploy --prod --dir=dist`
- **GitHub Pages**:把 dist/ 推到 `gh-pages` 分支
- **自有服务器**:Nginx `root` 指向 `dist/`,配置 SPA fallback 重写所有路径到 `index.html`(可选,本项目主路径只有 `/`)
- **手机装到桌面**:首次用浏览器打开,然后 "添加到主屏幕" — vite-plugin-pwa 已注册 service worker,会按 PWA 标准运行

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
```

信令用 [PeerJS 公共 broker](https://peerjs.com)(`0.peerjs.com`)。如果不想依赖公共服务,可以自建 PeerJS server,改 `usePeerRoom.ts` 里 `new Peer(...)` 的参数。

## 项目结构

```
src/
  App.tsx               路由 + 主壳
  main.tsx              入口
  styles.css            mobile-first CSS
  components/
    RoomGate.tsx        创建/加入房间入口
    Player.tsx          播放器卡片
  hooks/
    usePeerRoom.ts      PeerJS 连接管理
    useSyncPlayback.ts  本地 audio 事件 ↔ DataChannel 消息双向桥接
  lib/
    sync.ts             共享类型 + 房间号生成
public/
  icon-{192,512}.png    PWA 图标
  apple-touch-icon.png  iOS 主屏幕图标
```

## 已知限制

1. **iOS Safari 不支持后台 WebRTC 持续传输** — 切到后台几秒后连接可能断开,回到前台会通过 `peer.on("disconnected")` 自动重连。重要场合建议双方都保持前台。
2. **音频源必须是直链 URL**。Apple Podcasts / 喜马拉雅等客户端锁了 DRM 或者不带直链,需要先下载 `mp3` 到自己的服务器。
3. **房间号 6 位**,理论上有 32^6 ≈ 10 亿种组合,但同一时段内可能撞号。如需要,可在 `lib/sync.ts` 把 `makeRoomCode` 长度调成 8 位。
4. **CORS**:某些音频站会因为 CORS 拒绝跨域拉取。Manifest 里已经设 `crossOrigin="anonymous"`。如果遇到跨域问题,用反代或者自己的 CDN。

## License

MIT