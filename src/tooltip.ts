// Hover tooltips for elements we add after intra has initialised its own tooltips.
//  - 'intra': same Bootstrap 3 markup as intra, so intra's CSS styles it identically.
//  - 'v3':    the boxed style profile-v3 uses (see .ir-v3-tooltip in styles.css).

type Style = 'intra' | 'v3';

export function addTooltip(
  el: HTMLElement,
  lines: string | string[],
  { placement = 'top', style = 'intra' }: { placement?: 'top' | 'bottom'; style?: Style } = {},
) {
  el.removeAttribute('title'); // avoid the native browser tooltip showing as well
  const text = Array.isArray(lines) ? lines : [lines];

  let tip: HTMLElement | undefined;
  const hide = () => {
    tip?.remove();
    tip = undefined;
  };
  el.addEventListener('mouseenter', () => {
    hide();
    tip = document.createElement('div');
    let content: HTMLElement;
    if (style === 'intra') {
      tip.className = `tooltip fade ${placement} in`;
      tip.setAttribute('role', 'tooltip');
      tip.innerHTML = '<div class="tooltip-arrow"></div><div class="tooltip-inner"></div>';
      content = tip.querySelector('.tooltip-inner')!;
      tip.style.cssText = 'position:absolute;top:0;left:0;display:block;';
    } else {
      tip.className = 'ir-v3-tooltip';
      tip.setAttribute('role', 'tooltip');
      content = tip;
    }
    for (const line of text) {
      const div = document.createElement('div');
      div.textContent = line;
      content.appendChild(div);
    }
    document.body.appendChild(tip);

    const gap = style === 'v3' ? 6 : 0;
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const top = placement === 'top' ? r.top - t.height - gap : r.bottom + gap;
    const left = Math.min(Math.max(4, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 4);
    tip.style.top = `${top + window.scrollY}px`;
    tip.style.left = `${left + window.scrollX}px`;
  });
  el.addEventListener('mouseleave', hide);
}
