import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server/index.mjs';
test('HTTP boundary authenticates, restricts origins and serves only static frontend files',async t=>{
  const token='test-only-abcdefghijklmnopqrstuvwxyz';
  const server=createServer({NODE_ENV:'production',API_TOKEN:token,ALLOWED_ORIGINS:'https://example.github.io'}, {maps:{geocode:async()=>[{lat:40,lon:-80,label:'Fixture only'}]}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({query:'fixture'})});
  assert.equal((await post('/api/geocode')).status,401);
  assert.equal((await post('/api/geocode',{Origin:'https://unwanted.example',Authorization:`Bearer ${token}`})).status,403);
  const response=await post('/api/geocode',{Origin:'https://example.github.io',Authorization:`Bearer ${token}`});assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'https://example.github.io');assert.equal((await response.json())[0].lat,40);
  assert.equal((await fetch(base+'/index.html')).status,200);assert.equal((await fetch(base+'/server/index.mjs')).status,404);
});
test('production refuses an unprotected scraping service',()=>{assert.throws(()=>createServer({NODE_ENV:'production'}),/API_TOKEN/);assert.throws(()=>createServer({ALLOWED_ORIGINS:'*'}),/exact origins/);});
