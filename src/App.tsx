import { useCallback, useEffect, useState } from 'react';
import { Moon, RefreshCw, Sun, UserX } from 'lucide-react';
import { DevToolsPanel, type DevToolsTab } from './components/devtools/DevToolsPanel.tsx';
import { MobileDeviceStage } from './components/MobileDeviceStage.tsx';
import { useBrowserSocket } from './hooks/useBrowserSocket.ts';

type LayoutMode = 'split' | 'device' | 'devtools';

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('split');
  const [activeTab, setActiveTab] = useState<DevToolsTab>('proxy');
  const [zoomMode, setZoomMode] = useState<'fit' | 'actual'>('fit');

  const {
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
  } = useBrowserSocket();

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  const handleRefreshDom = useCallback(() => {
    send({ type: 'getDomTree' });
  }, [send]);

  const handleRefreshStorage = useCallback(() => {
    send({ type: 'getStorage' });
  }, [send]);

  const handleSelectTab = useCallback(
    (tab: DevToolsTab) => {
      setActiveTab(tab);
      if (tab === 'elements') send({ type: 'getDomTree' });
      if (tab === 'storage') send({ type: 'getStorage' });
    },
    [send],
  );

  // Auto-refresh DOM tree & storage after page navigation completes
  useEffect(() => {
    if (!state.loading && state.connected) {
      if (activeTab === 'elements') send({ type: 'getDomTree' });
      if (activeTab === 'storage') send({ type: 'getStorage' });
    }
  }, [state.loading, state.url, state.connected, activeTab, send]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100">
      {/* Top Bar */}
      <header className="h-12 px-5 bg-white dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-8 shrink-0">
        {/* Zone 1: Brand + Context */}
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          <span
            className="text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            StealthView
          </span>
          <span className="text-slate-300 dark:text-slate-700 hidden sm:inline" aria-hidden="true">
            /
          </span>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 hidden sm:inline whitespace-nowrap shrink-0">
            Anonymous Mobile Browser
          </span>
        </div>

        {/* Zone 2: Workspace Layout Links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-medium" aria-label="Workspace layout">
          {(
            [
              ['split', 'Split View'],
              ['device', 'Device Focus'],
              ['devtools', 'DevTools Focus'],
            ] as Array<[LayoutMode, string]>
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setLayoutMode(mode)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                layoutMode === mode
                  ? 'border-sky-500 text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Primary Action + Theme Toggle */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setDarkMode((prev) => !prev)}
            aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => send({ type: 'newIdentity' })}
            className="h-8 px-3.5 flex items-center gap-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <UserX className="w-3.5 h-3.5" />
            <span>New Identity</span>
          </button>
        </div>
      </header>

      {/* Connection / Navigation Error Banner */}
      {(socketError || state.lastError || wsStatus === 'reconnecting') && (
        <div className="px-5 py-1.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between gap-4 text-xs text-amber-700 dark:text-amber-300 shrink-0">
          <span className="truncate">
            {wsStatus === 'reconnecting'
              ? 'Reconnecting to headless browser session...'
              : socketError || state.lastError}
          </span>
          <button
            type="button"
            onClick={() => send({ type: 'reload' })}
            className="flex items-center gap-1 font-medium hover:underline whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Main Split Workspace: Left Dedicated Device Screen / Right All Tools & DevTools */}
      <main
        className={`flex-1 min-h-0 grid ${
          layoutMode === 'split'
            ? 'grid-cols-1 lg:grid-cols-[minmax(440px,43%)_1fr]'
            : 'grid-cols-1'
        }`}
      >
        {layoutMode !== 'devtools' && (
          <MobileDeviceStage
            state={state}
            frameDataUrl={frameDataUrl}
            highlightRect={highlightRect}
            zoomMode={zoomMode}
            onNavigate={(url) => send({ type: 'navigate', url })}
            onBack={() => send({ type: 'back' })}
            onForward={() => send({ type: 'forward' })}
            onReload={() => send({ type: 'reload' })}
            onPointer={(action, x, y) => send({ type: 'pointer', action, x, y })}
            onWheel={(x, y, deltaX, deltaY) => send({ type: 'wheel', x, y, deltaX, deltaY })}
            onKeyboard={(action, text, key) => send({ type: 'keyboard', action, text, key })}
            onInspectAt={(x, y, selectElement) =>
              send({ type: 'inspectAt', x, y, selectElement })
            }
            onElementPicked={() => {
              setActiveTab('elements');
              if (layoutMode === 'device') setLayoutMode('split');
              send({ type: 'setInspectMode', enabled: false });
            }}
          />
        )}

        {layoutMode !== 'device' && (
          <DevToolsPanel
            activeTab={activeTab}
            onSelectTab={handleSelectTab}
            state={state}
            zoomMode={zoomMode}
            onToggleZoom={() => setZoomMode((z) => (z === 'fit' ? 'actual' : 'fit'))}
            onSetDevice={(deviceId, orientation) =>
              send({ type: 'setDevice', deviceId, orientation })
            }
            onNavigate={(url) => send({ type: 'navigate', url })}
            onKeyboard={(action, text, key) => send({ type: 'keyboard', action, text, key })}
            onTakeScreenshot={() => send({ type: 'takeScreenshot' })}
            network={network}
            consoleLogs={consoleLogs}
            domTree={domTree}
            inspectedElement={inspectedElement}
            storage={storage}
            onRefreshDom={handleRefreshDom}
            onToggleInspect={() => send({ type: 'setInspectMode', enabled: !state.inspectMode })}
            onSelectSelector={(selector) =>
              send({ type: 'inspectSelector', selector, selectElement: true })
            }
            onHoverSelector={(selector) =>
              send({ type: 'inspectSelector', selector, selectElement: false })
            }
            onUpdateStyle={(selector, property, value) =>
              send({ type: 'updateElementStyle', selector, property, value })
            }
            onEvaluateConsole={(expression) => send({ type: 'evalConsole', expression })}
            onClearConsole={() => send({ type: 'clearConsole' })}
            onSetThrottling={(mode) => send({ type: 'setThrottling', mode })}
            onToggleTrackers={(enabled) => send({ type: 'setBlockTrackers', enabled })}
            onClearNetwork={() => send({ type: 'clearNetwork' })}
            onFetchNetworkDetail={fetchNetworkDetail}
            onRefreshStorage={handleRefreshStorage}
            onDeleteCookie={(name, domain) => send({ type: 'deleteCookie', name, domain })}
            onClearStorage={() => send({ type: 'clearStorage' })}
            onVerifyProxy={() => send({ type: 'verifyProxy' })}
            onSelectProxyProfile={(profileId) =>
              send({ type: 'selectProxyProfile', profileId })
            }
            onAddProxyProfile={(profile) => send({ type: 'addProxyProfile', ...profile })}
            onUpdateProxy={(proxy) => send({ type: 'updateProxy', ...proxy })}
            onSetGeolocation={(latitude, longitude) =>
              send({ type: 'setGeolocation', latitude, longitude })
            }
            onNewIdentity={() => send({ type: 'newIdentity' })}
            onNavigateIpCheck={() => send({ type: 'navigate', url: 'https://ipv4.webshare.io/' })}
          />
        )}
      </main>
    </div>
  );
}
