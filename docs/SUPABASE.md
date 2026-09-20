# Accounts + cloud sync (Supabase, $0)

The app runs fully local with no accounts. Adding a free Supabase project turns on
email/password login, "remember me" (session persists on the device), and per-user
sync (your marks follow you across devices). Without the keys, nothing changes.

## 1. Create the project
1. Go to https://supabase.com, sign in, **New project** (Free plan). Choose a region and set a database password.
2. Wait for it to provision (~1–2 min).

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

create policy "own visits" on public.visits
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

Row-level security means each user can only read/write their own rows.

## 3. (Optional) instant signup
Dashboard -> **Authentication -> Providers -> Email** -> turn **Confirm email OFF**
so sign-up logs you straight in. Leave it on if you prefer email confirmation.

## 4. Get the keys
Dashboard -> **Project Settings -> API**. Copy:
- **Project URL**
- **anon public** key (this key is public by design; RLS protects the data)

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

## Notes
- "Remember me" is on by default: the session is stored on the device and survives
  reloads/reboots until you log out.
- Sharing (link overlays) is unchanged and works with or without accounts.
- Sync is last-write-wins per place (by `updated_at`); local-first when logged out.
