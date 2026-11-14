import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  applyCorsHeaders,
  proxyFetch,
  resolveProxyConfig,
  type ProxyTargetConfig,
} from './_proxyClient';

function buildAssetUrl(
  target: string,
  proxyId: string,
  customToken: string,
): string {
  const params = new URLSearchParams();
  params.set('url', target);
  if (proxyId) params.set('proxyId', proxyId);
  if (customToken) params.set('p', customToken);
  return `/api/vercel-asset?${params.toString()}`;
}

function rewriteCssUrls(
  cssText: string,
  baseUrl: string,
  proxyId: string,
  customToken: string,
): string {
  return cssText.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (_m, _q, rawRef: string) => {
    const trimmed = rawRef.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('#')) {
      return `url("${trimmed}")`;
    }
    try {
      const abs = new URL(trimmed, baseUrl).toString();
      return `url("${buildAssetUrl(abs, proxyId, customToken)}")`;
    } catch {
      return `url("${trimmed}")`;
    }
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  applyCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    const targetUrl = reqUrl.searchParams.get('url');
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      res.statusCode = 400;
      res.end('Invalid asset URL');
      return;
    }

    const proxyId = reqUrl.searchParams.get('proxyId') || '';
    const customToken = reqUrl.searchParams.get('p') || '';
    let customProxy: Partial<ProxyTargetConfig> | undefined;
    if (customToken) {
      try {
        customProxy = JSON.parse(
          Buffer.from(customToken, 'base64url').toString('utf8'),
        ) as Partial<ProxyTargetConfig>;
      } catch {
        // ignore invalid token
      }
    }

    const proxy = resolveProxyConfig(proxyId || undefined, customProxy);
    const fetched = await proxyFetch(targetUrl, proxy, {
      timeoutMs: 9000,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,text/css,*/*;q=0.8',
      },
    });

    const contentType = fetched.headers['content-type'] || 'application/octet-stream';
    res.statusCode = fetched.status >= 200 && fetched.status < 400 ? fetched.status : 502;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=600');

    if (contentType.toLowerCase().includes('text/css')) {
      const rewritten = rewriteCssUrls(
        fetched.body.toString('utf8'),
        fetched.finalUrl,
        proxyId,
        customToken,
      );
      res.end(rewritten);
      return;
    }

    res.end(fetched.body);
  } catch {
    res.statusCode = 502;
    res.end('');
  }
}
