import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { SmurfApp } from './smurf/SmurfApp.tsx';
import { ServerGate } from './components/ServerGate';
import './index.css';
import './smurf/theme.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServerGate>
      <SmurfApp />
    </ServerGate>
  </StrictMode>,
);
