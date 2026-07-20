import { useCallback, useEffect, useRef, useState } from "react";
import type { IPlayerState } from "../hooks/useSyncPlayback";

interface IPlayerProps {
  state: IPlayerState;
  onPlayPause: () => void;
  onSeek: (currentTime: number) => void;
  onRateChange: (rate: number) => void;
  onUrlChange: (url: string) => void;
  urlInput: string;
  setUrlInput: (v: string) => void;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  readOnly?: boolean;
}

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function Player(props: IPlayerProps) {
  const { state, onPlayPause, onSeek, onRateChange, onUrlChange, urlInput, setUrlInput, audioRef, readOnly = false } = props;
  const progressRef = useRef<HTMLDivElement | null>(null);
  const [seeking, setSeeking] = useState(false);

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const node = progressRef.current;
      if (!node || !state.duration) return;
      const rect = node.getBoundingClientRect();
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onSeek(pct * state.duration);
    },
    [state.duration, onSeek]
  );

  const onProgressDown = (e: React.PointerEvent) => {
    if (readOnly || !state.duration) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSeeking(true);
    seekFromPointer(e.clientX);
  };

  const onProgressMove = (e: React.PointerEvent) => {
    if (!seeking) return;
    seekFromPointer(e.clientX);
  };

  const onProgressUp = (e: React.PointerEvent) => {
    if (!seeking) return;
    setSeeking(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const fillPct = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;

  const handleUrlSubmit = () => {
    const url = urlInput.trim();
    if (url) onUrlChange(url);
  };

  return (
    <div className="card">
      <div className="row spread" style={{ alignItems: "baseline" }}>
        <h2>正在播放</h2>
        <span className="muted" style={{ fontSize: 12 }}>{state.title ?? "—"}</span>
      </div>

      <div className="player">
        <button
          className="play-btn"
          aria-label={state.playing ? "暂停" : "播放"}
          onClick={onPlayPause}
          disabled={!state.url}
        >
          {state.loading ? "…" : state.playing ? "❚❚" : "▶"}
        </button>

        <div className="progress-row">
          <div
            ref={progressRef}
            className="progress"
            style={{ pointerEvents: readOnly ? "none" : "auto" }}
            onPointerDown={onProgressDown}
            onPointerMove={onProgressMove}
            onPointerUp={onProgressUp}
            onPointerCancel={onProgressUp}
          >
            <div className="progress-fill" style={{ width: `${fillPct}%` }} />
          </div>
          <div className="time-row">
            <span>{fmt(state.currentTime)}</span>
            <span>{fmt(state.duration)}</span>
          </div>
        </div>

        <div className="row" style={{ width: "100%", justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 4 }}>
            <span className="muted" style={{ fontSize: 13 }}>倍速</span>
            {[1, 1.25, 1.5, 1.75, 2].map((r) => (
              <button
                key={r}
                className={"btn" + (state.rate === r ? " primary" : "")}
                style={{ minHeight: 36, minWidth: 48, padding: "4px 8px", fontSize: 13 }}
                onClick={() => onRateChange(r)}
                disabled={readOnly}
              >{r}x</button>
            ))}
          </div>
        </div>

        {state.error && (
          <div className="muted" style={{ color: "var(--danger)", fontSize: 13 }}>
            ⚠ {state.error}
          </div>
        )}
      </div>

      {!state.url && !readOnly && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label className="muted" htmlFor="pwy-url">输入音频 URL 开始</label>
          <div className="row" style={{ gap: 8 }}>
            <input
              id="pwy-url"
              className="input"
              type="url"
              placeholder="https://...mp3"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleUrlSubmit(); }}
            />
            <button className="btn primary" onClick={handleUrlSubmit}>加载</button>
          </div>
        </div>
      )}
    </div>
  );
}