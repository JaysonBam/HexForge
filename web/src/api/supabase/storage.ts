import type { Part } from '../../types';
import { supabase } from '../../lib/supabaseClient';

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

  const { data: sessionData } = await supabase.auth.getSession();
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
