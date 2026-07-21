import { useCallback, useEffect, useRef } from "react";
import type { SyncMessage } from "../lib/sync";

export interface IPlayerState {
  url: string | null;
  title: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  rate: number;
  loading: boolean;
  error: string | null;
}

type SyncOut = (msg: SyncMessage) => void;
type OnMessage = (h: (m: SyncMessage) => void) => () => void;

const PROGRESS_INTERVAL_MS = 500;
// drift < 5s 直接不 seek(避免 polling 抖动鬼畜)
const SEEK_DRIFT_THRESHOLD = 5.0;

export function useSyncPlayback(
  audioRef: React.MutableRefObject<HTMLAudioElement | null>,
  state: IPlayerState,
  setState: (updater: (s: IPlayerState) => IPlayerState) => void,
  send: SyncOut,
  onMessage: OnMessage,
  partnerConnected: boolean = false,
  readOnly: boolean = false
) {
  const applyingRemoteRef = useRef(false);
  // 用 ref 反映当前 audio 实际 src(无闭包问题)
  const currentUrlRef = useRef<string | null>(null);

  /* ---- 远端 → 本地 ---- */
  useEffect(() => {
    const off = onMessage((msg) => {
      const a = audioRef.current;
      if (!a) return;
      applyingRemoteRef.current = true;
      try {
        switch (msg.type) {
          case "track": {
            const { url, title } = msg.payload;
            if (url && url !== currentUrlRef.current) {
              currentUrlRef.current = url;
              a.src = url;
              a.load();
              setState((s) => ({ ...s, url, title: title ?? null, loading: true, error: null }));
            }
            break;
          }
          case "state": {
            const { playing, currentTime, rate } = msg.payload;
            const drift = Math.abs(a.currentTime - currentTime);
            if (a.readyState >= 1 && drift > SEEK_DRIFT_THRESHOLD) {
              try { a.currentTime = currentTime; } catch {}
            }
            if (a.playbackRate !== rate && rate > 0) {
              a.playbackRate = rate;
            }
            if (playing && a.paused) a.play().catch(() => {});
            else if (!playing && !a.paused) a.pause();
            setState((s) => ({ ...s, currentTime, rate, playing }));
            break;
          }
          case "seek": {
            // seek 消息现在不用了(host 用 state 替代),留兼容
            try { a.currentTime = msg.payload.currentTime; } catch {}
            setState((s) => ({ ...s, currentTime: msg.payload.currentTime }));
            break;
          }
          case "rate": {
            if (msg.payload.rate > 0) a.playbackRate = msg.payload.rate;
            setState((s) => ({ ...s, rate: msg.payload.rate }));
            break;
          }
        }
      } finally {
        Promise.resolve().then(() => (applyingRemoteRef.current = false));
      }
    });
    return off;
  }, [audioRef, onMessage, setState]);

  const broadcast = useCallback(
    (type: SyncMessage["type"], payload: any) => {
      if (readOnly) return;
      send({ type, payload, t: Date.now() });
    },
    [send, readOnly]
  );

  const broadcastState = useCallback(() => {
    const a = audioRef.current;
    if (!a || applyingRemoteRef.current) return;
    broadcast("state", {
      playing: !a.paused,
      currentTime: a.currentTime,
      rate: a.playbackRate,
    });
  }, [audioRef, broadcast]);

  const publishTrack = useCallback(
    (url: string, title?: string) => {
      broadcast("track", { url, title });
    },
    [broadcast]
  );

  /* ---- 本地 audio 事件 → 远端(host only) ---- */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const refresh = () => {
      if (applyingRemoteRef.current) return;
      const t = a.currentTime;
      const d = a.duration;
      setState((s) => {
        if (s.currentTime === t && Math.abs((s.duration || 0) - (d || 0)) < 0.05) return s;
        return { ...s, currentTime: t, duration: d || s.duration, loading: false };
      });
    };

    const onPlay = () => {
      if (applyingRemoteRef.current) return;
      setState((s) => ({ ...s, playing: true, loading: false, error: null }));
      broadcastState();
    };
    const onPause = () => {
      if (applyingRemoteRef.current) return;
      setState((s) => ({ ...s, playing: false }));
      broadcastState();
    };
    const onSeeked = () => {
      if (applyingRemoteRef.current) return;
      setState((s) => ({ ...s, currentTime: a.currentTime }));
      if (!readOnly) broadcast("seek", { currentTime: a.currentTime });
    };
    const onRateChange = () => {
      if (applyingRemoteRef.current) return;
      setState((s) => ({ ...s, rate: a.playbackRate }));
      if (!readOnly) broadcast("rate", { rate: a.playbackRate });
    };
    const onError = () => {
      const err = a.error;
      setState((s) => ({
        ...s,
        loading: false,
        error: err ? `代码 ${err.code}: ${err.message || "播放失败"}` : "播放失败",
        playing: false,
      }));
    };

    refresh();
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("seeked", onSeeked);
    a.addEventListener("ratechange", onRateChange);
    a.addEventListener("timeupdate", refresh);
    a.addEventListener("loadedmetadata", refresh);
    a.addEventListener("durationchange", refresh);
    a.addEventListener("canplay", refresh);
    a.addEventListener("error", onError);

    // host 端:每 500ms 主动 broadcast 自己的 currentTime
    const iv = window.setInterval(readOnly ? refresh : () => {
      const a2 = audioRef.current;
      if (!a2 || a2.paused || applyingRemoteRef.current) return;
      broadcast("state", {
        playing: true,
        currentTime: a2.currentTime,
        rate: a2.playbackRate,
      });
    }, PROGRESS_INTERVAL_MS);

    return () => {
      clearInterval(iv);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("seeked", onSeeked);
      a.removeEventListener("ratechange", onRateChange);
      a.removeEventListener("timeupdate", refresh);
      a.removeEventListener("loadedmetadata", refresh);
      a.removeEventListener("durationchange", refresh);
      a.removeEventListener("canplay", refresh);
      a.removeEventListener("error", onError);
    };
  }, [audioRef, state.url, setState, broadcast, broadcastState, readOnly]);

  return { publishTrack, broadcastState };
}