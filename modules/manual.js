/* ============================================================================
   Athena Agreements Studio — User Manual + searchable FAQs (internal & partner)
   The section/tab guide is generated from the live SECTIONS/TOOLS registry, so it
   stays in sync automatically whenever tabs are added, renamed or removed. The
   login URL is read from the current location, so it is always correct.
   ============================================================================ */
(function(){
const { $, esc } = window.OPS.helpers;
const appURL = ()=> location.origin + location.pathname.replace(/[^/]*$/,"");

/* one-line help per tool key (used to annotate the auto-generated guide) */
const TOOL_HELP = {
  agreements:"All agreements; open one to view, edit or download. Filter by All / Drafts / Mine / In review.",
  new:"Create a new agreement from an Athena template (template gallery).",
  templates:"Shared clause templates that become the team standard (admin only).",
  reviews:"Your approval queue — agreements awaiting your review. The 🔔 badge shows the pending count.",
  resources:"Shared policies and documents.",
  manual:"This user manual.",
  faqs:"Frequently asked questions — searchable.",
  team:"Grant per-section access, capabilities and roles to staff; assign approvers.",
  audit:"Full audit log of actions.",
  access_log:"Who opened sensitive records.",
};

function quickStart(){
  return `<div class="callout"><b>Login URL:</b> <a href="${esc(appURL())}" target="_blank" rel="noopener">${esc(appURL())}</a> — bookmark this, or install the app (browser menu → Install). Sign in with your work email; partners use the invite-only login emailed to them.</div>`;
}

/* ---- auto-generated section/tab guide from the live registry ---- */
function sectionGuide(){
  const O=window.OPS; const out=[];
  (O.SECTIONS||[]).forEach(s=>{
    if(s.key==="portal") return; // internal manual omits the external portal
    const tools=(O.TOOLS||[]).filter(t=>t.section===s.key && O.canSee(t));
    if(!tools.length) return;
    out.push(`<h3 style="margin-top:16px">${esc(s.label)}</h3><ul style="font-size:13px;line-height:1.7">`+
      tools.map(t=>`<li><b>${esc(t.label)}</b> — ${esc(TOOL_HELP[t.key]||"")}</li>`).join("")+`</ul>`);
  });
  return out.join("");
}

function internalManual(){
  const m=$("main"); const admin=window.OPS.isAdmin();
  m.innerHTML=`<div class="eyebrow">Resources</div><h1>User Manual</h1>
    ${quickStart()}
    <div class="card">
      <h3>What this tool is</h3>
      <p style="font-size:13px;line-height:1.6">Athena Agreements Studio is Athena Infonomics's internal tool for drafting agreements from Athena's standard templates, tracking them through their lifecycle, and routing them for approval. It does three things only: <b>draft</b>, <b>track</b> and <b>approve</b>. Access is per-section: an admin grants you exactly the tabs you need under <b>Team &amp; Access</b>.</p>
      <h3 style="margin-top:14px">Key workflows</h3>
      <ul style="font-size:13px;line-height:1.7">
        <li><b>Draft an agreement:</b> <b>New agreement</b> → pick a template (choose the Athena entity — India or US), fill the party details, dates, fees, term, jurisdiction and scope, then Preview and download as Word (Athena letterhead on every page) + a re-loadable JSON. Drafts autosave in your browser.</li>
        <li><b>Track:</b> every saved agreement appears under <b>Agreements</b> with its status (draft → in review → approved/rejected → executed). Filter by All / Drafts / Mine / In review.</li>
        <li><b>Submit for review:</b> from an agreement, assign a reviewer and <b>Submit for review</b>. It moves to <i>in review</i> and the reviewer is notified.</li>
        <li><b>Approve / reject:</b> items assigned to you appear in <b>Review / Approvals</b> (watch the 🔔 count). Approve or reject with a note. Editing an already-approved agreement sends it back for re-approval.</li>
      </ul>
      <h3 style="margin-top:14px">Your tabs (live)</h3>
      <p class="muted">Generated from what you can currently access — it updates automatically as the tool changes.</p>
      ${sectionGuide()}
      ${admin?'<div class="callout warn" style="margin-top:14px"><b>Admin:</b> grant access and capabilities (View contacts, Export, Delete) per person in <b>Team &amp; Access</b>. Keep Row-Level Security ON in Supabase. Deletions and sensitive-record views are audited.</div>':''}
      <p class="muted" style="margin-top:14px">Need help? Email <a href="mailto:info@athenainfonomics.com">info@athenainfonomics.com</a>. This manual reflects the current version of the tool.</p>
    </div>`;
}
window.OPS.routes.manual = internalManual;

/* ---- FAQs (searchable) ---- */
const FAQ_INTERNAL = [
  {q:"How do I draft a new agreement?", a:"Go to New agreement, pick a template card and click New (or Resume draft to continue a saved one). Choose the Athena entity (India or US), fill the party details, dates, fees, term, jurisdiction and scope, adjust any optional clauses, then Preview and download.", kw:"draft new agreement template create start"},
  {q:"How do I choose between Athena India and Athena US?", a:"Each template lets you select the issuing Athena entity. India uses the Chennai letterhead and Indian governing law; US uses the Bethesda, Maryland letterhead and Maryland law. The letterhead, address and jurisdiction update automatically.", kw:"entity india us llc letterhead governing law jurisdiction"},
  {q:"Which parts of a template can I change?", a:"Only the flagged merge fields — party name/address, signatory, dates, term, amounts/fees, governing-law state and scope. The standard legal wording is fixed and reproduced verbatim from Athena's approved templates.", kw:"merge fields variable edit change verbatim clause fixed"},
  {q:"How do I send an agreement for approval?", a:"Open the agreement, assign a reviewer and click Submit for review. It moves to 'in review' and the reviewer is notified. Approvers see it in Review / Approvals.", kw:"submit review approval reviewer assign send"},
  {q:"What is the 🔔 number on Review / Approvals?", a:"The count of agreements awaiting your review. It clears as you approve or reject them.", kw:"bell badge count approval pending review queue"},
  {q:"What happens if I edit an approved agreement?", a:"Editing an already-approved agreement reverts it to 'in review' and re-notifies the reviewer, so the change is re-approved before it is treated as final.", kw:"edit after approval re-approve revert in review"},
  {q:"How do documents download?", a:"As a Word .docx with the Athena letterhead on every page, plus a re-loadable JSON that reopens the draft. Use the buttons on the Preview screen.", kw:"word docx json download letterhead export reload"},
  {q:"How are agreements numbered?", a:"Using Athena's format, e.g. Athena/20-27/001/<Counterparty Name>. The number appears on the document.", kw:"numbering format reference number"},
  {q:"Who can see my agreements?", a:"An agreement is visible to its creator, the assigned approver, and admins/approvers. Row-Level Security in the database enforces this.", kw:"visibility privacy rls who can see access"},
  {q:"How do I get access to a tab I can't see?", a:"Ask an admin to grant it in Team & Access. Access is per-section.", kw:"access permission tab cannot see grant team"},
  {q:"Where is the login URL?", a:"At the top of the User Manual, and it's the address you're on now — bookmark it or install the app from your browser menu.", kw:"url link login install pwa bookmark"},
];
const FAQ_PARTNER = [
  {q:"Who do I contact for help?", a:"Email info@athenainfonomics.com, or call the number in the footer.", kw:"help contact email phone support"},
];

function renderFAQ(host, list, title){
  host.innerHTML=`<div class="row" style="margin:6px 0"><input id="faqQ" placeholder="Search ${esc(title)} by keyword…" style="max-width:340px"></div>
    <div id="faqList"></div>`;
  function draw(q){
    q=(q||"").toLowerCase().trim();
    const rows=!q?list:list.filter(f=>(f.q+" "+f.a+" "+(f.kw||"")).toLowerCase().includes(q));
    $("faqList").innerHTML = rows.length? rows.map(f=>`<div class="card" style="margin-bottom:8px"><b>${esc(f.q)}</b><p style="font-size:13px;line-height:1.6;margin:6px 0 0">${esc(f.a)}</p></div>`).join("")
      : '<div class="card muted">No matching questions. Try another keyword.</div>';
  }
  draw(""); $("faqQ").addEventListener("input",e=>draw(e.target.value));
}

function internalFAQs(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Resources</div><h1>FAQs</h1>${quickStart()}<div id="faqHost"></div>`;
  renderFAQ($("faqHost"), FAQ_INTERNAL, "FAQs");
}
window.OPS.routes.faqs = internalFAQs;

/* ---- Partner portal: combined SOP + FAQs ---- */
function partnerHelp(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Resources</div><h1>Help &amp; FAQs</h1>
    <div class="callout"><b>App URL:</b> <a href="${esc(appURL())}" target="_blank" rel="noopener">${esc(appURL())}</a> — bookmark it or install the app from your browser menu.</div>
    <div class="card">
      <p class="muted">Questions? Email <a href="mailto:info@athenainfonomics.com">info@athenainfonomics.com</a> or call the number in the footer.</p>
    </div>
    <h3 style="margin-top:16px">FAQs</h3><div id="faqHost"></div>`;
  renderFAQ($("faqHost"), FAQ_PARTNER, "FAQs");
}
window.OPS.routes.portal_help = partnerHelp;
})();
