# Architecture

```
                 ┌────────────────────────── Browser (static site on Firebase Hosting) ──────────────────────────┐
                 │  index.html + ES modules, no build step                                                         │
                 │                                                                                                 │
   read-only ───►│  services/drive.js   ── Drive API v3 + public API key ──►  4 public Drive folders (browse/search)│
                 │  services/firebase.js ─ Firebase Auth (Google) + Firestore SDK ──► profiles, workflow state     │
   uploads ─────►│  services/backend.js ── HTTPS POST + Firebase ID token ──► Apps Script web app                  │
                 └────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                                                     │ runs as the Drive owner
                                                     ┌───────────────────────────────┴──────────────────────────────┐
                                                     │ verify token (Identity Toolkit) → check role (Firestore)      │
                                                     │ resumable upload → private "Pending" folder                   │
                                                     │ approve: move + rename + write metadata into the Drive file   │
                                                     │ reject: delete (frees quota) · audit log · email notices      │
                                                     └───────────────────────────────────────────────────────────────┘
```

## Principles

1. **Drive stays the source of truth for files.** Public browsing works exactly as before: the site lists the shared folders with an API key. It keeps working if Firebase or the backend is down.
2. **Nothing is public until a reviewer moves it.** Uploads land in a private folder that is not shared. Approval is the only path into a public folder, and the backend checks that the destination really is inside one of the four collections.
3. **Records travel with the files.** On approval, each file's catalogue record is written into the file's Drive `description` (human-readable) and `properties` (machine-readable). The archive stays self-describing even without this website or Firebase.
4. **Clients write almost nothing.** Status changes, file moves, roles and the catalogue all go through the backend, which validates everything. Browsers write only their own profile, problem reports, and (for admins) the course list and settings. Firestore rules enforce this; see `tests/rules`.
5. **No build, no servers to patch.** The frontend is plain HTML, CSS and ES modules. The backend is Apps Script, so there is no billing account, no Cloud Functions and no Node server.

## Why Apps Script for uploads?

A personal Google account's 15 GB can only be written by that account. Service accounts have no Drive storage of their own, so a Cloud Function using one cannot upload into personal Drive. Cloud Functions also need the Blaze plan. An Apps Script web app deployed with *Execute as: Me* writes with the owner's own authority and quota, at no cost.

Uploads are chunked: the browser sends 5 MiB pieces and the script relays them to a Drive resumable-upload session. This avoids Apps Script's request-size limits and survives flaky connections. If a response is lost, the script asks Drive how many bytes it holds and the browser resumes from there. SHA-256 checksums are compared end to end.

If the archive later moves to Google Workspace (e.g. a GSTU institutional account or a Shared Drive), the same script works unchanged; only the folder IDs change.

## Data model (Firestore)

| Collection | Written by | Read by | Purpose |
|---|---|---|---|
| `users/{uid}` | the user (own doc, validated); admins may set `status` | the user, staff | profile: name, email, affiliation, session, student ID, visits, `status: active/blocked` |
| `admins/{email}` | backend (`setAdmin`, `setup()`) | staff; each person their own | `role: reviewer/admin/owner`, `notify` |
| `submissions/{id}` | backend | the contributor, staff | `status: uploading/pending/approved/rejected/withdrawn/abandoned`, `kind: file/link`, `meta`, `file {name,size,mime,sha256,driveId}`, `published {fileId,folderId,folderPath}`, `reviewer`, `note`, `history[]` |
| `items/{driveFileId or link-…}` | backend | everyone | public catalogue record of published material (also used for links, which have no Drive file) |
| `courses/{CODE-1234}` | admins | everyone | course catalogue: title, level, programme, curricula, instructors over time, `active`, last-used filing folders |
| `reports/{id}` | signed-in users (create) | staff, the reporter | problems and take-down requests |
| `fingerprints/{sha256}` | backend | staff | duplicate detection, for both legacy and submitted files |
| `audit/{id}` | backend | staff | who did what, and when |
| `config/settings` | owners | everyone | uploads open/closed, size and rate limits, storage reserve, notifications, announcement |

### Catalogue record (Dublin Core-inspired)

| Field | Dublin Core | Notes |
|---|---|---|
| `title` | title | required |
| `type` | type | controlled list (`taxonomy.js`) |
| `courseCode`, `courseTitle` | subject | normalised `ACCE-3101` |
| `level`, `session`, `curriculum` | coverage (temporal) | how curriculum and batch changes are handled |
| `examKind`, `examYear` | date / type refinement | question banks |
| `instructors`, `authors` | contributor / creator | instructors are metadata, never folder names |
| `language` | language | |
| `tags`, `description` | subject / description | |
| `rights` | rights | declared by the contributor |
| `sha256` | identifier (fixity) | |

The vocabulary lives in two files that a test keeps identical: `public/js/taxonomy.js` and `apps-script/Taxonomy.js`.

## Search

The browser builds a whole-archive index by crawling the public folders breadth-first. Each Drive query asks for the children of up to 25 folders, so the cost is about one request per folder level rather than one per folder. The index is cached in `localStorage` for 6 hours and holds names, paths, sizes, dates and catalogue properties. Matching is local and instant:

- every word must match, and names rank above paths;
- course codes match in any spelling (`acce3101`, `ACCE 3101`);
- facets: collection, material type, format, year.

Search reads nothing from Firestore except published links, so it costs no database reads.

## Security summary

- **Identity:** Google sign-in only. The backend re-verifies every ID token with Identity Toolkit and requires a verified email.
- **Authorisation:** roles live in `admins/{email}`. The rules and the backend both check them. Owners can be bootstrapped from the `OWNER_EMAILS` script property.
- **Validation:** the backend trusts the file extension map, not the browser's MIME type. It enforces size limits, rate limits (open submissions per person, per day) and a storage reserve. It also sanitises file names and checks lengths and enums on every field.
- **Containment:** writes go only into folders whose parent chain reaches a configured collection root, or into the private system folders.
- **Privacy:** contributor emails are visible only to staff. Public records carry a name only when the contributor opts in.
- **Hosting headers:** `nosniff`, a strict referrer policy, a restrictive permissions policy, and COOP `same-origin-allow-popups` (needed for the Google sign-in popup).

## Frontend layout

```
public/
  index.html            shell + SVG icon sprite
  css/style.css         design system (dark/light), all components
  js/app.js             router, header, sign-in gate, theme, shortcuts
  js/config.js          the only file to edit for a deployment
  js/taxonomy.js        controlled vocabulary
  js/lib/dom.js         element builder, dialogs, toasts, formatting
  js/lib/search.js      ranking, facets, highlighting
  js/services/          drive.js · firebase.js · backend.js
  js/views/             home · browse · search · quicksearch · preview · submit · metaform · my · profile · admin · about · gate · file
apps-script/            the backend (deploy as a web app)
firestore.rules         security rules       firestore.indexes.json   composite indexes
tests/                  unit (backend) · rules (emulator) · e2e (Playwright + emulators)
```
