import JSZip from 'jszip';

import {
  APP_NAME,
  CATEGORY_LABELS,
  DEFAULT_SETTINGS,
  HISTORY_STORAGE_KEY,
  MAX_HISTORY_ITEMS,
  SETTINGS_STORAGE_KEY
} from '@/shared/constants';
import type { MessageEnvelope, MessageMap, MessageResponse, MessageType } from '@/shared/messages';
import type {
  ActiveContext,
  AppSettings,
  CategoryDetail,
  CategoryDetailTarget,
  CategoryEntry,
  CategorySummary,
  DebugSnapshot,
  ExportHistoryEntry,
  ExportJobStatus,
  ExportManifest,
  ExportOptions,
  ExportSelection,
  MutationAction,
  PermissionState,
  ScanResult,
  StorageCategoryId
} from '@/shared/types';
import { sha256 } from '@/shared/utils/crypto';
import { formatBytes } from '@/shared/utils/format';
import { makeId } from '@/shared/utils/id';
import { estimateBytes, maskMaybeSensitiveValue, previewValue, safeJsonParse, stableStringify } from '@/shared/utils/serialization';

type Handler<T extends MessageType> = (
  payload: MessageMap[T]['request'],
  sender: chrome.runtime.MessageSender
) => Promise<MessageMap[T]['response']>;

const handlers: { [K in MessageType]: Handler<K> } = {
  SCAN_ACTIVE_SITE: async (_payload, sender) => scanActiveSite(sender),
  LOAD_CATEGORY_DETAIL: async ({ categoryId, target }, sender) => loadCategoryDetail(categoryId, target, sender),
  RUN_CATEGORY_MUTATION: async ({ categoryId, action }, sender) => runCategoryMutation(categoryId, action, sender),
  START_EXPORT: async ({ selection, options }, sender) => startExport(selection, options, sender),
  GET_EXPORT_STATUS: async ({ jobId }) => exportJobs.get(jobId) ?? null,
  GET_SETTINGS: async () => loadSettings(),
  SAVE_SETTINGS: async (settings) => saveSettings(settings),
  GET_HISTORY: async () => ({ items: await loadHistory() }),
  DELETE_HISTORY_ENTRY: async ({ historyId }) => deleteHistoryEntry(historyId),
  OPEN_DASHBOARD: async (_payload, sender) => openDashboard(sender),
  GET_ACTIVE_CONTEXT: async (_payload, sender) => getActiveContext(sender),
  REQUEST_ORIGIN_PERMISSION: async (_payload, sender) => requestActiveOriginPermission(sender),
  GET_EXPORT_PREVIEW: async ({ selection }, sender) => getExportPreview(selection, sender),
  GET_DEBUG_SNAPSHOT: async (_payload, sender) => getDebugSnapshot(sender)
};

const exportJobs = new Map<string, ExportJobStatus>();

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings();
});

chrome.runtime.onMessage.addListener((message: MessageEnvelope<MessageType>, sender, sendResponse) => {
  const handler = handlers[message.type];
  if (!handler) {
    sendResponse({ ok: false, error: `Unknown message type: ${message.type}` } satisfies MessageResponse<MessageType>);
    return false;
  }

  void handler(message.payload as never, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown background error.'
      })
    );

  return true;
});

function isScriptableUrl(url: string): boolean {
  return /^https?:\/\//.test(url);
}

async function ensureSettings(): Promise<AppSettings> {
  const settings = await loadSettings();
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
  return settings;
}

async function loadSettings(): Promise<AppSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_STORAGE_KEY] as Partial<AppSettings> | undefined) };
}

async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: merged });
  return merged;
}

async function loadHistory(): Promise<ExportHistoryEntry[]> {
  const stored = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
  return Array.isArray(stored[HISTORY_STORAGE_KEY]) ? (stored[HISTORY_STORAGE_KEY] as ExportHistoryEntry[]) : [];
}

async function saveHistory(items: ExportHistoryEntry[]): Promise<void> {
  await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: items.slice(0, MAX_HISTORY_ITEMS) });
}

async function deleteHistoryEntry(historyId: string): Promise<{ success: boolean }> {
  const history = await loadHistory();
  await saveHistory(history.filter((item) => item.id !== historyId));
  return { success: true };
}

function getPinnedTabId(sender?: chrome.runtime.MessageSender): number | null {
  const senderUrl = sender?.url;
  if (!senderUrl) {
    return null;
  }

  try {
    const parsed = new URL(senderUrl);
    const raw = parsed.searchParams.get('sourceTabId');
    if (!raw) {
      return null;
    }

    const tabId = Number(raw);
    return Number.isInteger(tabId) && tabId > 0 ? tabId : null;
  } catch {
    return null;
  }
}

