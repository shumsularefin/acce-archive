import test from 'node:test';
import assert from 'node:assert/strict';
import { inferMeta, inferCourse, inferLevel, inferType, cleanTitle } from '../../public/js/lib/infer.js';

const f = (name, path, root, extra = {}) => ({ name, path, root, mimeType: 'application/pdf', ...extra });

test('course codes in many spellings, but years are not courses', () => {
  assert.equal(inferCourse('Year 3 / acce 3101 thermo.pdf'), 'ACCE-3101');
  assert.equal(inferCourse('ACCE_2205 notes'), 'ACCE-2205');
  assert.equal(inferCourse('CHEM-1103A lab'), 'CHEM-1103A');
  assert.equal(inferCourse('Final 2023.pdf'), '');
  assert.equal(inferCourse('CHE 2023 questions'), '');
  assert.equal(inferCourse('places 3101'), '', 'needs a known prefix');
});

test('year/term from common folder names', () => {
  assert.equal(inferLevel(['3rd Year 1st Term'], 'bsc'), '3-1');
  assert.equal(inferLevel(['Year 2 Semester 2'], 'bsc'), '2-2');
  assert.equal(inferLevel(['L4 T1'], 'bsc'), '4-1');
  assert.equal(inferLevel(['4-2', 'ACCE-4201'], 'bsc'), '4-2');
  assert.equal(inferLevel(['Term 2'], 'msc'), 'MS-2');
  assert.equal(inferLevel(['Books'], 'bsc'), '');
});

test('material type heuristics', () => {
  assert.equal(inferType(f('Term final 2022.pdf'), [], 'qbank'), 'question');
  assert.equal(inferType(f('Solution of 2021.pdf'), [], 'qbank'), 'solution');
  assert.equal(inferType(f('Unit operations.pptx', [], 'bsc', { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), [], 'bsc'), 'lecture');
  assert.equal(inferType(f('Treybal 3rd ed. 3.pdf'), ['Books'], 'bsc'), 'book');
  assert.equal(inferType(f('BSc syllabus 2019.pdf'), [], 'misc'), 'syllabus');
  assert.equal(inferType(f('random.pdf'), [], 'misc'), 'other');
});

test('full record prefers stored Drive properties', () => {
  const m = inferMeta(f('ACCE 3101 Term Final 2023.pdf', ['Question banks', '2023'], 'qbank'));
  assert.equal(m.type, 'question');
  assert.equal(m.courseCode, 'ACCE-3101');
  assert.equal(m.examYear, 2023);
  assert.equal(m.examKind, 'final');
  assert.equal(m.title, 'ACCE 3101 Term Final 2023');
  const p = inferMeta(f('x.pdf', ['BSc archive'], 'bsc', { properties: { acce_title: 'Proper title', acce_type: 'book', acce_course: 'ACCE-1101', acce_curriculum: 'Syllabus 2019,Syllabus 2023' } }));
  assert.equal(p.title, 'Proper title');
  assert.equal(p.type, 'book');
  assert.deepEqual(p.curricula, ['Syllabus 2019', 'Syllabus 2023']);
  assert.equal(cleanTitle('mass_transfer_notes.pdf'), 'mass transfer notes');
});
