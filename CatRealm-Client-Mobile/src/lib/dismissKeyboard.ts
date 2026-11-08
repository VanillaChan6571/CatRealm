import { Keyboard } from 'react-native';

// Keyboard.dismiss() only blurs React Native TextInputs. The chat composer's
// editor lives in a WebView, so it registers here to be blurred as well.
const blurListeners = new Set<() => void>();

export function onDismissKeyboard(listener: () => void): () => void {
  blurListeners.add(listener);
  return () => {
    blurListeners.delete(listener);
  };
}

/** Close the on-screen keyboard, including when the WebView composer holds focus. */
export function dismissKeyboard() {
  Keyboard.dismiss();
  blurListeners.forEach((listener) => listener());
}
