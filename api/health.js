import { applyCorsHeaders, sendJson } from './_proxyClient.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    applyCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  sendJson(res, 200, {
    ok: true,
    mode: 'vercel-chromium',
    runtime: 'vercel-serverless',
  });
}
