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

export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'error';

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
  const reconnectTimerRef = useRef<number | null>(null);

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

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus('open');
      setSocketError(null);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; [key: string]: unknown };
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
    };

    ws.onclose = () => {
      setWsStatus('reconnecting');
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(() => {
        connect();
      }, 1500);
    };

    ws.onerror = () => {
      setWsStatus('error');
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const fetchNetworkDetail = useCallback(async (id: string): Promise<NetworkEntry | null> => {
    try {
      const res = await fetch(`/api/network/${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      return (await res.json()) as NetworkEntry;
    } catch {
      return null;
    }
  }, []);

  return {
    wsStatus,
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
