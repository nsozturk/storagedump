import { useEffect, useState } from 'react';

import { DEFAULT_SETTINGS } from '@/shared/constants';
import { extensionApi } from '@/ui/lib/api';

export function OptionsApp() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void extensionApi.getSettings().then((loaded) => setSettings(loaded));
  }, []);

  async function save() {
    const next = await extensionApi.saveSettings(settings);
    setSettings(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="sd-app">
      <div className="sd-shell">
        <header className="sd-topbar">
          <div className="sd-brand">
            <div className="sd-brand-mark">SD</div>
            <div>
              <div style={{ fontWeight: 900 }}>StorageDump Settings</div>
              <div className="sd-subtle">Local-only extension defaults</div>
            </div>
          </div>
          {saved ? <div className="sd-pill granted">Saved</div> : null}
        </header>

        <main className="sd-main" style={{ flexDirection: 'column' }}>
          <div className="sd-panel">
            <div className="sd-grid cols-2">
              <label className="sd-field">
                <span>Default export format</span>
                <select value={settings.defaultFormat} onChange={(event) => setSettings({ ...settings, defaultFormat: event.target.value as 'json' | 'zip' })}>
                  <option value="zip">ZIP bundle</option>
                  <option value="json">JSON manifest</option>
                </select>
              </label>
            </div>

            <div className="sd-grid cols-2" style={{ marginTop: 16 }}>
              {(
                [
                  ['prettyPrint', 'Pretty print JSON'],
                  ['includeMetadata', 'Include metadata'],
                  ['splitLargeFiles', 'Split large files'],
                  ['skipBinaryBodies', 'Skip binary bodies'],
                  ['maskSensitiveValues', 'Mask sensitive values'],
                  ['autoScanOnOpen', 'Auto scan on popup open'],
                  ['retainExportHistory', 'Retain export history']
                ] as const
              ).map(([key, label]) => (
                <label className="sd-field" key={key}>
                  <span>{label}</span>
                  <select
                    value={settings[key] ? 'yes' : 'no'}
                    onChange={(event) => setSettings({ ...settings, [key]: event.target.value === 'yes' })}
                  >
                    <option value="yes">Enabled</option>
                    <option value="no">Disabled</option>
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="sd-panel">
            <strong>Privacy statement</strong>
            <div className="sd-summary-row">
              <span className="sd-subtle">What leaves the browser?</span>
              <span>Nothing, unless you explicitly export a file locally.</span>
            </div>
            <div className="sd-summary-row">
              <span className="sd-subtle">Stored by the extension</span>
              <span>Settings and export history metadata only.</span>
            </div>
          </div>
        </main>

        <footer className="sd-footer">
          <div className="sd-actions">
            <button className="sd-button primary" onClick={() => void save()}>
              Save settings
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
