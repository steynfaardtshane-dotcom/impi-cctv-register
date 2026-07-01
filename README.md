# IMPI CCTV IP & Diagram Register — Setup Guide

A installable app (PWA) for logging CCTV device IPs and site diagrams,
usable offline, synced automatically across your phone and laptop, with a
one-click branded PDF report. Free to host and run.

This guide assumes no coding background — follow it top to bottom.

---

## What you're setting up

- **Supabase** (free) — the database that stores your sites, devices and
  diagrams, and keeps your phone and laptop in sync.
- **GitHub Pages** (free) — hosts the app itself, same as your existing
  technical report PWA.
- **GitHub Actions** — automatically rebuilds and republishes the site every
  time you (or I, in a future session) push a code change. You never run a
  deploy command by hand.

---

## Step 1 — Create the Supabase project (5 min)

1. Go to https://supabase.com and sign up / log in (free tier is enough).
2. Click **New project**. Name it `impi-cctv-register`, choose a strong
   database password (save it somewhere safe), pick a region close to South
   Africa (e.g. `eu-west` or `af-south-1` if offered), and create it.
3. Once it's ready, open **SQL Editor** in the left sidebar → **New query**.
4. Open the file `supabase/schema.sql` from this project, copy all of it,
   paste it into the SQL editor, and click **Run**.
   - Before running, edit this one line to use your real admin email:
     ```sql
     select auth.jwt() ->> 'email' = 'shane@impi-secure.co.za';
     ```
5. Go to **Authentication → Users** in the sidebar → **Add user** →
   **Create new user**. Add two accounts:
   - Your admin account (the same email you put in the SQL above), with a
     password you'll remember.
   - One shared technician account, e.g. `team@impi-secure.co.za`, with a
     password you'll share with the technical division.
   Tick "Auto Confirm User" for both so they can log in immediately.
6. Go to **Settings → API**. You'll need two values from this page in Step 3:
   - **Project URL**
   - **anon public** key

---

## Step 2 — Put the code on GitHub (5 min)

1. Go to https://github.com and create a **new repository** named
   `impi-cctv-register`. Keep it **Public** (required for free GitHub
   Pages) — the app itself requires login, so this is safe; no site data is
   in the code.
2. On your computer, unzip the project folder I've given you, then open a
   terminal inside it and run:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/impi-cctv-register.git
   git push -u origin main
   ```
   (Replace `YOUR-USERNAME` with your GitHub username — same account you use
   for `shaneimpi/impi-technical-report`.)

---

## Step 3 — Add your Supabase keys as GitHub Secrets (2 min)

These let GitHub Actions build the app with your credentials without ever
putting them in the public code.

1. In your new GitHub repo: **Settings → Secrets and variables → Actions →
   New repository secret**. Add three secrets:
   - `VITE_SUPABASE_URL` → the Project URL from Step 1.6
   - `VITE_SUPABASE_ANON_KEY` → the anon public key from Step 1.6
   - `VITE_ADMIN_EMAIL` → your admin email (must match the SQL from Step 1.4)

---

## Step 4 — Turn on GitHub Pages (1 min)

1. In the repo: **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Go to the **Actions** tab, open the "Deploy to GitHub Pages" run (it
   starts automatically after your push), and wait for it to finish (~1
   minute).
4. Your app will be live at:
   ```
   https://YOUR-USERNAME.github.io/impi-cctv-register/
   ```

Any time you want changes made (by me, in a future session, or by a
developer), pushing to the `main` branch automatically rebuilds and
republishes — no manual redeploy step, ever.

---

## Step 5 — Install it on your phone and laptop

- **Android / desktop Chrome/Edge:** open the link above → menu (⋮) →
  **Install app** (or the install icon in the address bar).
- **iPhone/iPad (Safari):** open the link → Share button → **Add to Home
  Screen**.

Once installed, it behaves like a native app icon, opens full-screen, and
the last data you loaded stays available even with no signal — new devices
and edits made offline are saved on the phone/laptop and sync automatically
the next time it has signal.

---

## How the day-to-day system works

- **Log in** with your admin account, or the shared technician account.
- **Sites** in the left menu — each client site has its own floor plan,
  device list, and pins.
- **Diagram tab** — upload a site photo/floor plan, then place pins for each
  camera. Drag pins to reposition.
- **Devices tab** — the full IP register: label, location, IP, MAC, make &
  model, NVR channel, power, status, notes.
- **Print / PDF** — always reflects the live, current data. Anyone with
  access can generate an up-to-date, IMPI-letterheaded report at any time —
  nothing to update manually. Use your browser's "Save as PDF" in the print
  dialog to get a file to send to a client or a technician heading to site.
- **Admin-only:** deleting an entire site. Both accounts can add, edit and
  remove individual devices and pins.

## Limitations worth knowing

- Uploading a **new floor plan photo** needs an internet connection (photos
  go to Supabase's file storage). Everything else — adding/editing devices,
  moving pins, editing site info, printing reports — works fully offline
  using the last-synced data, and pushes automatically once you're back
  online.
- The shared technician account is one login for the whole team — it won't
  show who made which change. If you'd like per-person accountability
  later, I can add named technician accounts and an activity log.
