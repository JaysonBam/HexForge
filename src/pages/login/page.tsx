import { Box, Button, Link, Paper, Typography, Stack, CircularProgress } from '@mui/material';
import GoogleColorIcon from './components/GoogleIcon';
import { requestGoogleSignIn } from '../../utils/gmailDraftUtils'
import { supabase } from '../../lib/supabaseClient';
import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const errorMessage = useQueryErrorMessage()

  // No parent callback; login flow uses OAuth redirect

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (isMounted && data.session) {
        navigate('/', { replace: true });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        navigate('/', { replace: true });
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        backgroundImage: 'url("/images/login_bg.png")',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        overflowY: 'auto',
        overflowX: 'hidden',
        color: '#f8fbff',
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background: 'rgba(5, 10, 18, 0.48)',
        }}
      />
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background: `
            radial-gradient(circle at 50% 50%, transparent 40%, rgba(3, 6, 12, 0.20) 66%, rgba(3, 6, 12, 0.42) 100%),
            radial-gradient(circle at 0% 0%, rgba(3, 6, 12, 0.34) 0%, transparent 36%),
            radial-gradient(circle at 100% 0%, rgba(3, 6, 12, 0.32) 0%, transparent 34%),
            radial-gradient(circle at 100% 100%, rgba(3, 6, 12, 0.36) 0%, transparent 36%),
            radial-gradient(circle at 0% 100%, rgba(3, 6, 12, 0.32) 0%, transparent 34%)
          `,
        }}
      />
      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          minHeight: '100%',
          boxSizing: 'border-box',
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(360px, 440px)' },
          alignItems: { xs: 'center', md: 'stretch' },
          gap: { xs: 3, md: 8 },
          maxWidth: 1260,
          mx: 'auto',
          px: { xs: 2.5, sm: 4, md: 7 },
          py: { xs: 3, sm: 5, md: 7 },
        }}
      >
        <Stack
          direction="row"
          spacing={{ xs: 1.5, sm: 2 }}
          alignItems="center"
          sx={{
            alignSelf: { xs: 'end', md: 'start' },
            maxWidth: 540,
            textShadow: '0 2px 24px rgba(0, 0, 0, 0.52)',
          }}
        >
          <Box
            component="img"
            src="/favicon.svg"
            alt=""
            aria-hidden="true"
            sx={{
              height: { xs: 68, sm: 100 },
              flex: '0 0 auto',
              objectFit: 'contain',
              filter: 'drop-shadow(0 10px 24px rgba(0, 0, 0, 0.36))',
            }}
          />

          <Box>
            <Typography
              component="p"
              sx={{
                fontSize: { xs: '2.15rem', sm: '2.8rem', md: '3.65rem' },
                fontWeight: 900,
                letterSpacing: 0,
                lineHeight: 0.95,
                color: '#ffffff',
              }}
            >
              Hex<Box component="span" sx={{ color: 'var(--forge-gold)' }}>
                Forge
              </Box>
            </Typography>
          </Box>
        </Stack>

        <Paper
          component="section"
          elevation={0}
          sx={{
            position: 'relative',
            alignSelf: { xs: 'start', md: 'center' },
            justifySelf: { xs: 'center', md: 'end' },
            p: { xs: 3, sm: 4 },
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            background:
              'linear-gradient(135deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.08) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.26)',
            borderRadius: '8px',
            boxShadow:
              '0 28px 90px rgba(0, 0, 0, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.24)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            textAlign: 'left',
            width: '100%',
            maxWidth: { xs: 420, md: 430 },
            maxHeight: { xs: 'none', md: '100%' },
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <Stack spacing={2.5} alignItems="stretch" sx={{ width: '100%' }}>
            <Box sx={{ width: '100%' }}>
              <Typography
                component="h1"
                variant="h4"
                sx={{
                  mb: 0.75,
                  color: '#ffffff',
                  fontWeight: 800,
                  letterSpacing: 0,
                  lineHeight: 1.1,
                }}
              >
                Welcome back
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: 'rgba(218, 232, 250, 0.78)',
                  fontSize: '0.98rem',
                }}
              >
                HexForge.
              </Typography>
            </Box>

            {errorMessage && (
              <Typography
                role="alert"
                sx={{
                  px: 1.5,
                  py: 1,
                  borderRadius: '8px',
                  color: '#ffd5d5',
                  backgroundColor: 'rgba(127, 29, 29, 0.32)',
                  border: '1px solid rgba(248, 113, 113, 0.34)',
                }}
              >
                {errorMessage}
              </Typography>
            )}

            <Button
              fullWidth
              variant="outlined"
              size="large"
              sx={{
                mt: 0.5,
                minHeight: 54,
                py: 1.45,
                textTransform: 'none',
                fontSize: '1rem',
                fontWeight: 700,
                letterSpacing: 0,
                borderColor: 'rgba(255, 255, 255, 0.28)',
                color: '#f8fbff',
                background:
                  'linear-gradient(135deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.10) 100%)',
                borderWidth: 1.5,
                borderRadius: '8px',
                boxShadow:
                  'inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 14px 32px rgba(0, 0, 0, 0.24)',
                '&:hover': {
                  background:
                    'linear-gradient(135deg, rgba(255, 255, 255, 0.24) 0%, rgba(255, 255, 255, 0.14) 100%)',
                  borderColor: 'rgba(255, 255, 255, 0.42)',
                  boxShadow:
                    'inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 18px 36px rgba(3, 10, 24, 0.28)',
                },
                '&:active': {
                  transform: 'translateY(1px)',
                },
                '&.Mui-focusVisible': {
                  outline: '2px solid rgba(255, 255, 255, 0.9)',
                  outlineOffset: 3,
                },
                '&.Mui-disabled': {
                  color: 'rgba(248, 251, 255, 0.54)',
                  borderColor: 'rgba(255, 255, 255, 0.12)',
                  background: 'rgba(255, 255, 255, 0.08)',
                },
                transition:
                  'transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease',
              }}
              onClick={async () => {
                setLoading(true)
                try {
                  await requestGoogleSignIn()
                } catch (err) {
                  console.error('OAuth start error', err)
                  setLoading(false)
                }
              }}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <GoogleColorIcon />}
            >
              {loading ? 'Connecting...' : 'Continue with Google'}
            </Button>

            <Typography
              variant="caption"
              sx={{
                color: 'rgba(218, 232, 250, 0.78)',
                lineHeight: 1.6,
              }}
            >
              Authorized departmental staff only. By continuing, you acknowledge the{' '}
              <Link component={RouterLink} to="/privacy" sx={{ color: '#eaf6ff', fontWeight: 700 }}>
                Privacy Policy
              </Link>
              {' '}and{' '}
              <Link component={RouterLink} to="/terms" sx={{ color: '#eaf6ff', fontWeight: 700 }}>
                Terms
              </Link>
              . App details are available on the{' '}
              <Link component={RouterLink} to="/about" sx={{ color: '#eaf6ff', fontWeight: 700 }}>
                overview page
              </Link>
              .
            </Typography>
          </Stack>
        </Paper>
      </Box>
    </Box>
  )
}

function useQueryErrorMessage() {
  const [msg] = useState<string | null>(() => {
    try {
      const p = new URLSearchParams(window.location.search)
      const e = p.get('error') || p.get('access')
      if (e) {
        if (e === 'denied' || e === 'access_denied') return 'You do not have access. Contact admin.'
        return e
      }
    } catch {
      // ignore
    }
    return null
  })
  return msg
}
