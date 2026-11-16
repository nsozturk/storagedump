import { startTransition, useEffect, useMemo, useState } from 'react';

import type { ExportJobStatus, ScanResult } from '@/shared/types';
import { formatBytes, formatNumber } from '@/shared/utils/format';
import { CategoryList } from '@/ui/components/CategoryList';
import { DebugPanel } from '@/ui/components/DebugPanel';
import { ExportProgress } from '@/ui/components/ExportProgress';
import { ReportLinks } from '@/ui/components/ReportLinks';
import { useWhatsNew, WhatsNewCard } from '@/ui/components/WhatsNew';
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
        // null: the service worker restarted and forgot the job
        setExportJob(latest ?? { ...exportJob, state: 'failed', progress: 100, currentTask: 'Export interrupted', error: 'StorageDump restarted before the export finished. Start it again.' });
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
  const whatsNew = useWhatsNew();
  // chrome://, the Web Store, PDFs…: nothing here can work, so say that instead of a wall of "restricted".
  const restrictedPage = scan?.categories.find((category) => category.id === 'local')?.permissionState === 'restricted';

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
          maskSensitiveValues: settings?.maskSensitiveValues ?? false,
          scriptFormats: settings?.scriptFormats ?? true
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
          {whatsNew.open ? <WhatsNewCard onClose={whatsNew.close} /> : null}

          {restrictedPage ? (
            <div className="sd-notice">
              <strong>StorageDump can't read this page</strong>
              <span className="sd-subtle">
                Browser pages (chrome://), the Chrome Web Store and built-in viewers are off limits to extensions. Open a
                website (http or https) and click the icon again.
              </span>
            </div>
          ) : null}

          <section className="sd-panel" hidden={restrictedPage}>
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

          {error ? (
            <div className="sd-banner">
              <div>{error}</div>
              <ReportLinks surface="popup" lastError={error} label="Report this error:" />
            </div>
          ) : null}

          {exportJob ? <ExportProgress job={exportJob} /> : null}

          <section hidden={restrictedPage}>
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
            <button className="sd-button primary" onClick={() => void startExportAll()} disabled={!scan || busy || restrictedPage}>
              Export all
            </button>
          </div>
          <button className="sd-button" onClick={() => void extensionApi.openDashboard()}>
            Dashboard
          </button>
        </footer>
        <div className="sd-popup-meta">
          <span className="sd-subtle">v{chrome.runtime.getManifest().version}</span>
          <button type="button" className="sd-link" onClick={whatsNew.show}>
            What's new
          </button>
          <ReportLinks surface="popup" lastError={error} />
        </div>
      </div>
    </div>
  );
}
