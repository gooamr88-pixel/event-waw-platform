/**
 * ESLint v9.0.0 Flat Configuration File
 * Configure standard browser environments and ES Module parsing
 */

export default [
  {
    files: ["src/**/*.js", "js/**/*.js", "sw.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        // Standard Browser Globals
        window: "readonly",
        document: "readonly",
        console: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Blob: "readonly",
        File: "readonly",
        Image: "readonly",
        AudioContext: "readonly",
        webkitAudioContext: "readonly",
        navigator: "readonly",
        location: "readonly",
        history: "readonly",
        alert: "readonly",
        confirm: "readonly",
        
        // Node / Process Globals for build tools
        process: "readonly",
        
        // ES6+ Globals
        Promise: "readonly",
        Map: "readonly",
        Set: "readonly",
        WeakMap: "readonly",
        WeakSet: "readonly",
        Symbol: "readonly",
        Reflect: "readonly",
        Proxy: "readonly",

        // Additional Browser APIs
        HTMLElement: "readonly",
        MutationObserver: "readonly",
        IntersectionObserver: "readonly",
        FormData: "readonly",
        CustomEvent: "readonly",
        AbortController: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        structuredClone: "readonly",
        crypto: "readonly",
        self: "readonly",
        caches: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        Event: "readonly",
        EventTarget: "readonly",
        performance: "readonly",
        ResizeObserver: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-console": "off",
      "no-empty": "warn",
      "no-constant-condition": "warn",
      "no-eval": "error",
      "no-implied-eval": "error",
      "eqeqeq": ["warn", "smart"],
      "no-debugger": "warn"
    }
  }
];
