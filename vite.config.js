import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 5173, host: '0.0.0.0', proxy: { '/api': 'http://localhost:3001' } }, build: { target: 'es2022' } });
