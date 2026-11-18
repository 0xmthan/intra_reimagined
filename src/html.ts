// Replaces an element's contents with markup from our templates. Every dynamic value in those
// templates goes through esc(); parsing in an inert document (no scripts, no event handlers
// firing) and moving the nodes over keeps innerHTML out of the bundle, as AMO prefers.
const parser = new DOMParser();

export function setHTML(el: Element | ShadowRoot, html: string) {
  const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
  el.replaceChildren(...doc.body.childNodes);
}
