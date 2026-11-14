import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, CDPSession, Page, Request, Response } from 'playwright-core';
import { DEFAULT_PROXY_PROFILES, DEVICE_PRESETS } from '../src/data/devices.ts';
import type {
  BrowserState,
  ConsoleEntry,
  DevicePreset,
  DomNodeSummary,
  HighlightRect,
  InspectedElement,
  NetworkEntry,
  ProxyConfig,
  ProxyIdentityInfo,
  ProxyProfile,
  StorageSnapshot,
  ThrottlingMode,
} from '../src/types/browser.ts';

const execFileAsync = promisify(execFile);

const TRACKER_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googleadservices.com',
  'connect.facebook.net',
  'facebook.com/tr',
  'analytics.tiktok.com',
  'ads-twitter.com',
  'scorecardresearch.com',
  'hotjar.com',
  'segment.io',
  'mixpanel.com',
  'criteo.com',
  'taboola.com',
  'outbrain.com',
];

const DEFAULT_PROXY: ProxyConfig = {
  enabled: true,
  server: process.env.DEFAULT_PROXY_SERVER || 'http://38.154.185.97:6370',
  username: process.env.DEFAULT_PROXY_USERNAME || 'knhvpaql',
  password: process.env.DEFAULT_PROXY_PASSWORD || 'kg3ak1ut8a8e',
};

const START_URL = 'https://ipv4.webshare.io/';

function findChromiumExecutable(): string | undefined {
  const candidates: string[] = [];
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    candidates.push(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);
  }
  try {
    const pwDefault = chromium.executablePath();
    if (pwDefault) candidates.push(pwDefault);
  } catch {
    // ignore
  }
  candidates.push(
    '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  );

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const scanBases = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/ms-playwright',
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    '/root/.cache/ms-playwright',
  ].filter((d): d is string => Boolean(d));

  for (const baseDir of scanBases) {
    try {
      if (!fs.existsSync(baseDir)) continue;
      const entries = fs.readdirSync(baseDir);
      for (const entry of entries) {
        const subPaths = [
          path.join(baseDir, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
          path.join(baseDir, entry, 'chrome-linux64', 'chrome'),
          path.join(baseDir, entry, 'chrome-linux', 'chrome'),
        ];
        for (const p of subPaths) {
          if (fs.existsSync(p)) return p;
        }
      }
    } catch {
      // ignore scan errors
    }
  }

  return undefined;
}

async function ensureChromiumExecutable(): Promise<string | undefined> {
  const existing = findChromiumExecutable();
  if (existing) return existing;

  const cliPath = path.join(process.cwd(), 'node_modules', 'playwright-core', 'cli.js');
  if (fs.existsSync(cliPath)) {
    try {
      console.log('No cached Chromium found in container; installing chromium-headless-shell...');
      await execFileAsync(process.execPath, [cliPath, 'install', 'chromium-headless-shell'], {
        timeout: 120000,
      });
    } catch (err) {
      console.warn('Auto-install of chromium-headless-shell failed:', err instanceof Error ? err.message : err);
    }
  }
  return findChromiumExecutable();
}

