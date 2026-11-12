import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { LegalRoot } from './components/legal/LegalRoot';
import { resolveLegalRoute } from './legal/routes';

// Public legal pages (/privacy, /terms, /refund-policy, /cancellation-policy, /contact) render WITHOUT the app, the auth
// gate or any account state. Every other pathname, including "/", mounts the application exactly as before.
const legalRoute = resolveLegalRoute(window.location.pathname);

createRoot(document.getElementById('root')!).render(legalRoute ? <LegalRoot route={legalRoute} /> : <App />);
