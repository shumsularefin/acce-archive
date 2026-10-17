/* ============================================================
   Firestore REST helpers. Calls run as the script owner (an IAM
   principal on the Firebase project), so security rules do not
   apply here - every write is validated in Code.js first.
   ============================================================ */

function fsBase_() {
  return 'https://firestore.googleapis.com/v1/projects/' + cfg_().projectId + '/databases/(default)/documents';
}

function fsFetch_(method, url, body) {
  const res = UrlFetchApp.fetch(url, {
    method: method,
    contentType: 'application/json',
    payload: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      // bill and authorise against the Firebase project, not the script's hidden project
      'X-Goog-User-Project': cfg_().projectId
    },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  return { code: code, json: text ? JSON.parse(text) : {} };
}

/* ---------- value encoding ---------- */
function toValue_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue_) } };
  switch (typeof v) {
    case 'boolean': return { booleanValue: v };
    case 'number': return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    case 'string': return { stringValue: v };
    case 'object': return { mapValue: { fields: toFields_(v) } };
  }
  throw new Error('Unsupported Firestore value: ' + typeof v);
}

function toFields_(obj) {
  const out = {};
  Object.keys(obj).forEach(function (k) { if (obj[k] !== undefined) out[k] = toValue_(obj[k]); });
  return out;
}

function fromValue_(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue_);
  if ('mapValue' in v) return fromFields_(v.mapValue.fields || {});
  if ('referenceValue' in v) return v.referenceValue;
  return null;
}

function fromFields_(fields) {
  const out = {};
  Object.keys(fields || {}).forEach(function (k) { out[k] = fromValue_(fields[k]); });
  return out;
}

function docId_(name) { return name.split('/').pop(); }

/* ---------- CRUD ---------- */
function fsGet_(path) {
  const r = fsFetch_('get', fsBase_() + '/' + path);
  if (r.code === 404) return null;
  if (r.code !== 200) throw fsError_(r);
  const d = fromFields_(r.json.fields);
  d._id = docId_(r.json.name);
  return d;
}

/** Create a document; fails with code "exists" if it is already there. */
function fsCreate_(collection, id, data) {
  const url = fsBase_() + '/' + collection + (id ? '?documentId=' + encodeURIComponent(id) : '');
  const r = fsFetch_('post', url, { fields: toFields_(data) });
  if (r.code === 409) { const e = new Error('Document exists'); e.code = 'exists'; throw e; }
  if (r.code !== 200) throw fsError_(r);
  return docId_(r.json.name);
}

/** Merge the given top-level (or dotted) fields into a document, creating it if needed. */
function fsPatch_(path, data, opts) {
  opts = opts || {};
  const keys = Object.keys(data);
  let qs = keys.map(function (k) { return 'updateMask.fieldPaths=' + encodeURIComponent(k); }).join('&');
  if (opts.mustExist) qs += '&currentDocument.exists=true';
  const r = fsFetch_('patch', fsBase_() + '/' + path + '?' + qs, { fields: toFields_(expandDotted_(data)) });
  if (r.code !== 200) throw fsError_(r);
}

/** Replace a whole document. */
function fsSet_(path, data) {
  const r = fsFetch_('patch', fsBase_() + '/' + path, { fields: toFields_(data) });
  if (r.code !== 200) throw fsError_(r);
}

function fsDelete_(path) {
  const r = fsFetch_('delete', fsBase_() + '/' + path);
  if (r.code !== 200 && r.code !== 404) throw fsError_(r);
}

/** {'a.b': 1} -> {a: {b: 1}} so the request body matches the update mask. */
function expandDotted_(data) {
  const out = {};
  Object.keys(data).forEach(function (k) {
    const parts = k.split('.');
    let node = out;
    parts.slice(0, -1).forEach(function (p) { node = node[p] = node[p] || {}; });
    node[parts[parts.length - 1]] = data[k];
  });
  return out;
}

/* ---------- queries ---------- */
const FS_OPS_ = { '==': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL',
  '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', 'in': 'IN', 'array-contains': 'ARRAY_CONTAINS' };

function structuredQuery_(collection, filters, orderBy, limit) {
  const q = { from: [{ collectionId: collection }] };
  const fs = (filters || []).map(function (f) {
    return { fieldFilter: { field: { fieldPath: f[0] }, op: FS_OPS_[f[1]], value: toValue_(f[2]) } };
  });
  if (fs.length === 1) q.where = fs[0];
  if (fs.length > 1) q.where = { compositeFilter: { op: 'AND', filters: fs } };
  if (orderBy) q.orderBy = [{ field: { fieldPath: orderBy[0] }, direction: orderBy[1] === 'desc' ? 'DESCENDING' : 'ASCENDING' }];
  if (limit) q.limit = limit;
  return q;
}

function fsQuery_(collection, filters, orderBy, limit) {
  const r = fsFetch_('post', fsBase_() + ':runQuery', { structuredQuery: structuredQuery_(collection, filters, orderBy, limit) });
  if (r.code !== 200) throw fsError_(r);
  return (r.json || []).filter(function (x) { return x.document; }).map(function (x) {
    const d = fromFields_(x.document.fields);
    d._id = docId_(x.document.name);
    return d;
  });
}

function fsCount_(collection, filters) {
  const r = fsFetch_('post', fsBase_() + ':runAggregationQuery', {
    structuredAggregationQuery: {
      structuredQuery: structuredQuery_(collection, filters),
      aggregations: [{ alias: 'n', count: {} }]
    }
  });
  if (r.code !== 200) throw fsError_(r);
  const row = (r.json || [])[0];
  return row && row.result ? Number(row.result.aggregateFields.n.integerValue) : 0;
}

/** Batched writes: [{set: path, data}] or [{del: path}]. Max 500 per call. */
function fsCommit_(writes) {
  const base = 'projects/' + cfg_().projectId + '/databases/(default)/documents/';
  for (let i = 0; i < writes.length; i += 400) {
    const chunk = writes.slice(i, i + 400).map(function (w) {
      return w.del ? { delete: base + w.del } : { update: { name: base + w.set, fields: toFields_(w.data) } };
    });
    const r = fsFetch_('post', fsBase_() + ':commit', { writes: chunk });
    if (r.code !== 200) throw fsError_(r);
  }
}

function fsError_(r) {
  const msg = (r.json && r.json.error && r.json.error.message) || ('HTTP ' + r.code);
  const e = new Error('Firestore: ' + msg);
  e.code = 'backend';
  return e;
}
