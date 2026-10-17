# ACCE Archive

Departmental archive for the Department of Applied Chemistry and Chemical Engineering, GSTU. It holds books, lecture material, question banks, lab manuals and theses, served from Google Drive with a moderated contribution workflow.

**Live:** <https://accearchive.web.app>

## Features

- **Browse** the four Drive collections, as before: breadcrumbs, sorting, filtering, list or grid view, and shareable deep links to any folder or file.
- **Search everything** at once, instantly, with facets (collection, material type, format, year) and course-code-aware matching. Press <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere.
- **Preview** files inline, then download, open in Drive, copy a permalink, copy a citation, or report a problem.
- **Google sign-in** with a one-time profile (affiliation, session and student ID, validated as before).
- **Contribute:** drag-and-drop batch uploads or links, a guided metadata form, a rights declaration, resumable chunked uploads with progress, and duplicate detection before upload.
- **Review dashboard:** queue with inline preview, metadata correction, a folder picker with per-course filing suggestions, consistent renaming, approve or decline with a note, and email notices to contributors.
- **Curation:** edit any file's catalogue record, take files down, handle reports, keep a course catalogue across curriculum changes, manage team roles, block abusive contributors, and view a full audit log.
- **Storage management:** quota meter, largest files, size and rate limits, automatic upload pause before the quota runs out, and nightly clean-up.
- **Dark and light themes**, phone layout with a bottom tab bar, keyboard shortcuts, reduced-motion support, and installable as an app.

## How it fits together

```
Browser ──(API key, read-only)──────────────► public Google Drive folders
   │
   ├──(Firebase Auth + Firestore SDK)───────► profiles, roles, submissions, catalogue
   │
   └──(ID token)──► Apps Script web app ────► private Pending folder → approved into public folders
                    (runs as the Drive owner)
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation

| | |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | **Start here.** Firebase, the Apps Script backend, admins, and verification |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data model, security model |
| [docs/COLLECTION_POLICY.md](docs/COLLECTION_POLICY.md) | What to keep, and how to organise for changing faculty and curricula |
| [docs/STORAGE.md](docs/STORAGE.md) | Living within 15 GB, and how to scale beyond it |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Survey of other archives, and what was adopted |

## Repository layout

```
public/          the website (deployed as-is; there is no build step)
apps-script/     submission/review backend, pasted into script.google.com
firestore.rules  Firestore security rules (+ firestore.indexes.json)
tests/           unit (backend), rules (emulator), e2e (Playwright + emulators)
docs/            setup and policy documentation
```

## Deploying

- **Website:** push to `main`. GitHub Actions deploys `public/` to Firebase Hosting, and pull requests get a preview channel.
- **Firestore rules and indexes:** `npm run deploy:rules`, or set the repository variable `DEPLOY_FIRESTORE=true` (see SETUP §1.5).
- **Backend:** paste `apps-script/` into the Apps Script project and deploy a new version (see SETUP §2).

GitHub Actions credentials are stored in the repository's Firebase service account secret. Never commit service account keys or other deployment credentials.

## Developing

```bash
npm install
npm test             # unit + security rules + end-to-end (needs Java for the emulators)
npm run serve        # http://127.0.0.1:5055
```

The only file to edit for configuration is `public/js/config.js`.
