import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PROXY_PROFILES } from '../data/devices.ts';
import type {
  BrowserState,
  ConsoleEntry,
  DomNodeSummary,
  HighlightRect,
  InspectedElement,
  NetworkEntry,
  StorageSnapshot,
} from '../types/browser.ts';

export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'backend-missing' | 'error';

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
  const transportRef = useRef<'ws' | 'sse'>('ws');
  const wsFailCountRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  const [backendUrl, setBackendUrlState] = useState<string>(getInitialBackendUrl);
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [state, setState] = useState<BrowserState>(INITIAL_STATE);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [network, setNetwork] = useState<NetworkEntry[]>([]);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [domTree, setDomTree] = useState<DomNodeSummary | null>(null);
  const [inspectedElement, setInspectedElement] = useState<InspectedElement | null>(null);
  const [highlightRect, setHighlightRect] = useState<HighlightRect | null>(null);
  const [storage, setStorage] = useState<StorageSnapshot | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);

  const resolveHttpBase = useCallback(
    (override?: string) => {
      const base = override !== undefined ? override : backendUrl;
      return base ? base.replace(/\/+$/, '') : '';
    },
    [backendUrl],
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

  const verifyBackendReachable = useCallback(async (base: string): Promise<boolean> => {
    try {
      const res = await fetch(`${base}/api/health`, { method: 'GET' });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        return false;
      }
      const data = (await res.json()) as { ok?: boolean };
      return Boolean(data && data.ok);
    } catch {
      return false;
    }
  }, []);

  const connectSse = useCallback(
    async (base: string) => {
      if (unmountedRef.current) return;
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }

      const reachable = await verifyBackendReachable(base);
      if (!reachable) {
        setWsStatus('backend-missing');
        return;
      }

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
    [handleServerMessage, verifyBackendReachable],
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
      const reachable = await verifyBackendReachable(base);
      if (unmountedRef.current) return;

      if (!reachable) {
        setWsStatus('backend-missing');
        return;
      }

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
    [connectSse, handleServerMessage, resolveHttpBase, verifyBackendReachable],
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
      setBackendUrlState(normalized);
      setWsStatus('connecting');
      setSocketError(null);
      connectWs(normalized);
    },
    [connectWs],
  );

  const send = useCallback(
    (payload: Record<string, unknown>) => {
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
    [handleServerMessage, resolveHttpBase],
  );

  const fetchNetworkDetail = useCallback(
    async (id: string): Promise<NetworkEntry | null> => {
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
    wsStatus,
    backendUrl,
    setBackendUrl,
    socketError,
    state,
    frameDataUrl,
    network,
    consoleLogs,
    domTree,
    inspectedElement,
    highlightRect,
    storage,
    send,
    fetchNetworkDetail,
  };
}
