# 29 Oct 2026 — Move the database from Tokyo to Mumbai (ROADMAP #48)

**Old:** `trek-fitness-tracker`, Tokyo (`ap-northeast-1`) — stays untouched as the backup.
**New:** `coachboard-mumbai`, Mumbai (`ap-south-1`), created 29 Oct, project URL
`https://nptxjfvkqjuekgkspemu.supabase.co` (ref `nptxjfvkqjuekgkspemu`). Empty until Part C.

Nothing in this file deletes anything (CLAUDE.md Rule #1). The live app keeps using Tokyo until
Part E (the Vercel switch), so Parts A–B can be done at any time without users noticing; Parts C and E are done together on move day (see Part D).

Method: Supabase's own guide, "Backup and Restore using the CLI"
(supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
It copies roles, tables, RLS rules, functions, triggers, login accounts (`auth.users`, passwords
kept) and all data. The app keeps no files in Supabase Storage (logos and banners are links saved
in `companies`), which A3 confirms.

---

## Part A — Get the computer ready (once, ~20 min)

**A1. Install two tools on Windows**
1. **Docker Desktop** — docker.com/products/docker-desktop. Install, start it, wait until it says
   "Engine running". The Supabase CLI uses it to make the copy.
2. **PostgreSQL 17 command-line tools** (for `psql`) — postgresql.org/download/windows → EDB
   installer. In the installer, tick **only "Command Line Tools"** (no server needed).
   Then add `C:\Program Files\PostgreSQL\17\bin` to PATH (Start → "Edit the system environment
   variables" → Environment Variables → Path → New).

Check, in a **new** PowerShell window:
```powershell
docker --version
psql --version
npx supabase --version
```
All three print a version. (`npx supabase` downloads the CLI the first time.)

**A2. Same Postgres version on both projects** — run in **each** project's SQL Editor:
```sql
select version();
```
Mumbai must be the same major version as Tokyo or newer (e.g. both 17). If Mumbai is older, stop.

**A3. What Tokyo has besides tables** — run in the **Tokyo** SQL Editor (read-only):
```sql
-- 1. Extensions in use (anything beyond the defaults must be switched on in Mumbai first, C1)
select extname, extversion from pg_extension order by extname;
-- 2. Storage buckets and files (expected 0 / 0)
select (select count(*) from storage.buckets) as buckets, (select count(*) from storage.objects) as files;
-- 3. Vault secrets (expected 0; if not, see "Vault" at the end)
select count(*) as vault_secrets from vault.secrets;
-- 4. Realtime publications (the app doesn't use Realtime; expected none beyond supabase_realtime)
select pubname from pg_publication;
-- 5. Event triggers (rls_auto_enable)
select evtname, evtenabled from pg_event_trigger;
-- 6. Row counts to compare after the copy
select 'companies' t, count(*) from public.companies union all
select 'profiles', count(*) from public.profiles union all
select 'memberships', count(*) from public.memberships union all
select 'weekly_plans', count(*) from public.weekly_plans union all
select 'logged_sessions', count(*) from public.logged_sessions union all
select 'session_feedback', count(*) from public.session_feedback union all
select 'ai_usage', count(*) from public.ai_usage union all
select 'contact_requests', count(*) from public.contact_requests union all
select 'auth.users', count(*) from auth.users;
```
Send screenshots of all six. Keep result 6 — it is the "before" picture.

**A4. Copy Tokyo's Auth settings by hand into a note** (the dump does not copy them).
Tokyo dashboard → **Authentication**:
- **URL Configuration:** Site URL and every Redirect URL.
- **Sign In / Providers → Email:** whether "Confirm email" is on, "Secure email change", etc.
- **Emails / SMTP:** custom SMTP if any, and any edited email templates.
- **Rate limits** and **Sessions** if you ever changed them.
Screenshots are fine.

---

## Part B — Connection strings (~5 min)

In **each** project: top bar **Connect** → **Session pooler** → copy the URI. It looks like
`postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`.
Use the Session pooler (works on any home internet; the "Direct" one needs IPv6).

- Put each project's database password in place of `[YOUR-PASSWORD]`.
  Forgot Tokyo's? Tokyo → Project Settings → Database → **Reset database password** (safe: the app
  uses API keys, not this password).
- If a password contains `@ : / ? # % &`, replace those characters: `@`→`%40`, `:`→`%3A`,
  `/`→`%2F`, `?`→`%3F`, `#`→`%23`, `%`→`%25`, `&`→`%26`.

In PowerShell, in a new empty folder (e.g. `C:\coachboard-move`):
```powershell
mkdir C:\coachboard-move; cd C:\coachboard-move
$OLD = "postgresql://postgres.<tokyo-ref>:<password>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
$NEW = "postgresql://postgres.nptxjfvkqjuekgkspemu:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
psql $OLD -c "select current_database();"
psql $NEW -c "select current_database();"
```
Both print `postgres`. (Copy the host part exactly from the Connect box; the `aws-0-…` part may differ.)
These files contain your data and passwords: keep the folder private and don't upload it anywhere.

---

## Part C — Copy (on move day, ~30 min; the live app still runs on Tokyo until Part E)

**C1. Extensions** — in Mumbai → Database → **Extensions**, switch on any extension from A3-1
that Mumbai doesn't already have on (ignore the ones already on by default).

**C2. Make the copy from Tokyo** (Docker Desktop must be running):
```powershell
npx supabase db dump --db-url $OLD -f roles.sql --role-only
npx supabase db dump --db-url $OLD -f schema.sql
npx supabase db dump --db-url $OLD -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
dir
```
Three files appear. `data.sql` is the biggest (a few MB at most).

**C3. Load it into Mumbai** — one command, all or nothing (any error rolls everything back):
```powershell
psql --single-transaction --variable ON_ERROR_STOP=1 `
  --file roles.sql `
  --file schema.sql `
  --command "SET session_replication_role = replica" `
  --file data.sql `
  --dbname $NEW
```
Ends without `ERROR` → done. If it stops with an error, send the last ~20 lines. Known fixes from
Supabase's guide:
- error about `supabase_admin` ownership → in `schema.sql`, put `-- ` in front of lines
  `ALTER ... OWNER TO "supabase_admin"`, save, run C3 again;
- error about `cli_login_postgres` → in `roles.sql`, put `-- ` in front of the line
  `GRANT "postgres" TO "cli_login_postgres"`, run C3 again.
(Because it is all-or-nothing, a failed run leaves Mumbai empty, so running again is safe.)

**C4. Check Mumbai** — in the **Mumbai** SQL Editor:
- Run A3-6 (row counts): must match Tokyo's numbers exactly.
- Run A3-5: if `rls_auto_enable` isn't listed, Database → Settings (or the project's security
  settings) → turn on **Automatic RLS**.
- Security Advisor and Performance Advisor → Refresh: should look like Tokyo's today
  (3 security warnings; "Multiple Permissive Policies" only).

**C5. Copy the Auth settings** from your A4 note into Mumbai → Authentication (Site URL, Redirect
URLs, email settings).

**C6. Try it before switching** (optional but recommended): on your computer, in the project's
`.env.local`, temporarily put Mumbai's values (Part E1) and run `npm run dev`; log in as coach,
partner and client at `localhost:3000`. Put Tokyo's values back afterwards.
Don't add data during this test: anything changed in Mumbai here stays there.

---

## Part D — Why Part C is done once, on move day

The copy can only be loaded into an **empty** project. Emptying Mumbai after a rehearsal would
be a deletion (Rule #1), and the free plan can't run a third project. So:

- Do Parts A and B **any time** (no effect on anything).
- Do Part C and Part E **together on move day**, in a quiet slot (late evening, ~1 hour).
  During that hour nobody should add or change data in the app; tell the trial coaches.
- If C3 fails, nothing is loaded (all-or-nothing): fix and re-run. If something looks wrong after
  Part E, use the way back; Tokyo has everything up to the copy.

---

## Part E — Switch the app to Mumbai (~15 min)

**E1. New keys** — Mumbai → Project Settings → **API Keys**: copy the publishable key and the
secret key. Project URL: `https://nptxjfvkqjuekgkspemu.supabase.co`.

**E2. Vercel** → project `getcoachboard` → Settings → **Environment Variables**, for Production
(and Preview):
- `NEXT_PUBLIC_SUPABASE_URL` → Mumbai URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → Mumbai publishable key
- `SUPABASE_SECRET_KEY` → Mumbai secret key
Write down the old Tokyo values first (that is the way back).

**E3. Server region** — merge the prepared PR that changes `vercel.json` from `hnd1` (Tokyo) to
`bom1` (Mumbai). Merging redeploys with the new variables. (If the variables were changed after
the PR deployed, Vercel → Deployments → latest → **Redeploy**.)

**E4. Test on getcoachboard.com:** coach, partner and client log in (everyone has to log in once
more; passwords are unchanged); member list, client page, plans, sessions, AI plan, WhatsApp share;
super admin → Dashboard. Then check the `x-vercel-id` header on an `/api/` request reads `…::bom1::…`.

**Way back (if something is wrong):** put the Tokyo values back in E2, revert the `vercel.json`
PR (or set `hnd1` again), redeploy. Tokyo has everything up to the moment of the copy.

---

## Part F — After the move

- Keep Tokyo **untouched** for 1–2 weeks (don't change data there; it's the backup).
- Then pause Tokyo (Project Settings → General → Pause project) and resume StudyMate.
- Update CLAUDE.md "Hosting region" and ROADMAP #48 (Claude does this when told the move is done).
- Your own computer: update `.env.local` to the Mumbai values.

**Vault (only if A3-3 was not 0):** the copy doesn't carry Vault's encryption key; tell Claude
before Part C and it will add the key-copy step from Supabase's guide.