async function getActiveContext(sender?: chrome.runtime.MessageSender): Promise<ActiveContext> {
  const pinnedTabId = getPinnedTabId(sender);
  if (pinnedTabId != null) {
    try {
      const tab = await chrome.tabs.get(pinnedTabId);
      if (tab.id && tab.windowId && tab.url) {
        return {
          tabId: tab.id,
          windowId: tab.windowId,
          url: tab.url,
          origin: isScriptableUrl(tab.url) ? new URL(tab.url).origin : tab.url,
          title: tab.title
        };
      }
    } catch {
      // Fallback to current active context if the original tab no longer exists.
    }
  }

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const candidateTabs = activeTab?.windowId
    ? await chrome.tabs.query({ windowId: activeTab.windowId })
    : await chrome.tabs.query({});

  const scriptableTab =
    candidateTabs.find((tab) => tab.active && tab.url && isScriptableUrl(tab.url)) ??
    candidateTabs.find((tab) => tab.url && isScriptableUrl(tab.url)) ??
    (activeTab?.url && isScriptableUrl(activeTab.url) ? activeTab : undefined);

  const tab = scriptableTab ?? activeTab;

  if (!tab?.id || !tab.windowId || !tab.url) {
    throw new Error('No active tab found.');
  }

  const origin = isScriptableUrl(tab.url) ? new URL(tab.url).origin : tab.url;
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    origin,
    title: tab.title
  };
}

function categoryBase(id: StorageCategoryId, overrides: Partial<CategorySummary> = {}): CategorySummary {
  return {
    id,
    label: CATEGORY_LABELS[id],
    accessState: 'unavailable',
    permissionState: 'granted',
    detected: false,
    warnings: [],
    mutationCapabilities: [],
    ...overrides
  };
}

async function hasOriginPermission(url: string): Promise<boolean> {
  return chrome.permissions.contains({
    origins: [`${new URL(url).origin}/*`]
  });
}

function cookieIdentity(cookie: chrome.cookies.Cookie): string {
  return [
    cookie.storeId,
    cookie.partitionKey?.topLevelSite ?? '',
    cookie.partitionKey?.hasCrossSiteAncestor ? '1' : '0',
    cookie.domain,
    cookie.path,
    cookie.name
  ].join('|');
}

async function getCookieStoreForTab(tabId: number): Promise<chrome.cookies.CookieStore | null> {
  const stores = await chrome.cookies.getAllCookieStores();
  return stores.find((store) => store.tabIds.includes(tabId)) ?? null;
}

function normalizeCookieDomain(domain: string): string {
  return domain.replace(/^\./, '').toLowerCase();
}

function getSiteKey(hostname: string): string {
  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname.toLowerCase();
}

function cookieMatchesHostname(cookie: chrome.cookies.Cookie, hostname: string): boolean {
  const normalizedCookieDomain = normalizeCookieDomain(cookie.domain);
  const normalizedHostname = hostname.toLowerCase();
  // A host-only cookie (no Domain attribute) is never sent to subdomains.
  return (
    normalizedHostname === normalizedCookieDomain ||
    (!cookie.hostOnly && normalizedHostname.endsWith(`.${normalizedCookieDomain}`))
  );
}

async function getCookiesForContext(context: ActiveContext): Promise<chrome.cookies.Cookie[]> {
  const store = await getCookieStoreForTab(context.tabId);
  const storeId = store?.id;
  const origin = new URL(context.url).origin;

  const base: chrome.cookies.GetAllDetails = {
    url: context.url,
    ...(storeId ? { storeId } : {})
  };

  // Every unpartitioned cookie for this host, whatever its Path. getAll({ url })
  // filters by the page's path, which silently dropped e.g. Path=/api cookies.
  const hostname = new URL(context.url).hostname;
  const unpartitioned = (await chrome.cookies.getAll(storeId ? { storeId } : {})).filter((cookie) =>
    cookieMatchesHostname(cookie, hostname)
  );

  // Fetch partitioned cookies (CHIPS, Chrome 119+). Falls back to [] on older builds.
  const partitioned = await Promise.resolve()
    .then(() => chrome.cookies.getAll({ ...base, partitionKey: { topLevelSite: origin } }))
    .catch((): chrome.cookies.Cookie[] => []);

  // Merge, skipping duplicates that appear in both sets.
  const seen = new Set(unpartitioned.map(cookieIdentity));
  return [...unpartitioned, ...partitioned.filter((c) => !seen.has(cookieIdentity(c)))];
}

async function requestOriginPermission(url: string): Promise<PermissionState> {
  const originPattern = `${new URL(url).origin}/*`;
  const granted = await chrome.permissions.request({
    origins: [originPattern]
  });
  return granted ? 'granted' : 'denied';
}

async function requestActiveOriginPermission(sender?: chrome.runtime.MessageSender) {
  const context = await getActiveContext(sender);
  const state = await requestOriginPermission(context.url);
  return {
    origin: context.origin,
    state
  };
}

