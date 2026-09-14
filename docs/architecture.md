# Trading core 1.2
Baseline: GitHub tag v1.1.0, commit a1c57283d67af8b2397e722b11978d43f454461a.

## Boundaries
- core/ledger.js: deterministic, DOM-free financial ledger. Cash rounds to cents; entry quantity is truncated to eight decimal places. It owns fees, one net position, complete cycles and signal-profit rewards.
- core/replay.js: validates and groups smaller real OHLC bars; reveals them only when their interval completes. No future-close-driven synthetic path. Seeded segment selection and recorded commands support replay.
- core/patterns.js: heuristic candidate geometry, later confirmation, structural/failed-breakout/expiry invalidation. All detectors read completed large bars only.
- core/data.js: history adapters and full preparation before entry debit. Binance bundled minute data, Yahoo/Eastmoney five-minute fetches. Incomplete groups are excluded; insufficient data blocks paid entry.
- app.js: lifecycle, input mapping and event-to-presentation adapter. Only ledger events trigger accepted-order feedback. requestAnimationFrame renders separately from the 160ms replay step; backgrounding pauses the local match.
- review.js: read-only snapshots and fills. No ledger write access.

## Rules
- No click-count bonus.
- Flat to flat is one cycle. Net result includes every entry/add/reduce/exit fee; partial exits cannot increment streak.
- A confirmed signal must be acted on within 15 observation steps (2.4 seconds nominal playback), with at least $100 margin. Signals can be claimed only once. On full profitable exit, the signal-linked lots must also be net profitable and the signal must remain valid.
- Reward is capped at 20% of attributable profit-score and 600 times the capped streak; it never changes money.
- Points returned = round(entry points * max(0, final equity) / initial equity). Free practice pays zero points. Formal rematch draws a new segment; same-segment repeat is free practice.
- A new lower-bar close is the executable price. High/low become known only when that lower bar has completed. This is sampled historical replay, not tick replay or exchange liquidation simulation. Risk thresholds are checked at observed prices and opening gaps; no assumed ordering inside a minute.
- Legacy daily/4h history files are retained for the baseline, but are no longer loaded by the game.

## Limits and next steps
All markets still share the game's simplified margin model; venue-specific lot sizes, funding, maintenance margin and short-sale rules are not implemented. Pattern recognition remains heuristic, with no accuracy guarantee. Client history and local points are unsuitable as trusted competitive results. Production leaderboards require server-owned schedules, validation and settlement. Third-party minute endpoints may be unavailable by region/CORS/retention; no daily fallback is used.

No heavyweight engine or ECS is introduced. Real-device timing, renderer profiling and native platform packaging remain separate validation work.
