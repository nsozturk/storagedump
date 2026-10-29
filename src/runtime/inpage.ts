import { CATEGORY_LABELS, DEFAULT_DETAIL_LIMIT } from '@/shared/constants';
import type {
  CategoryDetail,
  CategoryDetailTarget,
  CategoryEntry,
  CategorySummary,
  MutationAction,
  ScanResult,
  StorageCategoryId
} from '@/shared/types';
import { estimateBytes, previewValue, safeJsonParse } from '@/shared/utils/serialization';

interface StorageDumpBridge {
  scan: () => Promise<ScanResult>;
  inspect: (categoryId: StorageCategoryId, target?: CategoryDetailTarget) => Promise<CategoryDetail>;
  exportCategory: (categoryId: StorageCategoryId, target?: CategoryDetailTarget) => Promise<unknown>;
  mutate: (categoryId: StorageCategoryId, action: MutationAction) => Promise<CategoryDetail>;
}

declare global {
  interface Window {
    __storageDumpBridge?: StorageDumpBridge;
  }
}

function makeSummary(input: Partial<CategorySummary> & Pick<CategorySummary, 'id' | 'accessState'>): CategorySummary {
  return {
    label: CATEGORY_LABELS[input.id],
    permissionState: 'granted',
    detected: false,
    warnings: [],
    mutationCapabilities: [],
    ...input
  };
}

function storageEntries(storage: Storage): CategoryEntry[] {
  return Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index) ?? `item-${index}`;
    const rawValue = storage.getItem(key) ?? '';
    const value = safeJsonParse(rawValue);

    return {
      id: key,
      key,
      value,
      valuePreview: previewValue(value),
      sizeBytes: estimateBytes(rawValue)
    };
  });
}

async function inspectStorageArea(kind: 'local' | 'session'): Promise<CategoryDetail> {
  const storage = kind === 'local' ? localStorage : sessionStorage;
  const entries = storageEntries(storage);
  const summary = makeSummary({
    id: kind,
    accessState: entries.length > 0 ? 'readable' : 'unavailable',
    detected: entries.length > 0,
    itemCount: entries.length,
    estimatedSizeBytes: entries.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0),
    mutationCapabilities: ['create', 'update', 'delete', 'clear']
  });

  return {
    id: kind,
    summary,
    previewMode: 'table',
    entries,
    truncated: false
  };
}

async function mutateStorageArea(kind: 'local' | 'session', action: MutationAction): Promise<CategoryDetail> {
  const storage = kind === 'local' ? localStorage : sessionStorage;

  switch (action.type) {
    case 'create':
    case 'update':
      if (!action.key) {
        throw new Error('Storage mutation requires a key.');
      }
      storage.setItem(action.key, typeof action.value === 'string' ? action.value : JSON.stringify(action.value));
      break;
    case 'delete':
      if (!action.key) {
        throw new Error('Storage delete requires a key.');
      }
      storage.removeItem(action.key);
      break;
    case 'clear':
      storage.clear();
      break;
    default:
      throw new Error(`Unsupported storage action: ${action.type}`);
  }

  return inspectStorageArea(kind);
}

