/**
 * src/lib/dom.js
 * Secure DOM Manipulation Utility
 *
 * PRESERVES: class, id, style, colspan, rowspan, data-*, src, alt, href,
 *            type, value, placeholder, title, target, rel, width, height,
 *            viewBox, fill, stroke, stroke-width, d, cx, cy, r, x, y,
 *            rx, ry, points, x1, y1, x2, y2, and all other layout attributes.
 *
 * STRIPS:    <script>, <iframe>, <object>, <embed> tags,
 *            on* event handlers (onclick, onerror, onload, etc.),
 *            javascript: protocol in href/src/action values.
 */



/**
 * Sanitize an HTML string, stripping dangerous tags and event-handler
 * attributes while preserving all harmless layout attributes (class, id,
 * style, colspan, data-*, etc.).
 *
 * Handles table-fragment HTML (bare <tr>, <td>, <th>, <option>) that
 * DOMParser would otherwise discard because they are invalid direct
 * children of <body>.
 */
export function safeHTML(htmlString) {
  // <template> safely parses all structural tags (<tr>, <thead>, <td>, <option>) without wrappers
  // and keeps contents strictly inert (preventing execution) until explicitly added to the DOM.
  const template = document.createElement('template');
  template.innerHTML = htmlString;
  const fragment = document.createDocumentFragment();
  fragment.appendChild(template.content.cloneNode(true));

  // 1. Strip dangerous execution tags
  const DANGEROUS_TAGS = 'script, iframe, object, embed';
  fragment.querySelectorAll(DANGEROUS_TAGS).forEach(el => el.remove());

  // 2. Strip dangerous attributes, preserve all others (class, style, id, colspan, src, alt, etc.)
  fragment.querySelectorAll('*').forEach(el => {
    for (let i = el.attributes.length - 1; i >= 0; i--) {
      const attr = el.attributes[i];
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();

      // Remove event handlers (onclick, onerror, onload, etc.)
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }

      // Remove dangerous URI schemes from any attribute value
      // NOTE: 'data:' is intentionally ALLOWED for base64 QR codes and inline images.
      // CSP policy (csp.js) already whitelists data: for img-src.
      if (/^(javascript|vbscript|blob):/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return fragment;
}

export function setSafeHTML(element, htmlString) {
  if (!element) return;
  element.textContent = '';
  element.appendChild(safeHTML(htmlString));
}

export function generateSkeletonRows(columns, rows = 5) {
  return Array(rows).fill(0).map(() => `
    <tr class="ev-skeleton-row">
      ${columns.map(width => `<td><div class="ev-skeleton" style="width: ${width}; height: 20px; border-radius: 4px;"></div></td>`).join('')}
    </tr>
  `).join('');
}
