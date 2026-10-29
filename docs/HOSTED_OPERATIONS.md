# Hosted operations and local development

Use https://p2l-dashboard.vercel.app for operations. `start_app.bat` opens this URL.

The Vercel project `p2l-dashboard` connects to `stefcrive/P2L_Dashboard`, production
branch `main`, root `frontend`. It installs with `npm ci --prefix ..` and builds
with `npm run build`. Test local changes, commit, and push to `main`; Vercel builds
that commit and updates production when the deployment succeeds.

`start_local.bat` retains the offline development launcher and existing PGlite
data. Run `npm ci` first after pulling dependency changes.

`start_cloud_dev.bat` starts a local frontend at http://localhost:3211 with the
operational Postgres database and private Blob files. Sign in with the IRMS account.
Saved changes affect live data. `start_cloud_dev.bat --check` performs a read-only
database connection check.

The cloud launcher reads database, Blob, and optional OpenAI settings from the
ignored `.env.cloud.local`. Refresh it with the authenticated Vercel CLI:

```powershell
npx vercel@65.7.0 env pull .env.cloud.local --environment=production --project prj_jRxUhxIWUPozVgyP37A7wv4D0nTa --scope stefanos-projects-caa52547
```

Secret values returned as `[SENSITIVE]` are not loaded. A local OpenAI key is needed
for assistant features if Vercel withholds that key. The launcher sets the non-secret
database mode and IRMS sign-in URL itself.

Code is synchronized through GitHub. Online local development and production use
the same records directly. Offline data remains separate; these launchers do not
merge or overwrite it. Automatic two-way offline synchronization is not implemented.

On 2026-10-29, the IRMS cloud account-store connection was blocked by Neon reporting
an exceeded quota. P2L authentication depends on that IRMS service, so the quota
must be resolved before cloud operations can be verified end to end.
