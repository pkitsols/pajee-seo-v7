'use strict';

const { send,cors,page,query,gemini,cleanText }=require('../api-lib');
const RANGES=['Unknown','0–100','100–500','500–1K','1K–5K','5K+'];
function range(value){const v=cleanText(value);return RANGES.includes(v)?v:'Unknown';}
function signals(value,max=12){return Array.isArray(value)?value.map((x)=>({status:['pass','warn','info'].includes(x?.status)?x.status:'info',title:cleanText(x?.title),detail:cleanText(x?.detail)})).filter((x)=>x.title||x.detail).slice(0,max):[];}
module.exports=async function trafficEstimate(req,res){
  if(cors(req,res))return;if(req.method!=='GET')return send(res,405,{message:'Method not allowed.'});
  try{
    const input=query(req),website=await page(input.url);
    const result=await gemini(`Create a cautious AI-estimated public traffic and behaviour profile using only visible website signals. Never claim access to GA4, server logs, Search Console, advertising accounts or exact competitor traffic. Do not output precise visit numbers. Use only the allowed monthly ranges. Channel shares must be broad percentage bands and total roughly 100%. Confidence Low or Medium.\n\nURL:${website.finalUrl}\nCountry:${input.country||'Pakistan'}\nIndustry:${input.industry||''}\nTitle:${website.title}\nH1:${website.h1.join(' | ')}\nWords:${website.wordCount}\nSchema:${website.schemaTypes.join(', ')}\nResponse:${website.ms}ms\nLinks:${website.links.length}\n\nReturn {"monthlyRange":"Unknown|0–100|100–500|500–1K|1K–5K|5K+","confidence":"Low|Medium","trafficMaturity":"","channelMix":[{"channel":"Organic Search","range":"0–20%"}],"engagementBands":{"engagementRate":"Unknown|Low|Moderate|Strong","pagesPerVisit":"Unknown|1–2|2–4|4+","returningAudience":"Unknown|Low|Moderate|Strong"},"signals":[{"status":"info|warn|pass","title":"","detail":""}],"recommendations":[{"status":"info|warn|pass","title":"","detail":""}]}.`);
    return send(res,200,{sourceLabel:'AI Estimated',dataType:'Public estimate — not verified analytics',disclaimer:'The ranges below are inferred from public website signals. Connect GA4 for verified users, sessions, channels, engagement and conversions.',site:{name:website.siteName,url:website.finalUrl,favicon:website.favicon,title:website.title},monthlyRange:range(result.monthlyRange),confidence:String(result.confidence).toLowerCase()==='medium'?'Medium':'Low',trafficMaturity:cleanText(result.trafficMaturity,'Not enough evidence'),channelMix:Array.isArray(result.channelMix)?result.channelMix.map((x)=>({channel:cleanText(x?.channel),range:cleanText(x?.range)})).filter((x)=>x.channel).slice(0,10):[],engagementBands:result.engagementBands||{},signals:signals(result.signals),recommendations:signals(result.recommendations)});
  }catch(error){return send(res,400,{message:error.message});}
};
