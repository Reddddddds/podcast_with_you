/**
 * podcast-resolver — Cloudflare Worker
 *
 * 职责 1(原有):把"小宇宙 / Apple Podcasts / pod.link"等链接解析成 m4a / mp3 直链
 * 职责 2(新):用 KV 当简易 meeting room,host 把当前播放状态写 KV,
 *              guest 每 1.5s 拉一次(server 屏蔽 self-update 避免反馈循环)
 */

export interface Env {
  ALLOWED_ORIGIN: string;
  ROOMS: KVNamespace;
}

interface Resolved {
  ok: true;
  audioUrl: string;
  title: string;
  image: string;
  sourceType: string;
}

interface ErrorBody {
  ok: false;
  code: string;
  reason: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200, headers: { ...corsHeaders, "Cache-Control": "no-store" } });
    }

    // --- 房间状态同步(get / post) ---
    if (url.pathname === "/api/room" && req.method === "GET") return handleGetRoom(req, env, url, corsHeaders);
    if (url.pathname === "/api/room" && req.method === "POST") return handlePostRoom(req, env, url, corsHeaders);

    // --- 原有:小宇宙链接解析 ---
    if (url.pathname !== "/" && url.pathname !== "/resolve") return new Response("not found", { status: 404, headers: corsHeaders });
    return handleResolve(req, env, url, corsHeaders);
  },
};

/* ----------------- 房间同步 ----------------- */

async function handleGetRoom(_req: Request, env: Env, url: URL, cors: Record<string, string>): Promise<Response> {
  const code = url.searchParams.get("code");
  const peerId = url.searchParams.get("peerId");
  if (!code || !peerId) {
    return json({ ok: false, code: "E_MISSING_PARAM", reason: "缺少 code/peerId 参数" }, 400, cors);
  }
  try {
    const data = await env.ROOMS.get(`podcast-room:${code}`, "json");
    if (!data) return json({ ok: true, state: null }, 200, cors);
    const room = data as { state: unknown; updatedBy: string };
    // 自己刚发的 -> 不返回(免反馈)
    if (room.updatedBy === peerId) return json({ ok: true, state: null }, 200, cors);
    return json({ ok: true, state: room.state }, 200, cors);
  } catch (e: any) {
    return json({ ok: false, code: "E_KV_GET", reason: e?.message ?? "KV read 失败" }, 500, cors);
  }
}

async function handlePostRoom(req: Request, env: Env, url: URL, cors: Record<string, string>): Promise<Response> {
  const code = url.searchParams.get("code");
  const peerId = url.searchParams.get("peerId");
  if (!code || !peerId) {
    return json({ ok: false, code: "E_MISSING_PARAM", reason: "缺少 code/peerId 参数" }, 400, cors);
  }
  try {
    const body = (await req.json()) as unknown;
    if (!body || typeof body !== "object" || !("type" in body)) {
      return json({ ok: false, code: "E_BAD_PAYLOAD", reason: "JSON 必须含 type" }, 400, cors);
    }
    await env.ROOMS.put(
      `podcast-room:${code}`,
      JSON.stringify({ state: body, updatedBy: peerId, updatedAt: Date.now() }),
      { expirationTtl: 86400 } // 24h 自动过期
    );
    return json({ ok: true }, 200, cors);
  } catch (e: any) {
    return json({ ok: false, code: "E_KV_PUT", reason: e?.message ?? "KV write 失败" }, 500, cors);
  }
}

/* ----------------- 原有:解析小宇宙链接 ----------------- */

async function handleResolve(req: Request, env: Env, url: URL, cors: Record<string, string>): Promise<Response> {
  const target = url.searchParams.get("url");
  if (!target) return json({ ok: false, code: "E_MISSING_URL", reason: "缺少 url 参数" }, 400, cors);

  let parsedTarget: URL;
  try { parsedTarget = new URL(target); } catch {
    return json({ ok: false, code: "E_INVALID_URL", reason: "不是合法 URL" }, 400, cors);
  }
  if (parsedTarget.protocol !== "http:" && parsedTarget.protocol !== "https:") {
    return json({ ok: false, code: "E_PROTOCOL", reason: "仅 http/https" }, 400, cors);
  }

  // 直链 -> 直接放行
  if (isDirectAudioUrl(parsedTarget.href)) {
    const out: Resolved = {
      ok: true,
      audioUrl: parsedTarget.href,
      title: filenameFromUrl(parsedTarget) || "音频",
      image: "",
      sourceType: "direct",
    };
    return json(out, 200, { ...cors, "Cache-Control": "public, max-age=3600" });
  }

  let html: string;
  try {
    const upstream = await fetch(parsedTarget.href, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": parsedTarget.origin + "/",
      },
    });
    if (!upstream.ok) return json({ ok: false, code: "E_UPSTREAM", reason: `上游 ${upstream.status}` }, 502, cors);
    html = await upstream.text();
  } catch (e: any) {
    return json({ ok: false, code: "E_NETWORK", reason: e?.message ?? "拉取失败" }, 502, cors);
  }

  const og = extractOg(html);
  if (!og.audio) return json({ ok: false, code: "E_NO_AUDIO", reason: "页面没有 og:audio,也不像直链" }, 404, cors);

  const sourceType =
    og.appName === "小宇宙" ? "xiaoyuzhou" :
    parsedTarget.hostname.endsWith("apple.com") ? "apple_podcast" :
    parsedTarget.hostname === "pod.link" ? "podlink" :
    "og";

  const out: Resolved = {
    ok: true,
    audioUrl: og.audio,
    title: og.title ?? og.appName ?? filenameFromUrl(parsedTarget) ?? "播客",
    image: og.image ?? "",
    sourceType,
  };
  return json(out, 200, { ...cors, "Cache-Control": "public, max-age=3600" });
}

interface OgResult {
  audio: string | null;
  title: string | null;
  image: string | null;
  appName: string | null;
}

function extractOg(html: string): OgResult {
  const m = <T extends RegExpExecArray | null>(re: RegExp): string | null => {
    const match = re.exec(html);
    return match?.[1] ?? null;
  };

  const audio =
    m(/<meta[^>]+property=["']og:audio["'][^>]+content=["']([^"']+)["']/i) ??
    m(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:audio["']/i) ??
    m(/<link[^>]+rel=["']audio["'][^>]+href=["']([^"']+)["']/i) ??
    m(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']audio["']/i) ??
    m(/<link[^>]+rel=["']enclosure["'][^>]+href=["']([^"']+)["']/i) ??
    m(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']enclosure["']/i) ??
    m(/<link[^>]+type=["']application\/rss\+xml["'][^>]+href=["']([^"']+)["']/i);

  const title =
    m(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    m(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ??
    m(/<title>([^<]+)<\/title>/i);

  const image =
    m(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    m(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ??
    m(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ??
    m(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);

  const appName =
    m(/<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i) ??
    m(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);

  return { audio, title, image, appName };
}

function isDirectAudioUrl(u: string): boolean {
  return /^https?:\/\/.+\.(mp3|m4a|aac|ogg|wav|mp4|m3u8)(\?.*)?$/i.test(u);
}

function filenameFromUrl(u: URL): string {
  return u.pathname.split("/").filter(Boolean).pop() ?? "";
}

function json(data: Resolved | ErrorBody | Record<string, unknown>, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}