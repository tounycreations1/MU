import chromiumBin from '@sparticuz/chromium';
import { chromium } from 'playwright-core';
import {
  applyCorsHeaders,
  proxyFetch,
  readJsonBody,
  resolveProxyConfig,
  sendJson,
  VERCEL_PROXY_PRESETS,
} from './_proxyClient.js';

const DEVICE_PRESETS = [
  {
    id: 'iphone-15-pro',
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'pixel-8',
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36',
  },
  {
    id: 'galaxy-s24',
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36',
  },
  {
    id: 'iphone-se',
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'ipad-mini',
    width: 744,
    height: 1133,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
];

const TRACKER_PATTERNS = [
  'doubleclick.net',
  'googlesyndication.com',
  'google-analytics.com',
  'googletagmanager.com',
  'connect.facebook.net',
  'fbthirdpartypixel.com',
  'hotjar.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'amplitude.com',
  'scorecardresearch.com',
  'quantserve.com',
  'criteo.com',
  'taboola.com',
  'outbrain.com',
  'adservice.google.com',
  'tr.snapchat.com',
  'pixel.tapad.com',
];

function getGlobalStore() {
  if (!globalThis.__svVercelChromium) {
    globalThis.__svVercelChromium = {
      browser: null,
      context: null,
      page: null,
      cdp: null,
      deviceId: 'iphone-15-pro',
      orientation: 'portrait',
      proxyKey: '',
      proxyConfig: resolveProxyConfig('us-east-nj'),
      activeProxyId: 'us-east-nj',
      customProfiles: [],
      blockTrackers: true,
      blockedCount: 0,
      inspectMode: false,
      throttling: 'none',
      geolocation: { latitude: 40.4992716, longitude: -74.3990433 },
      timezone: 'America/New_York',
      identity: null,
      networkEntries: [],
      networkMap: new Map(),
      consoleEntries: [],
      lastError: null,
    };
  }
  return globalThis.__svVercelChromium;
}

async function getNavHistoryFlags(store) {
  if (!store.cdp) return { canGoBack: false, canGoForward: false };
  try {
    const hist = await store.cdp.send('Page.getNavigationHistory');
    const idx = Number(hist?.currentIndex ?? 0);
    const len = Array.isArray(hist?.entries) ? hist.entries.length : 0;
    return {
      canGoBack: idx > 0,
      canGoForward: idx < len - 1,
    };
  } catch {
    return { canGoBack: false, canGoForward: false };
  }
}

function getDevice(deviceId) {
  return DEVICE_PRESETS.find((d) => d.id === deviceId) || DEVICE_PRESETS[0];
}

function getViewport(deviceId, orientation) {
  const d = getDevice(deviceId);
  return orientation === 'landscape'
    ? { width: d.height, height: d.width }
    : { width: d.width, height: d.height };
}

function normalizeUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return 'https://ipv4.webshare.io/';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

async function resolveExecutable() {
  try {
    const p = await chromiumBin.executablePath();
    if (p) return p;
  } catch {
    // fallback below for local testing outside Lambda
  }
  return process.env.CHROMIUM_PATH || undefined;
}

async function ensureBrowser(store) {
  if (store.browser && store.browser.isConnected()) return store.browser;
  const executablePath = await resolveExecutable();
  const baseArgs = Array.isArray(chromiumBin.args)
    ? chromiumBin.args.filter((a) => a !== '--disable-web-security')
    : [];
  const args = [
    ...baseArgs,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
  ];
  const launchOpts = {
    executablePath,
    args,
    headless: true,
  };
  if (store.proxyConfig?.enabled && store.proxyConfig?.server) {
    launchOpts.proxy = {
      server: store.proxyConfig.server,
      username: store.proxyConfig.username || undefined,
      password: store.proxyConfig.password || undefined,
    };
  }
  store.browser = await chromium.launch(launchOpts);
  return store.browser;
}

function pushConsole(store, type, text, location) {
  store.consoleEntries.push({
    id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    text: String(text).slice(0, 1200),
    timestamp: Date.now(),
    location,
  });
  if (store.consoleEntries.length > 200) {
    store.consoleEntries = store.consoleEntries.slice(-200);
  }
}

async function createContextAndPage(store, cookiesToRestore = []) {
  // Always close previous single-process browser cleanly before creating a new proxy/device context
  if (store.context) {
    await store.context.close().catch(() => {});
    store.context = null;
    store.page = null;
    store.cdp = null;
  }
  if (store.browser) {
    await store.browser.close().catch(() => {});
    store.browser = null;
  }
  const browser = await ensureBrowser(store);

  const device = getDevice(store.deviceId);
  const vp = getViewport(store.deviceId, store.orientation);

  const ctxOptions = {
    viewport: vp,
    deviceScaleFactor: Math.min(device.deviceScaleFactor, 2),
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    userAgent: device.userAgent,
    locale: 'en-US',
    timezoneId: store.timezone || 'America/New_York',
    geolocation: store.geolocation,
    permissions: ['geolocation'],
    ignoreHTTPSErrors: true,
  };

  if (store.proxyConfig?.enabled && store.proxyConfig?.server) {
    ctxOptions.proxy = {
      server: store.proxyConfig.server,
      username: store.proxyConfig.username || undefined,
      password: store.proxyConfig.password || undefined,
    };
  }

  const context = await browser.newContext(ctxOptions);
  if (Array.isArray(cookiesToRestore) && cookiesToRestore.length > 0) {
    await context.addCookies(cookiesToRestore).catch(() => {});
  }

  await context.route('**/*', (route) => {
    const req = route.request();
    if (
      store.blockTrackers &&
      !req.isNavigationRequest() &&
      TRACKER_PATTERNS.some((p) => req.url().toLowerCase().includes(p))
    ) {
      store.blockedCount += 1;
      route.abort('blockedbyclient').catch(() => {});
      return;
    }
    route.continue().catch(() => {});
  });

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(20000);
  page.setDefaultTimeout(12000);

  page.on('console', (msg) => {
    const loc = msg.location();
    pushConsole(
      store,
      msg.type() === 'warning' ? 'warn' : msg.type(),
      msg.text(),
      loc?.url ? `${loc.url}:${loc.lineNumber ?? 0}` : undefined,
    );
  });

  page.on('pageerror', (err) => {
    pushConsole(store, 'pageerror', err.message || String(err));
  });

  page.on('request', (req) => {
    const id = `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const entry = {
      id,
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      status: null,
      statusText: 'Pending',
      startTime: Date.now(),
      durationMs: null,
      sizeBytes: null,
      requestHeaders: req.headers(),
      postData: req.postData()?.slice(0, 2000) ?? null,
    };
    store.networkMap.set(req, entry);
    store.networkEntries.push(entry);
    if (store.networkEntries.length > 200) {
      store.networkEntries = store.networkEntries.slice(-200);
    }
  });

  page.on('response', async (res) => {
    const entry = store.networkMap.get(res.request());
    if (!entry) return;
    entry.status = res.status();
    entry.statusText = res.statusText() || 'OK';
    entry.durationMs = Date.now() - entry.startTime;
    entry.responseHeaders = res.headers();
    entry.mimeType = res.headers()['content-type'];
    if (['document', 'xhr', 'fetch'].includes(entry.resourceType)) {
      try {
        const buf = await res.body();
        entry.sizeBytes = buf.length;
        if (buf.length <= 32768) {
          entry.responseBodyPreview = buf.toString('utf8').slice(0, 8000);
        }
      } catch {
        // ignore body capture errors
      }
    }
  });

  page.on('requestfailed', (req) => {
    const entry = store.networkMap.get(req);
    if (!entry) return;
    entry.failed = true;
    entry.status = 0;
    entry.statusText = 'Failed';
    entry.durationMs = Date.now() - entry.startTime;
    entry.failureText = req.failure()?.errorText || 'Aborted';
  });

  store.context = context;
  store.page = page;
  store.cdp = await context.newCDPSession(page).catch(() => null);
  store.proxyKey = JSON.stringify({
    d: store.deviceId,
    o: store.orientation,
    p: store.proxyConfig,
  });

  return page;
}

async function applyThrottling(store, mode) {
  store.throttling = mode;
  if (!store.cdp) return;
  try {
    await store.cdp.send('Network.enable');
    if (mode === 'none') {
      await store.cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
    } else if (mode === 'fast3g') {
      await store.cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: (1.5 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
      });
    } else if (mode === 'slow3g') {
      await store.cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 400,
        downloadThroughput: (400 * 1024) / 8,
        uploadThroughput: (400 * 1024) / 8,
      });
    } else if (mode === 'offline') {
      await store.cdp.send('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });
    }
  } catch {
    // ignore
  }
}

async function captureFrame(page) {
  if (!page || page.isClosed()) return null;
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 78 });
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function verifyIdentityViaProxy(store) {
  try {
    let ip = '';
    const ipRes = await proxyFetch('https://ipv4.webshare.io/', store.proxyConfig, {
      timeoutMs: 7000,
    });
    if (ipRes.status >= 200 && ipRes.status < 300) {
      ip = ipRes.body.toString('utf8').trim();
    }
    let geo = {};
    if (ip) {
      const geoRes = await proxyFetch(
        `https://ipwho.is/${encodeURIComponent(ip)}`,
        store.proxyConfig,
        { timeoutMs: 7000 },
      );
      if (geoRes.status >= 200 && geoRes.status < 300) {
        geo = JSON.parse(geoRes.body.toString('utf8'));
      }
    }
    const conn = geo.connection && typeof geo.connection === 'object' ? geo.connection : undefined;
    const tz = geo.timezone && typeof geo.timezone === 'object' ? geo.timezone : undefined;
    store.identity = {
      ip: ip || geo.ip || 'Unavailable',
      city: typeof geo.city === 'string' ? geo.city : undefined,
      region: typeof geo.region === 'string' ? geo.region : undefined,
      country: typeof geo.country === 'string' ? geo.country : undefined,
      countryCode: typeof geo.country_code === 'string' ? geo.country_code : undefined,
      latitude: typeof geo.latitude === 'number' ? geo.latitude : undefined,
      longitude: typeof geo.longitude === 'number' ? geo.longitude : undefined,
      timezone: typeof tz?.id === 'string' ? tz.id : undefined,
      isp: typeof conn?.isp === 'string' ? conn.isp : undefined,
      checkedAt: Date.now(),
      viaProxy: Boolean(store.proxyConfig.enabled),
    };
    if (typeof geo.latitude === 'number' && typeof geo.longitude === 'number') {
      store.geolocation = { latitude: geo.latitude, longitude: geo.longitude };
    }
    if (typeof tz?.id === 'string') {
      store.timezone = tz.id;
    }
  } catch {
    // ignore transient verification failure
  }
}

