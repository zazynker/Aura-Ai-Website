import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initSentry } from './utils/sentry';
import './styles/tailwind.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Monitoring is intentionally started after the first render so the Sentry
// chunk cannot compete with the homepage's critical resources on mobile.
const startSentry = () => initSentry();
if ('requestIdleCallback' in window) {
  window.requestIdleCallback(startSentry);
} else {
  setTimeout(startSentry, 1500);
}
