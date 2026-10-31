import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSettingsStore } from '@/stores/settingsStore';
import { ENGINE_BASE_URL, ENGINE_HTML } from '@/lib/translation/engineHtml';
import { attachEngine, detachEngine, handleEngineMessage } from '@/lib/translation/engine';
import { clearTranslationCache, useTranslationPacks } from '@/lib/translation';

/**
 * Hidden WebView that runs the Bergamot translation engine while the Cat Lab auto-translate
 * experiment is on. Turning it off unmounts the WebView, which frees the models; downloaded
 * packs stay in its storage for next time.
 */
export function TranslationEngineHost() {
  const enabled = useSettingsStore((s) => s.catLabAutoTranslate);
  if (!enabled) return null;
  return <EngineWebView />;
}

function EngineWebView() {
  const webRef = useRef<WebView<object>>(null);

  useEffect(() => {
    attachEngine((script) => webRef.current?.injectJavaScript(script));
    void useTranslationPacks.getState().refresh();
    return () => {
      detachEngine();
      clearTranslationCache();
    };
  }, []);

  return (
    <View style={styles.host} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView<object>
        ref={webRef}
        source={{ html: ENGINE_HTML, baseUrl: ENGINE_BASE_URL }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        onMessage={(event) => handleEngineMessage(event.nativeEvent.data)}
        // A crashed or reloaded page loses its worker and loaded models; start clean.
        onLoadStart={() => attachEngine((script) => webRef.current?.injectJavaScript(script))}
        onRenderProcessGone={() => detachEngine('Translation engine crashed')}
        onContentProcessDidTerminate={() => {
          detachEngine('Translation engine crashed');
          webRef.current?.reload();
        }}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
    left: -10,
    top: -10,
  },
  webview: {
    width: 1,
    height: 1,
    backgroundColor: 'transparent',
  },
});
