import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Lock,
  RotateCw,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { DEVICE_PRESETS } from '../data/devices.ts';
import type { ShadowDomBridge } from '../hooks/useBrowserSocket.ts';
import type {
  BrowserState,
  EngineMode,
  HighlightRect,
  RenderedPageSnapshot,
} from '../types/browser.ts';
import {
  buildShadowDomTree,
  extractInspectedElement,
} from '../utils/shadowDomInspector.ts';

interface MobileDeviceStageProps {
  engineMode: EngineMode;
  state: BrowserState;
  frameDataUrl: string | null;
  renderedPage: RenderedPageSnapshot | null;
  highlightRect: HighlightRect | null;
  zoomMode: 'fit' | 'actual';
  onNavigate: (url: string, options?: { method?: string; formData?: string }) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onPointer: (action: 'down' | 'move' | 'up' | 'tap', x: number, y: number) => void;
  onWheel: (x: number, y: number, deltaX: number, deltaY: number) => void;
  onKeyboard: (action: 'type' | 'key', text?: string, key?: string) => void;
  onInspectAt: (x: number, y: number, selectElement: boolean) => void;
  onElementPicked: () => void;
  registerShadowBridge?: (bridge: ShadowDomBridge | null) => void;
}

export const MobileDeviceStage: React.FC<MobileDeviceStageProps> = ({
  engineMode,
  state,
  frameDataUrl,
  renderedPage,
  highlightRect,
  zoomMode,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onPointer,
  onWheel,
  onKeyboard,
  onInspectAt,
  onElementPicked,
  registerShadowBridge,
}) => {
  const [addressInput, setAddressInput] = useState(state.url);
  const [addressFocused, setAddressFocused] = useState(false);
  const [screenFocused, setScreenFocused] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 520, height: 760 });

  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const shadowHostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    lastY: number;
    lastX: number;
    moved: boolean;
  }>({ active: false, startX: 0, startY: 0, lastY: 0, lastX: 0, moved: false });
  const lastInspectHoverRef = useRef<number>(0);

  // Coalesce rapid wheel/drag deltas per animation frame so Chromium never lags
  const pendingWheelRef = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const wheelRafRef = useRef<number | null>(null);

  const isVercelMode = engineMode === 'vercel-proxy';

  const queueWheel = (x: number, y: number, dx: number, dy: number) => {
    if (pendingWheelRef.current) {
      pendingWheelRef.current.x = x;
      pendingWheelRef.current.y = y;
      pendingWheelRef.current.dx += dx;
      pendingWheelRef.current.dy += dy;
    } else {
      pendingWheelRef.current = { x, y, dx, dy };
    }
    if (wheelRafRef.current === null) {
      wheelRafRef.current = window.requestAnimationFrame(() => {
        wheelRafRef.current = null;
        const pending = pendingWheelRef.current;
        pendingWheelRef.current = null;
        if (pending && (Math.abs(pending.dx) > 0.5 || Math.abs(pending.dy) > 0.5)) {
          onWheel(pending.x, pending.y, pending.dx, pending.dy);
        }
      });
    }
  };

  useEffect(() => {
    return () => {
      if (wheelRafRef.current !== null) {
        window.cancelAnimationFrame(wheelRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!addressFocused) {
      setAddressInput(state.url);
    }
  }, [state.url, addressFocused]);

  useEffect(() => {
    const el = stageContainerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setStageSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const scale = useMemo(() => {
    if (zoomMode === 'actual') return 1;
    const chromeHeightOverhead = 74;
    const bezelWidthOverhead = 24;
    const availW = Math.max(260, stageSize.width - 28 - bezelWidthOverhead);
    const availH = Math.max(360, stageSize.height - 32 - chromeHeightOverhead);
    const fitW = availW / state.viewportWidth;
    const fitH = availH / state.viewportHeight;
    return Math.min(1.15, Math.max(0.5, Math.min(fitW, fitH)));
  }, [zoomMode, stageSize, state.viewportWidth, state.viewportHeight]);

  const displayW = Math.round(state.viewportWidth * scale);
  const displayH = Math.round(state.viewportHeight * scale);

  // Mount & update Shadow DOM content in Vercel Serverless Proxy Mode (Zero <iframe>)
  useEffect(() => {
    if (!isVercelMode || !shadowHostRef.current) return;

    if (!shadowRootRef.current) {
      shadowRootRef.current = shadowHostRef.current.attachShadow({ mode: 'open' });
    }
    const shadow = shadowRootRef.current;

    if (!renderedPage) {
      shadow.innerHTML = '';
      return;
    }

    const baseResetCss = `
      :host {
        display: block;
        width: 100%;
        height: 100%;
        background: #ffffff;
        color: #111827;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.45;
        overflow-y: auto;
        overflow-x: hidden;
        box-sizing: border-box;
        -webkit-font-smoothing: antialiased;
      }
      *, *::before, *::after { box-sizing: border-box; }
      .sv-doc { min-height: 100%; width: 100%; max-width: 100%; background: #ffffff; color: #111827; overflow-x: hidden; }
      .sv-body { min-height: 100%; width: 100%; max-width: 100%; margin: 0; overflow-wrap: anywhere; overflow-x: hidden; overflow-y: visible !important; height: auto !important; }
      .sv-body img, .sv-body video { max-width: 100%; height: auto; }
      .sv-body svg { max-width: 100%; }
      .sv-body a { cursor: pointer; }
      .content-collapsible-block { display: block !important; }
      ::-webkit-scrollbar { width: 5px; height: 5px; }
      ::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.4); border-radius: 3px; }
    `;

    const styleTags = [
      `<style data-sv-base="true">${baseResetCss}</style>`,
      ...renderedPage.styles.map((css) => `<style>${css}</style>`),
    ].join('\n');

    shadow.innerHTML = `${styleTags}\n${renderedPage.htmlBody}`;
    shadow.host.scrollTop = 0;

    const handleClick = (event: Event) => {
      const mouseEvent = event as MouseEvent;
      if (state.inspectMode) return;

      const path = mouseEvent.composedPath();
      const anchor = path.find(
        (node): node is HTMLAnchorElement =>
          node instanceof HTMLElement && node.tagName === 'A',
      );
      if (!anchor) return;

      const rawHref = (anchor.getAttribute('href') || '').trim();
      if (!rawHref) return;

      if (rawHref.startsWith('#')) {
        mouseEvent.preventDefault();
        const targetId = rawHref.slice(1);
        if (targetId) {
          const target = shadow.getElementById(targetId);
          target?.scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }

      if (/^(mailto:|tel:|javascript:)/i.test(rawHref)) {
        mouseEvent.preventDefault();
        return;
      }

      try {
        const resolved = new URL(rawHref, renderedPage.url).toString();
        if (/^https?:\/\//i.test(resolved)) {
          mouseEvent.preventDefault();
          onNavigate(resolved);
        }
      } catch {
        // ignore unparseable URL
      }
    };

    const handleSubmit = (event: Event) => {
      const submitEvent = event as SubmitEvent;
      submitEvent.preventDefault();
      const form = submitEvent.target as HTMLFormElement | null;
      if (!form) return;

      const rawAction = form.getAttribute('action') || renderedPage.url;
      let actionUrl = renderedPage.url;
      try {
        actionUrl = new URL(rawAction, renderedPage.url).toString();
      } catch {
        actionUrl = renderedPage.url;
      }

      const method = (form.getAttribute('method') || 'GET').toUpperCase();
      const fd = new FormData(form);
      const params = new URLSearchParams();
      fd.forEach((val, key) => {
        if (typeof val === 'string') params.append(key, val);
      });

      if (method === 'POST') {
        onNavigate(actionUrl, { method: 'POST', formData: params.toString() });
      } else {
        const parsed = new URL(actionUrl);
        params.forEach((v, k) => parsed.searchParams.set(k, v));
        onNavigate(parsed.toString());
      }
    };

    shadow.addEventListener('click', handleClick);
    shadow.addEventListener('submit', handleSubmit);
    return () => {
      shadow.removeEventListener('click', handleClick);
      shadow.removeEventListener('submit', handleSubmit);
    };
  }, [isVercelMode, onNavigate, renderedPage, state.inspectMode]);

  // Register live Shadow DOM inspection & style editing bridge
  useEffect(() => {
    if (!registerShadowBridge) return;
    if (!isVercelMode) {
      registerShadowBridge(null);
      return;
    }

    const bridge: ShadowDomBridge = {
      getRootElement: () => shadowRootRef.current,
      getDomTree: () => {
        const root = shadowRootRef.current;
        if (!root) return null;
        const bodyEl = root.querySelector('.sv-body') || root.firstElementChild;
        return buildShadowDomTree(bodyEl, root);
      },
      inspectAt: (viewportX, viewportY) => {
        const root = shadowRootRef.current;
        const screenEl = screenRef.current;
        if (!root || !screenEl) return null;
        const rect = screenEl.getBoundingClientRect();
        const clientX = rect.left + viewportX * scale;
        const clientY = rect.top + viewportY * scale;
        const hit = root.elementFromPoint(clientX, clientY);
        if (!hit || hit === shadowHostRef.current) return null;
        return extractInspectedElement(hit, root, rect, scale);
      },
      inspectSelector: (selector) => {
        const root = shadowRootRef.current;
        const screenEl = screenRef.current;
        if (!root || !screenEl || !selector) return null;
        try {
          const hit = root.querySelector(selector);
          if (!hit) return null;
          return extractInspectedElement(hit, root, screenEl.getBoundingClientRect(), scale);
        } catch {
          return null;
        }
      },
      updateElementStyle: (selector, property, value) => {
        const root = shadowRootRef.current;
        const screenEl = screenRef.current;
        if (!root || !screenEl || !selector) return null;
        try {
          const hit = root.querySelector(selector) as HTMLElement | null;
          if (!hit) return null;
          hit.style.setProperty(property, value);
          return extractInspectedElement(hit, root, screenEl.getBoundingClientRect(), scale).element;
        } catch {
          return null;
        }
      },
      exportHtmlSnapshot: () => {
        const root = shadowRootRef.current;
        if (!root) return;
        const blob = new Blob([root.innerHTML], { type: 'text/html;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `stealthview-snapshot-${Date.now()}.html`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 1500);
      },
    };

    registerShadowBridge(bridge);
    return () => registerShadowBridge(null);
  }, [isVercelMode, registerShadowBridge, scale]);

  const mapToViewport = (clientX: number, clientY: number) => {
    const rect = screenRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const relX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const relY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    return {
      x: Math.round((relX / rect.width) * state.viewportWidth),
      y: Math.round((relY / rect.height) * state.viewportHeight),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isVercelMode) {
      screenRef.current?.focus();
    }
    setScreenFocused(true);

    if (state.inspectMode) {
      e.preventDefault();
      const pt = mapToViewport(e.clientX, e.clientY);
      onInspectAt(pt.x, pt.y, true);
      onElementPicked();
      return;
    }

    if (isVercelMode) return;

    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (state.inspectMode) {
      const now = Date.now();
      if (now - lastInspectHoverRef.current > 75) {
        lastInspectHoverRef.current = now;
        const pt = mapToViewport(e.clientX, e.clientY);
        onInspectAt(pt.x, pt.y, false);
      }
      return;
    }

    if (isVercelMode || !dragRef.current.active) return;
    const totalDx = Math.abs(e.clientX - dragRef.current.startX);
    const totalDy = Math.abs(e.clientY - dragRef.current.startY);
    if (totalDx > 5 || totalDy > 5) {
      dragRef.current.moved = true;
    }
    if (dragRef.current.moved) {
      const stepDx = dragRef.current.lastX - e.clientX;
      const stepDy = dragRef.current.lastY - e.clientY;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      const pt = mapToViewport(e.clientX, e.clientY);
      queueWheel(pt.x, pt.y, stepDx * 1.5, stepDy * 1.5);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (state.inspectMode || isVercelMode) return;
    if (!dragRef.current.active) return;
    const wasMoved = dragRef.current.moved;
    dragRef.current.active = false;
    if (!wasMoved) {
      const pt = mapToViewport(e.clientX, e.clientY);
      onPointer('tap', pt.x, pt.y);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (state.inspectMode || isVercelMode) return;
    const pt = mapToViewport(e.clientX, e.clientY);
    queueWheel(pt.x, pt.y, e.deltaX, e.deltaY);
  };

  const handleScreenKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isVercelMode) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length === 1) {
      e.preventDefault();
      onKeyboard('type', e.key);
      return;
    }
    const mappedKeys = ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete'];
    if (mappedKeys.includes(e.key)) {
      e.preventDefault();
      onKeyboard('key', undefined, e.key);
    }
  };

  const handleAddressSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNavigate(addressInput);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const currentDevice = DEVICE_PRESETS.find((d) => d.id === state.deviceId) || DEVICE_PRESETS[0];
  const clockLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <section className="flex flex-col h-full min-h-0 bg-slate-100/80 dark:bg-[#0A0F1D] border-r border-slate-200 dark:border-slate-800">
      {/* Minimal Single-Row Mobile Address Bar */}
      <div className="px-3.5 h-11 bg-white dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onBack}
            disabled={!state.canGoBack}
            title="Back"
            className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onForward}
            disabled={!state.canGoForward}
            title="Forward"
            className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onReload}
            title="Reload page"
            className="p-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <RotateCw className={`w-4 h-4 ${state.loading ? 'animate-spin text-sky-500' : ''}`} />
          </button>
        </div>

        <form onSubmit={handleAddressSubmit} className="flex-1 min-w-0 flex items-center">
          <div className="relative flex-1 min-w-0 flex items-center">
            <span className="absolute left-2.5 text-slate-400 pointer-events-none flex items-center">
              {state.url.startsWith('https://') ? (
                <Lock className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Globe className="w-3.5 h-3.5 text-slate-400" />
              )}
            </span>
            <input
              type="text"
              value={addressInput}
              onFocus={() => setAddressFocused(true)}
              onBlur={() => setAddressFocused(false)}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="Enter URL or search query..."
              aria-label="Mobile browser URL"
              className="w-full h-8 pl-8 pr-14 text-xs font-mono bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:border-sky-500 transition-colors"
            />
            <button
              type="submit"
              className="absolute right-1 px-2.5 py-1 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded transition-colors whitespace-nowrap shrink-0"
            >
              Go
            </button>
          </div>
        </form>
      </div>

      {/* Dedicated Large Mobile Device Stage */}
      <div
        ref={stageContainerRef}
        className="flex-1 min-h-0 flex flex-col items-center justify-center p-2.5 overflow-auto devtools-scroll relative"
      >
        <div
          className="relative flex flex-col items-center bg-[#181C24] rounded-[34px] p-[9px] shadow-2xl border border-slate-700/80 select-none"
          style={{
            width: displayW + 20,
          }}
        >
          {/* Slim Top Hardware Status Bar */}
          <div className="w-full px-4 py-1 flex items-center justify-between text-[11px] font-medium text-slate-200 bg-black rounded-t-[26px]">
            <span className="tabular-nums font-mono">{clockLabel}</span>
            {state.orientation === 'portrait' && (
              <div className="w-18 h-3.5 bg-[#12151C] rounded-full border border-slate-800/80 flex items-center justify-end pr-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-800 border border-slate-700" />
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[10px] text-slate-300 tabular-nums">
              {state.proxy.enabled && (
                <ShieldCheck className="w-3 h-3 text-emerald-400" aria-label="Proxy active" />
              )}
              <Wifi className="w-3 h-3" />
              <span>5G</span>
            </div>
          </div>

          {/* Crisp Interactive Mobile Screen */}
          <div
            ref={screenRef}
            tabIndex={isVercelMode ? -1 : 0}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              dragRef.current.active = false;
            }}
            onWheel={handleWheel}
            onKeyDown={handleScreenKeyDown}
            style={{ width: displayW, height: displayH }}
            className={`relative bg-white overflow-hidden outline-none ${
              state.inspectMode ? 'cursor-crosshair' : isVercelMode ? 'cursor-default' : 'cursor-pointer'
            } ${screenFocused && !isVercelMode ? 'ring-1 ring-sky-500/60' : ''}`}
          >
            {isVercelMode ? (
              renderedPage ? (
                <div
                  style={{
                    width: state.viewportWidth,
                    height: state.viewportHeight,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                  }}
                  className="bg-white overflow-hidden select-text"
                >
                  <div ref={shadowHostRef} className="w-full h-full" />
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-300 px-6 text-center gap-2">
                  <RotateCw className="w-5 h-5 animate-spin text-sky-400" />
                  <p className="text-xs font-medium">Fetching mobile viewport via proxy...</p>
                  <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                    {state.proxy.server}
                  </p>
                </div>
              )
            ) : frameDataUrl ? (
              <img
                src={frameDataUrl}
                alt={`Mobile viewport rendering ${state.url}`}
                draggable={false}
                className="w-full h-full object-fill pointer-events-none select-none"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-300 px-6 text-center gap-2">
                <RotateCw className="w-5 h-5 animate-spin text-sky-400" />
                <p className="text-xs font-medium">Launching headless mobile engine via proxy...</p>
                <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {state.proxy.server}
                </p>
              </div>
            )}

            {state.loading && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-sky-500/20 overflow-hidden pointer-events-none">
                <div className="h-full w-1/2 bg-sky-500 animate-[pulse_1s_ease-in-out_infinite]" />
              </div>
            )}

            {highlightRect && (
              <div
                className="absolute pointer-events-none border border-sky-500 bg-sky-500/15 transition-all duration-75"
                style={{
                  left: highlightRect.x * scale,
                  top: highlightRect.y * scale,
                  width: Math.max(2, highlightRect.width * scale),
                  height: Math.max(2, highlightRect.height * scale),
                }}
              >
                <div className="absolute -top-5 left-0 px-1.5 py-0.5 bg-slate-900/95 text-sky-300 text-[10px] font-mono whitespace-nowrap rounded shadow">
                  {highlightRect.label}
                </div>
              </div>
            )}
          </div>

          {/* Slim Bottom Home Indicator */}
          <div className="w-full py-1.5 flex items-center justify-center bg-black rounded-b-[26px]">
            <div className="w-22 h-1 rounded-full bg-slate-600" />
          </div>
        </div>

        {/* Quiet Single-Line Metadata */}
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
          <span>{currentDevice.name}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">
            {state.viewportWidth}×{state.viewportHeight}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {state.identity?.ip ? `IP ${state.identity.ip}` : 'Resolving proxy'}
          </span>
          {state.identity?.city && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {state.identity.city}, {state.identity.countryCode}
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
};
