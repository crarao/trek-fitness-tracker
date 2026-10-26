# 26 Oct 2026 — Coach logs sessions for clients (ROADMAP #39) — ALREADY RUN

**Status: run in Supabase by Anand on 26 Oct 2026, before the app change.** This file records what was run; there is nothing left to run.

Why: in gym PT the client trains in front of the coach, so the coach marks the day done for the client.
Every session now records who logged it.

What it does (additive only, nothing removed or changed):
- Adds one empty, optional column `logged_sessions.logged_by` (the staff member who logged the session).
  Existing sessions stay NULL = the client logged it themselves, as before.
- Adds two policies so staff (company admin + partner) of the client's gym can **insert** and **update**
  sessions for that gym's clients. Before this, staff could only **read** (`Company admin can read client sessions`,
  `Partners can read client sessions`) and the company admin could **delete**; only clients could insert.

```sql
-- Who logged the session (null = the client logged it themselves, as before)
alter table public.logged_sessions add column if not exists logged_by uuid references public.profiles(id);

-- Staff (coach / partner) of the client's gym can log and correct sessions for that client
create policy "Staff can log client sessions" on public.logged_sessions
  for insert to authenticated
  with check (public.get_my_role() in ('company_admin','partner')
              and logged_by = auth.uid()
              and client_id in (select id from public.profiles where company_id = public.get_my_company_id()));

create policy "Staff can update client sessions" on public.logged_sessions
  for update to authenticated
  using (public.get_my_role() in ('company_admin','partner')
         and client_id in (select id from public.profiles where company_id = public.get_my_company_id()))
  with check (public.get_my_role() in ('company_admin','partner')
              and client_id in (select id from public.profiles where company_id = public.get_my_company_id()));
```

Notes:
- Names don't clash with the existing `logged_sessions` policies. After this ran, the full list is:
  `Company admin can delete client sessions` (DELETE), `Clients can insert own sessions` (INSERT),
  `Staff can log client sessions` (INSERT), `Clients can read own sessions` (SELECT),
  `Company admin can read client sessions` (SELECT), `Partners can read client sessions` (SELECT),
  `Staff can update client sessions` (UPDATE).
- `get_my_role()` returns `profiles.role`, whose values are `super_admin | company_admin | partner | client`,
  so `('company_admin','partner')` is the staff pair used by the other staff rules (`db/2026-10-25-rls-remaining.md`).
- The insert rule requires `logged_by = auth.uid()`, so staff can't log a session in someone else's name.
  The app sets `logged_by` to the logged-in staff user's id.
- The client's own insert rule (`Clients can insert own sessions`) doesn't mention `logged_by`. The client app
  never sends it, so it stays NULL for client-logged sessions. (That rule doesn't *force* it to be NULL; a
  tighter rule would be a policy replacement, so it's left as is. The worst a client could do is make their
  own session show "by Coach …".)
- Insert policies are OR-ed: a client still logs their own sessions exactly as before.

Check (read-only):

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'logged_sessions' and column_name = 'logged_by';

select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'logged_sessions'
order by cmd, policyname;
```

**Expected:** one row `logged_by | uuid`; seven policies, matching the list above.

App behaviour before / after: the app works either way. If `logged_by` were missing, the coach's
"Mark done" saves without it (no "by Coach …" note). Without the insert policy, the coach's save fails
with a red message and nothing is saved.

**Undo — only with Anand's explicit approval (CLAUDE.md Rule #1).** No undo SQL is written here.
An undo would remove the two policies above (`Staff can log client sessions`, `Staff can update client sessions`),
so staff could no longer log or correct sessions for clients. It would not need to remove the `logged_by` column:
an unused empty column does no harm, and removing it would lose the record of who logged each session.
