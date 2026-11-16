import { describe, expect, it } from 'vitest';

import { cookieHeader, curlCommand, netscapeCookies, playwrightStorageState, type CookieRecord } from './scriptFormats';

const base = { secure: true, httpOnly: false, hostOnly: true, session: true };
const cookies: CookieRecord[] = [
  { ...base, name: 'sid', value: 'abc', domain: 'app.example.com', path: '/', httpOnly: true, session: false, expirationDate: 1900000000.7, sameSite: 'lax' },
  { ...base, name: 'api', value: 'x=1', domain: 'app.example.com', path: '/api', sameSite: 'strict' },
  { ...base, name: 'wide', value: "it's", domain: '.example.com', path: '/', hostOnly: false, sameSite: 'no_restriction' },
  { ...base, name: 'plain', value: 'p', domain: 'app.example.com', path: '/', secure: false }
];

describe('script formats', () => {
  it('builds the Cookie header a browser would send to the URL', () => {
    expect(cookieHeader(cookies, 'https://app.example.com/notes')).toBe("sid=abc; wide=it's; plain=p");
    expect(cookieHeader(cookies, 'https://app.example.com/api/v1')).toBe("api=x=1; sid=abc; wide=it's; plain=p");
    expect(cookieHeader(cookies, 'https://app.example.com/apiary')).not.toContain('api=');
    expect(cookieHeader(cookies, 'http://app.example.com/')).toBe('plain=p');
  });

  it('quotes the curl command for a shell', () => {
    expect(curlCommand(cookies, 'https://app.example.com/')).toBe(
      `curl 'https://app.example.com/' -H 'Cookie: sid=abc; wide=it'\\''s; plain=p'`
    );
  });

  it('writes Netscape cookies.txt lines', () => {
    const lines = netscapeCookies(cookies).split('\n');
    expect(lines[0]).toBe('# Netscape HTTP Cookie File');
    expect(lines[2]).toBe('#HttpOnly_app.example.com\tFALSE\t/\tTRUE\t1900000001\tsid\tabc');
    expect(lines[3]).toBe('app.example.com\tFALSE\t/api\tTRUE\t0\tapi\tx=1');
    expect(lines[4]).toBe(".example.com\tTRUE\t/\tTRUE\t0\twide\tit's");
  });

  it('builds a Playwright storage state with raw localStorage strings', () => {
    const state = playwrightStorageState(cookies, [
      { origin: 'https://app.example.com', entries: [{ key: 'n', value: '7123456789012345678' }] },
      { origin: 'null', entries: [{ key: 'ignored', value: '1' }] },
      { origin: 'https://empty.example.com', entries: [] }
    ]);
    expect(state.cookies[0]).toEqual({ name: 'sid', value: 'abc', domain: 'app.example.com', path: '/', expires: 1900000000.7, httpOnly: true, secure: true, sameSite: 'Lax' });
    expect(state.cookies[1].expires).toBe(-1);
    expect(state.cookies.map((c) => c.sameSite)).toEqual(['Lax', 'Strict', 'None', 'Lax']);
    expect(state.origins).toEqual([{ origin: 'https://app.example.com', localStorage: [{ name: 'n', value: '7123456789012345678' }] }]);
  });
});
