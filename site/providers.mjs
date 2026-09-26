import { validPoint, storesFromOSM } from './core.mjs';
export const DEFAULT_PROVIDERS={photon:'https://photon.komoot.io',overpass:'https://overpass-api.de/api/interpreter',osrm:'https://router.project-osrm.org'};
export async function fetchJSON(url, options={}) {
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000);
  let response;
  try { response=await fetch(url,{...options,signal}); }
  catch(e){if(e.name==='AbortError')throw e;throw new Error(`Data service could not be reached (${new URL(url).hostname}). Try again or connect a backend.`);}
  if(!response.ok)throw new Error(`Data service returned HTTP ${response.status} (${new URL(url).hostname}).`);
  const data=await response.json();
  if(data.remark)throw new Error(`Store lookup could not complete: ${data.remark.slice(0,180)}`);
  return data;
}
function validatePoints(points,max=25) {
  if(!Array.isArray(points)||points.length<2||points.length>max||!points.every(validPoint))throw new Error('Invalid route coordinates.');
  return points.map(p=>`${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
}
export function createProviders(config=DEFAULT_PROVIDERS, request=fetchJSON) {
  return {
    async geocode({query},signal) {
      if(typeof query!=='string'||query.trim().length<3||query.length>300)throw new Error('Enter an address with a city and region.');
      const url=new URL('/api/',config.photon);url.search=new URLSearchParams({q:query,limit:'5',lang:'en'});
      const data=await request(url.toString(),{signal});
      return (data.features||[]).map(f=>{
        const p=f.properties||{}, coords=f.geometry?.coordinates||[];
        return {lat:coords[1],lon:coords[0],label:[p.name,[p.housenumber,p.street].filter(Boolean).join(' '),p.city||p.town||p.village,p.state,p.postcode,p.country].filter((v,i,a)=>v&&a.indexOf(v)===i).join(', '),precision:p.housenumber?'Street address':p.street?'Street-level match; confirm the pin':'Area or place match; confirm the pin',source:'Photon / OpenStreetMap'};
      }).filter(validPoint);
    },
    async stores({origin,radiusKm=8},signal) {
      if(!validPoint(origin)||!Number.isFinite(radiusKm)||radiusKm<1||radiusKm>20)throw new Error('Use a search radius between 1 and 20 km.');
      const around=`around:${Math.round(radiusKm*1000)},${origin.lat},${origin.lon}`;
      const query=`[out:json][timeout:25];(nwr[shop~"^(supermarket|greengrocer|convenience|sports|outdoor|garden_centre|houseware|interior_decoration|furniture|department_store|books|hardware|doityourself|chemist|electronics|computer|pet)$"](${around});nwr[amenity=pharmacy](${around}););out center tags 1500;`;
      const data=await request(config.overpass,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({data:query}).toString(),signal});
      return {stores:storesFromOSM(data,origin),truncated:(data.elements||[]).length>=1500};
    },
    async matrix({points},signal) {
      const coords=validatePoints(points), radiuses=points.map(()=>250).join(';');
      const data=await request(`${config.osrm.replace(/\/$/,'')}/table/v1/driving/${coords}?annotations=duration&radiuses=${radiuses}`,{signal});
      if(data.code!=='Ok')throw new Error(`Driving matrix unavailable: ${data.message||data.code}. Try another origin or exclude an inaccessible store.`);
      return {durations:data.durations,sources:data.sources};
    },
    async route({points},signal) {
      const coords=validatePoints(points,10), radiuses=points.map(()=>250).join(';');
      const data=await request(`${config.osrm.replace(/\/$/,'')}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&continue_straight=false&radiuses=${radiuses}`,{signal});
      if(data.code!=='Ok'||!data.routes?.[0])throw new Error(`Driving route unavailable: ${data.message||data.code}.`);
      return {route:data.routes[0],waypoints:data.waypoints};
    }
  };
}
export function createAPI(base,token='',onError=null) {
  const clean=base.replace(/\/$/,'');
  return Object.fromEntries(['geocode','stores','matrix','route','quote'].map(name=>[name,async(payload,signal)=>{
    const response=await fetch(`${clean}/api/${name}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(payload),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(name==='quote'?70000:50000)]):AbortSignal.timeout(70000)});
    const data=await response.json().catch(()=>({error:`Backend returned HTTP ${response.status}.`}));
    if(!response.ok){onError?.(data);throw new Error(data.error||`HTTP ${response.status}`);}return data;
  }]));
}
