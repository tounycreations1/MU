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

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return 'https://ipv4.webshare.io/';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`;
}

function makeAssetProxyUrl(absUrl, proxyId, customToken) {
  const params = new URLSearchParams();
  params.set('url', absUrl);
  if (proxyId) params.set('proxyId', proxyId);
  if (customToken) params.set('p', customToken);
  return `/api/vercel-asset?${params.toString()}`;
}

function resolveAbsUrl(rawRef, baseUrl) {
  const trimmed = decodeHtmlEntities(rawRef.trim());
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

function toPxValue(numStr, unit) {
  const n = parseFloat(numStr);
  if (Number.isNaN(n)) return 0;
  const u = unit.toLowerCase();
  if (u === 'rem' || u === 'em') return n * 16;
  return n;
}

function shouldKeepMediaQuery(condition, viewportWidth) {
  const cond = condition.trim().toLowerCase();
  if (!cond) return true;
  if (cond === 'print' || cond.startsWith('print ') || cond.includes('only print')) {
    return false;
  }
  if (cond.includes('prefers-color-scheme: dark')) {
    return false;
  }
  if (cond.includes('hover: hover') && !cond.includes('hover: none')) {
    return false;
  }

  // Evaluate comma-separated media query list: keep if ANY branch matches mobile viewport
  const branches = cond.split(',');
  return branches.some((branch) => {
    const b = branch.trim();
    if (b === 'print' || b.startsWith('print ')) return false;
    if (b.includes('prefers-color-scheme: dark')) return false;

    const minMatches = Array.from(b.matchAll(/min-width\s*:\s*([0-9.]+)\s*(px|em|rem)/gi));
    for (const m of minMatches) {
      if (toPxValue(m[1], m[2]) > viewportWidth) return false;
    }

    const maxMatches = Array.from(b.matchAll(/max-width\s*:\s*([0-9.]+)\s*(px|em|rem)/gi));
    for (const m of maxMatches) {
      if (toPxValue(m[1], m[2]) < viewportWidth) return false;
    }

    // Handle CSS Media Queries Level 4 range syntax e.g. (width >= 768px) or (width <= 640px)
    const gteMatches = Array.from(b.matchAll(/\bwidth\s*>=\s*([0-9.]+)\s*(px|em|rem)/gi));
    for (const m of gteMatches) {
      if (toPxValue(m[1], m[2]) > viewportWidth) return false;
    }
    const lteMatches = Array.from(b.matchAll(/\bwidth\s*<=\s*([0-9.]+)\s*(px|em|rem)/gi));
    for (const m of lteMatches) {
      if (toPxValue(m[1], m[2]) < viewportWidth) return false;
    }

    return true;
  });
}

function filterMediaBlocks(cssText, viewportWidth) {
  let result = '';
  let idx = 0;
  const len = cssText.length;

  while (idx < len) {
    const atMediaIdx = cssText.indexOf('@media', idx);
    if (atMediaIdx === -1) {
      result += cssText.slice(idx);
      break;
    }

    result += cssText.slice(idx, atMediaIdx);
    const braceStart = cssText.indexOf('{', atMediaIdx);
    if (braceStart === -1) {
      result += cssText.slice(atMediaIdx);
      break;
    }

    const condition = cssText.slice(atMediaIdx + 6, braceStart).trim();
    let depth = 1;
    let cursor = braceStart + 1;
    while (cursor < len && depth > 0) {
      const ch = cssText[cursor];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      cursor += 1;
    }

    const innerCss = cssText.slice(braceStart + 1, Math.max(braceStart + 1, cursor - 1));
    if (shouldKeepMediaQuery(condition, viewportWidth)) {
      result += filterMediaBlocks(innerCss, viewportWidth);
    }
    idx = cursor;
  }

  return result;
}

function rewriteCssForShadowDom(
  cssText,
  cssBaseUrl,
  proxyId,
  customToken,
  viewportWidth,
  viewportHeight,
  importUrlsOut,
) {
  // Collect @import stylesheet URLs before stripping
  let out = cssText.replace(
    /@import\s+(?:url\(\s*(['"]?)([^)'"]+)\1\s*\)|(['"])([^'"]+)\3)[^;]*;/gi,
    (_m, _q1, u1, _q2, u2) => {
      const ref = (u1 || u2 || '').trim();
      if (ref && importUrlsOut) {
        const abs = resolveAbsUrl(ref, cssBaseUrl);
        if (/^https?:\/\//i.test(abs) && !importUrlsOut.includes(abs)) {
          importUrlsOut.push(abs);
        }
      }
      return '';
    },
  );

  // Filter @media blocks strictly against mobile viewport dimensions
  out = filterMediaBlocks(out, viewportWidth);

  // Rewrite url(...) asset references
  out = out.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (_m, _q, rawRef) => {
    const trimmed = rawRef.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('#')) {
      return `url("${trimmed}")`;
    }
    const abs = resolveAbsUrl(trimmed, cssBaseUrl);
    if (!/^https?:\/\//i.test(abs)) return `url("${trimmed}")`;
    return `url("${makeAssetProxyUrl(abs, proxyId, customToken)}")`;
  });

  // Convert desktop-window viewport units (vh/vw) to actual mobile container pixels
  out = out.replace(/(-?[0-9]*\.?[0-9]+)\s*(?:d|s|l)?vh\b/gi, (_m, n) => {
    const val = Math.round((parseFloat(n) / 100) * viewportHeight * 100) / 100;
    return `${val}px`;
  });
  out = out.replace(/(-?[0-9]*\.?[0-9]+)\s*(?:d|s|l)?vw\b/gi, (_m, n) => {
    const val = Math.round((parseFloat(n) / 100) * viewportWidth * 100) / 100;
    return `${val}px`;
  });

  // Scope :root, html, body cleanly to Shadow DOM containers
  out = out.replace(/(^|[},;\s]):root\b/gi, '$1:host');
  out = out.replace(/(^|[},;\s])html\b(?=[\s.{:#\[,>~+]|$)/gi, '$1.sv-doc');
  out = out.replace(/(^|[},;\s])body\b(?=[\s.{:#\[,>~+]|$)/gi, '$1.sv-body');

  return out;
}

function extractTitle(html, fallbackUrl) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return fallbackUrl;
  return (
    decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim() || fallbackUrl
  );
}

function extractMetaRefreshUrl(html, baseUrl) {
  const stripped = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  const metaTags = stripped.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    if (!/http-equiv\s*=\s*["']?refresh\b/i.test(tag)) continue;
    const contentMatch = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const contentVal = contentMatch?.[1] || contentMatch?.[2] || contentMatch?.[3] || '';
    const urlMatch = contentVal.match(/url\s*=\s*(['"]?)([^'";\s]+)/i);
    if (urlMatch?.[2]) {
      const resolved = resolveAbsUrl(urlMatch[2], baseUrl);
      if (/^https?:\/\//i.test(resolved)) return resolved;
    }
  }
  return null;
}

function mergeClassAttr(rawAttrs, extraClass) {
  const safeAttrs = rawAttrs.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  if (/\bclass\s*=\s*(?:"[^"]*"|'[^']*')/i.test(safeAttrs)) {
    return safeAttrs.replace(
      /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
      (_m, dq, sq) => `class="${escapeHtml(`${extraClass} ${dq ?? sq ?? ''}`.trim())}"`,
    );
  }
  return ` class="${extraClass}"${safeAttrs}`;
}

function sanitizeAndRewriteHtml(
  rawHtml,
  baseUrl,
  proxyId,
  customToken,
  blockTrackers,
  viewportWidth,
  viewportHeight,
) {
  let blockedCount = 0;
  const title = extractTitle(rawHtml, baseUrl);
  const inlineStyles = [];
  const stylesheetUrls = [];

  // CRITICAL: Remove <noscript> tags & contents from <head> or strip <style>/<meta> inside <noscript>
  // so anti-JS <noscript><style>div,p{display:none}</style></noscript> NEVER hides the page
  const cleanForHeadParsing = rawHtml.replace(
    /<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi,
    (_m, inner) => inner.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<meta\b[^>]*>/gi, ''),
  );

  // Extract all <link rel="stylesheet"> regardless of attribute ordering
  const linkRegex = /<link\b[^>]*>/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(cleanForHeadParsing)) !== null) {
    const tag = linkMatch[0];
    if (!/\brel\s*=\s*(?:"[^"]*\bstylesheet\b[^"]*"|'[^']*\bstylesheet\b[^']*'|stylesheet\b)/i.test(tag)) {
      continue;
    }
    if (/\bmedia\s*=\s*(?:"print"|'print'|print\b)/i.test(tag)) continue;

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

  // Extract inline <style> blocks (never from inside <noscript>)
  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = styleRegex.exec(cleanForHeadParsing)) !== null) {
    if (styleMatch[1].trim()) {
      inlineStyles.push(
        rewriteCssForShadowDom(
          styleMatch[1],
          baseUrl,
          proxyId,
          customToken,
          viewportWidth,
          viewportHeight,
          stylesheetUrls,
        ),
      );
    }
  }

  const htmlMatch = cleanForHeadParsing.match(/<html\b([^>]*)>/i);
  const htmlAttrs = htmlMatch?.[1] || '';
  const bodyMatch = cleanForHeadParsing.match(/<body\b([^>]*)>([\s\S]*?)<\/body>/i);
  const bodyAttrs = bodyMatch?.[1] || '';
  let content = bodyMatch ? bodyMatch[2] : cleanForHeadParsing;

  // Strip scripts, iframes, frames, embeds, head/style/link/meta tags
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

  // Extract static navigation/actions from onclick handlers before stripping inline JS
  content = content.replace(
    /\s+onclick\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
    (_m, dq, sq) => {
      const code = decodeHtmlEntities(dq ?? sq ?? '');
      const urlMatch = code.match(
        /(?:window\.)?(?:location(?:\.href)?\s*=\s*|location\.assign\(\s*|window\.open\(\s*)['"]([^'"]+)['"]/i,
      );
      if (urlMatch?.[1]) {
        const abs = resolveAbsUrl(urlMatch[1], baseUrl);
        if (/^https?:\/\//i.test(abs)) {
          return ` data-sv-href="${escapeHtml(abs)}"`;
        }
      }
      if (/history\.back\s*\(/i.test(code)) return ' data-sv-action="back"';
      if (/history\.forward\s*\(/i.test(code)) return ' data-sv-action="forward"';
      if (/\.submit\s*\(/i.test(code)) return ' data-sv-action="submit"';
      return '';
    },
  );

  // Strip remaining inline JS event handlers
  content = content.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  content = content.replace(
    /\b(href|action|formaction)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi,
    '$1="#"',
  );

  // Rewrite quoted AND unquoted href, action, formaction, data-href, data-url attributes to absolute URLs
  content = content.replace(
    /\b(href|action|formaction|data-href|data-url)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
    (_m, attr, dq, sq, uq) => {
      const val = dq ?? sq ?? uq ?? '';
      const abs = resolveAbsUrl(val, baseUrl);
      return `${attr}="${escapeHtml(abs)}"`;
    },
  );

  // Promote lazy-loaded data-src / data-original on <img>
  content = content.replace(/<img\b([^>]*)>/gi, (fullTag, attrs) => {
    const hasRealSrc = /\bsrc\s*=\s*(?:"(?!data:)[^"]+"|'(?!data:)[^']+'|(?!data:)[^\s"'=<>`]+)/i.test(
      attrs,
    );
    if (hasRealSrc) return fullTag;
    const dataSrcMatch = attrs.match(
      /\bdata-(?:src|lazy-src|original)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i,
    );
    const fallbackSrc = dataSrcMatch?.[1] || dataSrcMatch?.[2] || dataSrcMatch?.[3];
    if (!fallbackSrc) return fullTag;
    const cleaned = attrs.replace(
      /\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/i,
      '',
    );
    return `<img${cleaned} src="${escapeHtml(fallbackSrc)}">`;
  });

  // Rewrite quoted AND unquoted src / poster attributes on media elements via /api/vercel-asset
  content = content.replace(
    /\b(src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
    (full, attr, dq, sq, uq) => {
      const rawVal = dq ?? sq ?? uq ?? '';
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

  // Rewrite srcset / data-srcset attributes (<img> and <picture><source>)
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

  // Rewrite inline style="...url(...)..." + convert vh/vw in inline styles
  content = content.replace(
    /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
    (_m, dq, sq) => {
      let val = dq ?? sq ?? '';
      val = val.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (_u, _q, ref) => {
        const trimmed = ref.trim();
        if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
          return `url('${trimmed}')`;
        }
        const abs = resolveAbsUrl(trimmed, baseUrl);
        if (!/^https?:\/\//i.test(abs)) return `url('${trimmed}')`;
        return `url('${makeAssetProxyUrl(abs, proxyId, customToken)}')`;
      });
      val = val.replace(/(-?[0-9]*\.?[0-9]+)\s*(?:d|s|l)?vh\b/gi, (_u, n) => {
        return `${Math.round((parseFloat(n) / 100) * viewportHeight)}px`;
      });
      val = val.replace(/(-?[0-9]*\.?[0-9]+)\s*(?:d|s|l)?vw\b/gi, (_u, n) => {
        return `${Math.round((parseFloat(n) / 100) * viewportWidth)}px`;
      });
      return `style="${escapeHtml(val)}"`;
    },
  );

  const docAttrsMerged = mergeClassAttr(htmlAttrs, 'sv-doc');
  const bodyAttrsMerged = mergeClassAttr(bodyAttrs, 'sv-body');
  const wrappedHtml = `<div${docAttrsMerged}><div${bodyAttrsMerged}>${content}</div></div>`;

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
    let targetUrl = normalizeUrl(rawUrl);
    const method = typeof body.method === 'string' ? body.method.toUpperCase() : 'GET';
    const postPayload = typeof body.formData === 'string' ? body.formData : undefined;
    const cookieHeader = typeof body.cookieHeader === 'string' ? body.cookieHeader : '';
    const userAgent = typeof body.userAgent === 'string' ? body.userAgent : undefined;
    const blockTrackers = body.blockTrackers !== false;
    const viewportWidth =
      typeof body.viewportWidth === 'number' && body.viewportWidth > 200
        ? body.viewportWidth
        : 393;
    const viewportHeight =
      typeof body.viewportHeight === 'number' && body.viewportHeight > 300
        ? body.viewportHeight
        : 852;
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

    // Follow meta-refresh if present
    let ctFirst = (fetched.headers['content-type'] || '').toLowerCase();
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

      // If Google Search blocks headless fetch with /httpservice/retry/enablejs, transparently fall back to Bing/DuckDuckGo HTML search for that query
      if (
        /google\.[a-z.]+\/search/i.test(fetched.finalUrl) &&
        fetched.body.toString('utf8').includes('/httpservice/retry/enablejs')
      ) {
        const parsedGoogle = new URL(fetched.finalUrl);
        const query = parsedGoogle.searchParams.get('q');
        if (query) {
          targetUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
          fetched = await proxyFetch(targetUrl, proxy, {
            method: 'GET',
            userAgent,
            timeoutMs: 9000,
          });
        }
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
        viewportWidth,
        viewportHeight,
      );

      const importedUrls = [];
      const fetchedStyles = await Promise.all(
        parsed.stylesheetUrls.slice(0, 8).map(async (cssUrl) => {
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
                  viewportWidth,
                  viewportHeight,
                  importedUrls,
                ),
              };
            }
          } catch {
            // skip unreachable CSS
          }
          return null;
        }),
      );

      // Fetch 1-level @import CSS rules if any
      const extraImportedStyles = await Promise.all(
        importedUrls
          .filter((u) => !parsed.stylesheetUrls.includes(u))
          .slice(0, 4)
          .map(async (cssUrl) => {
            try {
              const cssRes = await proxyFetch(cssUrl, proxy, {
                timeoutMs: 3500,
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
                    viewportWidth,
                    viewportHeight,
                    null,
                  ),
                };
              }
            } catch {
              // ignore
            }
            return null;
          }),
      );

      const externalCssList = [...fetchedStyles, ...extraImportedStyles].filter(
        (s) => s !== null,
      );

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
