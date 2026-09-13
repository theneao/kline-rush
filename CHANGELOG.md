# Changelog

## 1.1.0 — 2026-09-13

- Reworked responsive arena HUD: account equity, position equity and floating PnL remain visible on phones. Allocation controls occupy their own layout row.
- Tactile piano-style trade keys, short accepted-order feedback, bounded floating text and candle particles. Market/pattern events never animate trading buttons.
- Account and position value highlights for market impacts and realized trade outcomes; low-motion preference with persistent, readable feedback.
- Modal background isolation, focus containment, keyboard/assistive click support, primary-pointer filtering and allocation arrow keys.
- MAX orders reserve execution fees instead of consuming all available margin before fees.
- Seven Node regression tests cover accounting, netting, feedback isolation, input deduplication, reduced motion, modal gating and 500-candle settlement.

Validation: `node --check dist/app.js` and `node --test tests/arena.test.cjs`. Browser/device and gamepad testing have not been performed. Pattern detection remains heuristic; intrabar OHLC paths are interpolated, not real tick data.

Release note: version number 1.1.0 does not itself create a GitHub tag. Remote tag publication requires a tag-capable GitHub connection or an authorized Git push.
