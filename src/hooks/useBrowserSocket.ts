import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PROXY_PROFILES, DEVICE_PRESETS } from '../data/devices.ts';
import type {
  BrowserState,
  ConsoleEntry,
  CookieItem,
  DomNodeSummary,
  EngineMode,
  HighlightRect,
  InspectedElement,
  NetworkEntry,
  ProxyIdentityInfo,
  ProxyProfile,
  RenderedPageSnapshot,
  StorageSnapshot,
  ThrottlingMode,
} from '../types/browser.ts';

export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'backend-missing' | 'error';

export interface ShadowDomBridge {
  getDomTree: () => DomNodeSummary | null;
  inspectAt: (
    viewportX: number,
    viewportY: number,
    selectElement: boolean,
  ) => { element: InspectedElement; highlight: HighlightRect } | null;
  inspectSelector: (
    selector: string,
    selectElement: boolean,
  ) => { element: InspectedElement; highlight: HighlightRect } | null;
  updateElementStyle: (selector: string, property: string, value: string) => InspectedElement | null;
  getRootElement: () => ShadowRoot | null;
  exportHtmlSnapshot: () => void;
}

const BACKEND_URL_STORAGE_KEY = 'stealthview_backend_url';

function getInitialBackendUrl(): string {
  const envUrl = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, '');
  try {
    const saved = window.localStorage.getItem(BACKEND_URL_STORAGE_KEY)?.trim();
    if (saved) return saved.replace(/\/+$/, '');
  } catch {
    // ignore storage access issues
  }
  return '';
}

function parseSetCookieHeader(raw: string, pageUrl: string): CookieItem | null {
  const parts = raw.split(';').map((p) => p.trim());
  const first = parts[0];
  if (!first || !first.includes('=')) return null;
  const eqIdx = first.indexOf('=');
  const name = first.slice(0, eqIdx).trim();
  const value = first.slice(eqIdx + 1).trim();
  if (!name) return null;

  let host = 'localhost';
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    // fallback
  }

  let domain = host;
  let path = '/';
  let httpOnly = false;
  let secure = false;
  let sameSite = 'Lax';
  let expires = -1;

  for (const attr of parts.slice(1)) {
    const [kRaw, ...vParts] = attr.split('=');
    const k = kRaw.trim().toLowerCase();
    const v = vParts.join('=').trim();
    if (k === 'domain' && v) domain = v.replace(/^\./, '');
    else if (k === 'path' && v) path = v;
    else if (k === 'httponly') httpOnly = true;
    else if (k === 'secure') secure = true;
    else if (k === 'samesite' && v) sameSite = v;
    else if (k === 'expires' && v) {
      const parsed = Date.parse(v);
      if (!Number.isNaN(parsed)) expires = Math.floor(parsed / 1000);
    } else if (k === 'max-age' && v) {
      const secs = Number(v);
      if (!Number.isNaN(secs)) expires = Math.floor(Date.now() / 1000) + secs;
    }
  }

  return { name, value, domain, path, expires, httpOnly, secure, sameSite };
}

const INITIAL_STATE: BrowserState = {
  connected: false,
  url: 'https://ipv4.webshare.io/',
  title: 'Connecting to virtual mobile browser...',
  loading: true,
  canGoBack: false,
  canGoForward: false,
  deviceId: 'iphone-15-pro',
  orientation: 'portrait',
  viewportWidth: 393,
  viewportHeight: 852,
  throttling: 'none',
  blockTrackers: true,
  blockedCount: 0,
  inspectMode: false,
  proxy: {
    enabled: true,
    server: 'http://38.154.185.97:6370',
    username: 'knhvpaql',
    password: '••••••••',
  },
  activeProxyId: DEFAULT_PROXY_PROFILES[0]?.id ?? null,
  proxyProfiles: DEFAULT_PROXY_PROFILES.map(({ id, label, locationHint, server, username }) => ({
    id,
    label,
    locationHint,
    server,
    username,
  })),
  identity: null,
  geolocation: { latitude: 40.4992716, longitude: -74.3990433 },
  lastError: null,
};