async function safeGoto(page, store, url) {
  store.lastError = null;
  const target = normalizeUrl(url);
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
    await page.waitForTimeout(450);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const landed = page.url();
    if (!landed || landed === 'about:blank') {
      store.lastError = msg;
    }
  }
}

async function getDomTreeFromPage(page) {
  return page
    .evaluate(() => {
      function uniqueSelector(el) {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
          const tag = cur.tagName.toLowerCase();
          if (cur.id) {
            parts.unshift(`#${CSS.escape(cur.id)}`);
            break;
          }
          const parent = cur.parentElement;
          if (!parent) {
            parts.unshift(tag);
            break;
          }
          const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
          const idx = sibs.indexOf(cur) + 1;
          parts.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
          cur = parent;
        }
        return parts.join(' > ') || 'body';
      }

      function walk(el, depth = 0) {
        if (!el || depth > 6) return null;
        const tag = el.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style') return null;
        const children = [];
        for (let i = 0; i < Math.min(el.children.length, 25); i++) {
          const child = walk(el.children[i], depth + 1);
          if (child) children.push(child);
        }
        let text = '';
        for (const n of el.childNodes) {
          if (n.nodeType === 3) text += n.textContent || '';
        }
        return {
          selector: uniqueSelector(el),
          tag,
          id: el.id || undefined,
          classes: Array.from(el.classList),
          textPreview: text.replace(/\s+/g, ' ').trim().slice(0, 70) || undefined,
          attributes: Array.from(el.attributes)
            .slice(0, 10)
            .map((a) => ({ name: a.name, value: a.value.slice(0, 120) })),
          children,
          childCount: el.children.length,
        };
      }
      return walk(document.body || document.documentElement);
    })
    .catch(() => null);
}

