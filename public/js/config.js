/* ============================================================
   ACCE Archive - site configuration. Edit these.
   ============================================================ */
export const CONFIG = {
  // Public, read-only Drive key used to list the shared archive folders.
  // Restrict it in Google Cloud console to the Drive API and your site's domains.
  driveApiKey: 'AIzaSyB8ZmdkBYTJLmpbTDgQ1uyF8NJZbKt1NKk',

  // Google Drive folder IDs for each public collection.
  folders: {
    bsc:   { id: '1IiI3ZcOMbLLjsHiaveuOeApGqW3O360I', name: 'BSc archive' },
    msc:   { id: '1mCOHlXy9C_NMyiSu15NkMTz18NU1ZXRH', name: 'MSc archive' },
    qbank: { id: '12ZeZZsPMwlrynliFI830PIRmtBY457U0', name: 'Question banks' },
    misc:  { id: '19MiNUd2hWEHmBuAE-AM4Vua-bpmZt4oL', name: 'Miscellaneous' }
  },

  // Submission backend: the Apps Script web app URL ending in /exec (see docs/SETUP.md).
  // Leave empty to keep the archive browse-only.
  backendUrl: '',

  // Firebase web config. Leave null on Firebase Hosting: /__/firebase/init.json supplies it.
  // Paste the object from Project settings > Your apps only for other hosts or local dev.
  firebase: null,

  // Local development only, e.g. { auth: 'http://127.0.0.1:9099', firestore: { host: '127.0.0.1', port: 8080 } }
  emulators: null,

  // Permanent owners: always owners, cannot be removed from the dashboard; they add everyone else.
  // Keep in step with firestore.rules (rootOwners) and apps-script/Code.js (ROOT_OWNERS).
  rootOwners: ['muhammadshamsularefin01@gmail.com'],

  // Where catalogue items keep their bytes. Each item says which provider holds it, so
  // providers can be mixed and files migrated without changing links or metadata.
  storage: {
    r2PublicBase: ''          // e.g. 'https://files.accearchive.example' (Cloudflare R2 public bucket / custom domain)
  },

  // Virtual browsing: the levels under each collection, generated from catalogue metadata.
  library: {
    default: ['level', 'courseCode', 'type'],
    qbank: ['examYear', 'courseCode', 'examKind'],
    misc: ['type', 'session']
  },

  // Recognised course-code prefixes, used to infer metadata for files imported from Drive.
  coursePrefixes: ['ACCE', 'ACE', 'CHE', 'CHEM', 'MATH', 'PHY', 'PHYS', 'EEE', 'CSE', 'ME', 'STAT', 'ENG', 'HUM', 'ECO', 'BIO', 'GED', 'BAN'],

  // Visitors must sign in with Google before browsing. Browsing still works if Firebase is unreachable.
  requireSignIn: true,

  idPattern: /^(\d{2})ACE0(\d{2})$/,   // 20ACE001
  sessionFrom: 2015,
  sessionTo: new Date().getFullYear(),
  cacheMinutes: 10,                   // folder listings
  indexHours: 6,                      // full-archive search index
  maxFileMB: 50                       // shown before the backend reports its own limit
};
