#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile,writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseInput,coordinateInput,shortlistStores,sortRoute,assignItems,calculateCost,CATEGORIES } from '../site/core.mjs';
import { createProviders,createAPI,DEFAULT_PROVIDERS,fetchJSON } from '../site/providers.mjs';
import { scrapeQuote,closeBrowser } from '../server/scraper.mjs';

const options={address:{type:'string'},list:{type:'string'},file:{type:'string'},radius:{type:'string',default:'8'},'origin-index':{type:'string'},'round-trip':{type:'boolean'},'maps-only':{type:'boolean'},'no-candidate-prices':{type:'boolean'},'tax-grocery':{type:'string'},'tax-other':{type:'string'},budgets:{type:'string'},categories:{type:'string'},backend:{type:'string'},output:{type:'string'},help:{type:'boolean'}};
async function main(){
  const {values:v}=parseArgs({options});
  if(v.help){console.log('Usage: npm run plan -- --address "ADDRESS or LAT,LON" --file list.txt [--origin-index 1] [--round-trip] [--radius 8] [--backend https://YOUR-BACKEND] [--maps-only] [--tax-grocery 0] [--tax-other 7] [--budgets budgets.json] [--categories categories.json] [--no-candidate-prices] [--output trip.json]\nUse --list "milk, basketball" instead of --file. Set API_TOKEN in the environment for a remote backend.');return;}
  if(!v.address||(!v.list&&!v.file))throw new Error('Supply --address and either --list or --file. Run --help for options.');
  let items=parseInput(v.file?await readFile(v.file,'utf8'):v.list);if(!items.length)throw new Error('The list has no unchecked items.');
  if(v.categories){const overrides=JSON.parse(await readFile(v.categories,'utf8'));items=items.map(item=>{const category=overrides[item.name]??item.category;if(category&&!CATEGORIES[category])throw new Error(`Unknown category: ${category}`);return {...item,category};});}
  const radiusKm=Number(v.radius);if(!Number.isFinite(radiusKm)||radiusKm<1||radiusKm>20)throw new Error('Radius must be 1–20 km.');
  const rates={groceries:v['tax-grocery'],other:v['tax-other']};for(const rate of Object.values(rates))if(rate!==undefined&&(!Number.isFinite(Number(rate))||Number(rate)<0||Number(rate)>30))throw new Error('Tax rates must be between 0 and 30 percent.');
  const config={...DEFAULT_PROVIDERS,photon:process.env.PHOTON_URL||DEFAULT_PROVIDERS.photon,overpass:process.env.OVERPASS_URL||DEFAULT_PROVIDERS.overpass,osrm:process.env.OSRM_URL||DEFAULT_PROVIDERS.osrm};
  let last=0;const request=async(url,settings)=>{const wait=Math.max(0,1100-(Date.now()-last));if(wait)await new Promise(r=>setTimeout(r,wait));last=Date.now();return fetchJSON(url,{...settings,headers:{...settings?.headers,'User-Agent':'AislePilot/2.0 (personal shopping route planner)'}});};
  const maps=v.backend?createAPI(v.backend,process.env.API_TOKEN||''):createProviders(config,request);
  let origin=coordinateInput(v.address);
  if(!origin){
    const choices=await maps.geocode({query:v.address});if(!choices.length)throw new Error('No address matched. Try a more precise address or coordinates.');
    choices.forEach((c,i)=>console.error(`${i+1}. ${c.label} (${c.precision}; ${c.lat}, ${c.lon})`));
    let selected=v['origin-index'];
    if(selected===undefined&&process.stdin.isTTY){const reader=createInterface({input:process.stdin,output:process.stderr});selected=await reader.question('Confirm starting address number: ');reader.close();}
    if(!/^\d+$/.test(selected||'')||Number(selected)<1||Number(selected)>choices.length)throw new Error('Confirm an address with --origin-index N, or supply exact latitude,longitude.');
    origin=choices[Number(selected)-1];
  }
  const categories=[...new Set(items.map(i=>i.category).filter(Boolean))];if(!categories.length)throw new Error('No categories recognized. Supply a categories.json mapping item names to category keys.');
  console.error('Discovering nearby stores and driving routes…');
  const discovered=await maps.stores({origin,radiusKm}),candidates=shortlistStores(discovered.stores,categories);
  const matrix=candidates.length?await maps.matrix({points:[origin,...candidates]}):null;
  const selection=candidates.length?sortRoute(candidates,matrix.durations,categories,!!v['round-trip']):{stops:[],missing:categories};
  if(selection.unreachable)throw new Error('No drivable route covers these candidates. No straight-line substitute was used.');
  const road=selection.stops.length?await maps.route({points:[origin,...selection.stops,...(v['round-trip']?[origin]:[])]}):null;
  items=assignItems(items,selection.stops);
  const evidence={};
  if(!v['maps-only'])for(const item of items.filter(i=>i.storeId)){
    console.error(`Checking retailer evidence: ${item.name}`);
    const payload={item,store:selection.stops.find(s=>s.id===item.storeId)};
    try{evidence[item.id]=v.backend?await maps.quote(payload):await scrapeQuote(payload);}catch(error){evidence[item.id]={status:'unavailable',reason:error.message,checkedAt:new Date().toISOString()};}
  }
  const budgets=v.budgets?JSON.parse(await readFile(v.budgets,'utf8')):{},manual={};
  for(const item of items)if(budgets[item.name]!==undefined){const amount=Number(budgets[item.name]);if(!Number.isFinite(amount)||amount<0||amount>1000000)throw new Error(`Invalid unit budget for ${item.name}`);manual[item.id]=amount;}
  const report={app:'AislePilot',version:2,createdAt:new Date().toISOString(),origin,items,stops:selection.stops,road,unassigned:items.filter(i=>!i.storeId),candidateCount:candidates.length,evidence,taxRates:rates,unitBudgets:manual,cost:calculateCost(items,evidence,manual,rates,!v['no-candidate-prices']),notes:['Route minimizes driving time within the shortlist; inventory and opening hours are not constraints.','Online offers are candidate price estimates. Confirm product, package and branch availability at source.','Unpriced items and unknown taxes are excluded from the known amount. Prices are USD; no exchange rates, fuel, fees or deposits included.']};
  const json=JSON.stringify(report,null,2)+'\n';if(v.output){await writeFile(v.output,json);console.error(`Saved trip report to ${v.output}`);}else process.stdout.write(json);
}
try{await main();}catch(error){console.error(`AislePilot: ${error.message}`);process.exitCode=1;}finally{await closeBrowser();}
