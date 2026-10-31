const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../src-tauri/injected/passkey-window.js'), 'utf8');

function runWindow(supported) {
  const elements = [];
  const navigations = [];
  const document = {
    readyState: 'complete',
    body: { appendChild() {} },
    createElement(tag) {
      const element = {
        tag, style: { cssText: '' }, events: {}, textContent: '',
        setAttribute() {}, appendChild() {},
        addEventListener(name, callback) { this.events[name] = callback; },
      };
      elements.push(element);
      return element;
    },
  };
  const window = {
    isSecureContext: true,
    PublicKeyCredential: supported ? function PublicKeyCredential() {} : undefined,
    location: {
      href: 'https://catrealm.app/webauthn/register/synthetic?secret=synthetic',
      assign(url) { navigations.push(url); },
    },
  };
  window.top = window;
  const navigator = { credentials: supported ? { get() {}, create() {} } : undefined };
  vm.runInNewContext(script, { window, document, navigator, URL });
  return { elements, navigations };
}

test('supported native WebViews retain the hosted flow and never automatically open a browser', () => {
  const { elements, navigations } = runWindow(true);
  assert.deepEqual(navigations, []);
  assert.equal(elements.some(element => element.textContent.includes('not supported')), false);
  const button = elements.find(element => element.tag === 'button');
  assert.equal(button.textContent, 'Use browser instead');
  button.events.click();
  assert.deepEqual(navigations, ['https://catrealm.app/__catrealm_open_browser']);
});

test('unsupported WebViews explain the limitation and wait for the user to select the browser', () => {
  const { elements, navigations } = runWindow(false);
  assert.deepEqual(navigations, []);
  assert.equal(elements.some(element => element.textContent.includes('Passkeys are not supported')), true);
  const button = elements.find(element => element.tag === 'button');
  assert.equal(button.textContent, 'Continue in browser');
  button.events.click();
  assert.deepEqual(navigations, ['https://catrealm.app/__catrealm_open_browser']);
});
