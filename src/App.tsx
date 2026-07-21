import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoomGate } from "./components/RoomGate";
import { Player } from "./components/Player";
import { usePollingRoom } from "./hooks/usePollingRoom";
import { useSyncPlayback } from "./hooks/useSyncPlayback";
import type { IPlayerState } from "./hooks/useSyncPlayback";
import { buildShareLink, describeAudioUrl, isDirectAudioUrl, readRoomFromUrl } from "./lib/sync";

type Screen = "home" | "room";
type Role = null | "host" | "guest";

const initialState: IPlayerState = {
  url: null,
  title: null,
  playing: false,
  currentTime: 0,
  duration: 0,
  rate: 1,
  loading: false,
  error: null,
};

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [urlInput, setUrlInput] = useState("");
  const [playerState, setPlayerState] = useState<IPlayerState>(initialState);
  // 直接用 ref,删了 audioEl state。useSyncPlayback 接 ref object 后永远拿到最新 element。
  const audioContainerRef = useRef<HTMLAudioElement | null>(null);

  const room = usePollingRoom({ roomCode });

  // URL 一就位就推一次(KV 持久化当前播客)。不依赖 partnerConnected。
  useEffect(() => {
    if (!roomCode || !playerState.url) return;
    room.send({
      type: "track",
      payload: { url: playerState.url, title: playerState.title ?? undefined },
      t: Date.now(),
    });
    room.send({
      type: "state",
      payload: { playing: playerState.playing, currentTime: playerState.currentTime, rate: playerState.rate },
      t: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, playerState.url]);

  const { publishTrack, broadcastState } = useSyncPlayback(
    audioContainerRef,                    // ← 传 ref 而非 state
    playerState,
    setPlayerState,
    room.send,
    room.onMessage,
    room.partnerConnected
  );

  // 初次挂载:从 URL 预填房间号 -> guest 角色
  useEffect(() => {
    if (typeof window === "undefined") return;
    const code = readRoomFromUrl(window.location.href);
    if (code) {
      setRoomCode(code);
      setRole("guest");
    }
  }, []);

  // Media Session:锁屏控件
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: playerState.title ?? "Podcast With You",
        artist: "一起听",
      });
      const a = audioContainerRef.current;
      if (!a) return;
      navigator.mediaSession.setActionHandler("play", () => a.play());
      navigator.mediaSession.setActionHandler("pause", () => a.pause());
      navigator.mediaSession.setActionHandler("seekbackward", () => { a.currentTime = Math.max(0, a.currentTime - 10); });
      navigator.mediaSession.setActionHandler("seekforward", () => { a.currentTime = Math.min((a.duration || a.currentTime + 10), a.currentTime + 10); });
    } catch {}
  }, [playerState.title]);

  const enterCreate = useCallback((audioUrl: string, title: string | null, code: string) => {
    if (audioUrl) {
      setPlayerState((s) => ({ ...s, url: audioUrl, title: title ?? describeAudioUrl(audioUrl), loading: true }));
    }
    setRoomCode(code);
    setRole("host");
    setScreen("room");
  }, []);

  const enterJoin = useCallback((code: string) => {
    setRoomCode(code);
    setRole("guest");
    setScreen("room");
  }, []);

  const handleLeave = useCallback(() => {
    room.leave();
    setScreen("home");
    setRoomCode(null);
    setRole(null);
    setPlayerState(initialState);
  }, [room]);

  const handleUrlChange = useCallback((url: string) => {
    if (!isDirectAudioUrl(url)) {
      alert("URL 不像可直接播放的音频文件(mp3/m4a/aac/ogg/wav/m3u8)。");
      return;
    }
    setPlayerState((s) => ({ ...s, url, title: describeAudioUrl(url), loading: true, error: null }));
    publishTrack(url);
  }, [publishTrack]);

  // 全程直接读 ref,不再用 audioEl state
  const handlePlayPause = useCallback(() => {
    const a = audioContainerRef.current;
    if (!a || !a.src) return;
    if (a.paused) {
      a.play().catch((e) => console.warn("[play]", e?.name, e?.message));
    } else {
      a.pause();
    }
  }, []);

  const handleSeek = useCallback((t: number) => {
    const a = audioContainerRef.current;
    if (!a) return;
    try { a.currentTime = t; } catch {}
    setPlayerState((s) => ({ ...s, currentTime: t }));
    broadcastState();
  }, [broadcastState]);

  const handleRateChange = useCallback((r: number) => {
    const a = audioContainerRef.current;
    if (!a) return;
    a.playbackRate = r;
    setPlayerState((s) => ({ ...s, rate: r }));
  }, []);

  const statusText = useMemo(() => {
    switch (room.status) {
      case "idle": return "未连接";
      case "connecting": return "连接中…";
      case "connected": return roomCode ? `已同步 ${roomCode}` : "已同步";
      case "error": return `连接出错${room.error ? `(${room.error})` : ""}`;
      default: return "";
    }
  }, [room.status, roomCode, room.error]);

  const statusClass = room.status === "connected" ? "ok" : room.status === "error" ? "warn" : "";
  const shareLink = roomCode ? buildShareLink(roomCode) : "";

  const copyShare = async () => {
    if (!shareLink) return;
    try { await navigator.clipboard.writeText(shareLink); alert("已复制链接"); }
    catch { prompt("复制下面链接:", shareLink); }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Podcast With You</h1>
        {screen === "room" && (
          <span className={"status-pill " + statusClass}>
            <span className={"dot " + (room.partnerConnected ? "live" : "")} style={{ marginRight: 6 }} />
            {statusText}
          </span>
        )}
      </header>

      <main className="main">
        {screen === "home" && (
          <RoomGate
            initialRoomCode={roomCode}
            onCreate={enterCreate}
            onJoin={enterJoin}
          />
        )}

        {screen === "room" && (
          <>
            <div className="card">
              <div className="row spread">
                <h2>房间</h2>
                <span className="muted" style={{ fontSize: 12 }}>{role === "host" ? "主持人" : "参与者"}</span>
                <button className="btn" onClick={handleLeave} style={{ minHeight: 36, padding: "6px 12px", fontSize: 13 }}>
                  退出
                </button>
              </div>
              <div className="room-code">{roomCode ?? "—"}</div>
              <div className="share-link">{shareLink}</div>
              <button className="btn" onClick={copyShare}>复制邀请链接</button>
              {room.error && (
                <div className="muted" style={{ color: "var(--danger)", fontSize: 13 }}>
                  ⚠ {room.error}
                </div>
              )}
              <p className="muted">
                任何一边的播放/暂停/seek/倍速都会实时同步给对方。双方各自播放音频,几乎不消耗额外流量。
              </p>
            </div>

            <Player
              state={playerState}
              onPlayPause={handlePlayPause}
              onSeek={handleSeek}
              onRateChange={handleRateChange}
              onUrlChange={handleUrlChange}
              urlInput={urlInput}
              setUrlInput={setUrlInput}
              audioRef={audioContainerRef as any}
              readOnly={!room.partnerConnected}
            />

            <audio
              ref={audioContainerRef}
              src={playerState.url ?? undefined}
              preload="metadata"
              playsInline
            />
          </>
        )}
      </main>
    </div>
  );
}