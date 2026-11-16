import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouter } from './components/AppRouter'
import './i18n'
import './index.css'
import App from './App.tsx'
import { markFirstPaintAfterRender, markStartup } from './lib/startupTiming'

// All static imports above have been fetched, parsed and evaluated by now.
markStartup('renderer_bundle_evaluated')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRouter>
      <App />
    </AppRouter>
  </StrictMode>,
)

markFirstPaintAfterRender()
