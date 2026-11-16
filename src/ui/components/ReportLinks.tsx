// "Report a problem": opens a prefilled email or GitHub issue with what is needed
// to reproduce. Never include the inspected site's address or any stored value.
const REPORT_EMAIL = 'support@lamma.dev';
const REPORT_ISSUES_URL = 'https://github.com/nsozturk/storagedump/issues/new';

function openReport(channel: 'email' | 'github', surface: string, lastError?: string | null) {
  const chromeVersion = (navigator.userAgent.match(/Chrome\/([\d.]+)/) ?? [])[1] ?? 'unknown';
  // Errors can quote a URL (e.g. a cache entry): keep only the text before it.
  const safeError = lastError ? lastError.replace(/https?:\/\/\S+/g, '<url>').slice(0, 300) : '(none shown)';
  const title = lastError ? `Error: ${safeError.slice(0, 80)}` : 'Problem report';
  const body = [
    `Extension version: ${chrome.runtime.getManifest().version}`,
    `Chrome: ${chromeVersion}`,
    `Where: ${surface}`,
    `Error: ${safeError}`,
    '',
    'What did you do, and what happened?',
    ''
  ].join('\n');
  const url =
    channel === 'github'
      ? `${REPORT_ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
      : `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(`StorageDump: ${title}`)}&body=${encodeURIComponent(body)}`;
  void chrome.tabs.create({ url });
}

export function ReportLinks({ surface, lastError, label = 'Report a problem:' }: { surface: string; lastError?: string | null; label?: string }) {
  return (
    <span className="sd-report sd-subtle">
      {label}{' '}
      <button type="button" className="sd-link" onClick={() => openReport('email', surface, lastError)}>
        Email
      </button>
      {' · '}
      <button type="button" className="sd-link" onClick={() => openReport('github', surface, lastError)}>
        GitHub
      </button>
    </span>
  );
}
