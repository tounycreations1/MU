import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import zlib from 'node:zlib';

export function applyCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function sendJson(res, status, payload) {
  applyCorsHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export const VERCEL_PROXY_PRESETS = [
  {
    id: 'us-east-nj',
    label: 'US East · Piscataway, NJ',
    locationHint: '38.154.185.97:6370',
    server: process.env.DEFAULT_PROXY_SERVER || 'http://38.154.185.97:6370',
    username: process.env.DEFAULT_PROXY_USERNAME || 'knhvpaql',
    password: process.env.DEFAULT_PROXY_PASSWORD || 'kg3ak1ut8a8e',
  },
  {
    id: 'us-west-la',
    label: 'US West · Los Angeles, CA',
    locationHint: '191.96.254.138:6185',
    server: 'http://191.96.254.138:6185',
    username: 'knhvpaql',
    password: 'kg3ak1ut8a8e',
  },
];

export function resolveProxyConfig(proxyId, custom) {
  if (proxyId === 'direct' || (custom && custom.enabled === false)) {
    return { enabled: false, server: '' };
  }
  if (custom && custom.server) {
    const matched = VERCEL_PROXY_PRESETS.find(
      (p) => p.server === custom.server && p.username === custom.username,
    );
    return {
      enabled: true,
      server: custom.server,
      username: custom.username ?? matched?.username,
      password:
        custom.password && custom.password !== '••••••••'
          ? custom.password
          : matched?.password,
    };
  }
  const preset =
    VERCEL_PROXY_PRESETS.find((p) => p.id === proxyId) || VERCEL_PROXY_PRESETS[0];
  return {
    enabled: true,
    server: preset.server,
    username: preset.username,
    password: preset.password,
  };
}

function decodeBody(raw, encoding) {
  const enc = (encoding || '').toLowerCase();
  try {
    if (enc.includes('gzip')) return zlib.gunzipSync(raw);
    if (enc.includes('deflate')) return zlib.inflateSync(raw);
    if (enc.includes('br')) return zlib.brotliDecompressSync(raw);
  } catch {
    return raw;
  }
  return raw;
}

function openConnectTunnel(proxyUrl, targetHost, targetPort, authHeader, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proxyPort = Number(proxyUrl.port) || 80;
    const headers = {
      Host: `${targetHost}:${targetPort}`,
    };
    if (authHeader) {
      headers['Proxy-Authorization'] = authHeader;
    }

    const req = http.request({
      host: proxyUrl.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers,
      timeout: timeoutMs,
    });

    req.on('connect', (res, socket) => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve(socket);
      } else {
        socket.destroy();
        reject(new Error(`Proxy CONNECT failed with HTTP ${res.statusCode ?? 502}`));
      }
    });

    req.on('timeout', () => {
      req.destroy(new Error('Proxy CONNECT timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

function collectResponse(res, finalUrl, resolve, reject) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    const raw = Buffer.concat(chunks);
    const headers = {};
    for (const [k, v] of Object.entries(res.headers)) {
      if (v === undefined) continue;
      headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
    }
    const setCookies = Array.isArray(res.headers['set-cookie'])
      ? res.headers['set-cookie']
      : res.headers['set-cookie']
        ? [res.headers['set-cookie']]
        : [];
    const body = decodeBody(raw, headers['content-encoding']);
    resolve({
      status: res.statusCode || 200,
      statusText: res.statusMessage || 'OK',
      finalUrl,
      headers,
      setCookies,
      body,
    });
  });
  res.on('error', reject);
}

async function singleProxyRequest(targetUrl, proxy, options = {}) {
  const urlObj = new URL(targetUrl);
  const isHttps = urlObj.protocol === 'https:';
  const targetPort = Number(urlObj.port) || (isHttps ? 443 : 80);
  const timeoutMs = options.timeoutMs ?? 12000;
  const method = (options.method || 'GET').toUpperCase();

  const reqHeaders = {
    'User-Agent':
      options.userAgent ||
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    ...(options.headers || {}),
  };

  if (!proxy.enabled || !proxy.server) {
    return new Promise((resolve, reject) => {
      const lib = isHttps ? https : http;
      const req = lib.request(
        urlObj,
        {
          method,
          headers: reqHeaders,
          timeout: timeoutMs,
          rejectUnauthorized: false,
        },
        (res) => collectResponse(res, targetUrl, resolve, reject),
      );
      req.on('timeout', () => req.destroy(new Error('Request timed out')));
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  const proxyUrl = new URL(
    proxy.server.includes('://') ? proxy.server : `http://${proxy.server}`,
  );
  const user = proxy.username ?? decodeURIComponent(proxyUrl.username || '');
  const pass = proxy.password ?? decodeURIComponent(proxyUrl.password || '');
  const authHeader =
    user || pass
      ? `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
      : undefined;

  if (!isHttps) {
    const headersWithAuth = { ...reqHeaders, Host: urlObj.host };
    if (authHeader) headersWithAuth['Proxy-Authorization'] = authHeader;

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: proxyUrl.hostname,
          port: Number(proxyUrl.port) || 80,
          method,
          path: targetUrl,
          headers: headersWithAuth,
          timeout: timeoutMs,
        },
        (res) => collectResponse(res, targetUrl, resolve, reject),
      );
      req.on('timeout', () => req.destroy(new Error('Proxy request timed out')));
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  const tunnelSocket = await openConnectTunnel(
    proxyUrl,
    urlObj.hostname,
    targetPort,
    authHeader,
    timeoutMs,
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    tunnelSocket.on('error', fail);

    const tlsSocket = tls.connect({
      socket: tunnelSocket,
      servername: urlObj.hostname,
      rejectUnauthorized: false,
    });
    tlsSocket.on('error', fail);

    const req = https.request(
      {
        host: urlObj.hostname,
        port: targetPort,
        path: `${urlObj.pathname}${urlObj.search}`,
        method,
        headers: { ...reqHeaders, Host: urlObj.host },
        createConnection: () => tlsSocket,
        timeout: timeoutMs,
      },
      (res) =>
        collectResponse(
          res,
          targetUrl,
          (val) => {
            if (!settled) {
              settled = true;
              resolve(val);
            }
          },
          fail,
        ),
    );

    req.on('timeout', () => req.destroy(new Error('HTTPS proxy request timed out')));
    req.on('error', fail);
    if (options.body) req.write(options.body);
    req.end();
  });
}

export async function proxyFetch(targetUrl, proxy, options = {}) {
  let currentUrl = targetUrl;
  let method = options.method || 'GET';
  let body = options.body;
  const maxRedirects = options.maxRedirects ?? 5;

  for (let i = 0; i <= maxRedirects; i++) {
    const result = await singleProxyRequest(currentUrl, proxy, {
      ...options,
      method,
      body,
    });

    const loc = result.headers['location'];
    if (
      loc &&
      [301, 302, 303, 307, 308].includes(result.status) &&
      i < maxRedirects
    ) {
      currentUrl = new URL(loc, currentUrl).toString();
      if (
        result.status === 303 ||
        ((result.status === 301 || result.status === 302) && method === 'POST')
      ) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    return { ...result, finalUrl: currentUrl };
  }

  throw new Error('Too many redirects');
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
