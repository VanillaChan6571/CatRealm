// This window deliberately has no desktop bridge. WebAuthn runs on the
// hosted HTTPS relying-party origin, never on the local application origin.
(function () {
  'use strict';
  if (window.top !== window) return;
  const showFallback = () => {
    const supported = window.isSecureContext && typeof window.PublicKeyCredential === 'function'
      && typeof navigator.credentials?.get === 'function' && typeof navigator.credentials?.create === 'function';
    const panel = document.createElement('aside');
    panel.setAttribute('aria-label', 'Passkey browser option');
    panel.style.cssText = 'position:fixed;z-index:2147483647;bottom:0;left:0;right:0;padding:12px;background:#1e1f22;color:#f2f3f5;font:14px/1.5 system-ui;text-align:center;border-top:1px solid #444';
    if (!supported) {
      panel.style.cssText += ';top:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px';
      const message = document.createElement('p');
      message.textContent = 'Passkeys are not supported by this system’s in-app browser. Continue in your browser to complete this step, then return to CatRealm.';
      panel.appendChild(message);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = supported ? 'Use browser instead' : 'Continue in browser';
    button.style.cssText = 'padding:8px 16px;background:#5865f2;color:white;border:0;border-radius:6px;cursor:pointer;font:inherit';
    button.addEventListener('click', () => {
      // Intercepted by Rust; this path is never requested over the network.
      window.location.assign(new URL('/__catrealm_open_browser', window.location.href).href);
    });
    panel.appendChild(button);
    document.body.appendChild(panel);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showFallback, { once: true });
  else showFallback();
})();
