var S=Object.defineProperty;var N=(t,e,s)=>e in t?S(t,e,{enumerable:!0,configurable:!0,writable:!0,value:s}):t[e]=s;var l=(t,e,s)=>N(t,typeof e!="symbol"?e+"":e,s);import{s as C,r as f,j as r,g as A,d as q,a as E,c as y,R as w}from"./jsx-runtime-BCZ1APbq.js";const I={name:"claude",getChatContainer(){return document.querySelector('[data-testid="chat-messages"]')??document.querySelector("main .overflow-y-auto")??document.querySelector("main")},getMessageElements(){return document.querySelectorAll('[data-testid^="conversation-turn-"]')},extractMessage(t){var a,o,p;const e=t.querySelector('[data-testid="human-turn"]')!==null||((a=t.getAttribute("data-testid"))==null?void 0:a.includes("human"))===!0,s=t.querySelector('[data-testid="ai-turn"]')!==null||((o=t.getAttribute("data-testid"))==null?void 0:o.includes("assistant"))===!0;if(!e&&!s)return null;const i=((p=(t.querySelector('[data-testid="human-turn"] .whitespace-pre-wrap')??t.querySelector('[data-testid="ai-turn"] .font-claude-message')??t.querySelector("p")??t).textContent)==null?void 0:p.trim())??"";return i?{role:e?"human":"assistant",text:i}:null},getInputBox(){return document.querySelector('[data-testid="chat-input"][contenteditable="true"]')??document.querySelector('div[contenteditable="true"]')},insertIntoInputBox(t){const e=this.getInputBox();e&&(e.focus(),document.execCommand("insertText",!1,t))}},M={name:"chatgpt",getChatContainer(){return document.querySelector("main")??null},getMessageElements(){return document.querySelectorAll("[data-message-id]")},extractMessage(t){return null},getInputBox(){return document.querySelector("#prompt-textarea")},insertIntoInputBox(t){const e=this.getInputBox();e&&(e.focus(),document.execCommand("insertText",!1,t))}},k={"claude.ai":I,"chat.openai.com":M};function z(){return k[location.hostname]??null}class D{constructor(e,s){l(this,"observer",null);l(this,"seenIds",new Set);l(this,"history",[]);this.adapter=e,this.onNewMessage=s}start(){const e=this.adapter.getChatContainer();if(!e){setTimeout(()=>this.start(),1e3);return}this.observer=new MutationObserver(()=>this.scanMessages()),this.observer.observe(e,{childList:!0,subtree:!0}),this.scanMessages()}stop(){var e;(e=this.observer)==null||e.disconnect(),this.observer=null}scanMessages(){const e=this.adapter.getMessageElements();for(const s of e){const n=s.getAttribute("data-testid")??s.getAttribute("data-message-id")??this.generateId(s);if(this.seenIds.has(n))continue;const i=this.adapter.extractMessage(s);if(i){if(i.role==="assistant"&&!this.isStreamingInProgress(s)){const a={id:n,role:i.role,text:i.text,timestamp:Date.now()};this.seenIds.add(n),this.history.push(a),this.onNewMessage(a,[...this.history])}else if(i.role==="human"){const a={id:n,role:i.role,text:i.text,timestamp:Date.now()};this.seenIds.add(n),this.history.push(a)}}}}isStreamingInProgress(e){return e.querySelector('[data-testid="streaming-indicator"]')!==null||e.querySelector(".animate-pulse")!==null||e.querySelector(".streaming")!==null}generateId(e){const s=e.parentElement;return s?`msg-${Array.from(s.children).indexOf(e)}`:Math.random().toString(36).slice(2)}reset(){var e;this.seenIds.clear(),this.history=[],(e=this.observer)==null||e.disconnect(),this.observer=null,this.start()}}class U{constructor(e){l(this,"currentThread",null);l(this,"onThreadUpdate");l(this,"onArchive");this.onThreadUpdate=e.onThreadUpdate,this.onArchive=e.onArchive}startNewThread(e,s){this.currentThread={id:crypto.randomUUID(),title:e||"New Thread",messages:[s],createdAt:Date.now(),conversationUrl:location.href},this.onThreadUpdate(this.currentThread)}addMessageToCurrentThread(e){if(!this.currentThread){this.startNewThread("Conversation",e);return}this.currentThread.messages.push(e),this.onThreadUpdate({...this.currentThread})}async archiveCurrentThread(){if(!this.currentThread)return;const e={...this.currentThread};await C(e),this.onArchive(e),this.currentThread=null,this.onThreadUpdate(null)}getCurrentThread(){return this.currentThread}}function R({thread:t,onQuote:e,onDelete:s}){const[n,i]=f.useState(!1),a=new Date(t.archivedAt??t.createdAt).toLocaleDateString();return r.jsxs("div",{className:"tp-card",children:[r.jsxs("div",{className:"tp-card-header",onClick:()=>i(o=>!o),children:[r.jsx("span",{className:"tp-card-chevron",children:n?"▾":"▸"}),r.jsxs("div",{className:"tp-card-info",children:[r.jsx("div",{className:"tp-card-title",children:t.title}),r.jsxs("div",{className:"tp-card-meta",children:[t.messages.length," messages · ",a]})]})]}),n&&r.jsxs("div",{className:"tp-card-body",children:[t.messages.slice(0,3).map(o=>r.jsxs("div",{className:`tp-card-msg tp-msg-${o.role}`,children:[r.jsx("span",{className:"tp-msg-role",children:o.role==="human"?"You":"Claude"}),r.jsxs("span",{className:"tp-msg-text",children:[o.text.slice(0,120),o.text.length>120?"…":""]})]},o.id)),t.messages.length>3&&r.jsxs("div",{className:"tp-card-more",children:["+",t.messages.length-3," more messages"]})]}),r.jsxs("div",{className:"tp-card-actions",children:[r.jsx("button",{className:"tp-btn-quote",onClick:()=>e(t),children:"Quote"}),r.jsx("button",{className:"tp-btn-delete",onClick:()=>s(t.id),children:"Delete"})]})]})}const B=`
  .tp-sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: 260px;
    background: #1a1a2e;
    color: #e2e8f0;
    display: flex;
    flex-direction: column;
    z-index: 9999;
    box-shadow: 2px 0 8px rgba(0,0,0,0.3);
    font-family: system-ui, sans-serif;
    font-size: 13px;
    overflow: hidden;
    transition: transform 0.2s ease;
  }
  .tp-sidebar-header {
    padding: 16px;
    border-bottom: 1px solid #2d2d4e;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tp-sidebar-title {
    font-weight: 700;
    font-size: 14px;
    color: #a78bfa;
    letter-spacing: 0.05em;
  }
  .tp-sidebar-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }
  .tp-empty {
    color: #64748b;
    text-align: center;
    padding: 32px 16px;
    font-size: 12px;
  }
  .tp-card {
    background: #16213e;
    border-radius: 8px;
    margin-bottom: 8px;
    overflow: hidden;
    border: 1px solid #2d2d4e;
  }
  .tp-card-header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    cursor: pointer;
    user-select: none;
  }
  .tp-card-header:hover { background: #1e2a4a; }
  .tp-card-chevron { color: #7c3aed; font-size: 12px; margin-top: 2px; }
  .tp-card-info { flex: 1; min-width: 0; }
  .tp-card-title {
    font-weight: 600;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tp-card-meta { color: #64748b; font-size: 11px; margin-top: 2px; }
  .tp-card-body { padding: 0 12px 8px; }
  .tp-card-msg {
    padding: 4px 0;
    border-bottom: 1px solid #2d2d4e;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tp-msg-role { font-size: 10px; font-weight: 600; color: #7c3aed; text-transform: uppercase; }
  .tp-msg-human .tp-msg-role { color: #06b6d4; }
  .tp-msg-text { color: #94a3b8; font-size: 12px; line-height: 1.4; }
  .tp-card-more { color: #64748b; font-size: 11px; padding: 4px 0; }
  .tp-card-actions {
    display: flex;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid #2d2d4e;
  }
  .tp-btn-quote, .tp-btn-delete {
    flex: 1;
    padding: 4px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    transition: opacity 0.15s;
  }
  .tp-btn-quote { background: #7c3aed; color: white; }
  .tp-btn-quote:hover { opacity: 0.85; }
  .tp-btn-delete { background: #2d2d4e; color: #94a3b8; }
  .tp-btn-delete:hover { background: #7f1d1d; color: white; }
`;function $({onQuote:t,refreshKey:e}){const[s,n]=f.useState([]);f.useEffect(()=>{A().then(n)},[e]);async function i(a){await q(a),n(o=>o.filter(p=>p.id!==a))}return r.jsxs(r.Fragment,{children:[r.jsx("style",{children:B}),r.jsxs("div",{className:"tp-sidebar",children:[r.jsxs("div",{className:"tp-sidebar-header",children:[r.jsx("span",{className:"tp-sidebar-title",children:"Threads"}),r.jsxs("span",{style:{color:"#64748b",fontSize:11},children:[s.length," archived"]})]}),r.jsx("div",{className:"tp-sidebar-body",children:s.length===0?r.jsxs("div",{className:"tp-empty",children:["Archived threads will appear here.",r.jsx("br",{}),r.jsx("br",{}),"Chat on claude.ai and topics will be grouped automatically."]}):s.map(a=>r.jsx(R,{thread:a,onQuote:t,onDelete:i},a.id))})]})]})}const O=`
  .tp-thread-group {
    border-left: 3px solid #7c3aed;
    margin: 8px 0;
    padding: 0 0 0 12px;
    position: relative;
  }
  .tp-thread-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0 8px;
    font-size: 12px;
    font-weight: 600;
    color: #7c3aed;
    font-family: system-ui, sans-serif;
  }
  .tp-thread-title {
    flex: 1;
  }
  .tp-archive-btn {
    background: none;
    border: 1px solid #7c3aed;
    border-radius: 4px;
    color: #7c3aed;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 8px;
    transition: background 0.15s;
  }
  .tp-archive-btn:hover {
    background: #7c3aed;
    color: white;
  }
`;function F({thread:t,onArchive:e}){return r.jsxs(r.Fragment,{children:[r.jsx("style",{children:O}),r.jsx("div",{className:"tp-thread-group",children:r.jsxs("div",{className:"tp-thread-header",children:[r.jsxs("span",{className:"tp-thread-title",children:["# ",t.title," (",t.messages.length," messages)"]}),r.jsx("button",{className:"tp-archive-btn",onClick:e,children:"Archive"})]})})]})}async function L(){if(!(await E()).threadingEnabled)return;const e=z();if(!e)return;let s=0;const n=document.createElement("div");n.id="tp-sidebar-host",document.body.appendChild(n);const i=n.attachShadow({mode:"open"}),a=document.createElement("div");i.appendChild(a);function o(){y(a).render(w.createElement($,{refreshKey:s,onQuote:p}))}function p(d){const u=`[Referencing thread: "${d.title}"]
${d.messages.map(x=>`${x.role==="human"?"You":"Claude"}: ${x.text.slice(0,200)}`).join(`
`)}`;e.insertIntoInputBox(u)}o(),document.body.style.marginLeft="260px";let c=null,g=null;function T(d){if(!d){c==null||c.remove(),c=null,g=null;return}c||(c=document.createElement("div"),c.id="tp-thread-indicator",c.style.cssText="position:fixed;top:0;left:260px;right:0;z-index:9998;",document.body.appendChild(c),g=y(c)),g.render(w.createElement(F,{thread:d,onArchive:()=>h.archiveCurrentThread()}))}const h=new U({onThreadUpdate:T,onArchive:d=>{s++,o()}}),b=new D(e,async(d,u)=>{await j(d,u)});async function j(d,u){const x={type:"NEW_MESSAGE",message:d,history:u};try{const m=await chrome.runtime.sendMessage(x);m.type==="THREAD_DECISION"&&(m.newThread?(h.getCurrentThread()&&await h.archiveCurrentThread(),h.startNewThread(m.title,d)):h.addMessageToCurrentThread(d))}catch(m){console.error("[ThreadPlugin] Failed to send message to background:",m)}}b.start();let v=location.href;new MutationObserver(()=>{location.href!==v&&(v=location.href,b.reset())}).observe(document,{subtree:!0,childList:!0})}L();
