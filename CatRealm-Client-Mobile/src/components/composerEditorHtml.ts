/**
 * HTML for the mobile composer's WebView editor: a contenteditable that shows
 * emotes as images and posts its serialized text back to React Native.
 * Kept free of React Native imports so it can be exercised in jsdom tests.
 */

export function composerHtml(placeholder: string, textColor: string, placeholderColor: string, accentColor: string, allowText = true) {
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      background: transparent;
      color: ${textColor};
      font: 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
    }
    #editor {
      display: block;
      width: 100%;
      min-height: 40px;
      box-sizing: border-box;
      padding: 9px 0;
      line-height: 21px;
      outline: none;
      overflow-y: hidden;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      caret-color: ${accentColor};
      -webkit-user-select: text;
      user-select: text;
    }
    #editor:empty::before {
      content: attr(data-placeholder);
      color: ${placeholderColor};
      pointer-events: none;
    }
    #editor[contenteditable="false"] {
      pointer-events: none;
      cursor: default;
      opacity: 0.5;
    }
    img[data-token] {
      display: inline-block;
      width: 22px;
      height: 22px;
      object-fit: contain;
      vertical-align: -5px;
      user-select: all;
      -webkit-user-select: all;
    }
    img[data-sticker="1"] {
      width: 28px;
      height: 28px;
      vertical-align: -8px;
    }
    span[data-token] {
      color: ${accentColor};
      font-weight: 600;
      white-space: nowrap;
      user-select: all;
      -webkit-user-select: all;
    }
  </style>
