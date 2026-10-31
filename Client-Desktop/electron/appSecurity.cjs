const { pathToFileURL } = require('node:url');

// Only the bundled application document (or the one development server) may
// use the desktop bridge. Authentication and external pages are separate,
// unprivileged windows, even when CatRealm hosts them.
function createAppSecurity({ indexPath, isDev, devUrl = 'http://localhost:5173' }) {
  const indexUrl = new URL(pathToFileURL(indexPath).href);
  const devOrigin = new URL(devUrl).origin;
  const appContents = new WeakSet();

  function isAppUrl(value) {
    try {
      const url = new URL(value);
      if (url.username || url.password) return false;
      if (isDev) return url.origin === devOrigin;
      return url.protocol === 'file:' && url.host === indexUrl.host && url.pathname === indexUrl.pathname;
    } catch {
      return false;
    }
  }

  function register(webContents) {
    appContents.add(webContents);
  }

  function isAppContents(webContents) {
    return !!webContents && appContents.has(webContents) && !webContents.isDestroyed();
  }

  function isTrustedSender(event) {
    return isAppContents(event?.sender)
      && event.senderFrame === event.sender.mainFrame
      && isAppUrl(event.senderFrame?.url);
  }

  function handle(ipcMain, channel, handler) {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error('Desktop request denied: untrusted application frame.');
      return handler(event, ...args);
    });
  }

  function isMediaRequestAllowed(webContents, details) {
    // The request belongs to a frame, not merely its containing WebContents.
    return isAppContents(webContents)
      && details?.isMainFrame === true
      && isAppUrl(details.requestingUrl || webContents.getURL());
  }

  return { register, isAppUrl, isAppContents, isTrustedSender, handle, isMediaRequestAllowed };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === 'https:' || url.protocol === 'http:');
  } catch {
    return false;
  }
}

function isPasskeyUrl(value, isDev = false) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    const productionOrigin = ['https://auth.catrealm.app', 'https://catrealm.app', 'https://www.catrealm.app'].includes(url.origin);
    const developmentOrigin = isDev && url.origin === 'http://localhost:5173';
    return (productionOrigin || developmentOrigin) && url.pathname.startsWith('/webauthn/');
  } catch {
    return false;
  }
}

function isOverlayHostAllowed(host, port) {
  return typeof host === 'string' && [`127.0.0.1:${port}`, `localhost:${port}`].includes(host.toLowerCase());
}

module.exports = { createAppSecurity, isHttpUrl, isPasskeyUrl, isOverlayHostAllowed };
