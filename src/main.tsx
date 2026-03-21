import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './themes/obsidian.css';
import './themes/pixel.css';
import { ThemeProvider } from './themes/ThemeContext';
import { NavProvider } from './navigation/NavContext';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <NavProvider>
        <App />
      </NavProvider>
    </ThemeProvider>
  </StrictMode>,
);
