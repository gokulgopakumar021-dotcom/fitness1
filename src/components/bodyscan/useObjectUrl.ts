import { useEffect, useState } from 'react';

/**
 * Turns an in-memory Blob into a temporary object URL for <img>, and revokes it
 * when the blob changes or the component unmounts. The URL is only valid inside
 * this tab; nothing is written anywhere.
 */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url;
}