async function ensurePageRuntime(tabId: number): Promise<void> {
  const bundleUrl = chrome.runtime.getURL('assets/inpage.js');
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (runtimeUrl: string) => {
      const bridgeHost = window as Window & {
        __storageDumpBridge?: unknown;
        __storageDumpRuntimeLoading?: Promise<unknown>;
      };

      if (bridgeHost.__storageDumpBridge) {
        return true;
      }

      if (!bridgeHost.__storageDumpRuntimeLoading) {
        bridgeHost.__storageDumpRuntimeLoading = import(runtimeUrl);
      }

      await bridgeHost.__storageDumpRuntimeLoading;
      return Boolean(bridgeHost.__storageDumpBridge);
    },
    args: [bundleUrl]
  });

  if (!result?.result) {
    throw new Error('Failed to initialize the page runtime.');
  }
}

function toCookieDebugEntry(cookie: chrome.cookies.Cookie) {
  return {
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    storeId: cookie.storeId,
    valueBytes: estimateBytes(cookie.value),
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    partitionKeyTopLevelSite: cookie.partitionKey?.topLevelSite
  };
}

async function getDebugSnapshot(sender?: chrome.runtime.MessageSender): Promise<DebugSnapshot> {
  const context = await getActiveContext(sender);
  const scriptable = isScriptableUrl(context.url);
  const originPermission = scriptable
    ? (await hasOriginPermission(context.url))
      ? 'granted'
      : 'required'
    : 'restricted';

  let pageRuntime: DebugSnapshot['pageRuntime'] = {
    ready: false
  };

  if (scriptable) {
    try {
      await ensurePageRuntime(context.tabId);
      pageRuntime = { ready: true };
    } catch (error) {
      pageRuntime = {
        ready: false,
        error: error instanceof Error ? error.message : 'Unknown page runtime failure.'
      };
    }
  }

  const hostname = scriptable ? new URL(context.url).hostname.toLowerCase() : undefined;
  const siteKey = hostname ? getSiteKey(hostname) : undefined;
  const store = await getCookieStoreForTab(context.tabId);
  const allCookies = await chrome.cookies.getAll(store ? { storeId: store.id } : {});
  const relatedCookies = siteKey
    ? allCookies.filter((cookie) => normalizeCookieDomain(cookie.domain).includes(siteKey))
    : [];
  // Use getCookiesForContext for matched cookies so partitioned cookies are included.
  const matchedCookies = scriptable ? await getCookiesForContext(context) : [];

  let scan: ScanResult | null = null;
  let scanError: string | undefined;
  try {
    scan = await scanActiveSite(sender);
  } catch (error) {
    scanError = error instanceof Error ? error.message : 'Unknown scan failure.';
  }

  return {
    capturedAt: new Date().toISOString(),
    context,
    scriptable,
    originPermission,
    pageRuntime,
    cookieDebug: {
      hostname,
      siteKey,
      storeId: store?.id,
      storeTabCount: store?.tabIds.length,
      allVisibleCount: allCookies.length,
      relatedCount: relatedCookies.length,
      matchedCount: matchedCookies.length,
      sample: (matchedCookies.length > 0 ? matchedCookies : relatedCookies).slice(0, 20).map(toCookieDebugEntry),
      note: !scriptable
        ? 'This tab cannot be scripted.'
        : originPermission !== 'granted'
          ? 'Cookie matching is shown without origin permission, but category inspect still needs granted access.'
          : 'Sample prefers matched cookies; if empty it falls back to same-site domain candidates.'
    },
    scan,
    scanError
  };
}

async function callPageBridge<T>(tabId: number, method: string, ...args: unknown[]): Promise<T> {
  await ensurePageRuntime(tabId);

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (bridgeMethod: string, bridgeArgs: unknown[]) => {
      const bridge = (window as Window & {
        __storageDumpBridge?: Record<string, (...nestedArgs: unknown[]) => Promise<unknown>>;
      }).__storageDumpBridge;

      if (!bridge || typeof bridge[bridgeMethod] !== 'function') {
        throw new Error(`StorageDump page bridge method ${bridgeMethod} is not available.`);
      }

      return bridge[bridgeMethod](...bridgeArgs);
    },
    args: [method, args]
  });

  if (!result || result.result == null) {
    throw new Error(`The page runtime returned no result for ${method}.`);
  }

  return result.result as T;
}

function hasCategories(scanResult: unknown): scanResult is ScanResult {
  return Boolean(
    scanResult &&
      typeof scanResult === 'object' &&
      Array.isArray((scanResult as ScanResult).categories)
  );
}

