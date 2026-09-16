# EZ Expense — handover to the native iOS app

Read this first. It carries everything from the web app that is still true for a
native rewrite: the data contract, the rules the backend enforces, the parsing
behaviour, and the traps that cost real debugging time. The web app in this repo
is the working reference implementation — read it, don't guess at it.

## What this is replacing

A vanilla HTML/CSS/JS web app, live at
<https://natthaphat-math.github.io/expense-income-tracking/>, replacing a yearly
Excel planner. It is in daily use, synced to Firestore, and holds **984 imported
transactions**. It keeps working while the iOS app is built, and stays the
fallback if the rewrite stalls.

**This is a rewrite, not a port.** No JavaScript survives. What survives is the
data model, the Firestore schema, the parser's behaviour, and the decisions
below.

## Non-negotiable: the data contract

Firestore Security Rules validate every write field by field. **A document that
does not match exactly is rejected** — not silently mangled, rejected. Get this
right before writing any sync code.

```
users/{uid}/transactions/{id}
users/{uid}/meta/settings
```

```swift
struct Transaction {
    let id: String          // <= 64 chars, and MUST equal the document id
    var kind: Kind          // "income" | "expense"
    var name: String        // 1...200 chars, required
    var amount: Double?     // nil allowed; else 0 ..< 100_000_000
    var type: String?       // nil allowed; else <= 100 chars
    var group: Group        // IN | DE | SD | IV | SV
    var date: String        // "yyyy-MM-dd" EXACTLY, local date, stored as a string
    var createdAt: Int      // ms epoch, must serialise as an INTEGER not a Double
    var updatedAt: Int      // ms epoch, integer
    var deleted: Bool       // soft delete; never hard-delete a synced row
}
```

Rules reject unknown fields (`hasOnly`), so do not add `syncedAt`, `_id` or
anything else to the document. Keep extra state in a local table.

`createdAt`/`updatedAt` must be integers. Swift `Double` will serialise as a
double and fail `is int`. Use `Int` and let the Firestore SDK encode it.

Groups, with the Thai labels the UI uses:

| code | label | kind |
|---|---|---|
| IN | รายได้ | income |
| DE | รายจ่ายประจำวัน | expense |
| SD | ค่ารายเดือน / ค่าหนี้ | expense |
| IV | การลงทุน | expense |
| SV | การออมเงิน | expense |

`kind` is derived from `group`: `IN` → income, everything else → expense. Never
let them disagree; the web app normalises this on every read and write.

**Savings are counted inside total expense.** `expense = DE + SD + IV + SV`.
This matches the original spreadsheet and is deliberate. Every total that
includes savings shows a `*รวมการออมเงิน` footnote. Keep both the behaviour and
the footnote.

Settings document: `categories`, `budgets: { defaults, months }`,
`openingBalances`, `carryOverBalance`, `lastBackupAt`, `updatedAt`. Same
`hasOnly` treatment. `budgets.months` and `openingBalances` are keyed `"yyyy-MM"`.

## Firebase — already set up, do not redo

Project `expense-income-tracking` is live and configured: email-link sign-in,
Firestore in `asia-southeast1`, rules published and tested, API key restricted.
See `docs/firebase-setup.md`.

What you DO need: register an **iOS app** in the Firebase console to get
`GoogleService-Info.plist`. The web config will not work. Pick a bundle id and
keep it.

The uid is per-project and per-user, so **signing in with the same email gives
the same uid** — the iOS app will see the existing 984 transactions immediately.
Nothing to migrate.

`docs/firestore.rules` is the source of truth and is already deployed. There is
an automated suite (`npm run test:rules`, 18 cases) — if you change the rules for
the iOS app, run it.

## The parser — port the behaviour, not the code

`js/parser.js` turns free text into a transaction, and `test/parser.test.mjs` is
its specification. **Port the tests first**, then make them pass in Swift. All
of these must produce name=ก๋วยเตี๋ยว, amount=20, type=ค่าอาหาร:

```
ก๋วยเตี๋ยว 20 บาท ประเภทอาหาร
ก๋วยเตี๋ยว 20 บาท อาหาร
ก๋วยเตี๋ยว 20 อาหาร
```

Rules, in order:

1. Normalise: trim, collapse whitespace, Thai digits ๐–๙ → 0–9, strip thousands
   separators inside numbers.
2. Amount: the **first** number match `\d+(\.\d+)?`, even with no space —
   `ก๋วยเตี๋ยว20บาท` is what dictation actually produces. Strip a trailing
   `บาท` / `บ.`.
3. Type: text after the amount (optionally prefixed `ประเภท` / `หมวด`) matched
   against categories — exact, then `ค่า` + word (`อาหาร` → `ค่าอาหาร`), then
   alias, then substring. **An unmatched trailing word must not be appended to
   the name**; surface it as an "add this category?" suggestion.
