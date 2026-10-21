import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ServerGate } from './components/ServerGate';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServerGate>
      <App />
    </ServerGate>
  </StrictMode>,
);
