import { useState } from 'react';

// Shown once after an update; bundled text, no network.
export const WHATS_NEW = {
  version: '0.3.0',
  items: [
    'Exports add for-scripts/: Cookie header, cookies.txt, curl and a Playwright storage state.',
    'New "Folder" format: unzipped files in Downloads/storagedump/<site>/, replaced on every export.',
    'export-report.json lists every read that failed or came back short.',
    'Dashboard: filter, full values, "Load all", and tables that stay on screen.',
    'Step-by-step export progress and "Report a problem" links.'
  ]
};

const SEEN_KEY = 'storagedump.whatsNewSeen';

function seenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function useWhatsNew() {
  const [open, setOpen] = useState(() => seenVersion() !== WHATS_NEW.version);
  return {
    open,
    show: () => setOpen(true),
    close: () => {
      setOpen(false);
      try {
        localStorage.setItem(SEEN_KEY, WHATS_NEW.version);
      } catch {
        // storage blocked: the card simply shows again next time
      }
    }
  };
}

export function WhatsNewCard({ onClose }: { onClose: () => void }) {
  return (
    <section className="sd-panel tight sd-whats-new">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <strong>What's new in {WHATS_NEW.version}</strong>
        <button type="button" className="sd-link" onClick={onClose} aria-label="Close what's new">
          Close
        </button>
      </div>
      <ul>
        {WHATS_NEW.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
