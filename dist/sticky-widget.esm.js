var Te=`
.fbw-fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  transition: background-color 0.2s, transform 0.15s;
  font-size: 20px;
  line-height: 1;
  color: #fff;
}
.fbw-fab:hover { transform: scale(1.08); }
.fbw-fab:focus-visible { outline: 2px solid #f5c518; outline-offset: 3px; box-shadow: 0 0 0 4px rgba(245,197,24,0.35); }
.fbw-fab--idle { background-color: #f5c518; color: #000; }
.fbw-fab--active { background-color: #dc2626; }

.fbw-popover {
  position: fixed;
  z-index: var(--fbw-z-popover, 99995);
  width: 320px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.18);
  padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #1f2937;
}

.fbw-popover__label {
  font-weight: 600;
  margin-bottom: 4px;
  font-size: 13px;
  color: #6b7280;
}

.fbw-popover__selected-text {
  background: #fef3c7;
  border-left: 3px solid #f59e0b;
  padding: 6px 10px;
  margin-bottom: 10px;
  font-size: 13px;
  border-radius: 2px;
  max-height: 60px;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
}

.fbw-popover__textarea {
  width: 100%;
  min-height: 80px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
  background: #f5c518;
  color: #000;
}
.fbw-popover__textarea:focus {
  border-color: var(--fbw-accent, #4f46e5);
  box-shadow: 0 0 0 2px rgba(79,70,229,0.15);
}

.fbw-popover__hint {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
  text-align: right;
}

.fbw-popover__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.fbw-popover__btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  transition: background 0.15s;
}
.fbw-popover__btn:hover { background: #f3f4f6; }
.fbw-popover__btn:focus-visible { outline: 2px solid var(--fbw-accent, #4f46e5); outline-offset: 2px; }

.fbw-popover__btn--submit {
  background: var(--fbw-accent, #4f46e5);
  color: #fff;
  border-color: transparent;
}
.fbw-popover__btn--submit:hover { opacity: 0.9; background: var(--fbw-accent, #4f46e5); }
.fbw-popover__btn--submit:disabled { opacity: 0.5; cursor: not-allowed; }

.fbw-toast {
  position: fixed;
  bottom: 84px;
  right: 24px;
  background: #059669;
  color: #fff;
  padding: 10px 18px;
  border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: var(--fbw-z-popover, 99995);
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.2s, transform 0.2s;
}
.fbw-toast--visible { opacity: 1; transform: translateY(0); }
.fbw-toast--error { background: #dc2626; }

.fbw-confirm {
  position: fixed;
  z-index: var(--fbw-z-popover, 99995);
  width: 320px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.18);
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #1f2937;
}
.fbw-confirm__title {
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 8px;
}
.fbw-confirm__message {
  color: #6b7280;
  font-size: 13px;
  margin-bottom: 16px;
  line-height: 1.5;
}
.fbw-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
`,ze=`
.fbw-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.08);
  pointer-events: none;
  z-index: var(--fbw-z, 99990);
}

.fbw-highlight {
  position: fixed;
  border: 2px solid var(--fbw-accent, #4f46e5);
  background: rgba(79, 70, 229, 0.08);
  pointer-events: none;
  z-index: var(--fbw-z-highlight, 99991);
  transition: top 0.12s, left 0.12s, width 0.12s, height 0.12s;
  border-radius: 4px;
}

.fbw-cursor-crosshair, .fbw-cursor-crosshair * { cursor: crosshair !important; }
`,q=null;function ae(e){if(e&&!e.querySelector("style[data-fbw]")){q=e;let o=document.createElement("style");o.setAttribute("data-fbw",""),o.textContent=Te,e.appendChild(o)}if(!document.querySelector("style[data-fbw-light]")){let o=document.createElement("style");o.setAttribute("data-fbw-light",""),o.textContent=ze,document.head.appendChild(o)}}function se(){if(q){let o=q.querySelector("style[data-fbw]");o&&o.remove(),q=null}let e=document.querySelector("style[data-fbw-light]");e&&e.remove()}var k=0,I=null;function Ae(e){let o=[],t=e;for(;t&&t!==document.body&&t!==document.documentElement;)o.push(t),t=t.parentElement;return o}function J(e){e!==I&&(I=e,k=0)}function ce(e){return k=Math.max(0,k+e),j()}function j(){if(!I)return null;let e=Ae(I);if(e.length===0)return null;let o=Math.min(k,e.length-1);return k=o,e[o]}function fe(){k=0,I=null}var E=null,v=null;function ue(){E||(E=document.createElement("div"),E.className="fbw-overlay",document.body.appendChild(E))}function de(){E&&(E.remove(),E=null),F()}function Q(e){v||(v=document.createElement("div"),v.className="fbw-highlight",document.body.appendChild(v)),v.style.top=e.top+"px",v.style.left=e.left+"px",v.style.width=e.width+"px",v.style.height=e.height+"px"}function F(){v&&(v.remove(),v=null)}var c=null,d=null,T=null,te=document.body,Z=null;function pe(e){te=e,Z=e}function me(e,o,t,i){g(),c=document.createElement("div"),c.className="fbw-popover";let n="";o&&(n+='<div class="fbw-popover__label">Selected text</div>',n+=`<div class="fbw-popover__selected-text">${ee(o)}</div>`),n+='<div class="fbw-popover__label">Your comment</div>',n+=`<textarea class="fbw-popover__textarea" placeholder="What's on your mind?" autofocus></textarea>`,n+='<div class="fbw-popover__hint">Press Ctrl+Enter to submit</div>',n+='<div class="fbw-popover__actions">',n+='<button class="fbw-popover__btn fbw-popover__btn--cancel" type="button">Cancel</button>',n+='<button class="fbw-popover__btn fbw-popover__btn--submit" type="button" disabled>Submit</button>',n+="</div>",c.innerHTML=n,te.appendChild(c),Ne(c,e);let r=c.querySelector(".fbw-popover__textarea"),a=c.querySelector(".fbw-popover__btn--submit"),h=c.querySelector(".fbw-popover__btn--cancel");r.addEventListener("input",()=>{a.disabled=!r.value.trim()});let y=()=>{if(a.disabled)return;let p=r.value.trim();p&&(a.disabled=!0,t({comment:p}))};r.addEventListener("keydown",p=>{(p.ctrlKey||p.metaKey)&&p.key==="Enter"&&(p.preventDefault(),y())}),a.addEventListener("click",y),h.addEventListener("click",()=>{De(r,i)}),c.addEventListener("click",p=>p.stopPropagation()),c.addEventListener("mousedown",p=>p.stopPropagation()),Be(c),requestAnimationFrame(()=>r.focus())}function De(e,o){e&&e.value.trim()?be("Discard comment?",'Your comment will be lost. Press "Submit" to save it.',()=>{_(),o()},()=>{_(),e.focus()}):o()}function oe(e,o){if(!c)return!0;if(d)return!1;let t=c.querySelector(".fbw-popover__textarea");return t&&t.value.trim()?(be("Discard comment?",'Your comment will be lost. Press "Submit" to save it.',()=>{_(),o()},()=>{_(),t&&t.focus()},e?()=>{_();let i=t.value.trim();i&&e({comment:i})}:null),!1):!0}function be(e,o,t,i,n){_(),d=document.createElement("div"),d.className="fbw-confirm";let r=`<div class="fbw-confirm__title">${ee(e)}</div>`;r+=`<div class="fbw-confirm__message">${ee(o)}</div>`,r+='<div class="fbw-confirm__actions">',r+='<button class="fbw-popover__btn fbw-popover__btn--cancel" type="button">Discard</button>',n&&(r+='<button class="fbw-popover__btn fbw-popover__btn--submit" type="button">Submit</button>'),r+='<button class="fbw-popover__btn" type="button" style="background:#4f46e5;color:#fff;border-color:transparent;">Go back</button>',r+="</div>",d.innerHTML=r,d.style.top="50%",d.style.left="50%",d.style.transform="translate(-50%, -50%)",te.appendChild(d);let a=d.querySelectorAll("button"),h=a[0],y=n?a[1]:null,p=n?a[2]:a[1];h.addEventListener("click",t),p.addEventListener("click",i),n&&y&&y.addEventListener("click",n),d.addEventListener("click",X=>X.stopPropagation()),d.addEventListener("mousedown",X=>X.stopPropagation()),requestAnimationFrame(()=>p.focus())}function _(){d&&(d.remove(),d=null)}function Be(e){ve(),T=o=>{if(o.key!=="Tab")return;let i=(d||e).querySelectorAll('textarea, button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])');if(i.length===0)return;let n=i[0],r=i[i.length-1],a=Z?Z.activeElement:document.activeElement;o.shiftKey?a===n&&(o.preventDefault(),r.focus()):a===r&&(o.preventDefault(),n.focus())},document.addEventListener("keydown",T,!0)}function ve(){T&&(document.removeEventListener("keydown",T,!0),T=null)}function Ne(e,o){let n=o.bottom+8,r=o.left,a=e.getBoundingClientRect(),h=window.innerWidth,y=window.innerHeight;n+a.height>y-8&&(n=o.top-a.height-8),n<8&&(n=8),r+a.width>h-8&&(r=h-a.width-8),r<8&&(r=8),e.style.top=n+"px",e.style.left=r+"px"}function g(){ve(),_(),c&&(c.remove(),c=null)}function R(e){if(!c)return;let o=c.querySelector(".fbw-popover__btn--submit"),t=c.querySelector(".fbw-popover__textarea");o&&(o.textContent=e?"Submitting\u2026":"Submit",o.disabled=e||!(t&&t.value.trim())),t&&(t.disabled=!!e)}function ge(){return d!==null}function ee(e){let o=document.createElement("div");return o.textContent=e,o.innerHTML}function he(){let e=window.getSelection();return!e||e.isCollapsed||!e.toString().trim()?null:{text:e.toString().trim(),rangeCount:e.rangeCount}}function we(e){if(!e||e===document.body||e===document.documentElement)return e?e.tagName.toLowerCase():"";if(e.id&&document.querySelectorAll(`#${CSS.escape(e.id)}`).length===1)return`#${CSS.escape(e.id)}`;let o=[],t=e;for(;t&&t!==document.body&&t!==document.documentElement;){let i=t.tagName.toLowerCase();if(t.id&&document.querySelectorAll(`#${CSS.escape(t.id)}`).length===1){o.unshift(`#${CSS.escape(t.id)}`);break}let n=t.getAttribute("data-sticky-id");if(n){o.unshift(`[data-sticky-id="${n}"]`);break}let r=t.parentElement;r&&Array.from(r.children).filter(h=>h.tagName===t.tagName).length>1&&(i+=`:nth-child(${Array.from(r.children).indexOf(t)+1})`),o.unshift(i),t=t.parentElement}return o.join(" > ")}var ne=[];function re(e){return ne.push(e),e}function xe(){return[...ne]}function ye(){ne=[]}var z=[],W=!1,A=null,P=null,O=null,D=null;function Ee(e,o=1e3){if(typeof e!="string")try{e=JSON.stringify(e)}catch{e=String(e)}return e.length>o?e.slice(0,o)+"...":e}function U(e,o){let t={level:e,message:Array.from(o).map(i=>Ee(i)).join(" "),timestamp:new Date().toISOString()};z.push(t),z.length>50&&z.shift()}function _e(){W||(W=!0,A=console.error,console.error=function(...e){U("error",e),A.apply(console,e)},P=console.warn,console.warn=function(...e){U("warn",e),P.apply(console,e)},O=e=>{U("error",[`${e.message} at ${e.filename}:${e.lineno}:${e.colno}`])},window.addEventListener("error",O),D=e=>{U("error",[`Unhandled rejection: ${Ee(e.reason)}`])},window.addEventListener("unhandledrejection",D))}function Ce(){W&&(W=!1,A&&(console.error=A),P&&(console.warn=P),A=null,P=null,O&&window.removeEventListener("error",O),D&&window.removeEventListener("unhandledrejection",D),O=null,D=null)}function Se(){return[...z]}function ke(){z=[]}var s={IDLE:"IDLE",ACTIVE:"ACTIVE",POPOVER_OPEN:"POPOVER_OPEN"},b=s.IDLE,l={},f=null,m=null,L=null,u=null,C=null,x=!1,ie=!1,B=null,K=[],N=null,H=null,M=null,V=null,$=null,G=null;function w(e){b=e}function je(){f=document.createElement("button"),f.className="fbw-fab fbw-fab--idle",f.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',f.setAttribute("aria-label","Toggle sticky widget"),f.style.zIndex=(l.zIndexBase||99999)+"",f.addEventListener("click",e=>{e.stopPropagation(),b===s.IDLE?Le():S()}),l.position==="bottom-left"&&(f.style.right="auto",f.style.left="24px"),C.appendChild(f)}function Le(){!x||!f||(w(s.ACTIVE),f.className="fbw-fab fbw-fab--active",f.style.zIndex=(l.zIndexBase||99999)+"",document.documentElement.classList.add("fbw-cursor-crosshair"),ue(),Fe(),l.onOpen&&l.onOpen())}function S(){w(s.IDLE),f&&(f.className="fbw-fab fbw-fab--idle",f.style.zIndex=(l.zIndexBase||99999)+""),document.documentElement.classList.remove("fbw-cursor-crosshair"),de(),g(),Re(),m=null,fe(),l.onClose&&l.onClose()}function Fe(){let e=null;function o(){let t=j();t&&t!==e?(e=t,Q(t.getBoundingClientRect())):t||(F(),e=null)}N=t=>{b===s.ACTIVE&&L===null&&(L=requestAnimationFrame(()=>{if(L=null,b!==s.ACTIVE)return;let i=document.elementFromPoint(t.clientX,t.clientY);if(!i||i===u||i===f||i.closest(".fbw-popover")||i.closest(".fbw-fab")||i.closest(".fbw-confirm")){F(),e=null;return}J(i),o()}))},$=t=>{if(b!==s.ACTIVE)return;t.preventDefault(),t.stopPropagation();let i=t.deltaY>0?1:-1;ce(i),o()},H=t=>{if(t.target!==u)if(b===s.ACTIVE){t.preventDefault(),t.stopPropagation(),t.stopImmediatePropagation();let i=document.elementFromPoint(t.clientX,t.clientY);if(!i||(J(i),m=j(),!m))return;let n=m.getBoundingClientRect(),r=G;G=null,Q(n),w(s.POPOVER_OPEN),me(n,r?r.text:null,({comment:a})=>{le(a,r?r.text:null)},()=>{g(),w(s.ACTIVE)})}else b===s.POPOVER_OPEN&&(t.preventDefault(),t.stopPropagation(),t.stopImmediatePropagation(),oe(({comment:n})=>{le(n,null)},()=>{g(),w(s.ACTIVE)})&&(g(),w(s.ACTIVE)))},M=t=>{if(t.key==="Escape"){if(ge())return;b===s.POPOVER_OPEN?oe(({comment:n})=>{le(n,null)},()=>{g(),w(s.ACTIVE)})&&(g(),w(s.ACTIVE)):b===s.ACTIVE&&S()}},V=()=>{b===s.ACTIVE&&(G=he())},document.addEventListener("mouseup",V,!0),document.addEventListener("mousemove",N,!1),document.addEventListener("wheel",$,{capture:!0,passive:!1}),document.addEventListener("click",H,!0),document.addEventListener("keydown",M,!1)}function Re(){V&&document.removeEventListener("mouseup",V,!0),N&&document.removeEventListener("mousemove",N,!1),$&&document.removeEventListener("wheel",$,!0),H&&document.removeEventListener("click",H,!0),M&&document.removeEventListener("keydown",M,!1),V=null,N=null,$=null,H=null,M=null,G=null,L!==null&&(cancelAnimationFrame(L),L=null)}function Ue(){return{userAgent:navigator.userAgent,viewport:`${window.innerWidth}x${window.innerHeight}`,screenSize:`${screen.width}x${screen.height}`,language:navigator.language,url:window.location.href,referrer:document.referrer||null,timestamp:new Date().toISOString()}}function le(e,o){if(!x||!m)return;if(!document.contains(m)){g(),S();return}let t=m.getBoundingClientRect(),i=m.getAttribute("aria-label")||m.getAttribute("data-sticky-id")||(m.innerText||"").slice(0,80).trim()||null,n={id:typeof crypto<"u"&&crypto.randomUUID?crypto.randomUUID():"stw-"+Date.now()+"-"+Math.random().toString(36).slice(2,8),timestamp:new Date().toISOString(),pageUrl:window.location.href,target:{selector:we(m),tagName:m.tagName.toLowerCase(),id:m.id||null,label:i,rect:{top:t.top,left:t.left,width:t.width,height:t.height}},selectedText:o||null,comment:e,metadata:Ue(),consoleLogs:Se()};if(l.user&&(n.user={name:l.user.name||null,email:l.user.email||null}),!l.postUrl){re(n),l.onSubmit&&l.onSubmit(n),Y("Recorded. Thank you!"),g(),S();return}R(!0),Y("Submitting\u2026"),fetch(l.postUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(n)}).then(async r=>{let a=await r.json().catch(()=>null);if(!r.ok||!a||a.ok!==!0)throw new Error(`Server responded with ${r.status}${a&&a.error?": "+a.error:""}`);re(n),l.onSubmit&&l.onSubmit(n),Y("Submitted. Thank you!"),R(!1),g(),S()}).catch(r=>{console.warn("[StickyWidget] POST failed:",r),R(!1),Y("Failed to submit. Please try again.",!0),l.onError&&l.onError(r,n)})}function Y(e,o=!1){if(!C)return;let t=document.createElement("div");t.className="fbw-toast"+(o?" fbw-toast--error":""),t.textContent=e,l.position==="bottom-left"&&(t.style.right="auto",t.style.left="24px"),C.appendChild(t),requestAnimationFrame(()=>{t.classList.add("fbw-toast--visible")});let i=setTimeout(()=>{t.classList.remove("fbw-toast--visible");let n=setTimeout(()=>t.remove(),200);K.push(n)},2500);K.push(i)}function We(e={}){x&&Ie(),l={...e};let o=()=>{B=null,u=document.createElement("div"),u.id="fbw-root",u.style.position="fixed",u.style.top="0",u.style.left="0",u.style.width="0",u.style.height="0",u.style.overflow="visible",u.style.zIndex=(l.zIndexBase||99999)+"",document.body.appendChild(u),C=u.attachShadow({mode:"open"}),l.accentColor&&(u.style.setProperty("--fbw-accent",l.accentColor),document.documentElement.style.setProperty("--fbw-accent",l.accentColor)),l.zIndexBase&&(u.style.setProperty("--fbw-z-popover",l.zIndexBase+5+""),document.documentElement.style.setProperty("--fbw-z",l.zIndexBase+""),document.documentElement.style.setProperty("--fbw-z-highlight",l.zIndexBase+1+"")),ae(C),pe(C),je(),l.captureConsole!==!1&&_e(),x=!0};document.readyState==="loading"?(B=o,document.addEventListener("DOMContentLoaded",o)):o()}function Ye(){x&&b===s.IDLE&&Le()}function Ge(){x&&b!==s.IDLE&&S()}function Ke(){return xe()}function Xe(){ye()}function Ie(){B&&(document.removeEventListener("DOMContentLoaded",B),B=null),!(!x||ie)&&(ie=!0,S(),K.forEach(e=>clearTimeout(e)),K=[],f&&(f.remove(),f=null),se(),Ce(),ke(),document.documentElement.style.removeProperty("--fbw-accent"),document.documentElement.style.removeProperty("--fbw-z"),document.documentElement.style.removeProperty("--fbw-z-highlight"),u&&(u.remove(),u=null,C=null),x=!1,ie=!1)}var Je={init:We,open:Ye,close:Ge,getEntries:Ke,clearEntries:Xe,destroy:Ie},et=Je;export{et as default};
