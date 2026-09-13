(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('chart');
  const ctx = canvas.getContext('2d');
  const chartWrap = $('chartWrap');
  const LONG = '#00f5d4';
  const SHORT = '#ff2d78';
  const AMBER = '#ffe44d';
  const CONFIG = { startingBalance: 10000, targetBalance: 100000, leverage: 3, feeRate: .0005, minMargin: 10, candleTicks: 6, visibleCandles: 52, warmup: 60, matchCandles: 500, entryFee: 200 };
  const INSTRUMENTS = [
    { market: 'us', symbol: 'AAPL', name: 'Apple', meta: '美股 · 日线', provider: 'yahoo', stooq: 'aapl.us' },
    { market: 'us', symbol: 'NVDA', name: 'NVIDIA', meta: '美股 · 日线', provider: 'yahoo', stooq: 'nvda.us' },
    { market: 'cn', symbol: '600519', name: '贵州茅台', meta: '上交所 · 日线', provider: 'eastmoney', secid: '1.600519' },
    { market: 'cn', symbol: '000001', name: '平安银行', meta: '深交所 · 日线', provider: 'eastmoney', secid: '0.000001' },
    { market: 'crypto', symbol: 'BTCUSDT', name: 'Bitcoin', meta: '币安 · 4小时', provider: 'binance' },
    { market: 'crypto', symbol: 'ETHUSDT', name: 'Ethereum', meta: '币安 · 4小时', provider: 'binance' },
    { market: 'futures', symbol: 'GC=F', name: '黄金期货', meta: 'COMEX · 日线', provider: 'yahoo', stooq: 'gc.f' },
    { market: 'futures', symbol: 'CL=F', name: '原油期货', meta: 'NYMEX · 日线', provider: 'yahoo', stooq: 'cl.f' }
  ];
  let storedPoints = Number.NaN;
  try { const saved = localStorage.getItem('kline-rush-points'); if (saved !== null) storedPoints = Number(saved); } catch (_) {}
  const state = {
    selectedMarket: 'us', selected: INSTRUMENTS[0], careerPoints: Number.isFinite(storedPoints) ? storedPoints : 5000,
    matchActive: false, gameOver: false, replay: [], replayIndex: 0, tickInCandle: 0, candles: [], current: null, target: null, candleId: 0,
    price: 0, sessionOpen: 1, trades: [], particles: [], annotations: [], seenPatterns: new Map(), position: null,
    walletBalance: CONFIG.startingBalance, realizedPnl: 0, allocation: 10, bonusScore: 0, score: 0, renderedScore: 0,
    combo: 1, streak: 0, patternsMatched: 0, lastActions: [], marketEvent: null, sound: true, sourceLabel: ''
  };
  let audioContext;
  let toastTimer;
  const money = value => `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const signedMoney = value => `${value >= 0 ? '+' : '-'}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const sideSign = side => side === 'long' ? 1 : -1;
  const fmtDate = value => value ? new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—';
  const savePoints = () => { try { localStorage.setItem('kline-rush-points', String(state.careerPoints)); } catch (_) {} updatePoints(); };
  function updatePoints() { $('careerPoints').textContent = state.careerPoints.toLocaleString('en-US'); $('lobbyPoints').textContent = state.careerPoints.toLocaleString('en-US'); }

  function fetchWithTimeout(url, type = 'json') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14000);
    return fetch(url, { signal: controller.signal, cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error(`数据服务返回 ${response.status}`);
      return type === 'text' ? response.text() : response.json();
    }).finally(() => clearTimeout(timer));
  }
  function cleanBars(bars) {
    const unique = new Map();
    bars.forEach(bar => {
      const values = [bar.open, bar.high, bar.low, bar.close].map(Number);
      if (bar.time && values.every(Number.isFinite) && Math.min(...values) > 0) unique.set(String(bar.time), { time: bar.time, open: values[0], high: Math.max(values[0], values[1], values[2], values[3]), low: Math.min(values[0], values[1], values[2], values[3]), close: values[3], volume: Number(bar.volume) || 0 });
    });
    return [...unique.values()].sort((a, b) => new Date(a.time) - new Date(b.time));
  }
  async function fetchYahoo(instrument) {
    const symbol = encodeURIComponent(instrument.symbol);
    let data;
    try { data = await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=10y&interval=1d&events=history`); }
    catch (_) { data = await fetchWithTimeout(`https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=10y&interval=1d&events=history`); }
    const result = data?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    if (!result?.timestamp || !quote) throw new Error('历史行情格式无效');
    return cleanBars(result.timestamp.map((time, i) => ({ time: new Date(time * 1000).toISOString(), open: quote.open[i], high: quote.high[i], low: quote.low[i], close: quote.close[i], volume: quote.volume[i] })));
  }
  async function fetchStooq(instrument) {
    const csv = await fetchWithTimeout(`https://stooq.com/q/d/l/?s=${encodeURIComponent(instrument.stooq)}&i=d`, 'text');
    const rows = csv.trim().split(/\r?\n/).slice(1);
    return cleanBars(rows.map(row => { const [time, open, high, low, close, volume] = row.split(','); return { time, open, high, low, close, volume }; }));
  }
  function fetchJsonp(url) {
    return new Promise((resolve, reject) => {
      const callback = `klineRush_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
      const script = document.createElement('script');
      const timer = setTimeout(() => finish(new Error('A股历史数据加载超时')), 14000);
      function finish(error, data) {
        clearTimeout(timer); delete window[callback]; script.remove(); error ? reject(error) : resolve(data);
      }
      window[callback] = data => finish(null, data);
      script.onerror = () => finish(new Error('A股历史数据服务不可用'));
      script.src = `${url}${url.includes('?') ? '&' : '?'}cb=${callback}`;
      document.head.appendChild(script);
    });
  }
  async function fetchEastmoney(instrument) {
    const fields = 'f51,f52,f53,f54,f55,f56';
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${instrument.secid}&klt=101&fqt=1&lmt=1400&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=${fields}`;
    const data = await fetchJsonp(url);
    const rows = data?.data?.klines;
    if (!Array.isArray(rows)) throw new Error('A股历史行情格式无效');
    return cleanBars(rows.map(row => { const [time, open, close, high, low, volume] = row.split(','); return { time, open, high, low, close, volume }; }));
  }
  async function fetchBinance(instrument) {
    const bundled = window.KLINE_RUSH_BINANCE_HISTORY?.symbols?.[instrument.symbol];
    if (Array.isArray(bundled) && bundled.length >= CONFIG.warmup + CONFIG.matchCandles) {
      state.sourceLabel = 'Binance 连接器历史 K 线（内置）';
      return cleanBars(bundled.map(row => ({ time: new Date(row[0]).toISOString(), open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] })));
    }
    const path = `/api/v3/klines?symbol=${instrument.symbol}&interval=4h&limit=1000`;
    let data;
    try { data = await fetchWithTimeout(`https://api.binance.com${path}`); }
    catch (_) { data = await fetchWithTimeout(`https://data-api.binance.vision${path}`); }
    if (!Array.isArray(data)) throw new Error('虚拟货币历史行情格式无效');
    state.sourceLabel = 'Binance 公开历史 K 线（实时）';
    return cleanBars(data.map(row => ({ time: new Date(row[0]).toISOString(), open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] })));
  }
  async function loadHistory(instrument) {
    let bars;
    if (instrument.provider === 'binance') bars = await fetchBinance(instrument);
    else if (instrument.provider === 'eastmoney') bars = await fetchEastmoney(instrument);
    else {
      try { bars = await fetchYahoo(instrument); state.sourceLabel = 'Yahoo Finance 历史数据'; }
      catch (firstError) {
        try { bars = await fetchStooq(instrument); state.sourceLabel = 'Stooq 历史数据'; }
        catch (_) { throw firstError; }
      }
    }
    if (instrument.provider === 'eastmoney') state.sourceLabel = '东方财富历史行情';
    if (bars.length < CONFIG.warmup + CONFIG.matchCandles) throw new Error(`历史数据仅有 ${bars.length} 根，少于需要的 ${CONFIG.warmup + CONFIG.matchCandles} 根`);
    return bars;
  }

  function renderInstruments() {
    const items = INSTRUMENTS.filter(item => item.market === state.selectedMarket);
    if (!items.includes(state.selected)) state.selected = items[0];
    $('instrumentGrid').innerHTML = items.map(item => `<button class="instrument-card${item === state.selected ? ' active' : ''}" data-symbol="${item.symbol}"><span><strong>${item.name}</strong><small>${item.symbol} · ${item.meta}</small></span><em>500 BAR</em></button>`).join('');
  }
  function initLobby() {
    updatePoints(); renderInstruments();
    $('marketTabs').addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      state.selectedMarket = button.dataset.market;
      [...$('marketTabs').children].forEach(tab => tab.classList.toggle('active', tab === button));
      state.selected = INSTRUMENTS.find(item => item.market === state.selectedMarket);
      renderInstruments(); $('loadStatus').textContent = '';
    });
    $('instrumentGrid').addEventListener('click', event => {
      const button = event.target.closest('.instrument-card'); if (!button) return;
      state.selected = INSTRUMENTS.find(item => item.symbol === button.dataset.symbol);
      renderInstruments(); $('loadStatus').textContent = '';
    });
  }
  async function startMatch() {
    if (state.careerPoints < CONFIG.entryFee) { $('loadStatus').textContent = '积分不足，无法支付本局入场费'; return; }
    const button = $('startMatch');
    button.disabled = true; button.textContent = '正在抽取真实历史区间…'; $('loadStatus').textContent = `加载 ${state.selected.name} 历史 K 线`;
    try {
      const history = await loadHistory(state.selected);
      const length = CONFIG.warmup + CONFIG.matchCandles;
      const start = Math.floor(Math.random() * (history.length - length + 1));
      state.careerPoints -= CONFIG.entryFee; savePoints();
      initializeReplay(history.slice(start, start + length));
      $('lobby').classList.remove('show');
      $('loadStatus').textContent = '';
    } catch (error) {
      $('loadStatus').textContent = `无法开始：${error?.message || '历史数据加载失败'}`;
    } finally {
      button.disabled = false; button.textContent = '扣除 200 PT · 开始比赛';
    }
  }

  function initializeReplay(segment) {
    Object.assign(state, { matchActive: true, gameOver: false, replay: segment.slice(CONFIG.warmup), replayIndex: 0, tickInCandle: 0,
      candles: segment.slice(0, CONFIG.warmup).map((bar, id) => ({ ...bar, id })), candleId: CONFIG.warmup,
      trades: [], particles: [], annotations: [], seenPatterns: new Map(), position: null, walletBalance: CONFIG.startingBalance,
      realizedPnl: 0, allocation: 10, bonusScore: 0, score: 0, renderedScore: 0, combo: 1, streak: 0, patternsMatched: 0, lastActions: [], marketEvent: null });
    state.sessionOpen = state.replay[0].open;
    $('score').textContent = '0'; $('gameOver').classList.remove('show'); $('gameOver').setAttribute('aria-hidden', 'true');
    $('symbolName').textContent = `${state.selected.symbol} / ${state.selected.name}`;
    $('marketSource').textContent = state.sourceLabel.toUpperCase();
    setAllocation(10); prepareCandle(); resize(); updateHud();
  }
  function prepareCandle() {
    state.target = state.replay[state.replayIndex];
    if (!state.target) { finishMatch('complete'); return; }
    state.current = { ...state.target, id: state.candleId, close: state.target.open, high: state.target.open, low: state.target.open };
    state.price = state.target.open; state.tickInCandle = 0;
    const recent = state.candles.slice(-20);
    const avgRange = recent.reduce((sum, bar) => sum + bar.high - bar.low, 0) / Math.max(1, recent.length);
    state.currentAvgRange = avgRange;
    updateHud(); draw();
  }
  function candlePath(target, progress) {
    const points = target.close >= target.open ? [target.open, target.low, target.high, target.close] : [target.open, target.high, target.low, target.close];
    const scaled = Math.min(.999999, progress) * 3;
    const index = Math.floor(scaled); const local = scaled - index;
    return points[index] + (points[index + 1] - points[index]) * local;
  }
  function advanceReplay() {
    if (!state.matchActive || state.gameOver || !state.current) return;
    state.tickInCandle += 1;
    const progress = state.tickInCandle / CONFIG.candleTicks;
    state.price = progress >= 1 ? state.target.close : candlePath(state.target, progress);
    state.current.close = state.price; state.current.high = Math.max(state.current.high, state.price); state.current.low = Math.min(state.current.low, state.price);
    if (!state.marketEvent && progress >= .5) {
      const liveRange = state.current.high - state.current.low;
      const liveBody = Math.abs(state.current.close - state.current.open);
      if (liveRange > state.currentAvgRange * 1.75 || liveBody > state.currentAvgRange * 1.35) beginMarketEvent(state.current.close >= state.current.open ? 1 : -1, liveBody > state.currentAvgRange * 1.8 ? '极端动能' : '真实大波动');
    }
    if (state.marketEvent) emitEventParticles(state.marketEvent.direction);
    state.particles.forEach(particle => { particle.age += 1; }); state.particles = state.particles.filter(particle => particle.age < particle.life);
    if (state.tickInCandle >= CONFIG.candleTicks) completeCandle();
    updateHud(); draw(); checkGameEnd();
  }

  function unrealizedPnl() { return state.position ? (state.price - state.position.avgPrice) * state.position.qty * sideSign(state.position.side) : 0; }
  function equity() { return state.walletBalance + unrealizedPnl(); }
  function availableMargin() { return Math.max(0, equity() - (state.position?.margin || 0)); }
  function totalScore() { return Math.round((equity() - CONFIG.startingBalance) * 10 + state.bonusScore); }
  function resize() {
    const rect = chartWrap.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
  }
  function visibleCandles() { return state.current ? [...state.candles.slice(-CONFIG.visibleCandles), state.current] : []; }
  function chartScale(items, height) {
    if (!items.length) return { y: () => height / 2 };
    const lows = items.map(bar => bar.low); const highs = items.map(bar => bar.high);
    if (state.position) { lows.push(state.position.avgPrice); highs.push(state.position.avgPrice); }
    const pad = Math.max(.001, (Math.max(...highs) - Math.min(...lows)) * .08);
    const min = Math.min(...lows) - pad; const max = Math.max(...highs) + pad;
    return { min, max, y: price => 12 + (max - price) / Math.max(.001, max - min) * (height - 24) };
  }
  function drawPositionZone(items, scale, startX, slot, currentX) {
    if (!state.position) return;
    const offset = Math.max(0, state.position.startCandleId - items[0].id); const zoneX = Math.max(0, startX + offset * slot);
    const entryY = scale.y(state.position.avgPrice); const priceY = scale.y(state.price); const top = Math.min(entryY, priceY); const height = Math.max(3, Math.abs(entryY - priceY));
    const pnl = unrealizedPnl(); const color = pnl >= 0 ? LONG : SHORT; const gradient = ctx.createLinearGradient(0, top, 0, top + height);
    gradient.addColorStop(0, `${color}38`); gradient.addColorStop(1, `${color}0a`); ctx.fillStyle = gradient; ctx.fillRect(zoneX, top, Math.max(8, currentX - zoneX + slot * .6), height);
    ctx.strokeStyle = `${color}88`; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(zoneX, entryY); ctx.lineTo(currentX + slot * .55, entryY); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '800 9px Inter,system-ui'; ctx.fillStyle = color; ctx.fillText(`AVG ${state.position.avgPrice.toFixed(2)}  ${signedMoney(pnl)}`, zoneX + 6, Math.max(11, entryY - 6));
  }
  function drawAnnotations(items, scale, startX, slot) {
    const firstId = items[0]?.id; if (firstId == null) return;
    state.annotations.filter(note => note.endId >= firstId - 2).forEach((note, noteIndex) => {
      const alpha = Math.max(.35, 1 - (state.candleId - note.endId) / 75);
      ctx.globalAlpha = alpha; ctx.strokeStyle = note.side === 'long' ? LONG : note.side === 'short' ? SHORT : AMBER; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.5; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 7;
      const mapPoint = point => ({ x: startX + (point.id - firstId) * slot + slot / 2, y: scale.y(point.price) });
      note.lines.forEach(line => {
        const mapped = line.map(mapPoint).filter(point => point.x >= -slot && point.x <= chartWrap.clientWidth + slot); if (mapped.length < 2) return;
        ctx.beginPath(); mapped.forEach((point, i) => i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
        mapped.forEach(point => { ctx.beginPath(); ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2); ctx.fill(); });
      });
      const visiblePoints = note.lines.flat().map(mapPoint).filter(point => point.x >= 0 && point.x <= chartWrap.clientWidth);
      if (visiblePoints.length) {
        const anchor = visiblePoints.reduce((a, b) => a.y < b.y ? a : b); const label = `${note.category} · ${note.name}`;
        ctx.shadowBlur = 0; ctx.font = '900 9px Inter,system-ui'; const width = ctx.measureText(label).width + 12;
        ctx.fillStyle = 'rgba(5,7,11,.88)'; ctx.fillRect(Math.min(anchor.x, chartWrap.clientWidth - width - 5), Math.max(4, anchor.y - 20 - noteIndex * 2), width, 15);
        ctx.fillStyle = note.side === 'long' ? LONG : note.side === 'short' ? SHORT : AMBER; ctx.fillText(label, Math.min(anchor.x + 6, chartWrap.clientWidth - width + 1), Math.max(15, anchor.y - 9 - noteIndex * 2));
      }
      ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1;
  }
  function drawTradeMarker(trade, items, startX, slot, scale) {
    const index = items.findIndex(bar => bar.id === trade.candleId); if (index < 0) return;
    const x = startX + index * slot + slot / 2; const y = scale.y(trade.price); const reducing = trade.action === 'reduce'; const color = reducing ? AMBER : trade.side === 'long' ? LONG : SHORT;
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    if (reducing) { ctx.fillRect(x - 5, y - 2, 10, 4); ctx.strokeRect(x - 11, y - 8, 22, 16); }
    else { ctx.beginPath(); if (trade.side === 'long') { ctx.moveTo(x, y - 11); ctx.lineTo(x - 6, y + 1); ctx.lineTo(x + 6, y + 1); } else { ctx.moveTo(x, y + 11); ctx.lineTo(x - 6, y - 1); ctx.lineTo(x + 6, y - 1); } ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke(); }
  }
  function drawParticles(currentX, currentY) {
    state.particles.forEach(particle => { const progress = particle.age / particle.life; ctx.globalAlpha = Math.max(0, 1 - progress); ctx.strokeStyle = particle.color; ctx.lineWidth = particle.width; ctx.shadowColor = particle.color; ctx.shadowBlur = 8; const x = currentX + particle.vx * particle.age; const y = currentY + particle.offsetY + particle.vy * particle.age; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - particle.vx * 4, y - particle.vy * 4); ctx.stroke(); });
  }
  function draw() {
    const width = chartWrap.clientWidth; const height = chartWrap.clientHeight; ctx.clearRect(0, 0, width, height);
    const items = visibleCandles(); if (!items.length) return;
    const scale = chartScale(items, height); const slot = width / 59; const startX = Math.max(8, width - items.length * slot - width * .075); const currentX = startX + (items.length - 1) * slot + slot / 2;
    ctx.save(); drawPositionZone(items, scale, startX, slot, currentX);
    items.forEach((bar, index) => { const x = startX + index * slot + slot / 2; const color = bar.close >= bar.open ? LONG : SHORT; const isCurrent = index === items.length - 1; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = state.marketEvent && isCurrent ? 1.8 : 1; ctx.globalAlpha = index < 5 ? .25 + index * .12 : 1; if (isCurrent && state.marketEvent) { ctx.shadowColor = color; ctx.shadowBlur = 22; } ctx.beginPath(); ctx.moveTo(x, scale.y(bar.high)); ctx.lineTo(x, scale.y(bar.low)); ctx.stroke(); const top = Math.min(scale.y(bar.open), scale.y(bar.close)); ctx.fillRect(x - Math.max(4, slot * .54) / 2, top, Math.max(4, slot * .54), Math.max(2, Math.abs(scale.y(bar.open) - scale.y(bar.close)))); ctx.shadowBlur = 0; });
    drawAnnotations(items, scale, startX, slot); state.trades.slice(-30).forEach(trade => drawTradeMarker(trade, items, startX, slot, scale)); drawParticles(currentX, scale.y(state.price)); ctx.restore();
    $('priceLine').style.top = `${Math.max(6, Math.min(height - 6, scale.y(state.price)))}px`;
  }

  function pivots(bars, span = 2) {
    const peaks = []; const troughs = [];
    for (let i = span; i < bars.length - span; i += 1) {
      const neighbors = bars.slice(i - span, i + span + 1); const bar = bars[i];
      if (bar.high >= Math.max(...neighbors.map(item => item.high))) peaks.push({ id: bar.id, price: bar.high, index: i });
      if (bar.low <= Math.min(...neighbors.map(item => item.low))) troughs.push({ id: bar.id, price: bar.low, index: i });
    }
    return { peaks, troughs };
  }
  const near = (a, b, tolerance = .022) => Math.abs(a - b) / Math.max(.001, (a + b) / 2) <= tolerance;
  function regression(points) {
    if (points.length < 2) return null;
    const x0 = points[0].id; const xs = points.map(point => point.id - x0); const ys = points.map(point => point.price); const mx = xs.reduce((a, b) => a + b, 0) / xs.length; const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const slope = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0) / Math.max(.001, xs.reduce((sum, x) => sum + (x - mx) ** 2, 0)); const intercept = my - slope * mx;
    return { slope, point: id => ({ id, price: intercept + slope * (id - x0) }) };
  }
  function lineBetweenRange(bars, fromId, toId, key) {
    const range = bars.filter(bar => bar.id >= fromId && bar.id <= toId); if (!range.length) return null;
    const chosen = key === 'low' ? range.reduce((a, b) => a.low < b.low ? a : b) : range.reduce((a, b) => a.high > b.high ? a : b);
    return { id: chosen.id, price: chosen[key] };
  }
  function buildPattern(name, side, category, lines, endId) { return { name, side, category, lines: lines.map(line => line?.filter(Boolean)).filter(line => line?.length >= 2), endId }; }
  function recognizeAdvancedPattern() {
    const bars = state.candles.slice(-48); if (bars.length < 12) return null;
    const last = bars.at(-1); const { peaks, troughs } = pivots(bars, 2);
    const lastPeaks = peaks.slice(-3); const lastTroughs = troughs.slice(-3);
    if (lastPeaks.length === 3 && lastPeaks.every(point => near(point.price, lastPeaks[0].price, .018))) {
      const neck = Math.min(...bars.filter(bar => bar.id >= lastPeaks[0].id).map(bar => bar.low));
      return buildPattern('三重顶', 'short', '反转', [[...lastPeaks], [{ id: lastPeaks[0].id, price: neck }, { id: last.id, price: neck }]], last.id);
    }
    if (lastTroughs.length === 3 && lastTroughs.every(point => near(point.price, lastTroughs[0].price, .018))) {
      const neck = Math.max(...bars.filter(bar => bar.id >= lastTroughs[0].id).map(bar => bar.high));
      return buildPattern('三重底', 'long', '反转', [[...lastTroughs], [{ id: lastTroughs[0].id, price: neck }, { id: last.id, price: neck }]], last.id);
    }
    if (lastPeaks.length === 3 && lastPeaks[1].price > lastPeaks[0].price * 1.025 && lastPeaks[1].price > lastPeaks[2].price * 1.025 && near(lastPeaks[0].price, lastPeaks[2].price, .035)) {
      const n1 = lineBetweenRange(bars, lastPeaks[0].id, lastPeaks[1].id, 'low'); const n2 = lineBetweenRange(bars, lastPeaks[1].id, lastPeaks[2].id, 'low');
      return buildPattern('头肩顶', 'short', '反转', [[lastPeaks[0], lastPeaks[1], lastPeaks[2]], [n1, n2]], last.id);
    }
    if (lastTroughs.length === 3 && lastTroughs[1].price < lastTroughs[0].price * .975 && lastTroughs[1].price < lastTroughs[2].price * .975 && near(lastTroughs[0].price, lastTroughs[2].price, .035)) {
      const n1 = lineBetweenRange(bars, lastTroughs[0].id, lastTroughs[1].id, 'high'); const n2 = lineBetweenRange(bars, lastTroughs[1].id, lastTroughs[2].id, 'high');
      return buildPattern('头肩底', 'long', '反转', [[lastTroughs[0], lastTroughs[1], lastTroughs[2]], [n1, n2]], last.id);
    }
    if (lastPeaks.length >= 2) {
      const [a, b] = lastPeaks.slice(-2); const valley = lineBetweenRange(bars, a.id, b.id, 'low');
      if (near(a.price, b.price, .018) && valley && valley.price < Math.min(a.price, b.price) * .985) return buildPattern('双重顶', 'short', '反转', [[a, b], [valley, { id: last.id, price: valley.price }]], last.id);
    }
    if (lastTroughs.length >= 2) {
      const [a, b] = lastTroughs.slice(-2); const peak = lineBetweenRange(bars, a.id, b.id, 'high');
      if (near(a.price, b.price, .018) && peak && peak.price > Math.max(a.price, b.price) * 1.015) return buildPattern('双重底', 'long', '反转', [[a, b], [peak, { id: last.id, price: peak.price }]], last.id);
    }
    const curve = bars.slice(-36); const left = curve.slice(0, 8).reduce((s, b) => s + b.close, 0) / 8; const middle = curve.slice(14, 22).reduce((s, b) => s + b.close, 0) / 8; const right = curve.slice(-8).reduce((s, b) => s + b.close, 0) / 8;
    const curveLine = curve.filter((_, i) => i % 5 === 0 || i === curve.length - 1).map(bar => ({ id: bar.id, price: bar.close }));
    if (near(left, right, .035) && middle > Math.max(left, right) * 1.035) return buildPattern('圆弧顶', 'short', '反转', [curveLine], last.id);
    if (near(left, right, .035) && middle < Math.min(left, right) * .965) return buildPattern('圆弧底', 'long', '反转', [curveLine], last.id);
    const window = bars.slice(-26); const local = pivots(window, 1); const highReg = regression(local.peaks.map(point => ({ id: point.id, price: point.price }))); const lowReg = regression(local.troughs.map(point => ({ id: point.id, price: point.price })));
    if (highReg && lowReg && local.peaks.length >= 3 && local.troughs.length >= 3) {
      const from = window[0].id; const to = window.at(-1).id; const lines = [[highReg.point(from), highReg.point(to)], [lowReg.point(from), lowReg.point(to)]];
      if (highReg.slope < 0 && lowReg.slope > 0) return buildPattern('对称三角形', bars.at(-8).close <= last.close ? 'long' : 'short', '中继', lines, last.id);
      if (highReg.slope < 0 && lowReg.slope < 0 && highReg.slope < lowReg.slope * 1.18) return buildPattern('下降楔形', 'long', '反转', lines, last.id);
      if (highReg.slope > 0 && lowReg.slope > 0 && lowReg.slope > highReg.slope * 1.18) return buildPattern('上升楔形', 'short', '反转', lines, last.id);
      if (Math.abs(highReg.slope) < Math.abs(lowReg.slope) * .22) return buildPattern('上升三角形', 'long', '持续', lines, last.id);
      if (Math.abs(lowReg.slope) < Math.abs(highReg.slope) * .22) return buildPattern('下降三角形', 'short', '持续', lines, last.id);
    }
    const flag = bars.slice(-22); const impulse = (flag[7].close - flag[0].open) / flag[0].open; const consolidation = flag.slice(8); const consPoints = consolidation.map(bar => ({ id: bar.id, price: bar.close })); const consReg = regression(consPoints); const consRange = Math.max(...consolidation.map(bar => bar.high)) - Math.min(...consolidation.map(bar => bar.low)); const impulseRange = Math.max(...flag.slice(0, 8).map(bar => bar.high)) - Math.min(...flag.slice(0, 8).map(bar => bar.low));
    if (consReg && Math.abs(impulse) > .04 && consRange < impulseRange * .72 && Math.sign(consReg.slope) !== Math.sign(impulse)) {
      const highs = regression(consolidation.map(bar => ({ id: bar.id, price: bar.high }))); const lows = regression(consolidation.map(bar => ({ id: bar.id, price: bar.low }))); const from = consolidation[0].id; const to = last.id;
      return buildPattern(impulse > 0 ? '上升旗形' : '下降旗形', impulse > 0 ? 'long' : 'short', '持续/中继', [[highs.point(from), highs.point(to)], [lows.point(from), lows.point(to)]], last.id);
    }
    const prev = bars.at(-2); const body = bar => Math.abs(bar.close - bar.open); const bullish = bar => bar.close > bar.open;
    if (bullish(last) && !bullish(prev) && last.open <= prev.close && last.close >= prev.open && body(last) > body(prev) * 1.08) return buildPattern('看涨吞没', 'long', '反转', [[{ id: prev.id, price: prev.low }, { id: last.id, price: last.high }]], last.id);
    if (!bullish(last) && bullish(prev) && last.open >= prev.close && last.close <= prev.open && body(last) > body(prev) * 1.08) return buildPattern('看跌吞没', 'short', '反转', [[{ id: prev.id, price: prev.high }, { id: last.id, price: last.low }]], last.id);
    return null;
  }
  function showPattern(pattern) {
    const previous = state.seenPatterns.get(pattern.name) ?? -999; if (pattern.endId - previous < 16) return;
    state.seenPatterns.set(pattern.name, pattern.endId); state.annotations.push(pattern); state.annotations = state.annotations.slice(-5);
    const matched = state.position?.side === pattern.side; const callout = $('patternCallout'); callout.className = `pattern-callout${matched ? ' match' : ''}`;
    callout.textContent = matched ? `${pattern.category} · ${pattern.name} · 顺势 +${600 * state.combo}` : `${pattern.category} · ${pattern.name}`; void callout.offsetWidth; callout.classList.add('show');
    if (state.position) pulsePositionValue(matched);
    if (matched) { const reward = 600 * state.combo; state.bonusScore += reward; state.combo += 1; state.patternsMatched += 1; burst(`PATTERN +${reward}`); ambientFeedback(pattern.side, `${pattern.name} 命中`, 43, 42); }
  }
  function completeCandle() {
    state.current = { ...state.target, id: state.candleId }; state.price = state.target.close; state.candles.push(state.current); if (state.candles.length > 150) state.candles.shift();
    const pattern = recognizeAdvancedPattern(); if (pattern) showPattern(pattern); finishMarketEvent();
    state.replayIndex += 1; state.candleId += 1;
    if (state.replayIndex >= CONFIG.matchCandles) finishMatch('complete'); else prepareCandle();
  }

  function emitEventParticles(direction) { const color = direction > 0 ? LONG : SHORT; for (let i = 0; i < 7; i += 1) state.particles.push({ age: 0, life: 9 + Math.random() * 6, vx: -(1.2 + Math.random() * 3.8), vy: direction * (Math.random() - .3) * 1.2, offsetY: (Math.random() - .5) * 36, width: .6 + Math.random() * 1.6, color }); }
  function beginMarketEvent(direction, label) { state.marketEvent = { direction }; const element = $('marketEvent'); chartWrap.classList.remove('event-bull', 'event-bear'); chartWrap.classList.add(direction > 0 ? 'event-bull' : 'event-bear'); element.className = `market-event ${direction > 0 ? 'bull' : 'bear'}`; element.querySelector('span').textContent = `${label} · ${direction > 0 ? '大阳线' : '大阴线'}`; if (state.position) pulsePositionValue(direction === sideSign(state.position.side)); playTone(direction > 0 ? 'long' : 'short', .65); }
  function finishMarketEvent() { if (!state.marketEvent) return; state.marketEvent = null; setTimeout(() => { if (!state.marketEvent) { $('marketEvent').className = 'market-event'; chartWrap.classList.remove('event-bull', 'event-bear'); } }, 450); }

  function updateScoreDisplay(nextScore) { const delta = nextScore - state.renderedScore; if (!delta) return; $('score').textContent = `${nextScore > 0 ? '+' : ''}${nextScore.toLocaleString('en-US')}`; if (Math.abs(delta) >= 2) { const ticker = $('scoreDelta'); ticker.textContent = `${delta > 0 ? '+' : ''}${delta}`; ticker.style.color = delta >= 0 ? LONG : SHORT; ticker.classList.remove('tick'); void ticker.offsetWidth; ticker.classList.add('tick'); } state.renderedScore = nextScore; }
  function updateTradeButtons() {
    const position = state.position; const free = availableMargin(); const nextMargin = free * state.allocation / 100; const longButton = $('longButton'); const shortButton = $('shortButton'); longButton.classList.remove('reduce-key', 'locked'); shortButton.classList.remove('reduce-key', 'locked');
    if (!position) { $('longLabel').textContent = '做多'; $('longCaption').textContent = `看涨 · ${money(nextMargin)}`; $('longIcon').textContent = '↗'; $('shortLabel').textContent = '做空'; $('shortCaption').textContent = `看跌 · ${money(nextMargin)}`; $('shortIcon').textContent = '↘'; return; }
    if (position.side === 'long') { $('longLabel').textContent = '加多'; $('longCaption').textContent = `主动加仓 · ${money(nextMargin)}`; $('longIcon').textContent = '+↗'; $('shortLabel').textContent = '减多'; $('shortCaption').textContent = `反向减仓 · ${state.allocation}%`; $('shortIcon').textContent = '−'; shortButton.classList.add('reduce-key'); if (nextMargin < CONFIG.minMargin) longButton.classList.add('locked'); }
    else { $('shortLabel').textContent = '加空'; $('shortCaption').textContent = `主动加仓 · ${money(nextMargin)}`; $('shortIcon').textContent = '+↘'; $('longLabel').textContent = '减空'; $('longCaption').textContent = `反向减仓 · ${state.allocation}%`; $('longIcon').textContent = '−'; longButton.classList.add('reduce-key'); if (nextMargin < CONFIG.minMargin) shortButton.classList.add('locked'); }
  }
  function updateHud() {
    updatePoints(); const accountEquity = Math.max(0, equity()); const pnl = unrealizedPnl(); const sessionMove = state.price ? (state.price - state.sessionOpen) / state.sessionOpen * 100 : 0; state.score = totalScore();
    $('lastPrice').textContent = state.price ? state.price.toFixed(2) : '—'; $('linePrice').textContent = state.price ? state.price.toFixed(2) : '—'; $('priceDelta').textContent = `${sessionMove >= 0 ? '+' : ''}${sessionMove.toFixed(2)}%`; $('priceDelta').className = sessionMove >= 0 ? 'positive' : 'negative';
    $('floatingPnl').textContent = state.position ? signedMoney(pnl) : '$0.00'; $('floatingPnl').className = !state.position ? '' : pnl >= 0 ? 'positive' : 'negative'; const positionEquity = state.position ? Math.max(0, state.position.margin + pnl) : 0; $('positionEquity').textContent = money(positionEquity); $('positionEquity').classList.toggle('positive', !!state.position && pnl >= 0); $('positionEquity').classList.toggle('negative', !!state.position && pnl < 0);
    $('equity').textContent = money(accountEquity); $('balance').textContent = money(availableMargin()); $('allocationValue').textContent = `${state.allocation}% · ${money(availableMargin() * state.allocation / 100)}`; $('realizedPnl').textContent = signedMoney(state.realizedPnl); $('realizedPnl').className = state.realizedPnl >= 0 ? 'positive' : 'negative'; $('combo').textContent = `× ${state.combo}`; $('winStreak').textContent = state.streak; $('replayCounter').textContent = `${Math.min(state.replayIndex, CONFIG.matchCandles)} / ${CONFIG.matchCandles}`; $('replayDate').textContent = state.current ? `${fmtDate(state.current.time)} · ${state.sourceLabel}` : '真实历史回放';
    $('timeFill').style.width = `${Math.max(0, Math.min(100, state.replayIndex / CONFIG.matchCandles * 100))}%`; updateScoreDisplay(state.score);
    const bar = $('positionBar'); const side = $('positionSide'); const status = $('positionStatus');
    if (!state.position) { side.textContent = '空仓'; side.className = 'position-side flat'; bar.classList.remove('short-mode'); $('entryPrice').textContent = '—'; $('positionSize').textContent = '$0.00'; $('returnRate').textContent = '0.00%'; $('returnRate').className = ''; status.className = 'position-pulse flat'; status.querySelector('span').textContent = '等待入场'; }
    else { const isLong = state.position.side === 'long'; const roi = pnl / Math.max(1, state.position.margin) * 100; side.textContent = isLong ? '多单' : '空单'; side.className = `position-side ${state.position.side}`; bar.classList.toggle('short-mode', !isLong); $('entryPrice').textContent = state.position.avgPrice.toFixed(2); $('positionSize').textContent = money(state.position.margin); $('returnRate').textContent = `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`; $('returnRate').className = roi >= 0 ? 'positive' : 'negative'; const zeroPrice = isLong ? Math.max(0, state.position.avgPrice - state.walletBalance / state.position.qty) : state.position.avgPrice + state.walletBalance / state.position.qty; status.className = 'position-pulse'; status.querySelector('span').textContent = `数量 ${state.position.qty.toFixed(2)} · 归零价 ${zeroPrice.toFixed(2)}`; }
    updateTradeButtons();
  }

  function playTone(type, volume = 1) { if (!state.sound) return; try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); const oscillator = audioContext.createOscillator(); const gain = audioContext.createGain(); oscillator.type = type === 'close' ? 'triangle' : 'square'; oscillator.frequency.setValueAtTime(type === 'long' ? 620 : type === 'short' ? 270 : 440, audioContext.currentTime); oscillator.frequency.exponentialRampToValueAtTime(type === 'long' ? 910 : type === 'short' ? 190 : 660, audioContext.currentTime + .07); gain.gain.setValueAtTime(.055 * volume, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .1); oscillator.connect(gain).connect(audioContext.destination); oscillator.start(); oscillator.stop(audioContext.currentTime + .105); } catch (_) {} }
  function addFloater(type, label, x, y) { const floater = document.createElement('span'); floater.className = 'float-text'; floater.style.color = type === 'long' ? LONG : type === 'short' ? SHORT : AMBER; floater.style.left = `${x}%`; floater.style.top = `${y}%`; floater.textContent = label; $('floatingLayer').appendChild(floater); setTimeout(() => floater.remove(), 850); }
  function feedback(type, label, x = 50, y = 56) { const button = type === 'long' ? $('longButton') : type === 'short' ? $('shortButton') : $('closeButton'); button.classList.remove('hit'); void button.offsetWidth; button.classList.add('hit'); setTimeout(() => button.classList.remove('hit'), 170); if (type !== 'close') { $('screenFlash').className = `screen-flash ${type}`; setTimeout(() => { $('screenFlash').className = 'screen-flash'; }, 360); } addFloater(type, label, x, y); playTone(type); if (navigator.vibrate) navigator.vibrate(type === 'close' ? 12 : [12, 18, 16]); }
  function ambientFeedback(type, label, x = 50, y = 45) { $('screenFlash').className = `screen-flash ${type}`; setTimeout(() => { $('screenFlash').className = 'screen-flash'; }, 360); addFloater(type, label, x, y); playTone(type, .8); if (navigator.vibrate) navigator.vibrate(10); }
  function pulsePositionValue(profitable) { if (!state.position) return; const element = $('positionEquity'); element.classList.remove('impact-profit', 'impact-loss'); void element.offsetWidth; element.classList.add(profitable ? 'impact-profit' : 'impact-loss'); setTimeout(() => element.classList.remove('impact-profit', 'impact-loss'), 760); }
  function burst(text) { const element = $('comboBurst'); element.textContent = text; element.classList.remove('show'); void element.offsetWidth; element.classList.add('show'); }
  function showToast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 1700); }
  function recordFastAction() { const now = performance.now(); state.lastActions = state.lastActions.filter(time => now - time < 2200); state.lastActions.push(now); if (state.lastActions.length >= 3) { state.combo += 1; state.bonusScore += 40; burst(`RUSH ×${state.combo}`); } }

  function openOrAdd(side) { const free = availableMargin(); const margin = free * state.allocation / 100; if (margin < CONFIG.minMargin) { showToast(`可用保证金不足，至少需要 ${money(CONFIG.minMargin)}`); return false; } const notional = margin * CONFIG.leverage; const qty = notional / state.price; const fee = notional * CONFIG.feeRate; state.walletBalance -= fee; state.realizedPnl -= fee; const opening = !state.position; if (opening) state.position = { side, qty, avgPrice: state.price, margin, startCandleId: state.current.id }; else { const oldQty = state.position.qty; state.position.avgPrice = (state.position.avgPrice * oldQty + state.price * qty) / (oldQty + qty); state.position.qty += qty; state.position.margin += margin; } state.trades.push({ action: opening ? 'open' : 'add', side, price: state.price, candleId: state.current.id }); recordFastAction(); feedback(side, `${opening ? '开仓' : '加仓'} ${state.allocation}%`); showToast(`${side === 'long' ? '多单' : '空单'}成交 ${state.price.toFixed(2)} · 手续费 ${money(fee)}`); return true; }
  function reducePosition(fraction, viaCloseButton = false, quiet = false) { if (!state.position) { if (!quiet) showToast('当前没有持仓'); return false; } const position = state.position; const closeFraction = Math.max(.01, Math.min(1, fraction)); const qty = position.qty * closeFraction; const notional = qty * state.price; const grossPnl = (state.price - position.avgPrice) * qty * sideSign(position.side); const fee = notional * CONFIG.feeRate; const netPnl = grossPnl - fee; state.walletBalance += netPnl; state.realizedPnl += netPnl; state.trades.push({ action: 'reduce', side: position.side, price: state.price, candleId: state.current.id }); position.qty -= qty; position.margin *= 1 - closeFraction; if (closeFraction >= .999 || position.qty < .0001) state.position = null; if (!quiet) { if (netPnl >= 0) { state.streak += 1; state.combo += 1; state.bonusScore += 80 * state.combo; } else { state.streak = 0; state.combo = 1; } recordFastAction(); feedback(viaCloseButton ? 'close' : position.side === 'long' ? 'short' : 'long', `${netPnl >= 0 ? '盈利' : '亏损'} ${signedMoney(netPnl)}`); showToast(`${state.position ? `减仓 ${Math.round(closeFraction * 100)}%` : '全部平仓'} · 已实现 ${signedMoney(netPnl)}`); } return true; }
  function placeOrder(side) { if (!state.matchActive || state.gameOver) return; if (state.position && state.position.side !== side) reducePosition(state.allocation / 100); else openOrAdd(side); updateHud(); draw(); checkGameEnd(); }
  function closePosition() { if (!state.matchActive || state.gameOver) return; reducePosition(1, true); updateHud(); draw(); checkGameEnd(); }
  function setAllocation(value) { if (![10, 25, 50, 100].includes(value)) throw new Error('投入比例必须为 10、25、50 或 100'); state.allocation = value; [...$('allocationSegments').children].forEach(button => { const active = Number(button.dataset.value) === value; button.classList.toggle('active', active); button.setAttribute('aria-checked', String(active)); }); $('allocationValue').textContent = `${value}% · ${money(availableMargin() * value / 100)}`; if (state.current) updateHud(); }

  function checkGameEnd() { if (!state.matchActive || state.gameOver) return; const currentEquity = equity(); if (currentEquity <= 0) finishMatch('bankrupt'); else if (currentEquity >= CONFIG.targetBalance) finishMatch('tenfold'); }
  function finishMatch(reason) {
    if (state.gameOver) return; if (state.position) reducePosition(1, true, true); state.gameOver = true; state.matchActive = false; updateHud();
    const finalEquity = Math.max(0, equity()); const returnRate = (finalEquity - CONFIG.startingBalance) / CONFIG.startingBalance; const payout = Math.max(0, Math.round(CONFIG.entryFee * (1 + returnRate * 5))); const netPoints = payout - CONFIG.entryFee; state.careerPoints += payout; savePoints();
    $('resultKicker').textContent = reason === 'complete' ? '500 根历史回放完成' : reason === 'tenfold' ? '十倍挑战达成' : '账户风险触底'; $('gameOverTitle').textContent = returnRate >= 0 ? `收益 ${(returnRate * 100).toFixed(2)}%` : `亏损 ${(Math.abs(returnRate) * 100).toFixed(2)}%`; $('gameOverTitle').style.color = returnRate >= 0 ? LONG : SHORT; $('resultEquity').textContent = money(finalEquity); $('resultEquity').style.color = returnRate >= 0 ? LONG : SHORT; $('resultScore').textContent = state.score.toLocaleString('en-US'); $('resultPatterns').textContent = state.patternsMatched; $('pointsSettlement').textContent = `积分结算 ${netPoints >= 0 ? '+' : ''}${netPoints} PT（返还 ${payout}）`; $('pointsSettlement').style.color = netPoints >= 0 ? LONG : SHORT; $('gameOver').classList.add('show'); $('gameOver').setAttribute('aria-hidden', 'false'); $('restartButton').focus(); playTone(returnRate >= 0 ? 'long' : 'short', 1.5);
  }
  function returnToLobby() { $('gameOver').classList.remove('show'); $('gameOver').setAttribute('aria-hidden', 'true'); $('lobby').classList.add('show'); $('loadStatus').textContent = ''; updatePoints(); }

  $('startMatch').addEventListener('click', startMatch);
  $('allocationSegments').addEventListener('click', event => { const button = event.target.closest('button'); if (button) setAllocation(Number(button.dataset.value)); });
  $('longButton').addEventListener('pointerdown', () => placeOrder('long')); $('shortButton').addEventListener('pointerdown', () => placeOrder('short')); $('closeButton').addEventListener('pointerdown', closePosition); $('restartButton').addEventListener('click', returnToLobby);
  $('soundToggle').addEventListener('click', () => { state.sound = !state.sound; $('soundToggle').setAttribute('aria-pressed', String(state.sound)); showToast(state.sound ? '音效已开启' : '音效已关闭'); });
  document.addEventListener('keydown', event => { if (event.repeat) return; if (state.gameOver && event.code === 'Enter') { returnToLobby(); return; } if (event.code === 'KeyA') placeOrder('long'); if (event.code === 'KeyD') placeOrder('short'); if (event.code === 'Space') { event.preventDefault(); closePosition(); } });

  function registerAgentTools() {
    const context = document.modelContext; if (!context?.registerTool) return; const controller = new AbortController(); const register = tool => { try { void Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => {}); } catch (_) {} };
    register({ name: 'set_trade_allocation', title: '设置投入比例', description: '设置本局开仓、加仓或反向减仓比例。', inputSchema: { type: 'object', properties: { percent: { type: 'number', enum: [10, 25, 50, 100] } }, required: ['percent'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) { setAllocation(Number(input?.percent)); return { allocation_percent: state.allocation }; } });
    register({ name: 'place_market_trade', title: '历史回放市价交易', description: '在当前历史K线价格做多或做空。同向加仓，反向减仓。', inputSchema: { type: 'object', properties: { side: { type: 'string', enum: ['long', 'short'] } }, required: ['side'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) { if (!['long', 'short'].includes(input?.side)) throw new Error('方向无效'); placeOrder(input.side); return { side: state.position?.side || null, price: state.price, equity: Number(equity().toFixed(2)) }; } });
    register({ name: 'close_market_position', title: '历史回放平仓', description: '按当前历史K线价格全部平仓。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute() { closePosition(); return { equity: Number(equity().toFixed(2)), score: state.score }; } });
  }

  initLobby(); updatePoints(); resize(); registerAgentTools(); window.addEventListener('resize', resize); setInterval(advanceReplay, 160);
})();
