const { contextBridge, ipcRenderer } = require('electron');

// This bridge belongs only to the isolated, hosted captcha window. The main
// process also checks the sending frame and URL before accepting a result.
if (process.isMainFrame && location.origin === 'https://catrealm.app' && location.pathname === '/desktop-captcha/') {
  contextBridge.exposeInMainWorld('catrealmCaptcha', {
    complete: (token) => ipcRenderer.send('desktop-captcha-result', token),
    cancel: () => ipcRenderer.send('desktop-captcha-cancel'),
  });
}
