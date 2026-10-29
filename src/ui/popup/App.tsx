import { startTransition, useEffect, useMemo, useState } from 'react';

import type { ExportJobStatus, ScanResult } from '@/shared/types';
import { formatBytes, formatNumber } from '@/shared/utils/format';
import { CategoryList } from '@/ui/components/CategoryList';
import { DebugPanel } from '@/ui/components/DebugPanel';
import { StatusPill } from '@/ui/components/StatusPill';
import { extensionApi } from '@/ui/lib/api';
import { deriveAccessState, derivePermissionState, needsOriginPermission } from '@/ui/lib/scanState';

export function PopupApp() {
  const [settings, setSettings] = useState(() => null as Awaited<ReturnType<typeof extensionApi.getSettings>> | null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportJob, setExportJob] = useState<ExportJobStatus | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugSnapshot, setDebugSnapshot] = useState<Awaited<ReturnType<typeof extensionApi.getDebugSnapshot>> | null>(null);

  useEffect(() => {
    void extensionApi.getSettings().then((stored) => {
      setSettings(stored);
      if (stored.autoScanOnOpen) {
        void runScan();
      }
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
        }
      });
    }, 900);

    return () => window.clearInterval(interval);
  }, [exportJob]);

  const stats = useMemo(() => {
    const categories = scan?.categories ?? [];
    return {
      categoryCount: categories.filter((category) => category.detected).length,
      itemCount: categories.reduce((sum, category) => sum + (category.itemCount ?? 0), 0),
      totalSize: categories.reduce((sum, category) => sum + (category.estimatedSizeBytes ?? 0), 0)
    };
  }, [scan]);

  const permissionState = derivePermissionState(scan);
  const accessState = deriveAccessState(scan);

  async function requestOriginPermission() {
    const result = await extensionApi.requestOriginPermissionDirectly();
    if (result.state === 'granted') {
      await runScan();
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

  async function runScan() {
    setBusy(true);
    setError(null);

    try {
      const result = await extensionApi.scanActiveSite();
      if (!result || !Array.isArray(result.categories)) {
        throw new Error('Scan returned an invalid response.');
      }
      startTransition(() => setScan(result));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Scan failed.');
      void loadDebugSnapshot();
    } finally {
      setBusy(false);
    }
  }

  async function startExportAll() {
    if (!scan) {
      return;
    }

    setBusy(true);
    try {
      const job = await extensionApi.startExport(
        {
          categoryIds: scan.categories.map((category) => category.id)
        },
        {
          format: settings?.defaultFormat ?? 'zip',
          prettyPrint: settings?.prettyPrint ?? true,
          includeMetadata: settings?.includeMetadata ?? true,
          includeTimestamps: settings?.includeTimestamps ?? true,
          splitLargeFiles: settings?.splitLargeFiles ?? true,
          splitThresholdBytes: settings?.splitThresholdBytes ?? 1024 * 1024 * 2,
          skipBinaryBodies: settings?.skipBinaryBodies ?? true,
          maskSensitiveValues: settings?.maskSensitiveValues ?? false
        }
      );
      setExportJob(job);
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sd-app sd-popup">
      <div className="sd-shell">
        <header className="sd-topbar">
          <div className="sd-brand">
            <div className="sd-brand-mark">SD</div>
            <div>
              <div style={{ fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>StorageDump</div>
              <div className="sd-subtle">{scan?.origin ?? 'Current site scanner'}</div>
            </div>
          </div>
          {permissionState ? <StatusPill value={permissionState} /> : accessState ? <StatusPill value={accessState} /> : <span className="sd-subtle">Not scanned</span>}
        </header>

        <main className="sd-main" style={{ flexDirection: 'column' }}>
          <section className="sd-panel">
            <div className="sd-grid cols-3">
              <div className="sd-metric">
                <span className="sd-subtle">Categories</span>
                <strong>{formatNumber(stats.categoryCount)}</strong>
              </div>
              <div className="sd-metric">
                <span className="sd-subtle">Items</span>
                <strong>{formatNumber(stats.itemCount)}</strong>
              </div>
              <div className="sd-metric">
                <span className="sd-subtle">Payload</span>
                <strong>{formatBytes(stats.totalSize)}</strong>
              </div>
            </div>
          </section>

          {scan?.permissionWarnings[0] ? (
            <div className="sd-banner">
              {scan.permissionWarnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}

          {error ? <div className="sd-banner">{error}</div> : null}

          {exportJob ? (
            <section className="sd-panel tight">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <strong>Export status</strong>
                  <div className="sd-subtle">{exportJob.currentTask}</div>
                  {exportJob.state === 'failed' && exportJob.error ? (
                    <div className="sd-subtle" style={{ marginTop: 4, color: 'var(--sd-color-failed, #f87171)' }}>
                      {exportJob.error}
                    </div>
                  ) : null}
                </div>
                <StatusPill value={exportJob.state === 'completed' ? 'readable' : exportJob.state === 'failed' ? 'failed' : 'partial'} />
              </div>
              <div style={{ marginTop: 12, height: 10, borderRadius: 999, background: 'rgba(148,163,184,0.12)' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${exportJob.progress}%`,
                    borderRadius: 999,
                    background: 'linear-gradient(90deg, #2563eb, #38bdf8)'
                  }}
                />
              </div>
            </section>
          ) : null}

          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong>Storage categories</strong>
              <div className="sd-actions">
                {needsOriginPermission(scan) ? (
                  <button className="sd-button" onClick={() => void requestOriginPermission()}>
                    Grant access
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
              </div>
            </div>
            <CategoryList categories={scan?.categories ?? []} onGrantPermission={() => requestOriginPermission()} />
          </section>

          {showDebug ? <DebugPanel snapshot={debugSnapshot} busy={busy} onRefresh={() => void loadDebugSnapshot()} /> : null}
        </main>

        <footer className="sd-footer">
          <div className="sd-actions">
            <button className="sd-button" onClick={() => void runScan()} disabled={busy}>
              {busy ? 'Scanning…' : 'Scan'}
            </button>
            <button className="sd-button primary" onClick={() => void startExportAll()} disabled={!scan || busy}>
              Export all
            </button>
          </div>
          <button className="sd-button" onClick={() => void extensionApi.openDashboard()}>
            Dashboard
          </button>
        </footer>
      </div>
    </div>
  );
}
