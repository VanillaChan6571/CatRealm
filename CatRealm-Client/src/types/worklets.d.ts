// Type declaration for Vite's ?worker&url import modifier.
// Used by audioProcessing.ts to load AudioWorklet processor bundles.
declare module '*?worker&url' {
  const url: string;
  export default url;
}
