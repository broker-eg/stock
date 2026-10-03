# Stock Desk

A sales, inventory and accounts app built from [the PRD](simple-prd.md). The existing Supabase `stock` project (`axvdsnsilgstkriqzjqy`) holds the live backend. The React frontend is ready for local use and static hosting.

## Start

```sh
nix develop path:. --command npm ci
nix develop path:. --command npm run dev
```

Open http://localhost:5187/. The development server uses port 5187 and fails if that port is occupied. The initial administrator email and generated password are in `.secrets/admin-login` on this machine. Change that password under **Settings → My password** after signing in. The browser configuration is in `.env.local`; `.env.example` shows its shape.

To build static files:

```sh
nix develop path:. --command npm run build
```

The production build is written to `build/` and targets GitHub Pages at https://broker-eg.github.io/stock/ using `/stock/` for asset URLs. Supply the two `VITE_` variables at build time. This checkout stores the Pages Git repository inside `dist/.git`; sync `build/` into `dist/` to publish without removing Git history:

```sh
nix develop path:. --command rsync -a --delete --exclude='.git/' --exclude='README.md' build/ dist/
git -C dist add -A
git -C dist commit -m 'Update Stock Desk Pages build'
git -C dist push origin master
```

The backend and staff Edge Function are deployed.

The editable source and database migrations are on the repository's `source` branch. This checkout keeps its Git metadata in `.source-git/.git/` because the root `.git/` directory is reserved and empty. Use `git --git-dir=.source-git/.git --work-tree=. status` to inspect source changes; `dist/` remains the separate `master` checkout for Pages output.

## English and Arabic

The site offers **English** and **العربية** on the sign-in screen and in the workspace header. It initially follows the browser language and saves the user's choice on that device. Arabic switches the whole interface to right-to-left layout and uses Arabic dates, numbers, currency names, validation, business errors, reports, receipts, and CSV headings. Business names, product names, and other information entered by users stay as entered.

UI messages live in `src/locales/ar.json`; known server errors live in `src/locales/errors-ar.json`. Add each new English UI phrase to the Arabic catalog. Check coverage and the browser layout with:

```sh
nix develop path:. --command npm run check:locales
nix develop path:. --command npm run check:locale-ui
```

Run the browser check while the development server is running. It uses the local administrator credentials and Chrome to inspect both languages, desktop and mobile layouts, persistence, and an Arabic CSV export without changing business data.

## First business setup

1. In **Settings**, set the business name, address, tax number, currency and logo. Create cashier accounts under **Team access**; give each new staff member the temporary password shown once.
2. In **Inventory**, add a warehouse and products. Set a base unit such as `piece` and, if useful, an alternate unit such as `carton` with its conversion. Record opening stock or a physical count.
3. In **Contacts**, add customers and suppliers. Use **Point of sale** for sales, quotations, orders and returns. Use **Purchasing** for purchase orders, receipts and returns.
4. Record payments and eligible return refunds from contact statements. Use **Accounts & staff** for expenses, attendance and salaries. Filter and export reports under **Reports**.

Completed sales reduce stock; received purchases add it. Returns, payments and journal entries post in the same database transaction. A sale that exceeds available stock fails without leaving a partial document. The stock report shows opening, incoming, outgoing, closing and value by date and warehouse.

## Project structure

- `src/`: frontend, shared data loading and UI
- `supabase/migrations/`: deployed Postgres schema and guards
- `supabase/functions/manage-staff/`: deployed role-checked account provisioning
- `scripts/smoke.sql`: rollback-only live transaction test
- `scripts/staff-smoke.mjs`: temporary cashier test with cleanup
- `scripts/visual-check.mjs`: desktop and mobile screenshot check
- `AGENTS.md`: Nix, secret, migration and validation instructions for future work

`node scripts/apply-migration.mjs <new-migration.sql>` applies a new SQL migration to the fixed stock project and records its version. Read [AGENTS.md](AGENTS.md) before changing the live database.
