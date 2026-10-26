# 26 Oct 2026 — `client_id` on ai_usage (which member each AI call was for)

The AI cost log already records the gym and who asked (the coach). This adds the member the AI
plan / diet chart / insight was for, so the super admin Dashboard can show AI cost per member,
and #37 (5 AI plans per PT client per month) can count per member.

```sql
alter table public.ai_usage add column if not exists client_id uuid;
create index if not exists ai_usage_client_created on public.ai_usage (client_id, created_at);
```

AI calls made before this show as "Member not recorded" in the breakdown. Before it runs, the app
records calls without the member, as now.