async function inspectElementOnPage(page, x, y, selector) {
  return page
    .evaluate(
      ({ px, py, sel }) => {
        const el = sel ? document.querySelector(sel) : document.elementFromPoint(px, py);
        if (!el) return null;

        function uniqueSelector(node) {
          if (node.id) return `#${CSS.escape(node.id)}`;
          const parts = [];
          let cur = node;
          while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
            const tag = cur.tagName.toLowerCase();
            if (cur.id) {
              parts.unshift(`#${CSS.escape(cur.id)}`);
              break;
            }
            const parent = cur.parentElement;
            if (!parent) {
              parts.unshift(tag);
              break;
            }
            const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
            const idx = sibs.indexOf(cur) + 1;
            parts.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
            cur = parent;
          }
          return parts.join(' > ') || 'body';
        }

        const r = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        const props = [
          'display',
          'position',
          'width',
          'height',
          'margin',
          'padding',
          'font-family',
          'font-size',
          'font-weight',
          'color',
          'background-color',
          'border',
          'border-radius',
        ];
        const computedStyles = {};
        for (const p of props) computedStyles[p] = cs.getPropertyValue(p);
        const num = (p) => Math.round(parseFloat(cs.getPropertyValue(p)) || 0);
        const tag = el.tagName.toLowerCase();
        const resolvedSel = uniqueSelector(el);

        return {
          highlight: {
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
            label: `${tag}${el.id ? `#${el.id}` : ''} · ${Math.round(r.width)}×${Math.round(r.height)}`,
          },
          element: {
            selector: resolvedSel,
            tag,
            id: el.id || undefined,
            classes: Array.from(el.classList),
            attributes: Array.from(el.attributes).map((a) => ({
              name: a.name,
              value: a.value,
            })),
            innerText: (el.innerText || el.textContent || '').trim().slice(0, 400),
            outerHTML: el.outerHTML.slice(0, 1000),
            rect: {
              x: Math.round(r.left),
              y: Math.round(r.top),
              width: Math.round(r.width),
              height: Math.round(r.height),
            },
            computedStyles,
            inlineStyle: el.getAttribute('style') || '',
            boxModel: {
              margin: [num('margin-top'), num('margin-right'), num('margin-bottom'), num('margin-left')],
              border: [num('border-top-width'), num('border-right-width'), num('border-bottom-width'), num('border-left-width')],
              padding: [num('padding-top'), num('padding-right'), num('padding-bottom'), num('padding-left')],
              width: Math.round(r.width),
              height: Math.round(r.height),
            },
          },
        };
      },
      { px: x, py: y, sel: selector || null },
    )
    .catch(() => null);
}

