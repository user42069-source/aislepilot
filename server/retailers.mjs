// Public-page adapters. Search URLs and page layouts can change independently.
// Unknown/local retailers stay unverified. Add a vetted adapter here to expand.
export const RETAILERS = [
  {id:'dicks',name:"DICK’S Sporting Goods",match:/dick.?s sporting/i,host:'www.dickssportinggoods.com',search:q=>`https://www.dickssportinggoods.com/search/SearchDisplay?searchTerm=${encodeURIComponent(q)}`,product:/\/p\//},
  {id:'barnes',name:'Barnes & Noble',match:/barnes\s*(?:&|and)\s*noble/i,host:'www.barnesandnoble.com',search:q=>`https://www.barnesandnoble.com/s/${encodeURIComponent(q)}`,product:/\/w\//},
  {id:'walmart',name:'Walmart',match:/\bwalmart\b/i,host:'www.walmart.com',search:q=>`https://www.walmart.com/search?q=${encodeURIComponent(q)}`,product:/\/ip\//},
  {id:'target',name:'Target',match:/\btarget\b/i,host:'www.target.com',search:q=>`https://www.target.com/s?searchTerm=${encodeURIComponent(q)}`,product:/\/p\//},
  {id:'bestbuy',name:'Best Buy',match:/best buy/i,host:'www.bestbuy.com',search:q=>`https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(q)}`,product:/\/site\/.+\.p(?:\?|$)/},
  {id:'petco',name:'Petco',match:/\bpetco\b/i,host:'www.petco.com',search:q=>`https://www.petco.com/shop/en/petcostore/search?query=${encodeURIComponent(q)}`,product:/\/product\//},
  {id:'homedepot',name:'The Home Depot',match:/home depot/i,host:'www.homedepot.com',search:q=>`https://www.homedepot.com/s/${encodeURIComponent(q)}`,product:/\/p\//},
  {id:'gianteagle',name:'Giant Eagle',match:/giant eagle/i,host:'www.gianteagle.com',search:null,product:/\/p\//,reason:'This adapter has no public, branch-specific inventory search. Check the retailer directly or add a unit budget.'},
  {id:'homegoods',name:'HomeGoods',match:/home\s?goods/i,host:'www.homegoods.com',search:null,product:/\/p\//,reason:'No supported public product inventory feed for this store. A category match does not verify an individual item.'}
];
export const retailerFor=store=>RETAILERS.find(r=>r.match.test(store.name||''))||null;
export function allowedURL(input,retailer) {
  let url;try{url=new URL(input);}catch{throw new Error('Invalid product URL.');}
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||url.hostname.replace(/^www\./,'')!==retailer.host.replace(/^www\./,''))throw new Error('Product link must be an HTTPS page on the selected retailer’s official domain.');
  url.hash='';return url.href;
}
