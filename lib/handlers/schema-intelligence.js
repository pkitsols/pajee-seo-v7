'use strict';

const { send, cors, getBody, page, gemini, cleanText, fetchText, publicUrl } = require('../api-lib');

const COMMON_FIELDS = {
  Organization:['name','url'], LocalBusiness:['name','address','telephone'], Service:['name','provider'],
  Product:['name','image','offers'], Offer:['price','priceCurrency','availability'], Article:['headline','author','datePublished','image'],
  NewsArticle:['headline','author','datePublished','image'], BlogPosting:['headline','author','datePublished'], BreadcrumbList:['itemListElement'],
  Event:['name','startDate','location'], JobPosting:['title','description','datePosted','hiringOrganization'], Course:['name','description','provider'],
  Recipe:['name','image','recipeIngredient'], VideoObject:['name','thumbnailUrl','uploadDate'], SoftwareApplication:['name','operatingSystem'],
  Person:['name'], ProfilePage:['mainEntity'], Dataset:['name','description'], WebSite:['name','url'], WebPage:['name','url'], FAQPage:['mainEntity'], HowTo:['name','step']
};
const SUPPORTED_TYPES = Object.keys(COMMON_FIELDS);
function findObjects(value, output=[]) { if(Array.isArray(value)) value.forEach((i)=>findObjects(i,output)); else if(value&&typeof value==='object'){ if(value['@type']) output.push(value); Object.values(value).forEach((i)=>findObjects(i,output)); } return output; }
function missing(object,fields){return fields.filter((field)=>object[field]==null||object[field]==='');}
function microdata(html){return [...html.matchAll(/itemtype\s*=\s*["']https?:\/\/schema\.org\/([^"']+)["']/gi)].map((m)=>m[1]);}
function rdfa(html){return [...html.matchAll(/typeof\s*=\s*["']([^"']+)["']/gi)].flatMap((m)=>m[1].split(/\s+/)).filter(Boolean);}
function cleanRecommendation(item){const type=cleanText(item?.type),reason=cleanText(item?.reason);return type&&reason?{type,reason}:null;}
function analysePage(webpage){
  const objects=findObjects(webpage.blocks.filter((b)=>b.valid).map((b)=>b.data));
  const micro=microdata(webpage.html),rdf=rdfa(webpage.html),findings=[];
  for(const block of webpage.blocks) if(!block.valid) findings.push({status:'fail',title:'Invalid JSON-LD syntax',detail:block.error,url:webpage.finalUrl});
  for(const object of objects){
    const raw=Array.isArray(object['@type'])?object['@type'][0]:object['@type']; const type=cleanText(raw,'Unknown'); const gaps=missing(object,COMMON_FIELDS[type]||[]);
    findings.push({status:gaps.length?'warn':'pass',title:`${type} schema ${gaps.length?'needs review':'found'}`,detail:gaps.length?`Commonly expected fields missing: ${gaps.join(', ')}`:'No common field gaps were detected by the local checker.',url:webpage.finalUrl,type,gaps});
  }
  if(!objects.length&&!micro.length&&!rdf.length) findings.push({status:'warn',title:'No structured data detected',detail:'No parseable JSON-LD, Schema.org Microdata or RDFa type attributes were found.',url:webpage.finalUrl});
  return {url:webpage.finalUrl,title:webpage.title,h1:webpage.h1?.[0]||'',validBlocks:webpage.blocks.filter((b)=>b.valid).length,invalidBlocks:webpage.blocks.filter((b)=>!b.valid).length,types:[...new Set([...webpage.schemaTypes,...micro,...rdf])],findings,webpage};
}
function deterministic(webpage,type,fields={}){
  const base={'@context':'https://schema.org','@type':type,name:fields.name||webpage.h1[0]||webpage.title||'Page',url:fields.url||webpage.finalUrl,description:fields.description||webpage.description||''};
  if(type==='Organization'||type==='LocalBusiness') Object.assign(base,{name:fields.name||webpage.siteName||'Organization',logo:fields.logo||webpage.og.image||'',email:fields.email||'',telephone:fields.telephone||'',address:{'@type':'PostalAddress',streetAddress:fields.streetAddress||'',addressLocality:fields.addressLocality||'',addressRegion:fields.addressRegion||'',postalCode:fields.postalCode||'',addressCountry:fields.addressCountry||''}});
  if(type==='Service') Object.assign(base,{serviceType:fields.serviceType||webpage.h1[0]||webpage.title,areaServed:fields.areaServed||'',provider:{'@type':'Organization',name:fields.providerName||webpage.siteName||'Organization',url:fields.providerUrl||new URL(webpage.finalUrl).origin}});
  if(['Article','BlogPosting','NewsArticle'].includes(type)) Object.assign(base,{headline:fields.headline||webpage.h1[0]||webpage.title,author:{'@type':fields.authorType||'Organization',name:fields.authorName||webpage.siteName||'Publisher'},datePublished:fields.datePublished||'',dateModified:fields.dateModified||'',image:fields.image||webpage.og.image||''});
  if(type==='Product') Object.assign(base,{image:fields.image||webpage.og.image||'',sku:fields.sku||'',brand:fields.brand?{'@type':'Brand',name:fields.brand}:undefined,offers:{'@type':'Offer',priceCurrency:fields.priceCurrency||'',price:fields.price||'',availability:fields.availability||'https://schema.org/InStock',url:fields.url||webpage.finalUrl}});
  if(type==='BreadcrumbList') return {'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Home',item:new URL(webpage.finalUrl).origin},{'@type':'ListItem',position:2,name:webpage.h1[0]||webpage.title,item:webpage.finalUrl}]};
  if(type==='WebSite') Object.assign(base,{potentialAction:fields.searchTarget?{'@type':'SearchAction',target:`${fields.searchTarget}{search_term_string}`,'query-input':'required name=search_term_string'}:undefined});
  return JSON.parse(JSON.stringify(base));
}
async function discoverUrls(url,max=20){
  const first=await page(url); const origin=new URL(first.finalUrl).origin; let robots='';
  try{const r=await fetchText(`${origin}/robots.txt`,{timeout:7000,max:250000,accept:'text/plain,*/*'});if(r.response.ok)robots=r.text;}catch{}
  const queue=[`${origin}/sitemap.xml`,`${origin}/sitemap_index.xml`]; for(const m of robots.matchAll(/^sitemap:\s*(.+)$/gim))queue.unshift(m[1].trim());
  const visited=new Set(),urls=[first.finalUrl];
  while(queue.length&&urls.length<max&&visited.size<15){const candidate=queue.shift();if(visited.has(candidate))continue;visited.add(candidate);try{const r=await fetchText(candidate,{timeout:9000,max:1500000,accept:'application/xml,text/xml,text/plain'});if(!r.response.ok)continue;const locs=[...r.text.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)].map((m)=>m[1].trim().replace(/&amp;/g,'&')).filter((x)=>{try{return new URL(x).origin===origin}catch{return false}});if(/<sitemapindex\b/i.test(r.text))queue.push(...locs.slice(0,15));else urls.push(...locs);}catch{}}
  if(urls.length===1)urls.push(...first.links.filter((l)=>{try{return new URL(l.url).origin===origin}catch{return false}}).map((l)=>l.url));
  return [...new Set(urls)].slice(0,max);
}
async function mapLimit(items,limit,worker){const out=new Array(items.length);let i=0;async function run(){while(i<items.length){const x=i++;try{out[x]=await worker(items[x])}catch(e){out[x]={error:e.message,url:items[x]}}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return out;}

module.exports=async function schemaIntelligence(req,res){
  if(cors(req,res))return;
  if(req.method!=='POST')return send(res,405,{message:'Method not allowed.'});
  try{
    const body=getBody(req); const mode=cleanText(body.mode,'analyse');
    if(mode==='generate-manual'){
      const type=SUPPORTED_TYPES.includes(body.type)?body.type:'WebPage';
      const fake=await page(body.url||body.pageUrl||'https://pajeeseo.pk/');
      const generated=deterministic(fake,type,body.fields||{});
      return send(res,200,{sourceLabel:'Schema generator',chosenType:type,generationSource:'User inputs + rule-based Schema.org template',generated,missingFields:missing(generated,COMMON_FIELDS[type]||[])});
    }
    const scope=body.scope==='site'?'site':'page'; const maxPages=Math.min(50,Math.max(1,Number(body.maxPages)||15));
    const urls=scope==='site'?await discoverUrls(body.url,maxPages):[await publicUrl(body.url)];
    const crawled=await mapLimit(urls,4,async(url)=>analysePage(await page(url)));
    const pages=crawled.filter((x)=>!x.error); if(!pages.length)throw new Error(crawled[0]?.error||'No pages could be analysed.');
    const summary={pagesChecked:pages.length,pagesWithSchema:pages.filter((p)=>p.types.length).length,pagesWithoutSchema:pages.filter((p)=>!p.types.length).length,validBlocks:pages.reduce((n,p)=>n+p.validBlocks,0),invalidBlocks:pages.reduce((n,p)=>n+p.invalidBlocks,0),types:[...new Set(pages.flatMap((p)=>p.types))]};
    const primary=pages[0].webpage;
    let analysis,analysisSource='Rule-based fallback';
    try{
      analysis=await gemini(`Analyse the intent and structured-data needs of the crawled website pages. Recommend only schema types supported by visible content. Do not invent reviews, ratings, prices, addresses, dates, authors or business facts.\n\nWebsite: ${primary.finalUrl}\nPages summary: ${JSON.stringify(pages.map((p)=>({url:p.url,title:p.title,h1:p.h1,types:p.types,findings:p.findings.map((f)=>f.title)}))).slice(0,24000)}\n\nReturn {"siteIntent":"","pageRecommendations":[{"url":"","intent":"","recommendedTypes":[{"type":"","reason":""}]}],"priorityRecommendations":[{"type":"","reason":""}],"preferredType":""}.`);
      analysisSource='AI-assisted intent analysis';
    }catch{analysis={siteIntent:'General website',pageRecommendations:[],priorityRecommendations:[{type:'WebPage',reason:'General page description'}],preferredType:'WebPage'};}
    const recommendations=(analysis.priorityRecommendations||analysis.recommendations||[]).map(cleanRecommendation).filter(Boolean).slice(0,20);
    if(!recommendations.length)recommendations.push({type:'WebPage',reason:'WebPage is a safe general type for a standard page.'});
    const requested=cleanText(body.type); const chosen=SUPPORTED_TYPES.includes(requested)?requested:(SUPPORTED_TYPES.includes(analysis.preferredType)?analysis.preferredType:recommendations[0].type||'WebPage');
    let generated=null,generationSource=null;
    if(body.generate){
      try{const ai=await gemini(`Generate one valid ${chosen} Schema.org JSON-LD object using only visible facts from this page. Never invent ratings, reviews, price, phone, address, dates, author or offers. Use empty strings for genuinely missing user-supplied facts. Return the object only.\nURL:${primary.finalUrl}\nTitle:${primary.title}\nDescription:${primary.description}\nH1:${primary.h1.join(' | ')}\nSite name:${primary.siteName}\nImage:${primary.og.image}\nExcerpt:${primary.textExcerpt.slice(0,9000)}`);generated=ai?.schema||ai?.jsonLd||ai;if(Array.isArray(generated))generated=generated[0];if(!generated||typeof generated!=='object')generated=null;else generated={'@context':generated['@context']||'https://schema.org','@type':generated['@type']||chosen,...generated};generationSource=generated?'AI-assisted from visible page evidence':null;}catch{}
      if(!generated){generated=deterministic(primary,chosen,body.fields||{});generationSource='Rule-based template from crawled page fields';}
    }
    return send(res,200,{
      sourceLabel:'Public crawl + structured-data parser',scope,summary,
      validatorNotice:'Syntax and common-field checks are shown here. Use Google Rich Results Test for Google-supported eligibility and Schema.org Validator for general vocabulary validation.',
      pages:pages.map((p)=>({url:p.url,title:p.title,h1:p.h1,types:p.types,validBlocks:p.validBlocks,invalidBlocks:p.invalidBlocks,findings:p.findings})),
      siteIntent:cleanText(analysis.siteIntent||analysis.pageIntent,'General website'),analysisSource,
      pageRecommendations:Array.isArray(analysis.pageRecommendations)?analysis.pageRecommendations.slice(0,50):[],recommendations,chosenType:chosen,generationSource,generated,
      supportedTypes:SUPPORTED_TYPES
    });
  }catch(error){return send(res,400,{message:error.message});}
};
