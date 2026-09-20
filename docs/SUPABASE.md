# Accounts + cloud sync (Supabase, $0)

The app runs fully local with no accounts. Adding a free Supabase project turns on
email/password login, "remember me" (session persists on the device), and per-user
sync (your marks follow you across devices). Without the keys, nothing changes.

## 1. Create an organization, then a project
New accounts create an **organization** first — it is just a container; the
project lives inside it.
1. Go to https://supabase.com and sign in (GitHub login is easiest).
2. If prompted, **create an organization**: any name (e.g. `personal`), plan **Free** -> Create organization.
3. Now click **New project** (on the dashboard, or the button inside the org):
   - Name: e.g. `travel-tracker`
   - Database password: set a strong one and save it
   - Region: the one closest to you
   - Plan: Free
   Create it and wait ~1–2 min for it to provision.

## 2. Create the table + security
Supabase dashboard -> **SQL Editor** -> New query -> paste and **Run**:

```sql
create table if not exists public.visits (
  user_id    uuid not null references auth.users on delete cascade,
  place_id   text not null,
  status     text not null,
  trips      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

alter table public.visits enable row level security;

drop policy if exists "own visits" on public.visits;
create policy "own visits" on public.visits
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

(The `drop policy if exists` makes it safe to re-run. If you saw
`policy "own visits" ... already exists`, it just means it was already created —
the setup is done.)

Row-level security means each user can only read/write their own rows.

## 3. (Optional) instant signup
Dashboard -> **Authentication -> Providers -> Email** -> turn **Confirm email OFF**
so sign-up logs you straight in. Leave it on if you prefer email confirmation.

## 4. Get the keys
Dashboard -> **Project Settings -> API**. Copy:
- **Project URL**
- the client key: **anon public** (older projects) or **publishable key** / `sb_publishable_...`
  (newer projects). Either one works as `VITE_SUPABASE_ANON_KEY`. Do NOT use the
  `service_role` / secret key. The client key is public by design; RLS protects the data.

## 5. Local: create `.env.local`
In `travel-tracker/`, copy `.env.example` to `.env.local` and fill in:

```
VITE_SUPABASE_URL=https://YOURPROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your anon key...
```

`.env.local` is gitignored. Restart the dev server (env is read at startup):

```
npm run dev
```

An **Account** box appears in the sidebar. Sign up, then log in. Your marks now
sync to your account; log in on another device to see them there.

## 6. Live site (GitHub Pages)
For the deployed site to have accounts, add the same two values as repository
secrets: GitHub repo -> **Settings -> Secrets and variables -> Actions -> New
repository secret** -> add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
The deploy workflow already passes them to the build; push (or re-run the workflow)
and the live site gets login too.

## Password reset
The login screen has "Forgot password?" which emails a reset link. For the link to
return to the app, add your URLs to the allowlist: Dashboard -> **Authentication ->
URL Configuration** -> add the Site URL (the live GitHub Pages URL) and
`http://localhost:5173`. Clicking the link reopens the app, which then prompts for a
new password.

## Deleting an account
The in-app **Delete account** removes your data from the cloud and signs you out.
Removing the login itself (the auth user) is done from the dashboard:
**Authentication -> Users -> (row) -> Delete user**, or via a small Edge Function if
you want it fully in-app later.

## Notes
- "Remember me" is on by default: the session is stored on the device and survives
  reloads/reboots until you log out.
- Sharing (link overlays) is unchanged and works with or without accounts.
- Sync is last-write-wins per place (by `updated_at`); local-first when logged out.
