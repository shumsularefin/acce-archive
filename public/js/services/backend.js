/* ============================================================
   Client for the Apps Script submission backend.
   Requests are sent as text/plain so the browser skips the CORS
   preflight that Apps Script cannot answer.
   ============================================================ */
import { CONFIG } from '../config.js';
import { idToken, initFirebase, getSettings } from './firebase.js';
import { TAXONOMY } from '../taxonomy.js';

/* The upload service is the Apps Script web app. Its URL comes from config.js, or, so that
   owners can switch uploads on without editing code, from Dashboard > Settings
   (Firestore config/settings.backendUrl). */
const SERVICE_RE = /^https:\/\/script\.google\.com\/(?:a\/[\w.-]+\/)?macros\/s\/[\w-]+\/exec$/;
export const isServiceUrl = (u) => SERVICE_RE.test(String(u || '').trim());
let serviceUrl = isServiceUrl(CONFIG.backendUrl) ? CONFIG.backendUrl : '';
export const backendReady = () => !!serviceUrl;
export const serviceUrlFromCode = () => isServiceUrl(CONFIG.backendUrl);
export function useServiceUrl(u) {
  if (serviceUrlFromCode()) return;
  serviceUrl = isServiceUrl(u) ? String(u).trim() : '';
  configPromise = null;
}

/** Resolve the service URL (one cached settings read). Resolves to backendReady(). */
let loadPromise;
export function loadBackend() {
  if (serviceUrlFromCode()) return Promise.resolve(true);
  loadPromise ||= initFirebase().then(async (ok) => { if (ok) useServiceUrl((await getSettings()).backendUrl); return backendReady(); });
  return loadPromise;
}

export class BackendError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export async function call(action, payload = {}, { auth = true, signal, url = serviceUrl } = {}) {
  if (!url) throw new BackendError('misconfigured', 'Uploads are not switched on yet.');
  const body = { action, ...payload };
  if (auth) body.idToken = await idToken();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', body: JSON.stringify(body), signal, redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new BackendError('network', 'Could not reach the archive service. Check your connection.');
  }
  let data;
  try { data = await res.json(); } catch { throw new BackendError('network', `The archive service answered unexpectedly (${res.status}).`); }
  if (!data.ok) throw new BackendError(data.error?.code || 'internal', data.error?.message || 'Request failed.');
  return data.data;
}

let configPromise;
export function backendConfig() {
  configPromise ||= call('config', {}, { auth: false }).catch(() => null);
  return configPromise;
}

/* ---------- files ---------- */
export const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
export const acceptAttr = Object.keys(TAXONOMY.extensions).map((e) => '.' + e).join(',');

export async function sha256(file) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Upload one file with metadata. onProgress({phase, loaded, total}).
 * Chunks are retried with backoff; the server re-syncs the offset if a
 * response was lost, so a flaky connection does not corrupt the file.
 */
export async function uploadFile(file, meta, { onProgress, signal } = {}) {
  onProgress?.({ phase: 'hashing', loaded: 0, total: file.size });
  const hash = await sha256(file);
  onProgress?.({ phase: 'starting', loaded: 0, total: file.size });
  const init = await call('init', { meta, file: { name: file.name, size: file.size, sha256: hash } }, { signal });

  let offset = 0;
  const chunk = init.chunkBytes;
  while (offset < file.size) {
    signal?.throwIfAborted?.();
    const part = file.slice(offset, Math.min(offset + chunk, file.size));
    const data = await toBase64(part);
    let result, attempt = 0;
    for (;;) {
      try {
        result = await call('chunk', { uploadId: init.uploadId, offset, data }, { signal });
        break;
      } catch (e) {
        if (e.name === 'AbortError' || !['network', 'internal', 'backend'].includes(e.code) || ++attempt > 4) throw e;
        onProgress?.({ phase: 'retrying', loaded: offset, total: file.size });
        await sleep(1000 * 2 ** attempt);
      }
    }
    if (result.done) { onProgress?.({ phase: 'done', loaded: file.size, total: file.size }); return init.submissionId; }
    offset = result.next;
    onProgress?.({ phase: 'uploading', loaded: offset, total: file.size });
  }
  throw new BackendError('integrity', 'Upload ended without confirmation. Check “My submissions”.');
}

export const submitLink = (link, meta) => call('init', { kind: 'link', link, meta });
