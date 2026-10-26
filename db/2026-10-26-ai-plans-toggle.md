# 26 Oct 2026 — `ai_plans_enabled` on companies (AI plans on/off per company) — RUN WHEN AT A COMPUTER

Adds one column, `true` for every existing company (nothing changes until the super admin turns it off).
One switch per company: a gym or an online coach's business.
No policy changes: the super admin already updates companies; coaches can't change it
(trigger `protect_company_columns` limits them to logo / banner).

```sql
alter table public.companies add column if not exists ai_plans_enabled boolean not null default true;
```

Check:

```sql
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'companies' and column_name = 'ai_plans_enabled';
```

**Expected:** one row `ai_plans_enabled | boolean | true`.

Then: Super admin → Companies → Edit → AI Plans ON/OFF → Save.
When OFF: the coach's "✨ Create plan with AI" button is hidden (and the "for a better AI plan" profile note)
and the server refuses AI plan requests for that company, so no AI call and no cost. Writing, pasting and
editing plans by hand, and clients seeing their plans, are unchanged.

Before this runs: the super admin's AI Plans switch is greyed out ("Needs one SQL line first") and AI plans
stay on for everyone, as today.

Undo — only with Anand's explicit approval (CLAUDE.md Rule #1): no undo SQL is written here. An undo would
remove the `ai_plans_enabled` column; turning the switch ON for every company does the same job without removing anything.
