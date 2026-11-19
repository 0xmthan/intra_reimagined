/** The logged-in user's login, from intra's account menu (wherever topbar.ts has put it). */
export function myLogin(): string | undefined {
  return document.querySelector<HTMLElement>('a[data-toggle="dropdown"] [data-login]')?.dataset.login?.trim() || undefined;
}

const ME_KEY = 'intra-reimagined:me';

/** Your login from the last page that showed it (synchronous, so usable before the page loads). */
export function rememberedLogin(): string | undefined {
  try {
    return localStorage.getItem(ME_KEY) || undefined;
  } catch {
    return undefined;
  }
}

/** Keeps rememberedLogin() current; returns your login if the page shows it. */
export function rememberLogin(): string | undefined {
  const me = myLogin();
  try {
    if (me && localStorage.getItem(ME_KEY) !== me) localStorage.setItem(ME_KEY, me);
  } catch {
    /* not remembered: the redirect waits for the page instead */
  }
  return me;
}

/** /users/<login> (exactly: not its sub-pages) is that login's public profile page. */
export const isOwnProfilePath = (login: string | undefined, path = location.pathname) =>
  !!login && new RegExp(`^/users/${login.replace(/[^a-z0-9-]/gi, '')}/?$`, 'i').test(path);
