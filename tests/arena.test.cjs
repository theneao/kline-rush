const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function game() {
  const elements = new Map();
  const timeouts = new Map(); let timer = 0;
  class Element {
    constructor(id = '') { this.id = id; this.dataset = {}; this.children = []; this.listeners = {}; this.attributes = {}; this.style = {}; this.className = ''; this.clientWidth = 1000; this.clientHeight = 400; this.classList = { contains: c => this.className.split(' ').includes(c), add: (...cs) => { this.className = [...new Set([...this.className.split(' '), ...cs])].join(' '); }, remove: (...cs) => { this.className = this.className.split(' ').filter(c => !cs.includes(c)).join(' '); }, toggle: (c, force) => { const value = force ?? !this.classList.contains(c); value ? this.classList.add(c) : this.classList.remove(c); return value; } }; }
    setAttribute(k,v) { this.attributes[k] = v; }
    addEventListener(k,fn) { (this.listeners[k] ||= []).push(fn); }
    fire(k,event = {}) { (this.listeners[k] || []).forEach(fn => fn({ button:0, isPrimary:true, detail:1, target:this, ...event })); }
    querySelector() { return this.child ||= new Element(); }
    querySelectorAll() { return this.children; }
    matches() { return false; }
    closest(selector) { return selector === 'button' && /Button$/.test(this.id) ? this : null; }
    focus() { document.activeElement = this; }
    appendChild(child) { child.parent = this; this.children.push(child); }
    get firstElementChild() { return this.children[0]; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
    getBoundingClientRect() { return { width:1000,height:400 }; }
    getContext() { return new Proxy({}, { get: (_,k) => k === 'createLinearGradient' ? () => ({addColorStop(){}}) : k === 'measureText' ? () => ({width:80}) : () => {} }); }
  }
  const get = id => { if (!elements.has(id)) elements.set(id,new Element(id)); return elements.get(id); };
  const document = { getElementById:get, documentElement:new Element(), createElement:() => new Element(), querySelectorAll:() => ['hud','stage','controls','status-rail'].map(get), listeners:{}, addEventListener(k,fn){this.listeners[k]=fn;} };
  get('lobby').classList.add('show');
  get('allocationSegments').children = [10,25,50,100].map(value => { const e = new Element(); e.dataset.value=String(value); return e; });
  const storage = new Map();
  const window = { addEventListener(){}, devicePixelRatio:1, matchMedia:() => ({matches:false,addEventListener(){}}) };
  const context = vm.createContext({document, window, navigator:{}, localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}, performance:{now:()=>1000}, setTimeout:fn=>{timeouts.set(++timer,fn);return timer;},clearTimeout:id=>timeouts.delete(id),setInterval(){},AbortController,console});
  let source = fs.readFileSync('dist/app.js','utf8');
  source = source.replace('  initLobby();', '  window.testApi = {state, CONFIG, initializeReplay, placeOrder, closePosition, setAllocation, equity, availableMargin, showPattern, beginMarketEvent, setMotion, advanceReplay, syncModal};\n  initLobby();');
  vm.runInContext(source,context);
  const api=window.testApi;
  const bars = Array.from({length:560},(_,i)=>({time:new Date(2020,0,i+1).toISOString(),open:100,high:110,low:90,close:105}));
  api.initializeReplay(bars); get('lobby').classList.remove('show'); api.syncModal();
  return { ...api,get,document,timeouts,storage };
}
test('single position: opening, weighted add, opposite reduces, full close', () => {
  const g=game(); g.placeOrder('long'); assert.equal(g.state.position.qty,30); assert.equal(g.state.position.margin,1000); assert.equal(g.state.walletBalance,9998.5);
  g.state.price=110; const previous=g.state.position.qty; g.placeOrder('long'); assert.ok(g.state.position.avgPrice>100 && g.state.position.avgPrice<110); const quantity=g.state.position.qty; assert.ok(quantity>previous);
  g.placeOrder('short'); assert.equal(g.state.position.side,'long'); assert.ok(Math.abs(g.state.position.qty-quantity*.9)<1e-8); g.closePosition(); assert.equal(g.state.position,null);
});
test('MAX reserves fees, rejects adding below minimum without phantom trade', () => {
  const g=game(); g.setAllocation(100); g.placeOrder('short'); assert.ok(g.availableMargin()<1e-8); assert.ok(g.state.walletBalance+1e-8>=g.state.position.margin); const n=g.state.trades.length; g.placeOrder('short'); assert.equal(g.state.trades.length,n);
});
test('pattern and market effects never operate or flash trade buttons', () => {
  const g=game(); g.placeOrder('long'); g.get('longButton').classList.remove('hit'); const quantity=g.state.position.qty, n=g.state.trades.length;
  g.showPattern({name:'测试旗形',side:'long',category:'持续',endId:60,lines:[]}); g.beginMarketEvent(1,'动能');
  assert.equal(g.state.position.qty,quantity); assert.equal(g.state.trades.length,n); assert.equal(g.get('longButton').classList.contains('hit'),false); assert.equal(g.get('shortButton').classList.contains('hit'),false); assert.ok(g.state.bonusScore>0); assert.ok(g.get('equity').classList.contains('impact-profit'));
});
test('pointer + synthetic click creates one order; right click ignored; accessible click works', () => {
  const g=game(); const b=g.get('longButton'); b.fire('pointerdown'); b.fire('click'); assert.equal(g.state.trades.length,1); b.fire('pointerdown',{button:2}); assert.equal(g.state.trades.length,1); b.fire('click',{detail:0}); assert.equal(g.state.trades.length,2);
});
test('low motion stays readable and caps rapid feedback; disabled effects do not pause replay', () => {
  const g=game(); g.setMotion(true); for(let i=0;i<12;i++) g.placeOrder('long'); assert.ok(g.get('floatingLayer').children.length<=5); g.beginMarketEvent(1,'动能'); g.advanceReplay(); assert.equal(g.state.particles.length,0); assert.equal(g.state.tickInCandle,1); assert.equal(g.storage.get('kline-rush-motion'),'reduced'); assert.ok(g.get('comboBurst').textContent.includes('RUSH'));
});
test('modal isolates controls; keyboard repeats and focused button space cannot double trade', () => {
  const g=game(); const event={repeat:false,code:'KeyA',target:g.get('chartWrap'),preventDefault(){}}; g.document.listeners.keydown(event); assert.equal(g.state.trades.length,1); g.document.listeners.keydown({...event,repeat:true}); assert.equal(g.state.trades.length,1);
  g.get('lobby').classList.add('show'); g.syncModal(); assert.equal(g.get('controls').inert,true); g.document.listeners.keydown(event); g.get('longButton').fire('pointerdown'); assert.equal(g.state.trades.length,1);
});
test('all 500 replay candles settle once', () => {
  const g=game(); for(let i=0;i<3000;i++) g.advanceReplay(); assert.equal(g.state.replayIndex,500); assert.equal(g.state.matchActive,false); assert.equal(g.state.gameOver,true); const points=g.state.careerPoints; g.advanceReplay(); assert.equal(g.state.careerPoints,points);
});
