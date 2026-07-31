/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect } from 'react'
import {
  completeOAuthSessionFromCurrentUrl,
  getAuthSession,
  signOut
} from '@/api/supabase/auth'
import { getProfileByEmail, updateProfileByEmail } from '@/api/supabase/profiles'
import { clearGoogleProviderTokens } from '@/api/google/gmail/client'

export default function AuthCallbackPage() {
  useEffect(() => {
    ;(async () => {
      try {
        // Let Supabase parse the URL and finalize session
        // Prefer the helper if available, otherwise fall back to parsing URL fragment
        let data: any = undefined
        let error: any = undefined

        clearGoogleProviderTokens()

        const params = new URLSearchParams(window.location.search)
        ;({ data, error } = await completeOAuthSessionFromCurrentUrl())

        if (error) {
          console.error('Error getting session from URL', error)
          const msg = (error && (error.message || String(error))) || 'oauth_error'
          window.location.href = '/login?error=' + encodeURIComponent('oauth: ' + msg)
          return
        }

        let session = data?.session || data?.session?.value || data
        const storedSessionResult = await getAuthSession()
        if (storedSessionResult.data.session) {
          session = storedSessionResult.data.session
        }
        const user = session?.user
        const email = user?.email
        if (!user || !email) {
          await signOut()
          window.location.href = '/?error=oauth'
          return
        }

        // Check profiles table for access
        const { data: profile, error: selectErr } = await getProfileByEmail(email)

        if (selectErr) {
          console.error('Profile select error', selectErr)
          await signOut()
          const msg = (selectErr && (selectErr.message || String(selectErr))) || 'select_error'
          window.location.href = '/login?error=' + encodeURIComponent('server: ' + msg)
          return
        }

        if (!profile) {
          // Not on the allow-list -> sign out and show message
          await signOut()
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
        if (typeof fullName === 'string' && fullName.trim() && fullName !== profile.full_name) updates.full_name = fullName
        if (typeof profileUrl === 'string' && profileUrl.trim() && profileUrl !== profile.profile_url) updates.profile_url = profileUrl

        if (profile.status === 'pending') {
          updates.status = 'active'
        }

        if (Object.keys(updates).length > 0) {
          const { error: updateErr } = await updateProfileByEmail(email, updates)

          if (updateErr) {
            console.error('Profile update error', updateErr)
            if (!profile.id || profile.status === 'pending') {
              await signOut()
              const msg = (updateErr && (updateErr.message || String(updateErr))) || 'update_error'
              window.location.href = '/login?error=' + encodeURIComponent('update: ' + msg)
              return
            }
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
        await signOut().catch(() => {})
        const msg = err && (err instanceof Error ? err.message : String(err))
        window.location.href = '/login?error=' + encodeURIComponent('unexpected: ' + (msg || 'unknown'))
      }
    })()
  }, [])

  return null
}