export function useBrowserSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const transportRef = useRef<'ws' | 'sse' | 'vercel'>('ws');
  const wsFailCountRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  const [engineMode, setEngineMode] = useState<EngineMode>('detecting');
  const [backendUrl, setBackendUrlState] = useState<string>(getInitialBackendUrl);
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [state, setState] = useState<BrowserState>(INITIAL_STATE);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [renderedPage, setRenderedPage] = useState<RenderedPageSnapshot | null>(null);
  const [network, setNetwork] = useState<NetworkEntry[]>([]);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [domTree, setDomTree] = useState<DomNodeSummary | null>(null);
  const [inspectedElement, setInspectedElement] = useState<InspectedElement | null>(null);
  const [highlightRect, setHighlightRect] = useState<HighlightRect | null>(null);
  const [storage, setStorage] = useState<StorageSnapshot | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);

  // Refs for stateful Vercel Proxy Engine Mode
  const stateRef = useRef<BrowserState>(INITIAL_STATE);
  stateRef.current = state;
  const proxyCredsRef = useRef<Map<string, ProxyProfile>>(
    new Map(DEFAULT_PROXY_PROFILES.map((p) => [p.id, { ...p }])),
  );
  const customProxyPassRef = useRef<string>(DEFAULT_PROXY_PROFILES[0]?.password || 'kg3ak1ut8a8e');
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const cookieJarRef = useRef<CookieItem[]>([]);
  const networkDetailRef = useRef<Map<string, NetworkEntry>>(new Map());
  const shadowBridgeRef = useRef<ShadowDomBridge | null>(null);
  const vercelBootedRef = useRef(false);

  const registerShadowBridge = useCallback((bridge: ShadowDomBridge | null) => {
    shadowBridgeRef.current = bridge;
  }, []);

  const resolveHttpBase = useCallback(
    (override?: string) => {
      const base = override !== undefined ? override : backendUrl;
      return base ? base.replace(/\/+$/, '') : '';
    },
    [backendUrl],
  );

  const pushConsoleLog = useCallback(
    (type: ConsoleEntry['type'], text: string, location?: string) => {
      const entry: ConsoleEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type,
        text,
        timestamp: Date.now(),
        location,
      };
      setConsoleLogs((prev) => [...prev.slice(-299), entry]);
    },
    [],
  );

  const buildStorageSnapshot = useCallback((urlStr: string): StorageSnapshot => {
    let origin = urlStr;
    try {
      origin = new URL(urlStr).origin;
    } catch {
      // keep raw
    }
    return {
      origin,
      cookies: [...cookieJarRef.current],
      localStorage: [],
      sessionStorage: [],
    };
  }, []);

  const getVercelProxyPayload = useCallback(() => {
    const cur = stateRef.current;
    if (!cur.proxy.enabled) {
      return { proxyId: 'direct', proxy: { enabled: false, server: '' } };
    }
    if (cur.activeProxyId && proxyCredsRef.current.has(cur.activeProxyId)) {
      const prof = proxyCredsRef.current.get(cur.activeProxyId)!;
      return {
        proxyId: prof.id,
        proxy: {
          enabled: true,
          server: prof.server,
          username: prof.username,
          password: prof.password,
        },
      };
    }
    return {
      proxyId: cur.activeProxyId || '',
      proxy: {
        enabled: cur.proxy.enabled,
        server: cur.proxy.server,
        username: cur.proxy.username,
        password: customProxyPassRef.current,
      },
    };
  }, []);

  const verifyVercelProxy = useCallback(
    async (baseOverride?: string) => {
      const base = resolveHttpBase(baseOverride);
      try {
        const res = await fetch(`${base}/api/vercel-ip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(getVercelProxyPayload()),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          identity?: ProxyIdentityInfo;
          error?: string;
        };
        if (data.ok && data.identity) {
          setState((prev) => ({
            ...prev,
            identity: data.identity!,
            geolocation:
              typeof data.identity?.latitude === 'number' &&
              typeof data.identity?.longitude === 'number'
                ? {
                    latitude: data.identity.latitude,
                    longitude: data.identity.longitude,
                  }
                : prev.geolocation,
          }));
          pushConsoleLog(
            'info',
            `Proxy exit verified: ${data.identity.ip}${data.identity.city ? ` (${data.identity.city}, ${data.identity.countryCode})` : ''}`,
            'proxy',
          );
        }
      } catch (err) {
        pushConsoleLog(
          'warn',
          err instanceof Error ? err.message : 'Unable to verify proxy exit IP',
          'proxy',
        );
      }
    },
    [getVercelProxyPayload, pushConsoleLog, resolveHttpBase],
  );

  const navigateVercel = useCallback(
    async (
      rawUrl: string,
      options?: {
        pushHistory?: boolean;
        method?: string;
        formData?: string;
        baseOverride?: string;
      },
    ) => {
      const base = resolveHttpBase(options?.baseOverride);
      const trimmed = rawUrl.trim();
      if (!trimmed) return;

      const curState = stateRef.current;
      if (curState.throttling === 'offline') {
        setState((prev) => ({
          ...prev,
          loading: false,
          lastError: 'Simulated Offline Mode is enabled in Network throttling.',
        }));
        return;
      }

      setState((prev) => ({ ...prev, loading: true, lastError: null }));

      if (curState.throttling === 'fast3g') {
        await new Promise((r) => setTimeout(r, 250));
      } else if (curState.throttling === 'slow3g') {
        await new Promise((r) => setTimeout(r, 900));
      }

      const reqId = `vreq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const method = (options?.method || 'GET').toUpperCase();
      const startTime = Date.now();

      const pendingEntry: NetworkEntry = {
        id: reqId,
        url: trimmed,
        method,
        resourceType: 'document',
        status: null,
        statusText: 'Pending',
        startTime,
        durationMs: null,
        sizeBytes: null,
      };
      setNetwork((prev) => [...prev.slice(-299), pendingEntry]);

      // Gather matching cookies from jar
      let cookieHeader = '';
      try {
        const host = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`).hostname;
        cookieHeader = cookieJarRef.current
          .filter((c) => host === c.domain || host.endsWith(`.${c.domain}`))
          .map((c) => `${c.name}=${c.value}`)
          .join('; ');
      } catch {
        // ignore URL parse error before normalization
      }

      const devicePreset = DEVICE_PRESETS.find((d) => d.id === curState.deviceId) || DEVICE_PRESETS[0];

      try {
        const res = await fetch(`${base}/api/vercel-browse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: trimmed,
            method,
            formData: options?.formData,
            cookieHeader,
            userAgent: devicePreset.userAgent,
            blockTrackers: curState.blockTrackers,
            ...getVercelProxyPayload(),
          }),
        });

        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          finalUrl?: string;
          status?: number;
          statusText?: string;
          title?: string;
          contentType?: string;
          htmlBody?: string;
          styles?: string[];
          stylesheetAssets?: Array<{ url: string; status: number; sizeBytes: number }>;
          blockedCount?: number;
          headers?: Record<string, string>;
          setCookies?: string[];
          durationMs?: number;
          sizeBytes?: number;
          bodyPreview?: string;
        };

        if (!data.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        const finalUrl = data.finalUrl || trimmed;
        const completedEntry: NetworkEntry = {
          id: reqId,
          url: finalUrl,
          method,
          resourceType: 'document',
          status: data.status ?? 200,
          statusText: data.statusText || 'OK',
          startTime,
          durationMs: data.durationMs ?? Date.now() - startTime,
          sizeBytes: data.sizeBytes ?? 0,
          mimeType: data.contentType,
          requestHeaders: {
            'User-Agent': devicePreset.userAgent,
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
          responseHeaders: data.headers,
          postData: options?.formData ?? null,
          responseBodyPreview: data.bodyPreview ?? null,
        };
        networkDetailRef.current.set(reqId, completedEntry);

        const cssEntries: NetworkEntry[] = (data.stylesheetAssets || []).map((asset, idx) => {
          const cssId = `${reqId}-css-${idx}`;
          const entry: NetworkEntry = {
            id: cssId,
            url: asset.url,
            method: 'GET',
            resourceType: 'stylesheet',
            status: asset.status,
            statusText: 'OK',
            startTime,
            durationMs: data.durationMs ?? null,
            sizeBytes: asset.sizeBytes,
            mimeType: 'text/css',
          };
          networkDetailRef.current.set(cssId, entry);
          return entry;
        });

        setNetwork((prev) => [
          ...prev.map((item) => (item.id === reqId ? completedEntry : item)),
          ...cssEntries,
        ]);

        // Store returned Set-Cookie headers in session cookie jar
        if (Array.isArray(data.setCookies) && data.setCookies.length > 0) {
          for (const rawCookie of data.setCookies) {
            const parsed = parseSetCookieHeader(rawCookie, finalUrl);
            if (parsed) {
              cookieJarRef.current = [
                ...cookieJarRef.current.filter(
                  (c) => !(c.name === parsed.name && c.domain === parsed.domain),
                ),
                parsed,
              ];
            }
          }
        }

        // Update history stack
        if (options?.pushHistory !== false) {
          const { stack, index } = historyRef.current;
          if (stack[index] !== finalUrl) {
            const nextStack = [...stack.slice(0, index + 1), finalUrl];
            historyRef.current = { stack: nextStack, index: nextStack.length - 1 };
          }
        }

        const hist = historyRef.current;
        setRenderedPage({
          url: finalUrl,
          title: data.title || finalUrl,
          htmlBody: data.htmlBody || '',
          styles: Array.isArray(data.styles) ? data.styles : [],
          renderedAt: Date.now(),
        });

        setState((prev) => ({
          ...prev,
          connected: true,
          loading: false,
          url: finalUrl,
          title: data.title || finalUrl,
          canGoBack: hist.index > 0,
          canGoForward: hist.index < hist.stack.length - 1,
          blockedCount: prev.blockedCount + (data.blockedCount || 0),
          lastError: null,
        }));

        setStorage(buildStorageSnapshot(finalUrl));
        setHighlightRect(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Proxy request failed';
        const failEntry: NetworkEntry = {
          ...pendingEntry,
          status: 502,
          statusText: 'Proxy Error',
          durationMs: Date.now() - startTime,
          failed: true,
          failureText: message,
        };
        networkDetailRef.current.set(reqId, failEntry);
        setNetwork((prev) => prev.map((item) => (item.id === reqId ? failEntry : item)));
        setState((prev) => ({
          ...prev,
          connected: true,
          loading: false,
          lastError: message,
        }));
        pushConsoleLog('error', message, trimmed);
      }
    },
    [buildStorageSnapshot, getVercelProxyPayload, pushConsoleLog, resolveHttpBase],
  );

  const handleServerMessage = useCallback((rawJson: string) => {
    try {
      const msg = JSON.parse(rawJson) as { type: string; [key: string]: unknown };
      switch (msg.type) {
        case 'init':
          if (msg.state) setState(msg.state as BrowserState);
          if (Array.isArray(msg.network)) setNetwork(msg.network as NetworkEntry[]);
          if (Array.isArray(msg.console)) setConsoleLogs(msg.console as ConsoleEntry[]);
          break;
        case 'state':
          if (msg.state) setState(msg.state as BrowserState);
          break;
        case 'frame':
          if (typeof msg.data === 'string') {
            setFrameDataUrl(`data:image/jpeg;base64,${msg.data}`);
          }
          break;
        case 'network:add':
          if (msg.entry) {
            const entry = msg.entry as NetworkEntry;
            setNetwork((prev) => [...prev.slice(-299), entry]);
          }
          break;
        case 'network:update':
          if (typeof msg.id === 'string' && msg.patch) {
            const patch = msg.patch as Partial<NetworkEntry>;
            setNetwork((prev) =>
              prev.map((item) => (item.id === msg.id ? { ...item, ...patch } : item)),
            );
          }
          break;
        case 'network:clear':
          setNetwork([]);
          break;
        case 'console:add':
          if (msg.entry) {
            const entry = msg.entry as ConsoleEntry;
            setConsoleLogs((prev) => [...prev.slice(-299), entry]);
          }
          break;
        case 'console:clear':
          setConsoleLogs([]);
          break;
        case 'domTree':
          setDomTree((msg.tree as DomNodeSummary | null) ?? null);
          break;
        case 'highlight':
          setHighlightRect((msg.rect as HighlightRect | null) ?? null);
          break;
        case 'inspected':
          setInspectedElement((msg.element as InspectedElement | null) ?? null);
          break;
        case 'storage':
          setStorage((msg.storage as StorageSnapshot | null) ?? null);
          break;
        case 'screenshot':
          if (typeof msg.data === 'string') {
            const link = document.createElement('a');
            link.href = `data:image/png;base64,${msg.data}`;
            link.download = `stealthview-mobile-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            link.remove();
          }
          break;
        case 'error':
          if (typeof msg.message === 'string') {
            setSocketError(msg.message);
          }
          break;
        default:
          break;
      }
    } catch {
      // ignore malformed frames
    }
  }, []);

  const checkHealthMode = useCallback(
    async (base: string): Promise<'chromium' | 'vercel-proxy' | 'missing'> => {
      try {
        const res = await fetch(`${base}/api/health`, {
          method: 'GET',
          cache: 'no-store',
        });
        const contentType = res.headers.get('content-type') || '';
        if (!res.ok || !contentType.includes('application/json')) {
          setSocketError(`/api/health returned HTTP ${res.status} (${contentType || 'unknown'})`);
          return 'missing';
        }
        const data = (await res.json()) as { ok?: boolean; mode?: string };
        if (!data || !data.ok) {
          setSocketError('/api/health returned ok: false');
          return 'missing';
        }
        setSocketError(null);
        return data.mode === 'vercel-proxy' ? 'vercel-proxy' : 'chromium';
      } catch (err) {
        setSocketError(err instanceof Error ? err.message : 'Unable to reach /api/health');
        return 'missing';
      }
    },
    [],
  );

  const activateVercelMode = useCallback(
    (base: string) => {
      transportRef.current = 'vercel';
      setEngineMode('vercel-proxy');
      setWsStatus('open');
      setSocketError(null);
      setState((prev) => ({
        ...prev,
        connected: true,
        lastError: null,
      }));
      if (!vercelBootedRef.current) {
        vercelBootedRef.current = true;
        pushConsoleLog(
          'info',
          'StealthView Vercel Serverless Proxy Engine ready (zero-iframe Shadow DOM mode).',
          'runtime',
        );
        verifyVercelProxy(base);
        navigateVercel(stateRef.current.url || 'https://ipv4.webshare.io/', {
          baseOverride: base,
        });
      }
    },
    [navigateVercel, pushConsoleLog, verifyVercelProxy],
  );

  const connectSse = useCallback(
    async (base: string) => {
      if (unmountedRef.current) return;
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }

      const mode = await checkHealthMode(base);
      if (mode === 'missing') {
        setEngineMode('backend-missing');
        setWsStatus('backend-missing');
        return;
      }
      if (mode === 'vercel-proxy') {
        activateVercelMode(base);
        return;
      }

      setEngineMode('chromium');
      transportRef.current = 'sse';
      const es = new EventSource(`${base}/api/session/stream`);
      sseRef.current = es;

      es.onopen = () => {
        setWsStatus('open');
        setSocketError(null);
      };

      es.onmessage = (event) => {
        handleServerMessage(event.data);
      };

      es.onerror = () => {
        if (unmountedRef.current) return;
        if (es.readyState === EventSource.CLOSED) {
          setWsStatus('reconnecting');
          if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = window.setTimeout(() => {
            connectSse(base);
          }, 1500);
        }
      };
    },
    [activateVercelMode, checkHealthMode, handleServerMessage],
  );

  const connectWs = useCallback(
    async (overrideBase?: string) => {
      if (unmountedRef.current) return;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      sseRef.current?.close();

      const base = resolveHttpBase(overrideBase);
      const mode = await checkHealthMode(base);
      if (unmountedRef.current) return;

      if (mode === 'missing') {
        setEngineMode('backend-missing');
        setWsStatus('backend-missing');
        return;
      }

      if (mode === 'vercel-proxy') {
        activateVercelMode(base);
        return;
      }

      setEngineMode('chromium');
      transportRef.current = 'ws';
      let wsUrl = '';
      if (base) {
        const parsed = new URL(base);
        const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${wsProto}//${parsed.host}/ws`;
      } else {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${proto}//${window.location.host}/ws`;
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      let opened = false;
      const openTimeout = window.setTimeout(() => {
        if (!opened && ws.readyState !== WebSocket.OPEN) {
          ws.close();
        }
      }, 3500);

      ws.onopen = () => {
        opened = true;
        window.clearTimeout(openTimeout);
        wsFailCountRef.current = 0;
        setWsStatus('open');
        setSocketError(null);
      };

      ws.onmessage = (event) => {
        handleServerMessage(event.data as string);
      };

      ws.onclose = () => {
        window.clearTimeout(openTimeout);
        if (unmountedRef.current) return;

        if (!opened) {
          wsFailCountRef.current += 1;
        }

        if (wsFailCountRef.current >= 1) {
          connectSse(base);
          return;
        }

        setWsStatus('reconnecting');
        reconnectTimerRef.current = window.setTimeout(() => {
          connectWs(base);
        }, 1200);
      };

      ws.onerror = () => {
        if (!opened) {
          wsFailCountRef.current += 1;
        }
      };
    },
    [activateVercelMode, checkHealthMode, connectSse, handleServerMessage, resolveHttpBase],
  );

  useEffect(() => {
    unmountedRef.current = false;
    connectWs();
    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      sseRef.current?.close();
    };
  }, [connectWs]);

  const setBackendUrl = useCallback(
    (nextUrl: string) => {
      const normalized = nextUrl.trim().replace(/\/+$/, '');
      try {
        if (normalized) {
          window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, normalized);
        } else {
          window.localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
        }
      } catch {
        // ignore storage errors
      }
      wsFailCountRef.current = 0;
      vercelBootedRef.current = false;
      setBackendUrlState(normalized);
      setWsStatus('connecting');
      setSocketError(null);
      connectWs(normalized);
    },
    [connectWs],
  );

  const sendVercelCommand = useCallback(
    (payload: Record<string, unknown>) => {
      const type = String(payload.type || '');
      switch (type) {
        case 'navigate':
          void navigateVercel(String(payload.url || ''), {
            method: typeof payload.method === 'string' ? payload.method : 'GET',
            formData: typeof payload.formData === 'string' ? payload.formData : undefined,
          });
          break;
        case 'back': {
          const hist = historyRef.current;
          if (hist.index > 0) {
            hist.index -= 1;
            const prevUrl = hist.stack[hist.index];
            void navigateVercel(prevUrl, { pushHistory: false });
          }
          break;
        }
        case 'forward': {
          const hist = historyRef.current;
          if (hist.index < hist.stack.length - 1) {
            hist.index += 1;
            const nextUrl = hist.stack[hist.index];
            void navigateVercel(nextUrl, { pushHistory: false });
          }
          break;
        }
        case 'reload':
          void navigateVercel(stateRef.current.url, { pushHistory: false });
          break;
        case 'setDevice': {
          const deviceId = String(payload.deviceId || stateRef.current.deviceId);
          const orientation =
            (payload.orientation as 'portrait' | 'landscape') || stateRef.current.orientation;
          const preset = DEVICE_PRESETS.find((d) => d.id === deviceId) || DEVICE_PRESETS[0];
          const w = orientation === 'portrait' ? preset.width : preset.height;
          const h = orientation === 'portrait' ? preset.height : preset.width;
          setState((prev) => ({
            ...prev,
            deviceId: preset.id,
            orientation,
            viewportWidth: w,
            viewportHeight: h,
          }));
          break;
        }
        case 'setThrottling':
          setState((prev) => ({
            ...prev,
            throttling: (payload.mode as ThrottlingMode) || 'none',
          }));
          break;
        case 'setBlockTrackers':
          setState((prev) => ({
            ...prev,
            blockTrackers: Boolean(payload.enabled),
          }));
          break;
        case 'setInspectMode':
          setState((prev) => ({
            ...prev,
            inspectMode: Boolean(payload.enabled),
          }));
          if (!payload.enabled) {
            setHighlightRect(null);
          }
          break;
        case 'getDomTree':
          setDomTree(shadowBridgeRef.current?.getDomTree() ?? null);
          break;
        case 'inspectAt': {
          const res = shadowBridgeRef.current?.inspectAt(
            Number(payload.x) || 0,
            Number(payload.y) || 0,
            Boolean(payload.selectElement),
          );
          if (res) {
            setHighlightRect(res.highlight);
            if (payload.selectElement) {
              setInspectedElement(res.element);
            }
          }
          break;
        }
        case 'inspectSelector': {
          const res = shadowBridgeRef.current?.inspectSelector(
            String(payload.selector || ''),
            Boolean(payload.selectElement),
          );
          if (res) {
            setHighlightRect(res.highlight);
            if (payload.selectElement) {
              setInspectedElement(res.element);
            }
          }
          break;
        }
        case 'updateElementStyle': {
          const updated = shadowBridgeRef.current?.updateElementStyle(
            String(payload.selector || ''),
            String(payload.property || ''),
            String(payload.value || ''),
          );
          if (updated) {
            setInspectedElement(updated);
          }
          break;
        }
        case 'evalConsole': {
          const expr = String(payload.expression || '').trim();
          if (!expr) break;
          pushConsoleLog('eval-input', expr);
          try {
            const root = shadowBridgeRef.current?.getRootElement();
            const docProxy = {
              querySelector: (sel: string) => root?.querySelector(sel) ?? null,
              querySelectorAll: (sel: string) =>
                Array.from(root?.querySelectorAll(sel) ?? []),
              title: stateRef.current.title,
              URL: stateRef.current.url,
              body: root?.querySelector('.sv-body') ?? null,
            };
            const fn = new Function('document', 'pageState', `return (${expr});`);
            const result = fn(docProxy, stateRef.current);
            const formatted =
              typeof result === 'string'
                ? result
                : result === undefined
                  ? 'undefined'
                  : JSON.stringify(result, null, 2) ?? String(result);
            pushConsoleLog('eval-result', formatted);
          } catch (err) {
            pushConsoleLog(
              'eval-error',
              err instanceof Error ? err.message : String(err),
            );
          }
          break;
        }
        case 'clearConsole':
          setConsoleLogs([]);
          break;
        case 'clearNetwork':
          networkDetailRef.current.clear();
          setNetwork([]);
          break;
        case 'getStorage':
          setStorage(buildStorageSnapshot(stateRef.current.url));
          break;
        case 'deleteCookie': {
          const name = String(payload.name || '');
          const domain = String(payload.domain || '');
          cookieJarRef.current = cookieJarRef.current.filter(
            (c) => !(c.name === name && c.domain === domain),
          );
          setStorage(buildStorageSnapshot(stateRef.current.url));
          break;
        }
        case 'clearStorage':
          cookieJarRef.current = [];
          setStorage(buildStorageSnapshot(stateRef.current.url));
          break;
        case 'clearBrowsingData': {
          if (payload.cookies !== false || payload.storage !== false) {
            cookieJarRef.current = [];
            setStorage(buildStorageSnapshot(stateRef.current.url));
          }
          if (payload.history !== false) {
            historyRef.current = { stack: [stateRef.current.url], index: 0 };
            networkDetailRef.current.clear();
            setNetwork([]);
            setConsoleLogs([]);
            setState((prev) => ({
              ...prev,
              canGoBack: false,
              canGoForward: false,
              blockedCount: 0,
            }));
          }
          pushConsoleLog('info', 'Browsing data cleared for current session.', 'privacy');
          if (payload.reloadPage) {
            void navigateVercel(stateRef.current.url, { pushHistory: false });
          }
          break;
        }
        case 'verifyProxy':
          void verifyVercelProxy();
          break;
        case 'selectProxyProfile': {
          const profileId = String(payload.profileId || '');
          if (profileId === 'direct') {
            setState((prev) => ({
              ...prev,
              activeProxyId: 'direct',
              proxy: { ...prev.proxy, enabled: false },
            }));
          } else {
            const prof = proxyCredsRef.current.get(profileId);
            if (prof) {
              setState((prev) => ({
                ...prev,
                activeProxyId: prof.id,
                proxy: {
                  enabled: true,
                  server: prof.server,
                  username: prof.username,
                  password: '••••••••',
                },
              }));
            }
          }
          window.setTimeout(() => {
            void verifyVercelProxy();
            void navigateVercel(stateRef.current.url, { pushHistory: false });
          }, 0);
          break;
        }
        case 'addProxyProfile': {
          const server = String(payload.server || '').trim();
          if (!server) break;
          const label = String(payload.label || '').trim() || server.replace(/^https?:\/\//, '');
          const username = String(payload.username || '').trim();
          const password = String(payload.password || '');
          const id = `custom-${Date.now()}`;
          const profile: ProxyProfile = {
            id,
            label,
            locationHint: server.replace(/^https?:\/\//, ''),
            server,
            username,
            password,
          };
          proxyCredsRef.current.set(id, profile);
          setState((prev) => ({
            ...prev,
            activeProxyId: id,
            proxy: {
              enabled: true,
              server,
              username,
              password: password ? '••••••••' : '',
            },
            proxyProfiles: [
              ...prev.proxyProfiles,
              {
                id: profile.id,
                label: profile.label,
                locationHint: profile.locationHint,
                server: profile.server,
                username: profile.username,
              },
            ],
          }));
          window.setTimeout(() => {
            void verifyVercelProxy();
          }, 0);
          break;
        }
        case 'updateProxy': {
          if (typeof payload.password === 'string' && payload.password !== '••••••••') {
            customProxyPassRef.current = payload.password;
          }
          setState((prev) => ({
            ...prev,
            activeProxyId: null,
            proxy: {
              enabled:
                typeof payload.enabled === 'boolean' ? payload.enabled : prev.proxy.enabled,
              server: typeof payload.server === 'string' ? payload.server : prev.proxy.server,
              username:
                typeof payload.username === 'string' ? payload.username : prev.proxy.username,
              password:
                typeof payload.password === 'string' ? payload.password : prev.proxy.password,
            },
          }));
          window.setTimeout(() => {
            void verifyVercelProxy();
          }, 0);
          break;
        }
        case 'setGeolocation':
          setState((prev) => ({
            ...prev,
            geolocation: {
              latitude: Number(payload.latitude) || 0,
              longitude: Number(payload.longitude) || 0,
            },
          }));
          break;
        case 'newIdentity': {
          cookieJarRef.current = [];
          historyRef.current = { stack: ['https://ipv4.webshare.io/'], index: 0 };
          networkDetailRef.current.clear();
          setNetwork([]);
          setConsoleLogs([]);
          setDomTree(null);
          setInspectedElement(null);
          setStorage(buildStorageSnapshot('https://ipv4.webshare.io/'));
          void verifyVercelProxy();
          void navigateVercel('https://ipv4.webshare.io/', { pushHistory: false });
          break;
        }
        case 'takeScreenshot':
          shadowBridgeRef.current?.exportHtmlSnapshot();
          break;
        default:
          break;
      }
    },
    [buildStorageSnapshot, navigateVercel, pushConsoleLog, verifyVercelProxy],
  );

  const send = useCallback(
    (payload: Record<string, unknown>) => {
      if (transportRef.current === 'vercel') {
        sendVercelCommand(payload);
        return;
      }

      const ws = wsRef.current;
      if (transportRef.current === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        return;
      }

      const base = resolveHttpBase();
      fetch(`${base}/api/session/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.reply) {
            handleServerMessage(JSON.stringify(data.reply));
          }
        })
        .catch(() => {
          // ignore transient network errors
        });
    },
    [handleServerMessage, resolveHttpBase, sendVercelCommand],
  );

  const fetchNetworkDetail = useCallback(
    async (id: string): Promise<NetworkEntry | null> => {
      if (transportRef.current === 'vercel') {
        return networkDetailRef.current.get(id) ?? null;
      }
      try {
        const base = resolveHttpBase();
        const res = await fetch(`${base}/api/network/${encodeURIComponent(id)}`);
        if (!res.ok) return null;
        return (await res.json()) as NetworkEntry;
      } catch {
        return null;
      }
    },
    [resolveHttpBase],
  );

  return {
    engineMode,
    wsStatus,
    backendUrl,
    setBackendUrl,
    socketError,
    state,
    frameDataUrl,
    renderedPage,
    network,
    consoleLogs,
    domTree,
    inspectedElement,
    highlightRect,
    storage,
    send,
    fetchNetworkDetail,
    registerShadowBridge,
  };
}
