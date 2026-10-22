import React from 'react';
import './i18n';
import ReactDOM from 'react-dom/client';
import {BrowserRouter as Router} from 'react-router-dom';
import App from './components/App';
import './ui/styles/index.css';
import './styles/main.css';
import logger from './utils/logger.js';
import {DarkModeProvider} from './context/DarkModeContext';
import {applyPalette, applyTheme, cachedPalette, cachedTheme} from './ui/theme';

// Before the first render: the cached choices, otherwise the system theme and the
// standard palette.
applyTheme(cachedTheme());
applyPalette(cachedPalette());

const rootElement = document.getElementById('root');
if (rootElement) {
    const pathname = window.location.pathname;
    const uiMatch = pathname.startsWith('/ui') ? '/ui' : '/';
    const root = ReactDOM.createRoot(rootElement);
    root.render(
        <React.StrictMode>
            <DarkModeProvider>
                <Router basename={uiMatch}>
                    <App/>
                </Router>
            </DarkModeProvider>
        </React.StrictMode>
    );
} else {
    logger.error("DOM element with id 'root' not found!");
}
