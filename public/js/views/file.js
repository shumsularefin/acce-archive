/* ============================================================
   #/file/<id> - permanent link to one file. Resolves its folder
   and redirects to the browser with the preview open.
   ============================================================ */
import { h, icon, emptyState, fill } from '../lib/dom.js';
import { fileMeta, trailFor, rootKeyOf } from '../services/drive.js';

export async function render({ root, params }) {
  const id = params[0];
  root.append(h('section', { class: 'page center-page' }, h('div', { class: 'stat stat-loading' }, h('span', { class: 'spinner' }), h('span', { text: 'Finding that file…' }))));
  try {
    const f = await fileMeta(id);
    const trail = f.parents?.[0] && await trailFor(f.parents[0]);
    if (!trail) throw new Error('not in the archive');
    const key = rootKeyOf(trail[0].id);
    location.replace(`#/browse/${key}${trail.slice(1).map((t) => '/' + t.id).join('')}?file=${encodeURIComponent(id)}`);
  } catch {
    fill(root, h('section', { class: 'page narrow' }, emptyState('alert', 'That file is not available',
      'It may have been moved, renamed or withdrawn from public view.', h('a', { class: 'btn btn-primary', href: '#/search' }, icon('search'), 'Search the archive'))));
  }
}
