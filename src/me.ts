/** The logged-in user's login, from intra's account menu (wherever topbar.ts has put it). */
export function myLogin(): string | undefined {
  return document.querySelector<HTMLElement>('a[data-toggle="dropdown"] [data-login]')?.dataset.login?.trim() || undefined;
}
