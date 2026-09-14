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
    replaceChildren(...children) { this.children=children; }
    get firstElementChild() { return this.children[0]; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
    getBoundingClientRect() { return { width:1000,height:400 }; }
    getContext() { return new Proxy({}, { get: (_,k) => k === 'createLinearGradient' ? () => ({addColorStop(){}}) : k === 'measureText' ? () => ({width:80}) : () => {} }); }
  }
  const get = id => { if (!elements.has(id)) elements.set(id,new Element(id)); return elements.get(id); };
  const document = { hidden:false, getElementById:get, documentElement:new Element(), createElement:() => new Element(), querySelectorAll:() => ['hud','stage','controls','status-rail'].map(get), listeners:{}, addEventListener(k,fn){this.listeners[k]=fn;} };
  get('lobby').classList.add('show');
  get('allocationSegments').children = [10,25,50,100].map(value => { const e = new Element(); e.dataset.value=String(value); return e; });
  const storage = new Map();
  const window = { addEventListener(){}, devicePixelRatio:1, matchMedia:() => ({matches:false,addEventListener(){}}) };
  const context = vm.createContext({document, window, navigator:{}, localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}, performance:{now:()=>1000}, setTimeout:fn=>{timeouts.set(++timer,fn);return timer;},clearTimeout:id=>timeouts.delete(id),setInterval(){}, requestAnimationFrame(){}, crypto:{getRandomValues:a=>{a[0]=42;}}, devicePixelRatio:1, AbortController,console});
  for(const file of ['dist/core/ledger.js','dist/core/replay.js','dist/core/patterns.js','dist/core/data.js','dist/review.js']) vm.runInContext(fs.readFileSync(file,'utf8'),context);
  let source = fs.readFileSync('dist/app.js','utf8');
  source = source.replace('  initLobby();', '  window.testApi = {state, CONFIG, initializeReplay, placeOrder, closePosition, setAllocation, equity, availableMargin, showPattern, beginMarketEvent, setMotion, advanceReplay, syncModal, finishMatch, get ledger(){return ledger;}, get frames(){return frames;}, mark(price){state.price=price;ledger.mark(price,++gameTick,state.candleId);syncLedger();}};\n  initLobby();');
  vm.runInContext(source,context);
  const api=window.testApi;
  const bars = Array.from({length:560},(_,i)=>({time:new Date(2020,0,i+1).toISOString(),open:100,high:110,low:90,close:105,steps:Array.from({length:5},()=>({open:100,high:110,low:90,close:105,volume:1}))}));
  api.initializeReplay(bars); get('lobby').classList.remove('show'); api.syncModal();
  return { ...api,get,document,timeouts,storage };
}

test('pattern and market feedback never changes quantity or flashes buttons',()=>{
  const g=game();g.placeOrder('long');g.get('longButton').classList.remove('hit');
  const qty=g.state.position.qty,n=g.state.trades.length;
  g.showPattern({type:'confirmed',note:{id:'test',name:'旗形',side:'long',status:'confirmed'}});
  g.beginMarketEvent(1,'动能');
  assert.equal(g.state.position.qty,qty);assert.equal(g.state.trades.length,n);assert.equal(g.state.bonusScore,0);
  assert.equal(g.get('longButton').classList.contains('hit'),false);assert.equal(g.get('shortButton').classList.contains('hit'),false);
});
test('primary pointer and accessible clicks each execute once',()=>{
  const g=game(),b=g.get('longButton');b.fire('pointerdown');b.fire('click');assert.equal(g.state.trades.length,1);
  b.fire('pointerdown',{button:2});assert.equal(g.state.trades.length,1);b.fire('click',{detail:0});assert.equal(g.state.trades.length,2);
});
test('modal and hidden-tab inputs are gated, repeated keys ignored',()=>{
  const g=game(),event={repeat:false,code:'KeyA',target:g.get('chartWrap'),preventDefault(){}};
  g.document.listeners.keydown(event);assert.equal(g.state.trades.length,1);
  g.document.listeners.keydown({...event,repeat:true});assert.equal(g.state.trades.length,1);
  g.document.hidden=true;g.placeOrder('short');assert.equal(g.state.trades.length,1);g.document.hidden=false;
  g.get('lobby').classList.add('show');g.syncModal();assert.equal(g.get('controls').inert,true);
  g.document.listeners.keydown(event);g.get('longButton').fire('pointerdown');assert.equal(g.state.trades.length,1);
});
test('low-motion effects do not block lower-timeframe observations',()=>{
  const g=game();g.setMotion(true);for(let i=0;i<12;i++)g.placeOrder('long');
  assert.ok(g.get('floatingLayer').children.length<=5);g.beginMarketEvent(1,'动能');g.advanceReplay();
  assert.equal(g.state.particles.length,0);assert.equal(g.state.tickInCandle,1);assert.equal(g.state.price,105);assert.equal(g.state.bonusScore,0);
});
test('500 bars settle once and populate complete review with no phantom cycles',()=>{
  const g=game();g.placeOrder('long');
  for(let i=0;i<2500;i++)g.advanceReplay();
  assert.equal(g.state.replayIndex,500);assert.equal(g.state.gameOver,true);assert.equal(g.state.position,null);
  assert.equal(g.get('resultCycles').textContent,1);
  assert.ok(g.get('reviewTrades').children.length>0);
  const points=g.state.careerPoints;g.finishMatch('complete');g.advanceReplay();assert.equal(g.state.careerPoints,points);
});
test('zero-equity observation settles before candle advances',()=>{
  const g=game();g.setAllocation(100);g.placeOrder('long');
  g.state.target.steps[0]={open:100,high:100,low:50,close:50,volume:1};
  g.advanceReplay();assert.equal(g.state.gameOver,true);assert.equal(g.state.replayIndex,0);assert.equal(g.state.position,null);
});