</head>
<body>
  <div id="editor" contenteditable="${allowText}" role="textbox" data-placeholder="${placeholder.replace(/"/g, '&quot;')}"></div>
  <script>
    const editor = document.getElementById('editor');
    const MIN_HEIGHT = 40;
    const MAX_HEIGHT = 120;

    function clampHeight(value) {
      return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, value || MIN_HEIGHT));
    }

    function measureHeight() {
      editor.style.height = 'auto';
      const nextHeight = clampHeight(Math.ceil(editor.scrollHeight || MIN_HEIGHT));
      editor.style.height = nextHeight + 'px';
      editor.style.overflowY = nextHeight >= MAX_HEIGHT ? 'auto' : 'hidden';
      // Keep the active typing line visible when content exceeds max height.
      if (nextHeight >= MAX_HEIGHT) {
        editor.scrollTop = editor.scrollHeight;
      } else {
        editor.scrollTop = 0;
      }
      return nextHeight;
    }

    // Emote images and channel chips both carry the text they send in data-token.
    function replaceTokens(root) {
      root.querySelectorAll('[data-token]').forEach((el) => {
        el.replaceWith(document.createTextNode(el.dataset.token || ''));
      });
    }

    function serialize() {
      const clone = editor.cloneNode(true);
      replaceTokens(clone);
      return (clone.innerText || '')
        .replace(/\\r/g, '')
        .replace(/\\u200B/g, '')
        .replace(/\\u00a0/g, ' ')
        .replace(/\\n+$/g, '');
    }

    // Plain text up to the caret (nbsp as a space) so React can spot an @mention or
    // #channel being typed. Chips read as their token, so a picked "#general" chip
    // (sent as <#id>) does not reopen the channel list.
    function textBeforeCaret() {
      const selection = window.getSelection();
      if (!selection.rangeCount || !editor.contains(selection.anchorNode)) return null;
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      const div = document.createElement('div');
      div.appendChild(range.cloneContents());
      replaceTokens(div);
      return (div.innerText || '').replace(/\\r/g, '').replace(/\\u200B/g, '').replace(/\\u00a0/g, ' ');
    }

    // WebKit draws the caret at the far end of the line when it sits right after a trailing
    // non-editable emote, so it looks like invisible text follows the emote. A zero-width
    // "anchor" character after a trailing emote gives the caret a text position next to the
    // image. Every reader of the editor strips it, so it is never sent; copies of it left
    // anywhere else (after typing, say) are removed, keeping the caret where it was.
    const ANCHOR = '\\u200B';
    // Any non-editable token element: an emote image or a channel chip.
    function isEmote(node) {
      return !!node && node.nodeType === 1 && !!(node.dataset && node.dataset.token);
    }
    function isSkippable(node) {
      return !!node && ((node.nodeType === 3 && node.textContent === '') || node.nodeName === 'BR');
    }
    function lastMeaningful() {
      let node = editor.lastChild;
      while (isSkippable(node)) node = node.previousSibling;
      return node;
    }
    function previousMeaningful(node) {
      let prev = node.previousSibling;
      while (isSkippable(prev)) prev = prev.previousSibling;
      return prev;
    }
    function isLiveAnchor(node) {
      return node.nodeType === 3 && node.textContent === ANCHOR
        && node === lastMeaningful() && isEmote(previousMeaningful(node));
    }
    function stripStrayAnchors() {
      const selection = window.getSelection();
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let current;
      while ((current = walker.nextNode())) nodes.push(current);
      for (const node of nodes) {
        const text = node.textContent || '';
        if (text.indexOf(ANCHOR) === -1 || isLiveAnchor(node)) continue;
        const caretHere = selection.rangeCount > 0 && selection.anchorNode === node;
        const caretOffset = caretHere ? selection.anchorOffset : 0;
        const removedBeforeCaret = text.slice(0, caretOffset).split(ANCHOR).length - 1;
        node.textContent = text.split(ANCHOR).join('');
        if (caretHere) {
          const range = document.createRange();
          range.setStart(node, Math.max(0, caretOffset - removedBeforeCaret));
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }
    function normalizeTrailingEmote() {
      stripStrayAnchors();
      if (isEmote(lastMeaningful())) {
        editor.appendChild(document.createTextNode(ANCHOR));
        return;
      }
      // Nothing left but empty text, an anchor or WebKit's placeholder <br>: empty the editor
      // so the :empty placeholder shows again.
      if (editor.childNodes.length > 0 && !editor.querySelector('img, [data-token]')
        && (editor.textContent || '').split(ANCHOR).join('') === '') {
        const focused = document.activeElement === editor;
        editor.innerHTML = '';
        if (focused) focusEnd();
      }
    }

    function post(type) {
      normalizeTrailingEmote();
      const height = measureHeight();
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type,
        value: serialize(),
        height,
        beforeCaret: type === 'input' ? textBeforeCaret() : undefined
      }));
    }

    function focusEnd() {
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }

    function insertNodes(nodes) {
      editor.focus();
      const selection = window.getSelection();
      let range;
      if (selection.rangeCount && editor.contains(selection.getRangeAt(0).startContainer)) {
        range = selection.getRangeAt(0);
        range.deleteContents();
      } else {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      for (const node of nodes) {
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
      }
      selection.removeAllRanges();
      selection.addRange(range);
      post('input');
    }

    // First character after the caret ('' at the end of the editor).
    function charAfterCaret() {
      const selection = window.getSelection();
      if (!selection.rangeCount || !editor.contains(selection.focusNode)) return '';
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.setStart(selection.focusNode, selection.focusOffset);
      const div = document.createElement('div');
      div.appendChild(range.cloneContents());
      return (div.textContent || '').replace(/\\u200B/g, '').charAt(0);
    }

    function currentValueBeforeCaret() {
      const selection = window.getSelection();
      if (!selection.rangeCount) return serialize();
      const range = selection.getRangeAt(0).cloneRange();
      range.selectNodeContents(editor);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      const div = document.createElement('div');
      div.appendChild(range.cloneContents());
      return (div.innerText || '').replace(/\\r/g, '').replace(/\\u200B/g, '').replace(/\\u00a0/g, '');
    }

    window.CatRealmComposer = {
      setText(value) {
        // Rewriting identical text would only reset the caret mid-typing.
        if (serialize() === (value || '')) return;
        editor.textContent = value || '';
        post('input');
      },
      insertText(value) {
        const before = currentValueBeforeCaret();
        const nodes = [];
        if (before.length > 0 && !/\\s$/.test(before)) nodes.push(document.createTextNode(' '));
        nodes.push(document.createTextNode(value));
        insertNodes(nodes);
      },
      insertExpression(token, url, name, isSticker) {
        const before = currentValueBeforeCaret();
        const nodes = [];
        if (before.length > 0 && !/\\s$/.test(before)) nodes.push(document.createTextNode(' '));
        const img = document.createElement('img');
        img.src = url;
        img.alt = ':' + name + ':';
        img.title = ':' + name + ':';
        img.dataset.token = token;
        if (isSticker) img.dataset.sticker = '1';
        img.contentEditable = 'false';
        nodes.push(img);
        // Leave the caret in a text node after the emote. Right after a non-editable image
        // WebKit draws the caret at the far end of the line, which looks like a long run of
        // invisible text follows the emote. The ':name' suggestion path does the same.
        const after = charAfterCaret();
        if (!after || !/\\s/.test(after)) nodes.push(document.createTextNode(' '));
        insertNodes(nodes);
      },
      // Swap the ":query" right before the caret for a picked emoji or custom emote.
      replaceEmote(insert, url, name, isSticker) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        let node = selection.anchorNode;
        let offset = selection.anchorOffset;
        if (node === editor && offset > 0 && editor.childNodes[offset - 1] && editor.childNodes[offset - 1].nodeType === 3) {
          node = editor.childNodes[offset - 1];
          offset = node.textContent.length;
        }
        if (!node || node.nodeType !== 3 || !editor.contains(node)) return;
        const text = (node.textContent || '').replace(/\u00a0/g, ' ');
        const colon = text.slice(0, offset).lastIndexOf(':');
        if (colon === -1) return;
        if (url) {
          const beforeText = text.slice(0, colon);
          const afterText = text.slice(offset).replace(/^ /, '');
          node.textContent = beforeText;
          const img = document.createElement('img');
          img.src = url;
          img.alt = ':' + name + ':';
          img.title = ':' + name + ':';
          img.dataset.token = insert;
          if (isSticker) img.dataset.sticker = '1';
          img.contentEditable = 'false';
          const spaceNode = document.createTextNode(' ' + afterText);
          const parent = node.parentNode || editor;
          const nextSibling = node.nextSibling;
          parent.insertBefore(img, nextSibling);
          parent.insertBefore(spaceNode, nextSibling);
          const range = document.createRange();
          range.setStart(spaceNode, 1);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          editor.focus();
          post('input');
          return;
        }
        const inserted = insert + ' ';
        node.textContent = text.slice(0, colon) + inserted + text.slice(offset).replace(/^ /, '');
        const range = document.createRange();
        range.setStart(node, colon + inserted.length);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        editor.focus();
        post('input');
      },
      // Swap the "@query" (or "#query") right before the caret for a picked mention.
      // With a label the pick becomes a chip that shows the label and sends insert,
      // which is how "#general" sends as <#channelId>.
      replaceMention(insert, trigger, label) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        let node = selection.anchorNode;
        let offset = selection.anchorOffset;
        if (node === editor && offset > 0 && editor.childNodes[offset - 1] && editor.childNodes[offset - 1].nodeType === 3) {
          node = editor.childNodes[offset - 1];
          offset = node.textContent.length;
        }
        if (!node || node.nodeType !== 3 || !editor.contains(node)) return;
        const text = (node.textContent || '').replace(/\\u00a0/g, ' ');
        const at = text.slice(0, offset).lastIndexOf(trigger || '@');
        if (at === -1) return;
        if (label) {
          const afterText = text.slice(offset).replace(/^ /, '');
          node.textContent = text.slice(0, at);
          const chip = document.createElement('span');
          chip.textContent = label;
          chip.dataset.token = insert;
          chip.contentEditable = 'false';
          const spaceNode = document.createTextNode(' ' + afterText);
          const parent = node.parentNode || editor;
          const nextSibling = node.nextSibling;
          parent.insertBefore(chip, nextSibling);
          parent.insertBefore(spaceNode, nextSibling);
          // Focus first: focusing can move the caret, and it must end up after the chip.
          editor.focus();
          const range = document.createRange();
          range.setStart(spaceNode, 1);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          post('input');
          return;
        }
        const inserted = insert + ' ';
        node.textContent = text.slice(0, at) + inserted + text.slice(offset).replace(/^ /, '');
        const range = document.createRange();
        range.setStart(node, at + inserted.length);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        editor.focus();
        post('input');
      },
      clear() {
        editor.textContent = '';
        post('input');
      },
      blur() {
        editor.blur();
      },
      focusEnd,
    };

    // Android WebView can deliver input, key and mutation events for the same
    // keystroke. Coalesce them so fast typing cannot build a queue of layout
    // reads and React Native bridge messages. Never let a height-only event
    // downgrade a pending input update or the latest text could be missed.
    let postFrame = 0;
    let pendingPostType = null;
    function schedulePost(type) {
      if (type === 'input' || !pendingPostType) pendingPostType = type;
      if (postFrame) return;
      postFrame = requestAnimationFrame(() => {
        const nextType = pendingPostType || 'height';
        postFrame = 0;
        pendingPostType = null;
        post(nextType);
      });
    }

    editor.addEventListener('beforeinput', (event) => {
      if (event.inputType !== 'deleteContentBackward') return;
      const selection = window.getSelection();
      if (!selection.rangeCount || !selection.isCollapsed) return;
      const node = selection.anchorNode;
      const offset = selection.anchorOffset;
      let anchorNode = null;
      if (node && node.nodeType === 3 && node.textContent === ANCHOR && offset > 0) anchorNode = node;
      else if (node === editor && offset > 0) {
        const prev = editor.childNodes[offset - 1];
        if (prev && prev.nodeType === 3 && prev.textContent === ANCHOR) anchorNode = prev;
      }
      if (!anchorNode) return;
      const emote = previousMeaningful(anchorNode);
      if (!isEmote(emote)) return;
      event.preventDefault();
      emote.remove();
      const range = document.createRange();
      range.setStart(anchorNode, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      schedulePost('input');
    });
    editor.addEventListener('input', () => schedulePost('input'));
    editor.addEventListener('focus', () => schedulePost('height'));
    new MutationObserver(() => schedulePost('height')).observe(editor, { childList: true, subtree: true, characterData: true });
    // iOS can run the first measure before the WebView has its final width;
    // at a near-zero width the placeholder wraps per character and the box
    // locks at max height. Measure again whenever the width settles.
    let lastWidth = 0;
    function remeasureOnWidthChange() {
      const width = document.documentElement.clientWidth;
      if (!width || width === lastWidth) return;
      lastWidth = width;
      schedulePost('height');
    }
    window.addEventListener('resize', remeasureOnWidthChange);
    if (window.ResizeObserver) new ResizeObserver(remeasureOnWidthChange).observe(document.documentElement);
    setTimeout(() => post('height'), 50);
  </script>
</body>
</html>`;
}
