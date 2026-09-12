# Diamondback Little League — Combine Results Site

Static site (no build step) with Firestore as the database and Firebase
Authentication for Coach Mode. Deploys straight to Vercel from GitHub.

This is the Diamondback Little League baseball version of the Desert Apex
football combine site — same engine, different drills:
**20 Yard Dash, Med Ball Throw, 5-10-5 Shuttle, Pitching Velocity, Exit Velocity.**

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Add project**.
   Give it its own name (e.g. `diamondback-little-league-combine`) — keep it
   separate from the Desert Apex project so the two rosters don't mix.
2. Once created, click the **</> (Web)** icon on the project overview page to register a web app.
   Give it a nickname, you don't need Firebase Hosting.
3. Copy the `firebaseConfig` object it shows you. Paste those values into
   `js/firebase-config.js` in this project, replacing the placeholders.

## 2. Turn on Firestore

1. In the left sidebar: **Build → Firestore Database → Create database**.
2. Start in **production mode** (the rules file below will handle access, not the "test mode" default).
3. Pick a location close to you (e.g. `us-west3` / Los Angeles, or `nam5`) and create it.
4. Go to the **Rules** tab and replace the contents with what's in `firestore.rules`
   in this project, then click **Publish**.
   - This makes the leaderboard/search public (no login) but requires a signed-in
     coach account to add athletes or results.

## 3. Turn on Authentication (for Coach Mode)

1. **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Email/Password**.
3. Go to the **Users** tab and click **Add user** — create one login per coach
   (e.g. `coach@redlinenorthphoenix.com` + a password). This is what they'll
   use to sign into Coach Mode on the live site. You can add/remove coaches
   here any time without touching code.

## 4. Logos

Both logos are already included: `assets/diamondback-logo.png` (primary
brand, shown large in the header) and `assets/redline-logo.png` (shown
smaller as the testing partner).

## 5. Push this project to GitHub

If you already have a repo, drop these files into it (keep the folder
structure as-is: `index.html`, `css/`, `js/`, `assets/`). Otherwise:

```bash
cd diamondback-combine-site
git init
git add .
git commit -m "Initial combine site"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## 6. Deploy on Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → pick this repo.
2. Framework preset: choose **Other** (it's a static site, no build command needed).
3. Leave the build/output settings blank and click **Deploy**.
4. Once it's live, copy the `*.vercel.app` URL (or your custom domain once you add one).

## 7. Authorize the domain in Firebase

Firebase Auth blocks sign-ins from domains it doesn't know about:

1. Back in Firebase console: **Authentication → Settings → Authorized domains**.
2. Click **Add domain** and paste in your Vercel URL (e.g. `diamondback-combine.vercel.app`),
   and again later if you attach a custom domain.

Without this step, Coach sign-in will fail on the live site even though it
works fine when you test locally.

## Using it day-to-day

- **Public leaderboard/search** — works for anyone, no login, at your Vercel URL.
- **Coach Mode** — click "Coach" in the banner, sign in with a coach account
  from step 3. From there:
  - **Add Athlete** / **Log a Result** — same manual entry as before.
  - **Import From Spreadsheet** — upload an `.xlsx`/`.csv` export. It
    auto-matches columns by header name (looks for words like "name", "first",
    "last", "age", "20", "med" (Med Ball Throw), "shuttle", "pitch"
    (Pitching Velocity), "exit" (Exit Velocity), "date"). It shows a preview
    and a "Confirm Import" step before writing anything, and matches existing
    athletes by name + age group so re-uploading the same file won't create
    duplicates — it'll just add any new results found.
  - If your workbook has **multiple sheets**, all of them are read and merged
    into one set of athletes automatically (duplicate rows for the same kid
    across sheets are combined, not double-added).
  - **Separate First/Last Name columns** are supported and combined into one
    name automatically — you don't need a single "Name" column.
  - **Med Ball Throw recorded as feet/inches** (e.g. `12' 6"`, `14' 21/2"`)
    is automatically converted to decimal feet for ranking and display
    (e.g. `12.5'`).
  - Any row missing an age group gets filed under **"Unassigned"** rather
    than being dropped, so nobody falls through the cracks — just edit that
    athlete's age group later if needed.
  - Athletes with no test results yet (registered but not yet combine-tested)
    still get added to the roster with an empty results row, ready for a
    coach to fill in later.

## Local testing before you deploy

Any static file server works, e.g. from this folder:

```bash
npx serve .
```

Then open the printed `localhost` URL. (Opening `index.html` directly via
`file://` won't work — the module imports need an actual server.)
