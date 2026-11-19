# Qamus sync Worker

A Cloudflare Worker that stores one JSON document per username in D1 (table `docs`, see `migrations/`). Every `PUT` is merged with what's stored, using the same `merge.js` the site loads. Accounts from before the move to D1 are still in KV (`user:<username>`): they're read from there until their next `PUT` writes them to D1.

| Method | Path | |
|---|---|---|
| `HEAD` | `/u/:username` | `200` exists / `404` new |
| `GET` | `/u/:username` | the document, or `404` |
| `PUT` | `/u/:username` | body = full client document; returns the merged document; creates the user if missing |

Errors are JSON `{ "error": "..." }`. The status codes are:
- `400`: bad username or bad JSON
- `413`: the body is over 1 MB
- `422`: the body fails schema validation or exceeds a limit (5,000 cards, 500 folders)
- `429`: more than 60 writes per minute for that username; check `Retry-After`. The limit uses the Workers rate-limiting binding (`WRITES` in `wrangler.toml`), not storage, so each sync costs one D1 write.

## One-time setup
```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create qamus                       # paste the printed database_id into wrangler.toml
npx wrangler d1 migrations apply qamus --remote    # creates the docs table
```
In `wrangler.toml`, set `ALLOWED_ORIGIN` to the site's origin(s), comma-separated (e.g. `https://alqamus.pages.dev,https://yourname.github.io`, no paths). Requests from `http://localhost:*` and `http://127.0.0.1:*` are always allowed for dev. The KV namespace (`QAMUS`) is only read, for accounts saved before the move to D1.

```bash
npx wrangler deploy
```
Put the deployed URL (e.g. `https://qamus-sync.<account>.workers.dev`) in `SYNC_URL` in `app.js`.

## Local dev
```bash
npm run dev        # http://localhost:8787; applies the schema to a local D1 in worker/.wrangler/ first
```
```bash
curl -I http://localhost:8787/u/test-abcd                 # 404 (new)
curl -X PUT -H 'Content-Type: application/json' \
  --data '{"v":1,"updatedAt":0,"history":[],"folders":[],"cards":[],"reviews":{},"settings":{"updatedAt":0}}' \
  http://localhost:8787/u/test-abcd                       # 200 + merged doc
curl http://localhost:8787/u/test-abcd                    # the doc
```

## Tests
From the repo root: `node --test 'tests/*.test.js'`. These are unit tests for `merge.js`, plus the Worker run against an in-memory KV and D1.

## Merge rules (`merge.js`)
- **Folders, cards:** union by `id`, and the larger `updatedAt` wins. On a tie, a tombstone wins. Deletes are tombstones (`deleted: true`) and are dropped after 30 days.
- **Reviews:** per card, the larger `updatedAt` wins. A review is dropped once its card is gone.
- **History:** each query keeps only its newest entry.
  - Deleting one entry writes a tombstone `{q, t, deleted: true}`. The tombstone hides that query until it is searched again.
  - **Clear history** sets `settings.historyClearedAt`, which merges by max. Every entry at or before that time is dropped.
  - The list is sorted newest first, with at most 500 live entries.
- **Settings:** the newer `updatedAt` wins as a whole object. `historyClearedAt` is the max of both sides.

## Caveats
- **Two devices pushing at the same moment** can each merge against the same stored copy, so one push can overwrite the other. The client recovers on its next sync: it merges the pulled doc into its local copy and pushes again when the two differ.
- A device that stays offline for more than 30 days can bring back items deleted elsewhere, because their tombstones have been pruned by then.
- `updatedAt` comes from each device's clock. A device whose clock is badly wrong can win conflicts it shouldn't.
- There is no password. The username is the secret, so pick something unguessable.
