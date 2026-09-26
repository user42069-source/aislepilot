import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviders,fetchJSON} from '../site/providers.mjs';
import {createServer} from '../server/index.mjs';
import {spawn} from 'node:child_process';
import http from 'node:http';

test('provider rejects failed road routing instead of drawing invented geometry',async()=>{
 const provider=createProviders(undefined,async()=>({code:'NoRoute',message:'Unreachable'}));
 await assert.rejects(()=>provider.route({points:[{lat:40,lon:-80},{lat:41,lon:-80}]}),/Unreachable/);
});
test('fetch cancellation terminates an in-flight request',async t=>{
 const server=http.createServer(()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();});
 const c=new AbortController();const pending=fetchJSON(`http://127.0.0.1:${server.address().port}`,{signal:c.signal});
 c.abort();await assert.rejects(pending,{name:'AbortError'});
});
test('CLI completes through HTTP with synthetic maps and quotes, preserving partial price coverage',{timeout:12000},async t=>{
 const store={id:'fixture/shop',name:'TEST ONLY shop',lat:40.01,lon:-80,address:'TEST ONLY',categories:['groceries'],distanceKm:1};
 const server=createServer({}, {maps:{
   stores:async()=>({stores:[store],truncated:false}),
   matrix:async()=>({durations:[[0,60],[90,0]]}),
   route:async()=>({route:{duration:150,distance:1000,legs:[{duration:60,distance:400},{duration:90,distance:600}],geometry:{type:'LineString',coordinates:[[-80,40],[-80,40.01],[-80,40]]}}})
 },quote:async({item})=>item.name==='milk'?{status:'observed',candidate:{price:4,currency:'USD',eligible:true,scope:'Online test fixture'}}:{status:'unavailable',reason:'TEST ONLY'}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();});
 const child=spawn(process.execPath,['scripts/plan.mjs','--backend',`http://127.0.0.1:${server.address().port}`,'--address','40,-80','--list','2 milk, eggs','--round-trip','--tax-grocery','0'],{cwd:new URL('..',import.meta.url),env:{...process.env,API_TOKEN:''}});
 t.after(()=>child.kill());let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
 const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 assert.equal(exit,0,stderr);const report=JSON.parse(stdout);
 assert.equal(report.road.route.duration,150);assert.equal(report.cost.totalCents,800);assert.equal(report.cost.unpriced,1);assert.equal(report.cost.complete,false);assert.equal(report.stops[0].id,store.id);
});