function buildCurlProxyUrl(proxy: ProxyConfig): string | null {
  if (!proxy.enabled || !proxy.server) return null;
  try {
    const parsed = new URL(proxy.server.includes('://') ? proxy.server : `http://${proxy.server}`);
    if (proxy.username) {
      parsed.username = encodeURIComponent(proxy.username);
    }
    if (proxy.password) {
      parsed.password = encodeURIComponent(proxy.password);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export type ServerBroadcastFn = (event: Record<string, unknown>) => void;

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private broadcast: ServerBroadcastFn;

  private proxyProfiles: ProxyProfile[] = DEFAULT_PROXY_PROFILES.map((p) => ({ ...p }));
  private activeProxyId: string | null = DEFAULT_PROXY_PROFILES[0]?.id ?? null;
  private proxy: ProxyConfig = {
    enabled: true,
    server: DEFAULT_PROXY_PROFILES[0]?.server || DEFAULT_PROXY.server,
    username: DEFAULT_PROXY_PROFILES[0]?.username || DEFAULT_PROXY.username,
    password: DEFAULT_PROXY_PROFILES[0]?.password || DEFAULT_PROXY.password,
  };
  private identity: ProxyIdentityInfo | null = null;
  private device: DevicePreset = DEVICE_PRESETS[0];
  private orientation: 'portrait' | 'landscape' = 'portrait';
  private throttling: ThrottlingMode = 'none';
  private blockTrackers = true;
  private blockedCount = 0;
  private inspectMode = false;
  private geolocation = { latitude: 40.4992716, longitude: -74.3990433 };
  private timezoneId = 'America/New_York';

  private currentUrl = START_URL;
  private currentTitle = 'New Tab';
  private isLoading = false;
  private lastError: string | null = null;

  private networkEntries: NetworkEntry[] = [];
  private networkBodyCache = new Map<string, string>();
  private requestMap = new WeakMap<Request, { id: string; startTime: number }>();
  private consoleEntries: ConsoleEntry[] = [];
  private reqCounter = 0;
  private consoleCounter = 0;
  private lastFrameBase64: string | null = null;
  private initPromise: Promise<void> | null = null;
  private screencastActive = false;
  private screencastHandler: ((payload: { data: string; sessionId: number; metadata?: unknown }) => void) | null = null;
  private navToken = 0;

  constructor(broadcast: ServerBroadcastFn) {
    this.broadcast = broadcast;
  }

  public async ensureReady(): Promise<void> {
    if (this.page && !this.page.isClosed()) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initialize().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private getEffectiveViewport(): { width: number; height: number } {
    if (this.orientation === 'landscape') {
      return { width: this.device.height, height: this.device.width };
    }
    return { width: this.device.width, height: this.device.height };
  }

  private async initialize(): Promise<void> {
    // Verify proxy IP & geo first so browser context matches proxy timezone & GPS
    await this.verifyProxyIdentity(false);
    await this.launchBrowserAndContext();
    await this.navigate(this.currentUrl || START_URL, true);
  }

  private async launchBrowserAndContext(): Promise<void> {
    await this.teardown();

    const executablePath = await ensureChromiumExecutable();
    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    };
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }
    if (this.proxy.enabled && this.proxy.server.trim()) {
      launchOptions.proxy = {
        server: this.proxy.server.trim(),
        username: this.proxy.username || undefined,
        password: this.proxy.password || undefined,
      };
    }

    this.browser = await chromium.launch(launchOptions);
    const viewport = this.getEffectiveViewport();

    this.context = await this.browser.newContext({
      viewport,
      deviceScaleFactor: this.device.deviceScaleFactor,
      isMobile: this.device.isMobile,
      hasTouch: this.device.hasTouch,
      userAgent: this.device.userAgent,
      ignoreHTTPSErrors: true,
      locale: 'en-US',
      timezoneId: this.timezoneId,
      geolocation: this.geolocation,
      permissions: ['geolocation'],
    });

    // Reduce obvious headless automation markers
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Ad / Tracker blocking via Playwright route interception (never block main/subframe navigations)
    await this.context.route('**/*', async (route) => {
      try {
        const req = route.request();
        if (this.blockTrackers && !req.isNavigationRequest()) {
          let host = '';
          try {
            host = new URL(req.url()).hostname.toLowerCase();
          } catch {
            host = '';
          }
          const lowerUrl = req.url().toLowerCase();
          const isTracker = TRACKER_DOMAINS.some(
            (domain) => host === domain || host.endsWith(`.${domain}`) || (domain.includes('/') && lowerUrl.includes(domain)),
          );
          if (isTracker) {
            this.blockedCount += 1;
            const id = `blk-${++this.reqCounter}`;
            const entry: NetworkEntry = {
              id,
              url: req.url(),
              method: req.method(),
              resourceType: req.resourceType(),
              status: 0,
              statusText: 'Blocked (Tracker)',
              startTime: Date.now(),
              durationMs: 0,
              sizeBytes: 0,
              blocked: true,
              failed: true,
              failureText: 'Blocked by StealthView tracker shield',
            };
            this.pushNetworkEntry(entry);
            this.emitState();
            await route.abort('blockedbyclient').catch(() => {});
            return;
          }
        }
        await route.continue().catch(() => {});
      } catch {
        await route.continue().catch(() => {});
      }
    });

    this.page = await this.context.newPage();
    await this.page.goto('about:blank').catch(() => {});
    this.attachPageListeners(this.page);

    // Redirect popup/new-tab links into the single virtual mobile viewport
    this.context.on('page', async (newPage) => {
      if (newPage === this.page) return;
      try {
        await newPage.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        const targetUrl = newPage.url();
        await newPage.close().catch(() => {});
        if (targetUrl && targetUrl !== 'about:blank' && this.page && !this.page.isClosed()) {
          await this.navigate(targetUrl);
        }
      } catch {
        // ignore popup cleanup errors
      }
    });

    try {
      this.cdp = await this.context.newCDPSession(this.page);
      await this.applyThrottling();
      await this.startScreencast();
    } catch (err) {
      this.cdp = null;
      console.warn('CDP session unavailable, using screenshot fallback:', err instanceof Error ? err.message : err);
    }
  }

  private attachPageListeners(page: Page): void {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        this.currentUrl = frame.url();
        this.emitState();
      }
    });

    page.on('load', async () => {
      this.isLoading = false;
      this.currentUrl = page.url();
      try {
        this.currentTitle = (await page.title()) || this.currentUrl;
      } catch {
        this.currentTitle = this.currentUrl;
      }
      this.emitState();
      await this.captureFallbackFrame();
    });

    page.on('domcontentloaded', async () => {
      try {
        this.currentTitle = (await page.title()) || page.url();
      } catch {
        // ignore
      }
      this.emitState();
      await this.captureFallbackFrame();
    });

    page.on('console', (msg) => {
      const loc = msg.location();
      const locText = loc?.url ? `${loc.url.split('/').pop() || loc.url}:${loc.lineNumber}` : undefined;
      const typeMap: Record<string, ConsoleEntry['type']> = {
        log: 'log',
        info: 'info',
        warning: 'warn',
        error: 'error',
        debug: 'debug',
      };
      const entry: ConsoleEntry = {
        id: `con-${++this.consoleCounter}`,
        type: typeMap[msg.type()] || 'log',
        text: msg.text(),
        timestamp: Date.now(),
        location: locText,
      };
      this.pushConsoleEntry(entry);
    });

    page.on('pageerror', (err) => {
      this.pushConsoleEntry({
        id: `con-${++this.consoleCounter}`,
        type: 'pageerror',
        text: err.stack || err.message || String(err),
        timestamp: Date.now(),
      });
    });

    page.on('request', (req) => {
      const id = `req-${++this.reqCounter}`;
      const startTime = Date.now();
      this.requestMap.set(req, { id, startTime });

      const entry: NetworkEntry = {
        id,
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
        status: null,
        statusText: 'Pending',
        startTime,
        durationMs: null,
        sizeBytes: null,
        requestHeaders: req.headers(),
        postData: req.postData() || null,
      };
      this.pushNetworkEntry(entry);
    });

    page.on('response', async (res: Response) => {
      const req = res.request();
      const meta = this.requestMap.get(req);
      if (!meta) return;

      const durationMs = Date.now() - meta.startTime;
      const headers = res.headers();
      let sizeBytes: number | null = headers['content-length']
        ? parseInt(headers['content-length'], 10)
        : null;

      let preview: string | null = null;
      const mimeType = headers['content-type'] || '';
      const rType = req.resourceType();
      const shouldCaptureBody =
        (rType === 'document' || rType === 'xhr' || rType === 'fetch') &&
        (sizeBytes === null || sizeBytes < 120000);

      if (shouldCaptureBody && res.status() < 400 && res.status() !== 204) {
        try {
          const buf = await res.body();
          if (sizeBytes === null || Number.isNaN(sizeBytes)) {
            sizeBytes = buf.byteLength;
          }
          if (buf.byteLength < 120000) {
            preview = buf.toString('utf8').slice(0, 16000);
            this.networkBodyCache.set(meta.id, preview);
          }
        } catch {
          // body might be unavailable on redirects/streams
        }
      }

      this.updateNetworkEntry(meta.id, {
        status: res.status(),
        statusText: res.statusText() || String(res.status()),
        durationMs,
        sizeBytes,
        mimeType,
        responseHeaders: headers,
      });
    });

    page.on('requestfailed', (req) => {
      const meta = this.requestMap.get(req);
      if (!meta) return;
      const failure = req.failure();
      // Ignore our own tracker aborts which were already logged
      if (failure?.errorText === 'net::ERR_BLOCKED_BY_CLIENT' && this.blockTrackers) return;
      this.updateNetworkEntry(meta.id, {
        status: 0,
        statusText: 'Failed',
        durationMs: Date.now() - meta.startTime,
        failed: true,
        failureText: failure?.errorText || 'Request failed',
      });
    });
  }

  private async startScreencast(): Promise<void> {
    if (!this.cdp) return;
    if (this.screencastActive) {
      await this.cdp.send('Page.stopScreencast').catch(() => {});
      this.screencastActive = false;
    }

    if (this.screencastHandler) {
      this.cdp.off('Page.screencastFrame', this.screencastHandler);
    }
    this.screencastHandler = (payload) => {
      // Ack immediately so Chromium keeps streaming without stalling
      this.cdp?.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch(() => {});
      this.lastFrameBase64 = payload.data;
      this.broadcast({
        type: 'frame',
        data: payload.data,
        metadata: payload.metadata,
      });
    };
    this.cdp.on('Page.screencastFrame', this.screencastHandler);

    const vp = this.getEffectiveViewport();
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 76,
      maxWidth: Math.min(Math.round(vp.width * 1.5), 1100),
      maxHeight: Math.min(Math.round(vp.height * 1.5), 1650),
      everyNthFrame: 1,
    });
    this.screencastActive = true;
  }

  private async captureFallbackFrame(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      const buf = await this.page.screenshot({ type: 'jpeg', quality: 84 });
      const base64 = buf.toString('base64');
      this.lastFrameBase64 = base64;
      this.broadcast({ type: 'frame', data: base64 });
    } catch {
      // ignore during rapid navigation
    }
  }

  public getLastFrame(): string | null {
    return this.lastFrameBase64;
  }

  public getState(): BrowserState {
    const vp = this.getEffectiveViewport();
    return {
      connected: Boolean(this.page && !this.page.isClosed()),
      url: this.currentUrl,
      title: this.currentTitle,
      loading: this.isLoading,
      canGoBack: true,
      canGoForward: true,
      deviceId: this.device.id,
      orientation: this.orientation,
      viewportWidth: vp.width,
      viewportHeight: vp.height,
      throttling: this.throttling,
      blockTrackers: this.blockTrackers,
      blockedCount: this.blockedCount,
      inspectMode: this.inspectMode,
      proxy: {
        enabled: this.proxy.enabled,
        server: this.proxy.server,
        username: this.proxy.username,
        password: this.proxy.password ? '••••••••' : '',
      },
      activeProxyId: this.activeProxyId,
      proxyProfiles: this.proxyProfiles.map(({ id, label, locationHint, server, username }) => ({
        id,
        label,
        locationHint,
        server,
        username,
      })),
      identity: this.identity,
      geolocation: this.geolocation,
      lastError: this.lastError,
    };
  }

  public getHistorySnapshots() {
    return {
      network: this.networkEntries.slice(-250),
      console: this.consoleEntries.slice(-250),
    };
  }

  private emitState(): void {
    this.broadcast({ type: 'state', state: this.getState() });
  }

  private pushNetworkEntry(entry: NetworkEntry): void {
    this.networkEntries.push(entry);
    if (this.networkEntries.length > 350) {
      const removed = this.networkEntries.shift();
      if (removed) this.networkBodyCache.delete(removed.id);
    }
    this.broadcast({ type: 'network:add', entry });
  }

  private updateNetworkEntry(id: string, patch: Partial<NetworkEntry>): void {
    const target = this.networkEntries.find((item) => item.id === id);
    if (target) {
      Object.assign(target, patch);
      this.broadcast({ type: 'network:update', id, patch });
    }
  }

  private pushConsoleEntry(entry: ConsoleEntry): void {
    this.consoleEntries.push(entry);
    if (this.consoleEntries.length > 350) {
      this.consoleEntries.shift();
    }
    this.broadcast({ type: 'console:add', entry });
  }

  public clearConsole(): void {
    this.consoleEntries = [];
    this.broadcast({ type: 'console:clear' });
  }

  public clearNetwork(): void {
    this.networkEntries = [];
    this.networkBodyCache.clear();
    this.broadcast({ type: 'network:clear' });
  }

  public getNetworkDetail(id: string): NetworkEntry | null {
    const entry = this.networkEntries.find((item) => item.id === id);
    if (!entry) return null;
    return {
      ...entry,
      responseBodyPreview: this.networkBodyCache.get(id) ?? null,
    };
  }

  private normalizeUrl(rawInput: string): string {
    const trimmed = rawInput.trim();
    if (!trimmed) return START_URL;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.includes(' ') || !trimmed.includes('.')) {
      return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
    }
    return `https://${trimmed}`;
  }

  public async navigate(rawUrl: string, skipEnsure = false): Promise<void> {
    if (!skipEnsure) {
      await this.ensureReady();
    }
    if (!this.page || this.page.isClosed()) return;
    const targetUrl = this.normalizeUrl(rawUrl);
    const previousUrl = this.page.url();
    const myToken = ++this.navToken;
    this.lastError = null;
    this.isLoading = true;
    this.currentUrl = targetUrl;
    this.emitState();

    try {
      await this.page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      if (myToken !== this.navToken) return;
      this.currentUrl = this.page.url();
      this.currentTitle = (await this.page.title().catch(() => '')) || this.currentUrl;
      await this.page.waitForTimeout(300);
    } catch (err) {
      if (myToken !== this.navToken) return;
      const msg = err instanceof Error ? err.message : String(err);

      // Recover cleanly when a JS redirect / Cloudflare challenge aborts initial goto
      if (msg.includes('ERR_ABORTED')) {
        await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        const landedUrl = this.page.url();
        if (landedUrl && landedUrl !== 'about:blank' && landedUrl !== previousUrl) {
          this.currentUrl = landedUrl;
          this.currentTitle = (await this.page.title().catch(() => '')) || landedUrl;
          this.lastError = null;
          return;
        }
        // Fallback retry with waitUntil: 'commit'
        try {
          await this.page.goto(targetUrl, { waitUntil: 'commit', timeout: 25000 });
          await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
          this.currentUrl = this.page.url();
          this.currentTitle = (await this.page.title().catch(() => '')) || this.currentUrl;
          this.lastError = null;
          return;
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          this.lastError = retryMsg;
          this.pushConsoleEntry({
            id: `con-${++this.consoleCounter}`,
            type: 'error',
            text: `Navigation error: ${retryMsg}`,
            timestamp: Date.now(),
          });
          return;
        }
      }

      this.lastError =
        this.throttling === 'offline'
          ? 'Network throttling is currently set to Offline.'
          : msg;
      this.pushConsoleEntry({
        id: `con-${++this.consoleCounter}`,
        type: 'error',
        text: `Navigation error: ${this.lastError}`,
        timestamp: Date.now(),
      });
    } finally {
      if (myToken === this.navToken) {
        this.isLoading = false;
        this.emitState();
        await this.captureFallbackFrame();
      }
    }
  }

  public async goBack(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    this.isLoading = true;
    this.emitState();
    try {
      await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
      this.currentUrl = this.page.url();
      this.currentTitle = (await this.page.title().catch(() => '')) || this.currentUrl;
    } finally {
      this.isLoading = false;
      this.emitState();
      await this.captureFallbackFrame();
    }
  }

  public async goForward(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    this.isLoading = true;
    this.emitState();
    try {
      await this.page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
      this.currentUrl = this.page.url();
      this.currentTitle = (await this.page.title().catch(() => '')) || this.currentUrl;
    } finally {
      this.isLoading = false;
      this.emitState();
      await this.captureFallbackFrame();
    }
  }

  public async reload(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    this.isLoading = true;
    this.lastError = null;
    this.emitState();
    try {
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 });
      this.currentUrl = this.page.url();
      this.currentTitle = (await this.page.title().catch(() => '')) || this.currentUrl;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.isLoading = false;
      this.emitState();
      await this.captureFallbackFrame();
    }
  }

  public async handlePointer(action: 'down' | 'move' | 'up' | 'tap', x: number, y: number): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      if (this.cdp) {
        if (action === 'down') {
          await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        } else if (action === 'move') {
          await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        } else if (action === 'up') {
          await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        } else if (action === 'tap') {
          await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
          await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        }
        return;
      }

      if (action === 'down') {
        await this.page.mouse.move(x, y);
        await this.page.mouse.down();
      } else if (action === 'move') {
        await this.page.mouse.move(x, y);
      } else if (action === 'up') {
        await this.page.mouse.up();
        if (!this.screencastActive) await this.captureFallbackFrame();
      } else if (action === 'tap') {
        await this.page.mouse.click(x, y);
        if (!this.screencastActive) await this.captureFallbackFrame();
      }
    } catch {
      // ignore transient input errors
    }
  }

  public async handleWheel(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      if (this.cdp) {
        await this.cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x,
          y,
          deltaX,
          deltaY,
        });
        return;
      }
      await this.page.mouse.move(x, y);
      await this.page.mouse.wheel(deltaX, deltaY);
      if (!this.screencastActive) await this.captureFallbackFrame();
    } catch {
      // ignore
    }
  }

  public async handleKeyboard(action: 'type' | 'key', text?: string, key?: string): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      if (action === 'type' && text) {
        await this.page.keyboard.insertText(text);
      } else if (action === 'key' && key) {
        await this.page.keyboard.press(key);
      }
      if (!this.screencastActive) await this.captureFallbackFrame();
    } catch {
      // ignore
    }
  }

  public async setDevice(deviceId: string, orientation?: 'portrait' | 'landscape'): Promise<void> {
    const found = DEVICE_PRESETS.find((d) => d.id === deviceId);
    if (found) this.device = found;
    if (orientation) this.orientation = orientation;

    const vp = this.getEffectiveViewport();
    if (this.page && !this.page.isClosed() && this.cdp) {
      await this.cdp.send('Emulation.setUserAgentOverride', {
        userAgent: this.device.userAgent,
        platform: this.device.brand === 'Apple' ? 'iPhone' : 'Linux armv8l',
      });
      await this.cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: this.device.deviceScaleFactor,
        mobile: this.device.isMobile,
      });
      await this.page.setViewportSize(vp);
      await this.startScreencast();
      await this.captureFallbackFrame();
    }
    this.emitState();
  }

  public async setThrottling(mode: ThrottlingMode): Promise<void> {
    this.throttling = mode;
    await this.applyThrottling();
    this.emitState();
  }

  private async applyThrottling(): Promise<void> {
    if (!this.cdp) return;
    const presets: Record<ThrottlingMode, { offline: boolean; latency: number; downloadThroughput: number; uploadThroughput: number }> = {
      none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
      fast3g: { offline: false, latency: 150, downloadThroughput: (1.5 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
      slow3g: { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
      offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
    };
    await this.cdp.send('Network.emulateNetworkConditions', presets[this.throttling]).catch(() => {});
  }

  public setBlockTrackers(enabled: boolean): void {
    this.blockTrackers = enabled;
    this.emitState();
  }

  public setInspectMode(enabled: boolean): void {
    this.inspectMode = enabled;
    if (!enabled) {
      this.broadcast({ type: 'highlight', rect: null });
    }
    this.emitState();
  }

  public async inspectAt(x: number, y: number, selectElement: boolean): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      const result = await this.page.evaluate(
        ({ px, py, full }) => {
          const el = document.elementFromPoint(px, py) as HTMLElement | null;
          if (!el) return null;

          const buildSelector = (node: Element): string => {
            if (node.id) return `#${CSS.escape(node.id)}`;
            const parts: string[] = [];
            let cur: Element | null = node;
            while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
              let seg = cur.tagName.toLowerCase();
              if (cur.id) {
                parts.unshift(`#${CSS.escape(cur.id)}`);
                break;
              }
              const parentEl: Element | null = cur.parentElement;
              if (parentEl) {
                const siblings = Array.from(parentEl.children).filter((c) => c.tagName === cur!.tagName);
                if (siblings.length > 1) {
                  const idx = siblings.indexOf(cur) + 1;
                  seg += `:nth-of-type(${idx})`;
                }
              }
              parts.unshift(seg);
              cur = parentEl;
            }
            return parts.join(' > ') || node.tagName.toLowerCase();
          };

          const rect = el.getBoundingClientRect();
          const selector = buildSelector(el);
          const tag = el.tagName.toLowerCase();
          const idPart = el.id ? `#${el.id}` : '';
          const classPart =
            typeof el.className === 'string' && el.className.trim()
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
              : '';

          const highlight: HighlightRect = {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            label: `${tag}${idPart}${classPart} (${Math.round(rect.width)}×${Math.round(rect.height)})`,
          };

          if (!full) {
            return { highlight, element: null };
          }

          const cs = window.getComputedStyle(el);
          const styleKeys = [
            'display',
            'position',
            'width',
            'height',
            'color',
            'backgroundColor',
            'fontFamily',
            'fontSize',
            'fontWeight',
            'lineHeight',
            'padding',
            'margin',
            'borderRadius',
            'zIndex',
            'opacity',
          ];
          const computedStyles: Record<string, string> = {};
          for (const k of styleKeys) {
            computedStyles[k] = cs.getPropertyValue(k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));
          }

          const num = (val: string) => parseFloat(val) || 0;
          const element: InspectedElement = {
            selector,
            tag,
            id: el.id || undefined,
            classes: typeof el.className === 'string' && el.className.trim() ? el.className.trim().split(/\s+/) : [],
            attributes: Array.from(el.attributes).map((a) => ({ name: a.name, value: a.value })),
            innerText: (el.innerText || '').slice(0, 800),
            outerHTML: el.outerHTML.slice(0, 2500),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            computedStyles,
            inlineStyle: el.getAttribute('style') || '',
            boxModel: {
              margin: [num(cs.marginTop), num(cs.marginRight), num(cs.marginBottom), num(cs.marginLeft)],
              border: [num(cs.borderTopWidth), num(cs.borderRightWidth), num(cs.borderBottomWidth), num(cs.borderLeftWidth)],
              padding: [num(cs.paddingTop), num(cs.paddingRight), num(cs.paddingBottom), num(cs.paddingLeft)],
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          };

          return { highlight, element };
        },
        { px: x, py: y, full: selectElement },
      );

      if (result) {
        this.broadcast({ type: 'highlight', rect: result.highlight });
        if (result.element) {
          this.broadcast({ type: 'inspected', element: result.element });
        }
      } else {
        this.broadcast({ type: 'highlight', rect: null });
      }
    } catch {
      // ignore
    }
  }

  public async inspectSelector(selector: string, selectElement: boolean): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      const result = await this.page.evaluate(
        ({ sel, full }) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          const tag = el.tagName.toLowerCase();
          const highlight: HighlightRect = {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            label: `${tag} (${Math.round(rect.width)}×${Math.round(rect.height)})`,
          };
          if (!full) return { highlight, element: null };

          const cs = window.getComputedStyle(el);
          const styleKeys = [
            'display',
            'position',
            'width',
            'height',
            'color',
            'backgroundColor',
            'fontFamily',
            'fontSize',
            'fontWeight',
            'lineHeight',
            'padding',
            'margin',
            'borderRadius',
            'zIndex',
            'opacity',
          ];
          const computedStyles: Record<string, string> = {};
          for (const k of styleKeys) {
            computedStyles[k] = cs.getPropertyValue(k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));
          }
          const num = (val: string) => parseFloat(val) || 0;
          const element: InspectedElement = {
            selector: sel,
            tag,
            id: el.id || undefined,
            classes: typeof el.className === 'string' && el.className.trim() ? el.className.trim().split(/\s+/) : [],
            attributes: Array.from(el.attributes).map((a) => ({ name: a.name, value: a.value })),
            innerText: (el.innerText || '').slice(0, 800),
            outerHTML: el.outerHTML.slice(0, 2500),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            computedStyles,
            inlineStyle: el.getAttribute('style') || '',
            boxModel: {
              margin: [num(cs.marginTop), num(cs.marginRight), num(cs.marginBottom), num(cs.marginLeft)],
              border: [num(cs.borderTopWidth), num(cs.borderRightWidth), num(cs.borderBottomWidth), num(cs.borderLeftWidth)],
              padding: [num(cs.paddingTop), num(cs.paddingRight), num(cs.paddingBottom), num(cs.paddingLeft)],
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          };
          return { highlight, element };
        },
        { sel: selector, full: selectElement },
      );

      if (result) {
        this.broadcast({ type: 'highlight', rect: result.highlight });
        if (result.element) {
          this.broadcast({ type: 'inspected', element: result.element });
        }
      }
    } catch {
      // ignore
    }
  }

  public async updateElementStyle(selector: string, property: string, value: string): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      await this.page.evaluate(
        ({ sel, prop, val }) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return;
          el.style.setProperty(prop, val);
        },
        { sel: selector, prop: property, val: value },
      );
      await this.captureFallbackFrame();
      await this.inspectSelector(selector, true);
    } catch {
      // ignore
    }
  }

  public async getDomTree(): Promise<DomNodeSummary | null> {
    if (!this.page || this.page.isClosed()) return null;
    try {
      return await this.page.evaluate(() => {
        const buildSelector = (node: Element): string => {
          if (node.id) return `#${CSS.escape(node.id)}`;
          const parts: string[] = [];
          let cur: Element | null = node;
          while (cur && cur.nodeType === 1) {
            let seg = cur.tagName.toLowerCase();
            if (cur.id) {
              parts.unshift(`#${CSS.escape(cur.id)}`);
              break;
            }
            const parentEl: Element | null = cur.parentElement;
            if (parentEl) {
              const siblings = Array.from(parentEl.children).filter((c) => c.tagName === cur!.tagName);
              if (siblings.length > 1) {
                seg += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
              }
            }
            parts.unshift(seg);
            cur = parentEl;
          }
          return parts.join(' > ');
        };

        const walk = (el: Element, depth: number): DomNodeSummary => {
          const children: DomNodeSummary[] = [];
          if (depth < 6) {
            const childEls = Array.from(el.children).slice(0, 40);
            for (const c of childEls) {
              children.push(walk(c, depth + 1));
            }
          }
          let directText = '';
          for (const node of Array.from(el.childNodes)) {
            if (node.nodeType === 3 && node.textContent?.trim()) {
              directText += node.textContent.trim() + ' ';
            }
          }
          return {
            selector: buildSelector(el),
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            classes: typeof el.className === 'string' && el.className.trim() ? el.className.trim().split(/\s+/).slice(0, 5) : [],
            textPreview: directText.trim().slice(0, 80) || undefined,
            attributes: Array.from(el.attributes)
              .slice(0, 8)
              .map((a) => ({ name: a.name, value: a.value.slice(0, 100) })),
            children,
            childCount: el.children.length,
          };
        };

        return walk(document.documentElement, 0);
      });
    } catch {
      return null;
    }
  }

  public async evalConsole(expression: string): Promise<void> {
    this.pushConsoleEntry({
      id: `con-${++this.consoleCounter}`,
      type: 'eval-input',
      text: expression,
      timestamp: Date.now(),
    });

    if (!this.page || this.page.isClosed()) return;

    try {
      const output = await this.page.evaluate((expr) => {
        // Indirect eval executes in page global scope
        const res = (0, eval)(expr);
        if (res === undefined) return 'undefined';
        if (res === null) return 'null';
        if (typeof res === 'string') return JSON.stringify(res);
        if (typeof res === 'number' || typeof res === 'boolean') return String(res);
        if (res instanceof Element) return `<${res.tagName.toLowerCase()} ... />`;
        try {
          return JSON.stringify(res, null, 2).slice(0, 6000);
        } catch {
          return String(res);
        }
      }, expression);

      this.pushConsoleEntry({
        id: `con-${++this.consoleCounter}`,
        type: 'eval-result',
        text: output,
        timestamp: Date.now(),
      });
      await this.captureFallbackFrame();
    } catch (err) {
      this.pushConsoleEntry({
        id: `con-${++this.consoleCounter}`,
        type: 'eval-error',
        text: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
    }
  }

  public async getStorageSnapshot(): Promise<StorageSnapshot> {
    if (!this.context || !this.page || this.page.isClosed()) {
      return { origin: '', cookies: [], localStorage: [], sessionStorage: [] };
    }
    try {
      const cookies = await this.context.cookies();
      const storage = await this.page.evaluate(() => {
        const readStore = (s: Storage) => {
          const out: Array<{ key: string; value: string }> = [];
          for (let i = 0; i < s.length; i++) {
            const key = s.key(i);
            if (key !== null) {
              out.push({ key, value: (s.getItem(key) || '').slice(0, 1000) });
            }
          }
          return out;
        };
        return {
          origin: window.location.origin,
          localStorage: readStore(window.localStorage),
          sessionStorage: readStore(window.sessionStorage),
        };
      });

      return {
        origin: storage.origin,
        cookies: cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expires,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        })),
        localStorage: storage.localStorage,
        sessionStorage: storage.sessionStorage,
      };
    } catch {
      return { origin: '', cookies: [], localStorage: [], sessionStorage: [] };
    }
  }

  public async deleteCookie(name: string, domain: string): Promise<void> {
    if (!this.context) return;
    const cookies = await this.context.cookies();
    const remaining = cookies.filter((c) => !(c.name === name && c.domain === domain));
    await this.context.clearCookies();
    if (remaining.length > 0) {
      await this.context.addCookies(remaining);
    }
  }

  public async clearAllStorage(): Promise<void> {
    if (!this.context || !this.page || this.page.isClosed()) return;
    await this.context.clearCookies();
    await this.page
      .evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      })
      .catch(() => {});
  }

  public async verifyProxyIdentity(emit = true): Promise<ProxyIdentityInfo> {
    const proxyUrl = buildCurlProxyUrl(this.proxy);
    const argsBase = ['-s', '-m', '5'];
    if (proxyUrl) {
      argsBase.push('--proxy', proxyUrl);
    }

    try {
      const [ipRes, geoRes] = await Promise.allSettled([
        execFileAsync('curl', [...argsBase, 'https://ipv4.webshare.io/']),
        execFileAsync('curl', [...argsBase, 'https://ipwho.is/']),
      ]);

      if (ipRes.status !== 'fulfilled') {
        throw ipRes.reason;
      }

      const ip = ipRes.value.stdout.trim();
      let geo: Partial<ProxyIdentityInfo> = {};

      if (geoRes.status === 'fulfilled') {
        try {
          const parsed = JSON.parse(geoRes.value.stdout) as Record<string, unknown>;
          if (parsed && parsed.success !== false) {
            const conn = (parsed.connection as Record<string, unknown>) || {};
            const tz = (parsed.timezone as Record<string, unknown>) || {};
            geo = {
              city: typeof parsed.city === 'string' ? parsed.city : undefined,
              region: typeof parsed.region === 'string' ? parsed.region : undefined,
              country: typeof parsed.country === 'string' ? parsed.country : undefined,
              countryCode: typeof parsed.country_code === 'string' ? parsed.country_code : undefined,
              latitude: typeof parsed.latitude === 'number' ? parsed.latitude : undefined,
              longitude: typeof parsed.longitude === 'number' ? parsed.longitude : undefined,
              timezone: typeof tz.id === 'string' ? tz.id : undefined,
              isp: typeof conn.isp === 'string' ? conn.isp : undefined,
            };
          }
        } catch {
          // geolocation lookup is best-effort
        }
      }

      if (geo.latitude !== undefined && geo.longitude !== undefined) {
        this.geolocation = { latitude: geo.latitude, longitude: geo.longitude };
      }
      if (geo.timezone) {
        this.timezoneId = geo.timezone;
      }

      this.identity = {
        ip: ip || 'Unknown',
        ...geo,
        checkedAt: Date.now(),
        viaProxy: Boolean(proxyUrl),
      };
    } catch (err) {
      this.identity = {
        ip: 'Verification failed',
        checkedAt: Date.now(),
        viaProxy: Boolean(proxyUrl),
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (emit) this.emitState();
    return this.identity;
  }

  public async selectProxyProfile(profileId: string): Promise<void> {
    if (profileId === 'direct') {
      this.activeProxyId = 'direct';
      await this.updateProxy({ enabled: false });
      return;
    }
    const found = this.proxyProfiles.find((p) => p.id === profileId);
    if (!found) return;
    this.activeProxyId = found.id;
    this.proxy = {
      enabled: true,
      server: found.server,
      username: found.username,
      password: found.password,
    };
    const resumeUrl = this.currentUrl || START_URL;
    await this.verifyProxyIdentity(false);
    await this.launchBrowserAndContext();
    await this.navigate(resumeUrl, true);
  }

  public async addProxyProfile(input: {
    label: string;
    server: string;
    username: string;
    password: string;
  }): Promise<void> {
    const id = `custom-${Date.now()}`;
    let locationHint = input.server.replace(/^https?:\/\//, '');
    try {
      const u = new URL(input.server.includes('://') ? input.server : `http://${input.server}`);
      locationHint = `${u.hostname}:${u.port || '80'}`;
    } catch {
      // keep raw hint
    }
    const profile: ProxyProfile = {
      id,
      label: input.label.trim() || `Custom Proxy · ${locationHint}`,
      locationHint,
      server: input.server.trim(),
      username: input.username.trim(),
      password: input.password,
    };
    this.proxyProfiles.push(profile);
    await this.selectProxyProfile(profile.id);
  }

  public async updateProxy(nextProxy: Partial<ProxyConfig>): Promise<void> {
    this.proxy = {
      enabled: nextProxy.enabled ?? this.proxy.enabled,
      server: nextProxy.server !== undefined ? nextProxy.server : this.proxy.server,
      username: nextProxy.username !== undefined ? nextProxy.username : this.proxy.username,
      password:
        nextProxy.password !== undefined && nextProxy.password !== '••••••••'
          ? nextProxy.password
          : this.proxy.password,
    };
    if (!this.proxy.enabled) {
      this.activeProxyId = 'direct';
    } else {
      const matched = this.proxyProfiles.find(
        (p) => p.server === this.proxy.server && p.username === this.proxy.username,
      );
      this.activeProxyId = matched ? matched.id : null;
    }

    const resumeUrl = this.currentUrl || START_URL;
    await this.verifyProxyIdentity(false);
    await this.launchBrowserAndContext();
    await this.navigate(resumeUrl, true);
  }

  public async setGeolocation(latitude: number, longitude: number): Promise<void> {
    this.geolocation = { latitude, longitude };
    if (this.context) {
      await this.context.setGeolocation({ latitude, longitude }).catch(() => {});
    }
    this.emitState();
  }

  public async newIdentity(): Promise<void> {
    this.networkEntries = [];
    this.networkBodyCache.clear();
    this.consoleEntries = [];
    this.blockedCount = 0;
    this.broadcast({ type: 'network:clear' });
    this.broadcast({ type: 'console:clear' });
    await this.verifyProxyIdentity(false);
    await this.launchBrowserAndContext();
    await this.navigate(START_URL, true);
  }

  public async takeScreenshot(): Promise<string | null> {
    if (!this.page || this.page.isClosed()) return null;
    try {
      const buf = await this.page.screenshot({ type: 'png' });
      return buf.toString('base64');
    } catch {
      return null;
    }
  }

  public async teardown(): Promise<void> {
    if (this.cdp) {
      await this.cdp.send('Page.stopScreencast').catch(() => {});
      await this.cdp.detach().catch(() => {});
      this.cdp = null;
    }
    this.screencastActive = false;
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.page = null;
  }
}