4. Name: whatever came before the amount. No amount → the whole line is the
   name, but still try to match a trailing category word.
5. If no type was given, suggest the type most recently used with the same name.

Multi-line input switches to a batch preview: one editable row per line, saved
together. The manual fields above act as **defaults for rows that lack a value**,
not as the first row's values.

## Traps that cost real time

**Thai calendar.** `Locale(identifier: "th_TH")` defaults to the **Buddhist**
calendar — 2026 renders as 2569. The app shows ค.ศ. everywhere. Set
`calendar = Calendar(identifier: .gregorian)` on the formatter and the locale,
or use `th_TH@calendar=gregorian`. This bit the web app via `Intl` and will bite
Swift identically.

**Local dates, never UTC.** `date` is a local `yyyy-MM-dd` string. Thailand is
UTC+7, so any UTC-based "today" returns *yesterday* before 07:00. This is not
theoretical — it was confirmed against a real midnight boundary during testing.
Use a `DateFormatter` with `yyyy-MM-dd`, `Locale(identifier: "en_US_POSIX")`,
and the **current** time zone. Never `ISO8601`, never UTC.

**Money formatting.** `toLocaleString('th-TH')` with 0–2 fraction digits, then
` บาท`. In Swift: `NumberFormatter`, `minimumFractionDigits = 0`,
`maximumFractionDigits = 2`, `locale = th_TH`.

**Empty string is not nil.** The "ไม่ระบุประเภท" filter is the empty string. In
JS that is falsy and it silently disabled the whole filter — combined with batch
edit, selecting all under that filter would have retyped every transaction in
the month. Swift's optionals make this harder to hit, but keep "no category"
distinct from "no filter" as separate cases, not a magic empty string.

**Untyped data is the norm, not the exception.** Of the imported 984 rows,
**most have no category** — the spreadsheet's own totals silently missed about
68,900 บาท because its SUMIFs skipped untyped rows. Every screen must handle
`type == nil` gracefully, and assigning categories in bulk is a primary workflow,
not an edge case.

## Design: what to keep, what to drop

Keep: the calm, friendly tone. Large tap targets. Thai throughout. Colour never
carries meaning alone — income/expense always also show a +/− sign or a label.

**Drop the circle page-button menu.** That was a workaround for standalone web
apps having no back button. Native iOS has a **tab bar** — use `TabView` with วัน,
เดือน, ปี, ตั้งค่า. This is the one piece of recent UI work that should *not* be
ported; it exists only to solve a problem SwiftUI does not have.

Drop the hand-drawn SVG charts too — they exist because the web app could not
take a CDN dependency offline. Use **Swift Charts**.

Screens, as they currently work:

- **วัน** — selected day (defaults to today), day totals, a Monday-start week
  bar chart of รายรับ vs รายจ่าย (tap a bar to switch day), then that day's rows.
- **เดือน** — donut by category with รายจ่าย/รายรับ/การออม toggle; totals with
  ยอดเริ่มต้น (editable, or carried from the previous month); rows grouped by day
  with daily subtotals; multi-select to batch-assign a category; days with no
  entries shown so a missed day is visible, with runs of 3+ collapsed; budget vs
  actual per group and per category; daily running-balance line.
- **ปี** — year totals, 12-month grouped bar chart, progress against targets.
- **ตั้งค่า** — categories (rename updates past rows), budgets, JSON
  export/import, sync status, backup reminder after 14 days.

Native wins worth taking: Face ID lock, a Shortcuts/Siri action for logging,
a home-screen widget for today's total, proper Keychain, and storage iOS will
not evict — the current PWA's localStorage *can* be reclaimed under pressure,
which is a real durability argument for the rewrite.

## Keep JSON export/import

It is the only backup that survives losing the Firebase project, and the only
path back to the web app. Format is in `js/backup.js`; treat imported files as
untrusted and validate every field and range (`test/backup.test.mjs`, 16 cases,
covers hostile input including prototype pollution). Sync is **not** backup — it
replicates mistakes faithfully.

## Practical

- Xcode 15+, SwiftUI, target iOS 17+ (Swift Charts needs 16+).
- Firebase iOS SDK via Swift Package Manager: FirebaseAuth + FirebaseFirestore.
- Offline-first, same as the web app: write locally first, sync in the
  background, never block the UI on the network. SwiftData or GRDB locally.
- Conflict resolution is last-write-wins on `updatedAt`, matching the web app,
  so the two can coexist on the same data.
- **Distribution needs an Apple Developer Program membership ($99/year).**
  Without it a self-signed build expires after 7 days on device. Worth knowing
  before starting, not after.

## Definition of done for the first milestone

Sign in with the existing email, see all 984 transactions, add one on the phone,
and watch it appear in the web app. That proves the contract end to end.
