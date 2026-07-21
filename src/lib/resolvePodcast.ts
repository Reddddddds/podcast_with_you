/**
 * 调 Cloudflare Worker 解析"播客链接"为音频 URL
 *
 * 开发态:通过 vite proxy 转发到 http://127.0.0.1:8787(VITE_RESOLVE_URL="" 或不设)
 * 生产态:VITE_RESOLVE_URL 指向部署好的 https://*.workers.dev
 */

export interface IResolvedPodcast {
  ok: true;
  audioUrl: string;
  title: string;
  image: string;
  sourceType: string;
}

export interface IResolveError {
  ok: false;
  code: string;
  reason: string;
}

export type ResolveResult = IResolvedPodcast | IResolveError;

const BASE = (import.meta.env.VITE_RESOLVE_URL ?? "").trim();

function endpoint(): string {
  if (BASE) return `${BASE.replace(/\/$/, "")}/?url=`;
  // 默认走 vite dev proxy(/api/resolve -> 127.0.0.1:8787)
  return "/api/resolve/?url=";
}

export async function resolvePodcast(inputUrl: string): Promise<ResolveResult> {
  const trimmed = inputUrl.trim();
  if (!trimmed) return { ok: false, code: "E_EMPTY", reason: "URL 为空" };

  // 直链不走 worker
  if (isDirectAudioUrl(trimmed)) {
    try {
      const u = new URL(trimmed);
      const filename = u.pathname.split("/").filter(Boolean).pop() || "音频";
      return {
        ok: true,
        audioUrl: trimmed,
        title: decodeURIComponent(filename),
        image: "",
        sourceType: "direct",
      };
    } catch {
      return { ok: false, code: "E_INVALID_URL", reason: "URL 不合法" };
    }
  }

  try {
    const resp = await fetch(endpoint() + encodeURIComponent(trimmed), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    let body: ResolveResult;
    try {
      body = (await resp.json()) as ResolveResult;
    } catch {
      return { ok: false, code: "E_BAD_JSON", reason: `无法解析响应 (HTTP ${resp.status})` };
    }
    if (!body.ok) return body;
    if (!body.audioUrl) return { ok: false, code: "E_NO_AUDIO", reason: "Worker 没返回音频 URL" };
    return body;
  } catch (e: any) {
    return { ok: false, code: "E_NETWORK", reason: e?.message ?? "网络错误" };
  }
}

function isDirectAudioUrl(u: string): boolean {
  return /^https?:\/\/.+\.(mp3|m4a|aac|ogg|wav|mp4|m3u8)(\?.*)?$/i.test(u);
}

/** 用户粘贴 URL 后,给一个 TL;DR 提示它会走到哪个流程 */
export function describeInputKind(inputUrl: string): "direct" | "platform" | "unknown" {
  const u = inputUrl.trim().toLowerCase();
  if (isDirectAudioUrl(u)) return "direct";
  if (/xiaoyuzhoufm\.com/.test(u)) return "platform";
  if (/apple\.com\/.*podcast/.test(u)) return "platform";
  if (/pod\.link/.test(u)) return "platform";
  if (/spotify\.com/.test(u)) return "platform";
  if (/youtube\.com|youtu\.be/.test(u)) return "platform";
  return "unknown";
}