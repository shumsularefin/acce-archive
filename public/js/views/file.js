/* ============================================================
   #/file/<id> - permanent link to one item. Links point at the
   catalogue record, so they survive moves between folders and
   storage providers. Falls back to resolving a Drive file's folder
   for material not yet catalogued.
   ============================================================ */
import { h, icon, emptyState, fill } from '../lib/dom.js';
import { fileMeta, trailFor, rootKeyOf } from '../services/drive.js';
import { getItem, libraryHref } from '../services/catalog.js';

export async function render({ root, params }) {
  const id = params[0];
  root.append(h('section', { class: 'page center-page' }, h('div', { class: 'stat stat-loading' }, h('span', { class: 'spinner' }), h('span', { text: 'Finding that item…' }))));
  try {
    const item = await getItem(id);
    if (item?.status === 'published') return location.replace(`${libraryHref(item)}?item=${encodeURIComponent(id)}`);
    if (item) throw new Error('withdrawn');
    const f = await fileMeta(id);
    const trail = f.parents?.[0] && await trailFor(f.parents[0]);
    if (!trail) throw new Error('not in the archive');
    const key = rootKeyOf(trail[0].id);
    location.replace(`#/browse/${key}${trail.slice(1).map((t) => '/' + t.id).join('')}?file=${encodeURIComponent(id)}`);
  } catch {
    fill(root, h('section', { class: 'page narrow' }, emptyState('alert', 'That item is not available',
      'It may have been withdrawn from public view.', h('a', { class: 'btn btn-primary', href: '#/search' }, icon('search'), 'Search the archive'))));
  }
}
