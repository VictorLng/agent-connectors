import React from 'react';
import ReactDOM from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import App from './App';
import '@xterm/xterm/css/xterm.css';
import './styles.css';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#ff7629', light: '#ff9a5d', dark: '#db5c17' },
    secondary: { main: '#e9a16b' },
    background: { default: '#090a0c', paper: '#121416' },
    text: { primary: '#f2f3f4', secondary: '#979ba3' },
    success: { main: '#68c99a' },
    warning: { main: '#e9b85f' },
    error: { main: '#ec6f6f' },
    divider: 'rgba(255,255,255,0.075)',
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    button: { textTransform: 'none', fontWeight: 650 },
    h5: { fontWeight: 680, letterSpacing: '-0.035em' },
  },
  components: {
    MuiButton: { styleOverrides: { root: { borderRadius: 9, minHeight: 38 } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
