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

/**
 * 把 audio 元素的本地操作同步到对端;同时把对端消息反作用到本地 audio。
 * 通过 applyingRemote 标志位防止事件环路。
 */
export function useSyncPlayback(
  audio: HTMLAudioElement | null,
  state: IPlayerState,
  setState: (updater: (s: IPlayerState) => IPlayerState) => void,
  send: SyncOut,
  onMessage: OnMessage
) {
  const applyingRemoteRef = useRef(false);

  // 远端 → 本地
  useEffect(() => {
    if (!audio) return;
    const off = onMessage((msg) => {
      if (!audio) return;
      applyingRemoteRef.current = true;
      try {
        switch (msg.type) {
          case "track": {
            const { url, title } = msg.payload;
            if (url && url !== state.url) {
              audio.src = url;
              audio.load();
              setState((s) => ({ ...s, url, title: title ?? null, loading: true, error: null }));
            }
            break;
          }
          case "state": {
            const { playing, currentTime, rate } = msg.payload;
            const drift = Math.abs(audio.currentTime - currentTime);
            // 超过 300ms 偏差则强制 seek
            if (audio.readyState >= 1 && drift > 0.3) {
              try { audio.currentTime = currentTime; } catch {}
            }
            if (audio.playbackRate !== rate && rate > 0) {
              audio.playbackRate = rate;
            }
            if (playing && audio.paused) {
              audio.play().catch(() => {});
            } else if (!playing && !audio.paused) {
              audio.pause();
            }
            setState((s) => ({ ...s, currentTime, rate, playing }));
            break;
          }
          case "seek": {
            try { audio.currentTime = msg.payload.currentTime; } catch {}
            setState((s) => ({ ...s, currentTime: msg.payload.currentTime }));
            break;
          }
          case "rate": {
            if (msg.payload.rate > 0) audio.playbackRate = msg.payload.rate;
            setState((s) => ({ ...s, rate: msg.payload.rate }));
            break;
          }
        }
      } finally {
        // 等待本轮 microtask 后清标志
        Promise.resolve().then(() => (applyingRemoteRef.current = false));
      }
    });
    return off;
  }, [audio, onMessage, setState, state.url]);

  // 本地 → 远端
  const broadcast = useCallback(
    (type: SyncMessage["type"], payload: any) => {
      send({ type, payload, t: Date.now() } as SyncMessage);
    },
    [send]
  );

  const broadcastState = useCallback(() => {
    if (applyingRemoteRef.current || !audio) return;
    broadcast("state", {
      playing: !audio.paused,
      currentTime: audio.currentTime,
      rate: audio.playbackRate
    });
  }, [audio, broadcast]);

  // 绑定 audio 事件 → 广播
  useEffect(() => {
    if (!audio) return;

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
      setState((s) => ({ ...s, currentTime: audio.currentTime }));
      broadcast("seek", { currentTime: audio.currentTime });
    };
    const onRateChange = () => {
      if (applyingRemoteRef.current) return;
      setState((s) => ({ ...s, rate: audio.playbackRate }));
      broadcast("rate", { rate: audio.playbackRate });
    };
    const onTimeUpdate = () => {
      if (applyingRemoteRef.current) return;
      setState((s) => (s.currentTime === audio.currentTime ? s : { ...s, currentTime: audio.currentTime }));
    };
    const onLoadedMeta = () => {
      setState((s) => ({ ...s, duration: audio.duration || 0, loading: false }));
    };
    const onWaiting = () => setState((s) => ({ ...s, loading: true }));
    const onCanPlay = () => setState((s) => ({ ...s, loading: false }));
    const onError = () => {
      const err = audio.error;
      setState((s) => ({
        ...s,
        loading: false,
        error: err ? `代码 ${err.code}: ${err.message || "播放失败"}` : "播放失败",
        playing: false
      }));
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("ratechange", onRateChange);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMeta);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("ratechange", onRateChange);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMeta);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("error", onError);
    };
  }, [audio, broadcast, broadcastState, setState]);

  // 主动广播一条 track(用于"建房间后还没播放,先告诉对方播什么")
  const publishTrack = useCallback(
    (url: string, title?: string) => {
      broadcast("track", { url, title });
      setState((s) => ({ ...s, url, title: title ?? s.title, loading: !!url }));
    },
    [broadcast, setState]
  );

  return { publishTrack, broadcastState };
}
