/**
 * @jest-environment node
 */
import { JSDOM } from 'jsdom';
import { composerHtml } from '../composerEditorHtml';

// WebKit drew the caret far to the right of a trailing emote in the composer,
// as if invisible text followed it. These cover the zero-width caret anchor
// and the trailing space that fix it, run against the real editor script.

const ANCHOR = '​';

type Posted = { type: string; value: string };

function mountEditor() {
  const html = composerHtml('Message', '#fff', '#888', '#7c5cff');
  const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.indexOf('</script>'));
  const dom = new JSDOM('<!doctype html><body><div id="editor" contenteditable="true"></div></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  const document = win.document;

  const frames: Array<(time: number) => void> = [];
  const posts: Posted[] = [];
  const globals = win as unknown as Record<string, unknown>;
  globals.ReactNativeWebView = { postMessage: (message: string) => posts.push(JSON.parse(message)) };
  globals.requestAnimationFrame = (cb: (time: number) => void) => frames.push(cb);
  // jsdom has no innerText; the editor only needs its text.
  Object.defineProperty(win.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return this.textContent; },
  });
  win.eval(script);

  const editor = document.getElementById('editor') as HTMLDivElement;
  const flush = () => { while (frames.length) frames.shift()!(0); };
  const composer = (win as unknown as {
    CatRealmComposer: {
      setText: (value: string) => void;
      insertExpression: (token: string, url: string, name: string, isSticker: boolean) => void;
    };
  }).CatRealmComposer;
  // Empty text nodes (left when the DOM splits text at an edge) do not render, so they are ignored.
  const nodes = () => [...editor.childNodes]
    .filter((n) => !(n.nodeType === 3 && n.textContent === ''))
    .map((n) => (n.nodeName === 'IMG' ? '<img>' : n.nodeName === 'BR' ? '<br>' : n.textContent));
  const sent = () => posts[posts.length - 1]?.value;
  const selection = () => win.getSelection()!;
  const placeCaret = (node: Node, offset: number) => {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    selection().removeAllRanges();
    selection().addRange(range);
  };
  const input = () => { editor.dispatchEvent(new win.Event('input')); flush(); };
  const textNode = (text: string) => [...editor.childNodes].find((n) => n.nodeType === 3 && n.textContent === text)!;
  const text = (value: string) => document.createTextNode(value);
  const backspace = () => {
    const event = new win.InputEvent('beforeinput', { inputType: 'deleteContentBackward', cancelable: true });
    editor.dispatchEvent(event);
    flush();
    return event.defaultPrevented;
  };
  return { editor, composer, flush, nodes, sent, placeCaret, input, textNode, text, selection, backspace };
}

describe('composer editor emotes', () => {
  test('a picked emote is followed by a space for the caret', () => {
    const { composer, flush, nodes, sent } = mountEditor();
    composer.insertExpression(':cat:', 'https://realm.test/cat.png', 'cat', false);
    flush();
    expect(nodes()).toEqual(['<img>', ' ']);
    expect(sent()).toBe(':cat: ');
  });

  test('no extra space before existing whitespace, but one before a letter s', () => {
    const { editor, composer, flush, nodes, placeCaret, text } = mountEditor();
    editor.appendChild(text(' after'));
    placeCaret(editor.firstChild!, 0);
    composer.insertExpression(':cat:', 'https://realm.test/cat.png', 'cat', false);
    flush();
    expect(nodes()).toEqual(['<img>', ' after']);

    editor.innerHTML = '';
    editor.appendChild(text('sad'));
    placeCaret(editor.firstChild!, 0);
    composer.insertExpression(':cat:', 'https://realm.test/cat.png', 'cat', false);
    flush();
    expect(nodes()).toEqual(['<img>', ' ', 'sad']);
  });

  test('a trailing emote gets a zero-width anchor that is never sent', () => {
    const { composer, flush, nodes, sent, placeCaret, input, textNode } = mountEditor();
    composer.insertExpression(':cat:', 'https://realm.test/cat.png', 'cat', false);
    flush();
    const space = textNode(' ');
    space.textContent = '';
    placeCaret(space, 0);
    input();
    expect(nodes()).toEqual(['<img>', ANCHOR]);
    expect(sent()).toBe(':cat:');
  });

  test('typing after the emote removes the anchor and keeps the caret', () => {
    const { composer, flush, nodes, sent, placeCaret, input, textNode, selection } = mountEditor();
    composer.insertExpression(':cat:', 'https://realm.test/cat.png', 'cat', false);
    flush();
    textNode(' ').textContent = '';
    input();
    const anchor = textNode(ANCHOR);
    anchor.textContent = 'hi' + ANCHOR;
    placeCaret(anchor, 2);
    input();
    expect(nodes()).toEqual(['<img>', 'hi']);
    expect(sent()).toBe(':cat:hi');
    expect(selection().anchorOffset).toBe(2);
  });

  test('one backspace from the anchor deletes the emote and empties the editor', () => {
    const { editor, composer, flush, sent, placeCaret, input, textNode, backspace } = mountEditor();
    composer.insertExpression(':cat:', 'https://realm.test/cat.png', 'cat', false);
    flush();
    textNode(' ').textContent = '';
    input();
    placeCaret(textNode(ANCHOR), 1);
    expect(backspace()).toBe(true);
    expect(editor.childNodes.length).toBe(0);
    expect(sent()).toBe('');
  });
});
