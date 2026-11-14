import React, { useEffect, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import type { StorageSnapshot } from '../../types/browser.ts';

interface StoragePanelProps {
  storage: StorageSnapshot | null;
  onRefresh: () => void;
  onDeleteCookie: (name: string, domain: string) => void;
  onClearAll: () => void;
}

type StorageTab = 'cookies' | 'local' | 'session';

export const StoragePanel: React.FC<StoragePanelProps> = ({
  storage,
  onRefresh,
  onDeleteCookie,
  onClearAll,
}) => {
  const [subTab, setSubTab] = useState<StorageTab>('cookies');

  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-900 rounded-md border border-slate-200 dark:border-slate-800">
          {(
            [
              ['cookies', `Cookies (${storage?.cookies.length ?? 0})`],
              ['local', `localStorage (${storage?.localStorage.length ?? 0})`],
              ['session', `sessionStorage (${storage?.sessionStorage.length ?? 0})`],
            ] as Array<[StorageTab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors tabular-nums whitespace-nowrap shrink-0 ${
                subTab === key
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="h-7 px-2.5 flex items-center gap-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className="h-7 px-2.5 flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Site Data</span>
          </button>
        </div>
      </div>

      {storage?.origin && (
        <div className="px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0 truncate">
          Origin: {storage.origin}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto devtools-scroll">
        {subTab === 'cookies' && (
          <>
            {!storage || storage.cookies.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                <p>No cookies stored for the current mobile browsing session.</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse table-fixed">
                <thead className="sticky top-0 bg-slate-50 dark:bg-[#0F172A] border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-1.5 px-3 w-36">Name</th>
                    <th className="py-1.5 px-2">Value</th>
                    <th className="py-1.5 px-2 w-32">Domain</th>
                    <th className="py-1.5 px-2 w-20">Flags</th>
                    <th className="py-1.5 px-3 w-12 text-right">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/70 text-xs font-mono">
                  {storage.cookies.map((c, idx) => (
                    <tr key={`${c.name}-${c.domain}-${idx}`} className="h-9 hover:bg-slate-100/70 dark:hover:bg-slate-800/40">
                      <td className="px-3 text-sky-600 dark:text-sky-400 truncate" title={c.name}>
                        {c.name}
                      </td>
                      <td className="px-2 text-slate-800 dark:text-slate-200 truncate" title={c.value}>
                        {c.value}
                      </td>
                      <td className="px-2 text-slate-500 dark:text-slate-400 truncate">{c.domain}</td>
                      <td className="px-2 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {[c.httpOnly ? 'HttpOnly' : '', c.secure ? 'Secure' : ''].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-3 text-right">
                        <button
                          type="button"
                          onClick={() => onDeleteCookie(c.name, c.domain)}
                          aria-label={`Delete cookie ${c.name}`}
                          className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {subTab === 'local' && (
          <>
            {!storage || storage.localStorage.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                <p>No localStorage keys found on this origin.</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse table-fixed">
                <thead className="sticky top-0 bg-slate-50 dark:bg-[#0F172A] border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-1.5 px-3 w-48">Key</th>
                    <th className="py-1.5 px-3">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/70 text-xs font-mono">
                  {storage.localStorage.map((item) => (
                    <tr key={item.key} className="h-9 hover:bg-slate-100/70 dark:hover:bg-slate-800/40">
                      <td className="px-3 text-sky-600 dark:text-sky-400 truncate">{item.key}</td>
                      <td className="px-3 text-slate-800 dark:text-slate-200 truncate" title={item.value}>
                        {item.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {subTab === 'session' && (
          <>
            {!storage || storage.sessionStorage.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                <p>No sessionStorage keys found on this origin.</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse table-fixed">
                <thead className="sticky top-0 bg-slate-50 dark:bg-[#0F172A] border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-1.5 px-3 w-48">Key</th>
                    <th className="py-1.5 px-3">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/70 text-xs font-mono">
                  {storage.sessionStorage.map((item) => (
                    <tr key={item.key} className="h-9 hover:bg-slate-100/70 dark:hover:bg-slate-800/40">
                      <td className="px-3 text-sky-600 dark:text-sky-400 truncate">{item.key}</td>
                      <td className="px-3 text-slate-800 dark:text-slate-200 truncate" title={item.value}>
                        {item.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
};
