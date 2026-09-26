import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { chromium } from 'playwright';
import { createProviders, DEFAULT_PROVIDERS, fetchJSON } from '../site/providers.mjs';
import { validPoint } from '../site/core.mjs';
import { scrapeQuote, closeBrowser } from './scraper.mjs';

export function createServer(env=process.env, dependencies={}) {
  const production=env.NODE_ENV==='production', token=env.API_TOKEN||'';
  if(production&&token.length<24)throw new Error('Production requires API_TOKEN with at least 24 characters. Enter it privately in the app connection settings.');
  const port=Number(env.PORT||8787), site=resolve(dirname(fileURLToPath(import.meta.url)),'../site');
  const origins=new Set((env.ALLOWED_ORIGINS||`http://localhost:${port},http://127.0.0.1:${port}`).split(',').map(s=>s.trim()).filter(Boolean));
  if(origins.has('*'))throw new Error('ALLOWED_ORIGINS must list exact origins, never *.');
  const providers={...DEFAULT_PROVIDERS,photon:env.PHOTON_URL||DEFAULT_PROVIDERS.photon,overpass:env.OVERPASS_URL||DEFAULT_PROVIDERS.overpass,osrm:env.OSRM_URL||DEFAULT_PROVIDERS.osrm};
  const cache=new Map(), limits=new Map();let queue=Promise.resolve(), lastRequest=0, queued=0, activeScrapes=0;
  const request=async(url,options={})=>{
    const key=String(url)+(options.body||''), cached=cache.get(key);
    if(cached&&Date.now()-cached.time<900000)return cached.data;
    if(queued>=20)throw new Error('Map service is busy. Please retry shortly.');queued++;
    const task=queue.catch(()=>{}).then(async()=>{
      const wait=Math.max(0,1100-(Date.now()-lastRequest));if(wait)await new Promise(r=>setTimeout(r,wait));lastRequest=Date.now();
      const data=await fetchJSON(url,{...options,headers:{...options.headers,'User-Agent':'AislePilot/2.0 (personal shopping route planner)'}});
      if(cache.size>=150)cache.delete(cache.keys().next().value);cache.set(key,{time:Date.now(),data});return data;
    }).finally(()=>queued--);
    queue=task;return task;
  };
  const maps=dependencies.maps||createProviders(providers,request), quote=dependencies.quote||scrapeQuote;
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/health'&&req.method==='GET')return send(res,200,{ok:true,version:'2.0.0',browserInstalled:existsSync(chromium.executablePath())});
      if(url.pathname.startsWith('/api/')){
        const controller=new AbortController();
        res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        const origin=req.headers.origin;
        if(origin&&!origins.has(origin))return send(res,403,{error:'Origin is not in ALLOWED_ORIGINS. Add the exact Pages origin to your backend configuration.'});
        if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
        res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
        if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
        if(req.method!=='POST')return send(res,405,{error:'Use POST.'});
        const supplied=(req.headers.authorization||'').replace(/^Bearer /,'');
        if(token&&!timingSafeEqual(createHash('sha256').update(token).digest(),createHash('sha256').update(supplied).digest()))return send(res,401,{error:'Backend token is missing or incorrect. Open Connection settings.'});
        const ip=req.socket.remoteAddress||'unknown',now=Date.now();
        if(limits.size>500)for(const [key,value] of limits)if(now-value.time>600000)limits.delete(key);
        const limit=limits.get(ip);if(!limit||now-limit.time>600000)limits.set(ip,{time:now,count:1});else if(++limit.count>100){res.setHeader('Retry-After','600');return send(res,429,{error:'Request limit reached. Retry in ten minutes.'});}
        if(!(req.headers['content-type']||'').startsWith('application/json'))return send(res,415,{error:'Send application/json.'});
        const chunks=[];let bytes=0;
        for await(const chunk of req){bytes+=chunk.length;if(bytes>64000)return send(res,413,{error:'Request body is too large.'});chunks.push(chunk);}
        let payload;try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(res,400,{error:'Invalid JSON request.'});}
        const name=url.pathname.slice(5);
        if(name==='ping')return send(res,200,{ok:true,version:'2.0.0',browserInstalled:existsSync(chromium.executablePath())});
        if(name==='quote'){
          const {item,store}=payload||{};
          if(!item||typeof item.name!=='string'||item.name.length>240||!item.name.trim()||!validPoint(store)||typeof store.name!=='string'||store.name.length>300||typeof store.id!=='string'||store.id.length>100||(item.productUrl&&(typeof item.productUrl!=='string'||item.productUrl.length>2000)))return send(res,400,{error:'Invalid item or store for inventory lookup.'});
          if(activeScrapes>=2){res.setHeader('Retry-After','20');return send(res,429,{error:'Browser service is busy. Retry inventory checks shortly.'});}
          activeScrapes++;try{return send(res,200,await quote({item,store}));}finally{activeScrapes--;}
        }
        if(!['geocode','stores','matrix','route'].includes(name))return send(res,404,{error:'Unknown API endpoint.'});
        try{return send(res,200,await maps[name](payload,controller.signal));}catch(error){return send(res,502,{error:error.message});}
      }
      if(!['GET','HEAD'].includes(req.method))return send(res,405,{error:'Use GET.'});
      const path=resolve(site,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
      if(!path.startsWith(site+'/'))return send(res,404,{error:'Not found.'});
      const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.json':'application/json'};
      if(!types[extname(path)])return send(res,404,{error:'Not found.'});
      const data=await readFile(path).catch(()=>null);if(!data)return send(res,404,{error:'Not found.'});
      res.writeHead(200,{'Content-Type':types[extname(path)]+'; charset=utf-8','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
    }catch(error){if(!res.headersSent)send(res,500,{error:'Request failed. Check backend configuration and connectivity.'});else res.end();}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const server=createServer(),host=process.env.HOST||(process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1'),port=Number(process.env.PORT||8787);
  server.requestTimeout=75000;server.headersTimeout=10000;
  server.listen(port,host,()=>console.log(`AislePilot backend ready on ${host}:${port}`));
  for(const event of ['SIGTERM','SIGINT'])process.on(event,()=>{server.close();closeBrowser().finally(()=>process.exit(0));});
}
