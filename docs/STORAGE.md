# Storage strategy (living within 15 GB)

The archive's files live in one personal Google account, which has 15 GB shared with that account's Gmail and Photos. The system is built to stretch that space, warn before it runs out, and move elsewhere without breaking links.

## Staying on the free Spark plan

The site is designed to run indefinitely on Firebase's free **Spark** plan, with all file traffic carried by Google Drive.

| Resource | Free allowance | What uses it here | Typical use |
|---|---|---|---|
| **File downloads and previews** | Google Drive (not Firebase) | every download, preview and thumbnail goes straight to `drive.google.com` | **0** Firebase bandwidth, however many GB students download |
| Hosting transfer | 10 GB / month | the site's own code and logos: about 120 KB gzipped per first visit, then mostly cached | about 80,000 first visits a month before reaching the limit |
| Firestore reads | 50,000 / day | per visit: `config/catalog` + an empty "changes since" query + settings, about 3 reads; the snapshot chunks (1 per ~1,000 records) only when an admin republishes | about 15,000 visits a day |
| Firestore writes | 20,000 / day | one visitor-log write per student per browser session; staff edits | plenty |
| Authentication | free | only contributors and staff use Google sign-in; students don't need accounts | — |
| Apps Script (uploads) | free with a Google account | runs as the Drive owner | — |

What keeps it cheap:
- **No downloads through Firebase.** The storage adapter (`public/js/services/storage.js`) resolves Drive files to Drive URLs. If a Cloudflare R2 bucket is ever added, its downloads are free too, because R2 charges no egress.
- **Catalogue snapshot.** Visitors never read records one by one. Admins publish every record packed into a few `catalogue/{n}` documents (automatically after an import, and whenever more than 25 records have changed). Browsers cache the snapshot and only fetch records edited since.
- **Course titles travel inside the snapshot**, and links in folders come from the local catalogue, so browsing folders costs no reads.
- **Small assets.** The logos are trimmed to their displayed size (37 KB in total). Code is plain ES modules that load only when a page needs them.

If the Spark limits are ever reached, Firebase simply refuses the extra reads for the rest of the day; nothing is billed. The site keeps working from each browser's cached catalogue, and Drive browsing never depends on Firebase.

## What the software already does

| Mechanism | Effect |
|---|---|
| **Duplicate refusal** | Every file's SHA-256 is checked *before* upload, against both submitted and existing files (run *Index checksums* once after adding files by hand). Re-uploads of the same PDF cost nothing. |
| **Per-file size cap** | 50 MB by default (*Dashboard → Settings*). Contributors are steered to links for bigger material. |
| **Link submissions** | Videos, publisher pages, NPTEL/YouTube lectures and large datasets are catalogued as links: searchable and filed in folders, with zero storage. |
| **Storage reserve** | Uploads pause automatically when free space falls below the reserve (default 1 GB). Browsing is unaffected. |
| **Declined = deleted** | Declined, withdrawn-before-review and abandoned uploads are deleted permanently, not trashed, so the space is freed at once. |
| **Nightly clean-up** | Removes orphaned files from the Pending folder and expires stalled uploads. |
| **Quota dashboard** | *Dashboard → Overview* shows used and free space split into Drive, Trash and Gmail/Photos, plus space per collection and the largest files. |

## Habits that save the most space

1. **Scan sensibly.** 150–200 dpi greyscale PDFs are 5–10× smaller than colour photos of pages. Re-save oversized scans with any PDF compressor (for example the free *ilovepdf* / *Smallpdf*, or `gs -sDEVICE=pdfwrite -dPDFSETTINGS=/ebook`).
2. **Link, don't upload, media.** One lecture video can be larger than an entire question bank.
3. **Empty the Drive trash** of the owner account regularly; trash counts against the quota.
4. **Keep Gmail and Photos of the owner account lean.** They share the same 15 GB. Ideally, use a dedicated account for the archive.
5. **Review the *Largest files* list** each term.

## Projected capacity

At roughly 1 MB per question paper, 5 MB per lecture deck and 15 MB per scanned book, 12 GB of usable space holds about:

- 2,000 question papers (≈2 GB),
- 600 lecture decks (≈3 GB), and
- 450 books or theses (≈7 GB).

That is many years of departmental output if media is linked rather than uploaded.

## When it gets tight: options in order of preference

1. **Institutional Google Workspace for Education (best).** If GSTU has Google Workspace for Education, a departmental account or **Shared Drive** typically comes with far more storage. Move the four collection folders there, update the IDs in `config.js` and the `ROOT_FOLDERS` script property, and redeploy the script from that account.
2. **Google One upgrade.** 100 GB costs a small monthly fee and needs no changes at all.
3. **Split by collection across accounts.** Move one collection (e.g. MSc theses) to a second Google account's Drive. Share the folder publicly and update its ID in `config.js`. Browsing and search work across accounts, because they only need public folders. Submissions into that collection then require a second Apps Script deployment owned by that account; the current backend supports one owner account, so this needs a small routing change.
4. **Long-term preservation copies of finished work.** Deposit theses and research outputs in **Zenodo** (free, gets a DOI, permanent), or in GSTU's institutional repository if one exists. Then catalogue the deposit here as a link. Public-domain books can go to the **Internet Archive**.

## Moving the archive without breaking anything

- Folder IDs are configuration (`config.js` + `ROOT_FOLDERS`). Drive file IDs survive moves within Drive, so `#/file/<id>` links keep working.
- If files are copied to a *different* account, their IDs change. Re-run *Index checksums* and update the `items` records. A one-off script can map old IDs to new ones, using the stored SHA-256 checksums.
- Catalogue metadata is stored in both Firestore and each file's Drive properties, so it survives either side being rebuilt.
