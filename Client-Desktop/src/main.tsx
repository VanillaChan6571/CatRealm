import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouter } from './components/AppRouter'
import './i18n'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRouter>
      <App />
    </AppRouter>
  </StrictMode>,
)
