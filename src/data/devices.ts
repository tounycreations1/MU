import type { DevicePreset, ProxyProfile } from '../types/browser.ts';

export const DEFAULT_PROXY_PROFILES: ProxyProfile[] = [
  {
    id: 'us-east-nj',
    label: 'US East · Piscataway, NJ',
    locationHint: '38.154.185.97:6370',
    server: 'http://38.154.185.97:6370',
    username: 'knhvpaql',
    password: 'kg3ak1ut8a8e',
  },
  {
    id: 'us-west-la',
    label: 'US West · Los Angeles, CA',
    locationHint: '191.96.254.138:6185',
    server: 'http://191.96.254.138:6185',
    username: 'knhvpaql',
    password: 'kg3ak1ut8a8e',
  },
];

export const DEVICE_PRESETS: DevicePreset[] = [
  {
    id: 'iphone-15-pro',
    name: 'iPhone 15 Pro',
    brand: 'Apple',
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
    name: 'Pixel 8',
    brand: 'Google',
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
    name: 'Galaxy S24',
    brand: 'Samsung',
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
    name: 'iPhone SE',
    brand: 'Apple',
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
    name: 'iPad Mini',
    brand: 'Apple',
    width: 744,
    height: 1133,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
];

export const QUICK_BOOKMARKS = [
  { label: 'Webshare IP Check', url: 'https://ipv4.webshare.io/' },
  { label: 'IP Location', url: 'https://www.iplocation.net/' },
  { label: 'BrowserLeaks IP', url: 'https://browserleaks.com/ip' },
  { label: 'DuckDuckGo', url: 'https://duckduckgo.com/' },
  { label: 'Wikipedia', url: 'https://en.m.wikipedia.org/' },
  { label: 'Hacker News', url: 'https://news.ycombinator.com/' },
];
