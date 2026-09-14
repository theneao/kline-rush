/* Reveals completed lower-timeframe observations; never synthesizes an OHLC path. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KlineReplay=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function validate(bars, stepMs) {
    if(!Array.isArray(bars)||!bars.length)throw Error('缺少细粒度历史行情');
    let previous=-Infinity;
    return bars.map(bar=>{
      const b={time:Number(new Date(bar.time)),open:Number(bar.open),high:Number(bar.high),low:Number(bar.low),close:Number(bar.close),volume:Number(bar.volume)||0};
      if(![b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.time<=previous)throw Error('细粒度行情顺序或价格无效');
      previous=b.time;return b;
    });
  }
  function groupBars(input, stepMs, count=5) {
    const bars=validate(input,stepMs), buckets=new Map(), width=stepMs*count;
    for(const b of bars) {const key=Math.floor(b.time/width)*width; if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(b);}
    const groups=[];
    for(const [time,steps] of buckets) {
      if(steps.length!==count||steps[0].time!==time||steps.some((b,i)=>b.time!==time+i*stepMs))continue;
      groups.push({time:new Date(time).toISOString(),open:steps[0].open,high:Math.max(...steps.map(b=>b.high)),low:Math.min(...steps.map(b=>b.low)),close:steps.at(-1).close,steps});
    }
    return groups;
  }
  function seedRandom(seed) {let n=seed>>>0;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
  function selectSegment(groups,seed,warmup=60,length=500,maxGapMs=Infinity) {
    const needed=warmup+length,starts=[];let run=0;
    for(let i=0;i<groups.length;i++){run=i&&new Date(groups[i].time)-new Date(groups[i-1].time)>maxGapMs?1:run+1;if(run>=needed)starts.push(i-needed+1);}
    if(!starts.length)throw Error('细粒度数据不足或有缺口，需要完整的 60 + 500 根');
    const start=starts[Math.floor(seedRandom(seed)()*starts.length)];
    return groups.slice(start,start+needed);
  }
  function begin(group,id) { return {time:group.time,id,open:group.open,high:group.open,low:group.open,close:group.open,volume:0}; }
  function reveal(current, step) {
    current.close=step.close;current.high=Math.max(current.high,step.high);current.low=Math.min(current.low,step.low);current.volume+=step.volume;
    return current;
  }
  return {validate,groupBars,selectSegment,seedRandom,begin,reveal};
});
