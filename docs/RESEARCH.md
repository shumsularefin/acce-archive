# How other archives work, and what we adopted

A short survey of established institutional repositories and open archives, and how their practices map onto a departmental archive. It covers features, organisation, submission workflows, metadata, search, and the decisions taken here.

## Who was looked at

**National (Bangladesh)**
- **University of Dhaka Institutional Repository (DUIR).** Runs on DSpace and holds full-text theses, internship reports, journal articles and conference papers. Open-access archiving of research articles began in 2012.
- **BUET library repository.** DSpace-based; holds postgraduate theses and dissertations, freely downloadable unless under embargo.
- **BRAC University (dspace.bracu.ac.bd).** Registered in 2009, the first open institutional repository in Bangladesh on DSpace.

**International**
- **DSpace** (the platform behind most university repositories). Communities → collections → items; qualified Dublin Core metadata; a configurable review workflow (reviewers approve or reject; editors fix metadata; provenance is recorded on every state change).
- **Internet Archive, Zenodo, arXiv.** Open deposit at scale, persistent identifiers (DOIs at Zenodo), versioning, simple licences, checksum-based integrity.
- **MIT OpenCourseWare.** Organises teaching material by course *and* by the term it was taught, so old runs of a course stay available beside new ones.

Repository features vary by version, and the national repositories described here were not inspected live. The descriptions come from published sources listed at the end.

## Comparison

| Practice in established repositories | Value for ACCE | In this archive |
|---|---|---|
| Hierarchy: communities → collections → items | High | Collections (BSc, MSc, Question banks, Misc.) → year/term → course folders |
| Qualified **Dublin Core** metadata | High | Dublin Core-style record adapted to coursework: course, level, session, curriculum, exam, instructors, rights ([ARCHITECTURE.md](ARCHITECTURE.md#catalogue-record-dublin-core-inspired)) |
| **Submission → review → accept/reject** workflow, with a reason returned to the submitter | Essential | Private Pending folder, review queue, metadata correction, decline with a note, email notices |
| **Provenance** recorded at every workflow state change | High | Per-submission history and a global audit log |
| Controlled vocabularies | High | Shared taxonomy for types, exams, levels, rights and affiliations; course catalogue with autocomplete |
| Faceted search over metadata | High | Instant client-side search with collection, type, format and year facets, plus highlighting |
| Persistent links to items | High | `#/file/<driveId>` permalinks that survive moves inside Drive |
| Fixity checksums | Medium | SHA-256 on every upload, verified end to end; used for duplicate refusal |
| Licence / rights statements | High | Rights declared at submission and stored with the file |
| Take-down / notice-and-action process | Essential | "Report" on every file, a staff report queue, withdrawal into a private folder |
| Versioning and time snapshots (OCW by term) | High | Session and curriculum fields; policy of keeping superseded material ([COLLECTION_POLICY.md](COLLECTION_POLICY.md)) |
| Embargoes | Low now | Not built. Withheld material can simply stay pending or be withdrawn. |
| DOIs | Low now | Deferred. Deposit finished theses in Zenodo and link them ([STORAGE.md](STORAGE.md)). |
| OAI-PMH harvesting | Low now | Deferred. Records are in Firestore and Drive properties, so an OAI endpoint or export can be added later. |
| Usage statistics | Medium | Visitor profiles with visit counts. Per-file download counts were deferred, because Drive serves the files directly. |
| Batch import | Medium | Admins can still add files directly in Drive. *Index checksums* then fingerprints them, and *Edit record* catalogues them. |

## Why not run DSpace itself?

DSpace is the right tool for a university library: it needs a Java server, PostgreSQL, Solr and an administrator. For a department, that operating cost would threaten long-term survival more than any missing feature. Instead, this archive borrows DSpace's *model* (review workflow, Dublin Core metadata, provenance, controlled vocabulary, take-down process) and keeps a zero-maintenance runtime: static hosting, Drive and Apps Script.

## Sources

- DSpace review workflow roles, Dublin Core usage and provenance: [PSU Knowledge Bank workflow](https://kb.psu.ac.th/psukb/PSUKB/Policy/PSU_Knowledge_Bank_Preservation_Plan/PSU_Knowledge_Bank_Workflow.html), [Texas Digital Library guide](https://texasdigitallibrary.atlassian.net/wiki/x/RgBSww), [Spoken Tutorial: Item review in DSpace](https://script.spoken-tutorial.org/index.php/DSpace/C2/Item-Review-in-DSpace/English), [MIT wiki](https://wikis.mit.edu/confluence/x/K4jHCg)
- Bangladesh repositories: [Digital Initiatives at Dhaka University Library](https://publicacoes.bad.pt/revistas/index.php/cadernos/article/view/2022), [Building Institutional Repositories in Bangladesh Using DSpace](https://ar.iub.edu.bd/handle/11348/147), [DSpace registry](https://dspace.org/registry/entry/28416/?pagenum=7)
- Drive resumable uploads (chunks in multiples of 256 KiB): [Google Drive API upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [tanaikech/AsynchronousResumableUploadForGoogleDrive](https://github.com/tanaikech/AsynchronousResumableUploadForGoogleDrive)
