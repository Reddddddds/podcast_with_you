﻿import { useEffect, useState } from "react";
import { describeAudioUrl, isDirectAudioUrl, makeRoomCode, buildShareLink } from "../lib/sync";

interface IRoomGateProps {
  initialRoomCode: string | null;
  /** 进入房间:host 完成创建时调用,带上选填的 url 与自动生成的房间号 */
  onCreate: (audioUrl: string, code: string) => void;
  onJoin: (roomCode: string) => void;
}

export function RoomGate(props: IRoomGateProps) {
  const { initialRoomCode, onCreate, onJoin } = props;
  const [mode, setMode] = useState<"create" | "join">(initialRoomCode ? "join" : "create");
  const [audioUrl, setAudioUrl] = useState("");
  const [joinCode, setJoinCode] = useState(initialRoomCode ?? "");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 初次挂载 / URL ?room= 变化:同步 mode 与 joinCode
  useEffect(() => {
    if (initialRoomCode) {
      setMode("join");
      setJoinCode(initialRoomCode);
    }
  }, [initialRoomCode]);

  // 上次用过的 URL 回填
  useEffect(() => {
    const cached = localStorage.getItem("pwy:lastUrl");
    if (cached) setAudioUrl(cached);
  }, []);

  const handleCreate = () => {
    const url = audioUrl.trim();
    if (!url || !isDirectAudioUrl(url)) {
      alert("请填入可直接播放的音频 URL(mp3 / m4a / aac / ogg / wav / m3u8)。");
      return;
    }
    const code = makeRoomCode();
    setGeneratedCode(code);
    setShareLink(buildShareLink(code));
    localStorage.setItem("pwy:lastUrl", url);
    localStorage.setItem("pwy:lastTitle", describeAudioUrl(url));
  };

  const handleEnterRoom = () => {
    if (generatedCode) onCreate(audioUrl, generatedCode);
  };

  const handleJoin = () => {
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) {
      alert("房间号无效");
      return;
    }
    onJoin(code);
  };

  const copyShare = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = shareLink;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  if (shareLink && generatedCode) {
    return (
      <div className="card">
        <h2>房间已创建</h2>
        <p className="muted">把下面任一项发给朋友,对方打开即可加入同步听。</p>
        <div className="room-code">{generatedCode}</div>
        <div className="share-link">{shareLink}</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => { setShareLink(null); setGeneratedCode(null); }}>修改音频</button>
          <button className="btn" onClick={copyShare}>{copied ? "已复制" : "复制链接"}</button>
          <button className="btn primary" style={{ flex: 1 }} onClick={handleEnterRoom}>进入房间</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row spread">
        <h2>一起听播客</h2>
        <div className="row" style={{ gap: 4 }}>
          <button
            className={"btn" + (mode === "create" ? " primary" : "")}
            onClick={() => setMode("create")}
            style={{ minHeight: 36, padding: "6px 12px", fontSize: 13 }}
          >创建</button>
          <button
            className={"btn" + (mode === "join" ? " primary" : "")}
            onClick={() => setMode("join")}
            style={{ minHeight: 36, padding: "6px 12px", fontSize: 13 }}
          >加入</button>
        </div>
      </div>

      {mode === "create" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="muted" htmlFor="audio-url">播客音频 URL</label>
          <input
            id="audio-url"
            className="input"
            type="url"
            placeholder="https://example.com/episode.mp3"
            value={audioUrl}
            onChange={(e) => setAudioUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="muted">
            支持 mp3 / m4a / aac / ogg / wav / m3u8 直链。
            不知道在哪找?随便搜"<span className="kbd">podcast mp3 direct link</span>"。
          </p>
          <button className="btn primary" onClick={handleCreate}>生成房间号</button>
        </div>
      )}

      {mode === "join" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="muted" htmlFor="join-code">房间号</label>
          <input
            id="join-code"
            className="input"
            type="text"
            placeholder="例如 ABC123"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={12}
            style={{ letterSpacing: 4, textTransform: "uppercase", textAlign: "center" }}
          />
          <button className="btn primary" onClick={handleJoin}>加入房间</button>
        </div>
      )}
    </div>
  );
}