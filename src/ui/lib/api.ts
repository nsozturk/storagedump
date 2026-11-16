import type { MessageEnvelope, MessageMap, MessageResponse, MessageType } from '@/shared/messages';
import type {
  ActiveContext,
  AppSettings,
  CategoryDetail,
  CategoryDetailTarget,
  DebugSnapshot,
  ExportJobStatus,
  ExportManifest,
  ExportOptions,
  ExportSelection,
  MutationAction,
  ScanResult,
  StorageCategoryId
} from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/constants';

const MESSAGE_TIMEOUT_MS = 60_000;

async function sendMessage<T extends MessageType>(
  type: T,
  payload: MessageMap[T]['request']
): Promise<MessageMap[T]['response']> {
  // A busy or restarting service worker can leave sendMessage pending or answer with
  // nothing; neither may leave the popup blank or stuck on "Scanning…".
  const response = await Promise.race([
    chrome.runtime.sendMessage<MessageEnvelope<T>, MessageResponse<T>>({ type, payload }),
    new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), MESSAGE_TIMEOUT_MS))
  ]);

  if (!response) {
    throw new Error('StorageDump did not answer in time. It may be restarting: try again.');
  }

  if (!response.ok) {
    throw new Error(response.error);
  }

  return response.data;
}

export const extensionApi = {
  scanActiveSite: () => sendMessage('SCAN_ACTIVE_SITE', undefined),
  loadCategoryDetail: (categoryId: StorageCategoryId, target?: CategoryDetailTarget) =>
    sendMessage('LOAD_CATEGORY_DETAIL', { categoryId, target }),
  runMutation: (categoryId: StorageCategoryId, action: MutationAction) =>
    sendMessage('RUN_CATEGORY_MUTATION', { categoryId, action }),
  startExport: (selection: ExportSelection, options: ExportOptions) => sendMessage('START_EXPORT', { selection, options }),
  getExportStatus: (jobId: string) => sendMessage('GET_EXPORT_STATUS', { jobId }),
  getSettings: async (): Promise<AppSettings> => {
    try {
      return await sendMessage('GET_SETTINGS', undefined);
    } catch {
      return DEFAULT_SETTINGS;
    }
  },
  saveSettings: (settings: AppSettings) => sendMessage('SAVE_SETTINGS', settings),
  getHistory: () => sendMessage('GET_HISTORY', undefined),
  deleteHistoryEntry: (historyId: string) => sendMessage('DELETE_HISTORY_ENTRY', { historyId }),
  openDashboard: () => sendMessage('OPEN_DASHBOARD', undefined),
  getActiveContext: (): Promise<ActiveContext> => sendMessage('GET_ACTIVE_CONTEXT', undefined),
  requestOriginPermission: () => sendMessage('REQUEST_ORIGIN_PERMISSION', undefined),
  requestOriginPermissionDirectly: async () => {
    const context = await sendMessage('GET_ACTIVE_CONTEXT', undefined);
    if (!/^https?:\/\//.test(context.url)) {
      return {
        origin: context.origin,
        state: 'restricted' as const
      };
    }

    const originPattern = `${new URL(context.url).origin}/*`;
    const alreadyGranted = await chrome.permissions.contains({
      origins: [originPattern]
    });

    if (alreadyGranted) {
      return {
        origin: context.origin,
        state: 'granted' as const
      };
    }

    const granted = await chrome.permissions.request({
      origins: [originPattern]
    });

    return {
      origin: context.origin,
      state: granted ? ('granted' as const) : ('denied' as const)
    };
  },
  getExportPreview: (selection: ExportSelection): Promise<ExportManifest> => sendMessage('GET_EXPORT_PREVIEW', { selection }),
  getDebugSnapshot: (): Promise<DebugSnapshot> => sendMessage('GET_DEBUG_SNAPSHOT', undefined)
};

export type { AppSettings, CategoryDetail, ExportJobStatus, ScanResult };
