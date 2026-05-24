import { safeHTML, setSafeHTML } from '../../src/lib/dom.js';

describe('safeHTML DOM Sanitizer & XSS Prevention', () => {
  test('should strip dangerous HTML tags', () => {
    const dirty = '<div>Hello <script>alert("XSS")</script> <iframe src="unsafe.html"></iframe> World</div>';
    const fragment = safeHTML(dirty);
    
    // Create a container to check serialized output
    const container = document.createElement('div');
    container.appendChild(fragment.cloneNode(true));
    
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('Hello');
    expect(container.textContent).toContain('World');
  });

  test('should strip inline event handler attributes (on*)', () => {
    const dirty = '<button class="btn" onclick="alert(1)" onerror="log()" onload="init()">Click me</button>';
    const fragment = safeHTML(dirty);
    
    const container = document.createElement('div');
    container.appendChild(fragment.cloneNode(true));
    
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(button.getAttribute('class')).toBe('btn');
    expect(button.getAttribute('onclick')).toBeNull();
    expect(button.getAttribute('onerror')).toBeNull();
    expect(button.getAttribute('onload')).toBeNull();
  });

  test('should strip dangerous protocol schemes (javascript:, vbscript:, blob:)', () => {
    const dirty = `
      <div>
        <a id="js-link" href="javascript:alert(1)">Link 1</a>
        <a id="vb-link" href="vbscript:msgbox(1)">Link 2</a>
        <a id="blob-link" href="blob:https://example.com/uuid">Link 3</a>
        <a id="safe-link" href="https://eventsli.com">Safe Link</a>
      </div>
    `;
    const fragment = safeHTML(dirty);
    
    const container = document.createElement('div');
    container.appendChild(fragment.cloneNode(true));
    
    expect(container.querySelector('#js-link').getAttribute('href')).toBeNull();
    expect(container.querySelector('#vb-link').getAttribute('href')).toBeNull();
    expect(container.querySelector('#blob-link').getAttribute('href')).toBeNull();
    expect(container.querySelector('#safe-link').getAttribute('href')).toBe('https://eventsli.com');
  });

  test('should allow data:image/ protocol but block other data: schemes', () => {
    const dirty = `
      <div>
        <img id="qr-code" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
        <a id="unsafe-data" href="data:text/html,<script>alert(1)</script>">Unsafe</a>
      </div>
    `;
    const fragment = safeHTML(dirty);
    
    const container = document.createElement('div');
    container.appendChild(fragment.cloneNode(true));
    
    const img = container.querySelector('#qr-code');
    expect(img.getAttribute('src')).toContain('data:image/png');
    
    const link = container.querySelector('#unsafe-data');
    expect(link.getAttribute('href')).toBeNull();
  });

  test('should preserve standard harmless layout attributes', () => {
    const dirty = '<div id="test-id" class="test-class" style="color: red;" data-event-id="123" colspan="2" rowspan="1">Content</div>';
    const fragment = safeHTML(dirty);
    
    const container = document.createElement('div');
    container.appendChild(fragment.cloneNode(true));
    
    const div = container.querySelector('div');
    expect(div.getAttribute('id')).toBe('test-id');
    expect(div.getAttribute('class')).toBe('test-class');
    expect(div.getAttribute('style')).toBe('color: red;');
    expect(div.getAttribute('data-event-id')).toBe('123');
    expect(div.getAttribute('colspan')).toBe('2');
    expect(div.getAttribute('rowspan')).toBe('1');
  });

  test('setSafeHTML should clear element and insert sanitized content safely', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span class="old">Old Content</span>';
    
    setSafeHTML(container, '<span class="new">New Sanitized Content<script>evil()</script></span>');
    
    expect(container.querySelector('.old')).toBeNull();
    const span = container.querySelector('.new');
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('New Sanitized Content');
    expect(container.querySelector('script')).toBeNull();
  });
});
