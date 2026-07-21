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
 * �� audio Ԫ�صı��ز���ͬ�����Զ�;ͬʱ�ѶԶ���Ϣ�����õ����� audio��
 * ͨ�� applyingRemote ��־λ��ֹ�¼���·��
 */
export function useSyncPlayback(
  audio: HTMLAudioElement | null,
  state: IPlayerState,
  setState: (updater: (s: IPlayerState) => IPlayerState) => void,
  send: SyncOut,
  onMessage: OnMessage,
  partnerConnected: boolean = false
) {
  const applyingRemoteRef = useRef(false);

  // Զ�� �� ����
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
            // ���� 300ms ƫ����ǿ�� seek
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
          case "request-state": {
            // 收到对端"刚连上"的请求 -> 把当前 host 的播放状态广播回去
            if (audio) {
              send({
                type: "track",
                payload: { url: audio.src, title: state.title ?? undefined },
                t: Date.now(),
              } as SyncMessage);
              send({
                type: "state",
                payload: {
                  playing: !audio.paused,
                  currentTime: audio.currentTime,
                  rate: audio.playbackRate,
                },
                t: Date.now(),
              } as SyncMessage);
            }
            break;
          }
        }
      } finally {
        // �ȴ����� microtask �����־
        Promise.resolve().then(() => (applyingRemoteRef.current = false));
      }
    });
    return off;
  }, [audio, onMessage, setState, state.url]);

  // ���� �� Զ��
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

  // �� audio �¼� �� �㲥
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
        error: err ? `���� ${err.code}: ${err.message || "����ʧ��"}` : "����ʧ��",
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

  // �����㲥һ�� track(����"�������û����,�ȸ��߶Է���ʲô")
  const publishTrack = useCallback(
    (url: string, title?: string) => {
      broadcast("track", { url, title });
      setState((s) => ({ ...s, url, title: title ?? s.title, loading: !!url }));
    },
    [broadcast, setState]
  );

  return { publishTrack, broadcastState };
}
