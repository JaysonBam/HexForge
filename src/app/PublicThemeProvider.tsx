import { useMemo, type ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ThemeProvider, createTheme, responsiveFontSizes } from '@mui/material/styles';

export function PublicThemeProvider({ children }: { children: ReactNode }) {
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = useMemo(
    () => responsiveFontSizes(createTheme({
      palette: prefersDarkMode
        ? {
            mode: 'dark',
            primary: { main: '#38BDF8', dark: '#0EA5E9' },
            secondary: { main: '#D6A84F' },
            background: { default: '#0f172a', paper: '#111c31' },
            text: { primary: '#f8fafc', secondary: '#cbd5e1' },
            divider: '#475569',
            action: { hover: 'rgba(148, 163, 184, 0.16)' }
          }
        : {
            mode: 'light',
            primary: { main: '#0EA5E9', dark: '#0284C7' },
            secondary: { main: '#D6A84F' },
            background: { default: '#eef3f8', paper: '#ffffff' },
            text: { primary: '#0f172a', secondary: '#475569' },
            divider: '#CBD5E1',
            action: { hover: '#e2e8f0' }
          },
      shape: { borderRadius: 8 },
      typography: {
        fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
        h5: { fontWeight: 700 }
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              backgroundImage: prefersDarkMode
                ? 'radial-gradient(circle at top, rgba(56, 189, 248, 0.16), transparent 38%)'
                : 'radial-gradient(circle at top, rgba(56, 189, 248, 0.12), transparent 42%)'
            }
          }
        },
        MuiPaper: {
          styleOverrides: {
            root: {
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: prefersDarkMode ? 'rgba(214, 168, 79, 0.28)' : 'rgba(214, 168, 79, 0.35)',
              boxShadow: prefersDarkMode
                ? '0 18px 50px rgba(2, 6, 23, 0.42)'
                : '0 18px 40px rgba(15, 23, 42, 0.08)'
            }
          }
        },
        MuiButton: {
          styleOverrides: {
            outlined: {
              borderWidth: 1.5,
              borderColor: prefersDarkMode ? 'rgba(56, 189, 248, 0.42)' : 'rgba(214, 168, 79, 0.38)'
            },
            containedPrimary: {
              backgroundColor: '#0EA5E9',
              boxShadow: '0 8px 18px rgba(14, 165, 233, 0.24)'
            }
          }
        }
      }
    })),
    [prefersDarkMode]
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
