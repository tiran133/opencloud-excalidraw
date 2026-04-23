import { defineConfig as defineOCConfig } from '@opencloud-eu/extension-sdk'
import { mergeConfig, type ConfigEnv, type Plugin } from 'vite'
import veauryVitePlugins from 'veaury/vite'

const ocConfig = defineOCConfig({
  name: 'web-app-excalidraw',
  plugins: [] // Remove default vue plugin
})

export default (env: ConfigEnv) => {
  const baseConfig = typeof ocConfig === 'function' ? ocConfig(env) : ocConfig

  // Remove the vue plugin from SDK — veaury provides its own Vue/React handling.
  // If vite renames the plugin, this filter silently becomes a no-op.
  if (baseConfig.plugins) {
    const before = baseConfig.plugins.length
    baseConfig.plugins = baseConfig.plugins.filter((plugin: Plugin) => plugin?.name !== 'vite:vue')
    if (baseConfig.plugins.length === before) {
      console.warn('[vite.config] ⚠️  vite:vue plugin not found — filter may be outdated')
    }
  }

  return mergeConfig(baseConfig, {
    plugins: [
      ...veauryVitePlugins({
        type: 'vue',
        reactOptions: {
          jsxRuntime: 'automatic'
        }
      })
    ],
    optimizeDeps: {
      exclude: ['veaury']
    },
    resolve: {
      conditions: ['development', 'module', 'browser', 'import']
    }
  })
}
