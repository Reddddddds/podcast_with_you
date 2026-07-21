/**
 * KV 轮询版 meeting room,替代 usePeerRoom(WebRTC)。
 * 每 1.5s GET 一次 host 当前播放状态,有变化就广播给本地的 onMessage 回调。
 * 写入:host 状态变化时 POST 到 server,server 用 updatedBy 屏蔽自反馈。
 */

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
const PEER_ID_KEY = "pwy:peerId";

/** 给 client 拼 server endpoint */
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
  const tickRef = useRef<number | null>(null);
  const aliveRef = useRef<boolean>(false);

  const send = useCallback((msg: SyncMessage) => {
    if (!roomCode) return;
    const json = JSON.stringify(msg);
    if (json === lastPostedRef.current) return;
    lastPostedRef.current = json;

    const url = endpoint() + `?code=${encodeURIComponent(roomCode)}&peerId=${encodeURIComponent(peerIdRef.current)}`;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
    }).catch(() => {
      /* 网络抖动:忽略,下次 tick 自动重试 */
    });
  }, [roomCode]);

  useEffect(() => {
    if (!roomCode) {
      setStatus("idle");
      return;
    }

    // 每次进入新房间重置 peerId
    peerIdRef.current = freshPeerId();
    lastPostedRef.current = "";
    aliveRef.current = true;
    setStatus("connecting");

    const tick = async () => {
      if (!aliveRef.current) return;
      try {
        const url = endpoint() + `?code=${encodeURIComponent(roomCode)}&peerId=${encodeURIComponent(peerIdRef.current)}`;
        const r = await fetch(url, { method: "GET" });
        if (!aliveRef.current) return;
        if (r.ok) {
          const data = (await r.json()) as { ok: boolean; state?: SyncMessage };
          if (data.ok && data.state && typeof data.state === "object" && "type" in data.state) {
            handlersRef.current.forEach((h) => {
              try { h(data.state as SyncMessage); } catch {}
            });
          }
          setStatus("connected");
          setError(null);
        }
      } catch (e: any) {
        if (!aliveRef.current) return;
        setError(e?.message ?? "polling 失败");
        setStatus("error");
      } finally {
        if (aliveRef.current) {
          tickRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
        }
      }
    };

    tick();

    return () => {
      aliveRef.current = false;
      if (tickRef.current != null) {
        clearTimeout(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [roomCode]);

  const onMessage = useCallback((handler: (msg: SyncMessage) => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const leave = useCallback(() => {
    aliveRef.current = false;
    if (tickRef.current != null) {
      clearTimeout(tickRef.current);
      tickRef.current = null;
    }
    setStatus("idle");
    setError(null);
  }, []);

  return { status, partnerConnected: status === "connected", error, send, onMessage, leave };
}