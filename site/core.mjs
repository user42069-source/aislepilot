// Pure, shared logic: browser, CLI and tests use the same parser and optimizer.
export const CATEGORIES = {
  groceries: { label: 'Groceries', color: '#247b63', aliases: ['milk','eggs','bread','banana','bananas','apple','apples','chicken','beef','rice','pasta','yogurt','cheese','butter','coffee','tea','lettuce','tomato','tomatoes','potato','potatoes','onion','onions','cereal','flour','sugar','salt','pepper','juice','water','broccoli','carrots','orange','oranges','salmon','oats','beans','tofu','spinach','peanut butter','olive oil','avocado','avocados'] },
  sports: { label: 'Sports', color: '#cc683d', aliases: ['basketball','football','soccer ball','tennis','tennis ball','racket','dumbbell','yoga mat','baseball','golf','running shoes','volleyball','kettlebell'] },
  home: { label: 'Home & garden', color: '#a06f48', aliases: ['flower pot','flowerpot','plant pot','planter','vase','pillow','towel','curtain','rug','candle','bedding','blanket','lamp','picture frame','plate','mug'] },
  books: { label: 'Books', color: '#8263ad', aliases: ['book','books','novel','paperback','hardcover','textbook','dune','the hobbit'] },
  hardware: { label: 'Hardware', color: '#626e85', aliases: ['hammer','screwdriver','screws','nails','drill','paint','light bulb','lightbulb','duct tape','wrench','lumber','extension cord'] },
  pharmacy: { label: 'Health & care', color: '#bd6688', aliases: ['toothpaste','toothbrush','shampoo','soap','deodorant','ibuprofen','acetaminophen','vitamin','vitamins','bandage','sunscreen','floss'] },
  electronics: { label: 'Electronics', color: '#407eab', aliases: ['headphones','earbuds','charger','usb cable','keyboard','mouse','monitor','laptop','hdmi','battery','batteries'] },
  pets: { label: 'Pets', color: '#ad872b', aliases: ['dog food','cat food','cat litter','dog toy','cat toy','pet food','leash','dog collar'] }
};
export const normalize = s => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function categorize(text) {
  const padded = ` ${normalize(text)} `;
  let match = null, length = 0;
  for (const [key, category] of Object.entries(CATEGORIES)) for (const term of category.aliases) {
    if (padded.includes(` ${term} `) && term.length > length) { match = key; length = term.length; }
  }
  return match;
}
function splitList(text) {
  const parts = []; let current = '', depth = 0, quote = '';
  for (const c of text.replace(/\r/g,'')) {
    if (c === '"') quote = quote ? '' : c;
    if (!quote && (c === '(' || c === '[')) depth++;
    if (!quote && (c === ')' || c === ']')) depth = Math.max(0,depth-1);
    if (c === '\n' || (!depth && !quote && (c === ',' || c === ';'))) { parts.push(current); current=''; depth=0; quote=''; }
    else current += c;
  }
  parts.push(current); return parts;
}
const numberValue = s => s.includes('/') ? s.split('/').map(Number).reduce((a,b)=>a/b) : Number(s);
export function parseInput(raw) {
  if (typeof raw !== 'string' || raw.length > 12000) throw new Error('Use a shopping list of at most 12,000 characters.');
  const result = []; let section = null;
  for (let line of splitList(raw)) {
    line = line.trim();
    if (!line || /^(?:[-*+]\s*)?\[[xX]\]/.test(line)) continue;
    if (/^#+\s|^[\w &]+:$/.test(line)) {
      const title = normalize(line);
      section = Object.keys(CATEGORIES).find(k => normalize(CATEGORIES[k].label) === title || k === title) || null;
      continue;
    }
    line = line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/,'').replace(/^\[ \]\s*/,'').replace(/\*\*|__/g,'');
    let productUrl = null;
    line = line.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,label,url)=>{productUrl=url;return label;});
    line = line.replace(/https?:\/\/[^\s]+/g,url=>{productUrl=url;return '';}).trim();
    let quantity=1, unit='item';
    const start = line.match(/^(\d+(?:\.\d+|\/\d+)?)(?:\s*(?:x|×)\s*|\s+)(?:(lbs?|pounds?|kg|g|oz|ounces?|liters?|litres?|l|ml|dozen|packs?|boxes?|bottles?|cans?|bags?|gallons?)\b\s*(?:of\s+)?)?(.+)$/i);
    const end = line.match(/^(.+?)\s+(?:x|×)\s*(\d+(?:\.\d+)?)$/i);
    if(start){quantity=numberValue(start[1]);unit=(start[2]||'item').toLowerCase();line=start[3].trim();}
    else if(end){line=end[1].trim();quantity=Number(end[2]);}
    if (!line || !Number.isFinite(quantity) || quantity<=0 || quantity>999) throw new Error('Use positive quantities up to 999 and include an item name.');
    if (line.length>240) throw new Error('Keep each item under 240 characters. Use new lines between items.');
    const category=categorize(line)||section;
    const existing=result.find(i=>normalize(i.name)===normalize(line)&&i.unit===unit&&i.category===category&&i.productUrl===productUrl);
    if(existing){existing.quantity+=quantity;if(existing.quantity>999)throw new Error('Combined item quantity exceeds 999.');}
    else result.push({id:`item-${result.length+1}`,name:line,quantity,unit,category,productUrl});
  }
  if(result.length>40)throw new Error('Plan up to 40 distinct items at a time.');
  return result;
}
export function validPoint(p) { return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat)<=90 && Math.abs(p.lon)<=180; }
export function coordinateInput(text) {
  const m=String(text).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if(!m)return null;
  const point={lat:Number(m[1]),lon:Number(m[2]),label:`${m[1]}, ${m[2]}`,precision:'Coordinates supplied by you'};
  if(!validPoint(point))throw new Error('Coordinates must be latitude, longitude within their valid ranges.');
  return point;
}
export function kmBetween(a,b) {
  const r=Math.PI/180, dlat=(b.lat-a.lat)*r, dlon=(b.lon-a.lon)*r;
  return 12742*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2)));
}
const SHOP_CATEGORY={supermarket:['groceries'],greengrocer:['groceries'],convenience:['groceries'],sports:['sports'],outdoor:['sports'],garden_centre:['home'],houseware:['home'],interior_decoration:['home'],furniture:['home'],department_store:['home'],books:['books'],hardware:['hardware'],doityourself:['hardware','home'],chemist:['pharmacy'],electronics:['electronics'],computer:['electronics'],pet:['pets']};
export function storesFromOSM(data, origin) {
  const result=[];
  for(const e of data.elements||[]) {
    const tags=e.tags||{}, p={lat:e.lat??e.center?.lat,lon:e.lon??e.center?.lon};
    if(!validPoint(p)||tags.disused==='yes'||tags.access==='private'||tags.shop==='vacant')continue;
    const name=tags.name||tags.brand||`Unnamed ${tags.shop||'pharmacy'}`;
    let categories=[...(SHOP_CATEGORY[tags.shop]||[])];
    if(tags.amenity==='pharmacy')categories.push('pharmacy');
    if(/\b(walmart|target|meijer)\b/i.test(name))categories=Object.keys(CATEGORIES).filter(k=>k!=='hardware');
    if(/dick.?s sporting/i.test(name))categories=['sports'];
    if(/homegoods|home goods/i.test(name))categories=['home'];
    if(/barnes\s*(?:&|and)\s*noble/i.test(name))categories=['books'];
    if(!categories.length)continue;
    const street=[tags['addr:housenumber'],tags['addr:street']].filter(Boolean).join(' ');
    const address=[street,tags['addr:city']||tags['addr:town'],tags['addr:state'],tags['addr:postcode']].filter(Boolean).join(', ');
    const store={id:`${e.type}/${e.id}`,name,...p,categories:[...new Set(categories)],address:address||'Street address not supplied by OpenStreetMap',addressComplete:!!street,website:tags.website||tags['contact:website']||null,phone:tags.phone||tags['contact:phone']||null,openingHours:tags.opening_hours||null,sourceUrl:`https://www.openstreetmap.org/${e.type}/${e.id}`,distanceKm:kmBetween(origin,p)};
    if(!result.some(s=>normalize(s.name)===normalize(name)&&kmBetween(s,p)<0.075))result.push(store);
  }
  return result.sort((a,b)=>a.distanceKm-b.distanceKm||a.id.localeCompare(b.id));
}
export function shortlistStores(stores, categories, perCategory=3) {
  const ids=new Set();
  for(const category of categories)stores.filter(s=>s.categories.includes(category)).slice(0,perCategory).forEach(s=>ids.add(s.id));
  return stores.filter(s=>ids.has(s.id));
}
// Exact group-cover shortest path on a directed duration matrix. Each selected
// stop adds a category; weights are nonnegative shortest-road durations.
export function sortRoute(stores, durations, categories, returnHome=false) {
  const available=categories.filter(c=>stores.some(s=>s.categories.includes(c)));
  const missing=categories.filter(c=>!available.includes(c));
  if(!available.length)return {stops:[],missing,duration:0,covered:[],unreachable:false};
  const n=stores.length;
  if(n>24||available.length>8||durations.length!==n+1||durations.some(r=>!Array.isArray(r)||r.length!==n+1))throw new Error('Invalid or oversized driving matrix.');
  const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
  const masks=stores.map(s=>available.reduce((m,c,i)=>s.categories.includes(c)?m|(1<<i):m,0));
  const full=(1<<available.length)-1, dp=Array.from({length:full+1},()=>Array(n).fill(Infinity)), prev=new Map();
  for(let j=0;j<n;j++)if(masks[j]&&finite(durations[0][j+1])){dp[masks[j]][j]=durations[0][j+1];prev.set(`${masks[j]}:${j}`,null);}
  for(let mask=1;mask<=full;mask++)for(let i=0;i<n;i++)if(Number.isFinite(dp[mask][i]))for(let j=0;j<n;j++){
    const next=mask|masks[j], leg=durations[i+1][j+1];
    if(next===mask||!finite(leg))continue;
    const cost=dp[mask][i]+leg;
    if(cost<dp[next][j]){dp[next][j]=cost;prev.set(`${next}:${j}`,[mask,i]);}
  }
  let best=Infinity,last=-1;
  for(let i=0;i<n;i++){
    const back=returnHome?durations[i+1][0]:0;
    if(finite(back)&&dp[full][i]+back<best){best=dp[full][i]+back;last=i;}
  }
  if(last<0)return {stops:[],missing,duration:null,covered:[],unreachable:true};
  const stops=[];let cursor=[full,last];
  while(cursor){stops.unshift(stores[cursor[1]]);cursor=prev.get(`${cursor[0]}:${cursor[1]}`);}
  return {stops,missing,duration:best,covered:available,unreachable:false};
}
export function assignItems(items, stops) { return items.map(item=>({...item,storeId:stops.find(s=>s.categories.includes(item.category))?.id||null})); }
export const money=(amount,currency='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency}).format(amount);
export function calculateCost(items, quotes={}, manual={}, taxRates={}, useCandidates=true, excluded={}) {
  const categories={}, lines=[];let subtotalCents=0,taxCents=0,priced=0,taxUnknown=0;
  for(const item of items) {
    const q=quotes[item.id], own=manual[item.id];
    const hasManual=own!==null&&own!==undefined&&own!==''&&Number.isFinite(Number(own))&&Number(own)>=0&&Number(own)<=1000000;
    const candidate=q?.candidate;
    const canEstimate=useCandidates&&!excluded[item.id]&&item.unit==='item'&&candidate?.eligible&&candidate.currency==='USD'&&candidate.price!==null;
    const unitPrice=hasManual?Number(own):canEstimate?candidate.price:null;
    const cents=unitPrice===null?null:Math.round(unitPrice*item.quantity*100);
    const rateValue=taxRates[item.category==='groceries'?'groceries':'other'];
    const rate=rateValue!==null&&rateValue!==''&&rateValue!==undefined&&Number.isFinite(Number(rateValue))&&Number(rateValue)>=0&&Number(rateValue)<=30?Number(rateValue):null;
    const lineTax=cents!==null&&rate!==null?Math.round(cents*rate/100):null;
    if(cents!==null){subtotalCents+=cents;priced++;if(lineTax!==null)taxCents+=lineTax;else taxUnknown++;}
    const key=item.category||'unassigned';
    categories[key]??={subtotalCents:0,taxCents:0,priced:0,count:0};categories[key].count++;
    if(cents!==null){categories[key].subtotalCents+=cents;categories[key].taxCents+=lineTax||0;categories[key].priced++;}
    lines.push({id:item.id,unitPrice,cents,taxCents:lineTax,basis:hasManual?'Your unit budget':canEstimate?'Candidate online listing (estimate)':'Unknown'});
  }
  return {subtotalCents,taxCents,totalCents:subtotalCents+taxCents,priced,unpriced:items.length-priced,taxUnknown,complete:priced===items.length&&!taxUnknown,categories,lines};
}
export function navigationURL(from,to) {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${from.lat},${from.lon}`)}&destination=${encodeURIComponent(`${to.lat},${to.lon}`)}&travelmode=driving`;
}
