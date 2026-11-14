import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyCorsHeaders, sendJson } from './_proxyClient';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    applyCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  sendJson(res, 200, {
    ok: true,
    mode: 'vercel-proxy',
    runtime: 'vercel-serverless',
  });
}
