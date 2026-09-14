/* Online heuristic geometry + explicit candidate/confirmed/invalid lifecycle. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KlinePatterns=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
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
  function detect(input) {
    const bars = input.slice(-48); if (bars.length < 48) return [];
    const found = [];
    const last = bars.at(-1); const { peaks, troughs } = pivots(bars, 2);
    const atr=bars.slice(-20).reduce((sum,b)=>sum+b.high-b.low,0)/20;
    const near=(a,b,tolerance=.018)=>Math.abs(a-b)<=Math.max(last.close*.0002,atr*.6)*(tolerance/.018);
    const lastPeaks = peaks.slice(-3); const lastTroughs = troughs.slice(-3);
    if (lastPeaks.length === 3 && lastPeaks.every(point => near(point.price, lastPeaks[0].price, .018))) {
      const neck = Math.min(...bars.filter(bar => bar.id >= lastPeaks[0].id && bar.id <= lastPeaks[2].id).map(bar => bar.low));
      found.push(buildPattern('三重顶', 'short', '反转', [[...lastPeaks], [{ id: lastPeaks[0].id, price: neck }, { id: last.id, price: neck }]], last.id));
    }
    if (lastTroughs.length === 3 && lastTroughs.every(point => near(point.price, lastTroughs[0].price, .018))) {
      const neck = Math.max(...bars.filter(bar => bar.id >= lastTroughs[0].id && bar.id <= lastTroughs[2].id).map(bar => bar.high));
      found.push(buildPattern('三重底', 'long', '反转', [[...lastTroughs], [{ id: lastTroughs[0].id, price: neck }, { id: last.id, price: neck }]], last.id));
    }
    if (lastPeaks.length === 3 && lastPeaks[1].price > lastPeaks[0].price + atr*.8 && lastPeaks[1].price > lastPeaks[2].price + atr*.8 && near(lastPeaks[0].price, lastPeaks[2].price, .035)) {
      const n1 = lineBetweenRange(bars, lastPeaks[0].id, lastPeaks[1].id, 'low'); const n2 = lineBetweenRange(bars, lastPeaks[1].id, lastPeaks[2].id, 'low');
      found.push(buildPattern('头肩顶', 'short', '反转', [[lastPeaks[0], lastPeaks[1], lastPeaks[2]], [n1, n2]], last.id));
    }
    if (lastTroughs.length === 3 && lastTroughs[1].price < lastTroughs[0].price - atr*.8 && lastTroughs[1].price < lastTroughs[2].price - atr*.8 && near(lastTroughs[0].price, lastTroughs[2].price, .035)) {
      const n1 = lineBetweenRange(bars, lastTroughs[0].id, lastTroughs[1].id, 'high'); const n2 = lineBetweenRange(bars, lastTroughs[1].id, lastTroughs[2].id, 'high');
      found.push(buildPattern('头肩底', 'long', '反转', [[lastTroughs[0], lastTroughs[1], lastTroughs[2]], [n1, n2]], last.id));
    }
    if (lastPeaks.length >= 2) {
      const [a, b] = lastPeaks.slice(-2); const valley = lineBetweenRange(bars, a.id, b.id, 'low');
      if (near(a.price, b.price, .018) && valley && valley.price < Math.min(a.price, b.price) - atr*.8) found.push(buildPattern('双重顶', 'short', '反转', [[a, b], [valley, { id: last.id, price: valley.price }]], last.id));
    }
    if (lastTroughs.length >= 2) {
      const [a, b] = lastTroughs.slice(-2); const peak = lineBetweenRange(bars, a.id, b.id, 'high');
      if (near(a.price, b.price, .018) && peak && peak.price > Math.max(a.price, b.price) + atr*.8) found.push(buildPattern('双重底', 'long', '反转', [[a, b], [peak, { id: last.id, price: peak.price }]], last.id));
    }
    const curve = bars.slice(-36); const left = curve.slice(0, 8).reduce((s, b) => s + b.close, 0) / 8; const middle = curve.slice(14, 22).reduce((s, b) => s + b.close, 0) / 8; const right = curve.slice(-8).reduce((s, b) => s + b.close, 0) / 8;
    const curveLine = curve.filter((_, i) => i % 5 === 0 || i === curve.length - 1).map(bar => ({ id: bar.id, price: bar.close }));
    if (near(left, right, .035) && middle > Math.max(left, right) + atr*1.5) found.push(buildPattern('圆弧顶', 'short', '反转', [curveLine], last.id));
    if (near(left, right, .035) && middle < Math.min(left, right) - atr*1.5) found.push(buildPattern('圆弧底', 'long', '反转', [curveLine], last.id));
    const window = bars.slice(-26); const local = pivots(window, 1); const highReg = regression(local.peaks.map(point => ({ id: point.id, price: point.price }))); const lowReg = regression(local.troughs.map(point => ({ id: point.id, price: point.price })));
    if (highReg && lowReg && local.peaks.length >= 3 && local.troughs.length >= 3) {
      const from = window[0].id; const to = window.at(-1).id; const lines = [[highReg.point(from), highReg.point(to)], [lowReg.point(from), lowReg.point(to)]];
      if (highReg.slope < 0 && lowReg.slope > 0) found.push(buildPattern('对称三角形', bars.at(-8).close <= last.close ? 'long' : 'short', '中继', lines, last.id));
      if (highReg.slope < 0 && lowReg.slope < 0 && highReg.slope < lowReg.slope * 1.18) found.push(buildPattern('下降楔形', 'long', '反转', lines, last.id));
      if (highReg.slope > 0 && lowReg.slope > 0 && lowReg.slope > highReg.slope * 1.18) found.push(buildPattern('上升楔形', 'short', '反转', lines, last.id));
      if (Math.abs(highReg.slope) < Math.abs(lowReg.slope) * .22) found.push(buildPattern('上升三角形', 'long', '持续', lines, last.id));
      if (Math.abs(lowReg.slope) < Math.abs(highReg.slope) * .22) found.push(buildPattern('下降三角形', 'short', '持续', lines, last.id));
    }
    const flag = bars.slice(-22); const impulse = (flag[7].close - flag[0].open) / flag[0].open; const consolidation = flag.slice(8); const consPoints = consolidation.map(bar => ({ id: bar.id, price: bar.close })); const consReg = regression(consPoints); const consRange = Math.max(...consolidation.map(bar => bar.high)) - Math.min(...consolidation.map(bar => bar.low)); const impulseRange = Math.max(...flag.slice(0, 8).map(bar => bar.high)) - Math.min(...flag.slice(0, 8).map(bar => bar.low));
    if (consReg && Math.abs(impulse) > atr / last.close * 2.5 && consRange < impulseRange * .72 && Math.sign(consReg.slope) !== Math.sign(impulse)) {
      const highs = regression(consolidation.map(bar => ({ id: bar.id, price: bar.high }))); const lows = regression(consolidation.map(bar => ({ id: bar.id, price: bar.low }))); const from = consolidation[0].id; const to = last.id;
      found.push(buildPattern(impulse > 0 ? '上升旗形' : '下降旗形', impulse > 0 ? 'long' : 'short', '持续/中继', [[highs.point(from), highs.point(to)], [lows.point(from), lows.point(to)]], last.id));
    }
    const prev = bars.at(-2); const body = bar => Math.abs(bar.close - bar.open); const bullish = bar => bar.close > bar.open;
    if (bullish(last) && !bullish(prev) && last.open <= prev.close && last.close >= prev.open && body(last) > body(prev) * 1.08) found.push(buildPattern('看涨吞没', 'long', '反转', [[{ id: prev.id, price: prev.low }, { id: last.id, price: last.high }]], last.id));
    if (!bullish(last) && bullish(prev) && last.open >= prev.close && last.close <= prev.open && body(last) > body(prev) * 1.08) found.push(buildPattern('看跌吞没', 'short', '反转', [[{ id: prev.id, price: prev.high }, { id: last.id, price: last.low }]], last.id));
    return found;
  }

  function lineValue(line,id) {
    const a=line[0],b=line.at(-1);
    return a.price+(b.price-a.price)*(id-a.id)/Math.max(1,b.id-a.id);
  }
  function bounds(note,id) {
    const all=note.lines.flat();
    if(/旗形|楔形|三角形/.test(note.name))return {upper:lineValue(note.lines[0],id),lower:lineValue(note.lines[1],id),channel:true};
    if(note.lines.length>1) {
      const neck=lineValue(note.lines[1],id);
      return note.side==='long'?{upper:neck,lower:Math.min(...all.map(p=>p.price)),channel:false}:{upper:Math.max(...all.map(p=>p.price)),lower:neck,channel:false};
    }
    const line=note.lines[0];
    if(/圆弧/.test(note.name)) {
      return note.side==='long'?{upper:Math.max(line[0].price,line.at(-1).price),lower:Math.min(...line.map(p=>p.price))}:{upper:Math.max(...line.map(p=>p.price)),lower:Math.min(line[0].price,line.at(-1).price)};
    }
    return {upper:Math.max(...all.map(p=>p.price)),lower:Math.min(...all.map(p=>p.price))};
  }
  class PatternBook {
    constructor(){this.items=[];this.serial=0;this.lastCreated=new Map();}
    add(candidate,tick) {
      if(this.items.some(p=>p.name===candidate.name&&p.status!=='invalid'))return null;
      if(candidate.endId-(this.lastCreated.get(candidate.name)??-999)<16)return null;
      const note={...candidate,id:'pattern-'+(++this.serial),status:'candidate',createdTick:tick,createdCandle:candidate.endId,confirmedTick:null,invalidReason:null};
      this.items.push(note);this.lastCreated.set(note.name,note.endId);return note;
    }
    advance(bars,tick) {
      const last=bars.at(-1),events=[]; if(!last)return events;
      // State changes precede new candidates. A candidate can only confirm on a later observed bar.
      for(const note of this.items) {
        if(note.status==='invalid')continue;
        const edge=bounds(note,last.id),eps=last.close*.001;
        let side=note.side;
        if(note.name==='对称三角形'&&note.status==='candidate')side=last.close>edge.upper+eps?'long':last.close<edge.lower-eps?'short':null;
        const crossed=side==='long'?last.close>edge.upper+eps:side==='short'?last.close<edge.lower-eps:false;
        const broken=side==='long'?last.close<edge.lower-eps:side==='short'?last.close>edge.upper+eps:false;
        const expired=last.id-note.createdCandle>32||(edge.channel&&edge.upper<=edge.lower);
        // A confirmed breakout becomes invalid on a close back through its frozen confirmation line.
        const failed=note.status==='confirmed'&&(note.side==='long'?last.close<note.confirmationPrice-eps:last.close>note.confirmationPrice+eps);
        if(expired||broken||failed){note.status='invalid';note.invalidReason=expired?'超时或收敛结束':failed?'突破失败':'结构破坏';events.push({type:'invalid',note});}
        else if(note.status==='candidate'&&last.id>note.createdCandle&&crossed){
          note.status='confirmed';note.side=side;note.confirmedTick=tick;note.confirmationPrice=side==='long'?edge.upper:edge.lower;events.push({type:'confirmed',note});
        }
      }
      for(const candidate of detect(bars)){const note=this.add(candidate,tick);if(note)events.push({type:'candidate',note});}
      this.items=this.items.filter(p=>p.status!=='invalid'||last.id-p.createdCandle<=48).slice(-48);
      return events;
    }
    visible(){return this.items.slice(-8);}
  }
  return {PatternBook,detect,bounds};
});
