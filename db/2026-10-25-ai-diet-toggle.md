# 25 Oct 2026 — `ai_diet_enabled` on companies (AI diet chart on/off per gym)

Adds one column, `true` for every existing company (nothing changes until the super admin turns it off).
No policy changes: the super admin already updates companies; coaches can't change it
(trigger `protect_company_columns` limits them to logo / banner).

```sql
alter table public.companies add column if not exists ai_diet_enabled boolean not null default true;
```

Then: Super admin → Companies → Edit → AI Diet Chart ON/OFF → Save.
When OFF: the coach's "Create diet chart with AI" button is hidden and the server refuses AI diet
requests for that gym. Typing or editing the diet plan by hand, and clients seeing it, are unchanged.
