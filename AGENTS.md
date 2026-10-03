# Stock Desk agent guide

Read this before changing code, the live database, or the published site. `simple-prd.md` defines the product; `README.md` explains setup and business use; `FIX_PLAN.md` records the repair audit. Check current code and remote state before treating any dated status below as current.

## Project boundary

- This repository implements `simple-prd.md` for the Supabase project `axvdsnsilgstkriqzjqy` in the `stock` organization. Do not target the unrelated Seniorclub Factory projects.
- The frontend is React + TypeScript + Vite. The backend is Supabase Auth, Postgres, RLS, database functions, and the `manage-staff` Edge Function.
- `src/App.tsx` owns the shell, session, routing, and refresh flow; `src/pages.tsx` contains the business screens; `src/lib/db.ts` contains Supabase queries; `src/i18n.tsx` owns language state and formatting.
- Use `nix develop path:. --command <command>` in this workspace. The existing `.git` directory is empty, so plain `nix develop` treats it as an invalid Git flake. `path:.` selects the path flake. `flake.lock` pins nixpkgs.
- Install JavaScript dependencies with `nix develop path:. --command npm ci`, run locally with `nix develop path:. --command npm run dev` at http://localhost:5187/, and build with `nix develop path:. --command npm run build`. The dev script reserves port 5187 and fails on a conflict instead of silently switching ports.
- Port 5173 belongs to another app. Diagnose a 5187 conflict before changing the port. Before edits, inspect both source and Pages Git statuses and preserve unrelated work.

## Git layout and handoff

- Editable code, migrations, and documentation belong to `broker-eg/stock` branch `source`. Its Git directory is `.source-git/.git/` with this directory as worktree. Root `.git/` is empty, so plain `git` here does not target the source branch. Use `git --git-dir=.source-git/.git --work-tree=. status` and the same options for diff, add, commit, and push.
- `dist/` is a separate checkout of branch `master`, holding generated GitHub Pages files and its README. Use `git -C dist status` to inspect it. Keep source and generated commits on their respective branches. Keep `.secrets/`, `.env.local`, `build/`, `dist/`, and workspace metadata off `source`.
- Report what was checked at each level: source review, local build/browser behavior, live database behavior, and deployed Pages behavior. A successful local build alone does not prove deployment. Include source and Pages commits when applicable, migration versions when applicable, and remaining limitations.

## Secrets and authentication

- `.secrets/supabase-access-token` is the Management API token, `.secrets/supabase-secret-key` is the project server key, `.secrets/admin-login` holds the initial local administrator credentials, and `.env.local` holds the frontend URL and publishable key. These paths are gitignored and must stay local with mode `0600`; `.secrets` is `0700`.
- Never print or put a Management API token or project secret key in browser code, logs, commits, handoffs, or an issue. The frontend uses only `VITE_SUPABASE_PUBLISHABLE_KEY`.
- The Edge Function reads `STOCK_SECRET_KEY` from Supabase project secrets. Deploy it with `SUPABASE_ACCESS_TOKEN="$(cat .secrets/supabase-access-token)" nix develop path:. --command supabase functions deploy manage-staff --project-ref axvdsnsilgstkriqzjqy --use-api`.
- Staff accounts are created and updated through the Edge Function after it verifies the caller's Auth JWT and active admin profile. Do not create Auth users from the browser with a secret key.

## Database changes

