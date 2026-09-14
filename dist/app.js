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
    { market: 'us', symbol: 'AAPL', name: 'Apple', meta: '美股 · 5分钟驱动', provider: 'yahoo', stooq: 'aapl.us' },
    { market: 'us', symbol: 'NVDA', name: 'NVIDIA', meta: '美股 · 5分钟驱动', provider: 'yahoo', stooq: 'nvda.us' },
    { market: 'cn', symbol: '600519', name: '贵州茅台', meta: '上交所 · 5分钟驱动', provider: 'eastmoney', secid: '1.600519' },
    { market: 'cn', symbol: '000001', name: '平安银行', meta: '深交所 · 5分钟驱动', provider: 'eastmoney', secid: '0.000001' },
    { market: 'crypto', symbol: 'BTCUSDT', name: 'Bitcoin', meta: '1分钟驱动 · 5分钟图', provider: 'binance' },
    { market: 'crypto', symbol: 'ETHUSDT', name: 'Ethereum', meta: '1分钟驱动 · 5分钟图', provider: 'binance' },
    { market: 'futures', symbol: 'GC=F', name: '黄金期货', meta: 'COMEX · 5分钟驱动', provider: 'yahoo', stooq: 'gc.f' },
    { market: 'futures', symbol: 'CL=F', name: '原油期货', meta: 'NYMEX · 5分钟驱动', provider: 'yahoo', stooq: 'cl.f' }
  ];
  let storedPoints = Number.NaN;
  try { const saved = localStorage.getItem('kline-rush-points'); if (saved !== null) storedPoints = Number(saved); } catch (_) {}
  const state = {
    selectedMarket: 'crypto', selected: INSTRUMENTS[4], careerPoints: Number.isFinite(storedPoints) ? storedPoints : 5000,
    matchActive: false, gameOver: false, replay: [], replayIndex: 0, tickInCandle: 0, candles: [], current: null, target: null, candleId: 0,
    price: 0, sessionOpen: 1, trades: [], particles: [], annotations: [], seenPatterns: new Map(), position: null,
    walletBalance: CONFIG.startingBalance, realizedPnl: 0, allocation: 10, bonusScore: 0, score: 0, renderedScore: 0,
    combo: 1, streak: 0, patternsMatched: 0, lastActions: [], marketEvent: null, sound: true, sourceLabel: ''
  };
  let ledger = new KlineCore.Ledger(CONFIG);
  let patternBook = new KlinePatterns.PatternBook();
  let loadedHistory = null;
  let savedSegment = null;
  let settled = false;
  let activeInput = null;
  let frames = [];
  let gameTick = 0;
  let matchSeed = 0;
  let paidFee = 0;
  let loading = false;
  let lastFrame = null;
  let accumulator = 0;
  let audioContext;
  function syncLedger() {
    const snap=ledger.snapshot();
    state.position=snap.position;state.walletBalance=snap.wallet;state.realizedPnl=snap.realized;
    state.bonusScore=snap.bonus;state.streak=snap.streak;state.combo=Math.min(5,1+snap.streak);
    state.patternsMatched=ledger.rewardCount;state.trades=ledger.fills;state.score=snap.score;
  }
  function ledgerEvents(quiet=false) {
    for(const event of ledger.drain()) {
      if(event.type==='OrderRejected'&&!quiet)showToast(event.reason);
      if(event.type==='TradeFilled'&&!quiet&&activeInput) {
        const f=event.fill;
        feedback(activeInput,(f.action==='reduce'?'减仓 / 平仓':f.action==='open'?'开仓':'加仓')+' '+money(f.qty*f.price/CONFIG.leverage));
        showToast('成交 '+f.price.toFixed(2)+' · 手续费 '+money(f.fee));
      }
      if(event.type==='CycleClosed'&&!quiet) {pulsePositionValue(event.cycle.netPnl>0);showToast('整笔净盈亏 '+signedMoney(event.cycle.netPnl)+' · 连胜 '+event.streak);}
      if(event.type==='SignalProfitReward'&&!quiet) {burst('顺势盈利 +'+event.amount);ambientFeedback('long','完整交易奖励 +'+event.amount);}
    }
  }
  function captureFrame() {
    frames.push({tick:gameTick,candleId:state.candleId,fillCount:ledger.fills.length,bar:{...state.current},...ledger.snapshot()});
  }

  let toastTimer;
  const effectTimers = new WeakMap();
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionPreference.matches;
  try { const saved = localStorage.getItem('kline-rush-motion'); if (saved !== null) reducedMotion = saved === 'reduced'; } catch (_) {}
  function setMotion(reduced, persist = true) {
    reducedMotion = reduced;
    document.documentElement.classList.toggle('low-motion', reduced);
    $('motionToggle').setAttribute('aria-pressed', String(reduced));
    $('lobbyMotion').checked = reduced;
    if (reduced) { state.particles = []; $('screenFlash').className = 'screen-flash'; }
    if (persist) try { localStorage.setItem('kline-rush-motion', reduced ? 'reduced' : 'full'); } catch (_) {}
  }
  function timedEffect(element, className, duration, reset = []) {
    clearTimeout(effectTimers.get(element)); element.classList.remove(className, ...reset);
    void element.offsetWidth; element.classList.add(className);
    effectTimers.set(element, setTimeout(() => element.classList.remove(className, ...reset), duration));
  }
  function activeModal() { return $('lobby').classList.contains('show') ? $('lobby') : $('gameOver').classList.contains('show') ? $('gameOver') : null; }
  function syncModal() {
    const modal = activeModal();
    document.querySelectorAll('.hud, .stage, .controls, .status-rail').forEach(element => { element.inert = !!modal; });
    $('lobby').setAttribute('aria-hidden', String(modal !== $('lobby')));
    $('gameOver').setAttribute('aria-hidden', String(modal !== $('gameOver')));
    if (modal) (modal.querySelector('button:not(:disabled)') || modal).focus();
    else chartWrap.focus({ preventScroll: true });
  }
  const money = value => `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const signedMoney = value => `${value >= 0 ? '+' : '-'}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const sideSign = side => side === 'long' ? 1 : -1;
  const fmtDate = value => value ? new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—';
  const savePoints = () => { try { localStorage.setItem('kline-rush-points', String(state.careerPoints)); } catch (_) {} updatePoints(); };
  function updatePoints() { $('careerPoints').textContent = state.careerPoints.toLocaleString('en-US'); $('lobbyPoints').textContent = state.careerPoints.toLocaleString('en-US'); }

  function renderInstruments() {
    const items = INSTRUMENTS.filter(item => item.market === state.selectedMarket);
    if (!items.includes(state.selected)) state.selected = items[0];
    $('instrumentGrid').innerHTML = items.map(item => `<button class="instrument-card${item === state.selected ? ' active' : ''}" data-symbol="${item.symbol}"><span><strong>${item.name}</strong><small>${item.symbol} · ${item.meta}</small></span><em>500 BAR</em></button>`).join('');
  }
  function initLobby() {
    updatePoints(); renderInstruments();
    [...$('marketTabs').children].forEach(tab => tab.classList.toggle('active',tab.dataset.market===state.selectedMarket));
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
      renderInstruments(); $('instrumentGrid').querySelector('.active')?.focus(); $('loadStatus').textContent = '';
    });
  }
  async function startMatch(options={}) {
    if(loading)return;
    const practice=options.practice===true, same=options.same===true, instrument=state.selected;
    const fee=practice?0:CONFIG.entryFee;
    if(state.careerPoints<fee){$('loadStatus').textContent='积分不足，可以免费练习';showToast('积分不足，可以免费练习');return;}
    loading=true;$('startMatch').disabled=true;$('rematchButton').disabled=true;$('practiceButton').disabled=true;
    $('loadStatus').textContent='准备细粒度历史行情…';
    try {
      if(!same||!savedSegment) {
        if(!loadedHistory||loadedHistory.symbol!==instrument.symbol)loadedHistory={...await KlineData.load(instrument),symbol:instrument.symbol};
        state.selected=instrument;state.selectedMarket=instrument.market;
        const seedArray=new Uint32Array(1);crypto.getRandomValues(seedArray);matchSeed=seedArray[0];
        savedSegment=KlineReplay.selectSegment(loadedHistory.groups,matchSeed,CONFIG.warmup,CONFIG.matchCandles,loadedHistory.maxGapMs);
      }
      state.sourceLabel=loadedHistory.source;
      // Validate before debiting entry points.
      if(savedSegment.length!==560||savedSegment.some(b=>!Array.isArray(b.steps)||!b.steps.length))throw Error('回放数据不完整');
      paidFee=fee;state.practice=practice;
      initializeReplay(savedSegment);
      state.careerPoints-=fee;savePoints();
      $('lobby').classList.remove('show');syncModal();$('loadStatus').textContent='';
    }catch(error){$('loadStatus').textContent='无法开始：'+(error?.message||'行情加载失败');showToast($('loadStatus').textContent);}
    finally{loading=false;$('startMatch').disabled=false;$('rematchButton').disabled=false;$('practiceButton').disabled=false;}
  }

  function initializeReplay(segment) {
    savedSegment=segment;
    ledger=new KlineCore.Ledger(CONFIG);patternBook=new KlinePatterns.PatternBook();settled=false;frames=[];gameTick=0;lastFrame=null;accumulator=0;
    $('reviewPanel').hidden=true;
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
    state.target=state.replay[state.replayIndex];
    if(!state.target){finishMatch('complete');return;}
    state.current=KlineReplay.begin(state.target,state.candleId);state.price=state.current.open;state.tickInCandle=0;
    const recent=state.candles.slice(-20);
    state.currentAvgRange=recent.reduce((sum,b)=>sum+b.high-b.low,0)/Math.max(1,recent.length);
    ledger.mark(state.price,gameTick,state.candleId);syncLedger();captureFrame();checkGameEnd();updateHud();
  }
  function advanceReplay() {
    if(!state.matchActive||state.gameOver||!state.current)return;
    const observation=state.target.steps[state.tickInCandle];
    if(!observation){finishMatch('dataError');return;}
    gameTick+=1;state.tickInCandle+=1;
    KlineReplay.reveal(state.current,observation);state.price=state.current.close;
    ledger.mark(state.price,gameTick,state.candleId);syncLedger();captureFrame();
    checkGameEnd();if(state.gameOver)return;
    const range=state.current.high-state.current.low,body=Math.abs(state.current.close-state.current.open);
    if(!state.marketEvent&&(range>state.currentAvgRange*1.75||body>state.currentAvgRange*1.35))beginMarketEvent(state.current.close>=state.current.open?1:-1,'分钟行情大波动');
    if(state.marketEvent&&state.marketEvent.direction!==(state.current.close>=state.current.open?1:-1))beginMarketEvent(state.current.close>=state.current.open?1:-1,'波动方向变化');
    if(state.marketEvent)emitEventParticles(state.marketEvent.direction);
    if(state.tickInCandle>=state.target.steps.length)completeCandle();
    updateHud();
  }
  function frameLoop(now) {
    const elapsed=lastFrame===null?0:Math.min(100,now-lastFrame);lastFrame=now;
    if(state.matchActive&&!state.gameOver&&!document.hidden) {
      accumulator+=elapsed;
      while(accumulator>=160&&state.matchActive){accumulator-=160;advanceReplay();}
      for(const p of state.particles)p.age+=elapsed/160;
      state.particles=state.particles.filter(p=>p.age<p.life);
      draw();
    }
    requestAnimationFrame(frameLoop);
  }

  function unrealizedPnl() {return ledger.pnl();}
  function equity() {return ledger.equity();}
  function availableMargin() {return ledger.available();}
  function totalScore() {return ledger.score();}
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
      ctx.globalAlpha = note.status === 'invalid' ? .22 : alpha; ctx.setLineDash(note.status === 'candidate' ? [5, 5] : note.status === 'invalid' ? [2, 6] : []); ctx.strokeStyle = note.side === 'long' ? LONG : note.side === 'short' ? SHORT : AMBER; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.5; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 7;
      const mapPoint = point => ({ x: startX + (point.id - firstId) * slot + slot / 2, y: scale.y(point.price) });
      note.lines.forEach(line => {
        const mapped = line.map(mapPoint).filter(point => point.x >= -slot && point.x <= chartWrap.clientWidth + slot); if (mapped.length < 2) return;
        ctx.beginPath(); mapped.forEach((point, i) => i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
        mapped.forEach(point => { ctx.beginPath(); ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2); ctx.fill(); });
      });
      const visiblePoints = note.lines.flat().map(mapPoint).filter(point => point.x >= 0 && point.x <= chartWrap.clientWidth);
      if (visiblePoints.length) {
        const anchor = visiblePoints.reduce((a, b) => a.y < b.y ? a : b); const label = `${note.status === 'candidate' ? '候选' : note.status === 'confirmed' ? '确认' : '失效'} · ${note.name}`;
        ctx.shadowBlur = 0; ctx.font = '900 9px Inter,system-ui'; const width = ctx.measureText(label).width + 12;
        ctx.fillStyle = 'rgba(5,7,11,.88)'; ctx.fillRect(Math.min(anchor.x, chartWrap.clientWidth - width - 5), Math.max(4, anchor.y - 20 - noteIndex * 2), width, 15);
        ctx.fillStyle = note.side === 'long' ? LONG : note.side === 'short' ? SHORT : AMBER; ctx.fillText(label, Math.min(anchor.x + 6, chartWrap.clientWidth - width + 1), Math.max(15, anchor.y - 9 - noteIndex * 2));
      }
      ctx.shadowBlur = 0;ctx.setLineDash([]);
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
    items.forEach((bar, index) => { const x = startX + index * slot + slot / 2; const color = bar.close === bar.open ? '#a7b6c9' : bar.close > bar.open ? LONG : SHORT; const isCurrent = index === items.length - 1; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = state.marketEvent && isCurrent ? 1.8 : 1; ctx.globalAlpha = index < 5 ? .25 + index * .12 : 1; if (isCurrent && state.marketEvent) { ctx.shadowColor = color; ctx.shadowBlur = 22; } ctx.beginPath(); ctx.moveTo(x, scale.y(bar.high)); ctx.lineTo(x, scale.y(bar.low)); ctx.stroke(); const top = Math.min(scale.y(bar.open), scale.y(bar.close)); ctx.fillRect(x - Math.max(4, slot * .54) / 2, top, Math.max(4, slot * .54), Math.max(2, Math.abs(scale.y(bar.open) - scale.y(bar.close)))); ctx.shadowBlur = 0; });
    drawAnnotations(items, scale, startX, slot); state.trades.slice(-30).forEach(trade => drawTradeMarker(trade, items, startX, slot, scale)); drawParticles(currentX, scale.y(state.price)); ctx.restore();
    $('priceLine').style.top = `${Math.max(6, Math.min(height - 6, scale.y(state.price)))}px`;
  }

  function showPattern(event, announce=true) {
    const note=event.note;
    if(event.type==='confirmed')ledger.registerSignal(note);
    if(event.type==='invalid')ledger.invalidateSignal(note.id);
    if(!announce)return;
    const callout=$('patternCallout');
    callout.className='pattern-callout'+(event.type==='confirmed'?' match':'');
    callout.textContent=(event.type==='candidate'?'候选':event.type==='confirmed'?'已确认':'已失效')+' · '+note.name+(event.type==='confirmed'?' · 及时执行，盈利结算后奖励':'');
    timedEffect(callout,'show',2200);
    if(event.type==='confirmed'){ledger.registerSignal(note);if(state.position)pulsePositionValue(unrealizedPnl()>=0);}
    if(event.type==='invalid')ledger.invalidateSignal(note.id);
  }
  function completeCandle() {
    // Current candle contains only lower-timeframe observations already revealed.
    state.candles.push({...state.current});if(state.candles.length>150)state.candles.shift();
    const events=patternBook.advance(state.candles,gameTick);
    events.forEach(event=>showPattern(event,false));
    const headline=events.find(event=>event.type==='confirmed')||events.find(event=>event.type==='invalid')||events.at(-1);
    if(headline)showPattern(headline);state.annotations=patternBook.visible();finishMarketEvent();
    state.replayIndex+=1;state.candleId+=1;
    if(state.replayIndex>=CONFIG.matchCandles)finishMatch('complete');else prepareCandle();
  }

  function emitEventParticles(direction) { if (reducedMotion) return; state.particles = state.particles.slice(-56); const color = direction > 0 ? LONG : SHORT; for (let i = 0; i < 7; i += 1) state.particles.push({ age: 0, life: 9 + Math.random() * 6, vx: -(1.2 + Math.random() * 3.8), vy: direction * (Math.random() - .3) * 1.2, offsetY: (Math.random() - .5) * 36, width: .6 + Math.random() * 1.6, color }); }
  function beginMarketEvent(direction, label) { state.marketEvent = { direction }; const element = $('marketEvent'); chartWrap.classList.remove('event-bull', 'event-bear'); chartWrap.classList.add(direction > 0 ? 'event-bull' : 'event-bear'); element.className = `market-event ${direction > 0 ? 'bull' : 'bear'}`; element.querySelector('span').textContent = `${label} · ${direction > 0 ? '大阳线' : '大阴线'}`; if (state.position) pulsePositionValue(unrealizedPnl() >= 0); playTone(direction > 0 ? 'long' : 'short', .65); }
  function finishMarketEvent() { if (!state.marketEvent) return; state.marketEvent = null; setTimeout(() => { if (!state.marketEvent) { $('marketEvent').className = 'market-event'; chartWrap.classList.remove('event-bull', 'event-bear'); } }, 450); }

  function updateScoreDisplay(nextScore) { const delta = nextScore - state.renderedScore; if (!delta) return; $('score').textContent = `${nextScore > 0 ? '+' : ''}${nextScore.toLocaleString('en-US')}`; if (Math.abs(delta) >= 2) { const ticker = $('scoreDelta'); ticker.textContent = `${delta > 0 ? '+' : ''}${delta}`; ticker.style.color = delta >= 0 ? LONG : SHORT; ticker.classList.remove('tick'); void ticker.offsetWidth; ticker.classList.add('tick'); } state.renderedScore = nextScore; }
  function updateTradeButtons() {
    const position = state.position; const free = availableMargin(); const nextMargin = Math.min(free * state.allocation / 100, free / (1 + CONFIG.leverage * CONFIG.feeRate)); const longButton = $('longButton'); const shortButton = $('shortButton'); longButton.classList.remove('reduce-key', 'locked'); shortButton.classList.remove('reduce-key', 'locked');
    if (!position) { $('longLabel').textContent = '做多'; $('longCaption').textContent = `看涨 · ${money(nextMargin)}`; $('longIcon').textContent = '↗'; $('shortLabel').textContent = '做空'; $('shortCaption').textContent = `看跌 · ${money(nextMargin)}`; $('shortIcon').textContent = '↘'; return; }
    if (position.side === 'long') { $('longLabel').textContent = '加多'; $('longCaption').textContent = `主动加仓 · ${money(nextMargin)}`; $('longIcon').textContent = '+↗'; $('shortLabel').textContent = '减多'; $('shortCaption').textContent = `反向减仓 · ${state.allocation}%`; $('shortIcon').textContent = '−'; shortButton.classList.add('reduce-key'); if (nextMargin < CONFIG.minMargin) longButton.classList.add('locked'); }
    else { $('shortLabel').textContent = '加空'; $('shortCaption').textContent = `主动加仓 · ${money(nextMargin)}`; $('shortIcon').textContent = '+↘'; $('longLabel').textContent = '减空'; $('longCaption').textContent = `反向减仓 · ${state.allocation}%`; $('longIcon').textContent = '−'; longButton.classList.add('reduce-key'); if (nextMargin < CONFIG.minMargin) shortButton.classList.add('locked'); }
  }
  function updateHud() {
    updatePoints(); const accountEquity = Math.max(0, equity()); const pnl = unrealizedPnl(); const sessionMove = state.price ? (state.price - state.sessionOpen) / state.sessionOpen * 100 : 0; state.score = totalScore();
    $('lastPrice').textContent = state.price ? state.price.toFixed(2) : '—'; $('linePrice').textContent = state.price ? state.price.toFixed(2) : '—'; $('priceDelta').textContent = `${sessionMove >= 0 ? '+' : ''}${sessionMove.toFixed(2)}%`; $('priceDelta').className = sessionMove >= 0 ? 'positive' : 'negative';
    $('floatingPnl').textContent = state.position ? signedMoney(pnl) : '$0.00'; $('floatingPnl').className = !state.position ? '' : pnl >= 0 ? 'positive' : 'negative'; const positionEquity = state.position ? Math.max(0, state.position.margin + pnl) : 0; $('positionEquity').textContent = money(positionEquity); $('positionEquity').classList.toggle('positive', !!state.position && pnl >= 0); $('positionEquity').classList.toggle('negative', !!state.position && pnl < 0);
    $('equity').textContent = money(accountEquity); $('balance').textContent = money(availableMargin()); $('allocationValue').textContent = `${state.allocation}% · ${money(Math.min(availableMargin() * state.allocation / 100, availableMargin() / (1 + CONFIG.leverage * CONFIG.feeRate)))}`; $('realizedPnl').textContent = signedMoney(state.realizedPnl); $('realizedPnl').className = state.realizedPnl >= 0 ? 'positive' : 'negative'; $('combo').textContent = `× ${state.combo}`; $('winStreak').textContent = state.streak; $('replayCounter').textContent = `${Math.min(state.replayIndex, CONFIG.matchCandles)} / ${CONFIG.matchCandles}`; $('replayDate').textContent = state.current ? `${fmtDate(state.current.time)} · ${state.sourceLabel}` : '真实历史回放';
    $('timeFill').style.width = `${Math.max(0, Math.min(100, state.replayIndex / CONFIG.matchCandles * 100))}%`; updateScoreDisplay(state.score);
    const bar = $('positionBar'); const side = $('positionSide'); const status = $('positionStatus');
    if (!state.position) { side.textContent = '空仓'; side.className = 'position-side flat'; bar.classList.remove('short-mode'); $('entryPrice').textContent = '—'; $('positionSize').textContent = '$0.00'; $('returnRate').textContent = '0.00%'; $('returnRate').className = ''; status.className = 'position-pulse flat'; status.querySelector('span').textContent = '等待入场'; }
    else { const isLong = state.position.side === 'long'; const roi = pnl / Math.max(1, state.position.margin) * 100; side.textContent = isLong ? '多单' : '空单'; side.className = `position-side ${state.position.side}`; bar.classList.toggle('short-mode', !isLong); $('entryPrice').textContent = state.position.avgPrice.toFixed(2); $('positionSize').textContent = money(state.position.margin); $('returnRate').textContent = `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`; $('returnRate').className = roi >= 0 ? 'positive' : 'negative'; const zeroPrice = isLong ? Math.max(0, state.position.avgPrice - state.walletBalance / state.position.qty) : state.position.avgPrice + state.walletBalance / state.position.qty; status.className = 'position-pulse'; status.querySelector('span').textContent = `数量 ${state.position.qty.toFixed(2)} · 归零价 ${zeroPrice.toFixed(2)}`; }
    updateTradeButtons();
  }

  function playTone(type, volume = 1) { if (!state.sound) return; try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); const oscillator = audioContext.createOscillator(); const gain = audioContext.createGain(); oscillator.type = type === 'close' ? 'triangle' : 'square'; oscillator.frequency.setValueAtTime(type === 'long' ? 620 : type === 'short' ? 270 : 440, audioContext.currentTime); oscillator.frequency.exponentialRampToValueAtTime(type === 'long' ? 910 : type === 'short' ? 190 : 660, audioContext.currentTime + .07); gain.gain.setValueAtTime(.055 * volume, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .1); oscillator.connect(gain).connect(audioContext.destination); oscillator.start(); oscillator.stop(audioContext.currentTime + .105); } catch (_) {} }
  function addFloater(type, label, x, y) { const layer = $('floatingLayer'); while (layer.children.length >= 5) layer.firstElementChild.remove(); const floater = document.createElement('span'); floater.className = 'float-text'; floater.style.color = type === 'long' ? LONG : type === 'short' ? SHORT : AMBER; floater.style.left = `${x}%`; floater.style.top = `${y}%`; floater.textContent = label; layer.appendChild(floater); setTimeout(() => floater.remove(), 850); }
  function feedback(type, label, x = 50, y = 56) { const button = type === 'long' ? $('longButton') : type === 'short' ? $('shortButton') : $('closeButton'); timedEffect(button, 'hit', 110); addFloater(type, label, x, y); playTone(type, .65); if (!reducedMotion && navigator.vibrate) navigator.vibrate(8); }
  function ambientFeedback(type, label, x = 50, y = 45) { if (!reducedMotion) timedEffect($('screenFlash'), type, 260, ['long', 'short']); addFloater(type, label, x, y); playTone(type, .8); }
  function pulsePositionValue(profitable) { for (const element of [$('equity'), $('positionEquity')]) timedEffect(element, profitable ? 'impact-profit' : 'impact-loss', 650, ['impact-profit', 'impact-loss']); }
  function burst(text) { $('comboBurst').textContent = text; timedEffect($('comboBurst'), 'show', 1200); }
  function showToast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 1700); }
  function placeOrder(side) {
    if(!state.matchActive||state.gameOver||document.hidden)return;
    activeInput=side;ledger.order(side,state.allocation);syncLedger();ledgerEvents();activeInput=null;
    captureFrame();updateHud();draw();checkGameEnd();
  }
  function closePosition() {
    if(!state.matchActive||state.gameOver||document.hidden)return;
    activeInput='close';ledger.close();syncLedger();ledgerEvents();activeInput=null;
    captureFrame();updateHud();draw();checkGameEnd();
  }
  function setAllocation(value) { if (![10, 25, 50, 100].includes(value)) throw new Error('投入比例必须为 10、25、50 或 100'); state.allocation = value; [...$('allocationSegments').children].forEach(button => { const active = Number(button.dataset.value) === value; button.classList.toggle('active', active); button.setAttribute('aria-checked', String(active)); }); $('allocationValue').textContent = `${value}% · ${money(availableMargin() * value / 100)}`; if (state.current) updateHud(); }

  function checkGameEnd() { if (!state.matchActive || state.gameOver) return; const currentEquity = equity(); if (currentEquity <= 0) finishMatch('bankrupt'); else if (currentEquity >= CONFIG.targetBalance) finishMatch('tenfold'); }
  function finishMatch(reason) {
    if(settled)return;settled=true;
    ledger.finish();syncLedger();ledgerEvents(true);captureFrame();state.gameOver=true;state.matchActive=false;updateHud();
    const finalEquity=Math.max(0,equity()),result=KlineCore.settlement(paidFee,finalEquity,CONFIG.startingBalance);
    state.careerPoints+=result.payout;savePoints();
    $('resultKicker').textContent=state.practice?'免费练习完成':reason==='complete'?'500 根回放完成':reason==='tenfold'?'十倍挑战达成':reason==='dataError'?'数据中断结算':'账户归零';
    $('gameOverTitle').textContent=(result.returnRate>=0?'收益 ':'亏损 ')+Math.abs(result.returnRate*100).toFixed(2)+'%';
    $('gameOverTitle').style.color=result.returnRate>=0?LONG:SHORT;
    $('resultEquity').textContent=money(finalEquity);$('resultEquity').style.color=result.returnRate>=0?LONG:SHORT;
    $('pointsSettlement').style.color=result.netPoints>=0?LONG:SHORT;$('resultScore').textContent=state.score.toLocaleString('en-US');$('resultPatterns').textContent=ledger.rewardCount;
    $('pointsSettlement').textContent=state.practice?'练习不扣除、不获得积分':'入场 −'+paidFee+' PT · 返还 '+result.payout+' PT · 净变动 '+(result.netPoints>=0?'+':'')+result.netPoints+' PT';
    $('resultCycles').textContent=ledger.cycles.length;$('resultStreak').textContent=ledger.bestStreak;
    $('resultFees').textContent=money(ledger.fills.reduce((sum,f)=>sum+f.fee,0));
    $('resultSeed').textContent='区间 '+matchSeed+' · '+state.selected.symbol;
    KlineReview.prepare({frames,cycles:ledger.cycles,fills:ledger.fills,segment:savedSegment,seed:matchSeed});
    $('gameOver').classList.add('show');syncModal();$('rematchButton').focus();playTone(result.returnRate>=0?'long':'short');
  }
  function returnToLobby() { $('gameOver').classList.remove('show'); $('gameOver').setAttribute('aria-hidden', 'true'); $('lobby').classList.add('show'); $('loadStatus').textContent = ''; updatePoints(); syncModal(); }

  $('startMatch').addEventListener('click', () => startMatch());
  $('rematchButton').addEventListener('click', () => startMatch());
  $('practiceButton').addEventListener('click', () => startMatch({practice:true,same:true}));
  $('lobbyPractice').addEventListener('click', () => startMatch({practice:true}));
  $('reviewButton').addEventListener('click', () => { $('reviewPanel').hidden=!$('reviewPanel').hidden; if(!$('reviewPanel').hidden)KlineReview.show(); });
  document.addEventListener('visibilitychange', () => {lastFrame=null;accumulator=0;});
  $('allocationSegments').addEventListener('click', event => { const button = event.target.closest('button'); if (button) setAllocation(Number(button.dataset.value)); });
  function bindTradeButton(id, action) {
    const button = $(id);
    button.addEventListener('pointerdown', event => { if (event.button !== 0 || !event.isPrimary || activeModal()) return; action(); });
    button.addEventListener('click', event => { if (event.detail === 0 && !activeModal()) action(); });
  }
  bindTradeButton('longButton', () => placeOrder('long'));
  bindTradeButton('shortButton', () => placeOrder('short'));
  bindTradeButton('closeButton', closePosition);
  $('restartButton').addEventListener('click', returnToLobby);
  $('motionToggle').addEventListener('click', () => setMotion(!reducedMotion));
  $('lobbyMotion').addEventListener('change', event => setMotion(event.target.checked));
  motionPreference.addEventListener('change', event => { try { if (localStorage.getItem('kline-rush-motion') === null) setMotion(event.matches, false); } catch (_) { setMotion(event.matches, false); } });
  $('allocationSegments').addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const buttons = [...$('allocationSegments').children];
    const index = buttons.indexOf(document.activeElement); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (event.key === 'ArrowRight' ? 1 : 3)) % 4;
    setAllocation(Number(buttons[next].dataset.value)); buttons[next].focus();
  });
  $('soundToggle').addEventListener('click', () => { state.sound = !state.sound; $('soundToggle').setAttribute('aria-pressed', String(state.sound)); showToast(state.sound ? '音效已开启' : '音效已关闭'); });
  document.addEventListener('keydown', event => {
    const modal = activeModal();
    if (modal) {
      if (event.key === 'Tab') {
        const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(element => !element.getClientRects || element.getClientRects().length > 0);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      return;
    }
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.matches('input,textarea,select,[contenteditable=true]')) return;
    if (event.code === 'KeyA') { event.preventDefault(); placeOrder('long'); }
    if (event.code === 'KeyD') { event.preventDefault(); placeOrder('short'); }
    if (event.code === 'Space' && !event.target.closest('button')) { event.preventDefault(); closePosition(); }
  });

  function registerAgentTools() {
    const context = document.modelContext; if (!context?.registerTool) return; const controller = new AbortController(); const register = tool => { try { void Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => {}); } catch (_) {} };
    register({ name: 'set_trade_allocation', title: '设置投入比例', description: '设置本局开仓、加仓或反向减仓比例。', inputSchema: { type: 'object', properties: { percent: { type: 'number', enum: [10, 25, 50, 100] } }, required: ['percent'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) { setAllocation(Number(input?.percent)); return { allocation_percent: state.allocation }; } });
    register({ name: 'place_market_trade', title: '历史回放市价交易', description: '在当前历史K线价格做多或做空。同向加仓，反向减仓。', inputSchema: { type: 'object', properties: { side: { type: 'string', enum: ['long', 'short'] } }, required: ['side'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) { if (!['long', 'short'].includes(input?.side)) throw new Error('方向无效'); placeOrder(input.side); return { side: state.position?.side || null, price: state.price, equity: Number(equity().toFixed(2)) }; } });
    register({ name: 'close_market_position', title: '历史回放平仓', description: '按当前历史K线价格全部平仓。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute() { closePosition(); return { equity: Number(equity().toFixed(2)), score: state.score }; } });
  }

  initLobby(); setMotion(reducedMotion, false); syncModal(); updatePoints(); resize(); registerAgentTools(); window.addEventListener('resize', resize); requestAnimationFrame(frameLoop);
})();
