import { createReadStream, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Serves kuromoji.js's Japanese dictionary (about 18 MB, gzipped) at <base>/kuromoji-dict/,
 * from node_modules in development and as build output, so furigana never needs a CDN.
 * It's downloaded only when someone turns furigana on.
 */
function kuromojiDictionary(): Plugin {
  const directory = join(import.meta.dirname, 'node_modules/kuromoji/dict')
  const files = () => readdirSync(directory).filter((name) => name.endsWith('.dat.gz'))
  let base = '/'
  return {
    name: 'readling:kuromoji-dictionary',
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const prefix = `${base}kuromoji-dict/`
        const name = request.url?.startsWith(prefix) ? request.url.slice(prefix.length).split('?')[0] : ''
        if (!name || !files().includes(name)) return next()
        response.setHeader('Content-Type', 'application/octet-stream')
        createReadStream(join(directory, name)).pipe(response)
      })
    },
    generateBundle() {
      for (const name of files()) {
        this.emitFile({ type: 'asset', fileName: `kuromoji-dict/${name}`, source: readFileSync(join(directory, name)) })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    kuromojiDictionary(),
    // Installable app that opens offline; everything a reader needs is stored locally anyway.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'readling',
        short_name: 'readling',
        description: 'Learn languages by reading what you love.',
        lang: 'en',
        // start_url, scope and the offline fallback follow Vite's `base`, so sub-path hosting works.
        display: 'standalone',
        theme_color: '#4f46e5',
        background_color: '#fafaf9',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        // The pdf.js worker is about 1.3 MB; cache it so PDFs open offline too.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // The Japanese dictionary isn't precached; once someone downloads it, keep it for offline use.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/kuromoji-dict/'),
            handler: 'CacheFirst',
            options: { cacheName: 'readling-kuromoji-dict', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  // Found only behind dynamic imports; listing them avoids a dev-server reload the first time.
  optimizeDeps: {
    include: ['kuromoji/src/dict/DynamicDictionaries.js', 'kuromoji/src/Tokenizer.js', 'pinyin-pro'],
  },
})