function requestToRecord(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

function openDatabase(name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Failed to open IndexedDB database ${name}.`));
  });
}

function normalizeForTransport(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') {
    return { kind: 'BigInt', value: value.toString() };
  }

  if (value && typeof value === 'object') {
    // Only ancestors are tracked, so shared (non-cyclic) references still serialize.
    if (seen.has(value)) {
      return { kind: 'Circular' };
    }
    seen.add(value);
    try {
      return normalizeObject(value, seen);
    } finally {
      seen.delete(value);
    }
  }

  return value;
}

function normalizeObject(value: object, seen: WeakSet<object>): unknown {
  if (value instanceof Map) {
    return {
      kind: 'Map',
      entries: Array.from(value, ([key, nested]) => [normalizeForTransport(key, seen), normalizeForTransport(nested, seen)])
    };
  }

  if (value instanceof Set) {
    return { kind: 'Set', values: Array.from(value, (nested) => normalizeForTransport(nested, seen)) };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Blob) {
    return {
      kind: 'Blob',
      size: value.size,
      type: value.type
    };
  }

  if (value instanceof ArrayBuffer) {
    return {
      kind: 'ArrayBuffer',
      byteLength: value.byteLength
    };
  }

  if (ArrayBuffer.isView(value)) {
    return {
      kind: value.constructor.name,
      byteLength: value.byteLength
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForTransport(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, normalizeForTransport(nested, seen)])
  );
}

async function listDatabases(): Promise<Array<{ name: string; version?: number }>> {
  if (!('databases' in indexedDB) || typeof indexedDB.databases !== 'function') {
    return [];
  }

  const databases = await indexedDB.databases();
  return databases
    .filter((database): database is IDBDatabaseInfo & { name: string } => Boolean(database.name))
    .map((database) => ({
      name: database.name,
      version: database.version
    }));
}

async function getStoreEntries(dbName: string, storeName: string, offset = 0, limit = DEFAULT_DETAIL_LIMIT) {
  const db = await openDatabase(dbName);

  try {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const metadata = {
      keyPath: typeof store.keyPath === 'string' ? store.keyPath : JSON.stringify(store.keyPath),
      autoIncrement: store.autoIncrement
    };
    const count = Number(await requestToRecord(store.count()));
    const entries: CategoryEntry[] = [];

    let skipped = 0;
    let collected = 0;

    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }

        if (skipped < offset) {
          skipped += 1;
          cursor.continue();
          return;
        }

        if (collected >= limit) {
          resolve();
          return;
        }

        try {
          const serializedValue = normalizeForTransport(cursor.value);
          entries.push({
            id: String(cursor.primaryKey),
            key: String(cursor.primaryKey),
            value: serializedValue,
            valuePreview: previewValue(serializedValue),
            sizeBytes: estimateBytes(serializedValue),
            metadata: {
              primaryKey: normalizeForTransport(cursor.primaryKey)
            }
          });
          collected += 1;
          cursor.continue();
        } catch (error) {
          // An exception inside onsuccess would otherwise leave this promise pending forever.
          reject(error);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('Failed to read IndexedDB cursor.'));
    });

    return {
      count,
      entries,
      metadata,
      nextCursor: offset + entries.length < count ? String(offset + entries.length) : undefined
    };
  } finally {
    db.close();
  }
}

async function scanIndexedDb(): Promise<CategorySummary> {
  try {
    const databases = await listDatabases();
    if (databases.length === 0) {
      return makeSummary({
        id: 'indexeddb',
        accessState: 'unavailable',
        detected: false,
        itemCount: 0,
        mutationCapabilities: ['create', 'update', 'delete', 'clear']
      });
    }

    let totalStores = 0;
    let totalItems = 0;
    let estimatedSizeBytes = 0;
    const warnings: string[] = [];

    for (const databaseInfo of databases) {
      const db = await openDatabase(databaseInfo.name, databaseInfo.version);
      try {
        totalStores += db.objectStoreNames.length;
        for (const storeName of Array.from(db.objectStoreNames)) {
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);
          const count = Number(await requestToRecord(store.count()));
          totalItems += count;

          const sampleEntries = await getStoreEntries(databaseInfo.name, storeName, 0, Math.min(count, 10));
          const sampleBytes = sampleEntries.entries.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0);
          if (sampleEntries.entries.length > 0) {
            estimatedSizeBytes += Math.round((sampleBytes / sampleEntries.entries.length) * count);
          }
        }
      } catch (error) {
        warnings.push(
          error instanceof Error ? `${databaseInfo.name}: ${error.message}` : `${databaseInfo.name}: failed to scan`
        );
      } finally {
        db.close();
      }
    }

    return makeSummary({
      id: 'indexeddb',
      accessState: warnings.length > 0 ? 'partial' : 'readable',
      detected: true,
      itemCount: totalItems,
      estimatedSizeBytes,
      warnings: warnings.length > 0 ? warnings : [`${databases.length} databases across ${totalStores} object stores.`],
      mutationCapabilities: ['create', 'update', 'delete', 'clear']
    });
  } catch (error) {
    return makeSummary({
      id: 'indexeddb',
      accessState: 'failed',
      detected: true,
      warnings: [error instanceof Error ? error.message : 'Failed to inspect IndexedDB.'],
      mutationCapabilities: ['create', 'update', 'delete', 'clear']
    });
  }
}

async function inspectIndexedDb(target?: CategoryDetailTarget): Promise<CategoryDetail> {
  const summary = await scanIndexedDb();
  const databases = await listDatabases();

  if (!target?.dbName || !target.storeName) {
    const entries: CategoryEntry[] = [];

    for (const databaseInfo of databases) {
      const db = await openDatabase(databaseInfo.name, databaseInfo.version);
      try {
        for (const storeName of Array.from(db.objectStoreNames)) {
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);
          const count = Number(await requestToRecord(store.count()));
          entries.push({
            id: `${databaseInfo.name}:${storeName}`,
            key: `${databaseInfo.name}.${storeName}`,
            valuePreview: `${count} records`,
            sizeBytes: undefined,
            metadata: {
              dbName: databaseInfo.name,
              storeName,
              count
            }
          });
        }
      } finally {
        db.close();
      }
    }

    return {
      id: 'indexeddb',
      summary,
      previewMode: 'tree',
      entries,
      truncated: false,
      metadata: {
        databases
      }
    };
  }

  const offset = Number(target.offset ?? 0);
  const limit = Number(target.limit ?? DEFAULT_DETAIL_LIMIT);
  const result = await getStoreEntries(target.dbName, target.storeName, offset, limit);

  return {
    id: 'indexeddb',
    summary,
    previewMode: 'table',
    entries: result.entries,
    truncated: Boolean(result.nextCursor),
    nextCursor: result.nextCursor,
    metadata: {
      dbName: target.dbName,
      storeName: target.storeName,
      ...result.metadata,
      totalCount: result.count
    }
  };
}

async function exportIndexedDb(): Promise<unknown> {
  const databases = await listDatabases();
  const payload: Record<string, unknown> = {};

  for (const databaseInfo of databases) {
    const db = await openDatabase(databaseInfo.name, databaseInfo.version);
    try {
      const databasePayload: Record<string, unknown> = {};
      for (const storeName of Array.from(db.objectStoreNames)) {
        const storeResult = await getStoreEntries(databaseInfo.name, storeName, 0, Number.MAX_SAFE_INTEGER);
        databasePayload[storeName] = {
          count: storeResult.count,
          metadata: storeResult.metadata,
          entries: storeResult.entries.map((entry) => ({
            key: entry.key,
            value: entry.value,
            metadata: entry.metadata
          }))
        };
      }
      payload[databaseInfo.name] = {
        version: databaseInfo.version,
        stores: databasePayload
      };
    } finally {
      db.close();
    }
  }

  return payload;
}

async function mutateIndexedDb(action: MutationAction): Promise<CategoryDetail> {
  if (!action.target?.dbName || !action.target.storeName) {
    throw new Error('IndexedDB mutations require dbName and storeName.');
  }

  const db = await openDatabase(action.target.dbName);
  try {
    const transaction = db.transaction(action.target.storeName, 'readwrite');
    const store = transaction.objectStore(action.target.storeName);

    switch (action.type) {
      case 'create':
      case 'update':
        await requestToRecord(store.put(action.value, action.key ?? undefined));
        break;
      case 'delete':
        if (!action.key && action.primaryKey === undefined) {
          throw new Error('IndexedDB delete requires a key.');
        }
        // A numeric key 1 does not match the string "1"; prefer the real key.
        await requestToRecord(store.delete((action.primaryKey ?? action.key) as IDBValidKey));
        break;
      case 'clear':
        await requestToRecord(store.clear());
        break;
      default:
        throw new Error(`Unsupported IndexedDB action: ${action.type}`);
    }

    await transactionDone(transaction);
  } finally {
    db.close();
  }

  return inspectIndexedDb(action.target);
}

// application/javascript, image/svg+xml, */xml etc. are text too; matching only
// "text"/"json" silently dropped their bodies from exports.
function isTextualContentType(contentType: string): boolean {
  return /^text\/|json|\+xml|^application\/xml|javascript|ecmascript|x-www-form-urlencoded/i.test(contentType);
}

async function scanCacheStorage(): Promise<CategorySummary> {
  if (!('caches' in window)) {
    return makeSummary({
      id: 'cache',
      accessState: 'unavailable',
      mutationCapabilities: []
    });
  }

  const cacheNames = await caches.keys();
  if (cacheNames.length === 0) {
    return makeSummary({
      id: 'cache',
      accessState: 'unavailable',
      detected: false,
      itemCount: 0,
      mutationCapabilities: []
    });
  }

  let itemCount = 0;
  let estimatedSizeBytes = 0;
  const warnings: string[] = [];

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    itemCount += keys.length;

    for (const request of keys.slice(0, 20)) {
      const response = await cache.match(request);
      const contentLength = response?.headers.get('content-length');
      if (contentLength) {
        estimatedSizeBytes += Number(contentLength);
      } else {
        warnings.push(`Approximate size for ${request.url} could not be determined.`);
      }
    }
  }

  return makeSummary({
    id: 'cache',
    accessState: warnings.length > 0 ? 'partial' : 'readable',
    detected: true,
    itemCount,
    estimatedSizeBytes: estimatedSizeBytes || undefined,
    warnings,
    mutationCapabilities: []
  });
}

async function inspectCacheStorage(target?: CategoryDetailTarget): Promise<CategoryDetail> {
  const summary = await scanCacheStorage();
  const cacheNames = await caches.keys();
  const entries: CategoryEntry[] = [];
  const limit = Number(target?.limit ?? DEFAULT_DETAIL_LIMIT);
  let remaining = limit;

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();

    for (const request of requests) {
      if (remaining <= 0) {
        break;
      }

      const response = await cache.match(request);
      const contentType = response?.headers.get('content-type') ?? 'unknown';
      const contentLength = response?.headers.get('content-length');
      let bodyPreview = isTextualContentType(contentType) ? 'Preview unavailable' : 'Binary';

      try {
        if (response && isTextualContentType(contentType)) {
          bodyPreview = previewValue(await response.clone().text(), 180);
        }
      } catch {
        bodyPreview = 'Failed to read response body';
      }

      entries.push({
        id: `${cacheName}:${request.url}`,
        key: request.url,
        valuePreview: bodyPreview,
        sizeBytes: contentLength ? Number(contentLength) : undefined,
        metadata: {
          cacheName,
          method: request.method,
          status: response?.status,
          contentType
        }
      });
      remaining -= 1;
    }
  }

  return {
    id: 'cache',
    summary,
    previewMode: 'table',
    entries,
    truncated: entries.length >= limit,
    metadata: {
      cacheNames
    }
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked: String.fromCharCode(...bytes) overflows the stack on large bodies.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function exportCacheStorage(includeBinaryBodies = false): Promise<unknown> {
  const cacheNames = await caches.keys();
  const payload: Record<string, unknown> = {};

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    payload[cacheName] = await Promise.all(
      requests.map(async (request) => {
        const response = await cache.match(request);
        const contentType = response?.headers.get('content-type') ?? '';
        let body: string | null = null;
        let bodyEncoding: 'text' | 'base64' | undefined;

        if (response && isTextualContentType(contentType)) {
          body = await response.clone().text();
          bodyEncoding = 'text';
        } else if (response && includeBinaryBodies && response.type !== 'opaque') {
          body = arrayBufferToBase64(await response.clone().arrayBuffer());
          bodyEncoding = 'base64';
        }

        return {
          url: request.url,
          method: request.method,
          status: response?.status,
          contentType,
          body,
          bodyEncoding
        };
      })
    );
  }

  return payload;
}

async function scanServiceWorkers(): Promise<CategorySummary> {
  if (!('serviceWorker' in navigator)) {
    return makeSummary({
      id: 'serviceWorkers',
      accessState: 'unavailable',
      mutationCapabilities: []
    });
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return makeSummary({
      id: 'serviceWorkers',
      accessState: registrations.length > 0 ? 'readable' : 'unavailable',
      detected: registrations.length > 0,
      itemCount: registrations.length,
      warnings:
        registrations.length > 0
          ? ['Service worker lifecycle can change between scans.']
          : ['No active service workers registered for this origin.'],
      mutationCapabilities: []
    });
  } catch (error) {
    return makeSummary({
      id: 'serviceWorkers',
      accessState: 'failed',
      detected: true,
      warnings: [error instanceof Error ? error.message : 'Failed to inspect service workers.'],
      mutationCapabilities: []
    });
  }
}

function serializeWorker(worker: ServiceWorker | null): Record<string, unknown> | null {
  if (!worker) {
    return null;
  }

  return {
    scriptURL: worker.scriptURL,
    state: worker.state
  };
}

async function inspectServiceWorkers(): Promise<CategoryDetail> {
  const summary = await scanServiceWorkers();
  const registrations = await navigator.serviceWorker.getRegistrations();

  return {
    id: 'serviceWorkers',
    summary,
    previewMode: 'metadata',
    entries: registrations.map((registration, index) => ({
      id: `${registration.scope}:${index}`,
      key: registration.scope,
      valuePreview: registration.active?.state ?? 'inactive',
      metadata: {
        active: serializeWorker(registration.active),
        waiting: serializeWorker(registration.waiting),
        installing: serializeWorker(registration.installing),
        updateViaCache: registration.updateViaCache
      }
    })),
    truncated: false
  };
}

async function exportServiceWorkers(): Promise<unknown> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  return registrations.map((registration) => ({
    scope: registration.scope,
    active: serializeWorker(registration.active),
    waiting: serializeWorker(registration.waiting),
    installing: serializeWorker(registration.installing),
    updateViaCache: registration.updateViaCache
  }));
}

async function scan(): Promise<ScanResult> {
  const [local, session, indexeddb, cache, serviceWorkers] = await Promise.all([
    inspectStorageArea('local').then((detail) => detail.summary),
    inspectStorageArea('session').then((detail) => detail.summary),
    scanIndexedDb(),
    scanCacheStorage(),
    scanServiceWorkers()
  ]);

  return {
    origin: location.origin,
    siteTitle: document.title,
    scannedAt: new Date().toISOString(),
    categories: [local, session, indexeddb, cache, serviceWorkers],
    permissionWarnings: []
  };
}

async function inspect(categoryId: StorageCategoryId, target?: CategoryDetailTarget): Promise<CategoryDetail> {
  switch (categoryId) {
    case 'local':
      return inspectStorageArea('local');
    case 'session':
      return inspectStorageArea('session');
    case 'indexeddb':
      return inspectIndexedDb(target);
    case 'cache':
      return inspectCacheStorage(target);
    case 'serviceWorkers':
      return inspectServiceWorkers();
    default:
      throw new Error(`${categoryId} is not available in the page runtime.`);
  }
}

async function exportCategory(categoryId: StorageCategoryId, target?: CategoryDetailTarget): Promise<unknown> {
  switch (categoryId) {
    case 'local':
      return inspectStorageArea('local').then((detail) => detail.entries);
    case 'session':
      return inspectStorageArea('session').then((detail) => detail.entries);
    case 'indexeddb':
      return exportIndexedDb();
    case 'cache':
      return exportCacheStorage(target?.includeBinaryBodies);
    case 'serviceWorkers':
      return exportServiceWorkers();
    default:
      throw new Error(`${categoryId} cannot be exported from the page runtime.`);
  }
}

async function mutate(categoryId: StorageCategoryId, action: MutationAction): Promise<CategoryDetail> {
  switch (categoryId) {
    case 'local':
      return mutateStorageArea('local', action);
    case 'session':
      return mutateStorageArea('session', action);
    case 'indexeddb':
      return mutateIndexedDb(action);
    default:
      throw new Error(`${categoryId} is read-only in the page runtime.`);
  }
}

window.__storageDumpBridge = {
  scan,
  inspect,
  exportCategory,
  mutate
};
