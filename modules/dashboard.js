/* ============================================================================
   Athena Agreements Studio — Dashboard
   A short status snapshot: the tool-drafted agreement pipeline, plus combined
   Vendor and Client agreement counts (drafts + contract reviews + signed
   libraries), plus how many closed this month.
   ============================================================================ */
(function(){
const { $, esc } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

// Which side is a tool-drafted agreement on? Client Agreement template or a
// "client" category ⇒ client; everything else (consultants/vendors) ⇒ vendor.
function sideOfAgreement(a){
  if(a.template_key==="client_llc") return "client";
  if(/client/i.test(a.category||"")) return "client";
  return "vendor";
}
function stat(n,label,color){ return `<div class="stat"><div class="n"${color?` style="color:${color}"`:""}>${n||0}</div><div class="l">${esc(label)}</div></div>`; }

async function dashboard(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Overview</div><h1>Dashboard</h1><div id="dbBody" class="muted">Loading…</div>`;
  const grab=(t,cols)=>sb().from(t).select(cols).then(r=>r.data||[]).catch(()=>[]);
  const [ags, negs, exec] = await Promise.all([
    grab("agreements","id,status,template_key,category,updated_at"),
    grab("negotiations","id,kind,status,updated_at"),
    grab("executed_agreements","id,kind,created_at,signed_date"),
  ]);

  // --- tool-drafted pipeline ---
  const pc={draft:0,in_review:0,approved:0,executed:0};
  ags.forEach(a=>{ if(pc[a.status]!=null) pc[a.status]++; });

  // --- combined vendor / client buckets ---
  const mk=()=>({review:0,agreed:0,approved:0,executed:0});
  const side={vendor:mk(), client:mk()};
  ags.forEach(a=>{ const s=side[sideOfAgreement(a)];
    if(a.status==="in_review") s.review++; else if(a.status==="approved") s.approved++; else if(a.status==="executed") s.executed++; });
  negs.forEach(n=>{ const s=side[n.kind==="client"?"client":"vendor"]; const st=n.status;
    if(st==="open"||st==="in_review"||st==="under_review") s.review++;
    else if(st==="agreed") s.agreed++;
    else if(st==="approved") s.approved++;
    else if(st==="executed"||st==="closed") s.executed++; });
  exec.forEach(e=>{ const s=side[e.kind==="client"?"client":"vendor"]; s.executed++; });

  // --- closed this calendar month ---
  const now=new Date(), y=now.getFullYear(), mo=now.getMonth();
  const inMonth=(iso)=>{ if(!iso) return false; const d=new Date(iso); return d.getFullYear()===y && d.getMonth()===mo; };
  let closed=0;
  ags.forEach(a=>{ if(a.status==="executed" && inMonth(a.updated_at)) closed++; });
  negs.forEach(n=>{ if((n.status==="executed"||n.status==="closed") && inMonth(n.updated_at)) closed++; });
  exec.forEach(e=>{ if(inMonth(e.signed_date||e.created_at)) closed++; });
  const monthName=now.toLocaleString(undefined,{month:"long",year:"numeric"});

  $("dbBody").innerHTML=`
    <div class="card"><div class="eyebrow">Agreements drafted in the tool</div>
      <div class="statrow" style="margin-top:10px">
        ${stat(pc.draft,"Under drafting")}
        ${stat(pc.in_review,"Under review","#9a5b00")}
        ${stat(pc.approved,"Approved","#3e6b20")}
        ${stat(pc.executed,"Executed","#0a6496")}
      </div></div>
    <div class="fgrid">
      <div class="card"><div class="eyebrow">Vendor agreements</div>
        <p class="muted" style="margin:2px 0 0">Drafts + vendor reviews + signed vendor library</p>
        <div class="statrow" style="margin-top:10px">
          ${stat(side.vendor.review,"Under review")}${stat(side.vendor.agreed,"Agreed")}${stat(side.vendor.approved,"Approved")}${stat(side.vendor.executed,"Executed")}
        </div></div>
      <div class="card"><div class="eyebrow">Client agreements</div>
        <p class="muted" style="margin:2px 0 0">Drafts + client reviews + signed client library</p>
        <div class="statrow" style="margin-top:10px">
          ${stat(side.client.review,"Under review")}${stat(side.client.agreed,"Agreed")}${stat(side.client.approved,"Approved")}${stat(side.client.executed,"Executed")}
        </div></div>
    </div>
    <div class="card"><div class="eyebrow">This month</div>
      <div class="statrow" style="margin-top:10px">${stat(closed,"Closed in "+monthName,"#0a6496")}</div>
      <p class="muted">Counts agreements marked executed, vendor/client agreements executed or closed, and library agreements signed during ${esc(monthName)}.</p></div>`;
}
window.OPS.routes.dashboard = dashboard;
})();
