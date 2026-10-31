// hCaptcha runs in a WebView whose base URL is the web app's origin, so the
// site key's allowed-domain check passes the same way it does on catrealm.app.
export const HCAPTCHA_BASE_URL = 'https://catrealm.app';

export type CaptchaMessage =
  | { type: 'token'; token: string }
  | { type: 'expired' }
  | { type: 'error'; error: string };

export function buildCaptchaHtml(siteKey: string): string {
  // JSON keeps the key a string literal; escaping '<' stops it closing the script tag.
  const key = JSON.stringify(siteKey).replace(/</g, '\\u003c');
  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;height:100%;background:transparent}body{display:flex;align-items:center;justify-content:center}</style>
<script>
function send(m){window.ReactNativeWebView.postMessage(JSON.stringify(m))}
function onCaptchaLoad(){
  hcaptcha.render('captcha',{sitekey:${key},theme:'dark',
    callback:function(t){send({type:'token',token:t})},
    'expired-callback':function(){send({type:'expired'})},
    'chalexpired-callback':function(){send({type:'expired'})},
    'error-callback':function(e){send({type:'error',error:String(e)})}});
}
</script>
<script src="https://js.hcaptcha.com/1/api.js?onload=onCaptchaLoad&render=explicit" async defer onerror="send({type:'error',error:'load-failed'})"></script>
</head><body><div id="captcha"></div></body></html>`;
}

export function parseCaptchaMessage(raw: string): CaptchaMessage | null {
  try {
    const msg: unknown = JSON.parse(raw);
    if (!msg || typeof msg !== 'object') return null;
    const { type, token, error } = msg as { type?: unknown; token?: unknown; error?: unknown };
    if (type === 'token' && typeof token === 'string' && token) return { type, token };
    if (type === 'expired') return { type };
    if (type === 'error') return { type, error: typeof error === 'string' ? error : 'unknown' };
    return null;
  } catch {
    return null;
  }
}
