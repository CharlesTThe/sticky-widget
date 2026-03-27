var Ie=`
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
`,Te=`
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
`,j=null;function ie(e){if(e&&!e.querySelector("style[data-fbw]")){j=e;let o=document.createElement("style");o.setAttribute("data-fbw",""),o.textContent=Ie,e.appendChild(o)}if(!document.querySelector("style[data-fbw-light]")){let o=document.createElement("style");o.setAttribute("data-fbw-light",""),o.textContent=Te,document.head.appendChild(o)}}function le(){if(j){let o=j.querySelector("style[data-fbw]");o&&o.remove(),j=null}let e=document.querySelector("style[data-fbw-light]");e&&e.remove()}var S=0,T=null;function ze(e){let o=[],t=e;for(;t&&t!==document.body&&t!==document.documentElement;)o.push(t),t=t.parentElement;return o}function K(e){e!==T&&(T=e,S=0)}function ae(e){return S=Math.max(0,S+e),F()}function F(){if(!T)return null;let e=ze(T);if(e.length===0)return null;let o=Math.min(S,e.length-1);return S=o,e[o]}function se(){S=0,T=null}var E=null,v=null;function ce(){E||(E=document.createElement("div"),E.className="fbw-overlay",document.body.appendChild(E))}function fe(){E&&(E.remove(),E=null),R()}function X(e){v||(v=document.createElement("div"),v.className="fbw-highlight",document.body.appendChild(v)),v.style.top=e.top+"px",v.style.left=e.left+"px",v.style.width=e.width+"px",v.style.height=e.height+"px"}function R(){v&&(v.remove(),v=null)}var u=null,d=null,z=null,Z=document.body,J=null;function ue(e){Z=e,J=e}function de(e,o,t,i){h(),u=document.createElement("div"),u.className="fbw-popover";let n="";o&&(n+='<div class="fbw-popover__label">Selected text</div>',n+=`<div class="fbw-popover__selected-text">${Q(o)}</div>`),n+='<div class="fbw-popover__label">Your comment</div>',n+=`<textarea class="fbw-popover__textarea" placeholder="What's on your mind?" autofocus></textarea>`,n+='<div class="fbw-popover__hint">Press Ctrl+Enter to submit</div>',n+='<div class="fbw-popover__actions">',n+='<button class="fbw-popover__btn fbw-popover__btn--cancel" type="button">Cancel</button>',n+='<button class="fbw-popover__btn fbw-popover__btn--submit" type="button" disabled>Submit</button>',n+="</div>",u.innerHTML=n,Z.appendChild(u),Be(u,e);let r=u.querySelector(".fbw-popover__textarea"),s=u.querySelector(".fbw-popover__btn--submit"),g=u.querySelector(".fbw-popover__btn--cancel");r.addEventListener("input",()=>{s.disabled=!r.value.trim()});let y=!1,I=()=>{if(y)return;let p=r.value.trim();p&&(y=!0,s.disabled=!0,t({comment:p}))};r.addEventListener("keydown",p=>{(p.ctrlKey||p.metaKey)&&p.key==="Enter"&&(p.preventDefault(),I())}),s.addEventListener("click",I),g.addEventListener("click",()=>{Oe(r,i)}),u.addEventListener("click",p=>p.stopPropagation()),u.addEventListener("mousedown",p=>p.stopPropagation()),De(u),requestAnimationFrame(()=>r.focus())}function Oe(e,o){e&&e.value.trim()?pe("Discard comment?",'Your comment will be lost. Press "Submit" to save it.',()=>{_(),o()},()=>{_(),e.focus()}):o()}function ee(e,o){if(!u)return!0;if(d)return!1;let t=u.querySelector(".fbw-popover__textarea");return t&&t.value.trim()?(pe("Discard comment?",'Your comment will be lost. Press "Submit" to save it.',()=>{_(),o()},()=>{_(),t&&t.focus()},e?()=>{_();let i=t.value.trim();i&&e({comment:i})}:null),!1):!0}function pe(e,o,t,i,n){_(),d=document.createElement("div"),d.className="fbw-confirm";let r=`<div class="fbw-confirm__title">${Q(e)}</div>`;r+=`<div class="fbw-confirm__message">${Q(o)}</div>`,r+='<div class="fbw-confirm__actions">',r+='<button class="fbw-popover__btn fbw-popover__btn--cancel" type="button">Discard</button>',n&&(r+='<button class="fbw-popover__btn fbw-popover__btn--submit" type="button">Submit</button>'),r+='<button class="fbw-popover__btn" type="button" style="background:#4f46e5;color:#fff;border-color:transparent;">Go back</button>',r+="</div>",d.innerHTML=r,d.style.top="50%",d.style.left="50%",d.style.transform="translate(-50%, -50%)",Z.appendChild(d);let s=d.querySelectorAll("button"),g=s[0],y=n?s[1]:null,I=n?s[2]:s[1];g.addEventListener("click",t),I.addEventListener("click",i),n&&y&&y.addEventListener("click",n),d.addEventListener("click",p=>p.stopPropagation()),d.addEventListener("mousedown",p=>p.stopPropagation()),requestAnimationFrame(()=>I.focus())}function _(){d&&(d.remove(),d=null)}function De(e){me(),z=o=>{if(o.key!=="Tab")return;let i=(d||e).querySelectorAll('textarea, button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])');if(i.length===0)return;let n=i[0],r=i[i.length-1],s=J?J.activeElement:document.activeElement;o.shiftKey?s===n&&(o.preventDefault(),r.focus()):s===r&&(o.preventDefault(),n.focus())},document.addEventListener("keydown",z,!0)}function me(){z&&(document.removeEventListener("keydown",z,!0),z=null)}function Be(e,o){let n=o.bottom+8,r=o.left,s=e.getBoundingClientRect(),g=window.innerWidth,y=window.innerHeight;n+s.height>y-8&&(n=o.top-s.height-8),n<8&&(n=8),r+s.width>g-8&&(r=g-s.width-8),r<8&&(r=8),e.style.top=n+"px",e.style.left=r+"px"}function h(){me(),_(),u&&(u.remove(),u=null)}function be(){return d!==null}function Q(e){let o=document.createElement("div");return o.textContent=e,o.innerHTML}function ve(){let e=window.getSelection();return!e||e.isCollapsed||!e.toString().trim()?null:{text:e.toString().trim(),rangeCount:e.rangeCount}}function he(e){if(!e||e===document.body||e===document.documentElement)return e?e.tagName.toLowerCase():"";if(e.id&&document.querySelectorAll(`#${CSS.escape(e.id)}`).length===1)return`#${CSS.escape(e.id)}`;let o=[],t=e;for(;t&&t!==document.body&&t!==document.documentElement;){let i=t.tagName.toLowerCase();if(t.id&&document.querySelectorAll(`#${CSS.escape(t.id)}`).length===1){o.unshift(`#${CSS.escape(t.id)}`);break}let n=t.getAttribute("data-sticky-id");if(n){o.unshift(`[data-sticky-id="${n}"]`);break}let r=t.parentElement;r&&Array.from(r.children).filter(g=>g.tagName===t.tagName).length>1&&(i+=`:nth-child(${Array.from(r.children).indexOf(t)+1})`),o.unshift(i),t=t.parentElement}return o.join(" > ")}var te=[];function ge(e){return te.push(e),e}function we(){return[...te]}function xe(){te=[]}var A=[],W=!1,P=null,O=null,D=null,B=null;function ye(e,o=1e3){if(typeof e!="string")try{e=JSON.stringify(e)}catch{e=String(e)}return e.length>o?e.slice(0,o)+"...":e}function U(e,o){let t={level:e,message:Array.from(o).map(i=>ye(i)).join(" "),timestamp:new Date().toISOString()};A.push(t),A.length>50&&A.shift()}function Ee(){W||(W=!0,P=console.error,console.error=function(...e){U("error",e),P.apply(console,e)},O=console.warn,console.warn=function(...e){U("warn",e),O.apply(console,e)},D=e=>{U("error",[`${e.message} at ${e.filename}:${e.lineno}:${e.colno}`])},window.addEventListener("error",D),B=e=>{U("error",[`Unhandled rejection: ${ye(e.reason)}`])},window.addEventListener("unhandledrejection",B))}function _e(){W&&(W=!1,P&&(console.error=P),O&&(console.warn=O),P=null,O=null,D&&window.removeEventListener("error",D),B&&window.removeEventListener("unhandledrejection",B),D=null,B=null)}function Ce(){return[...A]}function Se(){A=[]}var a={IDLE:"IDLE",ACTIVE:"ACTIVE",POPOVER_OPEN:"POPOVER_OPEN"},b=a.IDLE,l={},c=null,m=null,k=null,f=null,C=null,x=!1,oe=!1,N=null,G=[],H=null,M=null,V=null,$=null,q=null,Y=null;function w(e){b=e}function qe(){c=document.createElement("button"),c.className="fbw-fab fbw-fab--idle",c.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',c.setAttribute("aria-label","Toggle sticky widget"),c.style.zIndex=(l.zIndexBase||99999)+"",c.addEventListener("click",e=>{e.stopPropagation(),b===a.IDLE?ke():L()}),l.position==="bottom-left"&&(c.style.right="auto",c.style.left="24px"),C.appendChild(c)}function ke(){!x||!c||(w(a.ACTIVE),c.className="fbw-fab fbw-fab--active",c.style.zIndex=(l.zIndexBase||99999)+"",document.documentElement.classList.add("fbw-cursor-crosshair"),ce(),je(),l.onOpen&&l.onOpen())}function L(){w(a.IDLE),c&&(c.className="fbw-fab fbw-fab--idle",c.style.zIndex=(l.zIndexBase||99999)+""),document.documentElement.classList.remove("fbw-cursor-crosshair"),fe(),h(),Fe(),m=null,se(),l.onClose&&l.onClose()}function je(){let e=null;function o(){let t=F();t&&t!==e?(e=t,X(t.getBoundingClientRect())):t||(R(),e=null)}H=t=>{b===a.ACTIVE&&k===null&&(k=requestAnimationFrame(()=>{if(k=null,b!==a.ACTIVE)return;let i=document.elementFromPoint(t.clientX,t.clientY);if(!i||i===f||i===c||i.closest(".fbw-popover")||i.closest(".fbw-fab")||i.closest(".fbw-confirm")){R(),e=null;return}K(i),o()}))},q=t=>{if(b!==a.ACTIVE)return;t.preventDefault(),t.stopPropagation();let i=t.deltaY>0?1:-1;ae(i),o()},M=t=>{if(t.target!==f)if(b===a.ACTIVE){t.preventDefault(),t.stopPropagation(),t.stopImmediatePropagation();let i=document.elementFromPoint(t.clientX,t.clientY);if(!i||(K(i),m=F(),!m))return;let n=m.getBoundingClientRect(),r=Y;Y=null,X(n),w(a.POPOVER_OPEN),de(n,r?r.text:null,({comment:s})=>{ne(s,r?r.text:null)},()=>{h(),w(a.ACTIVE)})}else b===a.POPOVER_OPEN&&(t.preventDefault(),t.stopPropagation(),t.stopImmediatePropagation(),ee(({comment:n})=>{ne(n,null)},()=>{h(),w(a.ACTIVE)})&&(h(),w(a.ACTIVE)))},V=t=>{if(t.key==="Escape"){if(be())return;b===a.POPOVER_OPEN?ee(({comment:n})=>{ne(n,null)},()=>{h(),w(a.ACTIVE)})&&(h(),w(a.ACTIVE)):b===a.ACTIVE&&L()}},$=()=>{b===a.ACTIVE&&(Y=ve())},document.addEventListener("mouseup",$,!0),document.addEventListener("mousemove",H,!1),document.addEventListener("wheel",q,{capture:!0,passive:!1}),document.addEventListener("click",M,!0),document.addEventListener("keydown",V,!1)}function Fe(){$&&document.removeEventListener("mouseup",$,!0),H&&document.removeEventListener("mousemove",H,!1),q&&document.removeEventListener("wheel",q,!0),M&&document.removeEventListener("click",M,!0),V&&document.removeEventListener("keydown",V,!1),$=null,H=null,q=null,M=null,V=null,Y=null,k!==null&&(cancelAnimationFrame(k),k=null)}function Re(){return{userAgent:navigator.userAgent,viewport:`${window.innerWidth}x${window.innerHeight}`,screenSize:`${screen.width}x${screen.height}`,language:navigator.language,url:window.location.href,referrer:document.referrer||null,timestamp:new Date().toISOString()}}function ne(e,o){if(!x||!m)return;if(!document.contains(m)){h(),L();return}let t=m.getBoundingClientRect(),i=m.getAttribute("aria-label")||m.getAttribute("data-sticky-id")||(m.innerText||"").slice(0,80).trim()||null,n={id:typeof crypto<"u"&&crypto.randomUUID?crypto.randomUUID():"stw-"+Date.now()+"-"+Math.random().toString(36).slice(2,8),timestamp:new Date().toISOString(),pageUrl:window.location.href,target:{selector:he(m),tagName:m.tagName.toLowerCase(),id:m.id||null,label:i,rect:{top:t.top,left:t.left,width:t.width,height:t.height}},selectedText:o||null,comment:e,metadata:Re(),consoleLogs:Ce()};l.user&&(n.user={name:l.user.name||null,email:l.user.email||null}),ge(n),l.onSubmit&&l.onSubmit(n),l.postUrl?fetch(l.postUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(n)}).then(r=>{if(!r.ok)throw new Error(`Server responded with ${r.status}`);re("Submitted. Thank you!")}).catch(r=>{console.warn("[StickyWidget] POST failed:",r),re("Failed to submit. Please try again.",!0),l.onError&&l.onError(r,n)}):re("Recorded. Thank you!"),h(),L()}function re(e,o=!1){if(!C)return;let t=document.createElement("div");t.className="fbw-toast"+(o?" fbw-toast--error":""),t.textContent=e,l.position==="bottom-left"&&(t.style.right="auto",t.style.left="24px"),C.appendChild(t),requestAnimationFrame(()=>{t.classList.add("fbw-toast--visible")});let i=setTimeout(()=>{t.classList.remove("fbw-toast--visible");let n=setTimeout(()=>t.remove(),200);G.push(n)},2500);G.push(i)}function Ue(e={}){x&&Le(),l={...e};let o=()=>{N=null,f=document.createElement("div"),f.id="fbw-root",f.style.position="fixed",f.style.top="0",f.style.left="0",f.style.width="0",f.style.height="0",f.style.overflow="visible",f.style.zIndex=(l.zIndexBase||99999)+"",document.body.appendChild(f),C=f.attachShadow({mode:"open"}),l.accentColor&&(f.style.setProperty("--fbw-accent",l.accentColor),document.documentElement.style.setProperty("--fbw-accent",l.accentColor)),l.zIndexBase&&(f.style.setProperty("--fbw-z-popover",l.zIndexBase+5+""),document.documentElement.style.setProperty("--fbw-z",l.zIndexBase+""),document.documentElement.style.setProperty("--fbw-z-highlight",l.zIndexBase+1+"")),ie(C),ue(C),qe(),l.captureConsole!==!1&&Ee(),x=!0};document.readyState==="loading"?(N=o,document.addEventListener("DOMContentLoaded",o)):o()}function We(){x&&b===a.IDLE&&ke()}function Ye(){x&&b!==a.IDLE&&L()}function Ge(){return we()}function Ke(){xe()}function Le(){N&&(document.removeEventListener("DOMContentLoaded",N),N=null),!(!x||oe)&&(oe=!0,L(),G.forEach(e=>clearTimeout(e)),G=[],c&&(c.remove(),c=null),le(),_e(),Se(),document.documentElement.style.removeProperty("--fbw-accent"),document.documentElement.style.removeProperty("--fbw-z"),document.documentElement.style.removeProperty("--fbw-z-highlight"),f&&(f.remove(),f=null,C=null),x=!1,oe=!1)}var Xe={init:Ue,open:We,close:Ye,getEntries:Ge,clearEntries:Ke,destroy:Le},Ze=Xe;export{Ze as default};
