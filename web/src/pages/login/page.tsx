import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAuthSession, subscribeToAuthChanges } from '@/api/supabase/auth';
import { requestGoogleSignIn } from '@/api/google/gmail/client';
import GoogleColorIcon from './components/GoogleIcon';

export default function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const errorMessage = useQueryErrorMessage();

  useEffect(() => {
    let isMounted = true;

    void getAuthSession().then(({ data }) => {
      if (isMounted && data.session) navigate('/', { replace: true });
    });

    const subscription = subscribeToAuthChanges((_event, session) => {
      if (session) navigate('/', { replace: true });
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <main
      className="fixed inset-0 flex items-stretch justify-center overflow-x-hidden overflow-y-auto bg-cover bg-center bg-no-repeat text-slate-50"
      style={{ backgroundImage: 'url("/images/login_bg.png")' }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-slate-950/50" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            'radial-gradient(circle at 50% 50%, transparent 40%, rgba(3, 6, 12, 0.20) 66%, rgba(3, 6, 12, 0.42) 100%)',
            'radial-gradient(circle at 0% 0%, rgba(3, 6, 12, 0.34) 0%, transparent 36%)',
            'radial-gradient(circle at 100% 0%, rgba(3, 6, 12, 0.32) 0%, transparent 34%)',
            'radial-gradient(circle at 100% 100%, rgba(3, 6, 12, 0.36) 0%, transparent 36%)',
            'radial-gradient(circle at 0% 100%, rgba(3, 6, 12, 0.32) 0%, transparent 34%)'
          ].join(', ')
        }}
      />

      <div className="relative z-10 mx-auto grid min-h-full w-full max-w-[1260px] grid-cols-1 items-center gap-6 px-5 py-6 sm:px-8 sm:py-10 md:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] md:items-stretch md:gap-16 md:px-14 md:py-14">
        <div className="flex max-w-[540px] items-center gap-3 self-end drop-shadow-xl sm:gap-4 md:self-start">
          <img
            src="/favicon.svg"
            alt=""
            aria-hidden="true"
            className="h-[68px] shrink-0 object-contain sm:h-[100px]"
          />
          <p className="text-[2.15rem] font-black leading-[0.95] tracking-normal text-white sm:text-[2.8rem] md:text-[3.65rem]">
            Hex<span className="text-[var(--forge-gold)]">Forge</span>
          </p>
        </div>

        <section className="w-full max-w-[430px] justify-self-center self-start overflow-hidden rounded-lg border border-white/25 bg-gradient-to-br from-white/20 to-white/10 p-6 text-left shadow-[0_28px_90px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.24)] backdrop-blur-sm sm:p-8 md:justify-self-end md:self-center">
          <div>
            <h1 className="text-3xl font-extrabold leading-tight text-white">Welcome back</h1>
            <p className="mt-2 text-[0.98rem] text-blue-100/80">HexForge.</p>
          </div>

          {errorMessage && (
            <p role="alert" className="mt-5 rounded-lg border border-red-400/35 bg-red-900/35 px-3 py-2 text-red-100">
              {errorMessage}
            </p>
          )}

          <button
            type="button"
            className="mt-6 flex min-h-[54px] w-full items-center justify-center gap-3 rounded-lg border border-white/30 bg-gradient-to-br from-white/20 to-white/10 px-4 py-3 text-base font-bold text-slate-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_14px_32px_rgba(0,0,0,0.24)] transition hover:border-white/45 hover:from-white/25 hover:to-white/15 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_18px_36px_rgba(3,10,24,0.28)] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white disabled:cursor-wait disabled:border-white/15 disabled:bg-white/10 disabled:text-white/55"
            onClick={async () => {
              setLoading(true);
              try {
                await requestGoogleSignIn();
              } catch (error) {
                console.error('OAuth start error', error);
                setLoading(false);
              }
            }}
            disabled={loading}
          >
            {loading ? (
              <span aria-hidden="true" className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <GoogleColorIcon />
            )}
            {loading ? 'Connecting...' : 'Continue with Google'}
          </button>

          <p className="mt-5 text-xs leading-relaxed text-blue-100/80">
            Authorized departmental staff only. By continuing, you acknowledge the{' '}
            <Link className="font-bold text-blue-50 underline-offset-2 hover:underline" to="/privacy">
              Privacy Policy
            </Link>{' '}
            and{' '}
            <Link className="font-bold text-blue-50 underline-offset-2 hover:underline" to="/terms">
              Terms
            </Link>
            . App details are available on the{' '}
            <Link className="font-bold text-blue-50 underline-offset-2 hover:underline" to="/about">
              overview page
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}

function useQueryErrorMessage() {
  const [message] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const error = params.get('error') || params.get('access');
      if (error) {
        if (error === 'denied' || error === 'access_denied') {
          return 'You do not have access. Contact admin.';
        }
        return error;
      }
    } catch {
      // Ignore malformed query strings and show the normal sign-in view.
    }
    return null;
  });
  return message;
}
