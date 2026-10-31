# session_metrics: let the gym's staff and coaches in (31 Oct 2026)

> **Run in: Mumbai — project `nptxjfvkqjuekgkspemu`** (the live app).
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
> Check the address bar shows `nptxjfvkqjuekgkspemu` before running. The old Tokyo project
> (`rzndxzhmgxkxihnwqnoy`) is not used by the app.

**Before (checked live 31 Oct):** one rule, "Users can manage own session metrics", `ALL`, roles
`{public}`, no `WITH CHECK`:

```sql
(EXISTS ( SELECT 1 FROM logged_sessions
  WHERE ((logged_sessions.id = session_metrics.session_id)
     AND (logged_sessions.client_id = ( SELECT auth.uid() AS uid)))))
```

Only the client who owns the session could read / add / edit / delete its metrics. Owner, partners,
coaches and super admin were blocked, even for sessions they logged. Other gyms were blocked (correct).

**After (choice A, approved by Anand):** same reach as `logged_sessions`.
- Client: metrics of their own sessions (as before).
- Owner / partner: metrics of any client session in their gym (read / add / edit / delete).
- Coach: metrics of their gym's PT clients' sessions (read / add / edit, no delete, like sessions).
- Super admin: all.
- Other gyms and logged-out visitors: nothing.

Nothing is dropped: the existing rule is edited in place (`alter policy`) and narrowed to signed-in
users; three coach rules are added. The app doesn't use `session_metrics` yet, so nothing changes on
screen. `client_goals` (RLS on, no rules, not used) is left locked on purpose.

## Step 1

```sql
begin;

-- Owner, partner, super admin and the client themselves: full access
alter policy "Users can manage own session metrics" on public.session_metrics
  to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or exists (select 1 from public.logged_sessions s
               where s.id = session_metrics.session_id and s.client_id = (select auth.uid()))
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
                    where s.id = session_metrics.session_id
                      and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
  )
  with check (
    (select public.get_my_role()) = 'super_admin'
    or exists (select 1 from public.logged_sessions s
               where s.id = session_metrics.session_id and s.client_id = (select auth.uid()))
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
                    where s.id = session_metrics.session_id
                      and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
  );

-- Coaches: their gym's PT clients only, no delete
create policy "iso session_metrics coach select" on public.session_metrics for select to authenticated
  using ((select public.get_my_role()) = 'coach'
    and exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
                where s.id = session_metrics.session_id
                  and p.company_id = (select public.get_my_company_id())
                  and p.role = 'client' and p.client_type = 'pt'));
create policy "iso session_metrics coach insert" on public.session_metrics for insert to authenticated
  with check ((select public.get_my_role()) = 'coach'
    and exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
                where s.id = session_metrics.session_id
                  and p.company_id = (select public.get_my_company_id())
                  and p.role = 'client' and p.client_type = 'pt'));
create policy "iso session_metrics coach update" on public.session_metrics for update to authenticated
  using ((select public.get_my_role()) = 'coach'
    and exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
                where s.id = session_metrics.session_id
                  and p.company_id = (select public.get_my_company_id())
                  and p.role = 'client' and p.client_type = 'pt'))
  with check ((select public.get_my_role()) = 'coach'
    and exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
                where s.id = session_metrics.session_id
                  and p.company_id = (select public.get_my_company_id())
                  and p.role = 'client' and p.client_type = 'pt'));

-- Check: 4 rows; the first one now has roles {authenticated}
select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'session_metrics';

commit;
```

Undo (puts the old rule back exactly; the three coach rules would also need removing, which needs
Anand's approval under Rule #1):

```sql
alter policy "Users can manage own session metrics" on public.session_metrics to public
  using (exists (select 1 from public.logged_sessions
                 where logged_sessions.id = session_metrics.session_id
                   and logged_sessions.client_id = (select auth.uid())));
```

Note: `alter policy … using (…)` without `with check` keeps the existing `with check`, so after the undo
run `select with_check from pg_policies where tablename = 'session_metrics';` — if it isn't NULL, the
new check is still there; tell Claude before going further.

## Test

Add to the cross-company test script (kept outside the repo):
1. Owner of gym A inserts metrics on a gym A client session → allowed.
2. Coach of gym A inserts / updates metrics on a gym A PT client session → allowed; on a non-PT member
   session → blocked; delete → 0 rows.
3. Owner of gym B reads / inserts metrics on a gym A session → 0 rows / blocked.
4. Client of gym A: own session allowed, another client's session blocked.
