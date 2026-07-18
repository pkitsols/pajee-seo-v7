(()=>{
 const q=(s,c=document)=>c.querySelector(s),qa=(s,c=document)=>[...c.querySelectorAll(s)];
 // Keep desktop menus within the visible header width and allow keyboard focus.
 qa('.nav-item').forEach(item=>{const trigger=q('.nav-trigger',item),menu=q('.mega',item);if(!trigger||!menu)return;trigger.setAttribute('aria-haspopup','true');trigger.setAttribute('aria-expanded','false');item.addEventListener('mouseenter',()=>trigger.setAttribute('aria-expanded','true'));item.addEventListener('mouseleave',()=>trigger.setAttribute('aria-expanded','false'));item.addEventListener('focusin',()=>trigger.setAttribute('aria-expanded','true'));item.addEventListener('focusout',e=>{if(!item.contains(e.relatedTarget))trigger.setAttribute('aria-expanded','false')})});
 // Compact/load-more lists used in reports.
 document.addEventListener('click',e=>{const b=e.target.closest('[data-v10-loadmore]');if(!b)return;const wrap=document.querySelector(b.dataset.v10Loadmore);if(!wrap)return;qa('[data-v10-hidden]',wrap).slice(0,8).forEach(x=>{x.hidden=false;x.removeAttribute('data-v10-hidden')});if(!q('[data-v10-hidden]',wrap))b.remove()});
 // Prevent social links with placeholder # from jumping to top until real URLs are supplied.
 qa('.social-link[href="#"]').forEach(a=>a.addEventListener('click',e=>e.preventDefault()));
})();