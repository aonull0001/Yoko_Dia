import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/Yoko_Dia/',
  server: { watch: { ignored: ['**/.vs/**'] } },
  test: { environment: 'node' },
});
