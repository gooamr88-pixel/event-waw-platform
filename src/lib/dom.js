/**
 * src/lib/dom.js
 * Secure DOM Manipulation Utility
 */

/**
 * Sanitize an HTML string, stripping dangerous tags and event-handler attributes.
 * Handles table-fragment HTML (e.g. bare <tr>/<td>) that DOMParser would
 * otherwise discard because they are invalid direct children of <body>.
 */
export function safeHTML(htmlString) {
  const trimmed = htmlString.trimStart();

  // Detect table-fragment HTML that DOMParser would strip
  const isTableFragment = /^<tr[\s>]/i.test(trimmed);

  const wrapped = isTableFragment
    ? `<table><tbody>${htmlString}</tbody></table>`
    : htmlString;

  const parser = new DOMParser();
  const doc = parser.parseFromString(wrapped, 'text/html');

  // 1. Strip dangerous tags
  doc.querySelectorAll('script, iframe, object, embed').forEach(s => s.remove());

  // 2. Strip dangerous inline attributes (onerror, onclick, javascript: hrefs)
  doc.querySelectorAll('*').forEach(el => {
    for (let i = el.attributes.length - 1; i >= 0; i--) {
      const attr = el.attributes[i];
      if (attr.name.startsWith('on') || attr.value.trim().toLowerCase().startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  });

  // 3. Build a DocumentFragment from the correct source nodes
  const fragment = document.createDocumentFragment();

  if (isTableFragment) {
    // Extract the <tr> rows out of the wrapper <tbody>
    const tbody = doc.querySelector('tbody');
    if (tbody) {
      Array.from(tbody.childNodes).forEach(node => fragment.appendChild(node));
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
