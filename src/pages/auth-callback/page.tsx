/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import {
  captureGoogleProviderTokenFromUrl,
  syncGoogleProviderTokensFromSession
} from '../../utils/gmailDraftUtils'

export default function AuthCallbackPage() {
  useEffect(() => {
    ;(async () => {
      try {
        // Let Supabase parse the URL and finalize session
        // Prefer the helper if available, otherwise fall back to parsing URL fragment
        let data: any = undefined
        let error: any = undefined

        captureGoogleProviderTokenFromUrl()

        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')
        const exchangeCodeForSession = (supabase.auth as unknown as { exchangeCodeForSession?: (...args: unknown[]) => Promise<any> }).exchangeCodeForSession
        const getSessionFromUrl = (supabase.auth as unknown as { getSessionFromUrl?: (...args: unknown[]) => Promise<any> }).getSessionFromUrl

        if (code && typeof exchangeCodeForSession === 'function') {
          ;({ data, error } = await exchangeCodeForSession.call(supabase.auth, code))
        } else if (typeof getSessionFromUrl === 'function') {
          ;({ data, error } = await getSessionFromUrl.call(supabase.auth, { storeSession: true }))
        } else {
          try {
            const hash = window.location.hash || window.location.search || ''
            const params = new URLSearchParams(hash.replace(/^#/, ''))
            const access_token = params.get('access_token')
            const refresh_token = params.get('refresh_token')
            if (access_token) {
              const setSession = (supabase.auth as unknown as { setSession?: (...args: unknown[]) => Promise<any> }).setSession
              if (typeof setSession === 'function') {
                const res = await setSession.call(supabase.auth, { access_token, refresh_token })
                data = res?.data || { session: res?.session }
                error = res?.error
              } else {
                // final fallback: try to get current session
                const res = await supabase.auth.getSession()
                data = res?.data || res
                error = res?.error
              }
            } else {
              const res = await supabase.auth.getSession()
              data = res?.data || res
              error = res?.error
            }
          } catch (e) {
            error = e
          }
        }

        if (error) {
          console.error('Error getting session from URL', error)
          const msg = (error && (error.message || String(error))) || 'oauth_error'
          window.location.href = '/login?error=' + encodeURIComponent('oauth: ' + msg)
          return
        }

        let session = data?.session || data?.session?.value || data
        const storedSessionResult = await supabase.auth.getSession()
        if (storedSessionResult.data.session) {
          syncGoogleProviderTokensFromSession(storedSessionResult.data.session as any)
          session = storedSessionResult.data.session
        }
        syncGoogleProviderTokensFromSession(session)
        const user = session?.user
        const email = user?.email
        if (!user || !email) {
          await supabase.auth.signOut()
          window.location.href = '/?error=oauth'
          return
        }

        // Check profiles table for access
        const { data: profile, error: selectErr } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', email)
          .maybeSingle()

        if (selectErr) {
          console.error('Profile select error', selectErr)
          await supabase.auth.signOut()
          const msg = (selectErr && (selectErr.message || String(selectErr))) || 'select_error'
          window.location.href = '/login?error=' + encodeURIComponent('server: ' + msg)
          return
        }

        if (!profile) {
          // Not on the allow-list -> sign out and show message
          await supabase.auth.signOut()
          window.location.href = '/login?access=denied'
          return
        }

        // If pending or active, update row with latest info (id, full_name, profile_url)
        // Also, if the profile is 'pending', mark it 'active' to indicate first successful sign-in.
        const updates: any = {}
        if (!profile.id && user.id) updates.id = user.id
        const metadata: any = (user.user_metadata as any) || {}
        const identities = (user.identities as Array<{ provider?: string; identity_data?: Record<string, unknown> }> | undefined) || []
        const googleIdentity = identities.find((identity) => identity.provider === 'google') || identities[0]
        const identityData = googleIdentity?.identity_data || {}
        const fullName = metadata.full_name || metadata.name || identityData.full_name || identityData.name
        const profileUrl = metadata.avatar_url || metadata.picture || identityData.avatar_url || identityData.picture
        if (typeof fullName === 'string' && fullName.trim()) updates.full_name = fullName
        if (typeof profileUrl === 'string' && profileUrl.trim()) updates.profile_url = profileUrl

        if (profile.status === 'pending') {
          updates.status = 'active'
        }

        if (Object.keys(updates).length > 0) {
          const { error: updateErr } = await supabase
            .from('profiles')
            .update(updates)
            .eq('email', email)

          if (updateErr) {
            console.error('Profile update error', updateErr)
            await supabase.auth.signOut()
            const msg = (updateErr && (updateErr.message || String(updateErr))) || 'update_error'
            window.location.href = '/login?error=' + encodeURIComponent('update: ' + msg)
            return
          }
        }

        // Authorized — navigate to dashboard.
        const next = params.get('next')
        const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
        const redirectTo = safeNext === '/login' || safeNext.startsWith('/login?') || safeNext.startsWith('/auth-callback')
          ? '/'
          : safeNext
        window.location.href = redirectTo
      } catch (err) {
        console.error('Auth callback unexpected error', err)
        await supabase.auth.signOut().catch(() => {})
        const msg = err && (err instanceof Error ? err.message : String(err))
        window.location.href = '/login?error=' + encodeURIComponent('unexpected: ' + (msg || 'unknown'))
      }
    })()
  }, [])

  return null
}
