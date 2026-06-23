import { supabase } from '../lib/supabaseClient';
import { v4 as uuidv4 } from 'uuid';

export async function uploadThumbnailFromBlobUrl(blobUrl: string): Promise<string | null> {
    try {
        if (!blobUrl) return null;

        if (blobUrl.startsWith('blob:')) {
            // Only allow upload when there's an active authenticated session
            try {
                const { data: sessionData } = await supabase.auth.getSession();
                const session = sessionData.session;
                if (!session) {
                    console.warn('No active session: skipping thumbnail upload');
                    return blobUrl;
                }
            } catch (e) {
                console.warn('Unable to verify session, skipping upload', e);
                return blobUrl;
            }
            const response = await fetch(blobUrl);
            const blob = await response.blob();
            
            const fileName = `${uuidv4()}.png`;
            
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('Thumbnails')
                .upload(`${fileName}`, blob, {
                    contentType: 'image/png',
                    cacheControl: '3600',
                    upsert: false
                });

            if (uploadError) {
                console.error('Error uploading thumbnail:', uploadError);
                return blobUrl; // fallback
            }

            // Ensure the path passed to getPublicUrl is relative to the bucket
            let publicPath = uploadData?.path || fileName;
            if (/^[^/]+\//.test(publicPath)) {
                publicPath = publicPath.replace(/^[^/]+\//, '');
            }

            const { data: publicUrlData } = supabase.storage
                .from('Thumbnails')
                .getPublicUrl(publicPath);

            const publicUrl = publicUrlData?.publicUrl || null;

            return publicUrl;
        }

        // Just return if it's already an http/https url (like an existing image or placehold.co)
        return blobUrl;
    } catch (e) {
        console.error('Failed to upload thumbnail:', e);
        return blobUrl;
    }
}
