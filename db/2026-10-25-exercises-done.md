# 25 Oct 2026 — `exercises_done` on logged_sessions (#15 full version) — RUN WHEN AT A COMPUTER

Adds one empty, optional column. Existing sessions are untouched (NULL). No policy changes:
clients already insert their own sessions; staff already read their gym's sessions.

```sql
alter table public.logged_sessions add column if not exists exercises_done jsonb;
```

Check:

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'logged_sessions' and column_name = 'exercises_done';
```

Shape (written by the app): `{ "done": ["Goblet Squat", "Plank"], "total": 7 }`.

Before this runs: clients can still tick exercises during a workout (kept on their phone) and mark the
day Done as usual, but the ticks aren't saved with the session and the coach doesn't see them.
After it runs: ticks are saved with each Done and the coach sees "6 of 7 exercises".