async function scanCookies(context: ActiveContext): Promise<CategorySummary> {
  if (!isScriptableUrl(context.url)) {
    return categoryBase('cookies', {
      accessState: 'restricted',
      permissionState: 'restricted',
      warnings: ['Cookies are only listed for http(s) pages.']
    });
  }

  const granted = await hasOriginPermission(context.url);
  if (!granted) {
    return categoryBase('cookies', {
      accessState: 'restricted',
      permissionState: 'required',
      warnings: ['Grant origin permission to inspect cookies.'],
      mutationCapabilities: ['create', 'update', 'delete', 'clear']
    });
  }

  const cookies = await getCookiesForContext(context);
  const httpOnlyCount = cookies.filter((cookie) => cookie.httpOnly).length;

  return categoryBase('cookies', {
    accessState: cookies.length > 0 ? 'readable' : 'unavailable',
    detected: cookies.length > 0,
    itemCount: cookies.length,
    estimatedSizeBytes: cookies.reduce((sum, cookie) => sum + estimateBytes(cookie.value), 0),
    warnings:
      httpOnlyCount > 0
        ? [`${httpOnlyCount} HttpOnly cookies are included via extension permission, not page context.`]
        : [],
    mutationCapabilities: ['create', 'update', 'delete', 'clear']
  });
}

async function inspectCookies(context: ActiveContext): Promise<CategoryDetail> {
  const summary = await scanCookies(context);
  if (summary.permissionState !== 'granted') {
    return {
      id: 'cookies',
      summary,
      previewMode: 'table',
      entries: [],
      truncated: false
    };
  }

  const cookies = await getCookiesForContext(context);
  return {
    id: 'cookies',
    summary,
    previewMode: 'table',
    entries: cookies.map((cookie) => ({
      id: `${cookie.domain}:${cookie.name}:${cookie.path}`,
      key: cookie.name,
      value: cookie.value,
      valuePreview: cookie.value.length > 120 ? `${cookie.value.slice(0, 120)}…` : cookie.value,
      sizeBytes: estimateBytes(cookie.value),
      metadata: {
        domain: cookie.domain,
        path: cookie.path,
        sameSite: cookie.sameSite,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        session: cookie.session,
        expirationDate: cookie.expirationDate
      }
    })),
    truncated: false
  };
}

async function mutateCookies(context: ActiveContext, action: MutationAction): Promise<CategoryDetail> {
  const granted = await hasOriginPermission(context.url);
  if (!granted) {
    throw new Error('Cookie access requires origin permission.');
  }

  const originUrl = new URL(context.url);

  switch (action.type) {
    case 'create':
    case 'update': {
      if (!action.key) {
        throw new Error('Cookie mutation requires a key.');
      }
      const payload = typeof action.value === 'object' && action.value ? (action.value as Record<string, unknown>) : {};
      await chrome.cookies.set({
        url: originUrl.origin,
        name: action.key,
        value: typeof payload.value === 'string' ? payload.value : String(action.value ?? ''),
        path: typeof payload.path === 'string' ? payload.path : '/',
        domain: typeof payload.domain === 'string' ? payload.domain : undefined,
        secure: typeof payload.secure === 'boolean' ? payload.secure : originUrl.protocol === 'https:',
        sameSite: payload.sameSite as chrome.cookies.SameSiteStatus | undefined,
        expirationDate: typeof payload.expirationDate === 'number' ? payload.expirationDate : undefined
      });
      break;
    }
    case 'delete': {
      if (!action.key) {
        throw new Error('Cookie delete requires a key.');
      }
      await chrome.cookies.remove({
        url: originUrl.origin,
        name: action.key
      });
      break;
    }
    case 'clear': {
      const cookies = await getCookiesForContext(context);
      await Promise.all(
        cookies.map((cookie) =>
          chrome.cookies.remove({
            url: `${originUrl.protocol}//${cookie.domain?.replace(/^\./, '')}${cookie.path}`,
            name: cookie.name
          })
        )
      );
      break;
    }
    default:
      throw new Error(`Unsupported cookie action: ${action.type}`);
  }

  return inspectCookies(context);
}

async function scanExtensionStorage(): Promise<CategorySummary> {
  const [localState, syncState] = await Promise.all([
    chrome.storage.local.get(null),
    chrome.storage.sync.get(null)
  ]);
  const itemCount = Object.keys(localState).length + Object.keys(syncState).length;

  return categoryBase('extension', {
    accessState: itemCount > 0 ? 'readable' : 'unavailable',
    detected: itemCount > 0,
    itemCount,
    estimatedSizeBytes: estimateBytes({ localState, syncState }),
    warnings: ['Extension storage is separate from site data and exported distinctly.'],
    mutationCapabilities: ['create', 'update', 'delete', 'clear']
  });
}

async function inspectExtensionStorage(target?: CategoryDetailTarget): Promise<CategoryDetail> {
  const summary = await scanExtensionStorage();
  const area = target?.storageArea ?? 'local';
  const items = area === 'sync' ? await chrome.storage.sync.get(null) : await chrome.storage.local.get(null);

  return {
    id: 'extension',
    summary,
    previewMode: 'table',
    entries: Object.entries(items).map(([key, value]) => ({
      id: `${area}:${key}`,
      key,
      value,
      valuePreview: stableStringify(value, 0),
      sizeBytes: estimateBytes(value),
      metadata: { storageArea: area }
    })),
    truncated: false,
    metadata: {
      storageArea: area
    }
  };
}

