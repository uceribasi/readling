import { lazy, Suspense, useEffect } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import { ExtensionLookupBridge } from './components/ExtensionLookupBridge'
import { useUiLanguage } from './lib/i18n'
import { useRoute } from './lib/router'
import { seedSamplesOnce } from './lib/samples'
import { LibraryPage } from './pages/LibraryPage'
import { ReadPage } from './pages/ReadPage'
import { ReviewPage } from './pages/ReviewPage'

// Reading and reviewing load with the app; the other screens load when first opened
// (the service worker still caches them all for offline use).
const NewTextPage = lazy(() => import('./pages/NewTextPage').then((m) => ({ default: m.NewTextPage })))
const ImportPage = lazy(() => import('./pages/ImportPage').then((m) => ({ default: m.ImportPage })))
const WordsPage = lazy(() => import('./pages/WordsPage').then((m) => ({ default: m.WordsPage })))
const QuizPage = lazy(() => import('./pages/QuizPage').then((m) => ({ default: m.QuizPage })))
const StatsPage = lazy(() => import('./pages/StatsPage').then((m) => ({ default: m.StatsPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const DailyPage = lazy(() => import('./pages/DailyPage').then((m) => ({ default: m.DailyPage })))
const ListeningPage = lazy(() => import('./pages/ListeningPage').then((m) => ({ default: m.ListeningPage })))

export default function App() {
  const route = useRoute()
  const uiLanguage = useUiLanguage()

  useEffect(() => {
    void seedSamplesOnce()
  }, [])

  useEffect(() => {
    document.documentElement.lang = uiLanguage
  }, [uiLanguage])

  return (
    <Layout>
      <ExtensionLookupBridge />
      <ErrorBoundary resetKey={JSON.stringify(route)}>
      <Suspense fallback={null}>
      {route.name === 'library' && <LibraryPage />}
      {route.name === 'new' && <NewTextPage />}
      {route.name === 'read' && <ReadPage key={`${route.id}:${route.page ?? ''}`} id={route.id} initialPage={route.page} />}
      {route.name === 'daily' && <DailyPage />}
      {route.name === 'listen' && <ListeningPage />}
      {route.name === 'words' && <WordsPage />}
      {route.name === 'quiz' && <QuizPage key={`${route.language ?? ''}:${route.textId ?? ''}`} language={route.language} textId={route.textId} />}
      {route.name === 'review' && <ReviewPage />}
      {route.name === 'settings' && <SettingsPage />}
      {route.name === 'stats' && <StatsPage />}
      {route.name === 'import' && <ImportPage />}
      </Suspense>
      </ErrorBoundary>
    </Layout>
  )
}
