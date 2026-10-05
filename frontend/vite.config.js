/*全局 process*/
/* eslint-disable no-undef */

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// En desarrollo, Vite (5173) reenvía /api y /admin a Express (3000).
// El navegador ve un único origen, así la cookie de sesión (connect.sid)
// viaja sin CORS ni credentials: 'include'.
const BACKEND_URL = process.env.VITE_BACKEND_URL || 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: false, // conserva el Host original; la cookie queda ligada al origen de Vite
      },
      // derivaciones.js redirige a /admin/login.html cuando recibe 401
      '/admin': {
        target: BACKEND_URL,
        changeOrigin: false,
      },
    },
  },
})