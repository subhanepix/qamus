# Qamus sync Worker

A Cloudflare Worker that stores one JSON document per username in KV (`user:<username>`). Every `PUT` is merged with what's stored, using the same `merge.js` the site loads.

| Method | Path | |
|---|---|---|
| `HEAD` | `/u/:username` | `200` exists / `404` new |
| `GET` | `/u/:username` | the document, or `404` |
| `PUT` | `/u/:username` | body = full client document; returns the merged document; creates the user if missing |

Errors are JSON `{ "error": "..." }`. The status codes are:
- `400`: bad username or bad JSON
- `413`: the body is over 1 MB
- `422`: the body fails schema validation or exceeds a limit (5,000 cards, 500 folders)
- `429`: more than 60 writes per minute for that username; check `Retry-After`. The limit uses the Workers rate-limiting binding (`WRITES` in `wrangler.toml`), not KV, so each sync costs one KV write.

## One-time setup
```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create QAMUS     # paste the printed id into wrangler.toml
```
In `wrangler.toml`, set `ALLOWED_ORIGIN` to the GitHub Pages origin (e.g. `https://yourname.github.io`, no path). Requests from `http://localhost:*` and `http://127.0.0.1:*` are always allowed for dev.

```bash
npx wrangler deploy
```
Put the deployed URL (e.g. `https://qamus-sync.<account>.workers.dev`) in `SYNC_URL` in `app.js`.

## Local dev
```bash
npm run dev        # http://localhost:8787, simulated KV stored in worker/.wrangler/
```
```bash
curl -I http://localhost:8787/u/test-abcd                 # 404 (new)
curl -X PUT -H 'Content-Type: application/json' \
  --data '{"v":1,"updatedAt":0,"history":[],"folders":[],"cards":[],"reviews":{},"settings":{"updatedAt":0}}' \
  http://localhost:8787/u/test-abcd                       # 200 + merged doc
curl http://localhost:8787/u/test-abcd                    # the doc
```

## Tests
From the repo root: `node --test 'tests/*.test.js'`. These are unit tests for `merge.js`, plus the Worker run against an in-memory KV.

## Merge rules (`merge.js`)
- **Folders, cards:** union by `id`, and the larger `updatedAt` wins. On a tie, a tombstone wins. Deletes are tombstones (`deleted: true`) and are dropped after 30 days.
- **Reviews:** per card, the larger `updatedAt` wins. A review is dropped once its card is gone.
- **History:** each query keeps only its newest entry.
  - Deleting one entry writes a tombstone `{q, t, deleted: true}`. The tombstone hides that query until it is searched again.
  - **Clear history** sets `settings.historyClearedAt`, which merges by max. Every entry at or before that time is dropped.
  - The list is sorted newest first, with at most 500 live entries.
- **Settings:** the newer `updatedAt` wins as a whole object. `historyClearedAt` is the max of both sides.

## Caveats
- **KV is eventually consistent.** A write can take about 60s to show up at other edge locations, and each key accepts at most 1 write per second. If two devices push through different locations at almost the same moment, one push can overwrite the other in KV. The client recovers on its next sync: it merges the pulled doc into its local copy and pushes again when the two differ.
- A device that stays offline for more than 30 days can bring back items deleted elsewhere, because their tombstones have been pruned by then.
- `updatedAt` comes from each device's clock. A device whose clock is badly wrong can win conflicts it shouldn't.
- There is no password. The username is the secret, so pick something unguessable.
