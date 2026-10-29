import type { AppSettings, StorageCategoryId } from '@/shared/types';

export const APP_NAME = 'StorageDump';

export const CATEGORY_LABELS: Record<StorageCategoryId, string> = {
  local: 'Local Storage',
  session: 'Session Storage',
  cookies: 'Cookies',
  indexeddb: 'IndexedDB',
  cache: 'Cache Storage',
  serviceWorkers: 'Service Workers',
  extension: 'Extension Storage'
};

export const DEFAULT_SETTINGS: AppSettings = {
  defaultFormat: 'zip',
  prettyPrint: true,
  includeMetadata: true,
  includeTimestamps: true,
  splitLargeFiles: true,
  splitThresholdBytes: 1024 * 1024 * 2,
  skipBinaryBodies: true,
  maskSensitiveValues: false,
  autoScanOnOpen: true,
  retainExportHistory: true,
  theme: 'dark',
  debugLogs: false
};

export const HISTORY_STORAGE_KEY = 'storagedump.history';
export const SETTINGS_STORAGE_KEY = 'storagedump.settings';
export const MAX_HISTORY_ITEMS = 20;
export const DEFAULT_DETAIL_LIMIT = 100;
