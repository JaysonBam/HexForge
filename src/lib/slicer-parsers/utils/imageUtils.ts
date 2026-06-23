import type JSZip from 'jszip';

export async function extractImage(imageFile: JSZip.JSZipObject | null, fallbackText: string): Promise<string> {
    if (imageFile) {
        try {
            const imageBlob = await imageFile.async("blob");
            return URL.createObjectURL(imageBlob);
        } catch (error) {
            console.error(`Failed to create blob for image:`, error);
        }
    }
    
    // Fallback
    return `https://placehold.co/150x150?text=${encodeURIComponent(fallbackText)}`;
}
