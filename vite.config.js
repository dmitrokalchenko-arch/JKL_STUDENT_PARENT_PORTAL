import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  },
  // Netlify задаёт CONTEXT ("production"/"deploy-preview"/"branch-deploy"/
  // "dev") только на СВОИХ build-машинах, во время сборки — это НЕ то же
  // самое, что runtime-проверка hostname на клиенте, её нельзя подделать
  // после сборки (значение "запекается" в бандл на этапе build, а не
  // читается заново в браузере). Используется ТОЛЬКО для
  // /dev/student-page-preview (см. src/pages/dev/StudentPageDemoRoute.jsx) —
  // guard, чтобы demo-route с mock-данными не появился в production-сборке.
  // Вне Netlify (process.env.CONTEXT не задан) — безопасный дефолт
  // "production", т.е. route выключен, а не включён по умолчанию.
  define: {
    __NETLIFY_DEPLOY_CONTEXT__: JSON.stringify(process.env.CONTEXT || 'production')
  }
});
