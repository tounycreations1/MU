export interface DevicePreset {
  id: string;
  name: string;
  brand: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  userAgent: string;
  isMobile: boolean;
  hasTouch: boolean;
}

export interface ProxyConfig {
  enabled: boolean;
  server: string;
  username: string;
  password: string;
}

export interface ProxyProfile {
  id: string;
  label: string;
  locationHint: string;
  server: string;
  username: string;
  password: string;
}

export interface ProxyIdentityInfo {
  ip: string;
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  isp?: string;
  checkedAt: number;
  viaProxy: boolean;
  error?: string;
}

export interface NetworkEntry {
  id: string;
  url: string;
  method: string;
  resourceType: string;
  status: number | null;
  statusText: string;
  startTime: number;
  durationMs: number | null;
  sizeBytes: number | null;
  mimeType?: string;
  failed?: boolean;
  blocked?: boolean;
  failureText?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string | null;
  responseBodyPreview?: string | null;
}

export type ConsoleEntryType =
  | 'log'
  | 'info'
  | 'warn'
  | 'error'
  | 'debug'
  | 'eval-input'
  | 'eval-result'
  | 'eval-error'
  | 'pageerror';

export interface ConsoleEntry {
  id: string;
  type: ConsoleEntryType;
  text: string;
  timestamp: number;
  location?: string;
}

export interface DomNodeSummary {
  selector: string;
  tag: string;
  id?: string;
  classes: string[];
  textPreview?: string;
  attributes: Array<{ name: string; value: string }>;
  children: DomNodeSummary[];
  childCount: number;
}

export interface InspectedElement {
  selector: string;
  tag: string;
  id?: string;
  classes: string[];
  attributes: Array<{ name: string; value: string }>;
  innerText: string;
  outerHTML: string;
  rect: { x: number; y: number; width: number; height: number };
  computedStyles: Record<string, string>;
  inlineStyle: string;
  boxModel: {
    margin: [number, number, number, number];
    border: [number, number, number, number];
    padding: [number, number, number, number];
    width: number;
    height: number;
  };
}

export interface CookieItem {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

export interface StorageKeyVal {
  key: string;
  value: string;
}

export interface StorageSnapshot {
  origin: string;
  cookies: CookieItem[];
  localStorage: StorageKeyVal[];
  sessionStorage: StorageKeyVal[];
}

export type ThrottlingMode = 'none' | 'fast3g' | 'slow3g' | 'offline';

export interface BrowserState {
  connected: boolean;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  deviceId: string;
  orientation: 'portrait' | 'landscape';
  viewportWidth: number;
  viewportHeight: number;
  throttling: ThrottlingMode;
  blockTrackers: boolean;
  blockedCount: number;
  inspectMode: boolean;
  proxy: ProxyConfig;
  activeProxyId: string | null;
  proxyProfiles: Array<Omit<ProxyProfile, 'password'>>;
  identity: ProxyIdentityInfo | null;
  geolocation: { latitude: number; longitude: number };
  lastError: string | null;
}

export interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export type EngineMode =
  | 'detecting'
  | 'chromium'
  | 'vercel-chromium'
  | 'vercel-proxy'
  | 'backend-missing';

export interface RenderedPageSnapshot {
  url: string;
  title: string;
  htmlBody: string;
  styles: string[];
  renderedAt: number;
}

