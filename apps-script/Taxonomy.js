/* ============================================================
   ACCE Archive - shared vocabulary.
   Keep identical to public/js/taxonomy.js (a test enforces it).
   ============================================================ */
const TAXONOMY = {
  collections: {
    bsc: 'BSc archive',
    msc: 'MSc archive',
    qbank: 'Question banks',
    misc: 'Miscellaneous'
  },
  types: {
    lecture: 'Lecture notes & slides',
    book: 'Book / reference text',
    question: 'Question paper',
    solution: 'Solution / answer script',
    lab: 'Lab manual / report',
    thesis: 'Thesis / project report',
    paper: 'Research paper / article',
    syllabus: 'Syllabus / curriculum',
    notice: 'Notice / form',
    software: 'Software / tool',
    dataset: 'Dataset',
    media: 'Audio / video',
    other: 'Other'
  },
  examKinds: {
    final: 'Term final',
    incourse: 'In-course / mid-term',
    quiz: 'Class test / quiz',
    lab: 'Lab exam',
    viva: 'Viva',
    assignment: 'Assignment'
  },
  levels: ['1-1', '1-2', '2-1', '2-2', '3-1', '3-2', '4-1', '4-2', 'MS-1', 'MS-2', 'MS-3'],
  languages: { en: 'English', bn: 'Bangla', mixed: 'Mixed' },
  rights: {
    own: 'My own work',
    permission: 'Shared with the author’s permission',
    open: 'Openly licensed or public domain',
    educational: 'Departmental material for educational use'
  },
  affiliations: {
    student: 'Current student',
    alumni: 'Alumnus / alumna',
    faculty: 'Faculty member',
    staff: 'Staff',
    guest: 'Guest / other'
  },
  // extension -> MIME. The server trusts this map, never the browser's MIME.
  extensions: {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    odt: 'application/vnd.oasis.opendocument.text',
    odp: 'application/vnd.oasis.opendocument.presentation',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    rtf: 'application/rtf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    tex: 'application/x-tex',
    epub: 'application/epub+zip',
    djvu: 'image/vnd.djvu',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    zip: 'application/zip',
    '7z': 'application/x-7z-compressed',
    rar: 'application/vnd.rar',
    ipynb: 'application/x-ipynb+json',
    py: 'text/x-python',
    m: 'text/x-matlab',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'video/mp4'
  }
};
