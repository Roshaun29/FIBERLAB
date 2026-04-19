import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  return {
    plugins: [react()],
    // Use the repo name as base for GitHub Pages, but '/' for Vercel/Local
    // We can detect GH Pages by an environment variable if we set one, 
    // or just rely on the user's specific build command.
    // For now, if we are building for production and NOT on Vercel, 
    // we might want the repo path. 
    // However, Vercel is preferred, so we'll default to '/'
    base: process.env.GITHUB_PAGES === 'true' ? '/FIBERLAB/' : '/',
  }
})
