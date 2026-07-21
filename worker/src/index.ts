/**
 * podcast-resolver — 把"播客链接"解析成直链音频 URL
 * 部署到 Cloudflare Workers,免费 100k 请求/天。
 *
 * 输入 URL 类型:
 *  - 小宇宙(og:audio 在 SSR HTML 里)
 *  - Apple Podcasts / pod.link / Pocket Casts(同样支持 og:audio)
 *  - 任何 .mp3 / .m4a / .aac / .ogg / .wav / .m3u8 直链
 *  - RSS(xml)——可后续扩展
 *
 * 调用: GET /?url=<encoded>
 * 返回: { ok, audioUrl, title, image, sourceType } | { ok: false, code, reason }
 */

export interface Env {
  ALLOWED_ORIGIN: string;
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

interface OgResult {
  audio: string | null;
  title: string | null;
  image: string | null;
  appName: string | null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
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

    const target = url.searchParams.get("url");
    if (!target) return json({ ok: false, code: "E_MISSING_URL", reason: "缺少 url 参数" }, 400, corsHeaders);

    let parsedTarget: URL;
    try { parsedTarget = new URL(target); } catch {
      return json({ ok: false, code: "E_INVALID_URL", reason: "不是合法 URL" }, 400, corsHeaders);
    }
    if (parsedTarget.protocol !== "http:" && parsedTarget.protocol !== "https:") {
      return json({ ok: false, code: "E_PROTOCOL", reason: "仅 http/https" }, 400, corsHeaders);
    }

    // 已经是直链 -> 直接放行
    if (isDirectAudioUrl(parsedTarget.href)) {
      const out: Resolved = {
        ok: true,
        audioUrl: parsedTarget.href,
        title: filenameFromUrl(parsedTarget) || "音频",
        image: "",
        sourceType: "direct",
      };
      return json(out, 200, { ...corsHeaders, "Cache-Control": "public, max-age=3600" });
    }

    // 拉 HTML 解析 og
    let html: string;
    try {
      const upstream = await fetch(parsedTarget.href, {
        redirect: "follow",
        headers: {
          // 模拟桌面浏览器
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          // 防盗链关键:小宇宙 CDN 检测 referer 必须同源
          "Referer": parsedTarget.origin + "/",
        },
      });
      if (!upstream.ok) {
        return json({ ok: false, code: "E_UPSTREAM", reason: `上游 ${upstream.status}` }, 502, corsHeaders);
      }
      html = await upstream.text();
    } catch (e: any) {
      return json({ ok: false, code: "E_NETWORK", reason: e?.message ?? "拉取失败" }, 502, corsHeaders);
    }

    const og = extractOg(html);
    if (!og.audio) {
      return json({ ok: false, code: "E_NO_AUDIO", reason: "页面没有 og:audio,也不像直链" }, 404, corsHeaders);
    }

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
    return json(out, 200, { ...corsHeaders, "Cache-Control": "public, max-age=3600" });
  },
};

/** 用正则从 HTML 里抽 og:* / twitter:* / link enclosure */
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

function json(data: Resolved | ErrorBody, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}