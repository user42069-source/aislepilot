import { normalize, kmBetween, validPoint } from '../site/core.mjs';

const STOP_WORDS=new Set(['a','an','the','of','and','with','please','some','organic']);
export function matchProduct(query,title) {
  // Deterministic candidate matching, never proof of the exact SKU/edition/size.
  const wanted=normalize(query).split(' ').filter(w=>!STOP_WORDS.has(w));
  const words=new Set(normalize(title).split(' '));
  const singular=w=>w.length>3&&w.endsWith('s')?w.slice(0,-1):w;
  const names=new Set([...words].map(singular));
  const hits=wanted.filter(w=>names.has(singular(w))).length;
  const accessory=/\b(pump|hoop|rack|case|cover|holder|stand|poster|summary|study guide)\b/.test(normalize(title))&&!/\b(pump|hoop|rack|case|cover|holder|stand|poster|summary|study guide)\b/.test(normalize(query));
  return {score:wanted.length?hits/wanted.length:0,allTerms:!!wanted.length&&hits===wanted.length&&!accessory};
}
function flatten(value,out=[],seen=new Set()) {
  if(!value||typeof value!=='object'||seen.has(value))return out;
  seen.add(value);
  if(Array.isArray(value))value.forEach(v=>flatten(v,out,seen));
  else {out.push(value);Object.values(value).forEach(v=>flatten(v,out,seen));}
  return out;
}
function typeIs(value,type){return (Array.isArray(value)?value:[value]).some(t=>String(t||'').split(/[\/#]/).pop()===type);}
function parsePrice(value) {
  const text=String(value??'').trim();
  if(!/^\d+(?:\.\d{1,4})?$/.test(text))return null;
  const number=Number(text);return Number.isFinite(number)&&number>=0&&number<=1000000?number:null;
}
function safeSource(value,fallback) {
  try{const u=new URL(value||fallback,fallback);return u.protocol==='https:'&&u.hostname===new URL(fallback).hostname?u.href:fallback;}catch{return fallback;}
}
export function extractCandidates(documents, query, pageUrl, store, checkedAt=new Date().toISOString()) {
  const nodes=flatten(documents), byId=new Map(nodes.filter(n=>n['@id']).map(n=>[n['@id'],n]));
  const resolve=v=>v?.['@id']?{...byId.get(v['@id']),...v}:v;
  const result=[];
  for(const product of nodes.filter(n=>typeIs(n['@type'],'Product'))) {
    if(typeof product.name!=='string')continue;
    const matching=matchProduct(query,product.name);
    if(matching.score<0.5)continue;
    const offers=(Array.isArray(product.offers)?product.offers:[product.offers]).filter(Boolean).map(resolve);
    for(const offer of offers) {
      // AggregateOffer.lowPrice is a range boundary, not an observed unit price.
      if(typeIs(offer['@type'],'AggregateOffer'))continue;
      const price=parsePrice(offer.price??offer.priceSpecification?.price);
      const currency=String(offer.priceCurrency??offer.priceSpecification?.priceCurrency??'').toUpperCase();
      if(price===null||!(/^[A-Z]{3}$/).test(currency))continue;
      const availability=String(offer.availability||'').split(/[\/#]/).pop()||'Unknown';
      const place=resolve(offer.availableAtOrFrom);
      const branch={lat:Number(place?.geo?.latitude),lon:Number(place?.geo?.longitude)};
      const branchMatched=validPoint(branch)&&validPoint(store)&&kmBetween(branch,store)<0.2;
      const expiry=String(offer.priceValidUntil||'');
      const expiryTime=Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(expiry)?expiry+'T23:59:59Z':expiry);
      const expired=Number.isFinite(expiryTime)&&expiryTime<Date.parse(checkedAt);
      result.push({name:product.name.slice(0,300),sku:String(product.sku||product.gtin||'').slice(0,80),price,currency,url:safeSource(offer.url||product.url,pageUrl),checkedAt,availability,scope:branchMatched?'Selected branch reported in structured offer':'Online listing; selected branch unverified',branchMatched,eligible:matching.allTerms&&!expired&&!['OutOfStock','Discontinued','SoldOut'].includes(availability),matchScore:matching.score,matchDescription:matching.allTerms?'Query words matched; verify size, variant and package':'Partial text match; excluded from estimate',expired});
    }
  }
  return result.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.matchScore-a.matchScore||Number(b.branchMatched)-Number(a.branchMatched));
}
