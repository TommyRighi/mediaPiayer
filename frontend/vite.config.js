import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'precompress-static-assets',
    writeBundle(options, bundle) {
      for (const item of Object.values(bundle)) {
        if (!/\.(js|css|html|svg)$/.test(item.fileName)) continue;
        // Read the final file after Vite has resolved preload placeholders.
        const filePath = resolve(options.dir, item.fileName);
        const source = readFileSync(filePath);
        if (source.length < 1024) continue;
        writeFileSync(`${filePath}.gz`, gzipSync(source));
        writeFileSync(`${filePath}.br`, brotliCompressSync(source));
      }
    },
  }],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: '../server/dist',
    emptyOutDir: true,
  },
})
