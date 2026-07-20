# podcast_with_you - 项目规范

## 用途
两个人异地同步听同一段播客:任一方按下播放/暂停/seek,另一方实时跟随。
通过 WebRTC DataChannel 仅传输控制信号(几十字节/秒),音频在双方各自本地播放。

## 技术栈
- Vite + React 18 + TypeScript
- PeerJS (WebRTC 封装,使用公共 broker 0.peerjs.com,无后端)
- HTMLAudioElement + Media Session API (锁屏控件)
- 无后端、无数据库、无构建产物部署依赖 (构建后纯静态)

## 目录结构
src/
  components/        复用 UI (PlayButton、RoomPanel 等)
  hooks/             自定义 hooks (usePeerRoom、useSyncPlayback)
  lib/               纯工具 (sync、podcastUrl、roomId)
  App.tsx            路由 + 主界面
  main.tsx           入口
public/              静态资源、icons

## 常用命令
- 开发: npm run dev -> http://localhost:5173
- 构建: npm run build -> dist/
- 预览: npm run preview
- 类型检查: tsc --noEmit

## 关键约定
1. 不要引入后端依赖: 这是项目核心约束。
2. 移动端优先: CSS 默认按 mobile-first;触摸目标 >= 44px。
3. PWA: 通过 vite-plugin-pwa 启用。
4. 同步协议: JSON over DataChannel,消息形态 { type, payload, t }。
5. 不要写测试除非用户要求。

## 不做
- 系统音频流共享 (iOS/Android web 端无 API,违反项目假设)
- 用户系统、登录、持久化 (本项目纯前端,刷新即丢)
- 复杂播客目录 (只支持输入 URL,不强做 Apple Podcasts 全库)
