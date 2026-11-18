// Pins the 42 logo to the top of the left sidebar.
// intra's logo lives in the top navbar, which scrolls (and trackpad-bounces) with the page while
// the sidebar stays fixed. We move the logo out of the navbar into <body> and start the navbar
// after the sidebar column, so the navbar never slides over the sidebar icons.

export const LOGO_ID = 'ir-logo';

export function pinLogo() {
  const slot = document.querySelector('.main-navbar-logo');
  const logo = slot?.querySelector<HTMLAnchorElement>('a');
  if (!slot || !logo || document.getElementById(LOGO_ID)) return;

  logo.id = LOGO_ID;
  document.body.appendChild(logo);
  document.documentElement.classList.add('ir-logo-pinned');
}
