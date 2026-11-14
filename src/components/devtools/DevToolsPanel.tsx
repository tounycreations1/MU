import React, { useState } from 'react';
import {
  Camera,
  Code2,
  Crosshair,
  Database,
  Network,
  RotateCcw,
  Send,
  ShieldCheck,
  Smartphone,
  Terminal,
} from 'lucide-react';
import { DEVICE_PRESETS, QUICK_BOOKMARKS } from '../../data/devices.ts';
import type {
  BrowserState,
  ConsoleEntry,
  DomNodeSummary,
  InspectedElement,
  NetworkEntry,
  ProxyConfig,
  StorageSnapshot,
  ThrottlingMode,
} from '../../types/browser.ts';
import { ConsolePanel } from './ConsolePanel.tsx';
import { ElementsPanel } from './ElementsPanel.tsx';
import { NetworkPanel } from './NetworkPanel.tsx';
import { ProxyPanel } from './ProxyPanel.tsx';
import { StoragePanel } from './StoragePanel.tsx';

export type DevToolsTab = 'elements' | 'console' | 'network' | 'storage' | 'proxy';

interface DevToolsPanelProps {
  activeTab: DevToolsTab;
  onSelectTab: (tab: DevToolsTab) => void;
  state: BrowserState;
  zoomMode: 'fit' | 'actual';
  onToggleZoom: () => void;
  onSetDevice: (deviceId: string, orientation?: 'portrait' | 'landscape') => void;
  onNavigate: (url: string) => void;
  onKeyboard: (action: 'type' | 'key', text?: string, key?: string) => void;
  onTakeScreenshot: () => void;
  network: NetworkEntry[];
  consoleLogs: ConsoleEntry[];
  domTree: DomNodeSummary | null;
  inspectedElement: InspectedElement | null;
  storage: StorageSnapshot | null;
  onRefreshDom: () => void;
  onToggleInspect: () => void;
  onSelectSelector: (selector: string) => void;
  onHoverSelector: (selector: string) => void;
  onUpdateStyle: (selector: string, property: string, value: string) => void;
  onEvaluateConsole: (expr: string) => void;
  onClearConsole: () => void;
  onSetThrottling: (mode: ThrottlingMode) => void;
  onToggleTrackers: (enabled: boolean) => void;
  onClearNetwork: () => void;
  onFetchNetworkDetail: (id: string) => Promise<NetworkEntry | null>;
  onRefreshStorage: () => void;
  onDeleteCookie: (name: string, domain: string) => void;
  onClearStorage: () => void;
  onVerifyProxy: () => void;
  onSelectProxyProfile: (profileId: string) => void;
  onAddProxyProfile: (profile: {
    label: string;
    server: string;
    username: string;
    password: string;
  }) => void;
  onUpdateProxy: (proxy: Partial<ProxyConfig>) => void;
  onSetGeolocation: (latitude: number, longitude: number) => void;
  onNewIdentity: () => void;
  onNavigateIpCheck: () => void;
}

