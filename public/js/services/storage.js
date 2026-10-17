/* ============================================================
   Storage adapter. A catalogue item says where its bytes live:
     { provider: 'drive', id }   Google Drive file (shared via the public folders)
     { provider: 'r2', key }     Cloudflare R2 object behind CONFIG.storage.r2PublicBase
     { provider: 'url', url }    external link (videos, publisher pages, Zenodo…)
   Everything that shows, previews or downloads a file asks this module,
   so adding a provider means adding one case here.
   ============================================================ */
import { CONFIG } from '../config.js';

const INLINE = /^(application\/pdf|image\/|video\/|audio\/|text\/plain)/;

const enc = (id) => encodeURIComponent(id);

export function storageOf(entry) {
  if (entry.storage) return entry.storage;
  return entry.kind === 'link' ? { provider: 'url', url: entry.url } : { provider: 'drive', id: entry.id };
}

/** @returns {{provider, preview: string|null, download: string, open: string}} */
export function resolve(entry) {
  const s = storageOf(entry);
  switch (s.provider) {
    case 'drive':
      return {
        provider: 'drive',
        preview: `https://drive.google.com/file/d/${enc(s.id)}/preview`,
        download: entry.webContentLink || `https://drive.google.com/uc?id=${enc(s.id)}&export=download`,
        open: entry.webViewLink || `https://drive.google.com/file/d/${enc(s.id)}/view`
      };
    case 'r2': {
      const base = (CONFIG.storage?.r2PublicBase || '').replace(/\/$/, '');
      const url = `${base}/${String(s.key).split('/').map(enc).join('/')}`;
      return { provider: 'r2', preview: INLINE.test(entry.mimeType || '') ? url : null, download: url, open: url };
    }
    case 'url':
      return { provider: 'url', preview: null, download: s.url, open: s.url };
    default:
      return { provider: s.provider, preview: null, download: '#', open: '#' };
  }
}

export const PROVIDER_LABEL = { drive: 'Google Drive', r2: 'Cloudflare R2', url: 'External link' };
