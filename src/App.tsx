﻿import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoomGate } from "./components/RoomGate";
import { Player } from "./components/Player";
import { usePeerRoom } from "./hooks/usePeerRoom";
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
  const audioContainerRef = useRef<HTMLAudioElement | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  // ref 指向 wrapper 容器,内部实际 audio 通过 querySelector 拿
  useEffect(() => { setAudioEl(audioContainerRef.current); }, [screen]);

  const room = usePeerRoom({ roomCode, isHost: role === "host" });

  // 重连后 / 对端连接状态变化时,重新同步当前 track 给对端
  useEffect(() => {
    if (!room.partnerConnected || !playerState.url) return;
    room.send({ type: "track", payload: { url: playerState.url, title: playerState.title ?? undefined }, t: Date.now() });
    room.send({ type: "state", payload: { playing: playerState.playing, currentTime: playerState.currentTime, rate: playerState.rate }, t: Date.now() });
  }, [room.partnerConnected]);

  const { publishTrack, broadcastState } = useSyncPlayback(
    audioEl,
    playerState,
    setPlayerState,
    room.send,
    room.onMessage
  );

  // 初次挂载:从 URL 预填房间号
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
      const a = audioEl;
      if (!a) return;
      navigator.mediaSession.setActionHandler("play", () => a.play());
      navigator.mediaSession.setActionHandler("pause", () => a.pause());
      navigator.mediaSession.setActionHandler("seekbackward", () => { a.currentTime = Math.max(0, a.currentTime - 10); });
      navigator.mediaSession.setActionHandler("seekforward", () => { a.currentTime = Math.min((a.duration || a.currentTime + 10), a.currentTime + 10); });
    } catch {}
  }, [playerState.title, audioEl]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = playerState.playing ? "playing" : "paused";
    } catch {}
  }, [playerState.playing]);

  const enterCreate = useCallback((audioUrl: string, code: string) => {
    if (audioUrl && isDirectAudioUrl(audioUrl)) {
      setPlayerState((s) => ({ ...s, url: audioUrl, title: describeAudioUrl(audioUrl), loading: !!audioUrl }));
      publishTrack(audioUrl, describeAudioUrl(audioUrl));
    }
    setRoomCode(code);
    setRole("host");
    setScreen("room");
  }, [publishTrack]);

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
    publishTrack(url, describeAudioUrl(url));
  }, [publishTrack]);

  const handlePlayPause = useCallback(() => {
    const a = audioEl;
    if (!a || !playerState.url) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, [audioEl, playerState.url]);

  const handleSeek = useCallback((t: number) => {
    const a = audioEl;
    if (!a) return;
    try { a.currentTime = t; } catch {}
    setPlayerState((s) => ({ ...s, currentTime: t }));
    broadcastState();
  }, [audioEl, broadcastState]);

  const handleRateChange = useCallback((r: number) => {
    const a = audioEl;
    if (!a) return;
    a.playbackRate = r;
    setPlayerState((s) => ({ ...s, rate: r }));
  }, [audioEl]);

  const statusText = useMemo(() => {
    switch (room.status) {
      case "idle": return "未连接";
      case "initializing": return "初始化中…";
      case "waiting": return roomCode ? `等待对方加入 ${roomCode}` : "等待对方加入…";
      case "connecting": return `连接到 ${roomCode ?? ""} …`;
      case "connected": return "已同步";
      case "error": return "连接出错";
    }
  }, [room.status, roomCode]);

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
              audioRef={{ current: audioEl } as any}
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