async function getStorageFromPage(store, page) {
  const cookies = store.context ? await store.context.cookies().catch(() => []) : [];
  const webStorage = await page
    .evaluate(() => {
      const readStore = (s) => {
        const list = [];
        try {
          for (let i = 0; i < Math.min(s.length, 40); i++) {
            const k = s.key(i);
            if (k !== null) list.push({ key: k, value: (s.getItem(k) || '').slice(0, 300) });
          }
        } catch {
          // ignore
        }
        return list;
      };
      return {
        origin: window.location.origin,
        localStorage: readStore(window.localStorage),
        sessionStorage: readStore(window.sessionStorage),
      };
    })
    .catch(() => ({ origin: page.url(), localStorage: [], sessionStorage: [] }));
  return {
    origin: webStorage.origin,
    cookies,
    localStorage: webStorage.localStorage,
    sessionStorage: webStorage.sessionStorage,
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    applyCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  const store = getGlobalStore();

  try {
    const body = await readJsonBody(req);
    const cmd = String(body.type || 'init');
    const restore = body.restore && typeof body.restore === 'object' ? body.restore : null;

    // Sync configuration if provided via restore or direct command
    if (restore) {
      if (typeof restore.deviceId === 'string') store.deviceId = restore.deviceId;
      if (restore.orientation === 'portrait' || restore.orientation === 'landscape') {
        store.orientation = restore.orientation;
      }
      if (typeof restore.blockTrackers === 'boolean') store.blockTrackers = restore.blockTrackers;
      if (typeof restore.inspectMode === 'boolean') store.inspectMode = restore.inspectMode;
      if (Array.isArray(restore.customProfiles)) {
        store.customProfiles = restore.customProfiles.filter(
          (p) => p && typeof p.id === 'string' && typeof p.server === 'string',
        );
      }
      if (typeof restore.activeProxyId === 'string' || restore.activeProxyId === null) {
        store.activeProxyId = restore.activeProxyId;
      }
      if (restore.proxy && typeof restore.proxy === 'object') {
        const matchedCustom = store.customProfiles.find((p) => p.id === store.activeProxyId);
        const proxyWithPass = matchedCustom
          ? { ...restore.proxy, password: matchedCustom.password }
          : restore.proxy;
        store.proxyConfig = resolveProxyConfig(store.activeProxyId || undefined, proxyWithPass);
      }
    }

    if (cmd === 'getNetworkDetail') {
      const targetId = String(body.id || '');
      const entry = store.networkEntries.find((e) => e.id === targetId) || null;
      sendJson(res, 200, { ok: true, entry });
      return;
    }

    const desiredKey = JSON.stringify({
      d: store.deviceId,
      o: store.orientation,
      p: store.proxyConfig,
    });

    let page = store.page;
    const isCold = !page || page.isClosed() || store.proxyKey !== desiredKey;
    if (isCold) {
      const cookies = Array.isArray(restore?.cookies) ? restore.cookies : [];
      page = await createContextAndPage(store, cookies);
      if (cmd !== 'navigate' && restore?.url && restore.url !== 'about:blank') {
        await safeGoto(page, store, restore.url);
      }
      if (!store.identity) {
        await verifyIdentityViaProxy(store);
      }
    }

    let domTree;
    let inspectedElement;
    let highlightRect;
    let storage;
    let screenshotData;

    switch (cmd) {
      case 'init': {
        const target = String(body.url || restore?.url || 'https://ipv4.webshare.io/');
        if (page.url() === 'about:blank' || target !== page.url()) {
          await safeGoto(page, store, target);
        }
        break;
      }
      case 'navigate':
        await safeGoto(page, store, String(body.url || 'https://ipv4.webshare.io/'));
        break;
      case 'back':
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(300);
        break;
      case 'forward':
        await page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(300);
        break;
      case 'reload':
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(350);
        break;
      case 'pointer': {
        const x = Number(body.x) || 0;
        const y = Number(body.y) || 0;
        if (body.action === 'tap' || body.action === 'up') {
          const prevCount = store.networkEntries.length;
          await page.mouse.click(x, y).catch(() => {});
          await page.waitForTimeout(280);
          // If clicking triggered a new XHR/fetch/navigation, allow up to ~1s for it to finish rendering
          if (store.networkEntries.length > prevCount) {
            const deadline = Date.now() + 2000;
            while (
              Date.now() < deadline &&
              store.networkEntries
                .slice(prevCount)
                .some(
                  (e) =>
                    e.status === null &&
                    ['document', 'xhr', 'fetch'].includes(e.resourceType),
                )
            ) {
              await page.waitForTimeout(90);
            }
            await page.waitForTimeout(220);
          }
        }
        break;
      }
      case 'wheel': {
        const x = Number(body.x) || 0;
        const y = Number(body.y) || 0;
        const dx = Number(body.deltaX) || 0;
        const dy = Number(body.deltaY) || 0;
        await page.mouse.move(x, y).catch(() => {});
        await page.mouse.wheel(dx, dy).catch(() => {});
        await page.waitForTimeout(90);
        break;
      }
      case 'keyboard': {
        if (body.action === 'type' && typeof body.text === 'string') {
          await page.keyboard.type(body.text, { delay: 10 }).catch(() => {});
          await page.waitForTimeout(150);
        } else if (body.action === 'key' && typeof body.key === 'string') {
          const prevCount = store.networkEntries.length;
          await page.keyboard.press(body.key).catch(() => {});
          await page.waitForTimeout(280);
          if (store.networkEntries.length > prevCount) {
            const deadline = Date.now() + 900;
            while (
              Date.now() < deadline &&
              store.networkEntries
                .slice(prevCount)
                .some(
                  (e) =>
                    e.status === null &&
                    ['document', 'xhr', 'fetch'].includes(e.resourceType),
                )
            ) {
              await page.waitForTimeout(90);
            }
            await page.waitForTimeout(150);
          }
        }
        break;
      }
      case 'setDevice': {
        const currentUrl = page.url();
        const cookies = store.context ? await store.context.cookies().catch(() => []) : [];
        store.deviceId = String(body.deviceId || store.deviceId);
        if (body.orientation === 'portrait' || body.orientation === 'landscape') {
          store.orientation = body.orientation;
        }
        page = await createContextAndPage(store, cookies);
        if (currentUrl && currentUrl !== 'about:blank') {
          await safeGoto(page, store, currentUrl);
        }
        break;
      }
      case 'setThrottling':
        await applyThrottling(store, String(body.mode || 'none'));
        break;
      case 'setBlockTrackers':
        store.blockTrackers = Boolean(body.enabled);
        break;
      case 'setInspectMode':
        store.inspectMode = Boolean(body.enabled);
        break;
      case 'getDomTree':
        domTree = await getDomTreeFromPage(page);
        break;
      case 'inspectAt': {
        const resInspect = await inspectElementOnPage(
          page,
          Number(body.x) || 0,
          Number(body.y) || 0,
          null,
        );
        if (resInspect) {
          highlightRect = resInspect.highlight;
          if (body.selectElement) inspectedElement = resInspect.element;
        }
        break;
      }
      case 'inspectSelector': {
        const resInspect = await inspectElementOnPage(page, 0, 0, String(body.selector || ''));
        if (resInspect) {
          highlightRect = resInspect.highlight;
          if (body.selectElement) inspectedElement = resInspect.element;
        }
        break;
      }
      case 'updateElementStyle': {
        const sel = String(body.selector || '');
        const prop = String(body.property || '');
        const val = String(body.value || '');
        if (sel && prop) {
          await page
            .evaluate(
              ({ s, p, v }) => {
                const el = document.querySelector(s);
                if (el) el.style.setProperty(p, v);
              },
              { s: sel, p: prop, v: val },
            )
            .catch(() => {});
          const resInspect = await inspectElementOnPage(page, 0, 0, sel);
          if (resInspect) inspectedElement = resInspect.element;
        }
        break;
      }
      case 'evalConsole': {
        const expr = String(body.expression || '').trim();
        if (expr) {
          pushConsole(store, 'eval-input', expr);
          try {
            const evalOut = await page.evaluate((code) => {
              const r = (0, eval)(code);
              if (typeof r === 'string') return r;
              if (r === undefined) return 'undefined';
              try {
                return JSON.stringify(r, null, 2) ?? String(r);
              } catch {
                return String(r);
              }
            }, expr);
            pushConsole(store, 'eval-result', evalOut);
          } catch (err) {
            pushConsole(store, 'eval-error', err instanceof Error ? err.message : String(err));
          }
        }
        break;
      }
      case 'clearConsole':
        store.consoleEntries = [];
        break;
      case 'clearNetwork':
        store.networkEntries = [];
        store.networkMap.clear();
        break;
      case 'getStorage':
        storage = await getStorageFromPage(store, page);
        break;
      case 'deleteCookie':
        if (store.context) {
          const all = await store.context.cookies().catch(() => []);
          const filtered = all.filter(
            (c) => !(c.name === body.name && (!body.domain || c.domain === body.domain)),
          );
          await store.context.clearCookies().catch(() => {});
          if (filtered.length > 0) await store.context.addCookies(filtered).catch(() => {});
        }
        storage = await getStorageFromPage(store, page);
        break;
      case 'clearStorage':
        await store.context?.clearCookies().catch(() => {});
        await page
          .evaluate(() => {
            try {
              localStorage.clear();
              sessionStorage.clear();
            } catch {
              // ignore
            }
          })
          .catch(() => {});
        storage = await getStorageFromPage(store, page);
        break;
      case 'clearBrowsingData':
        if (body.cookies !== false) await store.context?.clearCookies().catch(() => {});
        if (body.cache !== false && store.cdp) {
          await store.cdp.send('Network.clearBrowserCache').catch(() => {});
        }
        if (body.storage !== false) {
          await page
            .evaluate(() => {
              try {
                localStorage.clear();
                sessionStorage.clear();
              } catch {
                // ignore
              }
            })
            .catch(() => {});
        }
        if (body.history !== false) {
          store.networkEntries = [];
          store.networkMap.clear();
          store.consoleEntries = [];
          store.blockedCount = 0;
        }
        if (body.reloadPage) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        }
        storage = await getStorageFromPage(store, page);
        break;
      case 'verifyProxy':
        await verifyIdentityViaProxy(store);
        break;
      case 'selectProxyProfile': {
        const currentUrl = page.url();
        const cookies = store.context ? await store.context.cookies().catch(() => []) : [];
        store.activeProxyId = String(body.profileId || 'us-east-nj');
        const customProf = store.customProfiles.find((p) => p.id === store.activeProxyId);
        store.proxyConfig = customProf
          ? {
              enabled: true,
              server: customProf.server,
              username: customProf.username,
              password: customProf.password,
            }
          : resolveProxyConfig(store.activeProxyId, body.proxy);
        await verifyIdentityViaProxy(store);
        page = await createContextAndPage(store, cookies);
        if (currentUrl && currentUrl !== 'about:blank') {
          await safeGoto(page, store, currentUrl);
        }
        break;
      }
      case 'addProxyProfile': {
        const server = String(body.server || '').trim();
        if (!server) break;
        const currentUrl = page.url();
        const cookies = store.context ? await store.context.cookies().catch(() => []) : [];
        const id = `custom-${Date.now()}`;
        const label = String(body.label || '').trim() || server.replace(/^https?:\/\//, '');
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const profile = {
          id,
          label,
          locationHint: server.replace(/^https?:\/\//, ''),
          server,
          username,
          password,
        };
        store.customProfiles.push(profile);
        store.activeProxyId = id;
        store.proxyConfig = { enabled: true, server, username, password };
        await verifyIdentityViaProxy(store);
        page = await createContextAndPage(store, cookies);
        if (currentUrl && currentUrl !== 'about:blank') {
          await safeGoto(page, store, currentUrl);
        }
        break;
      }
      case 'updateProxy': {
        const currentUrl = page.url();
        const cookies = store.context ? await store.context.cookies().catch(() => []) : [];
        store.activeProxyId = null;
        const incoming = body.proxy || body;
        const normalizedIncoming =
          incoming.password === '••••••••'
            ? { ...incoming, password: store.proxyConfig.password }
            : incoming;
        store.proxyConfig = resolveProxyConfig(undefined, normalizedIncoming);
        await verifyIdentityViaProxy(store);
        page = await createContextAndPage(store, cookies);
        if (currentUrl && currentUrl !== 'about:blank') {
          await safeGoto(page, store, currentUrl);
        }
        break;
      }
      case 'setGeolocation':
        store.geolocation = {
          latitude: Number(body.latitude) || 0,
          longitude: Number(body.longitude) || 0,
        };
        await store.context?.setGeolocation(store.geolocation).catch(() => {});
        break;
      case 'newIdentity':
        store.networkEntries = [];
        store.networkMap.clear();
        store.consoleEntries = [];
        store.blockedCount = 0;
        await verifyIdentityViaProxy(store);
        page = await createContextAndPage(store, []);
        await safeGoto(page, store, 'https://ipv4.webshare.io/');
        break;
      case 'takeScreenshot': {
        const png = await page.screenshot({ type: 'png' }).catch(() => null);
        if (png) screenshotData = png.toString('base64');
        break;
      }
      default:
        break;
    }

    const frameDataUrl = await captureFrame(page);
    const vp = getViewport(store.deviceId, store.orientation);
    const title = await page.title().catch(() => page.url());
    const cookies = store.context ? await store.context.cookies().catch(() => []) : [];
    const navFlags = await getNavHistoryFlags(store);
    const allProfiles = [
      ...VERCEL_PROXY_PRESETS,
      ...store.customProfiles,
    ].map(({ id, label, locationHint, server, username }) => ({
      id,
      label,
      locationHint,
      server,
      username,
    }));

    sendJson(res, 200, {
      ok: true,
      frameDataUrl,
      cookies,
      domTree,
      inspectedElement,
      highlightRect,
      storage,
      screenshotData,
      network: store.networkEntries.slice(-120).map(({ responseBodyPreview: _p, ...rest }) => rest),
      console: store.consoleEntries.slice(-120),
      state: {
        connected: true,
        url: page.url() || 'https://ipv4.webshare.io/',
        title: title || page.url(),
        loading: false,
        canGoBack: navFlags.canGoBack,
        canGoForward: navFlags.canGoForward,
        deviceId: store.deviceId,
        orientation: store.orientation,
        viewportWidth: vp.width,
        viewportHeight: vp.height,
        throttling: store.throttling,
        blockTrackers: store.blockTrackers,
        blockedCount: store.blockedCount,
        inspectMode: store.inspectMode,
        proxy: {
          enabled: store.proxyConfig.enabled,
          server: store.proxyConfig.server || '',
          username: store.proxyConfig.username || '',
          password: store.proxyConfig.password ? '••••••••' : '',
        },
        activeProxyId: store.activeProxyId,
        proxyProfiles: allProfiles,
        identity: store.identity,
        geolocation: store.geolocation,
        lastError: store.lastError,
      },
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Vercel Chromium session error',
    });
  }
}
