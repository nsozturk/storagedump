import type { DebugSnapshot } from '@/shared/types';

function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function DebugPanel({
  snapshot,
  busy,
  onRefresh
}: {
  snapshot: DebugSnapshot | null;
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="sd-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <div>
          <strong>Debug snapshot</strong>
          <div className="sd-subtle">Temporary diagnostics for active tab binding, runtime injection and cookie matching.</div>
        </div>
        <button className="sd-button" onClick={onRefresh} disabled={busy}>
          Refresh debug
        </button>
      </div>

      {!snapshot ? <div className="sd-empty">No debug snapshot loaded yet.</div> : null}

      {snapshot ? (
        <div className="sd-grid">
          <div className="sd-kv">
            <div className="sd-field">
              <span className="sd-subtle">Captured</span>
              <strong>{snapshot.capturedAt}</strong>
            </div>
            <div className="sd-field">
              <span className="sd-subtle">Origin permission</span>
              <strong>{snapshot.originPermission}</strong>
            </div>
            <div className="sd-field">
              <span className="sd-subtle">Tab binding</span>
              <strong>{snapshot.context.tabId} / {snapshot.context.windowId}</strong>
            </div>
              <div className="sd-field">
                <span className="sd-subtle">Page runtime</span>
                <strong>{snapshot.pageRuntime.ready ? 'ready' : 'failed'}</strong>
              </div>
              <div className="sd-field">
                <span className="sd-subtle">Cookie store</span>
                <strong>{snapshot.cookieDebug.storeId ?? 'unknown'}</strong>
              </div>
            </div>

          <div className="sd-debug-block">
            <div className="sd-subtle">Active context</div>
            <pre className="sd-debug-pre">{renderJson(snapshot.context)}</pre>
          </div>

          <div className="sd-debug-block">
            <div className="sd-subtle">Cookie diagnostics</div>
            <pre className="sd-debug-pre">
              {renderJson({
                hostname: snapshot.cookieDebug.hostname,
                siteKey: snapshot.cookieDebug.siteKey,
                storeId: snapshot.cookieDebug.storeId,
                storeTabCount: snapshot.cookieDebug.storeTabCount,
                allVisibleCount: snapshot.cookieDebug.allVisibleCount,
                relatedCount: snapshot.cookieDebug.relatedCount,
                matchedCount: snapshot.cookieDebug.matchedCount,
                note: snapshot.cookieDebug.note
              })}
            </pre>
          </div>

          <div className="sd-debug-block">
            <div className="sd-subtle">Cookie sample</div>
            <pre className="sd-debug-pre">{renderJson(snapshot.cookieDebug.sample)}</pre>
          </div>

          <div className="sd-debug-block">
            <div className="sd-subtle">Scan error</div>
            <pre className="sd-debug-pre">{snapshot.scanError ?? 'none'}</pre>
          </div>

          <div className="sd-debug-block">
            <div className="sd-subtle">Raw scan result</div>
            <pre className="sd-debug-pre">{renderJson(snapshot.scan)}</pre>
          </div>

          {snapshot.pageRuntime.error ? (
            <div className="sd-banner">{snapshot.pageRuntime.error}</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
