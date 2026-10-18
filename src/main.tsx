import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadMessages } from './lib/i18n'
import { getSettings, resolveUiLanguage } from './lib/settings'

// Load the interface language first, so the app never flashes in English.
void loadMessages(resolveUiLanguage(getSettings().uiLanguage)).finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
