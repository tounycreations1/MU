import React, { useEffect, useState } from 'react';
import { CheckCircle2, Globe, MapPin, Plus, RefreshCw, ShieldAlert, ShieldCheck, UserX } from 'lucide-react';
import type { BrowserState, ProxyConfig } from '../../types/browser.ts';

interface ProxyPanelProps {
  state: BrowserState;
  onVerifyProxy: () => void;
  onSelectProxyProfile: (profileId: string) => void;
  onAddProxyProfile: (profile: {
    label: string;
    server: string;
    username: string;
    password: string;
  }) => void;
  onUpdateProxy: (proxy: Partial<ProxyConfig>) => void;
  onSetGeolocation: (latitude: number, longitude: number) => void;
  onNewIdentity: () => void;
  onNavigateIpCheck: () => void;
}

export const ProxyPanel: React.FC<ProxyPanelProps> = ({
  state,
  onVerifyProxy,
  onSelectProxyProfile,
  onAddProxyProfile,
  onUpdateProxy,
  onSetGeolocation,
  onNewIdentity,
  onNavigateIpCheck,
}) => {
  const [enabled, setEnabled] = useState(state.proxy.enabled);
  const [server, setServer] = useState(state.proxy.server);
  const [username, setUsername] = useState(state.proxy.username);
  const [password, setPassword] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [lat, setLat] = useState(String(state.geolocation.latitude));
  const [lng, setLng] = useState(String(state.geolocation.longitude));
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    setEnabled(state.proxy.enabled);
    setServer(state.proxy.server);
    setUsername(state.proxy.username);
  }, [state.proxy.enabled, state.proxy.server, state.proxy.username]);

  useEffect(() => {
    setLat(String(state.geolocation.latitude));
    setLng(String(state.geolocation.longitude));
  }, [state.geolocation.latitude, state.geolocation.longitude]);

  const handleVerify = () => {
    setVerifying(true);
    onVerifyProxy();
    window.setTimeout(() => setVerifying(false), 1200);
  };

  const handleProxySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateProxy({
      enabled,
      server: server.trim(),
      username: username.trim(),
      password: password ? password : '••••••••',
    });
    setPassword('');
  };

  const handleSaveAsProfile = () => {
    if (!server.trim()) return;
    onAddProxyProfile({
      label: newLabel.trim(),
      server: server.trim(),
      username: username.trim(),
      password: password,
    });
    setNewLabel('');
    setPassword('');
  };

  const handleGeoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (!Number.isNaN(parsedLat) && !Number.isNaN(parsedLng)) {
      onSetGeolocation(parsedLat, parsedLng);
    }
  };

  const idInfo = state.identity;

  return (
    <div className="h-full overflow-auto devtools-scroll p-4 space-y-6">
      {/* Live Exit Identity Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Exit IP & Proxy Location
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              All virtual mobile browser traffic routes through the selected proxy node.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleVerify}
              className="h-8 px-3 flex items-center gap-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-md hover:border-sky-500 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin text-sky-500' : ''}`} />
              <span>Verify Exit IP</span>
            </button>
            <button
              type="button"
              onClick={onNavigateIpCheck}
              className="h-8 px-3 flex items-center gap-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Open ipv4.webshare.io</span>
            </button>
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-[#111827]">
          <div className="px-3.5 py-2.5 flex items-center justify-between gap-4 text-xs">
            <span className="text-slate-500 dark:text-slate-400">Routing Status</span>
            <span className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-slate-100">
              {state.proxy.enabled ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span>Anonymous Proxy Active</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4 text-amber-500" />
                  <span>Direct Connection (Proxy Disabled)</span>
                </>
              )}
            </span>
          </div>

          <div className="px-3.5 py-2.5 flex items-center justify-between gap-4 text-xs">
            <span className="text-slate-500 dark:text-slate-400">Verified Exit IP</span>
            <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              {idInfo?.ip && !idInfo.error && (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              )}
              {idInfo?.ip || 'Checking...'}
            </span>
          </div>

          <div className="px-3.5 py-2.5 flex items-center justify-between gap-4 text-xs">
            <span className="text-slate-500 dark:text-slate-400">Detected Location</span>
            <span className="text-slate-900 dark:text-slate-100 text-right">
              {idInfo?.city || idInfo?.region || idInfo?.country
                ? [idInfo.city, idInfo.region, idInfo.country].filter(Boolean).join(', ')
                : 'Resolving geolocation...'}
            </span>
          </div>

          <div className="px-3.5 py-2.5 flex items-center justify-between gap-4 text-xs">
            <span className="text-slate-500 dark:text-slate-400">Timezone & ISP</span>
            <span className="text-slate-700 dark:text-slate-300 font-mono text-[11px] text-right">
              {[idInfo?.timezone, idInfo?.isp].filter(Boolean).join(' · ') || '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Saved Proxy Locations Switcher */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-2.5">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Saved Proxy Locations
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Switch exit node instantly. Browser timezone and GPS coordinates sync automatically.
          </p>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-[#111827]">
          {state.proxyProfiles.map((profile) => {
            const active = state.activeProxyId === profile.id && state.proxy.enabled;
            return (
              <div
                key={profile.id}
                className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {profile.label}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                    {profile.locationHint} · user: {profile.username || 'none'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectProxyProfile(profile.id)}
                  className={`h-7 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-sky-600 hover:text-white'
                  }`}
                >
                  {active ? 'Active' : 'Use Proxy'}
                </button>
              </div>
            );
          })}

          <div className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs">
            <div className="min-w-0">
              <div className="font-medium text-slate-900 dark:text-slate-100">
                Direct Connection (No Proxy)
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Bypass upstream proxy routing for local testing
              </div>
            </div>
            <button
              type="button"
              onClick={() => onSelectProxyProfile('direct')}
              className={`h-7 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                !state.proxy.enabled
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {!state.proxy.enabled ? 'Active' : 'Disable Proxy'}
            </button>
          </div>
        </div>
      </div>

      {/* Anonymous Session Reset */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-5 flex items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Session Isolation
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Wipe all cookies, localStorage, sessionStorage, cache, and history in one click.
          </p>
        </div>
        <button
          type="button"
          onClick={onNewIdentity}
          className="h-8 px-3.5 flex items-center gap-1.5 text-xs font-medium bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white border border-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <UserX className="w-3.5 h-3.5" />
          <span>New Anonymous Identity</span>
        </button>
      </div>

      {/* Proxy Configuration & Add New Proxy Form */}
      <form onSubmit={handleProxySubmit} className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Custom Proxy / Add Location
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configure or save a new HTTP/HTTPS proxy endpoint.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-700 text-sky-600 focus:ring-sky-500"
            />
            <span>Proxy Enabled</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Location Label (optional when saving)
            </label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. UK · London"
              className="w-full h-8 px-2.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Proxy Server URL
            </label>
            <input
              type="text"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="http://191.96.254.138:6185"
              className="w-full h-8 px-2.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Proxy Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className="w-full h-8 px-2.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Proxy Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-8 px-2.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleSaveAsProfile}
            className="h-8 px-3.5 flex items-center gap-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Save & Use Proxy</span>
          </button>
          <button
            type="submit"
            className="h-8 px-4 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            Apply Settings
          </button>
        </div>
      </form>

      {/* Geolocation Override */}
      <form onSubmit={handleGeoSubmit} className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Mobile GPS Geolocation Override
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Synced automatically to your proxy exit city, or set custom coordinates.
            </p>
          </div>
          <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Latitude
            </label>
            <input
              type="text"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="w-full h-8 px-2.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Longitude
            </label>
            <input
              type="text"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              className="w-full h-8 px-2.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            {idInfo?.latitude !== undefined && idInfo?.longitude !== undefined && (
              <button
                type="button"
                onClick={() => onSetGeolocation(idInfo.latitude!, idInfo.longitude!)}
                className="hover:text-sky-500 hover:underline underline-offset-4 whitespace-nowrap"
              >
                Sync to Proxy City
              </button>
            )}
            <button
              type="button"
              onClick={() => onSetGeolocation(51.5074, -0.1278)}
              className="hover:text-sky-500 hover:underline underline-offset-4 whitespace-nowrap"
            >
              London
            </button>
            <button
              type="button"
              onClick={() => onSetGeolocation(35.6762, 139.6503)}
              className="hover:text-sky-500 hover:underline underline-offset-4 whitespace-nowrap"
            >
              Tokyo
            </button>
          </div>
          <button
            type="submit"
            className="h-8 px-4 text-xs font-medium bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white border border-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            Set Coordinates
          </button>
        </div>
      </form>
    </div>
  );
};
