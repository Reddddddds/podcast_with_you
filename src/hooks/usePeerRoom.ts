import { useCallback, useEffect, useRef, useState } from "react";
import Peer, { type DataConnection } from "peerjs";
import type { SyncMessage } from "../lib/sync";

export type ConnectionStatus =
  | "idle"
  | "initializing"
  | "waiting"
  | "connecting"
  | "connected"
  | "error";

export interface IPeerRoom {
  status: ConnectionStatus;
  peerId: string | null;
  partnerConnected: boolean;
  error: string | null;
  send: (msg: SyncMessage) => void;
  onMessage: (handler: (msg: SyncMessage) => void) => () => void;
  leave: () => void;
}

interface PeerRoomOptions {
  roomCode: string | null;
  /** 是否作为 host 注册 listening peer */
  isHost: boolean;
}

/**
 * PeerJS 房间连接管理。
 * - host: peerId = `pwy-{code}-host`,等待对端连接。
 * - guest: peerId 随机,主动 connect `pwy-{code}-host`。
 */
export function usePeerRoom(opts: PeerRoomOptions): IPeerRoom {
  const { roomCode, isHost } = opts;

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [peerId, setPeerId] = useState<string | null>(null);
  const [partnerConnected, setPartnerConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const handlersRef = useRef<Set<(msg: SyncMessage) => void>>(new Set());

  const cleanup = useCallback(() => {
    try { connRef.current?.close(); } catch {}
    try { peerRef.current?.destroy(); } catch {}
    connRef.current = null;
    peerRef.current = null;
    setPartnerConnected(false);
  }, []);

  const leave = useCallback(() => {
    cleanup();
    setStatus("idle");
    setError(null);
  }, [cleanup]);

  useEffect(() => {
    if (!roomCode) return;
    cleanup();
    setStatus("initializing");
    setError(null);

    const myId = isHost ? `pwy-${roomCode}-host` : `pwy-${roomCode}-g-${Math.random().toString(36).slice(2, 8)}`;
    const peer = new Peer(myId, { debug: 0 });
    peerRef.current = peer;
    let cancelled = false;
    let connected = false;

    peer.on("open", (id) => {
      if (cancelled) return;
      setPeerId(id);
      if (isHost) {
        setStatus("waiting");
      } else {
        setStatus("connecting");
        const target = `pwy-${roomCode}-host`;
        const conn = peer.connect(target, { reliable: true });
        attachConn(conn);
      }
    });

    peer.on("error", (err: any) => {
      if (cancelled) return;
      const msg = err?.type ? `${err.type}: ${err.message ?? ""}` : String(err?.message ?? err);
      setError(msg);
      if (err?.type === "unavailable-id" || err?.type === "network" || err?.type === "server-error") {
        setStatus("error");
      }
    });

    peer.on("disconnected", () => {
      if (cancelled || connected) return;
      setStatus("connecting");
      try { peer.reconnect(); } catch {}
    });

    if (isHost) {
      peer.on("connection", (conn) => attachConn(conn));
    }

    function attachConn(conn: DataConnection) {
      if (cancelled) return;
      connRef.current?.close();
      connRef.current = conn;

      conn.on("open", () => {
        if (cancelled) return;
        connected = true;
        setStatus("connected");
        setPartnerConnected(true);
      });

      conn.on("data", (raw) => {
        if (cancelled) return;
        const msg = raw as SyncMessage;
        if (msg && typeof msg === "object" && "type" in msg) {
          handlersRef.current.forEach((h) => { try { h(msg); } catch {} });
        }
      });

      conn.on("close", () => {
        if (cancelled) return;
        connected = false;
        setPartnerConnected(false);
        setStatus((s) => (s === "connected" ? (isHost ? "waiting" : "connecting") : s));
      });

      conn.on("error", (err: any) => {
        if (cancelled) return;
        setError(`conn: ${err?.message ?? err}`);
      });
    }

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [roomCode, isHost, cleanup]);

  const send = useCallback((msg: SyncMessage) => {
    const conn = connRef.current;
    if (conn && conn.open) {
      try { conn.send(msg); } catch {}
    }
  }, []);

  const onMessage = useCallback((handler: (msg: SyncMessage) => void) => {
    handlersRef.current.add(handler);
    return () => { handlersRef.current.delete(handler); };
  }, []);

  return { status, peerId, partnerConnected, error, send, onMessage, leave };
}