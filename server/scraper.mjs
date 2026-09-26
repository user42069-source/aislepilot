import { chromium } from 'playwright';
import robotsParser from 'robots-parser';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { extractCandidates, matchProduct } from './evidence.mjs';
import { retailerFor, allowedURL } from './retailers.mjs';

const AGENT='AislePilotBot', USER_AGENT='AislePilotBot/2.0 (personal shopping research; respects robots.txt)';
const robotsCache=new Map(), quoteCache=new Map(), hostTasks=new Map();
let browserPromise;
export function isPublicIP(ip) {
  if(isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19)));}
  if(isIP(ip)===6)return !/^(::|fc|fd|fe[89ab]|ff)/i.test(ip)&&!ip.toLowerCase().startsWith('2001:db8:');
  return false;
}
async function publicHost(host) {
  const addresses=await lookup(host,{all:true});
  if(!addresses.length||addresses.some(a=>!isPublicIP(a.address)))throw new Error('Retailer hostname did not resolve to a public address.');
}
async function robotsFor(url) {
  const origin=new URL(url).origin, cached=robotsCache.get(origin);
  if(cached&&Date.now()-cached.time<3600000)return cached.value;
  await publicHost(new URL(url).hostname);
  const response=await fetch(`${origin}/robots.txt`,{headers:{'User-Agent':USER_AGENT},signal:AbortSignal.timeout(10000),redirect:'error'});
  if(response.status!==404&&!response.ok)throw new Error(`Cannot verify robots.txt (HTTP ${response.status}); scraping skipped.`);
  const body=response.status===404?'':await response.text();
  if(body.length>500000)throw new Error('robots.txt exceeds the supported size.');
  const value=robotsParser(`${origin}/robots.txt`,body);robotsCache.set(origin,{time:Date.now(),value});return value;
}
async function browser() {
  if(!browserPromise)browserPromise=chromium.launch({headless:true,chromiumSandbox:true,timeout:15000}).catch(e=>{browserPromise=null;throw new Error('Browser could not start. Install Chromium and its OS dependencies, and run with sandbox support. '+e.message.split('\n')[0]);});
  return browserPromise;
}
export async function closeBrowser(){if(browserPromise){const b=await browserPromise.catch(()=>null);await b?.close();browserPromise=null;}}
async function scrapeOne(item,store,retailer) {
  let context;
  let expired=false;
  const checkedAt=new Date().toISOString();
  const source=item.productUrl?allowedURL(item.productUrl,retailer):retailer.search?.(item.name);
  if(!source)return {status:'unsupported',checkedAt,reason:retailer.reason||'No public search adapter for this retailer.'};
  const bot=await robotsFor(source);
  if(bot.isAllowed(source,AGENT)===false)return {status:'blocked',checkedAt,reason:'Retailer robots.txt disallows this page; scraping skipped.'};
  const delay=Math.max(2000,Number(bot.getCrawlDelay(AGENT)||0)*1000);
  if(delay>10000)return {status:'blocked',checkedAt,reason:'Retailer requests a crawl delay longer than this interactive service supports.'};
  let lastNavigation=0;
  const deadline=setTimeout(()=>{expired=true;context?.close().catch(()=>{});},55000);
  try{
    context=await (await browser()).newContext({userAgent:USER_AGENT,locale:'en-US',serviceWorkers:'block',acceptDownloads:false,javaScriptEnabled:true});
    // Only first-party requests. No arbitrary pages, external trackers, images,
    // private networks, authenticated sessions, CAPTCHA solving or stealth.
    const checkedHosts=new Set();
    await context.route('**/*',async route=>{
      const request=route.request();
      try{
        const url=allowedURL(request.url(),retailer), host=new URL(url).hostname;
        if(['image','media','font','websocket'].includes(request.resourceType()))return route.abort();
        if(!checkedHosts.has(host)){await publicHost(host);checkedHosts.add(host);}
        if(request.isNavigationRequest()){
          const policy=await robotsFor(url);
          if(policy.isAllowed(url,AGENT)===false)return route.abort('blockedbyclient');
        }
        return route.continue();
      }catch{return route.abort('blockedbyclient');}
    });
    if(expired)throw new Error('Retailer check exceeded 55 seconds.');
    const page=await context.newPage();page.setDefaultTimeout(10000);
    const visit=async url=>{
      const normalized=allowedURL(url,retailer),policy=await robotsFor(normalized);
      if(policy.isAllowed(normalized,AGENT)===false){const error=new Error('Retailer robots.txt disallows this page; scraping skipped.');error.blocked=true;throw error;}
      const wait=Math.max(0,delay-(Date.now()-lastNavigation));if(wait)await new Promise(r=>setTimeout(r,wait));
      lastNavigation=Date.now();
      const response=await page.goto(normalized,{waitUntil:'domcontentloaded',timeout:20000});
      if(!response||response.status()>=400){const e=new Error(`Retailer returned HTTP ${response?.status()||'unknown'}; no price or stock inferred.`);e.blocked=[401,403,429].includes(response?.status());throw e;}
      // Bounded render window for client-injected structured product data.
      await page.waitForFunction(()=>document.querySelector('script[type="application/ld+json"],[itemtype*="schema.org/Product"]'),{},{timeout:3500}).catch(()=>{});
      const snapshot=await page.evaluate(()=>({
        title:document.title,
        body:(document.body?.innerText||'').slice(0,12000),
        json:[...document.querySelectorAll('script[type="application/ld+json"]')].slice(0,50).map(s=>s.textContent.slice(0,300000)),
        micro:[...document.querySelectorAll('[itemtype*="schema.org/Product"]')].slice(0,20).map(p=>{const value=(root,prop)=>{const el=root.querySelector(`[itemprop="${prop}"]`);return el?.getAttribute('content')||el?.getAttribute('href')||el?.textContent?.trim();};const offer=p.querySelector('[itemprop="offers"]')||p;return {'@type':'Product',name:value(p,'name'),offers:{'@type':'Offer',price:value(offer,'price'),priceCurrency:value(offer,'priceCurrency'),availability:value(offer,'availability')}};}),
        links:[...document.querySelectorAll('a[href]')].slice(0,1200).map(a=>({url:a.href,text:(a.textContent||a.getAttribute('aria-label')||'').trim().slice(0,300)}))
      }));
      if(/access denied|verify (?:that )?you are (?:a )?human|unusual traffic|robot or human|captcha challenge|just a moment/i.test(`${snapshot.title} ${snapshot.body.slice(0,1500)}`)){const e=new Error('Retailer presented an access challenge; no attempt was made to bypass it.');e.blocked=true;throw e;}
      const documents=snapshot.json.map(text=>{try{return JSON.parse(text);}catch{return null;}}).filter(Boolean).concat(snapshot.micro);
      return {...snapshot,candidates:extractCandidates(documents,item.name,page.url(),store),url:page.url()};
    };
    let snapshot=await visit(source);
    let candidates=snapshot.candidates;
    if(!item.productUrl&&!candidates.some(c=>c.eligible)){
      const links=snapshot.links.filter(link=>{try{return retailer.product.test(new URL(allowedURL(link.url,retailer)).pathname)&&matchProduct(item.name,link.text).score>=0.5;}catch{return false;}}).sort((a,b)=>matchProduct(item.name,b.text).score-matchProduct(item.name,a.text).score);
      const unique=[...new Map(links.map(link=>[link.url,link])).values()].slice(0,1);
      for(const link of unique){snapshot=await visit(link.url);candidates.push(...snapshot.candidates);}
    }
    candidates.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.matchScore-a.matchScore);
    const candidate=candidates[0]||null;
    return {status:candidate?'observed':'not_found',candidate,checkedAt:new Date().toISOString(),reason:candidate?'Public structured product offer read from a rendered retailer page. Product and package match remain an estimate.':'No readable, matching single-product price found. Search may require a store selection, login, or unsupported page format.',retailer:retailer.name,sourceUrl:snapshot.url};
  }catch(error){return {status:error.blocked?'blocked':'unavailable',checkedAt,reason:expired?'Retailer check exceeded 55 seconds; price and stock remain unknown.':error.message.slice(0,350),sourceUrl:source};}
  finally{clearTimeout(deadline);await context?.close();}
}
export async function scrapeQuote({item,store}) {
  const retailer=retailerFor(store);
  if(!retailer)return {status:'unsupported',checkedAt:new Date().toISOString(),reason:'No verified public-page adapter for this retailer. Store-category match only; item availability and price are unknown.'};
  const key=JSON.stringify([retailer.id,store.id,item.name,item.productUrl]);
  const cached=quoteCache.get(key);if(cached&&Date.now()-cached.time<600000)return {...cached.value,cached:true};
  // One job per retailer at a time; cross-retailer concurrency is bounded by HTTP server.
  if(hostTasks.has(retailer.id))return {status:'unavailable',checkedAt:new Date().toISOString(),reason:'This retailer already has an active check. Retry shortly.'};
  const task=Promise.resolve().then(()=>scrapeOne(item,store,retailer)).catch(error=>({status:'unavailable',checkedAt:new Date().toISOString(),reason:error.message.slice(0,350)}));
  hostTasks.set(retailer.id,task);
  const value=await task;
  if(hostTasks.get(retailer.id)===task)hostTasks.delete(retailer.id);
  if(quoteCache.size>=200)quoteCache.delete(quoteCache.keys().next().value);
  quoteCache.set(key,{time:Date.now(),value});return value;
}
