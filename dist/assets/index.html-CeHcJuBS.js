import{c as d,R as l,r as a,a as u,j as s,b as p}from"./jsx-runtime-BCZ1APbq.js";(function(){const n=document.createElement("link").relList;if(n&&n.supports&&n.supports("modulepreload"))return;for(const e of document.querySelectorAll('link[rel="modulepreload"]'))i(e);new MutationObserver(e=>{for(const t of e)if(t.type==="childList")for(const o of t.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&i(o)}).observe(document,{childList:!0,subtree:!0});function r(e){const t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin==="use-credentials"?t.credentials="include":e.crossOrigin==="anonymous"?t.credentials="omit":t.credentials="same-origin",t}function i(e){if(e.ep)return;e.ep=!0;const t=r(e);fetch(e.href,t)}})();const g=`
  .container { padding: 16px; }
  h1 { font-size: 16px; color: #a78bfa; margin-bottom: 16px; font-weight: 700; }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid #2d2d4e;
  }
  .label { color: #e2e8f0; }
  .sub { color: #64748b; font-size: 11px; margin-top: 2px; }
  /* Toggle switch */
  .toggle { position: relative; width: 40px; height: 22px; }
  .toggle input { display: none; }
  .slider {
    position: absolute; inset: 0;
    background: #2d2d4e;
    border-radius: 22px;
    cursor: pointer;
    transition: background 0.2s;
  }
  .slider::before {
    content: '';
    position: absolute;
    width: 16px; height: 16px;
    background: white;
    border-radius: 50%;
    left: 3px; top: 3px;
    transition: transform 0.2s;
  }
  input:checked + .slider { background: #7c3aed; }
  input:checked + .slider::before { transform: translateX(18px); }
  .status {
    margin-top: 16px;
    padding: 8px;
    border-radius: 6px;
    font-size: 12px;
    text-align: center;
  }
  .status.ok { background: #14532d; color: #86efac; }
  .status.warn { background: #78350f; color: #fcd34d; }
`;function f(){const[c,n]=a.useState(!0),[r,i]=a.useState(null);a.useEffect(()=>{u().then(o=>n(o.threadingEnabled)),e()},[]);async function e(){try{const o=await chrome.cookies.get({url:"https://claude.ai",name:"__Secure-next-auth.session-token"});i(!!o)}catch{i(!1)}}async function t(o){n(o),await p({threadingEnabled:o})}return s.jsxs(s.Fragment,{children:[s.jsx("style",{children:g}),s.jsxs("div",{className:"container",children:[s.jsx("h1",{children:"Thread Plugin"}),s.jsxs("div",{className:"row",children:[s.jsxs("div",{children:[s.jsx("div",{className:"label",children:"Auto Threading"}),s.jsx("div",{className:"sub",children:"Detect topic changes automatically"})]}),s.jsxs("label",{className:"toggle",children:[s.jsx("input",{type:"checkbox",checked:c,onChange:o=>t(o.target.checked)}),s.jsx("span",{className:"slider"})]})]}),r!==null&&s.jsx("div",{className:`status ${r?"ok":"warn"}`,children:r?"Logged in to Claude — ready to use":"Not logged in to Claude. Please open claude.ai and sign in."})]})]})}d(document.getElementById("root")).render(l.createElement(f));
