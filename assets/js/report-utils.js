(()=>{
  'use strict';
  const esc=(v='')=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const api=async(action,{method='GET',params={},body}={})=>{
    const url=new URL('/api/router',location.origin);url.searchParams.set('action',action);
    Object.entries(params||{}).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')url.searchParams.set(k,String(v))});
    const opts={method,headers:{}};
    if(body!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body)}
    const r=await fetch(url,opts);let data;try{data=await r.json()}catch{throw new Error(`The ${action} service returned an unreadable response.`)}
    if(!r.ok)throw new Error(data.message||`The ${action} request failed.`);return data;
  };
  const params=()=>Object.fromEntries(new URLSearchParams(location.search));
  const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const fmt=(v,d=0)=>new Intl.NumberFormat('en-PK',{maximumFractionDigits:d}).format(num(v));
  const pct=(v,d=1)=>`${fmt(num(v)*100,d)}%`;
  const scoreClass=s=>s==null?'warn':s>=90?'good':s>=50?'warn':'poor';
  const metricClass=s=>s==='good'?'good':s==='poor'?'poor':'warn';
  const ring=(score,label)=>`<div class="score-ring ${scoreClass(score)}" style="--value:${Math.max(0,Math.min(100,num(score)))}"><strong>${score==null?'—':Math.round(score)}</strong><small>${esc(label)}</small></div>`;
  const metric=(label,value,status='warn',help='')=>`<article class="metric-card ${metricClass(status)}"><div class="metric-label"><span>${esc(label)}</span>${help?`<button class="help-button" type="button" data-help-title="${esc(label)}" data-help="${esc(help)}">?</button>`:''}</div><strong>${esc(value??'—')}</strong></article>`;
  const tag=(label,type='live')=>`<span class="tag tag-${type}">${esc(label)}</span>`;
  const issue=(x={})=>`<article class="issue ${x.status||'info'}" data-severity="${x.status||'info'}"><span class="issue-dot"></span><div><strong>${esc(x.title||'Finding')}</strong><small>${esc(x.detail||'')}</small>${x.url?`<small><a target="_blank" rel="noopener" href="${esc(x.url)}">${esc(x.url)}</a></small>`:''}${x.evidence?`<small><b>Evidence:</b> ${esc(x.evidence)}</small>`:''}</div>${x.fix?`<button class="help-button" type="button" data-help-title="${esc(x.title||'How to fix')}" data-help="${esc(x.fix)}">?</button>`:''}</article>`;
  const statusMessage=(el,text,type='blue')=>{el.innerHTML=`<div class="notice notice-${type}">${esc(text)}</div>`};
  const csv=(filename,rows)=>{if(!rows?.length)return;const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;const content=[keys.map(q).join(','),...rows.map(r=>keys.map(k=>q(typeof r[k]==='object'?JSON.stringify(r[k]):r[k])).join(','))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
  const dateInput=(offset=0)=>{const d=new Date();d.setDate(d.getDate()+offset);return d.toISOString().slice(0,10)};
  const delta=(v,inverse=false)=>{const n=num(v);const good=inverse?n<0:n>0;const bad=inverse?n>0:n<0;return `<span class="delta ${good?'up':bad?'down':'flat'}">${n>0?'+':''}${fmt(n,2)}</span>`};
  const humanMs=v=>{const n=num(v);return n>=1000?`${(n/1000).toFixed(2)} s`:`${Math.round(n)} ms`};
  const bytes=v=>{const n=num(v);return n>=1048576?`${(n/1048576).toFixed(1)} MB`:n>=1024?`${(n/1024).toFixed(1)} KB`:`${Math.round(n)} B`};
  const loading=(title='Building your report…',steps=[])=>`<section class="result-shell"><div class="result-head"><span class="tag tag-google">Live analysis</span><h2 style="margin-top:14px">${esc(title)}</h2><p>Keep this tab open while the report gathers evidence.</p></div><div class="result-body"><div class="progress-track"><span data-progress-bar style="width:8%"></span></div><div class="issue-list" data-progress-list>${steps.map((s,i)=>`<article class="issue info" data-progress-step="${i}"><span class="issue-dot"></span><div><strong>${esc(s)}</strong><small>Waiting</small></div></article>`).join('')}</div></div></section>`;
  const step=(root,index,state,detail='')=>{const el=root.querySelector(`[data-progress-step="${index}"]`);if(!el)return;el.className=`issue ${state==='done'?'pass':state==='error'?'fail':'info'}`;const small=el.querySelector('small');if(small)small.textContent=detail||(state==='done'?'Complete':state==='error'?'Could not complete':'Running');const all=[...root.querySelectorAll('[data-progress-step]')];const done=all.filter(x=>x.classList.contains('pass')||x.classList.contains('fail')).length;const bar=root.querySelector('[data-progress-bar]');if(bar)bar.style.width=`${Math.max(8,Math.round(done/all.length*100))}%`};
  const pageTable=(rows,cols)=>`<div class="table-wrap"><table class="data-table"><thead><tr>${cols.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${c.render?c.render(r):esc(r[c.key]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  window.ReportUI={esc,api,params,num,fmt,pct,scoreClass,metricClass,ring,metric,tag,issue,statusMessage,csv,dateInput,delta,humanMs,bytes,loading,step,pageTable};
})();
