import type { Part } from '@/types';
import { getAuthSession } from './auth';
import { supabase } from './client';

export const getStoragePathFromImageUrl = (url: string) => {
  const thumbnailSplit = url.split(/\/Thumbnails\/|\/thumbnails\//);
  if (thumbnailSplit.length > 1) {
    return thumbnailSplit[1].split('?')[0];
  }

  const objectSplit = url.split('/storage/v1/object/');
  if (objectSplit.length > 1) {
    const after = objectSplit[1];
    const match = after.match(/(?:public\/)?[^/]+\/(.+)/);
    if (match) {
      return match[1].split('?')[0];
    }
  }

  return null;
};

export const removeProjectPartThumbnails = async (parts: Part[]) => {
  const imagePaths = parts
    .map((part) => (part.imageUrl ? getStoragePathFromImageUrl(part.imageUrl) : null))
    .filter((path): path is string => Boolean(path));

  if (imagePaths.length === 0) {
    return;
  }

  const { data: sessionData } = await getAuthSession();
  if (!sessionData.session) {
    console.warn('Not authenticated: skipping storage object deletion');
    return;
  }

  const uniquePaths = [...new Set(imagePaths)];
  const { error } = await supabase.storage.from('Thumbnails').remove(uniquePaths);
  if (error) {
    console.error('Error deleting storage objects for project parts:', error);
  }
};

export const removePartThumbnail = async (imageUrl: string) => {
  const { data: sessionData } = await getAuthSession();
  if (!sessionData.session) {
    console.warn('Not authenticated: skipping storage object deletion');
    return;
  }

  const filePath = getStoragePathFromImageUrl(imageUrl);
  if (!filePath) {
    console.warn('Could not determine storage path from imageUrl:', imageUrl);
    return;
  }

  const { error } = await supabase.storage.from('Thumbnails').remove([filePath]);
  if (error) console.error('Error deleting storage object for part:', error);
};

export const uploadEmailSignatureImage = async (file: File) => {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `signatures/${crypto.randomUUID()}.${extension}`;
  const { data, error } = await supabase.storage
    .from('email-assets')
    .upload(path, file, {
      cacheControl: '31536000',
      contentType: file.type || 'image/png',
      upsert: false
    });
  if (error) throw error;

  const { data: publicUrlData } = supabase.storage
    .from('email-assets')
    .getPublicUrl(data?.path || path);
  if (!publicUrlData.publicUrl) {
    throw new Error('Supabase did not return a public image URL.');
  }
  return publicUrlData.publicUrl;
};
