import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInput,sortRoute,calculateCost,storesFromOSM,coordinateInput,shortlistStores} from '../site/core.mjs';

test('messy markdown, duplicate counts, completed items, fractions and product links',()=>{
  const items=parseInput('# Groceries\n- [ ] 2 milk, bread; milk x3\n- [x] coffee\n1. 1/2 kg apples\n# Books\n[Some Unknown Title](https://www.barnesandnoble.com/w/example/123)');
  assert.equal(items.length,4);assert.equal(items[0].quantity,5);assert.equal(items[2].quantity,.5);assert.equal(items[2].unit,'kg');assert.equal(items[3].category,'books');assert.equal(items[3].productUrl,'https://www.barnesandnoble.com/w/example/123');
});
test('numeric product attributes do not become quantities without a separator',()=>{
  const items=parseInput('2% milk\n3x basketball\n"1984" book');assert.equal(items[0].quantity,1);assert.equal(items[0].name,'2% milk');assert.equal(items[1].quantity,3);assert.equal(items[2].quantity,1);
});
test('unknown items stay unknown and list limits are enforced',()=>{assert.equal(parseInput('quantum teapot')[0].category,null);assert.throws(()=>parseInput('0 milk'));assert.throws(()=>parseInput(Array.from({length:41},(_,i)=>`item-${i}`).join('\n')));});
test('coordinates validate latitude and longitude',()=>{assert.equal(coordinateInput('40.4, -80.1').lat,40.4);assert.throws(()=>coordinateInput('99, 10'));assert.equal(coordinateInput('100 Main Street'),null);});
test('OSM keeps true coordinates, missing addresses and merged multi-category stores',()=>{
  const s=storesFromOSM({elements:[{type:'node',id:1,lat:40,lon:-80,tags:{name:'Giant Eagle',shop:'supermarket'}},{type:'way',id:2,center:{lat:40.01,lon:-80},tags:{name:'The Home Depot',shop:'doityourself','addr:housenumber':'25','addr:street':'Main Street'}}]},{lat:40,lon:-80});
  assert.equal(s[0].addressComplete,false);assert.match(s[0].address,/not supplied/);assert.deepEqual(s[1].categories,['hardware','home']);assert.equal(s[1].address,'25 Main Street');assert.equal(shortlistStores(s,['home']).length,1);
});
test('route jointly chooses stores and sequence on a directed matrix',()=>{
  const stores=[{id:'g',categories:['groceries']},{id:'p',categories:['pharmacy']},{id:'both',categories:['groceries','pharmacy']}];
  const matrix=[[0,2,9,4],[2,0,8,5],[9,8,0,4],[4,5,4,0]];
  assert.deepEqual(sortRoute(stores,matrix,['groceries','pharmacy']).stops.map(s=>s.id),['both']);
  const directed=[[0,1,5],[9,0,1],[1,9,0]];
  assert.deepEqual(sortRoute(stores.slice(0,2),directed,['groceries','pharmacy'],true).stops.map(s=>s.id),['g','p']);
  assert.equal(sortRoute(stores.slice(0,2),directed,['groceries','pharmacy'],true).duration,3);
});
test('null legs are unreachable; uncovered categories are explicit',()=>{
  const s=[{id:'a',categories:['groceries']}];assert.equal(sortRoute(s,[[0,null],[1,0]],['groceries']).unreachable,true);
  const route=sortRoute(s,[[0,1],[1,0]],['groceries','books']);assert.deepEqual(route.missing,['books']);assert.equal(route.stops.length,1);
});
test('exact optimizer agrees with exhaustive search for directed shortest-path metrics',()=>{
  for(let seed=1;seed<=10;seed++){
    let x=seed;const random=()=>{x=(x*1664525+1013904223)>>>0;return x;};
    const n=6, matrix=Array.from({length:n+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===j?0:1+random()%20));
    for(let k=0;k<=n;k++)for(let i=0;i<=n;i++)for(let j=0;j<=n;j++)matrix[i][j]=Math.min(matrix[i][j],matrix[i][k]+matrix[k][j]);
    const cats=['groceries','books','home'],stores=Array.from({length:n},(_,i)=>({id:String(i),categories:i===5?['books','home']:[cats[i%3]]}));
    for(const round of [false,true]){
      let best=Infinity;
      function search(path,covered,cost){if(covered.size===3){best=Math.min(best,cost+(round?matrix[path.at(-1)+1][0]:0));return;}for(let j=0;j<n;j++)if(!path.includes(j)){const next=new Set([...covered,...stores[j].categories]);search([...path,j],next,cost+matrix[path.length?path.at(-1)+1:0][j+1]);}}
      search([],new Set(),0);assert.equal(sortRoute(stores,matrix,cats,round).duration,best);
    }
  }
});
const items=[{id:'a',quantity:2,unit:'item',category:'groceries'},{id:'b',quantity:3,unit:'lb',category:'groceries'},{id:'c',quantity:1,unit:'item',category:'sports'}];
const quotes={a:{candidate:{price:3.25,currency:'USD',eligible:true}},b:{candidate:{price:6,currency:'USD',eligible:true}},c:{candidate:{price:20,currency:'EUR',eligible:true}}};
test('cost does not invent unit conversions, FX or missing tax rates',()=>{
  const t=calculateCost(items,quotes);assert.equal(t.subtotalCents,650);assert.equal(t.priced,1);assert.equal(t.unpriced,2);assert.equal(t.taxUnknown,1);assert.equal(t.complete,false);
});
test('manual unit budgets, explicit zero tax, exclusions and cent rounding',()=>{
  const t=calculateCost(items,quotes,{b:2,c:0},{groceries:0,other:7});assert.equal(t.subtotalCents,1250);assert.equal(t.taxCents,0);assert.equal(t.complete,true);
  assert.equal(calculateCost(items,quotes,{}, {},true,{a:true}).priced,0);
  assert.equal(calculateCost(items,quotes,{}, {groceries:-1}).taxUnknown,1);
});
test('null budgets and tax values mean unknown rather than free',()=>{
 const t=calculateCost([{id:'a',quantity:1,unit:'item',category:'groceries'}],{},{a:null},{groceries:null});
 assert.equal(t.priced,0);assert.equal(t.complete,false);
 const known=calculateCost([{id:'a',quantity:1,unit:'item',category:'groceries'}],{},{a:4},{groceries:null});assert.equal(known.taxUnknown,1);
});
