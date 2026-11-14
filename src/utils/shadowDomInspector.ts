import type {
  DomNodeSummary,
  HighlightRect,
  InspectedElement,
} from '../types/browser.ts';

function buildUniqueSelector(el: Element, root: ParentNode): string {
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== (root as unknown as Element)) {
    const tag = cur.tagName.toLowerCase();
    if (cur.classList.contains('sv-doc')) break;
    if (cur.id) {
      parts.unshift(`#${CSS.escape(cur.id)}`);
      break;
    }
    const parentEl: Element | null = cur.parentElement;
    if (!parentEl) {
      parts.unshift(tag);
      break;
    }
    const siblings = Array.from(parentEl.children).filter(
      (child) => child.tagName === cur!.tagName,
    );
    const index = siblings.indexOf(cur) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    cur = parentEl;
  }
  return parts.join(' > ') || 'div.sv-body';
}

export function buildShadowDomTree(
  el: Element | null,
  root: ParentNode,
  depth = 0,
): DomNodeSummary | null {
  if (!el || depth > 7) return null;
  const tag = el.tagName.toLowerCase();
  if (tag === 'style' || tag === 'script') return null;

  const children: DomNodeSummary[] = [];
  const childElements = Array.from(el.children);
  for (let i = 0; i < Math.min(childElements.length, 30); i++) {
    const childSummary = buildShadowDomTree(childElements[i], root, depth + 1);
    if (childSummary) children.push(childSummary);
  }

  let directText = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      directText += node.textContent || '';
    }
  }
  directText = directText.replace(/\s+/g, ' ').trim().slice(0, 80);

  return {
    selector: buildUniqueSelector(el, root),
    tag,
    id: el.id || undefined,
    classes: Array.from(el.classList).filter((c) => c !== 'sv-doc' && c !== 'sv-body'),
    textPreview: directText || undefined,
    attributes: Array.from(el.attributes)
      .filter((a) => !a.name.startsWith('data-sv-'))
      .slice(0, 12)
      .map((a) => ({ name: a.name, value: a.value.slice(0, 140) })),
    children,
    childCount: childElements.length,
  };
}

export function extractInspectedElement(
  el: Element,
  root: ShadowRoot,
  containerRect: DOMRect,
  scale: number,
): { element: InspectedElement; highlight: HighlightRect } {
  const cs = window.getComputedStyle(el);
  const elRect = el.getBoundingClientRect();
  const safeScale = scale || 1;
  const relX = Math.round((elRect.left - containerRect.left) / safeScale);
  const relY = Math.round((elRect.top - containerRect.top) / safeScale);
  const relW = Math.round(elRect.width / safeScale);
  const relH = Math.round(elRect.height / safeScale);

  const trackedProps = [
    'display',
    'position',
    'width',
    'height',
    'margin',
    'padding',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'color',
    'background-color',
    'border',
    'border-radius',
    'flex-direction',
    'justify-content',
    'align-items',
    'gap',
  ];

  const computedStyles: Record<string, string> = {};
  for (const prop of trackedProps) {
    computedStyles[prop] = cs.getPropertyValue(prop);
  }

  const num = (prop: string) => Math.round(parseFloat(cs.getPropertyValue(prop)) || 0);
  const tag = el.tagName.toLowerCase();
  const idPart = el.id ? `#${el.id}` : '';
  const clsPart = el.classList.length
    ? `.${Array.from(el.classList)
        .filter((c) => !c.startsWith('sv-'))
        .slice(0, 2)
        .join('.')}`
    : '';

  const element: InspectedElement = {
    selector: buildUniqueSelector(el, root),
    tag,
    id: el.id || undefined,
    classes: Array.from(el.classList).filter((c) => !c.startsWith('sv-')),
    attributes: Array.from(el.attributes).map((a) => ({ name: a.name, value: a.value })),
    innerText: ((el as HTMLElement).innerText || el.textContent || '').trim().slice(0, 500),
    outerHTML: el.outerHTML.slice(0, 1200),
    rect: { x: relX, y: relY, width: relW, height: relH },
    computedStyles,
    inlineStyle: el.getAttribute('style') || '',
    boxModel: {
      margin: [num('margin-top'), num('margin-right'), num('margin-bottom'), num('margin-left')],
      border: [
        num('border-top-width'),
        num('border-right-width'),
        num('border-bottom-width'),
        num('border-left-width'),
      ],
      padding: [
        num('padding-top'),
        num('padding-right'),
        num('padding-bottom'),
        num('padding-left'),
      ],
      width: relW,
      height: relH,
    },
  };

  return {
    element,
    highlight: {
      x: relX,
      y: relY,
      width: relW,
      height: relH,
      label: `${tag}${idPart}${clsPart} · ${relW}×${relH}`,
    },
  };
}
