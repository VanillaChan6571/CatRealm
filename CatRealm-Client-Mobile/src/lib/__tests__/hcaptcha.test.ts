import { buildCaptchaHtml, parseCaptchaMessage } from '../hcaptcha';

test('the captcha page embeds the site key as a script-safe string literal', () => {
  const html = buildCaptchaHtml('10000000-ffff-ffff-ffff-000000000001');
  expect(html).toContain('sitekey:"10000000-ffff-ffff-ffff-000000000001"');
  expect(html).toContain('https://js.hcaptcha.com/1/api.js?onload=onCaptchaLoad&render=explicit');

  const hostile = buildCaptchaHtml('"</script><script>alert(1)</script>');
  expect(hostile).not.toContain('</script><script>alert(1)');
  expect(hostile).toContain('\\u003c/script>');
});

test('only well-formed captcha messages are accepted', () => {
  expect(parseCaptchaMessage('{"type":"token","token":"P1_abc"}')).toEqual({ type: 'token', token: 'P1_abc' });
  expect(parseCaptchaMessage('{"type":"token","token":""}')).toBeNull();
  expect(parseCaptchaMessage('{"type":"expired"}')).toEqual({ type: 'expired' });
  expect(parseCaptchaMessage('{"type":"error","error":"network-error"}')).toEqual({ type: 'error', error: 'network-error' });
  expect(parseCaptchaMessage('{"type":"error"}')).toEqual({ type: 'error', error: 'unknown' });
  expect(parseCaptchaMessage('{"type":"other"}')).toBeNull();
  expect(parseCaptchaMessage('not json')).toBeNull();
  expect(parseCaptchaMessage('null')).toBeNull();
});
