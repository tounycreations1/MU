import {
  applyCorsHeaders,
  proxyFetch,
  readJsonBody,
  resolveProxyConfig,
  sendJson,
} from './_proxyClient.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    applyCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    let proxyId = reqUrl.searchParams.get('proxyId') || undefined;
    let customProxy;

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      if (typeof body.proxyId === 'string') proxyId = body.proxyId;
      if (body.proxy && typeof body.proxy === 'object') {
        customProxy = body.proxy;
      }
    }

    const proxy = resolveProxyConfig(proxyId, customProxy);

    let ip = '';
    try {
      const ipRes = await proxyFetch('https://ipv4.webshare.io/', proxy, { timeoutMs: 8000 });
      if (ipRes.status >= 200 && ipRes.status < 300) {
        ip = ipRes.body.toString('utf8').trim();
      }
    } catch {
      // fallback to geo lookup
    }

    let geo = {};
    try {
      const geoTarget = ip ? `https://ipwho.is/${encodeURIComponent(ip)}` : 'https://ipwho.is/';
      const geoRes = await proxyFetch(geoTarget, proxy, { timeoutMs: 8000 });
      if (geoRes.status >= 200 && geoRes.status < 300) {
        geo = JSON.parse(geoRes.body.toString('utf8'));
      }
    } catch {
      // ignore geo error
    }

    const conn = geo.connection && typeof geo.connection === 'object' ? geo.connection : undefined;
    const tz = geo.timezone && typeof geo.timezone === 'object' ? geo.timezone : undefined;

    sendJson(res, 200, {
      ok: true,
      identity: {
        ip: ip || (typeof geo.ip === 'string' ? geo.ip : 'Unavailable'),
        city: typeof geo.city === 'string' ? geo.city : undefined,
        region: typeof geo.region === 'string' ? geo.region : undefined,
        country: typeof geo.country === 'string' ? geo.country : undefined,
        countryCode: typeof geo.country_code === 'string' ? geo.country_code : undefined,
        latitude: typeof geo.latitude === 'number' ? geo.latitude : undefined,
        longitude: typeof geo.longitude === 'number' ? geo.longitude : undefined,
        timezone: typeof tz?.id === 'string' ? tz.id : undefined,
        isp: typeof conn?.isp === 'string' ? conn.isp : undefined,
        checkedAt: Date.now(),
        viaProxy: proxy.enabled,
      },
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to verify proxy identity',
    });
  }
}
