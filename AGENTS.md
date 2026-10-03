# Stock Desk agent guide

## Project boundary

- This repository implements `simple-prd.md` for the Supabase project `axvdsnsilgstkriqzjqy` in the `stock` organization. Do not target the unrelated Seniorclub Factory projects.
- The frontend is React + TypeScript + Vite. The backend is Supabase Auth, Postgres, RLS, database functions, and the `manage-staff` Edge Function.
- Use `nix develop path:. --command <command>` in this workspace. The existing `.git` directory is empty, so plain `nix develop` treats it as an invalid Git flake. `path:.` selects the path flake. `flake.lock` pins nixpkgs.
- Install JavaScript dependencies with `nix develop path:. --command npm ci`, run locally with `nix develop path:. --command npm run dev` at http://localhost:5187/, and build with `nix develop path:. --command npm run build`. The dev script reserves port 5187 and fails on a conflict instead of silently switching ports.

## Secrets and authentication

- `.secrets/supabase-access-token` is the Management API token, `.secrets/supabase-secret-key` is the project server key, `.secrets/admin-login` holds the initial local administrator credentials, and `.env.local` holds the frontend URL and publishable key. These paths are gitignored and must stay local with mode `0600`; `.secrets` is `0700`.
- Never put a Management API token or project secret key in browser code, logs, commits, or an issue. The frontend uses only `VITE_SUPABASE_PUBLISHABLE_KEY`.
- The Edge Function reads `STOCK_SECRET_KEY` from Supabase project secrets. Deploy it with `SUPABASE_ACCESS_TOKEN="$(cat .secrets/supabase-access-token)" nix develop path:. --command supabase functions deploy manage-staff --project-ref axvdsnsilgstkriqzjqy --use-api`.
- Staff accounts are created and updated through the Edge Function after it verifies the caller's Auth JWT and active admin profile. Do not create Auth users from the browser with a secret key.

## Database changes

- Migration files live in `supabase/migrations`. Seven versions through `20261003191000` have already been applied to the stock project and registered in `supabase_migrations.schema_migrations`.
- For a new migration, use a new 14-digit timestamp filename and run `nix develop path:. --command node scripts/apply-migration.mjs supabase/migrations/<file>.sql`. Inspect the project ref, SQL, and current history before applying. Never rerun an already applied migration or reset production data.
- Keep stock and financial postings atomic through `public.post_document`, `public.adjust_stock`, `public.record_payment`, `public.record_expense`, and `public.pay_salary`. These public RPCs validate requests and call privileged functions in the unexposed `private` schema. Do not grant direct table writes to cashier clients.
- Preserve RLS and role checks. Cashiers can sell and read only their permitted data; administrators manage the business. The catalog and available quantity RPCs omit sensitive cost/value data for cashiers.
- `scripts/smoke.sql` runs with `BEGIN` and `ROLLBACK`; it tests stock, sale, purchase, returns, journal balance, report output, and oversell refusal without keeping test rows. Send it through the Management API as one query. `scripts/staff-smoke.mjs` creates a temporary cashier and deletes it in `finally`.

## Frontend changes and validation

- Use the existing light neutral palette and restrained teal accent. Keep forms readable at desktop and mobile widths. Avoid adding decorative gradients or saturated colors to transaction screens.
- English and Arabic are first-class UI languages. `src/i18n.tsx` owns the persisted preference, `lang`/`dir`, formatting, and error presentation; `src/locales/ar.json` translates UI messages, and `src/locales/errors-ar.json` translates known backend errors. Keep database enum values and user-entered data unchanged; translate only their display. Prefer logical CSS properties so both directions work. The language switch must remain usable before and after sign-in.
- Run `nix develop path:. --command npm run check:locales` after changing UI copy; it rejects missing Arabic messages and hardcoded JSX text. For UI changes, run the development server, then `nix develop path:. --command npm run check:locale-ui` and review desktop and mobile screenshots in `/tmp`.
- Run `nix develop path:. --command npm run build` for code changes. For UI work, run the local server and `node scripts/visual-check.mjs` in an environment that can reach Supabase; it captures sign-in, dashboard, inventory, desktop checkout, and mobile checkout screenshots in `/tmp`.
- Production Vite builds use `/stock/` as their base for https://broker-eg.github.io/stock/ and write to `build/`. The `dist/` directory is itself the Git repository for `broker-eg/stock` on `master`. Sync `build/` into `dist/` while preserving `dist/.git` and the Pages README, then push a normal commit. Never build directly into `dist/`, since build cleanup can damage its Git history.
- The source is committed to the `source` branch of the same repository using the local `.source-git/.git/` Git directory and this folder as the worktree: `git --git-dir=.source-git/.git --work-tree=. status`. Keep `.secrets/`, `.env.local`, generated builds, and workspace metadata out of that branch. The `master` branch in `dist/` remains the Pages output.
- Receipts and tax details come from saved document lines, not recomputed product prices. Stock valuation reports come from the database report RPC, not current price fields.
