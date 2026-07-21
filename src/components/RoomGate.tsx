import { useEffect, useState } from "react";
import { describeAudioUrl, makeRoomCode, buildShareLink } from "../lib/sync";
import { resolvePodcast, describeInputKind } from "../lib/resolvePodcast";

interface IRoomGateProps {
  initialRoomCode: string | null;
  /** 进入房间:host 完成创建时调用,带上解析后的音频直链与自动生成的房间号 */
  onCreate: (audioUrl: string, title: string | null, code: string) => void;
  onJoin: (roomCode: string) => void;
}

export function RoomGate(props: IRoomGateProps) {
  const { initialRoomCode, onCreate, onJoin } = props;
  const [mode, setMode] = useState<"create" | "join">(initialRoomCode ? "join" : "create");
  const [inputUrl, setInputUrl] = useState("");
  const [joinCode, setJoinCode] = useState(initialRoomCode ?? "");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState<string | null>(null);
  const [resolvedTitle, setResolvedTitle] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (initialRoomCode) {
      setMode("join");
      setJoinCode(initialRoomCode);
    }
  }, [initialRoomCode]);

  useEffect(() => {
    const cached = localStorage.getItem("pwy:lastUrl");
    if (cached) setInputUrl(cached);
  }, []);

  const handleCreate = async () => {
    const url = inputUrl.trim();
    if (!url) {
      alert("请填入链接(支持小宇宙 / Apple Podcasts / 任何 .mp3 / .m4a 直链)。");
      return;
    }

    setResolving(true);
    setResolvedAudioUrl(null);
    setResolvedTitle(null);

    let finalUrl: string;
    let title: string | null;

    if (describeInputKind(url) === "platform") {
      const res = await resolvePodcast(url);
      setResolving(false);
      if (!res.ok) {
        alert(`解析失败:${res.reason}\n\n你可以直接粘贴 .mp3 / .m4a 直链试试。`);
        return;
      }
      finalUrl = res.audioUrl;
      title = res.title || describeAudioUrl(url);
    } else {
      setResolving(false);
      finalUrl = url;
      title = describeAudioUrl(url);
    }

    const code = makeRoomCode();
    setResolvedAudioUrl(finalUrl);
    setResolvedTitle(title);
    setGeneratedCode(code);
    setShareLink(buildShareLink(code));
    localStorage.setItem("pwy:lastUrl", finalUrl);
    localStorage.setItem("pwy:lastTitle", title);
  };

  const handleEnterRoom = () => {
    if (generatedCode && resolvedAudioUrl) {
      onCreate(resolvedAudioUrl, resolvedTitle, generatedCode);
    }
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
          <button className="btn" onClick={() => { setShareLink(null); setGeneratedCode(null); setResolvedAudioUrl(null); setResolvedTitle(null); }}>修改链接</button>
          <button className="btn" onClick={copyShare}>{copied ? "已复制" : "复制链接"}</button>
          <button className="btn primary" style={{ flex: 1 }} onClick={handleEnterRoom}>进入房间</button>
        </div>
      </div>
    );
  }

  const hint = describeInputKind(inputUrl);
  const hintText =
    hint === "direct" ? "✓ 直链,直接生成房间" :
    hint === "platform" ? "✓ 自动解析(从链接拿音频直链)" :
    "";

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
          <label className="muted" htmlFor="audio-url">播客链接</label>
          <input
            id="audio-url"
            className="input"
            type="url"
            placeholder="小宇宙 / Apple Podcasts / 任何 .mp3 / .m4a 直链"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !resolving) handleCreate(); }}
            autoComplete="off"
            spellCheck={false}
            disabled={resolving}
          />
          {hintText && <p className="muted" style={{ color: "var(--success)" }}>{hintText}</p>}
          <p className="muted" style={{ fontSize: 13 }}>
            支持 <span className="kbd">小宇宙</span> / <span className="kbd">Apple Podcasts</span> /
            <span className="kbd">pod.link</span> / 任何 https mp3 / m4a / aac / ogg / wav / m3u8 直链。
            平台 URL 会通过 Cloudflare Worker 解析为直链。
          </p>
          <button className="btn primary" onClick={handleCreate} disabled={resolving}>
            {resolving ? "解析中…" : "生成房间号"}
          </button>
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