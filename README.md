# BAGMAN

Pac-Man-style parody game: Elon eats Doge while Zuckerberg, Gates, Altman and Bezos chase him.
A static page in `public/`, plus a small Cloudflare Worker (`src/worker.js`) with a D1 database for the leaderboard.

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:8642. The local leaderboard lives in `.wrangler/` and is separate from the live one.

## First deploy

1. Log in to Cloudflare (opens a browser window to approve):
   ```bash
   npx wrangler login
   ```
2. Create the database, then paste the `database_id` it prints into `wrangler.jsonc`:
   ```bash
   npx wrangler d1 create bagman
   ```
3. Create the tables on the live database:
   ```bash
   npm run db:remote
   ```
4. Deploy. This prints the live `*.workers.dev` link:
   ```bash
   npm run deploy
   ```
5. Set the two secrets (each command asks for a value, so use long random strings):
   ```bash
   npx wrangler secret put SALT
   npx wrangler secret put ADMIN_KEY
   ```

After that, `npm run deploy` publishes any change.

## Remove a cheater from the leaderboard

```bash
curl -X POST https://YOUR-LINK/api/admin/delete -H "X-Admin-Key: YOUR_ADMIN_KEY" -H "Content-Type: application/json" -d '{"name":"CHEATER"}'
```

## Anti-cheat (basic)

The worker rejects scores that are impossible for the level and play time, allows at most 30 submissions per hour per IP and filters offensive names. A determined cheater can still fake a score from the browser, so check the top of the board now and then.

## Credits

Photo credits and licenses: `public/faces/CREDITS.md` (also shown in the game).
