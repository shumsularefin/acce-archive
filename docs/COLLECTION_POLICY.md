# Collection policy and long-term organisation

This is the archive's working policy. The public version lives on the site under **About & policies** (`public/js/views/about.js`). Keep the two in step.

## 1. Purpose

To preserve the teaching, learning and research material of the Department of Applied Chemistry and Chemical Engineering (ACCE), GSTU, so that every batch can build on the work of earlier ones. The archive must stay useful as faculty, curricula and students change.

## 2. What to collect

| Priority | Material | Why |
|---|---|---|
| **Core** | Past question papers: term final, in-course, viva, lab exams, class tests | Highest demand; irreplaceable once lost |
| **Core** | Syllabi and curriculum documents, **every version** | Needed to interpret all other material across curriculum revisions |
| **Core** | Lecture notes, slides and handouts (with the teacher's consent) | |
| **Core** | Lab manuals, experiment sheets, report templates | |
| **Core** | Theses, project and internship reports (with the author's consent) | Departmental research memory |
| High | Solutions and model answers (marked as student-made where applicable) | |
| High | Reference books and papers that may be legally shared (open access, author copies) | |
| High | Departmental notices, forms, academic calendars | Administrative memory |
| Medium | Software, scripts, datasets used in courses | |
| Medium | Seminar recordings: **linked, not uploaded** | Storage |
| Out of scope | Result sheets, attendance, anything with personal data; commercial e-books without permission; personal or social content | |

## 3. Organising for change

Folders hold what is **stable**. Metadata holds what **changes**.

```
BSc archive/
  Year 1 Term 1/
    ACCE-1101 Chemical Engineering Thermodynamics/
      (lecture notes, books, lab material… named consistently)
  Year 1 Term 2/ …
MSc archive/
  Term 1/ …   Theses/<year>/
Question banks/
  <year>/  or  <course code>/     ← keep the existing arrangement; be consistent
Miscellaneous/
  Syllabi/<curriculum year>/   Forms/   Notices/<year>/   Software/
```

**Faculty change.** Never name folders after teachers. Record the teacher in the item's *Course teacher(s)* field, and record teachers over time on the course in **Dashboard → Courses**.

**Curricula change.** Keep the course folder. Tag each item with its *Curriculum / syllabus version* (for example `Syllabus 2019`) and *Session*. When a course is renamed, renumbered or merged:

1. create the new course in **Dashboard → Courses**;
2. mark the old course *inactive*, but do not delete it;
3. list both curriculum versions on each course;
4. file new material under the new course;
5. put a short `README` in the old folder pointing to the new one.

**Readings change.** Do not delete superseded material. Students repeat courses, and old papers show how a subject was taught. Prefer adding a newer edition alongside the old one, with the year in the title.

**Naming.** On approval, the dashboard suggests `<COURSE> - <Title> - <Year or Session>.<ext>`, for example `ACCE-3101 - Term final - 2023.pdf`. Keep names short, descriptive and free of personal data.

## 4. Review checklist

A reviewer approves only when every answer is "yes":

1. **Genuine.** It is what it claims to be, it is legible, and it is complete or clearly marked as partial.
2. **Relevant.** It relates to ACCE teaching, learning, research or administration.
3. **Shareable.** The rights statement is plausible, and no commercial book is shared without permission.
4. **Private-data free.** No marks, IDs, phone numbers or photos of people without consent.
5. **Not a duplicate.** Check the *Similar material* panel. Exact copies are blocked automatically.
6. **Described.** The title, type, course and session are correct; fix them in the form if not.
7. **Filed.** The destination folder follows section 3.

When declining, say *why* and *what would make it acceptable*. The contributor sees the note.

## 5. Retention and withdrawal

- Published material is kept indefinitely.
- A take-down request or a credible concern withdraws the item at once into the private *Withdrawn* folder while it is checked. Delete it permanently only when legally required or when it is clearly worthless.
- Declined uploads are deleted immediately, and so are uploads still unfinished after 24 hours. Their records are kept for accountability.

## 6. Provenance

The archive records, for every item, who submitted it, when, who approved it, and the reviewer's note. Each upload's SHA-256 checksum is stored when it arrives. The full trail is under **Dashboard → Activity** and in each submission's history.
