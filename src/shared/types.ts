export type StorageCategoryId =
  | 'local'
  | 'session'
  | 'cookies'
  | 'indexeddb'
  | 'cache'
  | 'serviceWorkers'
  | 'extension';

export type AccessState = 'readable' | 'partial' | 'restricted' | 'unavailable' | 'failed';
export type PermissionState = 'granted' | 'required' | 'denied' | 'restricted';
export type MutationCapability = 'create' | 'update' | 'delete' | 'clear';
export type PreviewMode = 'table' | 'json' | 'tree' | 'metadata';
export type ExportFormat = 'json' | 'zip';
export type ThemeMode = 'system' | 'dark' | 'light';

export interface CategorySummary {
  id: StorageCategoryId;
  label: string;
  accessState: AccessState;
  permissionState: PermissionState;
  detected: boolean;
  itemCount?: number;
  estimatedSizeBytes?: number;
  warnings: string[];
  mutationCapabilities: MutationCapability[];
}

export interface CategoryEntry {
  id: string;
  key: string;
  value?: unknown;
  valuePreview: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface CategoryDetailTarget {
  dbName?: string;
  storeName?: string;
  storageArea?: 'local' | 'sync';
  offset?: number;
  limit?: number;
  /** Cache export only: include non-text response bodies as base64. */
  includeBinaryBodies?: boolean;
}

export interface CategoryDetail {
  id: StorageCategoryId;
  summary: CategorySummary;
  previewMode: PreviewMode;
  entries: CategoryEntry[];
  truncated: boolean;
  nextCursor?: string;
  metadata?: Record<string, unknown>;
}

export interface ExportManifestCategory {
  id: StorageCategoryId;
  status: AccessState | 'exported';
  itemCount?: number;
  estimatedSizeBytes?: number;
  warnings: string[];
}

export interface ExportManifest {
  app: 'StorageDump';
  version: string;
  origin: string;
  exportedAt: string;
  format: ExportFormat;
  categories: ExportManifestCategory[];
  partial: boolean;
}

export interface ExportHistoryEntry {
  id: string;
  fileName: string;
  format: ExportFormat;
  origin: string;
  createdAt: string;
  categoryCount: number;
  totalSizeBytes: number;
  warningCount: number;
  partial: boolean;
  checksum: string;
}

export interface AppSettings {
  defaultFormat: ExportFormat;
  prettyPrint: boolean;
  includeMetadata: boolean;
  includeTimestamps: boolean;
  splitLargeFiles: boolean;
  splitThresholdBytes: number;
  skipBinaryBodies: boolean;
  maskSensitiveValues: boolean;
  autoScanOnOpen: boolean;
  retainExportHistory: boolean;
  theme: ThemeMode;
  debugLogs: boolean;
}

export interface ScanResult {
  origin: string;
  siteTitle?: string;
  scannedAt: string;
  categories: CategorySummary[];
  permissionWarnings: string[];
}

export interface PermissionStatus {
  origin: string;
  state: PermissionState;
}

export interface MutationAction {
  type: 'create' | 'update' | 'delete' | 'clear';
  target?: CategoryDetailTarget;
  key?: string;
  /** IndexedDB only: the record's real primary key (number, array…); `key` is its string form. */
  primaryKey?: unknown;
  storageArea?: 'local' | 'sync';
  value?: unknown;
  domain?: string;
}

export interface ExportSelection {
  categoryIds: StorageCategoryId[];
  detailTargets?: Partial<Record<StorageCategoryId, CategoryDetailTarget>>;
}

export interface ExportOptions {
  format: ExportFormat;
  prettyPrint: boolean;
  includeMetadata: boolean;
  includeTimestamps: boolean;
  splitLargeFiles: boolean;
  splitThresholdBytes: number;
  skipBinaryBodies: boolean;
  maskSensitiveValues: boolean;
}

export interface ExportJobStatus {
  id: string;
  state: 'idle' | 'running' | 'completed' | 'failed';
  progress: number;
  currentTask: string;
  manifest?: ExportManifest;
  historyEntry?: ExportHistoryEntry;
  error?: string;
}

export interface ActiveContext {
  tabId: number;
  windowId: number;
  url: string;
  origin: string;
  title?: string;
}

export interface CookieDebugEntry {
  name: string;
  domain: string;
  path: string;
  storeId: string;
  valueBytes: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  partitionKeyTopLevelSite?: string;
}

export interface DebugSnapshot {
  capturedAt: string;
  context: ActiveContext;
  scriptable: boolean;
  originPermission: PermissionState;
  pageRuntime: {
    ready: boolean;
    error?: string;
  };
  cookieDebug: {
    hostname?: string;
    siteKey?: string;
    storeId?: string;
    storeTabCount?: number;
    allVisibleCount: number;
    relatedCount: number;
    matchedCount: number;
    sample: CookieDebugEntry[];
    note?: string;
  };
  scan: ScanResult | null;
  scanError?: string;
}
