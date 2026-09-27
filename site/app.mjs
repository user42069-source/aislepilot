import {CATEGORIES,parseInput,coordinateInput,shortlistStores,sortRoute,assignItems,calculateCost,money,navigationURL} from './core.mjs';
import {createProviders,createAPI,DEFAULT_PROVIDERS} from './providers.mjs';

const $=id=>document.getElementById(id);
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink=url=>{try{const u=new URL(url);return u.protocol==='https:'?escapeHTML(u.href):'#';}catch{return '#';}};
function fullRouteURL(origin,stops,returnHome=false){
  if(!origin||!stops?.length)return null;
  const destination=returnHome?origin:stops.at(-1),waypoints=returnHome?stops:stops.slice(0,-1);
  const params=new URLSearchParams({api:'1',origin:`${origin.lat},${origin.lon}`,destination:`${destination.lat},${destination.lon}`,travelmode:'driving'});
  if(waypoints.length)params.set('waypoints',waypoints.map(p=>`${p.lat},${p.lon}`).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}
const distance=m=>`${(m/1609.344).toFixed(1)} mi`;
const minutes=s=>`${Math.max(1,Math.round(s/60))} min`;
let savedBase=null;try{savedBase=localStorage.getItem('aislepilot-api-base');}catch{}
const config=window.AISLEPILOT_CONFIG||{};
let apiBase=savedBase??(config.apiBase||(['localhost','127.0.0.1'].includes(location.hostname)?location.origin:'')),token='';
const state={items:[],origin:null,plan:null,quotes:{},manual:{},excluded:{},controller:null,busy:false,done:0,completedAt:null};
let map=null,layers=null;
function status(text,type=''){ $('status').className=`status-box ${type}`;$('status').innerHTML='<span class="status-dot"></span><span></span>';$('status').lastElementChild.textContent=text; }
function setBusy(busy){state.busy=busy;$('optimize').disabled=busy;$('cancel').hidden=!busy;for(const id of ['address','shopping-list','radius','round-trip','example-button','connection-button'])$(id).disabled=busy;}
function api(){return apiBase?createAPI(apiBase,token):createProviders(DEFAULT_PROVIDERS);}
function updateConnection(){ $('connection-label').textContent=apiBase?'Backend configured':'Map mode'; }
function initializeMap(){
  if(!window.L){status('Map tiles could not load. Text routes will still work; check your connection and reload.','error');return;}
  map=L.map('map',{scrollWheelZoom:false}).setView([39.8,-98.6],4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}).addTo(map);
  layers=L.featureGroup().addTo(map);
}
function marker(point,label,isOrigin=false){if(!map)return;return L.marker([point.lat,point.lon],{icon:L.divIcon({className:`route-marker${isOrigin?' origin':''}`,html:escapeHTML(label),iconSize:[30,30],iconAnchor:[15,15]})}).bindPopup(`<strong>${escapeHTML(point.name||point.label||'Start')}</strong>${point.address?`<br>${escapeHTML(point.address)}`:''}`).addTo(layers);}
function drawMap(){
  if(!map||!state.origin)return;
  layers.clearLayers();$('map-prompt').hidden=true;marker(state.origin,'S',true);
  const plan=state.plan;
  if(plan?.road?.route?.geometry)L.geoJSON(plan.road.route.geometry,{style:{color:'#174e3e',weight:5,opacity:.85}}).addTo(layers);
  plan?.stops.forEach((s,i)=>marker(s,i+1));
  if(plan?.stops.length)map.fitBounds(layers.getBounds(),{padding:[35,55],maxZoom:15});else map.setView([state.origin.lat,state.origin.lon],15);
  const route=plan?.road?.route;
  $('map-stats').hidden=!route;
  if(route)$('map-stats').innerHTML=`<div><strong>${plan.stops.length}</strong><small>Stops</small></div><div><strong>${distance(route.distance)}</strong><small>Road distance</small></div><div><strong>${minutes(route.duration)}</strong><small>Driving estimate</small></div>`;
}
function rates(){return {groceries:$('tax-grocery').value,other:$('tax-other').value};}
function totals(){return calculateCost(state.items,state.quotes,state.manual,rates(),$('use-quotes').checked,state.excluded);}
function renderSummary(){
  const t=totals();
  $('total-label').textContent=t.complete?'TOTAL ESTIMATE':'PARTIAL ESTIMATE';
  $('total').textContent=t.priced?money(t.totalCents/100):'—';
  $('subtotal').textContent=t.priced?money(t.subtotalCents/100):'—';
  $('subtotal-note').textContent=t.priced?`${t.priced} of ${state.items.length} entries priced`:'No prices assumed';
  $('tax').textContent=t.priced&&t.taxUnknown===0?money(t.taxCents/100):'Unknown';
  $('tax-note').textContent=t.taxUnknown?`${t.taxUnknown} priced entries need a tax rate`:t.priced?'Using your effective rates':'Set your effective rates';
  $('coverage').textContent=t.priced?`${t.unpriced} unpriced${t.taxUnknown?' · tax incomplete':''} · estimates only`:`${state.items.length} entries awaiting prices`;
  $('cost-categories').hidden=!state.items.length;
  $('cost-categories').innerHTML=Object.entries(t.categories).map(([key,c])=>`<div class="category-tag"><span style="background:${CATEGORIES[key]?.color||'#999'}"></span>${escapeHTML(CATEGORIES[key]?.label||'Unassigned')} <b>${c.priced?money(c.subtotalCents/100):'—'}</b><small>${c.priced}/${c.count}</small></div>`).join('');
  for(const line of t.lines){const element=$(`price-${line.id}`);if(element)element.textContent=line.cents===null?'Unknown':`${money(line.cents/100)} est.`;}
}
function itemHTML(item){
  const quote=state.quotes[item.id],candidate=quote?.candidate;
  const statusText=!item.storeId?'No matching stop · stock unknown':!apiBase?'Category match · stock unverified':!quote?'Awaiting inventory check':quote.status==='observed'?(candidate?.branchMatched?'Branch offer observed · verify product':'Online offer observed · branch unverified'):quote.status==='blocked'?'Lookup blocked · stock unknown':quote.status==='unsupported'?'Category match · stock unverified':'Price & stock unknown';
  const price=totals().lines.find(l=>l.id===item.id);
  const quantity=`${item.quantity} ${item.unit==='item'?(item.quantity===1?'item':'items'):item.unit}`;
  let evidence='Store type is a plausible category match. No item-specific stock evidence.';
  if(quote?.reason)evidence=escapeHTML(quote.reason);
  if(candidate){
    evidence=`<a href="${safeLink(candidate.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(candidate.name)} ↗</a><br>${money(candidate.price,candidate.currency)} per listed product/package · ${escapeHTML(candidate.availability)}<br>${escapeHTML(candidate.scope)}. ${escapeHTML(candidate.matchDescription)}.`;
    if(candidate.currency!=='USD')evidence+=' Non-USD price excluded; no exchange rate assumed.';
    if(item.unit!=='item')evidence+=` Quantity is in ${escapeHTML(item.unit)}; enter a budget per ${escapeHTML(item.unit)} to include it.`;
    else evidence+=' Estimate assumes each requested item means one listed package.';
    if(candidate.expired)evidence+=' Offer expiry has passed; excluded from estimates.';
  }
  if(quote?.checkedAt)evidence+=`<br>Checked ${escapeHTML(new Date(quote.checkedAt).toLocaleString())}${quote.cached?' · cached for up to 10 minutes':''}.`;
  const manual=state.manual[item.id]??'';
  return `<div class="item-row" id="row-${item.id}"><div class="item-top"><div><div class="item-name">${escapeHTML(item.name)}</div><div class="item-quantity">${escapeHTML(quantity)} · ${escapeHTML(CATEGORIES[item.category]?.label||'Unassigned')}</div></div><span class="price-value" id="price-${item.id}">${price?.cents!==null?money((price?.cents||0)/100)+' est.':'Unknown'}</span></div><span class="evidence-status ${escapeHTML(quote?.status||'')}">${statusText}</span><p class="evidence-note">${evidence}</p><div class="unit-budget"><label for="budget-${item.id}">Your USD / ${escapeHTML(item.unit==='item'?'item':item.unit)}</label><input id="budget-${item.id}" data-budget="${item.id}" type="number" min="0" max="1000000" step="0.01" placeholder="Budget" value="${escapeHTML(manual)}" aria-label="Unit budget for ${escapeHTML(item.name)}">${candidate?.eligible&&item.unit==='item'&&candidate.currency==='USD'?`<label class="exclude"><input type="checkbox" data-exclude="${item.id}" ${state.excluded[item.id]?'checked':''}>Exclude candidate price</label>`:''}</div></div>`;
}
function renderRoute(){
  if(!state.plan)return;
  const {stops,road,unassigned,returnHome}=state.plan;
  $('stop-count').textContent=`${stops.length} stop${stops.length===1?'':'s'} · ${state.items.length-unassigned.length}/${state.items.length} entries assigned`;
  let html=stops.length?`<a class="primary" style="width:fit-content;margin:0 0 14px auto;text-decoration:none" href="${safeLink(fullRouteURL(state.origin,stops,returnHome))}" target="_blank" rel="noopener noreferrer">Open full ${returnHome?'round-trip ':''}route in Google Maps ↗</a>`:'';
  html+=`<div class="retry-row"><button id="review-categories" class="text-button" type="button">Review categories ↗</button>${apiBase?' <button id="retry-quotes" class="text-button" type="button" style="margin-left:18px">Retry price checks ↻</button>':''}</div>`;
  if(unassigned.length)html+=`<div class="unassigned"><strong>${unassigned.length} item${unassigned.length===1?' needs':'s need'} a store</strong>${unassigned.map(i=>escapeHTML(i.name)).join(', ')}<br>Choose a category or increase the search radius. These items are excluded from the driving route.</div>`;
  stops.forEach((store,index)=>{
    const from=index?stops[index-1]:state.origin,leg=road?.route?.legs[index];
    html+=`<article class="route-stop"><div class="stop-header"><span class="stop-number">${index+1}</span><div class="stop-info"><h3>${escapeHTML(store.name)}</h3><p>${escapeHTML(store.address)}</p><p>${store.lat.toFixed(5)}, ${store.lon.toFixed(5)}${store.openingHours?` · OSM hours: ${escapeHTML(store.openingHours)} (not evaluated)`:''}</p><div class="stop-links"><a href="${safeLink(navigationURL(from,store))}" target="_blank" rel="noopener noreferrer">Navigate this leg ↗</a><a href="${safeLink(store.sourceUrl)}" target="_blank" rel="noopener noreferrer">Place source ↗</a>${store.website?`<a href="${safeLink(store.website)}" target="_blank" rel="noopener noreferrer">Store website ↗</a>`:''}</div></div><span class="leg-badge">${leg?`${minutes(leg.duration)} · ${distance(leg.distance)}`:''}</span></div><div class="stop-items">${state.items.filter(i=>i.storeId===store.id).map(itemHTML).join('')}</div></article>`;
  });
  if(returnHome&&stops.length){const leg=road?.route?.legs.at(-1);html+=`<div class="route-end">Back to your start${leg?` · ${minutes(leg.duration)} · ${distance(leg.distance)}`:''} · <a href="${safeLink(navigationURL(stops.at(-1),state.origin))}" target="_blank" rel="noopener noreferrer">Navigate ↗</a></div>`;}
  if(unassigned.length)html+=`<article class="route-stop"><div class="stop-header"><div class="stop-info"><h3>Items without a stop</h3><p>Add a category or your own budget. No inventory lookup was made for these items.</p></div></div><div class="stop-items">${unassigned.map(itemHTML).join('')}</div></article>`;
  $('route-list').innerHTML=html;
  $('review-categories')?.addEventListener('click',()=>{if(!state.busy)showReview();});
  $('retry-quotes')?.addEventListener('click',()=>{if(!state.busy)checkQuotes();});
  $('export').disabled=false;renderSummary();
}
function renderItem(id){const item=state.items.find(i=>i.id===id),row=$(`row-${id}`);if(item&&row)row.outerHTML=itemHTML(item);renderSummary();}
function showReview(){
  $('review-panel').hidden=false;
  $('review-panel').innerHTML=`<h3>Check your categories</h3><p>Specific titles or unfamiliar items may need your help. Unassigned items stay visible but won’t add a store to the route.</p>${state.items.map(i=>`<div class="review-item"><span>${escapeHTML(i.name)}</span><select data-category="${i.id}" aria-label="Category for ${escapeHTML(i.name)}"><option value="">Unassigned</option>${Object.entries(CATEGORIES).map(([key,c])=>`<option value="${key}" ${i.category===key?'selected':''}>${c.label}</option>`).join('')}</select></div>`).join('')}<button id="build-reviewed" class="primary" type="button">Build route with these categories <span aria-hidden="true">↗</span></button>`;
  $('build-reviewed').addEventListener('click',()=>{
    for(const select of document.querySelectorAll('[data-category]'))state.items.find(i=>i.id===select.dataset.category).category=select.value||null;
    $('review-panel').hidden=true;buildRoute();
  });
  $('review-panel').scrollIntoView({behavior:'smooth',block:'center'});
}
async function submitTrip(event){
  event.preventDefault();if(state.busy)return;
  try{
    const items=parseInput($('shopping-list').value);if(!items.length)throw new Error('Add at least one unchecked shopping item.');
    const address=$('address').value.trim();if(!address)throw new Error('Add a starting address or coordinates.');
    state.items=items;state.origin=null;state.plan=null;state.quotes={};state.manual={};state.excluded={};state.completedAt=null;
    $('review-panel').hidden=true;$('origin-choices').hidden=true;$('export').disabled=true;
    $('route-list').innerHTML='';$('stop-count').textContent='Finding your start';$('map-stats').hidden=true;
    layers?.clearLayers();$('map-prompt').hidden=false;renderSummary();
    state.controller=new AbortController();setBusy(true);status('Finding your starting address…','busy');
    const coords=coordinateInput(address),choices=coords?[coords]:await api().geocode({query:address},state.controller.signal);
    if(!choices.length)throw new Error('No address matches. Add a city and state, or enter latitude, longitude.');
    $('origin-choices').hidden=false;
    $('origin-choices').innerHTML=`<h3>Confirm your starting point</h3><p>Choose a match to place the pin and build your trip.</p>${choices.map((c,i)=>`<button class="origin-option" data-origin="${i}" type="button"><span><strong>${escapeHTML(c.label)}</strong><small>${escapeHTML(c.precision)} · ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}</small></span><span aria-hidden="true">↗</span></button>`).join('')}`;
    $('origin-choices').querySelectorAll('[data-origin]').forEach(button=>button.addEventListener('click',()=>{
      state.origin=choices[Number(button.dataset.origin)];$('origin-choices').hidden=true;drawMap();
      if(state.items.some(i=>!i.category)){status('Starting point selected. Review any unassigned categories.');showReview();}else buildRoute();
    }));
    status('Choose the address match below the map.');$('origin-choices').scrollIntoView({behavior:'smooth',block:'center'});
  }catch(error){handleError(error);}finally{setBusy(false);}
}
async function buildRoute(){
  if(state.busy||!state.origin)return;
  state.controller=new AbortController();setBusy(true);state.quotes={};state.plan=null;
  $('route-list').innerHTML='';$('map-stats').hidden=true;$('export').disabled=true;drawMap();renderSummary();
  try{
    const signal=state.controller.signal,client=api(),categories=[...new Set(state.items.map(i=>i.category).filter(Boolean))];
    if(!categories.length)throw new Error('Choose at least one category before building a driving route.');
    status('Finding real stores near your starting point…','busy');
    const discovered=await client.stores({origin:state.origin,radiusKm:Number($('radius').value)},signal);
    const candidates=shortlistStores(discovered.stores,categories);
    let selection={stops:[],missing:categories},road=null;
    if(candidates.length){
      status(`Comparing road travel times between ${candidates.length} nearby store candidates…`,'busy');
      const matrix=await client.matrix({points:[state.origin,...candidates]},signal);
      selection=sortRoute(candidates,matrix.durations,categories,$('round-trip').value==='yes');
      if(selection.unreachable)throw new Error('No drivable sequence covers the available categories. Try a different starting point, category selection or radius. No straight-line route was substituted.');
      if(selection.stops.length){
        status('Drawing the driving route…','busy');
        road=await client.route({points:[state.origin,...selection.stops,...($('round-trip').value==='yes'?[state.origin]:[])]},signal);
      }
    }
    state.items=assignItems(state.items,selection.stops);
    state.plan={origin:state.origin,stops:selection.stops,road,unassigned:state.items.filter(i=>!i.storeId),candidateCount:candidates.length,discoveredCount:discovered.stores.length,truncated:discovered.truncated,missing:selection.missing,returnHome:$('round-trip').value==='yes',plannedAt:new Date().toISOString()};
    $('route-method').textContent=`Shortest driving-time sequence within ${candidates.length} shortlisted stores (up to 3 per category, ranked by straight-line proximity). ${discovered.stores.length} OSM places discovered${discovered.truncated?'; provider result limit reached':''}. Availability is inferred from store type, not verified stock. No live traffic, opening-hour filtering or shopping-time allowance.`;
    drawMap();renderRoute();
    if(apiBase&&selection.stops.length){await runQuotes(signal);}else{state.completedAt=new Date().toISOString();status(selection.stops.length?'Route ready. Connect your backend for retailer checks, or enter your unit budgets.':'No matching stores found. Increase the radius or review item categories.');}
  }catch(error){handleError(error);}finally{setBusy(false);}
}
async function runQuotes(signal){
  const client=createAPI(apiBase,token),assigned=state.items.filter(i=>i.storeId);state.done=0;
  // Sequential lookup bounds retailer traffic and avoids an unbounded request burst.
  for(const item of assigned){
    if(signal.aborted)throw new DOMException('Cancelled','AbortError');
    status(`Checking retailer evidence ${state.done+1}/${assigned.length}: ${item.name}…`,'busy');
    const store=state.plan.stops.find(s=>s.id===item.storeId);
    try{state.quotes[item.id]=await client.quote({item,store},signal);}
    catch(error){if(signal.aborted)throw error;state.quotes[item.id]={status:'unavailable',checkedAt:new Date().toISOString(),reason:error.message};}
    state.done++;renderItem(item.id);
  }
  state.completedAt=new Date().toISOString();
  const observed=assigned.filter(i=>state.quotes[i.id]?.candidate).length;
  status(`Trip ready. ${observed} of ${assigned.length} assigned entries have online price evidence. Review candidates and unknowns below.`);
}
async function checkQuotes(){state.controller=new AbortController();setBusy(true);try{await runQuotes(state.controller.signal);}catch(e){handleError(e);}finally{setBusy(false);}}
function handleError(error){if(error.name==='AbortError'||state.controller?.signal.aborted)status(state.plan?'Checks cancelled. Your route and completed evidence are preserved.':'Request cancelled.');else status(error.message||'Something went wrong. Try again.','error');}