async function mutateExtensionStorage(action: MutationAction): Promise<CategoryDetail> {
  const storageArea = action.storageArea ?? action.target?.storageArea ?? 'local';
  const area = storageArea === 'sync' ? chrome.storage.sync : chrome.storage.local;

  switch (action.type) {
    case 'create':
    case 'update':
      if (!action.key) {
        throw new Error('Extension storage mutation requires a key.');
      }
      await area.set({ [action.key]: action.value });
      break;
    case 'delete':
      if (!action.key) {
        throw new Error('Extension storage delete requires a key.');
      }
      await area.remove(action.key);
      break;
    case 'clear':
      await area.clear();
      break;
    default:
      throw new Error(`Unsupported extension storage action: ${action.type}`);
  }

  return inspectExtensionStorage({ storageArea });
}

// ─── All-frames localStorage / sessionStorage ────────────────────────────────

type FrameStorageEntry = { key: string; value: string };
type FrameStorageResult = { origin: string; entries: FrameStorageEntry[] };

async function collectAllFramesStorage(tabId: number, kind: 'local' | 'session'): Promise<FrameStorageResult[]> {
  const readFrameStorage = (storageKind: string): FrameStorageResult => {
    const entries: Array<{ key: string; value: string }> = [];
    try {
      const storage = storageKind === 'local' ? localStorage : sessionStorage;
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) ?? `item-${i}`;
        entries.push({ key, value: storage.getItem(key) ?? '' });
      }
    } catch {
      // Sandboxed/opaque frames throw on storage access; don't fail the other frames.
    }
    // self.origin, not location.origin: about:blank frames report "null" from
    // location but share their parent's storage, which duplicated every entry.
    return { origin: self.origin, entries };
  };

  let rawResults: Array<chrome.scripting.InjectionResult<FrameStorageResult>>;
  try {
    rawResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: readFrameStorage,
      args: [kind]
    });
  } catch {
    // allFrames failed — fall back to main frame only.
    try {
      rawResults = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: readFrameStorage,
        args: [kind]
      });
    } catch {
      return [];
    }
  }

  // Deduplicate: same origin appears in multiple same-origin frames.
  const seen = new Set<string>();
  const originMap = new Map<string, FrameStorageEntry[]>();
  const merged: FrameStorageResult[] = [];

  for (const r of rawResults) {
    if (!r.result) continue;
    const { origin, entries } = r.result;
    if (!originMap.has(origin)) {
      const arr: FrameStorageEntry[] = [];
      originMap.set(origin, arr);
      merged.push({ origin, entries: arr });
    }
    for (const entry of entries) {
      const uniqKey = `${origin}\0${entry.key}`;
      if (!seen.has(uniqKey)) {
        seen.add(uniqKey);
        originMap.get(origin)!.push(entry);
      }
    }
  }

  return merged;
}

function buildAllFramesStorageDetail(kind: 'local' | 'session', frames: FrameStorageResult[]): CategoryDetail {
  const entries: CategoryEntry[] = [];
  for (const frame of frames) {
    for (const raw of frame.entries) {
      const parsed = safeJsonParse(raw.value);
      entries.push({
        id: `${frame.origin}:${raw.key}`,
        key: raw.key,
        value: parsed,
        valuePreview: previewValue(raw.value),
        sizeBytes: estimateBytes(raw.value),
        metadata: { origin: frame.origin }
      });
    }
  }

  const totalSizeBytes = entries.reduce((sum, e) => sum + (e.sizeBytes ?? 0), 0);
  const origins = frames.filter((f) => f.entries.length > 0).map((f) => f.origin);

  const summary = categoryBase(kind, {
    accessState: entries.length > 0 ? 'readable' : 'unavailable',
    detected: entries.length > 0,
    itemCount: entries.length,
    estimatedSizeBytes: totalSizeBytes,
    mutationCapabilities: ['create', 'update', 'delete', 'clear'],
    warnings: origins.length > 1 ? [`Data collected from ${origins.length} origins.`] : []
  });

  return {
    id: kind,
    summary,
    previewMode: 'table',
    entries,
    truncated: false,
    metadata: { origins }
  };
}

