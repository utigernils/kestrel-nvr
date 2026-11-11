import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { DialogProvider } from './context/DialogContext';
import { PrefsProvider, usePrefs } from './context/PrefsContext';
import { ToastProvider } from './context/ToastContext';
import { initInstall, registerServiceWorker } from './lib/install';
import './styles/global.css';

initInstall();
registerServiceWorker();

/** Bei einem Sprachwechsel wird die Oberflaeche neu aufgebaut; die Anmeldung bleibt bestehen. */
function Localized() {
  const { lang } = usePrefs();
  return (
    <DialogProvider key={lang}>
      <HashRouter>
        <App />
      </HashRouter>
    </DialogProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrefsProvider>
      <ToastProvider>
        <AuthProvider>
          <Localized />
        </AuthProvider>
      </ToastProvider>
    </PrefsProvider>
  </StrictMode>,
);
