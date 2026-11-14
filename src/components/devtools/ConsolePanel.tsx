import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ChevronRight, Info, Search, Terminal, Trash2 } from 'lucide-react';
import type { ConsoleEntry } from '../../types/browser.ts';

interface ConsolePanelProps {
  logs: ConsoleEntry[];
  onEvaluate: (expression: string) => void;
  onClear: () => void;
}

type LevelFilter = 'all' | 'errors' | 'warnings' | 'logs';

export const ConsolePanel: React.FC<ConsolePanelProps> = ({ logs, onEvaluate, onClear }) => {
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [search, setSearch] = useState('');
  const [expr, setExpr] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    return logs.filter((entry) => {
      if (filter === 'errors' && !['error', 'pageerror', 'eval-error'].includes(entry.type)) {
        return false;
      }
      if (filter === 'warnings' && entry.type !== 'warn') {
        return false;
      }
      if (filter === 'logs' && !['log', 'info', 'debug', 'eval-input', 'eval-result'].includes(entry.type)) {
        return false;
      }
      if (search && !entry.text.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [logs, filter, search]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [filtered.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = expr.trim();
    if (!trimmed) return;
    onEvaluate(trimmed);
    setHistory((prev) => [trimmed, ...prev.slice(0, 49)]);
    setHistoryIdx(-1);
    setExpr('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' && history.length > 0) {
      e.preventDefault();
      const nextIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(nextIdx);
      setExpr(history[nextIdx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx <= 0) {
        setHistoryIdx(-1);
        setExpr('');
      } else {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setExpr(history[nextIdx]);
      }
    }
  };

  const renderIconAndTone = (type: ConsoleEntry['type']) => {
    switch (type) {
      case 'error':
      case 'pageerror':
      case 'eval-error':
        return {
          icon: <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />,
          rowClass: 'bg-red-500/5 text-red-600 dark:text-red-300',
          label: 'ERR',
        };
      case 'warn':
        return {
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />,
          rowClass: 'bg-amber-500/5 text-amber-700 dark:text-amber-300',
          label: 'WRN',
        };
      case 'eval-input':
        return {
          icon: <ChevronRight className="w-3.5 h-3.5 text-sky-500 shrink-0" />,
          rowClass: 'text-slate-900 dark:text-slate-100',
          label: 'IN',
        };
      case 'eval-result':
        return {
          icon: <Terminal className="w-3.5 h-3.5 text-emerald-500 shrink-0" />,
          rowClass: 'text-emerald-700 dark:text-emerald-300',
          label: 'OUT',
        };
      default:
        return {
          icon: <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />,
          rowClass: 'text-slate-700 dark:text-slate-300',
          label: 'LOG',
        };
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-900 rounded-md border border-slate-200 dark:border-slate-800">
          {(['all', 'errors', 'warnings', 'logs'] as LevelFilter[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors capitalize whitespace-nowrap shrink-0 ${
                filter === tab
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-[160px] justify-end">
          <div className="relative flex-1 max-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter console..."
              aria-label="Filter console output"
              className="w-full h-7 pl-8 pr-2 text-xs bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:border-sky-500"
            />
          </div>
          <button
            type="button"
            onClick={onClear}
            className="h-7 px-2.5 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Log Stream */}
      <div className="flex-1 min-h-0 overflow-auto devtools-scroll divide-y divide-slate-200/60 dark:divide-slate-800/70 font-mono text-xs">
        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-500 dark:text-slate-400 font-sans">
            <p className="text-xs">No console messages match the current filter.</p>
            <p className="text-[11px] text-slate-400 mt-1">
              Run any expression below (e.g. <code className="font-mono">navigator.userAgent</code>) to evaluate inside the mobile page.
            </p>
          </div>
        ) : (
          filtered.map((entry) => {
            const tone = renderIconAndTone(entry.type);
            const ts = new Date(entry.timestamp).toLocaleTimeString([], {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            return (
              <div key={entry.id} className={`px-3 py-1.5 flex items-start gap-2 ${tone.rowClass}`}>
                <span className="mt-0.5">{tone.icon}</span>
                <span className="text-[11px] text-slate-400 tabular-nums shrink-0 mt-0.5">{ts}</span>
                <span className="text-[10px] font-semibold text-slate-400 w-7 shrink-0 mt-0.5">
                  {tone.label}
                </span>
                <pre className="flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                  {entry.text}
                </pre>
                {entry.location && (
                  <span className="text-[11px] text-slate-400 shrink-0 truncate max-w-[140px]">
                    {entry.location}
                  </span>
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Interactive JS REPL */}
      <form
        onSubmit={handleSubmit}
        className="px-3 py-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] flex items-center gap-2 shrink-0"
      >
        <ChevronRight className="w-4 h-4 text-sky-500 shrink-0" />
        <input
          type="text"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Evaluate JavaScript in mobile page context..."
          aria-label="JavaScript console prompt"
          className="flex-1 h-7 text-xs font-mono bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none placeholder:text-slate-400"
        />
        <button
          type="submit"
          className="h-7 px-3 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded transition-colors whitespace-nowrap shrink-0"
        >
          Run
        </button>
      </form>
    </div>
  );
};
