import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Crosshair, RefreshCw, Search } from 'lucide-react';
import type { DomNodeSummary, InspectedElement } from '../../types/browser.ts';

interface ElementsPanelProps {
  domTree: DomNodeSummary | null;
  inspectedElement: InspectedElement | null;
  inspectMode: boolean;
  onRefreshDom: () => void;
  onToggleInspect: () => void;
  onSelectSelector: (selector: string) => void;
  onHoverSelector: (selector: string) => void;
  onUpdateStyle: (selector: string, property: string, value: string) => void;
}

interface TreeNodeProps {
  node: DomNodeSummary;
  depth: number;
  selectedSelector?: string;
  filterQuery: string;
  onSelect: (selector: string) => void;
  onHover: (selector: string) => void;
}

const matchesFilter = (node: DomNodeSummary, query: string): boolean => {
  if (!query) return true;
  const q = query.toLowerCase();
  if (node.tag.toLowerCase().includes(q)) return true;
  if (node.id?.toLowerCase().includes(q)) return true;
  if (node.classes.some((c) => c.toLowerCase().includes(q))) return true;
  if (node.textPreview?.toLowerCase().includes(q)) return true;
  return node.children.some((c) => matchesFilter(c, q));
};

const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  depth,
  selectedSelector,
  filterQuery,
  onSelect,
  onHover,
}) => {
  const [expanded, setExpanded] = useState(depth < 3);

  if (filterQuery && !matchesFilter(node, filterQuery)) {
    return null;
  }

  const isSelected = selectedSelector === node.selector;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        onMouseEnter={() => onHover(node.selector)}
        onClick={() => onSelect(node.selector)}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        className={`flex items-center gap-1 py-1 pr-2 text-xs font-mono cursor-pointer select-none transition-colors ${
          isSelected
            ? 'bg-sky-600/15 text-sky-600 dark:text-sky-300'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => !prev);
            }}
            className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            aria-label={expanded ? 'Collapse node' : 'Expand node'}
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-4 inline-block shrink-0" />
        )}

        <span className="truncate">
          <span className="text-sky-600 dark:text-sky-400">&lt;{node.tag}</span>
          {node.id && <span className="text-amber-600 dark:text-amber-300">#{node.id}</span>}
          {node.classes.length > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400">
              .{node.classes.slice(0, 2).join('.')}
            </span>
          )}
          <span className="text-sky-600 dark:text-sky-400">&gt;</span>
          {node.textPreview && (
            <span className="ml-1.5 text-slate-500 dark:text-slate-400 font-sans">
              {node.textPreview}
            </span>
          )}
        </span>
      </div>

      {expanded &&
        hasChildren &&
        node.children.map((child, idx) => (
          <TreeNode
            key={`${child.selector}-${idx}`}
            node={child}
            depth={depth + 1}
            selectedSelector={selectedSelector}
            filterQuery={filterQuery}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}
    </div>
  );
};

export const ElementsPanel: React.FC<ElementsPanelProps> = ({
  domTree,
  inspectedElement,
  inspectMode,
  onRefreshDom,
  onToggleInspect,
  onSelectSelector,
  onHoverSelector,
  onUpdateStyle,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [styleProp, setStyleProp] = useState('');
  const [styleVal, setStyleVal] = useState('');

  useEffect(() => {
    if (!domTree) {
      onRefreshDom();
    }
  }, [domTree, onRefreshDom]);

  const handleAddStyle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectedElement || !styleProp.trim()) return;
    onUpdateStyle(inspectedElement.selector, styleProp.trim(), styleVal.trim());
    setStyleProp('');
    setStyleVal('');
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onToggleInspect}
          className={`h-7 px-2.5 flex items-center gap-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
            inspectMode
              ? 'bg-sky-600 border-sky-500 text-white'
              : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>{inspectMode ? 'Picking on Screen' : 'Pick Element'}</span>
        </button>

        <button
          type="button"
          onClick={onRefreshDom}
          className="h-7 px-2.5 flex items-center gap-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh DOM</span>
        </button>

        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter tag, #id, .class, or text..."
            aria-label="Filter DOM tree"
            className="w-full h-7 pl-8 pr-2.5 text-xs bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* Split: DOM Tree + Inspector */}
      <div className="flex-1 min-h-0 grid grid-rows-2 divide-y divide-slate-200 dark:divide-slate-800">
        <div className="overflow-auto devtools-scroll py-1">
          {domTree ? (
            <TreeNode
              node={domTree}
              depth={0}
              selectedSelector={inspectedElement?.selector}
              filterQuery={filterQuery}
              onSelect={onSelectSelector}
              onHover={onHoverSelector}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-slate-500 dark:text-slate-400 gap-2">
              <p>DOM snapshot has not been loaded yet.</p>
              <button
                type="button"
                onClick={onRefreshDom}
                className="px-3 py-1.5 text-xs font-medium bg-sky-600 text-white rounded hover:bg-sky-500 transition-colors"
              >
                Inspect Current Document
              </button>
            </div>
          )}
        </div>

        {/* Selected Element Inspector */}
        <div className="overflow-auto devtools-scroll p-3 space-y-4">
          {inspectedElement ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
                <div className="min-w-0">
                  <div className="text-xs font-mono font-semibold text-sky-600 dark:text-sky-400 truncate">
                    {inspectedElement.selector}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                    {Math.round(inspectedElement.rect.width)} × {Math.round(inspectedElement.rect.height)} px
                    <span className="mx-1.5">·</span>
                    Position ({Math.round(inspectedElement.rect.x)}, {Math.round(inspectedElement.rect.y)})
                  </div>
                </div>
              </div>

              {/* Box Model */}
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Box Model
                </div>
                <div className="border border-dashed border-amber-500/40 bg-amber-500/5 p-2 text-[11px] font-mono tabular-nums text-center">
                  <div className="text-amber-600 dark:text-amber-300 mb-1">
                    margin {inspectedElement.boxModel.margin.join(' ')}
                  </div>
                  <div className="border border-slate-300 dark:border-slate-700 bg-slate-200/40 dark:bg-slate-800/40 p-2">
                    <div className="text-emerald-600 dark:text-emerald-400 mb-1">
                      padding {inspectedElement.boxModel.padding.join(' ')}
                    </div>
                    <div className="bg-sky-500/15 border border-sky-500/30 py-1.5 text-sky-700 dark:text-sky-300 font-semibold">
                      {inspectedElement.boxModel.width} × {inspectedElement.boxModel.height}
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Style Editor */}
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Live Inline Style Override
                </div>
                <form onSubmit={handleAddStyle} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={styleProp}
                    onChange={(e) => setStyleProp(e.target.value)}
                    placeholder="property (e.g. color)"
                    className="flex-1 h-7 px-2 text-xs font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:border-sky-500"
                  />
                  <input
                    type="text"
                    value={styleVal}
                    onChange={(e) => setStyleVal(e.target.value)}
                    placeholder="value (e.g. #0ea5e9)"
                    className="flex-1 h-7 px-2 text-xs font-mono bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="submit"
                    className="h-7 px-3 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded transition-colors whitespace-nowrap shrink-0"
                  >
                    Apply
                  </button>
                </form>
                {inspectedElement.inlineStyle && (
                  <div className="mt-1.5 text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all">
                    style=&quot;{inspectedElement.inlineStyle}&quot;
                  </div>
                )}
              </div>

              {/* Computed Styles */}
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Computed Styles
                </div>
                <div className="divide-y divide-slate-200/70 dark:divide-slate-800/80 border border-slate-200 dark:border-slate-800 rounded">
                  {Object.entries(inspectedElement.computedStyles).map(([k, v]) => (
                    <div
                      key={k}
                      className="grid grid-cols-[130px_1fr] px-2.5 py-1 text-[11px] font-mono"
                    >
                      <span className="text-slate-500 dark:text-slate-400 truncate">{k}</span>
                      <span className="text-slate-800 dark:text-slate-200 truncate">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-xs text-slate-500 dark:text-slate-400">
              <p>Click any node in the DOM tree or enable Pick Element to inspect styles and box geometry.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