- Migration files live in `supabase/migrations`. As of 2026-10-03, seven versions through `20261003191000` were applied to the stock project and registered in `supabase_migrations.schema_migrations`. Recheck the live history before relying on this dated record.
- For a new migration, use a new 14-digit timestamp filename and run `nix develop path:. --command node scripts/apply-migration.mjs supabase/migrations/<file>.sql`. Inspect the project ref, SQL, and current history before applying. Never rerun an already applied migration or reset production data.
- Keep stock and financial postings atomic through `public.post_document`, `public.adjust_stock`, `public.record_payment`, `public.record_expense`, and `public.pay_salary`. These public RPCs validate requests and call privileged functions in the unexposed `private` schema. Do not grant direct table writes to cashier clients.
- Preserve RLS and role checks. Cashiers can sell and read only their permitted data; administrators manage the business. The catalog and available quantity RPCs omit sensitive cost/value data for cashiers.
- `scripts/smoke.sql` runs with `BEGIN` and `ROLLBACK`; it tests stock, sale, purchase, returns, journal balance, report output, and oversell refusal without keeping test rows. Send it through the Management API as one query. `scripts/staff-smoke.mjs` creates a temporary cashier and deletes it in `finally`.
- Posted documents and their saved lines are the source for receipts, tax, and returns; do not recompute historical figures from current product prices. Stock valuation comes from the database report RPC. Open quotations and orders can be fulfilled or cancelled while posted transactions remain auditable. Check return links and quantities, journal balance, refund eligibility, and cash/bank postings together when changing these flows.

## Frontend changes and validation

- Use the existing light neutral palette and restrained teal accent. Keep forms readable at desktop and mobile widths. Avoid adding decorative gradients or saturated colors to transaction screens.
- English and Arabic are first-class UI languages. `src/i18n.tsx` owns the persisted preference, `lang`/`dir`, formatting, and error presentation; `src/locales/ar.json` translates UI messages, and `src/locales/errors-ar.json` translates known backend errors. Keep database enum values and user-entered data unchanged; translate only their display. Prefer logical CSS properties so both directions work. The language switch must remain usable before and after sign-in.
- Run `nix develop path:. --command npm run check:locales` after changing UI copy; it rejects missing Arabic messages and hardcoded JSX text. For UI changes, run the development server, then `nix develop path:. --command npm run check:locale-ui` and review desktop and mobile screenshots in `/tmp`.
- Run `nix develop path:. --command npm run build` for code changes. For UI work, run the local server and `node scripts/visual-check.mjs` in an environment that can reach Supabase; it captures sign-in, dashboard, inventory, desktop checkout, and mobile checkout screenshots in `/tmp`.
- Verify the changed workflow as well as the build. A successful save followed by a failed refresh must remain visibly saved and must not invite a duplicate submission. Report labels and CSV must reflect the applied filters and results, including after a slow or failed query.
- Production Vite builds use `/stock/` as their base for https://broker-eg.github.io/stock/ and write to `build/`. The `dist/` directory is itself the Git repository for `broker-eg/stock` on `master`. Sync `build/` into `dist/` while preserving `dist/.git` and the Pages README, then push a normal commit. Never build directly into `dist/`, since build cleanup can damage its Git history.

## Completing and publishing requested work

- For a requested repair, carry the work through the necessary migration, checks, build, and push. Verify the source diff and branch before staging only intended files. Use `git --git-dir=.source-git/.git --work-tree=. add <paths>`, inspect the staged diff, commit, then `git --git-dir=.source-git/.git --work-tree=. push origin source`.
- For a requested site publish, build from reviewed source and sync with `nix develop path:. --command rsync -a --delete --exclude='.git/' --exclude='README.md' build/ dist/`. Inspect the Pages diff, commit generated files on `master`, and `git -C dist push origin master`. Verify `https://broker-eg.github.io/stock/` and an asset after pushing. Pages/CDN caching can briefly show an older revision. A docs-only source change needs no Pages rebuild.

## Known remaining limit

- `FIX_PLAN.md` marks F01–F04 and F06–F12 complete as of 2026-10-03. F05 is partly resolved: table and RPC reads page in batches of 500 and successful writes refresh affected datasets, but initial sign-in still loads full history and most financial report totals are calculated in the browser. Move large histories and totals to bounded server queries, then test beyond the API row limit before claiming large-data scalability. Recheck this status against current code and live behavior before planning new work.