$('trip-form').addEventListener('submit',submitTrip);
$('cancel').addEventListener('click',()=>state.controller?.abort());
$('example-button').addEventListener('click',()=>{$('shopping-list').value='2 milk\neggs\nbread\nbananas\ncoffee\n1 basketball\nflower pot\nDune paperback';$('shopping-list').dispatchEvent(new Event('input'));$('shopping-list').focus();});
$('shopping-list').addEventListener('input',()=>{try{const count=parseInput($('shopping-list').value).length;$('list-count').textContent=`${count} item${count===1?'':'s'}`;}catch{$('list-count').textContent='Check list format';}if(state.plan)status('List changed. Optimize again to update the route and prices.');});
for(const id of ['address','radius','round-trip'])$(id).addEventListener('input',()=>{if(state.plan)status('Trip settings changed. Optimize again to update your route.');});
for(const id of ['tax-grocery','tax-other'])$(id).addEventListener('input',()=>{if(!$(id).validity.valid){$(id).setAttribute('aria-invalid','true');renderSummary();return;}$(id).removeAttribute('aria-invalid');renderSummary();});
$('use-quotes').addEventListener('change',renderSummary);
$('route-list').addEventListener('input',event=>{const input=event.target;if(input.dataset.budget){if(!input.validity.valid){input.setAttribute('aria-invalid','true');state.manual[input.dataset.budget]='';renderSummary();return;}input.removeAttribute('aria-invalid');state.manual[input.dataset.budget]=input.value;renderSummary();}if(input.dataset.exclude){state.excluded[input.dataset.exclude]=input.checked;renderSummary();}});
$('connection-button').addEventListener('click',()=>{$('api-base').value=apiBase;$('api-token').value=token;$('connection-status').textContent='';$('connection-dialog').showModal();});
$('about-button').addEventListener('click',()=>$('about-dialog').showModal());
function connectionValues(){let base=$('api-base').value.trim().replace(/\/$/,'');if(base){const url=new URL(base);if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw new Error('Use an HTTPS origin, or an HTTP localhost origin for development.');base=url.origin;}return {base,token:$('api-token').value};}
$('save-connection').addEventListener('click',()=>{try{const values=connectionValues();apiBase=values.base;token=values.token;try{localStorage.setItem('aislepilot-api-base',apiBase);}catch{}updateConnection();$('connection-dialog').close();status(apiBase?'Backend configured. Optimize your trip to use live retailer checks.':'Map mode selected. Inventory checks need a backend.');}catch(e){$('connection-status').textContent=e.message;}});
$('test-connection').addEventListener('click',async()=>{try{const v=connectionValues();if(!v.base)throw new Error('Enter a backend URL to test.');$('connection-status').textContent='Testing…';const response=await fetch(`${v.base}/api/ping`,{method:'POST',headers:{'Content-Type':'application/json',...(v.token?{Authorization:`Bearer ${v.token}`}:{})},body:'{}',signal:AbortSignal.timeout(12000)});const result=await response.json();if(!response.ok)throw new Error(result.error);$('connection-status').textContent=result.browserInstalled?'Connected. Chromium is installed; retailer access is checked per request.':'Connected. Install Chromium on the backend before checking retailers.';}catch(e){$('connection-status').textContent=e.message;}});
$('export').addEventListener('click',()=>{if(!state.plan)return;const report={app:'AislePilot',version:2,exportedAt:new Date().toISOString(),trip:state.plan,items:state.items,evidence:state.quotes,unitBudgets:state.manual,taxRates:rates(),useCandidatePrices:$('use-quotes').checked,excludedCandidates:state.excluded,cost:totals(),notes:['USD only; observed online listing prices are estimates for candidate products, not verified local prices.','Unpriced items are excluded from the known amount. Tax is unknown unless supplied.','Route is optimal within shortlisted category candidates, not all stores or confirmed inventories.','No live traffic, shopping time, fuel, fees, deposits or opening-hour constraints.']};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='aislepilot-trip.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
updateConnection();initializeMap();