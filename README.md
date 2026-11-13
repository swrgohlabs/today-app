# Today

A one-page phone dashboard (installable PWA) that shows what matters today from a `NOW.md` file in a private GitHub repo.

- Reads `NOW.md` through the GitHub API with a read-only, fine-grained token stored on the phone only. This repo holds app code only, no data.
- Works out overdue / today / coming up on the phone, so nothing needs rebuilding each day.
- Preview with sample data: open the page with `#demo`.

See `now-parser.js` for the `NOW.md` line formats it understands.
