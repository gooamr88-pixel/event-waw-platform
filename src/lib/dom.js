/**
 * src/lib/dom.js
 * Secure DOM Manipulation Utility
 */

export function safeHTML(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  
  // 1. Strip dangerous tags
  const scripts = doc.querySelectorAll('script, iframe, object, embed, form');
  scripts.forEach(s => s.remove());
  
  // 2. Strip dangerous inline attributes (e.g., onerror, onclick, javascript:href)
  const allElements = doc.querySelectorAll('*');
  allElements.forEach(el => {
    for (let i = el.attributes.length - 1; i >= 0; i--) {
      const attr = el.attributes[i];
      if (attr.name.startsWith('on') || attr.value.trim().toLowerCase().startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  });

  // 3. Return as a safe DocumentFragment ready for appending
  const fragment = document.createDocumentFragment();
  Array.from(doc.body.childNodes).forEach(node => fragment.appendChild(node));
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
