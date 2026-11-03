Ran on prod (Mumbai): ✅ 3 Nov 2026 (by Anand). Branches then added from Super Admin; owners see them read-only.
Ran on dev: n/a (dev DB not set up yet)

# 3 Nov 2026 — Only super admin adds / edits branches (pricing is per branch) — ✅ RUN ON MUMBAI 3 NOV — do not run again

> **Run in: Mumbai — project `nptxjfvkqjuekgkspemu`** (the live app).
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
> Check the address bar shows `nptxjfvkqjuekgkspemu` before running. The old Tokyo project
> (`rzndxzhmgxkxihnwqnoy`) is not used by the app.

**Anand runs this; Claude does not.** Run after `db/2026-11-03-branches-batches.md` (already run 3 Nov).
No `DROP`, no `DELETE`, no `TRUNCATE` (CLAUDE.md Rule #1): the two rules are changed in place with `alter policy`.

## What it does

Decided 3 Nov: CoachBoard will price dojos **per branch**, so a gym must not add branches itself.

- **Branches:** add, rename, archive / restore → **super admin only** (Super Admin → Companies → Edit → Branches).
  Owner, partners, senseis and students still **read** their gym's branches.
- **Batches:** unchanged. Owner and partners add and edit batches **inside the branches super admin created**
  (a batch must be at a branch of the same gym, checked by the existing `iso batches insert / update` rules).
- Nothing else changes: `iso branches select` and `iso branches delete` (`using (false)`) stay as they are,
  grants stay as they are (the table grant allows insert / update, the rule now only lets super admin through).

## Step 1 — change the two rules

```sql
begin;

alter policy "iso branches insert" on public.branches
  with check ((select public.get_my_role()) = 'super_admin');

alter policy "iso branches update" on public.branches
  using ((select public.get_my_role()) = 'super_admin')
  with check ((select public.get_my_role()) = 'super_admin');

commit;
```

## Step 2 — check

```sql
select policyname, cmd, qual, with_check from pg_policies
where schemaname = 'public' and tablename = 'branches' order by cmd;
```

Expect 4 rows. `iso branches insert` / `iso branches update` mention only `super_admin` (no `company_admin`, no
`partner`); `iso branches select` is unchanged (gym members read their gym's branches); `iso branches delete` is `false`.

## Before this runs

The app (PR #92) already hides "Add branch", Edit and Archive for branches from owners and partners, so the only
difference is that a direct database call from an owner could still add a branch until this runs.

## Undo

Only with Anand's explicit approval: run the same two `alter policy` statements with the 3 Nov condition from
`db/2026-11-03-branches-batches.md` Step 1 item 4 (super admin **or** owner / partner of the same gym).
