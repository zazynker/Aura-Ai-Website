import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initSentry } from './utils/sentry';

// Initialize Sentry before rendering (only in production)
initSentry();

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