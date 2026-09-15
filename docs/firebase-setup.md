# Firebase setup (phase 2)

Step-by-step for adding sync to this app. **Nothing here is built yet** — the
storage adapter boundary in `js/storage.js` is ready for it, but no Firebase
code ships today. Do these console steps first, then write the adapter.

Console labels below are the English ones you'll actually see.

> **Why this matters more than usual:** this repo is public. Your Firebase
> config — including `apiKey` and `projectId` — will be readable by anyone.
> That's normal and expected for Firebase web apps (the API key is an
> identifier, not a credential), but it means the Security Rules and the key
> restriction are the *only* things standing between strangers and your data.
> A public repo with test-mode rules is wide open within minutes of being
> indexed.

---

## 1. Create the project

1. <https://console.firebase.google.com> → **Add project**
2. Name it (e.g. `expense-income-tracking`)
3. **Disable Google Analytics** — you don't need it, and it avoids a second
   consent surface collecting data about the one person using this app.

## 2. Add a Web app and copy the config

1. Project Overview → the **`</>`** (Web) icon
2. Nickname it, and **do not** tick "Also set up Firebase Hosting" if you're
   staying on GitHub Pages
3. Copy the `firebaseConfig` object it shows you

That object goes in the client code and will be public. Fine — as long as you
finish steps 4–6.

## 3. Turn on passwordless email sign-in

1. **Authentication** → Get started
2. **Sign-in method** tab → **Email/Password** → Enable
3. In that same panel, also enable **Email link (passwordless sign-in)** → Save

Email link sign-in is the only method this app needs. No password to forget,
no password to leak.

## 4. Lock the sign-in domains

**Authentication → Settings → Authorized domains**

Remove anything you aren't using, and keep only:

- `natthaphat-math.github.io`
- `localhost` (keep for development; remove it if you want to be strict)

Firebase pre-authorizes `<project>.firebaseapp.com` and `<project>.web.app`.
If you're not hosting there, delete them — each one is a live page that can
complete a sign-in to your project.

## 5. Create Firestore and publish the rules

1. **Firestore Database** → Create database
2. Location: **asia-southeast1 (Singapore)** — closest to Thailand, lowest latency
3. When it asks for a starting mode, pick **Start in production mode**
   (locked). **Never pick test mode**, not even "just for today" — test mode
   grants the world read and write for 30 days.
4. Go to the **Rules** tab, paste the contents of
   [`docs/firestore.rules`](./firestore.rules), replace `OWNER_EMAIL_HERE`
   with the real email, and **Publish**.

Then verify them before trusting them: the **Rules Playground** (in the Rules
tab) lets you simulate a request. Check that:

- an unauthenticated `get` on `/users/abc/transactions/x1` is **denied**
- a `get` authenticated as a *different* email is **denied**
- a `create` with `amount: -5` or `group: "XX"` is **denied**
- a `create` with a valid document as the owner is **allowed**

If any of the first three is allowed, stop and fix the rules before writing a
single line of client code.

## 6. Restrict the API key

This is the step people skip, and it's the one that limits the blast radius of
a key that's sitting in a public repo.

1. <https://console.cloud.google.com/apis/credentials> — pick the same project
2. Click the auto-created **Browser key (auto created by Firebase)**
3. **Application restrictions** → **Websites** → Add:
   - `https://natthaphat-math.github.io/*`
4. **API restrictions** → **Restrict key** → allow only:
   - Identity Toolkit API
   - Token Service API
   - Cloud Firestore API
5. Save. It can take up to 5 minutes to take effect.

A referrer restriction is not a security boundary on its own — it's trivially
spoofed outside a browser. It stops casual reuse of your key on someone else's
site; the *rules* are what actually protect the data. Do both.

## 7. Cost guard

The free Spark plan can't run up a bill. If you ever upgrade to Blaze
(pay-as-you-go), set a budget alert immediately:

**Google Cloud Console → Billing → Budgets & alerts** → budget of a few
dollars, alerts at 50/90/100%.

For one person's expense tracker you will not come close to the free tier —
tens of writes a day against a 20,000/day limit.

---

## What to build after the console is set up

Add `js/firestore-adapter.js` implementing the same six methods as
`LocalStorageAdapter`:

```js
getAll()  put(tx)  putMany(txs)  delete(id)  getSettings()  saveSettings(s)
```

Paths: `users/{uid}/transactions/{id}` and `users/{uid}/meta/settings`.

Then swap one line in `js/main.js`:

```js
const store = new Store(new LocalStorageAdapter());   // today
const store = new Store(new FirestoreAdapter(user));  // phase 2
```

No screen code changes. Every record already carries `id`, `updatedAt` and
`deleted`, so last-write-wins merging works the same way the JSON import
already does — see `mergeTransactions()` in `js/backup.js`.

Two things worth deciding before you start:

- **Offline.** Firestore's local cache covers short outages, but the app is
  meant to work fully offline. Keep `LocalStorageAdapter` as the primary store
  and sync to Firestore in the background, rather than replacing it outright.
- **Don't drop the JSON export.** It's the only backup that survives losing
  access to the Firebase project.
