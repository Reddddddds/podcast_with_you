import { useEffect, useState } from "react";
import { describeAudioUrl, makeRoomCode, buildShareLink } from "../lib/sync";
import { resolvePodcast, describeInputKind } from "../lib/resolvePodcast";

interface IRoomGateProps {
  initialRoomCode: string | null;
  onCreate: (audioUrl: string, title: string | null, code: string) => void;
  onJoin: (roomCode: string) => void;
}

type ResolveStep = "idle" | "fetch" | "parse" | "ready";

const STEP_LABEL: Record<ResolveStep, string> = {
  idle: "",
  fetch: "抓取页面",
  parse: "解析链接",
  ready: "完成",
};

/** 给前端能感知到的"三步动画"自动推进;后端 1-3 秒内通常就完成了 */
const STEP_HOLD_MS: Record<ResolveStep, number> = {
  idle: 0,
  fetch: 900,
  parse: 650,
  ready: 400,
};

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
  const [resolveStep, setResolveStep] = useState<ResolveStep>("idle");
  const [resolveError, setResolveError] = useState<string | null>(null);

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
    setResolveStep("fetch");
    setResolveError(null);
    setResolvedAudioUrl(null);
    setResolvedTitle(null);

    let finalUrl: string;
    let title: string | null;
    let needsParse = describeInputKind(url) === "platform";

    // 走 resolver
    if (needsParse) {
      // 步骤 1 已经开始(fetch);在等待响应中推进到 "parse"
      const advanceTimer = setTimeout(() => {
        setResolveStep((s) => (s === "fetch" ? "parse" : s));
      }, STEP_HOLD_MS.fetch);

      try {
        const res = await resolvePodcast(url);
        clearTimeout(advanceTimer);
        if (!res.ok) {
          setResolveStep("idle");
          setResolving(false);
          setResolveError(res.reason || "解析失败");
          return;
        }
        finalUrl = res.audioUrl;
        title = res.title || describeAudioUrl(url);
      } catch (e: any) {
        clearTimeout(advanceTimer);
        setResolveStep("idle");
        setResolving(false);
        setResolveError(e?.message ?? "请求失败");
        return;
      }
    } else {
      // 直链:不需要远端解析,快速跑完展示
      finalUrl = url;
      title = describeAudioUrl(url);
      setResolveStep("parse");
    }

    // 步骤 2 / 推进到 ready
    await wait(STEP_HOLD_MS.parse);
    setResolveStep("ready");
    await wait(STEP_HOLD_MS.ready);

    const code = makeRoomCode();
    setResolvedAudioUrl(finalUrl);
    setResolvedTitle(title);
    setGeneratedCode(code);
    setShareLink(buildShareLink(code));
    localStorage.setItem("pwy:lastUrl", finalUrl);
    localStorage.setItem("pwy:lastTitle", title);
    setResolving(false);
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
          <button className="btn" onClick={() => { setShareLink(null); setGeneratedCode(null); setResolvedAudioUrl(null); setResolvedTitle(null); setResolveError(null); }}>修改链接</button>
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

          {!resolving && (
            <button className="btn primary" onClick={handleCreate}>
              生成房间号
            </button>
          )}

          {resolving && (
            <div className="resolve-progress" role="status" aria-live="polite">
              <div className="resolve-progress-title">正在解析(约 1-3 秒)</div>
              <ol className="resolve-progress-steps">
                <StepRow label="抓取页面" stepKey="fetch" current={resolveStep} />
                <StepRow label="解析链接" stepKey="parse" current={resolveStep} />
                <StepRow label="准备完成" stepKey="ready" current={resolveStep} />
              </ol>
              <div className="resolve-progress-bar"><span className="resolve-progress-bar-fill" data-step={resolveStep} /></div>
            </div>
          )}

          {!resolving && resolveError && (
            <div className="resolve-error" role="alert">
              <strong>解析失败</strong>
              <div className="muted">{resolveError}</div>
              <button className="btn" onClick={handleCreate} style={{ marginTop: 8 }}>重试</button>
            </div>
          )}
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

function StepRow({ label, stepKey, current }: { label: string; stepKey: ResolveStep; current: ResolveStep }) {
  const order: ResolveStep[] = ["fetch", "parse", "ready"];
  const curIdx = order.indexOf(current);
  const myIdx = order.indexOf(stepKey);
  let state: "done" | "active" | "todo";
  if (curIdx < 0) state = "todo";
  else if (myIdx < curIdx) state = "done";
  else if (myIdx === curIdx) state = current === "ready" ? "done" : "active";
  else state = "todo";
  return (
    <li className={`step step-${state}`}>
      <span className="step-dot" aria-hidden="true">
        {state === "done" ? "✓" : state === "active" ? "•" : ""}
      </span>
      <span className="step-label">{label}</span>
    </li>
  );
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}