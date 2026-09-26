import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCandidates,matchProduct} from '../server/evidence.mjs';
import {allowedURL,RETAILERS} from '../server/retailers.mjs';
import {isPublicIP} from '../server/scraper.mjs';
const now='2026-09-24T12:00:00Z',store={lat:40,lon:-80};
const product={"@type":"Product",name:'Example basketball',offers:{"@type":"Offer",price:'24.95',priceCurrency:'USD',availability:'https://schema.org/InStock'}};
test('online InStock is not selected-branch stock',()=>{const q=extractCandidates([product],'basketball','https://www.dickssportinggoods.com/p/example',store,now)[0];assert.equal(q.price,24.95);assert.equal(q.branchMatched,false);assert.match(q.scope,/unverified/);assert.equal(q.checkedAt,now);});
test('branch scope requires a matching location in the observed offer',()=>{const q=extractCandidates([{...product,offers:{...product.offers,availableAtOrFrom:{geo:{latitude:40,longitude:-80}}}}],'basketball','https://www.dickssportinggoods.com/p/example',store,now)[0];assert.equal(q.branchMatched,true);});
test('aggregate ranges, missing currency, expiry and out-of-stock cannot become current unit estimates',()=>{
  assert.equal(extractCandidates([{...product,offers:{'@type':'AggregateOffer',lowPrice:10,highPrice:50,priceCurrency:'USD'}}],'basketball','https://www.target.com/p/a',store,now).length,0);
  assert.equal(extractCandidates([{...product,offers:{price:10}}],'basketball','https://www.target.com/p/a',store,now).length,0);
  for(const changed of [{priceValidUntil:'2025-01-01'},{availability:'https://schema.org/OutOfStock'}])assert.equal(extractCandidates([{...product,offers:{...product.offers,...changed}}],'basketball','https://www.target.com/p/a',store,now)[0].eligible,false);
});
test('partial product and accessory matches remain candidates only',()=>{assert.equal(matchProduct('Spalding basketball','Wilson basketball').allTerms,false);assert.equal(matchProduct('basketball','basketball pump').allTerms,false);assert.equal(matchProduct('apples','fresh apple').allTerms,true);});
test('structured graph references resolve offer data',()=>{const doc={'@graph':[{'@type':'Product',name:'basketball',offers:{'@id':'offer1'}},{'@id':'offer1','@type':'Offer',price:20,priceCurrency:'USD'}]};assert.equal(extractCandidates([doc],'basketball','https://www.target.com/p/a',store,now)[0].price,20);});
test('product URLs stay on the selected retailer and public addresses only',()=>{
  const r=RETAILERS[0];assert.equal(allowedURL('https://www.dickssportinggoods.com/p/test#reviews',r),'https://www.dickssportinggoods.com/p/test');
  for(const u of ['http://www.dickssportinggoods.com/p/a','https://www.dickssportinggoods.com.evil.example/a','https://user:pass@www.dickssportinggoods.com/','https://127.0.0.1/'])assert.throws(()=>allowedURL(u,r));
  for(const ip of ['127.0.0.1','169.254.169.254','10.0.0.1','172.20.0.1','192.168.0.1','::1','::ffff:127.0.0.1','fd00::1'])assert.equal(isPublicIP(ip),false);
  assert.equal(isPublicIP('8.8.8.8'),true);
});
