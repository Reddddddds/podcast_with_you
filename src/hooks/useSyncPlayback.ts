/**
 * 把 audio 元素事件双向接到 SyncMessage:
 * - 本地播放/暂停/seek/rate → broadcast 给对端
 * - 收到对端 track/state/seek/rate → 应用到本地 audio
 * - audio 的 duration / currentTime / progress 永远同步到 React state
 *
 * 接 ref 而非 element,避免父组件用 state 镜像 ref 时序问题。
 */

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

export function useSyncPlayback(
  audioRef: React.MutableRefObject<HTMLAudioElement | null>,
  state: IPlayerState,
  setState: (updater: (s: IPlayerState) => IPlayerState) => void,
  send: SyncOut,
  onMessage: OnMessage,
  partnerConnected: boolean = false
) {
  const applyingRemoteRef = useRef(false);

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
            if (url && url !== state.url) {
              a.src = url;
              a.load();
              setState((s) => ({ ...s, url, title: title ?? null, loading: true, error: null }));
            }
            break;
          }
          case "state": {
            const { playing, currentTime, rate } = msg.payload;
            const drift = Math.abs(a.currentTime - currentTime);
            if (a.readyState >= 1 && drift > 0.3) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioRef, onMessage, setState, state.url]);

  const broadcast = useCallback(
    (type: SyncMessage["type"], payload: any) => {
      send({ type, payload, t: Date.now() });
    },
    [send]
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

  /* ---- 本地 → 远端(attach audio 元素事件) ---- */
  // 依赖 [audioRef, state.url]:url 变化时重新 attach(也包括 mount 后第一次)
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
      broadcast("seek", { currentTime: a.currentTime });
    };
    const onRateChange = () => {
      if (applyingRemoteRef.current) return;
      setState((s) => ({ ...s, rate: a.playbackRate }));
      broadcast("rate", { rate: a.playbackRate });
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

    // 立刻读一次,处理已 loaded 但 React 没收到的情况
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

    const iv = window.setInterval(refresh, 250);

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
  }, [audioRef, state.url, setState, broadcast, broadcastState]);

  return { publishTrack, broadcastState };
}