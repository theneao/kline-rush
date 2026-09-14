# Changelog

## 1.2.0 — 2026-09-14

- Baseline preserved as v1.1.0 on a1c57283d67af8b2397e722b11978d43f454461a through GitHub Actions.
- Split trading ledger, fine-history replay, data adapters and pattern lifecycle into independent modules.
- Removed click bonuses. Timely confirmed-signal executions are rewarded only on profitable full-cycle settlement, including fees and signal-linked lot profit.
- Flat-to-flat cycles determine win streaks; partial exits cannot farm streaks.
- Bundled 4,000 real Binance minute bars for each of BTC/ETH. Five-minute candles grow from completed minute observations; removed future-close-driven interpolation. Other markets request real five-minute data and fail explicitly if unavailable.
- Added candidate/confirmed/invalid chart patterns, later-bar breakout confirmation and failed-breakout invalidation. Geometry tolerances scale with observed volatility.
- Points now settle directly in proportion to final equity. Formal rematches use a new random interval; same-interval practice is free and non-scoring.
- Expanded results with complete-cycle count, best streak, fees, per-cycle review, per-fill jump and a read-only historical chart timeline.
- Independent frame rendering, stable command ordering and hidden-tab pause.

Validation: pure-ledger, replay, DOM-adapter and bundled-data regressions in GitHub Actions. Physical-device and browser visual QA are not included. See docs/architecture.md for sampled-history and simplified-market limits.


## 1.1.0 — 2026-09-13

- Reworked responsive arena HUD: account equity, position equity and floating PnL remain visible on phones. Allocation controls occupy their own layout row.
- Tactile piano-style trade keys, short accepted-order feedback, bounded floating text and candle particles. Market/pattern events never animate trading buttons.
- Account and position value highlights for market impacts and realized trade outcomes; low-motion preference with persistent, readable feedback.
- Modal background isolation, focus containment, keyboard/assistive click support, primary-pointer filtering and allocation arrow keys.
- MAX orders reserve execution fees instead of consuming all available margin before fees.
- Seven Node regression tests cover accounting, netting, feedback isolation, input deduplication, reduced motion, modal gating and 500-candle settlement.

Validation: `node --check dist/app.js` and `node --test tests/arena.test.cjs`. Browser/device and gamepad testing have not been performed. Pattern detection remains heuristic; intrabar OHLC paths are interpolated, not real tick data.

Release note: version number 1.1.0 does not itself create a GitHub tag. Remote tag publication requires a tag-capable GitHub connection or an authorized Git push.
