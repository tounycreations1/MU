import {
  applyCorsHeaders,
  proxyFetch,
  readJsonBody,
  resolveProxyConfig,
  sendJson,
} from './_proxyClient.js';

const TRACKER_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'google-analytics.com',
  'googletagmanager.com',
  'connect.facebook.net',
  'facebook.com/tr',
  'hotjar.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'amplitude.com',
  'scorecardresearch.com',
  'quantserve.com',
  'criteo.com',
  'taboola.com',
  'outbrain.com',
  'adservice.google.com',
];

function isTrackerHost(urlStr) {
  const lower = urlStr.toLowerCase();
  return TRACKER_HOSTS.some((h) => lower.includes(h));
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return 'https://ipv4.webshare.io/';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

function makeAssetProxyUrl(absUrl, proxyId, customToken) {
  const params = new URLSearchParams();
  params.set('url', absUrl);
  if (proxyId) params.set('proxyId', proxyId);
  if (customToken) params.set('p', customToken);
  return `/api/vercel-asset?${params.toString()}`;
}

function resolveAbsUrl(rawRef, baseUrl) {
  const trimmed = rawRef.trim();
  if (
    !trimmed ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('#') ||
    trimmed.toLowerCase().startsWith('javascript:')
  ) {
    return trimmed;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

function rewriteCssForShadowDom(cssText, cssBaseUrl, proxyId, customToken) {
  let out = cssText.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (_m, _q, rawRef) => {
    const trimmed = rawRef.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('#')) {
      return `url("${trimmed}")`;
    }
    const abs = resolveAbsUrl(trimmed, cssBaseUrl);
    if (!/^https?:\/\//i.test(abs)) return `url("${trimmed}")`;
    return `url("${makeAssetProxyUrl(abs, proxyId, customToken)}")`;
  });

  out = out.replace(/(^|[},;]\s*):root\b/gi, '$1:host');
  out = out.replace(/(^|[},;]\s*)html\b(?=[\s.{:#\[,>~+]|$)/gi, '$1.sv-doc');
  out = out.replace(/(^|[},;]\s*)body\b(?=[\s.{:#\[,>~+]|$)/gi, '$1.sv-body');
  out = out.replace(/@import\s+[^;]+;/gi, '');
  return out;
}

function extractTitle(html, fallbackUrl) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return fallbackUrl;
  return (
    match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim() || fallbackUrl
  );
}

function extractMetaRefreshUrl(html, baseUrl) {
  const match = html.match(
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'\s;>]+)/i,
  );
  if (!match?.[1]) return null;
  const resolved = resolveAbsUrl(match[1].replace(/['"]/g, ''), baseUrl);
  return /^https?:\/\//i.test(resolved) ? resolved : null;
}

function sanitizeAndRewriteHtml(rawHtml, baseUrl, proxyId, customToken, blockTrackers) {
  let blockedCount = 0;
  const title = extractTitle(rawHtml, baseUrl);
  const inlineStyles = [];
  const stylesheetUrls = [];

  const linkRegex = /<link\b[^>]*>/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(rawHtml)) !== null) {
    const tag = linkMatch[0];
    if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) continue;
    const hrefMatch = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawHref = hrefMatch?.[1] || hrefMatch?.[2] || hrefMatch?.[3] || '';
    const abs = resolveAbsUrl(rawHref, baseUrl);
    if (!/^https?:\/\//i.test(abs)) continue;
    if (blockTrackers && isTrackerHost(abs)) {
      blockedCount += 1;
      continue;
    }
    if (!stylesheetUrls.includes(abs)) {
      stylesheetUrls.push(abs);
    }
  }

  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = styleRegex.exec(rawHtml)) !== null) {
    if (styleMatch[1].trim()) {
      inlineStyles.push(rewriteCssForShadowDom(styleMatch[1], baseUrl, proxyId, customToken));
    }
  }

  const bodyMatch = rawHtml.match(/<body\b([^>]*)>([\s\S]*?)<\/body>/i);
  const bodyAttrs = bodyMatch?.[1] || '';
  let content = bodyMatch ? bodyMatch[2] : rawHtml;

  content = content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<iframe\b[^>]*\/?>/gi, '')
    .replace(/<frame\b[^>]*>[\s\S]*?<\/frame>/gi, '')
    .replace(/<frameset\b[^>]*>[\s\S]*?<\/frameset>/gi, '')
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<link\b[^>]*\/?>/gi, '')
    .replace(/<meta\b[^>]*\/?>/gi, '')
    .replace(/<base\b[^>]*\/?>/gi, '');

  content = content.replace(/<\/?noscript\b[^>]*>/gi, '');
  content = content.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  content = content.replace(/\b(href|action)\s*=\s*(["'])javascript:[^"']*\2/gi, '$1="#"');

  content = content.replace(
    /\b(href|action)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
    (_m, attr, dq, sq) => {
      const val = dq ?? sq ?? '';
      const abs = resolveAbsUrl(val, baseUrl);
      return `${attr}="${escapeHtml(abs)}"`;
    },
  );

  content = content.replace(/<img\b([^>]*)>/gi, (fullTag, attrs) => {
    const hasRealSrc = /\bsrc\s*=\s*(?:"(?!data:)[^"]+"|'(?!data:)[^']+')/i.test(attrs);
    if (hasRealSrc) return fullTag;
    const dataSrcMatch = attrs.match(
      /\bdata-(?:src|lazy-src|original)\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
    );
    const fallbackSrc = dataSrcMatch?.[1] || dataSrcMatch?.[2];
    if (!fallbackSrc) return fullTag;
    const cleaned = attrs.replace(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*')/i, '');
    return `<img${cleaned} src="${escapeHtml(fallbackSrc)}">`;
  });

  content = content.replace(
    /\b(src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
    (full, attr, dq, sq) => {
      const rawVal = dq ?? sq ?? '';
      if (!rawVal || rawVal.startsWith('data:') || rawVal.startsWith('blob:')) {
        return full;
      }
      const abs = resolveAbsUrl(rawVal, baseUrl);
      if (!/^https?:\/\//i.test(abs)) return full;
      if (blockTrackers && isTrackerHost(abs)) {
        blockedCount += 1;
        return `${attr}="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA="`;
      }
      return `${attr}="${escapeHtml(makeAssetProxyUrl(abs, proxyId, customToken))}"`;
    },
  );

  content = content.replace(
    /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
    (_m, dq, sq) => {
      const val = dq ?? sq ?? '';
      const rewritten = val
        .split(',')
        .map((part) => {
          const pieces = part.trim().split(/\s+/);
          if (!pieces[0]) return '';
          const abs = resolveAbsUrl(pieces[0], baseUrl);
          const proxied = /^https?:\/\//i.test(abs)
            ? makeAssetProxyUrl(abs, proxyId, customToken)
            : pieces[0];
          return pieces.length > 1 ? `${proxied} ${pieces.slice(1).join(' ')}` : proxied;
        })
        .filter(Boolean)
        .join(', ');
      return `srcset="${escapeHtml(rewritten)}"`;
    },
  );

  content = content.replace(
    /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
    (_m, dq, sq) => {
      const val = dq ?? sq ?? '';
      const rewritten = val.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (_u, _q, ref) => {
        const trimmed = ref.trim();
        if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
          return `url('${trimmed}')`;
        }
        const abs = resolveAbsUrl(trimmed, baseUrl);
        if (!/^https?:\/\//i.test(abs)) return `url('${trimmed}')`;
        return `url('${makeAssetProxyUrl(abs, proxyId, customToken)}')`;
      });
      return `style="${escapeHtml(rewritten)}"`;
    },
  );

  const safeBodyAttrs = bodyAttrs.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  const wrappedHtml = `<div class="sv-doc"><div class="sv-body"${safeBodyAttrs}>${content}</div></div>`;

  return {
    title,
    bodyHtml: wrappedHtml,
    inlineStyles,
    stylesheetUrls,
    blockedCount,
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    applyCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  const startedAt = Date.now();

  try {
    const body = await readJsonBody(req);
    const rawUrl = typeof body.url === 'string' ? body.url : 'https://ipv4.webshare.io/';
    const targetUrl = normalizeUrl(rawUrl);
    const method = typeof body.method === 'string' ? body.method.toUpperCase() : 'GET';
    const postPayload = typeof body.formData === 'string' ? body.formData : undefined;
    const cookieHeader = typeof body.cookieHeader === 'string' ? body.cookieHeader : '';
    const userAgent = typeof body.userAgent === 'string' ? body.userAgent : undefined;
    const blockTrackers = body.blockTrackers !== false;
    const proxyId = typeof body.proxyId === 'string' ? body.proxyId : '';
    const customProxy =
      body.proxy && typeof body.proxy === 'object' ? body.proxy : undefined;

    const customToken = customProxy
      ? Buffer.from(JSON.stringify(customProxy), 'utf8').toString('base64url')
      : '';
    const proxy = resolveProxyConfig(proxyId || undefined, customProxy);

    const requestHeaders = {};
    if (cookieHeader) {
      requestHeaders.Cookie = cookieHeader;
    }
    if (method === 'POST' && postPayload !== undefined) {
      requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      requestHeaders['Content-Length'] = String(Buffer.byteLength(postPayload));
    }

    let fetched = await proxyFetch(targetUrl, proxy, {
      method,
      headers: requestHeaders,
      body: postPayload,
      userAgent,
      timeoutMs: 11000,
    });

    const ctFirst = (fetched.headers['content-type'] || '').toLowerCase();
    if (ctFirst.includes('text/html')) {
      const htmlFirst = fetched.body.toString('utf8');
      const refreshUrl = extractMetaRefreshUrl(htmlFirst, fetched.finalUrl);
      if (refreshUrl && refreshUrl !== fetched.finalUrl) {
        fetched = await proxyFetch(refreshUrl, proxy, {
          method: 'GET',
          headers: cookieHeader ? { Cookie: cookieHeader } : {},
          userAgent,
          timeoutMs: 9000,
        });
      }
    }

    const durationMs = Date.now() - startedAt;
    const contentType = (fetched.headers['content-type'] || 'text/html').toLowerCase();
    const rawText = fetched.body.toString('utf8');

    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
      const parsed = sanitizeAndRewriteHtml(
        rawText,
        fetched.finalUrl,
        proxyId,
        customToken,
        blockTrackers,
      );

      const fetchedStyles = await Promise.all(
        parsed.stylesheetUrls.slice(0, 6).map(async (cssUrl) => {
          try {
            const cssRes = await proxyFetch(cssUrl, proxy, {
              timeoutMs: 4000,
              userAgent,
              headers: { Accept: 'text/css,*/*;q=0.1' },
            });
            if (cssRes.status >= 200 && cssRes.status < 400) {
              return {
                url: cssUrl,
                status: cssRes.status,
                sizeBytes: cssRes.body.length,
                css: rewriteCssForShadowDom(
                  cssRes.body.toString('utf8'),
                  cssRes.finalUrl,
                  proxyId,
                  customToken,
                ),
              };
            }
          } catch {
            // skip slow CSS
          }
          return null;
        }),
      );

      const externalCssList = fetchedStyles.filter((s) => s !== null);

      sendJson(res, 200, {
        ok: true,
        finalUrl: fetched.finalUrl,
        status: fetched.status,
        statusText: fetched.statusText,
        title: parsed.title,
        contentType,
        htmlBody: parsed.bodyHtml,
        styles: [...externalCssList.map((s) => s.css), ...parsed.inlineStyles],
        stylesheetAssets: externalCssList.map((s) => ({
          url: s.url,
          status: s.status,
          sizeBytes: s.sizeBytes,
        })),
        blockedCount: parsed.blockedCount,
        headers: fetched.headers,
        setCookies: fetched.setCookies,
        durationMs,
        sizeBytes: fetched.body.length,
        bodyPreview: rawText.slice(0, 16000),
      });
      return;
    }

    if (contentType.startsWith('image/')) {
      const proxiedImg = makeAssetProxyUrl(fetched.finalUrl, proxyId, customToken);
      sendJson(res, 200, {
        ok: true,
        finalUrl: fetched.finalUrl,
        status: fetched.status,
        statusText: fetched.statusText,
        title: fetched.finalUrl,
        contentType,
        htmlBody: `<div class="sv-doc"><div class="sv-body" style="margin:0;padding:16px;background:#0f172a;min-height:100%;display:flex;align-items:center;justify-content:center;"><img src="${escapeHtml(proxiedImg)}" style="max-width:100%;height:auto;border-radius:8px;" alt="Proxied image"/></div></div>`,
        styles: [],
        stylesheetAssets: [],
        blockedCount: 0,
        headers: fetched.headers,
        setCookies: fetched.setCookies,
        durationMs,
        sizeBytes: fetched.body.length,
        bodyPreview: `[binary ${contentType}, ${fetched.body.length} bytes]`,
      });
      return;
    }

    let displayText = rawText;
    if (contentType.includes('application/json')) {
      try {
        displayText = JSON.stringify(JSON.parse(rawText), null, 2);
      } catch {
        displayText = rawText;
      }
    }

    const preHtml = `<div class="sv-doc"><div class="sv-body" style="margin:0;padding:18px;background:#ffffff;color:#0f172a;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:14px;line-height:1.55;min-height:100%;"><pre style="margin:0;white-space:pre-wrap;word-break:break-word;">${escapeHtml(displayText)}</pre></div></div>`;

    sendJson(res, 200, {
      ok: true,
      finalUrl: fetched.finalUrl,
      status: fetched.status,
      statusText: fetched.statusText,
      title: fetched.finalUrl,
      contentType,
      htmlBody: preHtml,
      styles: [],
      stylesheetAssets: [],
      blockedCount: 0,
      headers: fetched.headers,
      setCookies: fetched.setCookies,
      durationMs,
      sizeBytes: fetched.body.length,
      bodyPreview: rawText.slice(0, 16000),
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to fetch URL via proxy',
    });
  }
}
