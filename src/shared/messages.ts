import type {
  AppSettings,
  CategoryDetail,
  CategoryDetailTarget,
  DebugSnapshot,
  ExportJobStatus,
  ExportManifest,
  ExportOptions,
  ExportSelection,
  MutationAction,
  PermissionStatus,
  ScanResult,
  StorageCategoryId
} from '@/shared/types';

export interface MessageMap {
  SCAN_ACTIVE_SITE: {
    request: undefined;
    response: ScanResult;
  };
  LOAD_CATEGORY_DETAIL: {
    request: {
      categoryId: StorageCategoryId;
      target?: CategoryDetailTarget;
    };
    response: CategoryDetail;
  };
  RUN_CATEGORY_MUTATION: {
    request: {
      categoryId: StorageCategoryId;
      action: MutationAction;
    };
    response: CategoryDetail;
  };
  START_EXPORT: {
    request: {
      selection: ExportSelection;
      options: ExportOptions;
    };
    response: ExportJobStatus;
  };
  GET_EXPORT_STATUS: {
    request: {
      jobId: string;
    };
    response: ExportJobStatus | null;
  };
  GET_SETTINGS: {
    request: undefined;
    response: AppSettings;
  };
  SAVE_SETTINGS: {
    request: AppSettings;
    response: AppSettings;
  };
  GET_HISTORY: {
    request: undefined;
    response: {
      items: import('@/shared/types').ExportHistoryEntry[];
    };
  };
  DELETE_HISTORY_ENTRY: {
    request: {
      historyId: string;
    };
    response: {
      success: boolean;
    };
  };
  OPEN_DASHBOARD: {
    request: undefined;
    response: {
      success: boolean;
    };
  };
  GET_ACTIVE_CONTEXT: {
    request: undefined;
    response: import('@/shared/types').ActiveContext;
  };
  REQUEST_ORIGIN_PERMISSION: {
    request: undefined;
    response: PermissionStatus;
  };
  GET_EXPORT_PREVIEW: {
    request: {
      selection: ExportSelection;
    };
    response: ExportManifest;
  };
  GET_DEBUG_SNAPSHOT: {
    request: undefined;
    response: DebugSnapshot;
  };
}

export type MessageType = keyof MessageMap;

export interface MessageEnvelope<T extends MessageType> {
  type: T;
  payload: MessageMap[T]['request'];
}

export interface MessageSuccess<T extends MessageType> {
  ok: true;
  data: MessageMap[T]['response'];
}

export interface MessageFailure {
  ok: false;
  error: string;
}

export type MessageResponse<T extends MessageType> = MessageSuccess<T> | MessageFailure;