async function scanActiveSite(sender?: chrome.runtime.MessageSender): Promise<ScanResult> {
  const context = await getActiveContext(sender);
  const extension = await scanExtensionStorage();
  const cookies = await scanCookies(context);

  if (!isScriptableUrl(context.url)) {
    return {
      origin: context.origin,
      siteTitle: context.title,
      scannedAt: new Date().toISOString(),
      categories: [
        categoryBase('local', {
          accessState: 'restricted',
          permissionState: 'restricted',
          warnings: ['This tab URL cannot be scripted by the extension.']
        }),
        categoryBase('session', {
          accessState: 'restricted',
          permissionState: 'restricted',
          warnings: ['This tab URL cannot be scripted by the extension.']
        }),
        cookies,
        categoryBase('indexeddb', {
          accessState: 'restricted',
          permissionState: 'restricted',
          warnings: ['This tab URL cannot be scripted by the extension.']
        }),
        categoryBase('cache', {
          accessState: 'restricted',
          permissionState: 'restricted',
          warnings: ['This tab URL cannot be scripted by the extension.']
        }),
        categoryBase('serviceWorkers', {
          accessState: 'restricted',
          permissionState: 'restricted',
          warnings: ['This tab URL cannot be scripted by the extension.']
        }),
        extension
      ],
      permissionWarnings: ['Open an http(s) page to inspect site storage.']
    };
  }

  const [pageResult, localFrames, sessionFrames] = await Promise.all([
    callPageBridge<ScanResult>(context.tabId, 'scan'),
    collectAllFramesStorage(context.tabId, 'local'),
    collectAllFramesStorage(context.tabId, 'session')
  ]);
  if (!hasCategories(pageResult)) {
    throw new Error('The injected page scan returned an invalid payload.');
  }

  const categoryMap = new Map(pageResult.categories.map((category) => [category.id, category]));
  categoryMap.set('local', buildAllFramesStorageDetail('local', localFrames).summary);
  categoryMap.set('session', buildAllFramesStorageDetail('session', sessionFrames).summary);
  categoryMap.set('cookies', cookies);
  categoryMap.set('extension', extension);
  setBadge(context.tabId, [...categoryMap.values()].filter((c) => c.id !== 'extension' && c.detected).length);

  return {
    origin: context.origin,
    siteTitle: pageResult.siteTitle ?? context.title,
    scannedAt: pageResult.scannedAt,
    categories: [
      categoryMap.get('local')!,
      categoryMap.get('session')!,
      categoryMap.get('cookies')!,
      categoryMap.get('indexeddb')!,
      categoryMap.get('cache')!,
      categoryMap.get('serviceWorkers')!,
      categoryMap.get('extension')!
    ],
    permissionWarnings: cookies.permissionState === 'required' ? cookies.warnings : []
  };
}

async function loadCategoryDetail(
  categoryId: StorageCategoryId,
  target?: CategoryDetailTarget,
  sender?: chrome.runtime.MessageSender
): Promise<CategoryDetail> {
  const context = await getActiveContext(sender);

  switch (categoryId) {
    case 'cookies':
      return inspectCookies(context);
    case 'extension':
      return inspectExtensionStorage(target);
    case 'local':
    case 'session': {
      if (!isScriptableUrl(context.url)) {
        throw new Error('This tab URL cannot be scripted.');
      }
      const frames = await collectAllFramesStorage(context.tabId, categoryId);
      return buildAllFramesStorageDetail(categoryId, frames);
    }
    case 'indexeddb':
    case 'cache':
    case 'serviceWorkers':
      if (!isScriptableUrl(context.url)) {
        throw new Error('This tab URL cannot be scripted.');
      }
      return callPageBridge<CategoryDetail>(context.tabId, 'inspect', categoryId, target);
    default:
      throw new Error(`Unsupported category: ${categoryId}`);
  }
}

async function runCategoryMutation(
  categoryId: StorageCategoryId,
  action: MutationAction,
  sender?: chrome.runtime.MessageSender
): Promise<CategoryDetail> {
  const context = await getActiveContext(sender);

  switch (categoryId) {
    case 'cookies':
      return mutateCookies(context, action);
    case 'extension':
      return mutateExtensionStorage(action);
    case 'local':
    case 'session':
    case 'indexeddb':
      if (!isScriptableUrl(context.url)) {
        throw new Error('This tab URL cannot be scripted.');
      }
      return callPageBridge<CategoryDetail>(context.tabId, 'mutate', categoryId, action);
    default:
      throw new Error(`${CATEGORY_LABELS[categoryId]} is read-only.`);
  }
}

async function exportCategoryPayload(
  context: ActiveContext,
  categoryId: StorageCategoryId,
  target: CategoryDetailTarget | undefined,
  options: ExportOptions
): Promise<unknown> {
  switch (categoryId) {
    case 'cookies': {
      const detail = await inspectCookies(context);
      return detail.entries.map((entry) => ({
        key: entry.key,
        value: maskMaybeSensitiveValue(entry.key, entry.value, options.maskSensitiveValues),
        metadata: entry.metadata
      }));
    }
    case 'extension': {
      const detail = await inspectExtensionStorage(target);
      return detail.entries.map((entry) => ({
        key: entry.key,
        value: maskMaybeSensitiveValue(entry.key, entry.value, options.maskSensitiveValues),
        metadata: entry.metadata
      }));
    }
    case 'local':
    case 'session': {
      if (!isScriptableUrl(context.url)) {
        throw new Error('This tab URL cannot be scripted.');
      }
      const frames = await collectAllFramesStorage(context.tabId, categoryId);
      const detail = buildAllFramesStorageDetail(categoryId, frames);
      return detail.entries.map((entry) => ({
        key: entry.key,
        value: maskMaybeSensitiveValue(entry.key, entry.value, options.maskSensitiveValues),
        metadata: entry.metadata
      }));
    }
    default:
      if (!isScriptableUrl(context.url)) {
        throw new Error('This tab URL cannot be scripted.');
      }
      return callPageBridge<unknown>(context.tabId, 'exportCategory', categoryId, {
        ...target,
        includeBinaryBodies: !options.skipBinaryBodies
      });
  }
}