export const DevToolsPanel: React.FC<DevToolsPanelProps> = ({
  activeTab,
  onSelectTab,
  state,
  zoomMode,
  onToggleZoom,
  onSetDevice,
  onNavigate,
  onKeyboard,
  onTakeScreenshot,
  network,
  consoleLogs,
  domTree,
  inspectedElement,
  storage,
  onRefreshDom,
  onToggleInspect,
  onSelectSelector,
  onHoverSelector,
  onUpdateStyle,
  onEvaluateConsole,
  onClearConsole,
  onSetThrottling,
  onToggleTrackers,
  onClearNetwork,
  onFetchNetworkDetail,
  onRefreshStorage,
  onDeleteCookie,
  onClearStorage,
  onVerifyProxy,
  onSelectProxyProfile,
  onAddProxyProfile,
  onUpdateProxy,
  onSetGeolocation,
  onNewIdentity,
  onNavigateIpCheck,
}) => {
  const [quickTypeText, setQuickTypeText] = useState('');

  const handleQuickTypeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTypeText) return;
    onKeyboard('type', quickTypeText);
    setQuickTypeText('');
  };

  const errorCount = consoleLogs.filter((c) =>
    ['error', 'pageerror', 'eval-error'].includes(c.type),
  ).length;

  const tabs: Array<{ id: DevToolsTab; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'elements', label: 'Elements', icon: <Code2 className="w-3.5 h-3.5" /> },
    {
      id: 'console',
      label: 'Console',
      icon: <Terminal className="w-3.5 h-3.5" />,
      count: errorCount > 0 ? errorCount : undefined,
    },
    {
      id: 'network',
      label: 'Network',
      icon: <Network className="w-3.5 h-3.5" />,
      count: network.length > 0 ? network.length : undefined,
    },
    { id: 'storage', label: 'Storage', icon: <Database className="w-3.5 h-3.5" /> },
    { id: 'proxy', label: 'Proxy & Location', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  ];

  return (
    <section className="flex flex-col h-full min-h-0 bg-white dark:bg-[#0F172A]">
      {/* Right-Side Mobile & Browser Controls Dock */}
      <div className="px-3.5 py-2.5 bg-slate-50/80 dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800 space-y-2 shrink-0">
        {/* Device, Orientation, Proxy, Inspect, Capture */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                aria-label="Device preset"
                value={state.deviceId}
                onChange={(e) => onSetDevice(e.target.value, state.orientation)}
                className="h-8 px-2 text-xs font-medium bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:border-sky-500"
              >
                {DEVICE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} ({preset.width}×{preset.height})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() =>
                onSetDevice(state.deviceId, state.orientation === 'portrait' ? 'landscape' : 'portrait')
              }
              title="Rotate orientation"
              className="h-8 px-2.5 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{state.orientation === 'portrait' ? 'Portrait' : 'Landscape'}</span>
            </button>

            <button
              type="button"
              onClick={onToggleZoom}
              className="h-8 px-2.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
              title="Toggle auto-fit or 100% native size"
            >
              {zoomMode === 'fit' ? 'Auto Fit' : '100% Scale'}
            </button>

            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <select
                aria-label="Proxy exit location"
                value={state.activeProxyId || 'custom'}
                onChange={(e) => {
                  if (e.target.value !== 'custom') {
                    onSelectProxyProfile(e.target.value);
                  }
                }}
                className="h-8 px-2 text-xs font-medium bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:border-sky-500 max-w-[195px]"
              >
                {state.proxyProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label}
                  </option>
                ))}
                {!state.activeProxyId && <option value="custom">Custom Proxy</option>}
                <option value="direct">Direct (No Proxy)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onToggleInspect}
              className={`h-8 px-2.5 flex items-center gap-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                state.inspectMode
                  ? 'bg-sky-600 border-sky-500 text-white'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="Inspect element on mobile screen"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Inspect</span>
            </button>
            <button
              type="button"
              onClick={onTakeScreenshot}
              className="h-8 px-2.5 flex items-center gap-1.5 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-md transition-colors whitespace-nowrap shrink-0"
              title="Download PNG screenshot"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Capture</span>
            </button>
          </div>
        </div>

        {/* Bookmarks + Quick Mobile Input Helper */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 overflow-x-auto text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0">
              Sites:
            </span>
            {QUICK_BOOKMARKS.map((bm) => (
              <button
                key={bm.url}
                type="button"
                onClick={() => onNavigate(bm.url)}
                className="hover:text-sky-600 dark:hover:text-sky-400 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
              >
                {bm.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleQuickTypeSubmit} className="flex items-center gap-1.5 flex-1 min-w-[240px] max-w-[380px]">
            <input
              type="text"
              value={quickTypeText}
              onChange={(e) => setQuickTypeText(e.target.value)}
              placeholder="Send text to focused mobile input..."
              aria-label="Send text to mobile page"
              className="flex-1 h-7 px-2.5 text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              className="h-7 px-2.5 flex items-center gap-1 text-xs font-medium bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white rounded transition-colors whitespace-nowrap shrink-0"
            >
              <Send className="w-3 h-3" />
              <span>Type</span>
            </button>
            <button
              type="button"
              onClick={() => onKeyboard('key', undefined, 'Enter')}
              className="h-7 px-2 text-xs font-mono text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Enter
            </button>
          </form>
        </div>
      </div>

      {/* DevTools Tab Header */}
      <div className="px-3 h-10 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0 overflow-x-auto">
        <nav className="flex items-center gap-1" aria-label="Developer tools tabs">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className={`h-7 px-3 flex items-center gap-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-slate-900 dark:bg-slate-800 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/50'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      tab.id === 'console'
                        ? 'text-red-400'
                        : active
                          ? 'text-slate-300'
                          : 'text-slate-400'
                    }`}
                  >
                    ({tab.count})
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="hidden xl:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap shrink-0">
          <span className="truncate max-w-[200px]">{state.title}</span>
        </div>
      </div>

      {/* Active DevTools Panel */}
      <div className="flex-1 min-h-0">
        {activeTab === 'elements' && (
          <ElementsPanel
            domTree={domTree}
            inspectedElement={inspectedElement}
            inspectMode={state.inspectMode}
            onRefreshDom={onRefreshDom}
            onToggleInspect={onToggleInspect}
            onSelectSelector={onSelectSelector}
            onHoverSelector={onHoverSelector}
            onUpdateStyle={onUpdateStyle}
          />
        )}
        {activeTab === 'console' && (
          <ConsolePanel
            logs={consoleLogs}
            onEvaluate={onEvaluateConsole}
            onClear={onClearConsole}
          />
        )}
        {activeTab === 'network' && (
          <NetworkPanel
            entries={network}
            throttling={state.throttling}
            blockTrackers={state.blockTrackers}
            blockedCount={state.blockedCount}
            onSetThrottling={onSetThrottling}
            onToggleTrackers={onToggleTrackers}
            onClear={onClearNetwork}
            onFetchDetail={onFetchNetworkDetail}
          />
        )}
        {activeTab === 'storage' && (
          <StoragePanel
            storage={storage}
            onRefresh={onRefreshStorage}
            onDeleteCookie={onDeleteCookie}
            onClearAll={onClearStorage}
          />
        )}
        {activeTab === 'proxy' && (
          <ProxyPanel
            state={state}
            onVerifyProxy={onVerifyProxy}
            onSelectProxyProfile={onSelectProxyProfile}
            onAddProxyProfile={onAddProxyProfile}
            onUpdateProxy={onUpdateProxy}
            onSetGeolocation={onSetGeolocation}
            onNewIdentity={onNewIdentity}
            onNavigateIpCheck={onNavigateIpCheck}
          />
        )}
      </div>
    </section>
  );
};
