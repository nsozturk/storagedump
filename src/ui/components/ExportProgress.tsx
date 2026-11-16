import { useEffect, useState } from 'react';

import type { ExportJobStatus } from '@/shared/types';

function elapsed(startedAt: number | undefined, now: number): string {
  const seconds = Math.max(0, Math.floor((now - (startedAt ?? now)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// The bar keeps moving and a clock ticks while an export runs, so a long step never looks frozen.
export function ExportProgress({ job }: { job: ExportJobStatus }) {
  const [now, setNow] = useState(Date.now());
  const running = job.state === 'running';

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <section className="sd-panel tight">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <strong>Export status</strong>
          <div className="sd-subtle">{job.currentTask}</div>
          {job.state === 'failed' && job.error ? <div style={{ marginTop: 4, color: '#f87171' }}>{job.error}</div> : null}
          {job.state === 'completed' ? (
            <div className="sd-subtle" style={{ marginTop: 4 }}>
              {job.problemCount
                ? `${job.problemCount} problem(s) were recorded in export-report.json inside the export.`
                : 'Everything was read. Details are in export-report.json.'}
            </div>
          ) : null}
        </div>
        {/* Own label: the access-state pill said "readable" for a finished export. */}
        <span className={`sd-pill ${job.state === 'completed' ? (job.problemCount ? 'partial' : 'readable') : job.state === 'failed' ? 'failed' : 'partial'}`} style={{ alignSelf: 'flex-start' }}>
          {job.state === 'completed' ? 'done' : job.state}
        </span>
      </div>
      <div className={`sd-progress ${running ? 'is-running' : ''}`}>
        <div style={{ width: `${job.progress}%` }} />
      </div>
      {running ? (
        <div className="sd-subtle" style={{ marginTop: 8, fontSize: 12 }}>
          Working… {elapsed(job.startedAt, now)} · Safe to close this popup: the export keeps running.
        </div>
      ) : null}
    </section>
  );
}
