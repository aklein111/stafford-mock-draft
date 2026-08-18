import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this repo from https://<user>.github.io/stafford-mock-draft/,
// so production assets need that sub-path baked into every URL. Local dev
// keeps serving from the root so `npm run dev` URLs stay simple.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/stafford-mock-draft/' : '/',
  plugins: [react()],
  test: {
    environment: 'node',
  },
}))
