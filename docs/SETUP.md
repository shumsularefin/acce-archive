# Setup and deployment

Allow about 30 minutes. Browsing keeps working throughout. Sign-in and submissions switch on as you finish each part.

Do the Google Drive steps (part 2) **signed in as the account that owns the archive folders**. That account's 15 GB stores every upload.

---

## 1. Firebase (sign-in + database)

Open the [Firebase console](https://console.firebase.google.com/) and select project **accearchive**.

1. **Register a web app.** Go to *Project settings → General → Your apps → Add app → Web*. Name it `ACCE Archive` and skip the Hosting step. Firebase Hosting then serves the app's config automatically at `/__/firebase/init.json`, so nothing needs to be pasted into the code.
2. **Enable Google sign-in.** Go to *Build → Authentication → Get started → Sign-in method → Google → Enable*. Pick a support email and save.
3. **Authorised domains.** Under *Authentication → Settings → Authorised domains*, make sure `accearchive.web.app` and `accearchive.firebaseapp.com` are listed. Add any custom domain you use later.
4. **Create the database.** Go to *Build → Firestore Database → Create database*, choose **production mode**, and pick a location close to your users (e.g. `asia-south1`, Mumbai). The location cannot be changed later.
5. **Deploy the security rules and indexes.** Use either method:
   - **From your computer:** run `npm install`, then `npx firebase login`, then `npm run deploy:rules`.
   - **From GitHub Actions:** in Google Cloud console *IAM*, give the service account stored in the `FIREBASE_SERVICE_ACCOUNT_ACCEARCHIVE` secret the roles **Firebase Rules Admin** and **Cloud Datastore Index Admin**. Then add a repository variable `DEPLOY_FIRESTORE` = `true` (*Settings → Secrets and variables → Actions → Variables*). Every push to `main` that changes the rules or indexes will deploy them. You can also run the "Deploy Firestore rules" workflow by hand.
6. Copy the **Web API key** from *Project settings → General*. Part 2 needs it.

At this point contributors and staff can sign in with Google. Students never need to: they enter with their name, session and student ID, exactly as on the original site, and each visit is logged in `visitors/{ID}` (Dashboard → People).

## 2. Submission backend (Google Apps Script)

The backend is a small Apps Script web app that runs **as you**. Uploads therefore go into your Drive and use your quota. It needs no billing account.

1. Go to <https://script.google.com> → **New project**. Name it `ACCE Archive backend`.
2. Create one script file for each file in [`apps-script/`](../apps-script): `Code`, `Drive`, `Firestore`, `Taxonomy` and `Setup`. Paste each file's contents in. Then turn on *Project Settings → Show "appsscript.json"* and replace that file's contents with [`apps-script/appsscript.json`](../apps-script/appsscript.json).
   *(If you prefer the command line, `npx @google/clasp clone` / `clasp push` works with this folder as-is.)*
3. Go to *Project Settings → Script properties* and add:

   | Property | Value |
   |---|---|
   | `FIREBASE_API_KEY` | the Web API key from step 1.6 |
   | `FIREBASE_PROJECT_ID` | `accearchive` |
   | `OWNER_EMAILS` | your Gmail address (comma-separate several owners) |
   | `SITE_URL` | `https://accearchive.web.app` |
   | `ROOT_FOLDERS` | *optional*; only if the folder IDs differ from those in `Code.js` |

4. In the editor, select the function **`setup`** and click **Run**. Approve the permissions; Google warns that the app is unverified because it is your own script, so choose *Advanced → Go to …*. `setup()` does the following:
   - creates a private folder **"ACCE Archive — system (private)"** containing *Pending submissions* and *Withdrawn*,
   - schedules the nightly clean-up,
   - writes default settings to Firestore,
   - registers you as **owner** in Firestore,
   - checks it can see the four public folders.

   Then run **`checkSetup`**. It should print *Everything looks configured.*
5. Click **Deploy → New deployment → Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**

   Copy the URL that ends in `/exec`.
6. Paste the URL into `public/js/config.js`:

   ```js
   backendUrl: 'https://script.google.com/macros/s/AKfy…/exec',
   ```

   Commit and push to `main`. The site redeploys automatically.

> **Updating the backend later:** paste the new code, then use *Deploy → Manage deployments → Edit → Version: New version*. Editing the existing deployment keeps the same URL.

> **"Anyone" access is safe here.** Every request must carry a valid Firebase ID token. The script verifies the token with Google, checks the user's role in Firestore, validates every field, and only ever writes inside the archive folders.

## 3. Tighten the Drive API key

The Drive key in `config.js` is public by design. It can only read folders that are already shared publicly. Restrict it anyway:

1. In Google Cloud console go to *APIs & Services → Credentials*, then open the key.
2. Under *Application restrictions*, choose **Websites** and add `accearchive.web.app/*`, `accearchive.firebaseapp.com/*` and `localhost:5055/*`.
3. Under *API restrictions*, restrict the key to the **Google Drive API**.

## 4. Build the team

**muhammadshamsularefin01@gmail.com is the permanent owner.** That account is an owner as soon as it signs in, needs no setup, and cannot be demoted or removed from the dashboard. To change it, edit `rootOwners` in `firestore.rules`, `public/js/config.js` and `apps-script/Code.js` together.

Sign in as an owner and open **Dashboard → People**. Add people by Gmail address:

| Role | Can |
|---|---|
| owner | everything, plus manage the team and site settings |
| **admin** | curate the catalogue (edit records, import from Drive, take down), manage courses, block contributors, run maintenance, plus everything a reviewer can |
| **reviewer** | approve or decline submissions, handle reports |

This works before the upload backend is connected. Once the backend is connected, adding someone also gives them read access to the private Pending folder, so the review preview works for them.

## 5. Build the catalogue

Open **Dashboard → Catalogue → Import / sync from Drive**. Every file in the public folders gets a catalogue record, with details inferred from its name and folders. The first import switches browsing and search to the catalogue (the virtual library). Then:

- work through **Needs review** (or the "Needs review" badges in the library) and correct the details with **Edit record**;
- add curricula to records ("Syllabus 2019, Syllabus 2023") so the curriculum filter works;
- run the import again whenever files are added directly in Drive. It never overwrites your edits.

With the backend connected, also run **Dashboard → Settings → Maintenance → Index checksums** once, so duplicate uploads are refused from day one.

## 6. Check it works

- [ ] Sign in with a second Google account, complete the profile, and submit a small PDF.
- [ ] The owner receives an email; the file appears under **Dashboard → Review queue**.
- [ ] Approve it into a folder; it shows up in that folder on the public site.
- [ ] The contributor's **My uploads** page shows *Published*, and they receive an email.
- [ ] Submitting the same PDF again is refused as a duplicate.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "This web address is not authorised for sign-in" | Add the domain under Authentication → Settings → Authorised domains. |
| Site stays browse-only and the console says *Firebase web app is not registered* | Do step 1.1. |
| "Submissions open soon" | `backendUrl` is empty or malformed in `config.js`. |
| Backend says *not configured (FIREBASE_API_KEY)* | Add the script property, then redeploy a new version. |
| `checkSetup` says *Firestore not reachable: … has not been used in project* | Enable the **Cloud Firestore API** for project `accearchive` in Google Cloud console. The script account must also be an owner/editor of the Firebase project; otherwise grant it *Cloud Datastore User* + *Service Usage Consumer*. |
| Reviewers see a blank preview | They must be added through the dashboard (which shares the Pending folder with them) and be signed in to Google in the same browser. |
| Uploads fail with *short on storage* | Free space has dropped below the reserve in Settings. See [STORAGE.md](STORAGE.md). |

## Local development

```bash
npm install
npx firebase emulators:start --only auth,firestore --project demo-acce   # terminal 1
npm run serve                                                            # terminal 2 → http://127.0.0.1:5055
```

To sign in locally, set `emulators: { auth: 'http://127.0.0.1:9099', firestore: { host: '127.0.0.1', port: 8080 } }` in `config.js` **without committing it**.

Tests:

```bash
npm run test:unit    # backend logic, against fakes
npm run test:rules   # security rules, against the Firestore emulator
npm run test:e2e     # the whole site in Chromium, with the emulators and the real backend code
```