function exportFileName(origin: string, format: ExportOptions['format']): string {
  const sanitizedOrigin = origin.replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]+/gi, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `storagedump_${sanitizedOrigin}_${timestamp}.${format === 'zip' ? 'zip' : 'json'}`;
}

function splitArrayPayload(entries: unknown[], thresholdBytes: number): unknown[] {
  const chunks: unknown[] = [];
  let currentChunk: unknown[] = [];
  let currentSize = 0;

  for (const entry of entries) {
    const entrySize = estimateBytes(entry);
    if (currentChunk.length > 0 && currentSize + entrySize > thresholdBytes) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSize = 0;
    }

    currentChunk.push(entry);
    currentSize += entrySize;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

async function buildExportPayload(
  context: ActiveContext,
  scanResult: ScanResult,
  selection: ExportSelection,
  options: ExportOptions
): Promise<{
  manifest: ExportManifest;
  files: Array<{ path: string; content: string }>;
  totalSizeBytes: number;
}> {
  const categorySummaries = scanResult.categories.filter((category) => selection.categoryIds.includes(category.id));
  const manifest: ExportManifest = {
    app: APP_NAME,
    version: chrome.runtime.getManifest().version,
    origin: context.origin,
    exportedAt: new Date().toISOString(),
    format: options.format,
    categories: [],
    partial: false
  };
  const files: Array<{ path: string; content: string }> = [];
  let totalSizeBytes = 0;

  for (const category of categorySummaries) {
    try {
      const payload = await exportCategoryPayload(context, category.id, selection.detailTargets?.[category.id], options);
      const normalizedPayload = options.maskSensitiveValues ? maskPayload(category.id, payload) : payload;
      const wrappedPayload = options.includeMetadata
        ? {
            meta: {
              category: category.id,
              label: category.label,
              origin: context.origin,
              exportedAt: manifest.exportedAt
            },
            data: normalizedPayload
          }
        : normalizedPayload;

      const serialized = stableStringify(wrappedPayload, options.prettyPrint ? 2 : 0);
      totalSizeBytes += estimateBytes(serialized);

      if (options.splitLargeFiles && Array.isArray(normalizedPayload) && estimateBytes(serialized) > options.splitThresholdBytes) {
        splitArrayPayload(normalizedPayload, options.splitThresholdBytes).forEach((chunk, index) => {
          const chunkContent = stableStringify(chunk, options.prettyPrint ? 2 : 0);
          files.push({
            path: `${category.id}/part-${index + 1}.json`,
            content: chunkContent
          });
        });
      } else {
        files.push({
          path: `${category.id}.json`,
          content: serialized
        });
      }

      manifest.categories.push({
        id: category.id,
        status: 'exported',
        itemCount: category.itemCount,
        estimatedSizeBytes: category.estimatedSizeBytes,
        warnings: category.warnings
      });
    } catch (error) {
      manifest.partial = true;
      manifest.categories.push({
        id: category.id,
        status: 'failed',
        itemCount: category.itemCount,
        estimatedSizeBytes: category.estimatedSizeBytes,
        warnings: [
          ...category.warnings,
          error instanceof Error ? error.message : `Failed to export ${CATEGORY_LABELS[category.id]}.`
        ]
      });
    }
  }

  files.unshift({
    path: 'manifest.json',
    content: stableStringify(manifest, 2)
  });

  return {
    manifest,
    files,
    totalSizeBytes
  };
}

function maskPayload(categoryId: StorageCategoryId, payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return entry;
      }

      const record = entry as Record<string, unknown>;
      const key = typeof record.key === 'string' ? record.key : categoryId;
      return {
        ...record,
        value: maskMaybeSensitiveValue(key, record.value, true)
      };
    });
  }

  return payload;
}

