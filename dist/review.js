/* Read-only review renderer: it cannot submit commands or settle a match. */
(function(root) {
  'use strict';
  let record=null;
  const $=id=>document.getElementById(id);
  function cash(n){return (n<0?'-':'')+'$'+Math.abs(n).toFixed(2);}
  function prepare(data) {
    record=data;
    const slider=$('reviewSlider');slider.max=Math.max(0,data.frames.length-1);slider.value=slider.max;
    const list=$('reviewTrades');list.replaceChildren();
    if(!data.fills.length){const empty=document.createElement('p');empty.textContent='本局没有交易，可拖动时间轴查看行情。';list.appendChild(empty);}
    for(const cycle of data.cycles) {
      const row=document.createElement('button');row.type='button';
      const profit=cycle.netPnl>0;
      row.textContent='#'+cycle.id+' '+(cycle.side==='long'?'多单':'空单')+' · 净盈亏 '+cash(cycle.netPnl)+' · 手续费 '+cash(cycle.fees)+(cycle.reward?' · 奖励 +'+cycle.reward:'');
      row.className=profit?'review-profit':'review-loss';
      row.addEventListener('click',()=>selectFill(cycle.fills.at(-1)));
      list.appendChild(row);
    }
    const best=[...data.cycles].sort((a,b)=>b.netPnl-a.netPnl)[0];
    const worst=[...data.cycles].sort((a,b)=>a.netPnl-b.netPnl)[0];
    $('reviewSummary').textContent='完整周期 '+data.cycles.length+' 笔'+(best?' · 最佳 #'+best.id+' '+cash(best.netPnl)+' · 最差 #'+worst.id+' '+cash(worst.netPnl):'');
    const fills=$('reviewFillSelect');fills.replaceChildren();
    const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='跳转到某次开仓 / 加仓 / 减仓';fills.appendChild(placeholder);
    for(const fill of data.fills) {
      const option=document.createElement('option');option.value=fill.id;
      option.textContent='#'+fill.id+' '+({open:'开仓',add:'加仓',reduce:'减仓 / 平仓'}[fill.action])+' @ '+fill.price.toFixed(2)+' · 费 '+cash(fill.fee);fills.appendChild(option);
    }
    slider.oninput=show;fills.onchange=()=>selectFill(Number(fills.value));
  }
  function selectFill(id) {
    if(!id||!record)return;
    const i=record.frames.findIndex(f=>f.fillCount>=id);
    if(i>=0){$('reviewSlider').value=i;show();}
  }
  function show() {
    if(!record?.frames.length)return;
    const index=Math.max(0,Math.min(record.frames.length-1,Number($('reviewSlider').value)));
    const frame=record.frames[index],lastId=frame.bar.id;
    const bars=record.segment.slice(Math.max(0,lastId-45),lastId).map((b,i)=>({...b,id:Math.max(0,lastId-45)+i}));
    bars.push(frame.bar);
    const canvas=$('reviewCanvas'),ctx=canvas.getContext('2d'),rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
    const width=Math.max(280,rect.width),height=220;canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const values=bars.flatMap(b=>[b.high,b.low]);if(frame.position)values.push(frame.position.avgPrice);
    const min=Math.min(...values),max=Math.max(...values),pad=Math.max(.01,(max-min)*.1);
    const y=p=>12+(max+pad-p)/(max-min+pad*2)*(height-24),slot=width/(bars.length+2);
    if(frame.position) {
      ctx.fillStyle=frame.pnl>=0?'#00f5d420':'#ff2d7820';const a=y(frame.position.avgPrice),b=y(frame.price);ctx.fillRect(0,Math.min(a,b),width,Math.max(2,Math.abs(a-b)));
      ctx.strokeStyle='#ffe44d';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(0,a);ctx.lineTo(width,a);ctx.stroke();ctx.setLineDash([]);
    }
    bars.forEach((b,i)=>{const x=(i+1)*slot;ctx.fillStyle=ctx.strokeStyle=b.close>=b.open?'#00f5d4':'#ff2d78';ctx.beginPath();ctx.moveTo(x,y(b.high));ctx.lineTo(x,y(b.low));ctx.stroke();ctx.fillRect(x-slot*.28,Math.min(y(b.open),y(b.close)),slot*.56,Math.max(2,Math.abs(y(b.open)-y(b.close))));});
    for(const fill of record.fills.filter(f=>f.id<=frame.fillCount)) {
      const i=bars.findIndex(b=>b.id===fill.candleId);if(i<0)continue;
      const x=(i+1)*slot,py=y(fill.price);ctx.fillStyle=fill.action==='reduce'?'#ffe44d':fill.side==='long'?'#00f5d4':'#ff2d78';
      ctx.font='bold 11px system-ui';ctx.fillText(fill.action==='reduce'?'−':'+',x-4,py-8);
    }
    $('reviewDetail').textContent='步骤 '+frame.tick+' · 已成交 '+frame.fillCount+' 次 · 账户 '+cash(frame.equity)+' · 浮盈亏 '+cash(frame.pnl)+' · '+(frame.position?(frame.position.side==='long'?'多单':'空单')+'均价 '+frame.position.avgPrice.toFixed(2):'空仓');
  }
  root.KlineReview={prepare,show};
})(globalThis);
