import React, { useMemo, useState } from 'react';
import { Search, Shield, ShieldOff, Trash2, X } from 'lucide-react';
import type { NetworkEntry, ThrottlingMode } from '../../types/browser.ts';

interface NetworkPanelProps {
  entries: NetworkEntry[];
  throttling: ThrottlingMode;
  blockTrackers: boolean;
  blockedCount: number;
  onSetThrottling: (mode: ThrottlingMode) => void;
  onToggleTrackers: (enabled: boolean) => void;
  onClear: () => void;
  onFetchDetail: (id: string) => Promise<NetworkEntry | null>;
}

type TypeFilter = 'all' | 'xhr' | 'doc' | 'js' | 'css' | 'img';

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const NetworkPanel: React.FC<NetworkPanelProps> = ({
  entries,
  throttling,
  blockTrackers,
  blockedCount,
  onSetThrottling,
  onToggleTrackers,
  onClear,
  onFetchDetail,
}) => {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<NetworkEntry | null>(null);
  const [detailTab, setDetailTab] = useState<'headers' | 'response'>('headers');

  const filtered = useMemo(() => {
    return entries.filter((item) => {
      if (typeFilter === 'xhr' && !['xhr', 'fetch'].includes(item.resourceType)) return false;
      if (typeFilter === 'doc' && item.resourceType !== 'document') return false;
      if (typeFilter === 'js' && item.resourceType !== 'script') return false;
      if (typeFilter === 'css' && item.resourceType !== 'stylesheet') return false;
      if (typeFilter === 'img' && item.resourceType !== 'image') return false;
      if (search && !item.url.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [entries, typeFilter, search]);

  const handleSelectRow = async (entry: NetworkEntry) => {
    setSelected(entry);
    const full = await onFetchDetail(entry.id);
    if (full) setSelected(full);
  };

  const renderStatus = (entry: NetworkEntry) => {
    if (entry.blocked) {
      return <span className="text-amber-600 dark:text-amber-400 font-medium">Blocked</span>;
    }
    if (entry.failed) {
      return <span className="text-red-600 dark:text-red-400 font-medium">Failed</span>;
    }
    if (entry.status === null) {
      return <span className="text-slate-400">Pending</span>;
    }
    if (entry.status >= 400) {
      return <span className="text-red-600 dark:text-red-400 font-semibold">{entry.status}</span>;
    }
    if (entry.status >= 300) {
      return <span className="text-amber-600 dark:text-amber-400 font-semibold">{entry.status}</span>;
    }
    return <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{entry.status}</span>;
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-900 rounded-md border border-slate-200 dark:border-slate-800">
            {(
              [
                ['all', 'All'],
                ['xhr', 'Fetch/XHR'],
                ['doc', 'Doc'],
                ['js', 'JS'],
                ['css', 'CSS'],
                ['img', 'Img'],
              ] as Array<[TypeFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTypeFilter(key)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  typeFilter === key
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="Network throttling"
              value={throttling}
              onChange={(e) => onSetThrottling(e.target.value as ThrottlingMode)}
              className="h-7 px-2 text-xs font-medium bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:border-sky-500"
            >
              <option value="none">No Throttling</option>
              <option value="fast3g">Fast 3G</option>
              <option value="slow3g">Slow 3G</option>
              <option value="offline">Offline</option>
            </select>

            <button
              type="button"
              onClick={() => onToggleTrackers(!blockTrackers)}
              className={`h-7 px-2.5 flex items-center gap-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                blockTrackers
                  ? 'bg-emerald-600/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
              title="Block common third-party ad and analytics trackers"
            >
              {blockTrackers ? <Shield className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
              <span className="tabular-nums">Shield {blockTrackers ? `On (${blockedCount})` : 'Off'}</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter requests by URL..."
              aria-label="Filter network requests"
              className="w-full h-7 pl-8 pr-2 text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:border-sky-500"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              onClear();
              setSelected(null);
            }}
            className="h-7 px-2.5 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Table & Optional Inspector Split */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className={`${selected ? 'h-1/2' : 'h-full'} overflow-auto devtools-scroll`}>
          {filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              <p>No network requests recorded matching this filter.</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Navigate or reload the mobile page to capture live HTTP/HTTPS traffic through the proxy.
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse table-fixed">
              <thead className="sticky top-0 bg-slate-50 dark:bg-[#0F172A] border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-1.5 px-2.5 w-16">Status</th>
                  <th className="py-1.5 px-2 w-14">Method</th>
                  <th className="py-1.5 px-2">Name / URL</th>
                  <th className="py-1.5 px-2 w-20">Type</th>
                  <th className="py-1.5 px-2 w-20 text-right">Size</th>
                  <th className="py-1.5 px-2.5 w-18 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/70 text-xs font-mono tabular-nums">
                {filtered.map((entry) => {
                  let displayName = entry.url;
                  try {
                    const u = new URL(entry.url);
                    displayName = `${u.hostname}${u.pathname}${u.search}`;
                  } catch {
                    // fallback to raw url
                  }
                  const isSel = selected?.id === entry.id;
                  return (
                    <tr
                      key={entry.id}
                      onClick={() => handleSelectRow(entry)}
                      className={`h-9 cursor-pointer transition-colors ${
                        isSel
                          ? 'bg-sky-600/15'
                          : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <td className="px-2.5 truncate">{renderStatus(entry)}</td>
                      <td className="px-2 text-slate-500 dark:text-slate-400 truncate">
                        {entry.method}
                      </td>
                      <td className="px-2 text-slate-800 dark:text-slate-200 truncate" title={entry.url}>
                        {displayName}
                      </td>
                      <td className="px-2 text-slate-500 dark:text-slate-400 truncate">
                        {entry.resourceType}
                      </td>
                      <td className="px-2 text-right text-slate-600 dark:text-slate-300 truncate">
                        {formatBytes(entry.sizeBytes)}
                      </td>
                      <td className="px-2.5 text-right text-slate-600 dark:text-slate-300 truncate">
                        {entry.durationMs !== null ? `${entry.durationMs} ms` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <div className="h-1/2 border-t border-slate-200 dark:border-slate-800 flex flex-col min-h-0 bg-white dark:bg-[#0D1424]">
            <div className="px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDetailTab('headers')}
                  className={`px-2 py-1 text-xs font-medium rounded ${
                    detailTab === 'headers'
                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Headers
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTab('response')}
                  className={`px-2 py-1 text-xs font-medium rounded ${
                    detailTab === 'response'
                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Response Preview
                </button>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close request details"
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto devtools-scroll p-3 text-xs font-mono space-y-3">
              {detailTab === 'headers' ? (
                <>
                  <div>
                    <div className="font-sans font-semibold text-slate-700 dark:text-slate-200 mb-1">
                      General
                    </div>
                    <div className="text-[11px] space-y-1 text-slate-600 dark:text-slate-300 break-all">
                      <div>URL: {selected.url}</div>
                      <div>
                        Method: {selected.method} · Status: {selected.status ?? 'Pending'} {selected.statusText}
                      </div>
                    </div>
                  </div>
                  {selected.responseHeaders && (
                    <div>
                      <div className="font-sans font-semibold text-slate-700 dark:text-slate-200 mb-1">
                        Response Headers
                      </div>
                      <div className="space-y-0.5 text-[11px]">
                        {Object.entries(selected.responseHeaders).map(([k, v]) => (
                          <div key={k} className="break-all">
                            <span className="text-slate-400">{k}: </span>
                            <span className="text-slate-800 dark:text-slate-200">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.requestHeaders && (
                    <div>
                      <div className="font-sans font-semibold text-slate-700 dark:text-slate-200 mb-1">
                        Request Headers
                      </div>
                      <div className="space-y-0.5 text-[11px]">
                        {Object.entries(selected.requestHeaders).map(([k, v]) => (
                          <div key={k} className="break-all">
                            <span className="text-slate-400">{k}: </span>
                            <span className="text-slate-800 dark:text-slate-200">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <pre className="text-[11px] whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">
                  {selected.responseBodyPreview || 'No text response body available for this resource type.'}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
