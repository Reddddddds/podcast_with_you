import { useCallback, useEffect, useRef, useState } from "react";
import type { SyncMessage } from "../lib/sync";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export interface IPollingRoom {
  status: ConnectionStatus;
  partnerConnected: boolean;
  error: string | null;
  send: (msg: SyncMessage) => void;
  onMessage: (handler: (msg: SyncMessage) => void) => () => void;
  leave: () => void;
}

interface PollingRoomOptions {
  roomCode: string | null;
}

const POLL_INTERVAL_MS = 1500;
const FIRST_FETCH_DELAY_MS = 100;  // mount 后立即先 fetch 一次,不傻等 1.5s

function endpoint(): string {
  const base = (import.meta.env.VITE_RESOLVE_URL ?? "").trim();
  if (!base) return "/api/room";
  return base.replace(/\/$/, "") + "/api/room";
}

function freshPeerId(): string {
  return "p-" + Math.random().toString(36).slice(2, 10);
}

export function usePollingRoom(opts: PollingRoomOptions): IPollingRoom {
  const { roomCode } = opts;
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const peerIdRef = useRef<string>(freshPeerId());
  const lastPostedRef = useRef<string>("");
  const handlersRef = useRef<Set<(msg: SyncMessage) => void>>(new Set());

  const send = useCallback(
    (msg: SyncMessage) => {
      if (!roomCode) return;
      const json = JSON.stringify(msg);
      if (json === lastPostedRef.current) return;
      lastPostedRef.current = json;
      const url =
        endpoint() +
        `?code=${encodeURIComponent(roomCode)}&peerId=${encodeURIComponent(peerIdRef.current)}`;
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
      }).catch(() => {});
    },
    [roomCode]
  );

  useEffect(() => {
    if (!roomCode) {
      setStatus("idle");
      return;
    }

    // 每次进入新房间重置 peerId 与 lastPosted,diff 端能拉到 host 最新
    peerIdRef.current = freshPeerId();
    lastPostedRef.current = "";
    setStatus("connecting");

    let alive = true;
    let firstTimer: number | null = null;
    let intervalId: number | null = null;

    const tick = async () => {
      if (!alive) return;
      try {
        const url =
          endpoint() +
          `?code=${encodeURIComponent(roomCode)}&peerId=${encodeURIComponent(peerIdRef.current)}`;
        const r = await fetch(url, { method: "GET" });
        if (!alive) return;
        if (r.ok) {
          const data = (await r.json()) as { ok: boolean; state?: SyncMessage };
          if (data.ok && data.state && typeof data.state === "object" && "type" in data.state) {
            handlersRef.current.forEach((h) => {
              try {
                h(data.state as SyncMessage);
              } catch {}
            });
          }
          setStatus("connected");
          setError(null);
        }
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "polling 失败");
        setStatus("error");
      }
    };

    // mount 后立刻跑一次(immediate first poll)
    firstTimer = window.setTimeout(tick, FIRST_FETCH_DELAY_MS);
    // 然后每 1.5 秒稳定跑(setInterval 不被 React 打断)
    intervalId = window.setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      alive = false;
      if (firstTimer != null) clearTimeout(firstTimer);
      if (intervalId != null) clearInterval(intervalId);
    };
  }, [roomCode]);

  const onMessage = useCallback((handler: (msg: SyncMessage) => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const leave = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  return {
    status,
    partnerConnected: status === "connected",
    error,
    send,
    onMessage,
    leave,
  };
}