import { createReadStream, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NodePath, PluginObj, types as BabelTypes } from '@babel/core'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import viteCompression from 'vite-plugin-compression'

// CatLab auto-translate: the Bergamot engine is a classic worker that importScripts() its
// emscripten glue and fetches its .wasm relative to itself, so the files must be served
// unbundled side by side. Served from node_modules in dev and emitted as-is on build.
const BERGAMOT_WORKER_FILES: Record<string, string> = {
  'bootstrap.js': fileURLToPath(new URL('./src/lib/translation/worker/bootstrap.js', import.meta.url)),
  ...Object.fromEntries(
    ['translator-worker.js', 'bergamot-translator-worker.js', 'bergamot-translator-worker.wasm'].map((name) => [
      name,
      fileURLToPath(new URL(`./node_modules/@browsermt/bergamot-translator/worker/${name}`, import.meta.url)),
    ]),
  ),
}

function bergamotWorkerAssets(): Plugin {
  return {
    name: 'catrealm-bergamot-worker',
    configureServer(server) {
      server.middlewares.use('/bergamot', (req, res, next) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0]
        const file = BERGAMOT_WORKER_FILES[name]
        if (!file) return next()
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        createReadStream(file).pipe(res)
      })
    },
    generateBundle() {
      for (const [name, file] of Object.entries(BERGAMOT_WORKER_FILES)) {
        this.emitFile({ type: 'asset', fileName: `bergamot/${name}`, source: readFileSync(file) })
      }
    },
  }
}

// Dev-only: stamps every host JSX element (div, button, svg, ...) with where it
// was written — data-debug-file / data-debug-line / data-debug-component — so the
// Developer → UI hover inspector can name anything on screen without hand-written
// data-debug-name tags. Attributes already written by hand are left alone.
const CLIENT_ROOT = fileURLToPath(new URL('.', import.meta.url))

function functionName(path: NodePath<BabelTypes.Function>): string | null {
  const { node, parentPath } = path
  if ('id' in node && node.id?.type === 'Identifier') return node.id.name
  // const Foo = () => ..., const Foo = memo(() => ...), const Foo = forwardRef(...)
  let holder: NodePath | null = parentPath
  while (holder?.isCallExpression()) holder = holder.parentPath
  if (holder?.isVariableDeclarator() && holder.node.id.type === 'Identifier') return holder.node.id.name
  if ((holder?.isObjectProperty() || holder?.isClassMethod() || holder?.isObjectMethod()) && holder.node.key.type === 'Identifier') {
    return holder.node.key.name
  }
  if (path.isObjectMethod() || path.isClassMethod()) {
    return path.node.key.type === 'Identifier' ? path.node.key.name : null
  }
  return null
}

// "Sidebar" for markup directly in a component, "Sidebar › renderVoiceUsers" for
// markup built by a named helper inside it. Anonymous callbacks (.map etc.) are skipped.
function enclosingComponent(path: NodePath): string | null {
  const names: string[] = []
  for (let fn = path.getFunctionParent(); fn; fn = fn.parentPath?.getFunctionParent() ?? null) {
    const name = functionName(fn)
    if (name) names.unshift(name)
  }
  if (names.length === 0) return null
  let componentIndex = -1
  names.forEach((name, index) => { if (/^[A-Z]/.test(name)) componentIndex = index })
  return names.slice(Math.max(componentIndex, 0)).join(' › ')
}

function debugSourceTags({ types: t }: { types: typeof BabelTypes }): PluginObj {
  return {
    name: 'catrealm-debug-source-tags',
    visitor: {
      JSXOpeningElement(path, state) {
        const { node } = path
        if (node.name.type !== 'JSXIdentifier' || !/^[a-z]/.test(node.name.name)) return
        if (!state.filename || !node.loc) return
        const existing = new Set(
          node.attributes.flatMap((attr) => (attr.type === 'JSXAttribute' && attr.name.type === 'JSXIdentifier' ? [attr.name.name] : [])),
        )
        const add = (name: string, value: string | null) => {
          // Expression container, not a JSX string: JSX strings don't process the
          // \u escapes Babel emits for non-ASCII like the " › " separator.
          if (value && !existing.has(name)) {
            node.attributes.push(t.jsxAttribute(t.jsxIdentifier(name), t.jsxExpressionContainer(t.stringLiteral(value))))
          }
        }
        add('data-debug-file', relative(CLIENT_ROOT, state.filename).replace(/\\/g, '/'))
        add('data-debug-line', String(node.loc.start.line))
        add('data-debug-component', enclosingComponent(path))
      },
    },
  }
}

export default defineConfig(({ command }) => ({
  // Use relative asset paths so packaged Electron builds load local hashed files.
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'calls': [
            './src/components/calls/DMCallPanel',
            './src/components/calls/GroupCallPanel',
          ],
        },
      },
    },
  },
  plugins: [
    react(command === 'serve' ? { babel: { plugins: [debugSourceTags] } } : {}),
    tailwindcss(),
    bergamotWorkerAssets(),
    // Generate .gz files for all assets > 1KB
    viteCompression({
      algorithm: 'gzip',
      ext: '.gz',
      threshold: 1024,
      deleteOriginFile: false
    }),
    // Also generate brotli compressed files for better compression
    viteCompression({
      algorithm: 'brotliCompress',
      ext: '.br',
      threshold: 1024,
      deleteOriginFile: false
    })
  ],
}))
