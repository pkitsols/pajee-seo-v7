(()=>{
 const esc=(s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function lineChart(series,{width=820,height=260,colors=['#2563eb','#94a3b8'],format=(v)=>Math.round(v).toLocaleString()}={}){
   const all=series.flatMap(s=>s.values.map(Number)).filter(Number.isFinite);const max=Math.max(1,...all),min=Math.min(0,...all);const pad={l:48,r:16,t:18,b:34},w=width-pad.l-pad.r,h=height-pad.t-pad.b;
   const x=(i,count)=>pad.l+(count<=1?0:(i/(count-1))*w),y=(v)=>pad.t+h-((v-min)/(max-min||1))*h;
   const grid=[0,.25,.5,.75,1].map(p=>{const v=min+(max-min)*(1-p);return `<line x1="${pad.l}" y1="${pad.t+h*p}" x2="${pad.l+w}" y2="${pad.t+h*p}" stroke="#e2e8f0"/><text x="${pad.l-8}" y="${pad.t+h*p+4}" text-anchor="end" font-size="10" fill="#64748b">${esc(format(v))}</text>`}).join('');
   const lines=series.map((s,si)=>{const pts=s.values.map((v,i)=>`${x(i,s.values.length)},${y(Number(v)||0)}`).join(' ');const area=`${pad.l},${pad.t+h} ${pts} ${pad.l+w},${pad.t+h}`;return `<polygon points="${area}" fill="${colors[si]||colors[0]}" opacity="${si===0?.08:.035}"/><polyline points="${pts}" fill="none" stroke="${colors[si]||colors[0]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`}).join('');
   const labels=(series[0]?.labels||[]);const step=Math.max(1,Math.ceil(labels.length/6));const xlabels=labels.map((l,i)=>i%step===0?`<text x="${x(i,labels.length)}" y="${height-10}" text-anchor="middle" font-size="10" fill="#64748b">${esc(l)}</text>`:'').join('');
   return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Performance chart">${grid}${lines}${xlabels}</svg>`;
 }
 function barChart(items,{width=820,height=270,color='#2563eb',valueKey='value',labelKey='label',format=(v)=>Math.round(v).toLocaleString()}={}){
   const values=items.map(i=>Number(i[valueKey])||0),max=Math.max(1,...values),pad={l:56,r:16,t:15,b:70},w=width-pad.l-pad.r,h=height-pad.t-pad.b,gap=8,bw=Math.max(8,(w-gap*(items.length-1))/Math.max(1,items.length));
   const bars=items.map((item,i)=>{const v=values[i],bh=(v/max)*h,x=pad.l+i*(bw+gap),y=pad.t+h-bh;return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="5" fill="${color}" opacity=".9"><title>${esc(item[labelKey])}: ${esc(format(v))}</title></rect><text transform="translate(${x+bw/2},${height-12}) rotate(-35)" text-anchor="end" font-size="9" fill="#64748b">${esc(String(item[labelKey]).slice(0,18))}</text>`}).join('');
   return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Bar chart"><line x1="${pad.l}" y1="${pad.t+h}" x2="${pad.l+w}" y2="${pad.t+h}" stroke="#cbd5e1"/>${bars}</svg>`;
 }
 function donut(items,{size=230,colors=['#2563eb','#059669','#d97706','#7c3aed','#0891b2','#dc2626']}={}){
   const total=items.reduce((n,i)=>n+Number(i.value||0),0)||1;let offset=0;const r=78,c=2*Math.PI*r;const circles=items.map((item,i)=>{const value=Number(item.value||0),dash=(value/total)*c,html=`<circle cx="115" cy="115" r="${r}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="28" stroke-dasharray="${dash} ${c-dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 115 115)"/>`;offset+=dash;return html}).join('');return `<svg viewBox="0 0 230 230" width="${size}" height="${size}" role="img">${circles}<circle cx="115" cy="115" r="54" fill="#fff"/><text x="115" y="111" text-anchor="middle" font-size="25" font-weight="800" fill="#0f172a">${esc(Math.round(total).toLocaleString())}</text><text x="115" y="132" text-anchor="middle" font-size="11" fill="#64748b">Total</text></svg>`;
 }
 window.PajeeCharts={lineChart,barChart,donut};
})();