function contentToBase64(content: string): string {
  // TextEncoder handles non-ASCII characters; avoid btoa(string) which breaks on them.
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function createDownload(
  fileName: string,
  format: ExportOptions['format'],
  files: Array<{ path: string; content: string }>
): Promise<void> {
  // URL.createObjectURL is not available in MV3 service workers.
  // Use base64 data URLs instead, which are supported by chrome.downloads.download.
  let url: string;

  if (format === 'json') {
    // Combine all exported files into a single JSON object keyed by category id.
    const combined: Record<string, unknown> = {};
    for (const file of files) {
      const key = file.path.replace(/\.json$/, '').replace(/\//g, '_');
      try {
        combined[key] = JSON.parse(file.content) as unknown;
      } catch {
        combined[key] = file.content;
      }
    }
    url = `data:application/json;base64,${contentToBase64(JSON.stringify(combined, null, 2))}`;
  } else {
    const zip = new JSZip();
    files.forEach((file) => {
      zip.file(file.path, file.content);
    });
    const base64 = await zip.generateAsync({ type: 'base64' });
    url = `data:application/zip;base64,${base64}`;
  }

  await chrome.downloads.download({
    url,
    filename: fileName,
    saveAs: true
  });
}

async function runExportJob(
  jobId: string,
  context: ActiveContext,
  scanResult: ScanResult,
  selection: ExportSelection,
  options: ExportOptions
): Promise<void> {
  exportJobs.set(jobId, {
    id: jobId,
    state: 'running',
    progress: 15,
    currentTask: 'Building export manifest'
  });

  const payload = await buildExportPayload(context, scanResult, selection, options);
  const fileName = exportFileName(context.origin, options.format);
  exportJobs.set(jobId, {
    id: jobId,
    state: 'running',
    progress: 70,
    currentTask: `Packaging ${payload.files.length} files (${formatBytes(payload.totalSizeBytes)})`,
    manifest: payload.manifest
  });

  await createDownload(fileName, options.format, payload.files);

  const checksumSource = stableStringify({
    manifest: payload.manifest,
    files: payload.files.map((file) => ({ path: file.path, size: estimateBytes(file.content) }))
  });
  const historyEntry: ExportHistoryEntry = {
    id: makeId('history'),
    fileName,
    format: options.format,
    origin: context.origin,
    createdAt: new Date().toISOString(),
    categoryCount: payload.manifest.categories.length,
    totalSizeBytes: payload.totalSizeBytes,
    warningCount: payload.manifest.categories.reduce((sum, category) => sum + category.warnings.length, 0),
    partial: payload.manifest.partial,
    checksum: await sha256(checksumSource)
  };

  const settings = await loadSettings();
  if (settings.retainExportHistory) {
    const history = await loadHistory();
    await saveHistory([historyEntry, ...history]);
  }

  exportJobs.set(jobId, {
    id: jobId,
    state: 'completed',
    progress: 100,
    currentTask: 'Export completed',
    manifest: payload.manifest,
    historyEntry
  });
}

async function startExport(
  selection: ExportSelection,
  options: ExportOptions,
  sender?: chrome.runtime.MessageSender
): Promise<ExportJobStatus> {
  const context = await getActiveContext(sender);
  // Scan while we still have the sender context (popup may close before the async job runs).
  const scanResult = await scanActiveSite(sender);
  const jobId = makeId('export');
  const job: ExportJobStatus = {
    id: jobId,
    state: 'running',
    progress: 5,
    currentTask: 'Preparing export'
  };

  exportJobs.set(jobId, job);

  void runExportJob(jobId, context, scanResult, selection, options).catch((error) => {
    exportJobs.set(jobId, {
      id: jobId,
      state: 'failed',
      progress: 100,
      currentTask: 'Export failed',
      error: error instanceof Error ? error.message : 'Export failed.'
    });
  });

  return job;
}

async function getExportPreview(selection: ExportSelection, sender?: chrome.runtime.MessageSender): Promise<ExportManifest> {
  const scanResult = await scanActiveSite(sender);
  const context = await getActiveContext(sender);
  const categories = scanResult.categories.filter((category) => selection.categoryIds.includes(category.id));

  return {
    app: APP_NAME,
    version: chrome.runtime.getManifest().version,
    origin: context.origin,
    exportedAt: new Date().toISOString(),
    format: 'zip',
    categories: categories.map((category) => ({
      id: category.id,
      status: category.accessState,
      itemCount: category.itemCount,
      estimatedSizeBytes: category.estimatedSizeBytes,
      warnings: category.warnings
    })),
    partial: categories.some((category) => category.accessState !== 'readable')
  };
}

async function openDashboard(sender?: chrome.runtime.MessageSender): Promise<{ success: boolean }> {
  const context = await getActiveContext(sender);
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`dashboard.html?sourceTabId=${context.tabId}`)
  });
  return { success: true };
}

// ─── Action badge ────────────────────────────────────────────────────────────
// Set only after a scan the user started. Pages are never scanned in the
// background (the store listing promises on-demand reads only).

const BADGE_COLOR = '#2563eb';

function setBadge(tabId: number, count: number): void {
  void chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' }).catch(() => {});
  void chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }).catch(() => {});
  void chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' }).catch(() => {});
}

// A count from the previous page is stale once the tab navigates.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    void chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
});
