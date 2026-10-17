/* ============================================================
   One-time setup and scheduled maintenance.
   Run setup() once from the Apps Script editor (see docs/SETUP.md).
   ============================================================ */

/**
 * Creates the private system folders, the daily maintenance trigger,
 * the default settings document and the owner admin records.
 * Safe to run again: it only fills in what is missing.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  const p = props.getProperties();
  const log = [];

  if (!p.FIREBASE_API_KEY) throw new Error('Set the FIREBASE_API_KEY script property first (Firebase console > Project settings > Web API key).');
  if (!p.OWNER_EMAILS) props.setProperty('OWNER_EMAILS', Session.getEffectiveUser().getEmail().toLowerCase());

  let system = p.SYSTEM_FOLDER_ID && safeFolder_(p.SYSTEM_FOLDER_ID);
  if (!system) {
    system = DriveApp.createFolder('ACCE Archive — system (private)');
    system.setDescription('Holds submissions awaiting review and withdrawn files. Do not share publicly.');
    props.setProperty('SYSTEM_FOLDER_ID', system.getId());
    log.push('Created system folder ' + system.getId());
  }
  [['PENDING_FOLDER_ID', 'Pending submissions'], ['WITHDRAWN_FOLDER_ID', 'Withdrawn from public view']].forEach(function (pair) {
    if (!(p[pair[0]] && safeFolder_(p[pair[0]]))) {
      const f = system.createFolder(pair[1]);
      props.setProperty(pair[0], f.getId());
      log.push('Created ' + pair[1] + ' folder ' + f.getId());
    }
  });
  CFG_ = null;

  if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyMaintenance'; })) {
    ScriptApp.newTrigger('dailyMaintenance').timeBased().everyDays(1).atHour(3).create();
    log.push('Scheduled dailyMaintenance');
  }

  if (!fsGet_('config/settings')) {
    fsSet_('config/settings', DEFAULT_SETTINGS);
    log.push('Wrote default config/settings');
  }
  cfg_().owners.forEach(function (email) {
    if (!fsGet_('admins/' + encodeURIComponent(email))) {
      fsSet_('admins/' + encodeURIComponent(email), { email: email, role: 'owner', addedBy: 'setup', addedAt: new Date(), notify: true });
      log.push('Registered owner ' + email);
    }
  });

  Object.keys(cfg_().roots).forEach(function (k) {
    const f = safeFolder_(cfg_().roots[k]);
    log.push(k + ' root: ' + (f ? f.getName() + ' (' + f.getSharingAccess() + ')' : 'NOT ACCESSIBLE'));
  });
  console.log(log.join('\n'));
  return log;
}

/** Prints what is configured and what is missing. */
function checkSetup() {
  const c = cfg_();
  const issues = [];
  if (!c.apiKey) issues.push('FIREBASE_API_KEY is not set');
  if (!c.pendingFolder) issues.push('PENDING_FOLDER_ID missing - run setup()');
  if (!c.owners.length) issues.push('OWNER_EMAILS is empty');
  try { fsGet_('config/settings'); } catch (e) { issues.push('Firestore not reachable: ' + e.message); }
  try { const q = storageQuota_(); console.log('Storage: ' + (q.usage / 1073741824).toFixed(2) + ' GB of ' + (q.limit ? (q.limit / 1073741824).toFixed(0) + ' GB' : 'unlimited')); }
  catch (e) { issues.push('Drive API not reachable: ' + e.message); }
  console.log(issues.length ? 'Problems:\n- ' + issues.join('\n- ') : 'Everything looks configured.');
  return issues;
}

function safeFolder_(id) {
  try { const f = DriveApp.getFolderById(id); return f.isTrashed() ? null : f; } catch (e) { return null; }
}

/** Time-driven trigger target. */
function dailyMaintenance() {
  console.log(JSON.stringify(cleanup_()));
}

/**
 * - submissions stuck in "uploading" for a day become "abandoned"
 * - files in the Pending folder that no live submission refers to are deleted
 */
function cleanup_() {
  let abandoned = 0, orphans = 0, freed = 0;
  const cutoff = new Date(Date.now() - 864e5);
  fsQuery_('submissions', [['status', '==', 'uploading']], null, 300).forEach(function (s) {
    if (s.createdAt < cutoff) {
      fsPatch_('submissions/' + s._id, { status: 'abandoned', updatedAt: new Date() });
      abandoned++;
    }
  });
  if (cfg_().pendingFolder) {
    let token = null;
    do {
      const page = driveList_("'" + cfg_().pendingFolder + "' in parents and trashed=false", 'id,name,size,appProperties,createdTime', token);
      (page.files || []).forEach(function (f) {
        const sid = f.appProperties && f.appProperties.submissionId;
        const sub = sid && fsGet_('submissions/' + sid);
        const young = Date.now() - Date.parse(f.createdTime) < 36e5;   // never race an upload that is finishing
        if (!young && (!sub || sub.status !== 'pending')) {
          driveDelete_(f.id);
          orphans++;
          freed += Number(f.size || 0);
        }
      });
      token = page.nextPageToken;
    } while (token);
  }
  return { abandoned: abandoned, orphansDeleted: orphans, bytesFreed: freed };
}

/**
 * Walks every public collection and records each file's SHA-256 so new
 * submissions that duplicate existing material are refused before upload.
 */
function indexFingerprints_() {
  const started = Date.now();
  const roots = cfg_().roots;
  let queue = Object.keys(roots).map(function (k) { return roots[k]; });
  const writes = [];
  const seen = {};
  let files = 0, bytes = 0, folders = 0;

  while (queue.length && Date.now() - started < 300000) {
    const batch = queue.splice(0, 20);
    const q = '(' + batch.map(function (id) { return "'" + id + "' in parents"; }).join(' or ') + ') and trashed=false';
    let token = null;
    do {
      const page = driveList_(q, 'id,name,mimeType,size,sha256Checksum', token);
      (page.files || []).forEach(function (f) {
        if (f.mimeType === FOLDER_MIME_) { if (!seen[f.id]) { seen[f.id] = 1; queue.push(f.id); folders++; } return; }
        files++;
        bytes += Number(f.size || 0);
        if (f.sha256Checksum) writes.push({ set: 'fingerprints/' + f.sha256Checksum, data: {
          sha256: f.sha256Checksum, size: Number(f.size || 0), name: f.name, driveId: f.id,
          source: 'legacy', status: 'published', at: new Date()
        } });
      });
      token = page.nextPageToken;
    } while (token);
  }
  fsCommit_(writes);
  return { files: files, folders: folders, bytes: bytes, fingerprints: writes.length, complete: queue.length === 0 };
}
