/* Pure trading ledger. No DOM, clock, random generator or rendering dependencies. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KlineCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const money = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const qtyRound = n => Math.floor((n + Number.EPSILON) * 1e8) / 1e8;
  const sign = side => side === 'long' ? 1 : -1;
  const DEFAULTS = Object.freeze({ startingBalance:10000, targetBalance:100000, leverage:3, feeRate:.0005, minMargin:10, signalWindow:15, minSignalMargin:100 });
  class Ledger {
    constructor(config = {}) {
      this.config = {...DEFAULTS,...config};
      this.wallet = this.config.startingBalance; this.realized = 0;
      this.price = 0; this.tick = 0; this.candleId = 0; this.position = null;
      this.cycle = null; this.cycles = []; this.fills = []; this.commands = []; this.events = [];
      this.signals = new Map(); this.claimed = new Set(); this.streak = 0; this.bestStreak = 0;
      this.bonus = 0; this.rewardCount = 0; this.finished = false; this.seq = 0;
    }
    pnl() { return this.position ? money((this.price-this.position.avgPrice)*this.position.qty*sign(this.position.side)) : 0; }
    equity() { return money(this.wallet+this.pnl()); }
    available() { return Math.max(0,money(this.equity()-(this.position?.margin||0))); }
    score() { return Math.round((Math.max(0,this.equity())-this.config.startingBalance)*10+this.bonus); }
    quote(percent) { return Math.floor(Math.min(this.available()*percent/100,this.available()/(1+this.config.leverage*this.config.feeRate))*100)/100; }
    emit(type, data={}) { this.events.push({type,tick:this.tick,...data}); }
    drain() { return this.events.splice(0); }
    mark(price, tick, candleId) {
      if (!Number.isFinite(price)||price<=0||!Number.isInteger(tick)||tick<this.tick) throw Error('Invalid market observation');
      if (this.finished) return;
      this.price=price; this.tick=tick; this.candleId=candleId;
    }
    registerSignal(signal) {
      if (!signal?.id || !['long','short'].includes(signal.side) || signal.status!=='confirmed') return;
      if (!this.signals.has(signal.id)) this.signals.set(signal.id,{...signal,confirmedTick:this.tick});
    }
    invalidateSignal(id) { const s=this.signals.get(id); if(s)s.status='invalid'; }
    order(side, percent) {
      const command={seq:++this.seq,tick:this.tick,candleId:this.candleId,side,percent};
      this.commands.push(command);
      if(this.finished||!this.price||!['long','short'].includes(side)||![10,25,50,100].includes(percent)) return this.reject('交易状态或比例无效');
      return this.position&&this.position.side!==side ? this.reduce(percent/100) : this.add(side,percent);
    }
    reject(reason) { this.emit('OrderRejected',{reason}); return {ok:false,reason}; }
    add(side,percent) {
      let margin=this.quote(percent);
      if(margin<this.config.minMargin)return this.reject('可用保证金不足');
      const qty=qtyRound(margin*this.config.leverage/this.price);
      if(qty<=0)return this.reject('下单数量过小');
      margin=money(qty*this.price/this.config.leverage);
      const fee=money(qty*this.price*this.config.feeRate);
      if(margin+fee>this.available()+.001)return this.reject('保证金与手续费不足');
      const opening=!this.position;
      if(opening) {
        this.position={side,qty:0,avgPrice:0,margin:0,startCandleId:this.candleId,lots:[]};
        this.cycle={id:this.cycles.length+1,side,startTick:this.tick,startCandleId:this.candleId,startWallet:this.wallet,fees:0,claims:{},fills:[]};
      }
      const p=this.position;
      const eligible=[...this.signals.values()].filter(s=>s.side===side&&s.status==='confirmed'&&this.tick>=s.confirmedTick&&this.tick-s.confirmedTick<=this.config.signalWindow&&!this.claimed.has(s.id));
      const signal=margin>=this.config.minSignalMargin ? eligible.at(-1) : null;
      if(signal) { this.claimed.add(signal.id); this.cycle.claims[signal.id]={id:signal.id,name:signal.name,net:0,executionTick:this.tick,confirmedTick:signal.confirmedTick}; }
      const nextQty=p.qty+qty;
      p.avgPrice=(p.avgPrice*p.qty+this.price*qty)/nextQty;
      p.qty=nextQty; p.margin=money(p.margin+margin);
      p.lots.push({qty,entry:this.price,openFee:fee,signalId:signal?.id||null});
      this.wallet=money(this.wallet-fee); this.realized=money(this.realized-fee); this.cycle.fees=money(this.cycle.fees+fee);
      const fill=this.record({action:opening?'open':'add',side,qty,price:this.price,fee,netPnl:-fee,signalId:signal?.id||null});
      this.emit('TradeFilled',{fill}); return {ok:true,fill};
    }
    reduce(fraction) {
      if(!this.position)return this.reject('当前没有持仓');
      if(!Number.isFinite(fraction)||fraction<=0||fraction>1)return this.reject('减仓比例无效');
      const p=this.position, closed=fraction===1, qty=closed?p.qty:p.qty*fraction;
      const gross=money((this.price-p.avgPrice)*qty*sign(p.side)), fee=money(qty*this.price*this.config.feeRate);
      const net=money(gross-fee);
      for(const lot of p.lots) {
        const part=lot.qty*fraction;
        if(lot.signalId) {
          const claim=this.cycle.claims[lot.signalId];
          claim.net+=(this.price-lot.entry)*part*sign(p.side)-lot.openFee*fraction-fee*(part/qty);
        }
        lot.qty-=part; lot.openFee*=1-fraction;
      }
      this.wallet=money(this.wallet+net); this.realized=money(this.realized+net); this.cycle.fees=money(this.cycle.fees+fee);
      p.qty-=qty; p.margin=money(p.margin*(1-fraction));
      const fill=this.record({action:'reduce',side:p.side,qty,price:this.price,fee,netPnl:net});
      this.emit('TradeFilled',{fill});
      if(closed) {
        const cycle={...this.cycle,endTick:this.tick,endCandleId:this.candleId,netPnl:money(this.wallet-this.cycle.startWallet),reward:0};
        this.position=null;
        this.streak=cycle.netPnl>0?this.streak+1:0; this.bestStreak=Math.max(this.bestStreak,this.streak);
        const validClaims=Object.values(cycle.claims).filter(c=>c.net>0&&this.signals.get(c.id)?.status==='confirmed');
        if(cycle.netPnl>0&&validClaims.length) {
          const attributable=Math.min(cycle.netPnl,validClaims.reduce((sum,c)=>sum+c.net,0));
          cycle.reward=Math.min(600*Math.min(5,this.streak),Math.floor(attributable*10*.2));
          if(cycle.reward>0) {this.bonus+=cycle.reward;this.rewardCount+=1;this.emit('SignalProfitReward',{amount:cycle.reward,cycleId:cycle.id});}
        }
        this.cycles.push(cycle);this.cycle=null;this.emit('CycleClosed',{cycle,streak:this.streak});
      }
      return {ok:true,fill};
    }
    close() {
      this.commands.push({seq:++this.seq,tick:this.tick,candleId:this.candleId,action:'close'});
      if(this.finished)return this.reject('比赛已结束');
      return this.reduce(1);
    }
    record(fill) {
      const item={...fill,id:this.fills.length+1,tick:this.tick,candleId:this.candleId,equity:this.equity(),wallet:this.wallet,cycleId:this.cycle.id};
      this.fills.push(item);this.cycle.fills.push(item.id);return item;
    }
    finish() { if(this.finished)return; if(this.position)this.reduce(1);this.finished=true; }
    snapshot() {
      return {wallet:this.wallet,realized:this.realized,price:this.price,position:this.position?{...this.position,lots:undefined}:null,
        equity:this.equity(),available:this.available(),pnl:this.pnl(),score:this.score(),streak:this.streak,bonus:this.bonus};
    }
  }
  function settlement(entryFee, finalEquity, startingBalance) {
    if(![entryFee,finalEquity,startingBalance].every(Number.isFinite)||entryFee<0||startingBalance<=0)throw Error('Invalid settlement');
    const payout=Math.max(0,Math.round(entryFee*Math.max(0,finalEquity)/startingBalance));
    return {payout,netPoints:payout-entryFee,returnRate:Math.max(0,finalEquity)/startingBalance-1};
  }
  return {Ledger,settlement,money,DEFAULTS};
});
