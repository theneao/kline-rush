(function(root,factory){root.KlineData=factory();})(globalThis,function(){
'use strict';
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
    try { data = await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=60d&interval=5m&events=history`); }
    catch (_) { data = await fetchWithTimeout(`https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=60d&interval=5m&events=history`); }
    const result = data?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    if (!result?.timestamp || !quote) throw new Error('历史行情格式无效');
    return cleanBars(result.timestamp.map((time, i) => ({ time: new Date(time * 1000).toISOString(), open: quote.open[i], high: quote.high[i], low: quote.low[i], close: quote.close[i], volume: quote.volume[i] })));
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
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${instrument.secid}&klt=5&fqt=1&lmt=5000&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=${fields}`;
    const data = await fetchJsonp(url);
    const rows = data?.data?.klines;
    if (!Array.isArray(rows)) throw new Error('A股历史行情格式无效');
    return cleanBars(rows.map(row => { const [time, open, close, high, low, volume] = row.split(','); return { time:time.replace(' ', 'T')+'+08:00', open, high, low, close, volume }; }));
  }

  async function load(instrument) {
    let bars,stepMs,count,source;
    if(instrument.provider==='binance') {
      let rows=globalThis.KLINE_RUSH_MICRO_HISTORY?.symbols?.[instrument.symbol];
      if(!rows) {
        rows=[];let end=Date.now()-60000;
        for(let page=0;page<4;page++){
          const path='/api/v3/klines?symbol='+encodeURIComponent(instrument.symbol)+'&interval=1m&limit=1000&endTime='+end;
          let batch;try{batch=await fetchWithTimeout('https://api.binance.com'+path);}catch(_){batch=await fetchWithTimeout('https://data-api.binance.vision'+path);}
          if(!Array.isArray(batch)||!batch.length)throw Error('分钟行情不足');
          rows=[...batch,...rows];end=Number(batch[0][0])-1;
        }
      }
      bars=rows.map(r=>({time:r[0],open:r[1],high:r[2],low:r[3],close:r[4],volume:r[5]}));
      stepMs=60000;count=5;source='Binance 1分钟历史 → 5分钟回放';
    } else {
      bars=instrument.provider==='eastmoney'?await fetchEastmoney(instrument):await fetchYahoo(instrument);
      stepMs=300000;count=3;source=(instrument.provider==='eastmoney'?'东方财富':'Yahoo Finance')+' 5分钟历史 → 15分钟回放';
    }
    const groups=globalThis.KlineReplay.groupBars(bars,stepMs,count);
    if(groups.length<560)throw Error('可用完整细粒度 K 线只有 '+groups.length+' 根，需要 560 根；请更换标的');
    return {groups,source,stepMs,count,maxGapMs:instrument.provider==='binance'?stepMs*count:7*86400000};
  }
  return {load};
});
