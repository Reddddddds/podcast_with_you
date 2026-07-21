export type SyncMessage =
  | { type: "track"; payload: { url: string; title?: string }; t: number }
  | { type: "state"; payload: { playing: boolean; currentTime: number; rate: number }; t: number }
  | { type: "seek"; payload: { currentTime: number }; t: number }
  | { type: "rate"; payload: { rate: number }; t: number }
  | { type: "ping"; payload: { sentAt: number }; t: number }
  | { type: "pong"; payload: { sentAt: number; receivedAt: number }; t: number }
  | { type: "request-state"; t: number };

export interface IRoom {
  code: string;
  isHost: boolean;
  offsetMs: number;
}

/** 生成 6 位房间号,数字 + 大写字母(去掉 0/O/1/I 减歧义) */
export function makeRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  const arr = new Uint32Array(6);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 6; i++) {
    id += chars[arr[i] % chars.length];
  }
  return id;
}

/** 从 URL 解析房间号。支持 ?room=ABC123。 */
export function readRoomFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname.match(/^\/r\/([A-Z0-9]{4,12})/i);
    if (path) return path[1].toUpperCase();
    const q = u.searchParams.get("room");
    if (q && /^[A-Z0-9]{4,12}$/i.test(q)) return q.toUpperCase();
    return null;
  } catch {
    return null;
  }
}

export function buildShareLink(roomCode: string): string {
  const base = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
  return `${base}?room=${roomCode}`;
}

/** 推测某个字符串是否是可直接播放的音频 URL。 */
export function isDirectAudioUrl(url: string): boolean {
  return /^https?:\/\/.+\.(mp3|m4a|aac|ogg|wav|mp4|m3u8)(?:\?.*)?$/i.test(url.trim());
}

/** 从 URL 截取 host 友好的展示名。 */
export function describeAudioUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.split("/").pop() || u.host;
  } catch {
    return url.slice(0, 60);
  }
}