// Script-ready views of an export: the formats local scripts otherwise rebuild by
// hand from cookies.json (Cookie header, Netscape cookies.txt, curl, Playwright).

export interface CookieRecord {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  hostOnly?: boolean;
  session?: boolean;
  sameSite?: string;
  expirationDate?: number;
}

export interface OriginStorage {
  origin: string;
  entries: Array<{ key: string; value: string }>;
}

/** Cookies the browser would send with a request to `url`, most specific path first. */
export function cookiesForUrl(cookies: CookieRecord[], url: string): CookieRecord[] {
  const { protocol, pathname } = new URL(url);
  const matchesPath = (cookiePath: string) =>
    pathname === cookiePath || pathname.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`);
  return cookies
    .filter((cookie) => (protocol === 'https:' || !cookie.secure) && matchesPath(cookie.path || '/'))
    .sort((a, b) => b.path.length - a.path.length);
}

export function cookieHeader(cookies: CookieRecord[], url: string): string {
  return cookiesForUrl(cookies, url)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export function curlCommand(cookies: CookieRecord[], url: string): string {
  return `curl ${shellQuote(url)} -H ${shellQuote(`Cookie: ${cookieHeader(cookies, url)}`)}`;
}

/** Netscape cookies.txt, as read by curl -b, wget and yt-dlp. Every cookie, any path. */
export function netscapeCookies(cookies: CookieRecord[]): string {
  const lines = cookies.map((cookie) => {
    const domain = cookie.hostOnly === false && !cookie.domain.startsWith('.') ? `.${cookie.domain}` : cookie.domain;
    return [
      `${cookie.httpOnly ? '#HttpOnly_' : ''}${domain}`,
      domain.startsWith('.') ? 'TRUE' : 'FALSE',
      cookie.path || '/',
      cookie.secure ? 'TRUE' : 'FALSE',
      cookie.session || cookie.expirationDate == null ? '0' : String(Math.round(cookie.expirationDate)),
      cookie.name,
      cookie.value
    ].join('\t');
  });
  return ['# Netscape HTTP Cookie File', '# Exported by StorageDump. Treat this file as a password.', ...lines, ''].join('\n');
}

const SAME_SITE: Record<string, 'Strict' | 'Lax' | 'None'> = { strict: 'Strict', lax: 'Lax', no_restriction: 'None' };

/** Playwright `storageState`: browser.newContext({ storageState: 'playwright-storage-state.json' }). */
export function playwrightStorageState(cookies: CookieRecord[], origins: OriginStorage[]) {
  return {
    cookies: cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      expires: cookie.session || cookie.expirationDate == null ? -1 : cookie.expirationDate,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: SAME_SITE[cookie.sameSite ?? ''] ?? 'Lax'
    })),
    origins: origins
      .filter((frame) => /^https?:\/\//.test(frame.origin) && frame.entries.length > 0)
      .map((frame) => ({
        origin: frame.origin,
        localStorage: frame.entries.map((entry) => ({ name: entry.key, value: entry.value }))
      }))
  };
}
