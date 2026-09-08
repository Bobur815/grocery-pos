import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter as BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './theme/ThemeProvider';
import { ToastProvider } from './context/ToastContext';
import { SuperAdminGateProvider } from './components/gate/SuperAdminGate';
import './i18n';

// Forward uncaught renderer errors to the main-process electron-log file
window.onerror = (_message, source, line, col, error) => {
  const msg = error ? (error.stack ?? error.message) : String(_message);
  window.electronAPI?.logger?.error(`Uncaught error: ${msg} (${source}:${line}:${col})`);
};
window.onunhandledrejection = (event) => {
  const err = event.reason;
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  window.electronAPI?.logger?.error(`UnhandledRejection: ${msg}`);
};

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <SuperAdminGateProvider>
            <App />
          </SuperAdminGateProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
