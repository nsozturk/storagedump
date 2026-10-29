import { startTransition, useEffect, useMemo, useState } from 'react';

import { CATEGORY_LABELS, DEFAULT_SETTINGS } from '@/shared/constants';
import type { CategoryDetail, ExportJobStatus, ExportManifest, ScanResult, StorageCategoryId } from '@/shared/types';
import { formatBytes, formatNumber, formatRelativeTime } from '@/shared/utils/format';
import { CategoryList } from '@/ui/components/CategoryList';
import { DataTable } from '@/ui/components/DataTable';
import { DebugPanel } from '@/ui/components/DebugPanel';
import { MutationForm } from '@/ui/components/MutationForm';
import { StatusPill } from '@/ui/components/StatusPill';
import { extensionApi } from '@/ui/lib/api';
import { deriveAccessState, derivePermissionState, needsOriginPermission } from '@/ui/lib/scanState';

type DashboardView = 'overview' | StorageCategoryId | 'history' | 'settings';

export function DashboardApp() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [selectedView, setSelectedView] = useState<DashboardView>('overview');
  const [detail, setDetail] = useState<CategoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<Awaited<ReturnType<typeof extensionApi.getHistory>>['items'][number]>>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [exportPreview, setExportPreview] = useState<ExportManifest | null>(null);
  const [exportJob, setExportJob] = useState<ExportJobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [debugSnapshot, setDebugSnapshot] = useState<Awaited<ReturnType<typeof extensionApi.getDebugSnapshot>> | null>(null);

  useEffect(() => {
    void Promise.all([refreshScan(), extensionApi.getHistory(), extensionApi.getSettings()]).then(([, historyResult, storedSettings]) => {
      setHistory(historyResult.items);
      setSettings(storedSettings);
    });
  }, []);

  useEffect(() => {
    if (!exportJob || exportJob.state !== 'running') {
      return;
    }

    const interval = window.setInterval(() => {
      void extensionApi.getExportStatus(exportJob.id).then((latest) => {
        if (latest) {
          setExportJob(latest);
          if (latest.state === 'completed') {
            void extensionApi.getHistory().then((result) => setHistory(result.items));
          }
        }
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [exportJob]);

  // Exports started from the popup land in history too; don't show a stale list.
  useEffect(() => {
    if (selectedView === 'overview' || selectedView === 'history') {
      void extensionApi.getHistory().then((result) => setHistory(result.items));
    }
  }, [selectedView]);

  const stats = useMemo(() => {
    const categories = scan?.categories ?? [];
    return {
      count: categories.filter((category) => category.detected).length,
      items: categories.reduce((sum, category) => sum + (category.itemCount ?? 0), 0),
      size: categories.reduce((sum, category) => sum + (category.estimatedSizeBytes ?? 0), 0),
      warnings: categories.reduce((sum, category) => sum + category.warnings.length, 0)
    };
  }, [scan]);

  const permissionState = derivePermissionState(scan);
  const accessState = deriveAccessState(scan);

  async function requestOriginPermission() {
    const result = await extensionApi.requestOriginPermissionDirectly();
    if (result.state === 'granted') {
      await refreshScan();
      return;
    }

    setError(
      result.state === 'denied'
        ? `Origin permission was denied for ${result.origin}.`
        : `Origin permission cannot be requested for ${result.origin}.`
    );
  }

  async function loadDebugSnapshot() {
    try {
      const snapshot = await extensionApi.getDebugSnapshot();
      setDebugSnapshot(snapshot);
    } catch (debugError) {
      setError(debugError instanceof Error ? debugError.message : 'Failed to load debug snapshot.');
    }
  }

  async function refreshScan() {
    setBusy(true);
    setError(null);
    try {
      const result = await extensionApi.scanActiveSite();
      if (!result || !Array.isArray(result.categories)) {
        throw new Error('Scan returned an invalid response.');
      }
      startTransition(() => setScan(result));
      if (selectedView !== 'overview' && selectedView !== 'history' && selectedView !== 'settings') {
        // Stay on the open IndexedDB store instead of bouncing back to the database list.
        await loadDetail(selectedView, selectedView === detail?.id ? detailTarget(detail) : undefined);
      }
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Scan failed.');
      void loadDebugSnapshot();
    } finally {
      setBusy(false);
    }
  }

  async function loadDetail(categoryId: StorageCategoryId, target?: Parameters<typeof extensionApi.loadCategoryDetail>[1]) {
    setBusy(true);
    setError(null);
    try {
      const nextDetail = await extensionApi.loadCategoryDetail(categoryId, target);
      setSelectedView(categoryId);
      setDetail(nextDetail);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : 'Failed to load category detail.');
    } finally {
      setBusy(false);
    }
  }

  async function runExportSelected(categoryIds: StorageCategoryId[]) {
    setBusy(true);
    try {
      const preview = await extensionApi.getExportPreview({ categoryIds });
      setExportPreview(preview);
      const job = await extensionApi.startExport(
        { categoryIds },
        {
          format: settings.defaultFormat,
          prettyPrint: settings.prettyPrint,
          includeMetadata: settings.includeMetadata,
          includeTimestamps: settings.includeTimestamps,
          splitLargeFiles: settings.splitLargeFiles,
          splitThresholdBytes: settings.splitThresholdBytes,
          skipBinaryBodies: settings.skipBinaryBodies,
          maskSensitiveValues: settings.maskSensitiveValues
        }
      );
      setExportJob(job);
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : 'Failed to start export.');
    } finally {
      setBusy(false);
    }
  }

  async function applyMutation(action: Parameters<typeof extensionApi.runMutation>[1]) {
    if (!detail) {
      return;
    }

    setBusy(true);
    try {
      const nextDetail = await extensionApi.runMutation(detail.id, action);
      setDetail(nextDetail);
      await refreshScan();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Mutation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDashboardSettings(nextSettings: typeof settings) {
    setBusy(true);
    try {
      const saved = await extensionApi.saveSettings(nextSettings);
      setSettings(saved);
      setSelectedView('settings');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sd-app">
      <div className="sd-shell">
        <header className="sd-topbar">
          <div className="sd-brand">
            <div className="sd-brand-mark">SD</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>StorageDump Dashboard</div>
              <div className="sd-subtle">{scan?.origin ?? 'No active origin loaded'}</div>
            </div>
          </div>
          <div className="sd-actions">
            {/* Fixed-width slot: the pill replacing "Not scanned" must not shift the buttons. */}
            <span className="sd-status-slot">
              {permissionState ? <StatusPill value={permissionState} /> : accessState ? <StatusPill value={accessState} /> : <span className="sd-subtle">Not scanned</span>}
            </span>
            {needsOriginPermission(scan) ? (
              <button className="sd-button" onClick={() => void requestOriginPermission()}>
                Request origin access
              </button>
            ) : null}
            <button
              className="sd-button"
              onClick={() => {
                const next = !showDebug;
                setShowDebug(next);
                if (next && !debugSnapshot) {
                  void loadDebugSnapshot();
                }
              }}
            >
              {showDebug ? 'Hide debug' : 'Show debug'}
            </button>
            <button className="sd-button primary" onClick={() => void runExportSelected((scan?.categories ?? []).map((category) => category.id))} disabled={!scan || busy}>
              Export all
            </button>
          </div>
        </header>

        <div className="sd-main sd-main-dashboard">
          <aside className="sd-sidebar">
            <div className="sd-subtle" style={{ marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              Views
            </div>
            <nav>
              <button className={`sd-nav-item ${selectedView === 'overview' ? 'is-active' : ''}`} onClick={() => setSelectedView('overview')}>
                Overview
              </button>
              {/* Rendered before the scan finishes so the items below don't jump. */}
              {(Object.keys(CATEGORY_LABELS) as StorageCategoryId[]).map((categoryId) => (
                <button
                  key={categoryId}
                  className={`sd-nav-item ${selectedView === categoryId ? 'is-active' : ''}`}
                  onClick={() => void loadDetail(categoryId)}
                  disabled={!scan}
                >
                  {CATEGORY_LABELS[categoryId]}
                </button>
              ))}
              <button className={`sd-nav-item ${selectedView === 'history' ? 'is-active' : ''}`} onClick={() => setSelectedView('history')}>
                Export history
              </button>
              <button className={`sd-nav-item ${selectedView === 'settings' ? 'is-active' : ''}`} onClick={() => setSelectedView('settings')}>
                Settings
              </button>
            </nav>
          </aside>

          <section className="sd-content">
            {error ? <div className="sd-banner" style={{ marginBottom: 16 }}>{error}</div> : null}
            {selectedView === 'overview' ? (
              <OverviewPanel
                scan={scan}
                history={history}
                exportJob={exportJob}
                exportPreview={exportPreview}
                stats={stats}
                onRefresh={() => void refreshScan()}
                busy={busy}
                onGrantPermission={() => void requestOriginPermission()}
                showDebug={showDebug}
                debugSnapshot={debugSnapshot}
                onRefreshDebug={() => void loadDebugSnapshot()}
              />
            ) : null}

            {selectedView === 'history' ? (
              <HistoryPanel
                history={history}
                onDelete={(historyId) => void extensionApi.deleteHistoryEntry(historyId).then(() => extensionApi.getHistory().then((result) => setHistory(result.items)))}
              />
            ) : null}

            {selectedView === 'settings' ? (
              <SettingsPanel settings={settings} onSave={saveDashboardSettings} busy={busy} />
            ) : null}

            {selectedView !== 'overview' && selectedView !== 'history' && selectedView !== 'settings' && detail ? (
              <CategoryPanel
                detail={detail}
                busy={busy}
                onRefresh={() => void loadDetail(detail.id, detailTarget(detail))}
                onDelete={(key) =>
                  void applyMutation({
                    type: 'delete',
                    key,
                    primaryKey: detail.entries.find((entry) => entry.key === key)?.metadata?.primaryKey,
                    target: detail.id === 'indexeddb' ? { dbName: String(detail.metadata?.dbName ?? ''), storeName: String(detail.metadata?.storeName ?? '') } : undefined
                  })
                }
                onMutate={applyMutation}
                onLoadStore={(dbName, storeName) => void loadDetail('indexeddb', { dbName, storeName })}
                onExport={() => void runExportSelected([detail.id])}
              />
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function detailTarget(detail: CategoryDetail | null) {
  return detail?.metadata?.dbName && detail.metadata.storeName
    ? { dbName: String(detail.metadata.dbName), storeName: String(detail.metadata.storeName) }
    : undefined;
}

function OverviewPanel({
  scan,
  history,
  exportJob,
  exportPreview,
  stats,
  onRefresh,
  busy,
  onGrantPermission,
  showDebug,
  debugSnapshot,
  onRefreshDebug
}: {
  scan: ScanResult | null;
  history: Array<Awaited<ReturnType<typeof extensionApi.getHistory>>['items'][number]>;
  exportJob: ExportJobStatus | null;
  exportPreview: ExportManifest | null;
  stats: { count: number; items: number; size: number; warnings: number };
  onRefresh: () => void;
  busy: boolean;
  onGrantPermission: () => void;
  showDebug: boolean;
  debugSnapshot: Awaited<ReturnType<typeof extensionApi.getDebugSnapshot>> | null;
  onRefreshDebug: () => void;
}) {
  return (
    <div className="sd-grid">
      <div className="sd-grid cols-4">
        <MetricCard label="Detected categories" value={formatNumber(stats.count)} helper={scan?.siteTitle ?? 'Site snapshot'} />
        <MetricCard label="Total items" value={formatNumber(stats.items)} helper={scan?.scannedAt ? formatRelativeTime(scan.scannedAt) : 'Not scanned'} />
        <MetricCard label="Estimated payload" value={formatBytes(stats.size)} helper="Readable storage only" />
        <MetricCard label="Warnings" value={formatNumber(stats.warnings)} helper="Restrictions and partial reads" />
      </div>

      <div className="sd-two-col">
        <div className="sd-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <strong>Storage health</strong>
            <button className="sd-button" onClick={onRefresh} disabled={busy}>
              Refresh
            </button>
          </div>
          <CategoryList categories={scan?.categories ?? []} onGrantPermission={() => onGrantPermission()} />
        </div>

        <div className="sd-grid">
          <div className="sd-panel">
            <strong>Export pipeline</strong>
            <div className="sd-summary-row"><span className="sd-subtle">State</span><span>{exportJob?.state ?? 'idle'}</span></div>
            <div className="sd-summary-row"><span className="sd-subtle">Task</span><span>{exportJob?.currentTask ?? 'Waiting'}</span></div>
            <div className="sd-summary-row"><span className="sd-subtle">Progress</span><span>{exportJob?.progress ?? 0}%</span></div>
            {exportPreview ? <div className="sd-subtle" style={{ marginTop: 12 }}>Preview includes {exportPreview.categories.length} categories.</div> : null}
          </div>

          <div className="sd-panel">
            <strong>Recent exports</strong>
            {history.length === 0 ? (
              <div className="sd-empty">No exports yet.</div>
            ) : (
              history.slice(0, 4).map((item) => (
                <div key={item.id} className="sd-summary-row">
                  <div>
                    <div>{item.fileName}</div>
                    <div className="sd-subtle">{formatRelativeTime(item.createdAt)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div>{formatBytes(item.totalSizeBytes)}</div>
                    <div className="sd-subtle">{item.partial ? 'Partial' : 'Complete'}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showDebug ? <DebugPanel snapshot={debugSnapshot} busy={busy} onRefresh={onRefreshDebug} /> : null}
    </div>
  );
}

function CategoryPanel({
  detail,
  busy,
  onRefresh,
  onDelete,
  onMutate,
  onLoadStore,
  onExport
}: {
  detail: CategoryDetail;
  busy: boolean;
  onRefresh: () => void;
  onDelete: (key: string) => void;
  onMutate: (action: Parameters<typeof extensionApi.runMutation>[1]) => Promise<void>;
  onLoadStore: (dbName: string, storeName: string) => void;
  onExport: () => void;
}) {
  const storeEntries = detail.id === 'indexeddb' && detail.previewMode === 'tree' ? detail.entries : [];

  return (
    <div className="sd-grid">
      <div className="sd-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <div>
            <strong style={{ fontSize: 22 }}>{detail.summary.label}</strong>
            <div className="sd-subtle" style={{ marginTop: 6 }}>{detail.summary.warnings.join(' ') || 'No category warnings.'}</div>
          </div>
          <div className="sd-actions">
            <StatusPill value={detail.summary.accessState} />
            <button className="sd-button" onClick={onRefresh} disabled={busy}>Refresh</button>
            <button className="sd-button primary" onClick={onExport} disabled={busy}>Export only this</button>
          </div>
        </div>

        {storeEntries.length > 0 ? (
          <div className="sd-grid cols-2" style={{ marginBottom: 18 }}>
            {storeEntries.map((entry) => (
              <button key={entry.id} className="sd-category" onClick={() => onLoadStore(String(entry.metadata?.dbName), String(entry.metadata?.storeName))}>
                <div style={{ textAlign: 'left' }}>
                  <strong>{entry.key}</strong>
                  <div className="sd-subtle">{entry.valuePreview}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <DataTable detail={detail} onDelete={detail.summary.mutationCapabilities.includes('delete') ? onDelete : undefined} />
        )}
      </div>

      {/* Keyed so a half-typed key from another category/store isn't carried over. */}
      <MutationForm key={`${detail.id}:${String(detail.metadata?.dbName ?? '')}:${String(detail.metadata?.storeName ?? '')}`} detail={detail} onSubmit={onMutate} disabled={busy} />
    </div>
  );
}

function HistoryPanel({
  history,
  onDelete
}: {
  history: Array<Awaited<ReturnType<typeof extensionApi.getHistory>>['items'][number]>;
  onDelete: (historyId: string) => void;
}) {
  return (
    <div className="sd-panel">
      <strong>Export history</strong>
      {history.length === 0 ? (
        <div className="sd-empty">No stored export metadata.</div>
      ) : (
        <div className="sd-table-wrap" style={{ marginTop: 16 }}>
          <table className="sd-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Origin</th>
                <th>Created</th>
                <th>Size</th>
                <th>Checksum</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td>{item.fileName}</td>
                  <td>{item.origin}</td>
                  <td>{formatRelativeTime(item.createdAt)}</td>
                  <td>{formatBytes(item.totalSizeBytes)}</td>
                  <td className="sd-code">{item.checksum.slice(0, 16)}…</td>
                  <td>
                    <button className="sd-button danger" onClick={() => onDelete(item.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingsPanel({
  settings,
  onSave,
  busy
}: {
  settings: typeof DEFAULT_SETTINGS;
  onSave: (settings: typeof DEFAULT_SETTINGS) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  return (
    <div className="sd-panel">
      <strong>Settings</strong>
      <div className="sd-grid cols-2" style={{ marginTop: 16 }}>
        <ToggleField label="Pretty JSON" checked={draft.prettyPrint} onChange={(checked) => setDraft({ ...draft, prettyPrint: checked })} />
        <ToggleField label="Include metadata" checked={draft.includeMetadata} onChange={(checked) => setDraft({ ...draft, includeMetadata: checked })} />
        <ToggleField label="Split large files" checked={draft.splitLargeFiles} onChange={(checked) => setDraft({ ...draft, splitLargeFiles: checked })} />
        <ToggleField label="Skip binary bodies" checked={draft.skipBinaryBodies} onChange={(checked) => setDraft({ ...draft, skipBinaryBodies: checked })} />
        <ToggleField label="Mask sensitive values" checked={draft.maskSensitiveValues} onChange={(checked) => setDraft({ ...draft, maskSensitiveValues: checked })} />
        <ToggleField label="Auto scan on popup open" checked={draft.autoScanOnOpen} onChange={(checked) => setDraft({ ...draft, autoScanOnOpen: checked })} />
        <ToggleField label="Retain export history" checked={draft.retainExportHistory} onChange={(checked) => setDraft({ ...draft, retainExportHistory: checked })} />
      </div>

      <div className="sd-grid cols-2" style={{ marginTop: 16 }}>
        <label className="sd-field">
          <span>Default export format</span>
          <select value={draft.defaultFormat} onChange={(event) => setDraft({ ...draft, defaultFormat: event.target.value as 'json' | 'zip' })}>
            <option value="zip">ZIP bundle</option>
            <option value="json">JSON manifest</option>
          </select>
        </label>
      </div>

      <div className="sd-actions" style={{ marginTop: 16 }}>
        <button className="sd-button primary" onClick={() => void onSave(draft)} disabled={busy}>
          Save settings
        </button>
      </div>
    </div>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="sd-panel">
      <div className="sd-subtle">{label}</div>
      <div style={{ fontSize: 32, fontWeight: 900, margin: '8px 0' }}>{value}</div>
      <div className="sd-subtle">{helper}</div>
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="sd-field">
      <span>{label}</span>
      <select value={checked ? 'yes' : 'no'} onChange={(event) => onChange(event.target.value === 'yes')}>
        <option value="yes">Enabled</option>
        <option value="no">Disabled</option>
      </select>
    </label>
  );
}
