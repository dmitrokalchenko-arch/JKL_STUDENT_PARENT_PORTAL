import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/global.css';
import { ensureInitialLanguageLoaded } from './i18n/index.js';

async function bootstrap() {
  await ensureInitialLanguageLoaded();

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap();
