import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { BrowserManager } from './server/browserManager.ts';

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json());

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  const broadcast = (payload: Record<string, unknown>) => {
    const raw = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    }
  };

  const manager = new BrowserManager(broadcast);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, state: manager.getState() });
  });

  app.get('/api/network/:id', (req, res) => {
    const detail = manager.getNetworkDetail(req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Network entry not found' });
      return;
    }
    res.json(detail);
  });

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url?.startsWith('/ws')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (ws) => {
    clients.add(ws);

    const send = (payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    const history = manager.getHistorySnapshots();
    send({
      type: 'init',
      state: manager.getState(),
      network: history.network,
      console: history.console,
    });
    const cachedFrame = manager.getLastFrame();
    if (cachedFrame) {
      send({ type: 'frame', data: cachedFrame });
    }

    manager
      .ensureReady()
      .then(() => {
        const updatedHistory = manager.getHistorySnapshots();
        send({
          type: 'init',
          state: manager.getState(),
          network: updatedHistory.network,
          console: updatedHistory.console,
        });
        const lastFrame = manager.getLastFrame();
        if (lastFrame) {
          send({ type: 'frame', data: lastFrame });
        }
      })
      .catch((err) => {
        send({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to initialize virtual mobile browser',
        });
      });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; [key: string]: unknown };
        switch (msg.type) {
          case 'navigate':
            await manager.navigate(String(msg.url || ''));
            break;
          case 'back':
            await manager.goBack();
            break;
          case 'forward':
            await manager.goForward();
            break;
          case 'reload':
            await manager.reload();
            break;
          case 'pointer':
            await manager.handlePointer(
              msg.action as 'down' | 'move' | 'up' | 'tap',
              Number(msg.x) || 0,
              Number(msg.y) || 0,
            );
            break;
          case 'wheel':
            await manager.handleWheel(
              Number(msg.x) || 0,
              Number(msg.y) || 0,
              Number(msg.deltaX) || 0,
              Number(msg.deltaY) || 0,
            );
            break;
          case 'keyboard':
            await manager.handleKeyboard(
              msg.action as 'type' | 'key',
              typeof msg.text === 'string' ? msg.text : undefined,
              typeof msg.key === 'string' ? msg.key : undefined,
            );
            break;
          case 'setDevice':
            await manager.setDevice(
              String(msg.deviceId || 'iphone-15-pro'),
              msg.orientation as 'portrait' | 'landscape' | undefined,
            );
            break;
          case 'setThrottling':
            await manager.setThrottling(msg.mode as 'none' | 'fast3g' | 'slow3g' | 'offline');
            break;
          case 'setBlockTrackers':
            manager.setBlockTrackers(Boolean(msg.enabled));
            break;
          case 'setInspectMode':
            manager.setInspectMode(Boolean(msg.enabled));
            break;
          case 'inspectAt':
            await manager.inspectAt(
              Number(msg.x) || 0,
              Number(msg.y) || 0,
              Boolean(msg.selectElement),
            );
            break;
          case 'inspectSelector':
            await manager.inspectSelector(String(msg.selector || ''), Boolean(msg.selectElement));
            break;
          case 'updateElementStyle':
            await manager.updateElementStyle(
              String(msg.selector || ''),
              String(msg.property || ''),
              String(msg.value || ''),
            );
            break;
          case 'getDomTree': {
            const tree = await manager.getDomTree();
            send({ type: 'domTree', tree });
            break;
          }
          case 'evalConsole':
            await manager.evalConsole(String(msg.expression || ''));
            break;
          case 'clearConsole':
            manager.clearConsole();
            break;
          case 'clearNetwork':
            manager.clearNetwork();
            break;
          case 'getStorage': {
            const storage = await manager.getStorageSnapshot();
            send({ type: 'storage', storage });
            break;
          }
          case 'deleteCookie':
            await manager.deleteCookie(String(msg.name || ''), String(msg.domain || ''));
            send({ type: 'storage', storage: await manager.getStorageSnapshot() });
            break;
          case 'clearStorage':
            await manager.clearAllStorage();
            send({ type: 'storage', storage: await manager.getStorageSnapshot() });
            break;
          case 'verifyProxy':
            await manager.verifyProxyIdentity(true);
            break;
          case 'selectProxyProfile':
            await manager.selectProxyProfile(String(msg.profileId || ''));
            break;
          case 'addProxyProfile':
            await manager.addProxyProfile({
              label: String(msg.label || ''),
              server: String(msg.server || ''),
              username: String(msg.username || ''),
              password: String(msg.password || ''),
            });
            break;
          case 'updateProxy':
            await manager.updateProxy({
              enabled: typeof msg.enabled === 'boolean' ? msg.enabled : undefined,
              server: typeof msg.server === 'string' ? msg.server : undefined,
              username: typeof msg.username === 'string' ? msg.username : undefined,
              password: typeof msg.password === 'string' ? msg.password : undefined,
            });
            break;
          case 'setGeolocation':
            await manager.setGeolocation(Number(msg.latitude) || 0, Number(msg.longitude) || 0);
            break;
          case 'newIdentity':
            await manager.newIdentity();
            break;
          case 'takeScreenshot': {
            const data = await manager.takeScreenshot();
            if (data) send({ type: 'screenshot', data });
            break;
          }
          default:
            break;
        }
      } catch (err) {
        send({
          type: 'error',
          message: err instanceof Error ? err.message : 'Command execution failed',
        });
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  if (isProd) {
    const distDir = path.join(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const cleanup = async () => {
    await manager.teardown();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`StealthView Mobile running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
