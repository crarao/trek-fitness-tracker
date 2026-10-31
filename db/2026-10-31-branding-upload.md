# Logo / banner upload from the super admin panel (31 Oct 2026)

Super admin → Companies → Edit → **Logo & banner** uploads a gym's logo and login banner from the
browser (`lib/branding-upload.ts`). Files go to the existing **public** Storage bucket `branding`
(made by hand during the Mumbai move, `db/2026-10-29-move-to-mumbai.md` C7), in a folder per company
id, e.g. `branding/<company id>/logo-1761900000000.png`. The public link is saved in
`companies.logo_url` / `banner_url`.

Today nobody may add files to the bucket from the app (Storage has RLS on `storage.objects`, and there
is no rule for it). This adds **one rule: only super admin may add files to `branding`**. Reading needs
no rule (public bucket links). Nothing is dropped, deleted or overwritten: every upload gets a new file
name, and "Remove logo" / "Use the stock photo" only clear the link on the company (the file stays).

Optional step 2 limits the bucket to images of at most 5 MB (the app already shrinks logos to 512 px
and banners to 1600 px before uploading, so real files are well under that).

## Step 0: check (read-only)

```sql
-- 1. The bucket: expect one row, public = true
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'branding';

-- 2. Existing Storage rules: expect none mentioning branding
select policyname, cmd, roles from pg_policies where schemaname = 'storage' and tablename = 'objects';
```

If query 1 returns no row, or `public` is false, stop and send a screenshot.

## Step 1: super admin may upload to `branding`

```sql
create policy "branding super admin upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'branding' and (select public.get_my_role()) = 'super_admin');
```

## Step 2 (recommended): images only, 5 MB max

```sql
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
where id = 'branding';
```

Applies to new uploads only; the two files already in the bucket stay as they are.

**Result 31 Oct:** Steps 1 and 2 ran on production: rule "branding super admin upload" (INSERT, authenticated) is the only Storage rule; bucket `branding` is public, 5 MB limit, PNG / JPEG / WebP only.

## Test

1. `/admin` → Companies → Coach Rich → Edit → **Upload banner** → pick a wide photo. "Banner updated ✓",
   and the preview shows it.
2. Open `coach-rich.getcoachboard.com` on a phone (private tab): the login shows the new banner.
3. **Upload logo** with a PNG → preview and the login show it; the owner's dashboard header too.
4. Before Step 1 runs, an upload shows "Upload not allowed yet: run db/2026-10-31-branding-upload.md".
