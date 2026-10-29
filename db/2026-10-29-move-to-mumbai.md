# 29 Oct 2026 — Move the database from Tokyo to Mumbai (ROADMAP #48)

**Old:** `trek-fitness-tracker`, Tokyo (`ap-northeast-1`), ref `rzndxzhmgxkxihnwqnoy` — stays untouched as the backup.
**New:** `coachboard-mumbai`, Mumbai (`ap-south-1`), created 29 Oct, project URL
`https://nptxjfvkqjuekgkspemu.supabase.co` (ref `nptxjfvkqjuekgkspemu`). Empty until Part C.

Nothing in this file deletes anything (CLAUDE.md Rule #1). The live app keeps using Tokyo until
Part E (the Vercel switch), so Parts A–B and the dry run in Part C can be done at any time without users noticing (see Part D).

Method: based on Supabase's guide "Backup and Restore using the CLI", using `pg_dump`/`psql` directly (no Docker)
(supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
It copies tables, RLS rules, functions, triggers, login accounts (`auth.users`, passwords
kept) and all data. **Not** stored files: Tokyo has 1 public bucket `branding` with 2 files
(Coach Rich's banner and logo, uploaded 19 Oct, ~350 KB), moved by hand in C7.

**A3 results (29 Oct):** Tokyo PostgreSQL 17.6, Mumbai 17.11 (OK). Extensions: only Supabase
defaults (pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp), nothing to enable.
Vault secrets 0. Triggers on auth/storage: only Supabase's own storage triggers. Tools on
Anand's PC: pg_dump / psql 17.11 (no Docker).

---

## Part A — Get the computer ready (once, ~20 min)

**A1. Install the PostgreSQL 17 command-line tools** (gives `pg_dump` and `psql`)
postgresql.org/download/windows → EDB installer → 17.x, Windows x86-64. Tick **only "Command
Line Tools"**. Add `C:\Program Files\PostgreSQL\17\bin` to Path. Check in a **new** PowerShell:
```powershell
pg_dump --version
psql --version
```
Both print 17.x. **No Docker needed** (29 Oct: Docker Desktop won't install on Anand's Windows
version, so this runbook uses `pg_dump` directly instead of `supabase db dump`).

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
-- 7. Triggers on Supabase's own tables (auth/storage) that the app added — expected none
select event_object_schema, event_object_table, trigger_name from information_schema.triggers
where event_object_schema in ('auth', 'storage');
-- 8. Custom login roles (expected none)
select rolname from pg_roles where rolcanlogin and rolname not like 'pg\_%' and rolname not in
  ('postgres','authenticator','supabase_admin','supabase_auth_admin','supabase_storage_admin',
   'supabase_replication_admin','supabase_read_only_user','pgbouncer','supabase_etl_admin','dashboard_user','cli_login_postgres');
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
Send screenshots of all eight. Keep result 6 — it is the "before" picture.

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

**C2. Make the copy from Tokyo** (read-only on Tokyo; three files):
```powershell
pg_dump $OLD --schema-only --schema=public --no-owner --quote-all-identifiers -f schema.sql
pg_dump $OLD --data-only --schema=public --quote-all-identifiers -f data_public.sql
pg_dump $OLD --data-only --table=auth.users --table=auth.identities --quote-all-identifiers -f data_auth.sql
dir
```
- `schema.sql` = tables, RLS rules, functions, triggers, grants. **No user data.** Send it to
  Claude: it checks it and removes lines Mumbai would refuse (e.g. `FOR ROLE supabase_admin`),
  and sends back `schema_fixed.sql`.
- `data_public.sql`, `data_auth.sql` = the real data (names, phones, login password hashes).
  **Never send or upload these.** Delete them after the move is confirmed.
- Logins: `auth.users` + `auth.identities` carry email/phone logins and passwords. Sessions are
  not copied, so everyone logs in once more.

**C3. Load it into Mumbai — dry run first (changes nothing):**
```powershell
psql -d $NEW -v ON_ERROR_STOP=1 -c "begin" -f schema_fixed.sql -c "set session_replication_role = replica" -f data_auth.sql -f data_public.sql -c "rollback"
```
It ends with `ROLLBACK` and no `ERROR` → everything would load. Errors → send the last ~20 lines
(they show structure, not data). Because it ends with rollback, it can be repeated any number of
times, even days before move day.

**C3b. Real load (move day):** same command with `commit` instead of `rollback`:
```powershell
psql -d $NEW -v ON_ERROR_STOP=1 -c "begin" -f schema_fixed.sql -c "set session_replication_role = replica" -f data_auth.sql -f data_public.sql -c "commit"
```
(`session_replication_role = replica` stops triggers firing while old rows are loaded, as in
Supabase's own guide.)

**C4. Check Mumbai** — in the **Mumbai** SQL Editor:
- Run A3-6 (row counts): must match Tokyo's numbers exactly.
- Run A3-5: the `rls_auto_enable` event trigger is not copied (only its function). It only
  auto-enables RLS on future new tables; we enable RLS by hand on every new table anyway
  (CLAUDE.md), so it can stay off. Don't turn it on from the dashboard (the function already exists).
- Security Advisor and Performance Advisor → Refresh: should look like Tokyo's today
  (3 security warnings; "Multiple Permissive Policies" only).

**C5. Copy the Auth settings** from your A4 note into Mumbai → Authentication (Site URL, Redirect
URLs, email settings).

**C6. Try it before switching** (optional but recommended): on your computer, in the project's
`.env.local`, temporarily put Mumbai's values (Part E1) and run `npm run dev`; log in as coach,
partner and client at `localhost:3000`. Put Tokyo's values back afterwards.
Don't add data during this test: anything changed in Mumbai here stays there.

**C7. Move the 2 branding files (~10 min)**
1. Tokyo → **Storage** → bucket `branding` → folder `Coach Rich` → download
   `coach_rich_banner.jpg` and `coach_rich_logo.png` (⋯ → Download).
2. Mumbai → **Storage** → **New bucket** → name `branding` (exactly), **Public bucket ON** → Create.
3. In it, create folder `Coach Rich` (same spelling and space) and upload both files.
4. Open one file in Mumbai (⋯ → Get URL) and check it shows in the browser.
5. Point Coach Rich's company at the Mumbai copies (edits two columns in place, nothing deleted).
   In the **Mumbai** SQL Editor, check first:
   ```sql
   select name, logo_url, banner_url from public.companies
   where logo_url like '%supabase.co/storage%' or banner_url like '%supabase.co/storage%';
   ```
   then (Tokyo's ref is `rzndxzhmgxkxihnwqnoy`; checked 29 Oct: only Coach Rich's `logo_url` points
   at Tokyo storage, `banner_url` is empty, so the banner file is copied but not used):
   ```sql
   update public.companies
   set logo_url = replace(logo_url, 'rzndxzhmgxkxihnwqnoy.supabase.co', 'nptxjfvkqjuekgkspemu.supabase.co'),
       banner_url = replace(banner_url, 'rzndxzhmgxkxihnwqnoy.supabase.co', 'nptxjfvkqjuekgkspemu.supabase.co')
   where logo_url like '%rzndxzhmgxkxihnwqnoy.supabase.co%' or banner_url like '%rzndxzhmgxkxihnwqnoy.supabase.co%'
   returning name, logo_url, banner_url;
   ```
   The returned links should open the images. (Until this runs, the logo still loads from
   Tokyo, so it keeps working as long as Tokyo isn't paused.)

---

## Part D — Timing

- Parts A, B, C2 and the **dry run C3** can be done any time: nothing in Tokyo or Mumbai changes.
- On move day (quiet evening, ~1 hour, tell the trial coaches): make fresh files (C2 again, so
  they include today's data), dry run, real load (C3b), check (C4–C5), branding files (C7), then Part E straight away.
- After C3b Mumbai holds data, so a second real load would need it emptied (a deletion, Rule #1).
  The dry run is what makes that unnecessary.

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
