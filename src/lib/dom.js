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

// Tags that are always stripped from sanitised output
const DANGEROUS_TAGS = 'script, iframe, object, embed';

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
  const trimmed = htmlString.trimStart();

  // Detect table-fragment HTML that DOMParser would discard
  const isTableFragment = /^<(tr|td|th)[\s>]/i.test(trimmed);
  const isOptionFragment = /^<option[\s>]/i.test(trimmed);

  let wrapped = htmlString;
  if (isTableFragment) {
    wrapped = `<table><tbody>${htmlString}</tbody></table>`;
  } else if (isOptionFragment) {
    wrapped = `<select>${htmlString}</select>`;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(wrapped, 'text/html');

  // 1. Strip dangerous tags
  doc.querySelectorAll(DANGEROUS_TAGS).forEach(el => el.remove());

  // 2. Strip ONLY dangerous attributes — everything else is preserved
  doc.querySelectorAll('*').forEach(el => {
    for (let i = el.attributes.length - 1; i >= 0; i--) {
      const attr = el.attributes[i];
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();

      // Remove event-handler attributes (onclick, onerror, onload …)
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }

      // Remove javascript: protocol in any attribute value
      if (value.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
        continue;
      }
    }
  });

  // 3. Build a DocumentFragment from the correct source nodes
  const fragment = document.createDocumentFragment();

  if (isTableFragment) {
    const tbody = doc.querySelector('tbody');
    if (tbody) {
      Array.from(tbody.childNodes).forEach(node => fragment.appendChild(node));
    }
  } else if (isOptionFragment) {
    const select = doc.querySelector('select');
    if (select) {
      Array.from(select.childNodes).forEach(node => fragment.appendChild(node));
    }
  } else {
    Array.from(doc.body.childNodes).forEach(node => fragment.appendChild(node));
  }

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
