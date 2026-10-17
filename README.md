# ACCE Archive

Static archive website for the Department of Applied Chemistry and Chemical Engineering, GSTU.

## Firebase Hosting

The Firebase project is `accearchive`. Firebase Hosting serves the `public/` directory configured in the root `firebase.json`.

The source files are kept at the repository root and mirrored in `public/`, which is the deployed copy. Push changes on `main` to deploy the site through GitHub Actions.

GitHub Actions credentials are stored in the repository's Firebase service account secret. Never commit service account keys or other deployment credentials.
