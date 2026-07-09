/* ============================================================================
   Athena Agreements Studio — Dashboard
   A short status snapshot: the tool-drafted agreement pipeline, plus combined
   Vendor and Client agreement counts (drafts + contract reviews + signed
   libraries), plus how many closed this month.
   Every number is CLICKABLE — it lists the exact records behind it and links
   to where each one lives, so a count can always be traced to its source.
   ============================================================================ */
(function(){
const { $, esc, fmtDate } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

// Which side is a tool-drafted agreement on? Client Agreement template or a
// "client" category ⇒ client; everything else (consultants/vendors) ⇒ vendor.
function sideOfAgreement(a){
  if(a.template_key==="client_llc") return "client";
  if(/client/i.test(a.category||"")) return "client";
  return "vendor";
}
const titleOfAg  = a=> a.title || a.counterparty || "(untitled agreement)";
const titleOfNeg = n=> n.title || n.counterparty || "(untitled review)";
const titleOfEx  = e=> e.title || e.name || e.counterparty || e.file_name || "(untitled)";

// buckets[key] = [ {title, where, sub, tool, id} ]  — the records behind each stat
let BUCKETS = {};
function push(key, item){ (BUCKETS[key] = BUCKETS[key] || []).push(item); }

function stat(n,label,color,key){
  const c = key ? ' style="cursor:pointer"' : "";
  const k = key ? ` data-key="${key}"` : "";
  const arrow = key && n ? ' <span style="opacity:.5;font-size:11px">▸</span>' : "";
  return `<div class="stat"${c}${k} title="${key?'Click to see these records':''}">
    <div class="n"${color?` style="color:${color}"`:""}>${n||0}${arrow}</div><div class="l">${esc(label)}</div></div>`;
}

async function dashboard(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Overview</div><h1>Dashboard</h1>
    <p class="muted">Tip: click any number to see the exact agreements behind it.</p>
    <div id="dbBody" class="muted">Loading…</div><div id="dbDetail"></div>`;
  const grab=(t,cols)=>sb().from(t).select(cols).then(r=>r.data||[]).catch(()=>[]);
  const [ags, negs, exec] = await Promise.all([
    grab("agreements","id,status,template_key,category,title,counterparty,agreement_no,updated_at"),
    grab("negotiations","*"),
    grab("executed_agreements","*"),
  ]);
  BUCKETS = {};

  // --- tool-drafted pipeline ---
  const pc={draft:0,in_review:0,approved:0,executed:0};
  ags.forEach(a=>{ if(pc[a.status]!=null){ pc[a.status]++;
    push("pipe."+a.status, { title:titleOfAg(a), where:"Agreements", sub:a.status.replace("_"," ")+(a.agreement_no?" · "+a.agreement_no:""), tool:"agreements", id:a.id }); } });

  // --- combined vendor / client buckets ---
  const mk=()=>({review:0,agreed:0,approved:0,executed:0});
  const side={vendor:mk(), client:mk()};
  ags.forEach(a=>{ const sd=sideOfAgreement(a), s=side[sd];
    const put=(bkt)=>{ s[bkt]++; push(sd+"."+bkt,{ title:titleOfAg(a), where:"Agreement (drafted in tool)", sub:a.status.replace("_"," ")+(a.agreement_no?" · "+a.agreement_no:""), tool:"agreements", id:a.id }); };
    if(a.status==="in_review") put("review"); else if(a.status==="approved") put("approved"); else if(a.status==="executed") put("executed"); });
  negs.forEach(n=>{ const sd=n.kind==="client"?"client":"vendor", s=side[sd], st=n.status;
    const tool=sd==="client"?"client_reviews":"vendor_reviews";
    const put=(bkt)=>{ s[bkt]++; push(sd+"."+bkt,{ title:titleOfNeg(n), where:"Contract review ("+sd+")", sub:"status: "+(st||"")+(n.agreement_no?" · "+n.agreement_no:""), tool, id:n.id }); };
    if(st==="open"||st==="in_review"||st==="under_review") put("review");
    else if(st==="agreed") put("agreed");
    else if(st==="approved") put("approved");
    else if(st==="executed"||st==="closed") put("executed"); });
  exec.forEach(e=>{ const sd=e.kind==="client"?"client":"vendor", s=side[sd];
    const tool=sd==="client"?"client_library":"vendor_library";
    s.executed++; push(sd+".executed",{ title:titleOfEx(e), where:"Signed library ("+sd+")", sub:"executed"+(e.agreement_no?" · "+e.agreement_no:"")+(e.signed_date?" · "+fmtDate(e.signed_date):""), tool, id:e.id }); });

  // --- closed this calendar month ---
  const now=new Date(), y=now.getFullYear(), mo=now.getMonth();
  const inMonth=(iso)=>{ if(!iso) return false; const d=new Date(iso); return d.getFullYear()===y && d.getMonth()===mo; };
  ags.forEach(a=>{ if(a.status==="executed" && inMonth(a.updated_at)) push("month.closed",{ title:titleOfAg(a), where:"Agreement (drafted)", sub:"executed "+fmtDate(a.updated_at), tool:"agreements", id:a.id }); });
  negs.forEach(n=>{ if((n.status==="executed"||n.status==="closed") && inMonth(n.updated_at)){ const sd=n.kind==="client"?"client":"vendor";
    push("month.closed",{ title:titleOfNeg(n), where:"Contract review ("+sd+")", sub:n.status+" "+fmtDate(n.updated_at), tool:sd==="client"?"client_reviews":"vendor_reviews", id:n.id }); } });
  exec.forEach(e=>{ if(inMonth(e.signed_date||e.created_at)){ const sd=e.kind==="client"?"client":"vendor";
    push("month.closed",{ title:titleOfEx(e), where:"Signed library ("+sd+")", sub:"signed "+fmtDate(e.signed_date||e.created_at), tool:sd==="client"?"client_library":"vendor_library", id:e.id }); } });
  const closed=(BUCKETS["month.closed"]||[]).length;
  const monthName=now.toLocaleString(undefined,{month:"long",year:"numeric"});

  $("dbBody").innerHTML=`
    <div class="card"><div class="eyebrow">Agreements drafted in the tool</div>
      <div class="statrow" style="margin-top:10px">
        ${stat(pc.draft,"Under drafting",null,"pipe.draft")}
        ${stat(pc.in_review,"Under review","#9a5b00","pipe.in_review")}
        ${stat(pc.approved,"Approved","#3e6b20","pipe.approved")}
        ${stat(pc.executed,"Executed","#0a6496","pipe.executed")}
      </div></div>
    <div class="fgrid">
      <div class="card"><div class="eyebrow">Vendor agreements</div>
        <p class="muted" style="margin:2px 0 0">Drafts + vendor reviews + signed vendor library</p>
        <div class="statrow" style="margin-top:10px">
          ${stat(side.vendor.review,"Under review",null,"vendor.review")}${stat(side.vendor.agreed,"Agreed",null,"vendor.agreed")}${stat(side.vendor.approved,"Approved",null,"vendor.approved")}${stat(side.vendor.executed,"Executed",null,"vendor.executed")}
        </div></div>
      <div class="card"><div class="eyebrow">Client agreements</div>
        <p class="muted" style="margin:2px 0 0">Drafts + client reviews + signed client library</p>
        <div class="statrow" style="margin-top:10px">
          ${stat(side.client.review,"Under review",null,"client.review")}${stat(side.client.agreed,"Agreed",null,"client.agreed")}${stat(side.client.approved,"Approved",null,"client.approved")}${stat(side.client.executed,"Executed",null,"client.executed")}
        </div></div>
    </div>
    <div class="card"><div class="eyebrow">This month</div>
      <div class="statrow" style="margin-top:10px">${stat(closed,"Closed in "+monthName,"#0a6496","month.closed")}</div>
      <p class="muted">Counts agreements marked executed, vendor/client agreements executed or closed, and library agreements signed during ${esc(monthName)}.</p></div>`;

  $("dbBody").querySelectorAll("[data-key]").forEach(el=>el.addEventListener("click",()=>showBucket(el.getAttribute("data-key"), el)));
}

function showBucket(key, el){
  const items = BUCKETS[key] || [];
  const label = (el.querySelector(".l")||{}).textContent || "records";
  const host = $("dbDetail");
  if(!items.length){ host.innerHTML=`<div class="card muted">No records behind “${esc(label)}”.</div>`; host.scrollIntoView({behavior:"smooth",block:"nearest"}); return; }
  host.innerHTML=`<div class="card"><div class="row"><h3 style="margin:0">“${esc(label)}” — ${items.length} record${items.length>1?"s":""}</h3>
      <div class="spacer"></div><button class="btn sm" id="dbDetClose">Close</button></div>
    <table style="margin-top:8px"><thead><tr><th>Title</th><th>Where it lives</th><th>Detail</th><th></th></tr></thead>
      <tbody>${items.map((it,i)=>`<tr>
        <td><b>${esc(it.title)}</b></td><td>${esc(it.where)}</td><td class="muted">${esc(it.sub||"")}</td>
        <td><button class="btn sm" data-open="${i}">Open ›</button></td></tr>`).join("")}</tbody></table></div>`;
  $("dbDetClose").addEventListener("click",()=>{ host.innerHTML=""; });
  host.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>{
    const it=items[+b.getAttribute("data-open")];
    window.OPS.openTool(it.tool);
    if(it.tool==="agreements" && window.OPS.routes.viewAgreementDetail){ try{ window.OPS.routes.viewAgreementDetail(it.id); }catch(e){} }
  }));
  host.scrollIntoView({behavior:"smooth",block:"nearest"});
}

window.OPS.routes.dashboard = dashboard;
})();
