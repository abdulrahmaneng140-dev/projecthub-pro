// ══ API CLIENT ══
const API={
  base:window.location.origin+'/api',token:null,
  headers(){const h={'Content-Type':'application/json'};if(this.token)h['Authorization']='Bearer '+this.token;return h;},
  async req(method,path,body){
    try{
      const res=await fetch(this.base+path,{method,headers:this.headers(),body:body?JSON.stringify(body):undefined});
      if(res.status===401){logout();return null;}
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||'خطأ في الخادم');
      document.getElementById('conn-banner').classList.remove('show');
      return data;
    }catch(e){
      if(e.name==='TypeError')document.getElementById('conn-banner').classList.add('show');
      throw e;
    }
  },
  get:path=>API.req('GET',path),
  post:(path,body)=>API.req('POST',path,body),
  put:(path,body)=>API.req('PUT',path,body),
  del:path=>API.req('DELETE',path),
};

// ══ STATE ══
let CU=null,projects=[],tasks=[],teamMembers=[],milestones=[];
let curPage='dashboard',editTId=null,editPId=null,editMsId=null,editMemId=null,sbMini=false;
let dC=null,bC=null,tC=null,pfC=null,currentReport=null;

const COLS=[{id:'backlog',n:'Backlog',c:'#5c657e'},{id:'todo',n:'قيد التخطيط',c:'#4f8ef7'},{id:'doing',n:'جارية',c:'#f0a030'},{id:'review',n:'مراجعة',c:'#9b72f4'},{id:'done',n:'مكتملة',c:'#22c87a'}];
const SM={'on-track':{l:'على المسار',c:'p-ok'},'at-risk':{l:'في خطر',c:'p-warn'},'delayed':{l:'متأخر',c:'p-danger'},'done':{l:'مكتمل',c:'p-done'}};
const RMETA={admin:{l:'Admin',cls:'rb-admin',desc:'صلاحية كاملة'},pm:{l:'PM',cls:'rb-pm',desc:'إدارة مشاريع+مهام+فريق'},lead:{l:'Lead',cls:'rb-lead',desc:'تعديل مهام المشروع'},engineer:{l:'Engineer',cls:'rb-engineer',desc:'مهامه الشخصية فقط'},viewer:{l:'Viewer',cls:'rb-viewer',desc:'عرض فقط'}};
const MS_TYPE={milestone:{icon:'ti-flag-3',color:'#f05a5a',label:'Milestone'},phase:{icon:'ti-package',color:'#4f8ef7',label:'مرحلة'},delivery:{icon:'ti-send',color:'#22c87a',label:'تسليم'},review:{icon:'ti-zoom-check',color:'#9b72f4',label:'مراجعة'}};
const MS_SM={upcoming:{l:'قادم',c:'p-muted'},'in-progress':{l:'جارٍ',c:'p-warn'},done:{l:'مكتمل',c:'p-ok'},delayed:{l:'متأخر',c:'p-danger'}};
const TL_EVENTS=[{date:'2 يوليو',text:'تسليم SVAX-NET-002',color:'#4f8ef7'},{date:'5 يوليو',text:'EBO CFR 21 Review',color:'#22c87a'},{date:'8 يوليو',text:'اجتماع MRC Systems',color:'#9b72f4'},{date:'10 يوليو',text:'GPI Phase 2 تسليم',color:'#f0a030'},{date:'20 يوليو',text:'BMS Bridge v3 اختبار',color:'#f05a5a'}];
const ACOLORS=['#4f8ef7','#22c87a','#9b72f4','#f0a030','#f472b6','#2dd4bf','#f05a5a'];

// ══ HELPERS ══
const fmt=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(0)+'K':n;
const ov=d=>d&&d<new Date().toISOString().slice(0,10);
const can=p=>{
  if(!CU)return false;if(CU.role==='admin')return true;if(CU.role==='viewer')return false;
  if(p==='add_project')return CU.role==='pm';
  if(p==='add_task')return['pm','lead','engineer'].includes(CU.role);
  if(p==='settings')return['pm','admin'].includes(CU.role);
  if(p==='view_team')return['pm','lead'].includes(CU.role);
  return true;
};
function health(p){
  let s=100;const bp=p.budget>0?p.spent/p.budget:0;
  if(bp>.95)s-=30;else if(bp>.85)s-=15;else if(bp>.75)s-=5;
  if(p.status==='delayed')s-=30;else if(p.status==='at-risk')s-=15;
  tasks.filter(t=>t.project_id===p.id&&t.col!=='done'&&ov(t.due_date)).forEach(()=>s-=8);
  return Math.max(0,Math.min(100,s));
}
const hc=s=>s>=80?'#22c87a':s>=60?'#f0a030':'#f05a5a';
const hl=s=>s>=80?'ممتاز':s>=60?'متوسط':'ضعيف';

function initSels(){
  [['ft-proj','proj'],['kb-pf','proj'],['g-pf','proj'],['tl-pf','proj'],['sr-pf','proj'],['doc-pf','proj'],['cm-pf','proj'],['is-pf','proj'],['rk-pf','proj'],['co-pf','proj'],['cpm-pf','proj'],
   ['fp-lead','team'],['ft-assign','team'],['kb-af','team'],['ms-proj','proj']].forEach(([id,type])=>{
    const s=document.getElementById(id);if(!s)return;
    const v=s.value;
    if(type==='proj')s.innerHTML='<option value="">كل المشاريع</option>'+projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
    else if(type==='team'){
      const pfx=id==='kb-af'||id==='sr-pf'?'<option value="">كل الأعضاء</option>':'';
      s.innerHTML=pfx+teamMembers.map(m=>`<option value="${m.name}">${m.name}</option>`).join('');
    }
    s.value=v;
  });
  document.getElementById('nc-proj').textContent=projects.length;
}
function closeModal(id){document.getElementById(id).classList.remove('open');}

// ══ AUTH ══
async function tryLogin(){
  const u=document.getElementById('lu').value.trim(),p=document.getElementById('lp').value;
  if(!u||!p){document.getElementById('lerr').textContent='أدخل اسم المستخدم وكلمة المرور';return;}
  const btn=document.getElementById('lbtn');
  btn.disabled=true;btn.innerHTML='<i class="ti ti-loader-2" style="animation:spin 1s linear infinite;font-size:16px"></i>جاري الدخول...';
  try{
    const data=await API.post('/auth/login',{username:u,password:p});
    if(!data)return;
    API.token=data.token;localStorage.setItem('ph_token',data.token);CU=data.user;
    document.getElementById('lerr').textContent='';
    document.getElementById('login-screen').style.display='none';
    document.getElementById('app').classList.add('on');
    setupUI();await loadAllData();renderDashboard();
    toast('أهلاً '+CU.name+' 👋','ok');
  }catch(e){document.getElementById('lerr').textContent=e.message;}
  finally{btn.disabled=false;btn.innerHTML='<i class="ti ti-login"></i>تسجيل الدخول';}
}
function logout(){
  API.token=null;localStorage.removeItem('ph_token');CU=null;
  document.getElementById('app').classList.remove('on');
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('lu').value='';document.getElementById('lp').value='';
}
function setupUI(){
  const av=document.getElementById('uav');
  av.textContent=CU.name[0];av.style.background=(CU.color||'#4f8ef7')+'33';av.style.color=CU.color||'#4f8ef7';
  document.getElementById('uname').textContent=CU.name;
  const rb=document.getElementById('urbadge');rb.textContent=RMETA[CU.role]?.l||CU.role;rb.className='rbadge rb-'+CU.role;
  document.getElementById('btn-addtask').style.display=can('add_task')?'flex':'none';
  document.getElementById('btn-addproj').style.display=can('add_project')?'flex':'none';
  if(!can('view_team'))document.getElementById('sbg-team').style.display='none';
  if(!can('settings'))document.getElementById('nav-settings').style.display='none';
}
async function autoLogin(){
  const token=localStorage.getItem('ph_token');if(!token)return;
  API.token=token;
  try{
    const user=await API.get('/auth/me');if(!user)return;
    CU={id:user.id,name:user.full_name,role:user.role,color:user.color,username:user.username};
    document.getElementById('login-screen').style.display='none';
    document.getElementById('app').classList.add('on');
    setupUI();await loadAllData();renderDashboard();
  }catch(e){logout();}
}

// ══ DATA ══
async function loadAllData(){
  try{
    [projects,tasks,teamMembers,milestones]=await Promise.all([API.get('/projects'),API.get('/tasks'),API.get('/team'),API.get('/milestones')]);
    initSels();
  }catch(e){toast('خطأ في تحميل البيانات','err');}
}
async function refreshData(){
  await loadAllData();
  if(curPage==='dashboard')renderDashboard();
  else if(curPage==='kanban')renderKanban();
  else if(curPage==='projects')renderProjects();
  else if(curPage==='team')renderTeam();
  else if(curPage==='timeline')renderTimeline();
}
setInterval(refreshData,30000);

// ══ NAV ══
const PT={dashboard:['لوحة التحكم','نظرة عامة'],projects:['المشاريع','إدارة المشاريع'],kanban:['Kanban Board','تتبع المهام'],gantt:['Gantt Chart','الجدول الزمني'],timeline:['Timeline','الخط الزمني'],team:['الفريق','أعضاء الفريق'],sitereport:['Site Report اليومي','تقارير الأداء'],log:['سجل النشاط','مسجل على الخادم'],settings:['الإعدادات','إعدادات النظام'],documents:['تتبع المستندات','المستندات الناقصة والمتأخرة'],portfolio:['Portfolio','إدارة المشاريع المتعددة'],commissioning:['مصفوفة الإنجاز','تدقيق تفصيلي لكل لوحة عبر مراحل الإنجاز'],issues:['Issues Log','تتبع مشاكل الموقع والتشغيل'],risks:['سجل المخاطر','مخاطر محتملة — احتمالية × تأثير'],changeorders:['إدارة التغييرات','طلبات تغيير النطاق/التكلفة/الجدول الزمني'],cpm:['الجدولة الزمنية (CPM)','المسار الحرج بناءً على علاقات المهام']};
async function goto(pg){
  if(pg==='team'&&!can('view_team')){toast('ليس لديك صلاحية','err');return;}
  if(pg==='settings'&&!can('settings')){toast('ليس لديك صلاحية','err');return;}
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+pg)?.classList.add('active');
  document.querySelector(`.ni[onclick*="'${pg}'"]`)?.classList.add('active');
  const t=PT[pg]||[pg,''];
  document.getElementById('tb-pg').textContent=t[0];document.getElementById('tb-sub').textContent=t[1];
  curPage=pg;
  if(pg==='dashboard')renderDashboard();
  else if(pg==='projects')renderProjects();
  else if(pg==='kanban')renderKanban();
  else if(pg==='gantt')renderGantt();
  else if(pg==='timeline')renderTimeline();
  else if(pg==='team')renderTeam();
  else if(pg==='sitereport')renderSiteReport();
  else if(pg==='log')renderLog();
  else if(pg==='settings')renderSettings();
  else if(pg==='documents')renderDocuments();
  else if(pg==='portfolio')renderPortfolio();
  else if(pg==='commissioning')renderCommissioning();
  else if(pg==='issues')renderIssues();
  else if(pg==='risks')renderRisks();
  else if(pg==='changeorders')renderChangeOrders();
  else if(pg==='cpm')renderCPM();
}
function toggleSB(){sbMini=!sbMini;document.getElementById('sb').classList.toggle('mini',sbMini);document.getElementById('sb-ic').className=sbMini?'ti ti-layout-sidebar-left-expand':'ti ti-layout-sidebar-right-collapse';}

// ══ DASHBOARD ══
function renderDashboard(){
  const openT=tasks.filter(t=>t.col!=='done').length,highT=tasks.filter(t=>t.priority==='high'&&t.col!=='done').length;
  const totB=projects.reduce((a,p)=>a+(+p.budget||0),0),totS=projects.reduce((a,p)=>a+(+p.spent||0),0);
  const onl=teamMembers.filter(m=>m.is_online).length;
  document.getElementById('kgrid').innerHTML=[
    {bg:'rgba(79,142,247,.07)',ic:'#4f8ef7',icon:'ti-briefcase',v:projects.length,l:'مشاريع نشطة',tcls:'kt-up',tr:projects.filter(p=>p.status==='on-track').length+' على المسار',ft:projects.filter(p=>p.status==='delayed').length+' متأخرة'},
    {bg:'rgba(240,160,48,.07)',ic:'#f0a030',icon:'ti-list-check',v:openT,l:'مهام مفتوحة',tcls:highT>0?'kt-warn':'kt-up',tr:highT+' عاجلة',ft:tasks.filter(t=>t.col==='done').length+' مكتملة'},
    {bg:'rgba(34,200,122,.07)',ic:'#22c87a',icon:'ti-currency-dollar',v:'SAR '+fmt(totB),l:'إجمالي الميزانيات',tcls:totB>0&&totS/totB>.85?'kt-down':'kt-up',tr:(totB>0?Math.round(totS/totB*100):0)+'% مستخدم',ft:'منفق SAR '+fmt(totS)},
    {bg:'rgba(155,114,244,.07)',ic:'#9b72f4',icon:'ti-users',v:teamMembers.length,l:'أعضاء الفريق',tcls:'kt-up',tr:onl+' متصل',ft:(teamMembers.length-onl)+' غير متصل'},
  ].map(k=>`<div class="kcard"><div class="kglow" style="background:${k.ic}"></div><div class="ktop"><div class="kicon" style="background:${k.bg}"><i class="ti ${k.icon}" style="color:${k.ic}"></i></div><div class="ktrend ${k.tcls}"><i class="ti ${k.tcls==='kt-up'?'ti-trending-up':k.tcls==='kt-warn'?'ti-alert-triangle':'ti-trending-down'}"></i>${k.tr}</div></div><div class="kval">${k.v}</div><div class="klbl">${k.l}</div><div class="kfoot">${k.ft}</div></div>`).join('');
  document.getElementById('d-proj').innerHTML=projects.length?projects.map(p=>`<div class="dr"><div class="dr-dot" style="background:${p.color}"></div><div class="dr-name">${p.name}</div><div class="bw"><div class="bf" style="background:${p.color};width:${p.pct}%"></div></div><div class="bpct">${p.pct}%</div><span class="pill ${SM[p.status].c}">${SM[p.status].l}</span></div>`).join(''):'<div class="empty">لا توجد مشاريع</div>';
  document.getElementById('d-tl').innerHTML=TL_EVENTS.map((t,i)=>`<div class="tlrow"><div class="tlside"><div class="tldot" style="background:${t.color}"></div>${i<TL_EVENTS.length-1?'<div class="tlline"></div>':''}</div><div class="tlinfo"><div class="tltitle">${t.text}</div><div class="tldate">${t.date}</div></div></div>`).join('');
  document.getElementById('d-bud').innerHTML=projects.map(p=>{const pc=p.budget>0?Math.round(p.spent/p.budget*100):0;const c=pc>90?'#f05a5a':pc>70?'#f0a030':p.color;return `<div class="budrow"><div class="budid">${p.id}</div><div class="budwrap"><div class="budfill" style="background:${c};width:${pc}%"></div></div><div class="budpct" style="color:${c}">${pc}%</div><div class="budnums">${fmt(p.spent||0)} / ${fmt(p.budget||0)}</div></div>`;}).join('');
  document.getElementById('d-health').innerHTML=projects.map(p=>{const h=health(p);const c=hc(h);return `<div class="hbrow"><div class="dr-dot" style="background:${p.color}"></div><div style="font-size:12px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.id}</div><div class="hbwrap"><div class="hbfill" style="background:${c};width:${h}%"></div></div><div style="font-size:11px;font-weight:700;color:${c};min-width:28px;text-align:right">${h}</div><span class="pill" style="font-size:9px;padding:2px 5px;background:${c}18;color:${c};border:1px solid ${c}33">${hl(h)}</span></div>`;}).join('');
  document.getElementById('d-team').innerHTML=teamMembers.slice(0,5).map(m=>`<div class="dr"><div class="av" style="background:${m.color}22;color:${m.color}">${m.name[0]}</div><div style="flex:1"><div class="dr-name">${m.name}</div><div class="dr-sub">${m.role||''}</div></div><div style="width:9px;height:9px;border-radius:50%;background:${m.is_online?'#22c87a':'#3a4060'}"></div></div>`).join('');
  renderDonut();renderBar();renderTrend();updateNBadge();
}
function renderDonut(){const ctx=document.getElementById('c-donut')?.getContext('2d');if(!ctx)return;if(dC)dC.destroy();const vals=COLS.map(c=>tasks.filter(t=>t.col===c.id).length);dC=new Chart(ctx,{type:'doughnut',data:{labels:COLS.map(c=>c.n),datasets:[{data:vals,backgroundColor:['#3a4060','#4f8ef7','#f0a030','#9b72f4','#22c87a'],borderWidth:0,hoverOffset:5}]},options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{position:'bottom',labels:{color:'#9aa3bc',font:{size:11},padding:10,boxWidth:10}}}}});}
function renderBar(){const ctx=document.getElementById('c-bar')?.getContext('2d');if(!ctx)return;if(bC)bC.destroy();bC=new Chart(ctx,{type:'bar',data:{labels:projects.map(p=>p.id),datasets:[{data:projects.map(p=>p.pct),backgroundColor:projects.map(p=>(p.color||'#4f8ef7')+'bb'),borderRadius:4,borderSkipped:false}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{max:100,grid:{color:'#2e344880'},ticks:{color:'#5c657e',font:{size:10}}},y:{grid:{display:false},ticks:{color:'#9aa3bc',font:{size:11}}}}}});}
function renderTrend(){const ctx=document.getElementById('c-trend')?.getContext('2d');if(!ctx)return;if(tC)tC.destroy();const months=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو'];const ds=projects.slice(0,3).map(p=>{const base=Math.max(0,p.pct-45);const data=months.map((_,i)=>Math.min(100,Math.round(base+(p.pct-base)*(i/(months.length-1)))));return{label:p.id,data,borderColor:p.color,backgroundColor:(p.color||'#4f8ef7')+'15',borderWidth:2,fill:true,tension:.4,pointRadius:3};});tC=new Chart(ctx,{type:'line',data:{labels:months,datasets:ds},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#9aa3bc',font:{size:10},padding:8,boxWidth:10}}},scales:{y:{max:100,grid:{color:'#2e344860'},ticks:{color:'#5c657e',font:{size:10},callback:v=>v+'%'}},x:{grid:{color:'#2e344830'},ticks:{color:'#5c657e',font:{size:10}}}}}});}

// ══ PROJECTS ══
function renderProjects(){
  document.getElementById('proj-sub').textContent=projects.length+' مشاريع';
  const canAdd=can('add_project');
  document.getElementById('proj-acts').innerHTML=canAdd?'<button class="tbtn pri" onclick="openPM()"><i class="ti ti-plus"></i>مشروع جديد</button>':'';
  document.getElementById('proj-grid').innerHTML=projects.length?projects.map(p=>{
    const s=SM[p.status],h=health(p),hcol=hc(h),tc=tasks.filter(t=>t.project_id===p.id).length;
    const acts=canAdd?`<div style="display:flex;gap:6px;margin-top:10px"><button class="tcabtn" onclick="event.stopPropagation();openPM('${p.id}')"><i class="ti ti-edit"></i>تعديل</button><button class="tcabtn" style="color:var(--red)" onclick="event.stopPropagation();delProject('${p.id}')"><i class="ti ti-trash"></i></button></div>`:'';
    return `<div class="pjcard"><div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px"><div style="width:40px;height:40px;border-radius:10px;background:${p.color}22;color:${p.color};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700">${(p.id||'P')[0]}</div><div style="text-align:left"><span class="pill ${s.c}">${s.l}</span><div style="font-size:10px;font-weight:700;color:${hcol};margin-top:4px">Health: ${h}</div></div></div><div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:3px">${p.name}</div><div style="font-size:11px;color:var(--t3);margin-bottom:8px"><i class="ti ti-user" style="font-size:11px"></i> ${p.lead||'—'}</div><div style="height:3px;background:var(--bg4);border-radius:2px;margin-bottom:10px;overflow:hidden"><div style="height:100%;background:${p.color};width:${p.pct}%;border-radius:2px"></div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><div style="font-size:10px;color:var(--t3)">الإنجاز</div><div style="font-size:12px;color:var(--text);font-weight:500">${p.pct}%</div></div><div><div style="font-size:10px;color:var(--t3)">المهام</div><div style="font-size:12px;color:var(--text);font-weight:500">${tc}</div></div><div><div style="font-size:10px;color:var(--t3)">الميزانية</div><div style="font-size:12px;color:var(--text);font-weight:500">SAR ${fmt(p.budget||0)}</div></div><div><div style="font-size:10px;color:var(--t3)">المنفق</div><div style="font-size:12px;font-weight:500;color:${(p.budget>0&&p.spent/p.budget>.85)?'#f05a5a':'var(--text)'}">SAR ${fmt(p.spent||0)}</div></div></div>${acts}</div>`;
  }).join(''):'<div class="empty" style="grid-column:1/-1">لا توجد مشاريع</div>';
}
async function delProject(id){if(!confirm('حذف المشروع وجميع مهامه؟'))return;try{await API.del('/projects/'+id);await refreshData();toast('تم الحذف','ok');}catch(e){toast(e.message,'err');}}

// ══ KANBAN ══
function renderKanban(){
  initSels();
  const q=document.getElementById('kb-q')?.value?.trim()||'',pf=document.getElementById('kb-pf')?.value||'',prf=document.getElementById('kb-prf')?.value||'',af=document.getElementById('kb-af')?.value||'';
  let ft=tasks.filter(t=>{
    if(q&&!t.title?.includes(q)&&!t.project_id?.includes(q))return false;
    if(pf&&t.project_id!==pf)return false;if(prf&&t.priority!==prf)return false;
    if(af&&t.assigned_to!==af)return false;
    if(CU?.role==='engineer'&&t.assigned_to!==CU.name)return false;
    return true;
  });
  document.getElementById('kb-sub').textContent=ft.length+' مهمة';
  const canAdd=can('add_task');
  document.getElementById('kb-acts').innerHTML=canAdd?'<button class="tbtn pri" onclick="openTM()"><i class="ti ti-plus"></i>مهمة جديدة</button>':'';
  document.getElementById('kbboard').innerHTML=COLS.map(col=>{
    const ct=ft.filter(t=>t.col===col.id);
    const cards=ct.map(t=>`<div class="kbc" onclick="openTM(null,${t.id})"><div class="kbct">${t.title}</div><div class="kbcm"><span class="pt-${t.priority[0]}">${t.priority==='high'?'عالية':t.priority==='med'?'متوسطة':'منخفضة'}</span><span class="kbca">${t.assigned_to||'—'}</span></div><div style="display:flex;align-items:center;justify-content:space-between;margin-top:5px"><span class="kbcpj">${t.project_id||''}</span>${t.due_date?`<span class="kbcdate ${ov(t.due_date)&&t.col!=='done'?'late':''}"><i class="ti ti-calendar" style="font-size:10px"></i>${t.due_date.slice(5)}</span>`:''}</div></div>`).join('');
    const addBtn=canAdd?`<button class="kbadd" onclick="openTM('${col.id}')"><i class="ti ti-plus"></i>إضافة</button>`:'';
    return `<div class="kbcol"><div class="kbchd"><div class="kbcn"><div class="kbcd" style="background:${col.c}"></div>${col.n}</div><span class="kbcnt">${ct.length}</span></div><div class="kbbody">${cards}${ct.length===0?'<div class="kbempty">فارغة</div>':''}${addBtn}</div></div>`;
  }).join('');
}

// ══ GANTT ══
function renderGantt(){
  const months=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const N=12,todayP=((new Date().getMonth()+1)/N*100).toFixed(1);
  document.getElementById('g-months').innerHTML=months.map(m=>`<div class="gmcell">${m}</div>`).join('');
  const pf=document.getElementById('g-pf')?.value||'';
  const rows=milestones.filter(m=>m.type==='phase'||m.type==='delivery').filter(m=>!pf||m.project_id===pf);
  if(!rows.length){document.getElementById('g-body').innerHTML='<tr><td colspan="5" class="empty">لا توجد مراحل — أضفها من صفحة Timeline</td></tr>';return;}
  document.getElementById('g-body').innerHTML=rows.map(r=>{
    const sm=r.start_date?new Date(r.start_date).getMonth():0,em=r.end_date?new Date(r.end_date).getMonth()+1:sm+1;
    const L=(sm/N*100).toFixed(1),W=((em-sm)/N*100).toFixed(1);
    const proj=projects.find(p=>p.id===r.project_id),c=proj?.color||'#4f8ef7',ss=MS_SM[r.status]||{l:'—',c:'p-muted'};
    return `<tr><td style="padding:9px 12px"><div style="font-size:13px;color:var(--text);font-weight:500">${r.project_id}</div><div style="font-size:11px;color:var(--t3)">${r.title}</div></td><td style="padding:9px 12px;font-size:12px;color:#9aa3bc">${proj?.lead||'—'}</td><td style="padding:9px 12px"><span class="pill ${ss.c}">${ss.l}</span></td><td style="padding:9px 12px;font-size:12px;font-weight:700">${r.pct}%</td><td style="padding:9px 12px;position:relative"><div style="position:relative;height:22px"><div class="gtoday" style="left:${todayP}%"><span class="gtoday-lbl">اليوم</span></div><div class="gbarbg" style="position:absolute;top:6px;left:${L}%;width:${W}%;height:10px"><div class="gbarfill" style="background:${c};width:${r.pct}%"></div></div></div></td></tr>`;
  }).join('');
}

// ══ TIMELINE ══
function renderTimeline(){
  initSels();const pf=document.getElementById('tl-pf')?.value||'';
  const projs=pf?projects.filter(p=>p.id===pf):projects;
  const vis=document.getElementById('timeline-vis');if(!vis)return;
  let html='';
  projs.forEach(proj=>{
    const pms=[...milestones.filter(m=>m.project_id===proj.id)].sort((a,b)=>(a.start_date||'').localeCompare(b.start_date||''));
    html+=`<div style="margin-bottom:24px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:12px 16px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r)"><div style="width:10px;height:10px;border-radius:50%;background:${proj.color}"></div><div style="font-size:14px;font-weight:700;color:var(--text);flex:1">${proj.name}</div><span class="pill ${SM[proj.status].c}">${SM[proj.status].l}</span><div style="font-size:12px;color:var(--t3)">${proj.pct}% إنجاز</div></div>`;
    if(!pms.length){html+=`<div style="text-align:center;padding:20px;color:var(--t3);font-size:12px;background:var(--bg2);border:1px dashed var(--border);border-radius:var(--r);margin-bottom:8px">لا توجد مراحل — <span style="color:var(--accent);cursor:pointer" onclick="openMsModal('${proj.id}')">إضافة milestone</span></div>`;}
    else{
      html+=`<div style="position:relative;padding:0 16px;margin-bottom:16px"><div style="position:absolute;top:19px;right:16px;left:16px;height:2px;background:var(--border)"></div><div class="ms-strip">`;
      pms.forEach(m=>{const mt=MS_TYPE[m.type]||MS_TYPE.milestone;const sc={done:'#22c87a','in-progress':'#f0a030',upcoming:'#5c657e',delayed:'#f05a5a'}[m.status]||'#5c657e';const mss=MS_SM[m.status]||{l:'—',c:'p-muted'};html+=`<div class="ms-node" onclick="openMsModal(null,${m.id})" title="${m.notes||''}"><div class="ms-node-ic" style="background:${sc}22;border-color:${sc}"><i class="ti ${mt.icon}" style="color:${sc};font-size:16px"></i></div><div class="ms-node-title">${m.title}</div><div class="ms-node-date">${m.start_date?.slice(5).replace('-','/')||''}</div><span class="pill ${mss.c}" style="font-size:9px">${mss.l}</span>${m.pct>0?`<div style="font-size:10px;color:${sc};font-weight:700">${m.pct}%</div>`:''}</div>`;});
      html+=`</div></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">`;
      pms.forEach(m=>{const mt=MS_TYPE[m.type]||MS_TYPE.milestone;const sc={done:'#22c87a','in-progress':'#f0a030',upcoming:'#5c657e',delayed:'#f05a5a'}[m.status]||'#5c657e';const mss=MS_SM[m.status]||{l:'—',c:'p-muted'};html+=`<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:12px;cursor:pointer;transition:all .15s" onclick="openMsModal(null,${m.id})" onmouseover="this.style.borderColor='var(--border2)'" onmouseout="this.style.borderColor='var(--border)'"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div style="width:28px;height:28px;border-radius:7px;background:${sc}18;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ti ${mt.icon}" style="color:${sc};font-size:14px"></i></div><div style="flex:1"><div style="font-size:12px;font-weight:600;color:var(--text)">${m.title}</div><div style="font-size:10px;color:var(--t3)">${mt.label}</div></div><span class="pill ${mss.c}" style="font-size:9px">${mss.l}</span></div><div style="font-size:11px;color:var(--t3);margin-bottom:6px">${m.start_date||''} ${m.end_date&&m.end_date!==m.start_date?'→ '+m.end_date:''}</div>${m.pct>0?`<div style="height:3px;background:var(--bg4);border-radius:2px;overflow:hidden;margin-bottom:6px"><div style="height:100%;background:${sc};width:${m.pct}%"></div></div>`:''}<div style="font-size:11px;color:var(--t2);line-height:1.4">${m.notes||''}</div></div>`;});
      html+=`</div>`;
    }
    html+=`</div>`;
  });
  vis.innerHTML=html||'<div class="empty">لا توجد مشاريع</div>';
}

// ══ TEAM ══
function renderTeam(){
  document.getElementById('team-sub').textContent=teamMembers.length+' أعضاء — '+teamMembers.filter(m=>m.is_online).length+' متصل';
  const isAdmin=CU?.role==='admin'||CU?.role==='pm';
  document.getElementById('team-acts').innerHTML=isAdmin?'<button class="tbtn pri" onclick="openMemModal()"><i class="ti ti-user-plus"></i>إضافة عضو</button>':'';
  document.getElementById('team-grid').innerHTML=teamMembers.length?teamMembers.map(m=>{
    const mt=tasks.filter(t=>t.assigned_to===m.name),dn=mt.filter(t=>t.col==='done').length;
    const acts=isAdmin?`<div class="tcacts"><button class="tcabtn" onclick="openMemModal(${m.id})"><i class="ti ti-edit"></i>تعديل</button><button class="tcabtn" style="color:var(--red)" onclick="delMember(${m.id})"><i class="ti ti-trash"></i></button></div>`:'';
    return `<div class="tccard"><div class="tcav" style="background:${m.color}22;color:${m.color}"><div class="tconl" style="background:${m.is_online?'#22c87a':'#3a4060'}"></div>${m.name[0]}</div><div class="tcname">${m.name}</div><div class="tcrole">${m.role||''}</div><div style="font-size:11px;color:#5c657e;margin-bottom:10px">${m.email||''}</div><div class="tcstats"><div><div class="tcsn">${mt.length}</div><div class="tcsl">إجمالي</div></div><div><div class="tcsn" style="color:#22c87a">${dn}</div><div class="tcsl">مكتملة</div></div></div>${acts}</div>`;
  }).join(''):'<div class="empty" style="grid-column:1/-1">لا يوجد أعضاء</div>';
}
async function delMember(id){if(!confirm('حذف هذا العضو؟'))return;try{await API.del('/team/'+id);await refreshData();toast('تم الحذف','ok');}catch(e){toast(e.message,'err');}}

// ══ SITE REPORT ══
function renderSiteReport(){
  const today=new Date().toISOString().slice(0,10);
  const dateEl=document.getElementById('sr-date');if(dateEl&&!dateEl.value)dateEl.value=today;
  const selDate=dateEl?.value||today;
  document.getElementById('sr-date-lbl').textContent='تقرير: '+new Date(selDate).toLocaleDateString('ar-SA',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('sr-phdr-date').textContent=selDate;
  initSels();
  const filterP=document.getElementById('sr-pf')?.value||'';
  const projs=filterP?projects.filter(p=>p.id===filterP):projects;
  const allT=filterP?tasks.filter(t=>t.project_id===filterP):tasks;
  const doneT=allT.filter(t=>t.col==='done'),doingT=allT.filter(t=>t.col==='doing'||t.col==='review'),highT=allT.filter(t=>t.priority==='high'&&t.col!=='done');
  const avgPct=projs.length?Math.round(projs.reduce((a,p)=>a+(+p.pct||0),0)/projs.length):0;
  if(!currentReport||currentReport.date!==selDate){currentReport={date:selDate,proj:filterP||'ALL',weather:'صافٍ',temp:'38°C',workforce:5,supervisor:CU?.name||'',safety_incidents:0,progress_pct:avgPct,issues:[],notes:''};}
  document.getElementById('sr-content').innerHTML=`
  <div class="kgrid" style="margin-bottom:14px">${[
    {bg:'rgba(79,142,247,.07)',ic:'#4f8ef7',icon:'ti-chart-line',v:avgPct+'%',l:'متوسط الإنجاز'},
    {bg:'rgba(34,200,122,.07)',ic:'#22c87a',icon:'ti-circle-check',v:doneT.length,l:'مكتملة'},
    {bg:'rgba(240,160,48,.07)',ic:'#f0a030',icon:'ti-loader',v:doingT.length,l:'جارية'},
    {bg:'rgba(240,90,90,.07)',ic:'#f05a5a',icon:'ti-alert-triangle',v:highT.length,l:'عالية الأولوية'},
  ].map(k=>`<div class="kcard" style="padding:14px"><div class="kglow" style="background:${k.ic}"></div><div class="ktop"><div class="kicon" style="background:${k.bg}"><i class="ti ${k.icon}" style="color:${k.ic}"></i></div></div><div class="kval" style="font-size:22px">${k.v}</div><div class="klbl">${k.l}</div></div>`).join('')}</div>
  <div class="g2" style="margin-bottom:14px">
    <div class="panel"><div class="phdr"><div class="ptitle"><i class="ti ti-info-circle"></i>معلومات التقرير</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px">
      <div><div style="font-size:10px;color:var(--t3)">التاريخ</div><div style="font-size:13px;font-weight:500">${selDate}</div></div>
      <div><div style="font-size:10px;color:var(--t3)">المشرف</div><input type="text" style="font-size:12px;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 8px;width:100%;font-family:inherit" value="${currentReport.supervisor}" onchange="currentReport.supervisor=this.value"></div>
      <div><div style="font-size:10px;color:var(--t3)">الطقس</div><select style="font-size:12px;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 6px;font-family:inherit" onchange="currentReport.weather=this.value"><option ${currentReport.weather==='صافٍ'?'selected':''}>صافٍ</option><option ${currentReport.weather==='غائم'?'selected':''}>غائم</option><option ${currentReport.weather==='حار جداً'?'selected':''}>حار جداً</option><option ${currentReport.weather==='عاصف'?'selected':''}>عاصف</option></select></div>
      <div><div style="font-size:10px;color:var(--t3)">الحرارة</div><input type="text" style="font-size:12px;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 8px;width:80px;font-family:inherit" value="${currentReport.temp}" onchange="currentReport.temp=this.value"></div>
      <div><div style="font-size:10px;color:var(--t3)">العمالة</div><input type="number" style="font-size:12px;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 8px;width:70px;font-family:inherit" value="${currentReport.workforce}" onchange="currentReport.workforce=+this.value" min="0"></div>
      <div><div style="font-size:10px;color:var(--t3)">حوادث السلامة</div><input type="number" style="font-size:12px;background:var(--bg3);border:1px solid var(--border);color:${currentReport.safety_incidents>0?'#f05a5a':'var(--text)'};border-radius:5px;padding:3px 8px;width:60px;font-family:inherit" value="${currentReport.safety_incidents}" onchange="currentReport.safety_incidents=+this.value" min="0"></div>
    </div></div>
    <div class="panel"><div class="phdr"><div class="ptitle"><i class="ti ti-chart-bar"></i>تقدم المشاريع</div></div><div>${projs.map(p=>{const pc=p.budget>0?Math.round(p.spent/p.budget*100):0;return`<div class="budrow"><div class="budid">${p.id}</div><div class="budwrap"><div class="budfill" style="background:${p.color};width:${p.pct}%"></div></div><div class="budpct" style="color:${p.color}">${p.pct}%</div><div style="font-size:10px;font-weight:700;color:${hc(health(p))};min-width:28px;text-align:right">${health(p)}</div></div>`;}).join('')}</div></div>
  </div>
  <div class="g2" style="margin-bottom:14px">
    <div class="panel"><div class="phdr"><div class="ptitle"><i class="ti ti-circle-check" style="color:var(--green)"></i>المهام المنجزة</div></div><div>${doneT.slice(0,6).map(t=>`<div class="dr"><div style="width:16px;height:16px;border-radius:50%;background:#22c87a22;border:1px solid #22c87a;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ti ti-check" style="color:#22c87a;font-size:10px"></i></div><div class="dr-name">${t.title}</div><span style="font-size:10px;color:var(--t3)">${t.project_id}</span></div>`).join('')||'<div class="empty">لا توجد مهام مكتملة</div>'}</div></div>
    <div class="panel"><div class="phdr"><div class="ptitle"><i class="ti ti-loader" style="color:var(--amber)"></i>المهام الجارية</div></div><div>${doingT.slice(0,6).map(t=>`<div class="dr"><div class="kbcd" style="background:${t.priority==='high'?'#f05a5a':t.priority==='med'?'#f0a030':'#22c87a'}"></div><div class="dr-name">${t.title}</div><span style="font-size:10px;color:var(--t3)">${t.assigned_to||'—'}</span></div>`).join('')||'<div class="empty">لا توجد مهام جارية</div>'}</div></div>
  </div>
  <div class="g2" style="margin-bottom:14px">
    <div class="panel"><div class="phdr"><div class="ptitle"><i class="ti ti-alert-triangle" style="color:var(--red)"></i>المشاكل والعوائق</div><button class="pact" onclick="addIssue()"><i class="ti ti-plus"></i>إضافة</button></div><div id="sr-issues">${currentReport.issues.length?currentReport.issues.map((iss,i)=>`<div class="dr"><div style="width:20px;height:20px;border-radius:50%;background:#f05a5a22;border:1px solid #f05a5a;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#f05a5a;flex-shrink:0">${i+1}</div><div class="dr-name">${iss}</div><button onclick="removeIssue(${i})" style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:12px"><i class="ti ti-x"></i></button></div>`).join(''):'<div class="empty">لا توجد مشاكل ✅</div>'}</div></div>
    <div class="panel"><div class="phdr"><div class="ptitle"><i class="ti ti-notes"></i>ملاحظات عامة</div></div><div style="padding:12px"><textarea class="fta" id="sr-notes" style="min-height:100px" onchange="currentReport.notes=this.value">${currentReport.notes}</textarea></div></div>
  </div>
  <div class="panel" style="margin-bottom:14px"><div class="phdr"><div class="ptitle"><i class="ti ti-chart-line"></i>مؤشر الأداء الأسبوعي</div></div><div class="chbox"><canvas id="c-perf"></canvas></div></div>`;
  setTimeout(renderPerfChart,100);
}
function addIssue(){const iss=prompt('وصف المشكلة:');if(!iss?.trim())return;currentReport.issues.push(iss.trim());renderSiteReport();}
function removeIssue(i){currentReport.issues.splice(i,1);renderSiteReport();}
function renderPerfChart(){const ctx=document.getElementById('c-perf')?.getContext('2d');if(!ctx)return;if(pfC)pfC.destroy();const days=['السبت','الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'];const avg=projects.length?projects.reduce((a,p)=>a+(+p.pct||0),0)/projects.length:0;pfC=new Chart(ctx,{type:'line',data:{labels:days,datasets:[{label:'الإنجاز الفعلي %',data:days.map((_,i)=>Math.min(100,Math.round(Math.max(0,avg-8+(i*2.5)+Math.random()*4)))),borderColor:'#4f8ef7',backgroundColor:'rgba(79,142,247,.1)',borderWidth:2,fill:true,tension:.4,pointRadius:4},{label:'المستهدف',data:days.map(()=>Math.round(avg)),borderColor:'#22c87a',borderWidth:1.5,borderDash:[5,5],fill:false,pointRadius:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#9aa3bc',font:{size:11},padding:10,boxWidth:10}}},scales:{y:{max:100,grid:{color:'#2e344860'},ticks:{color:'#5c657e',font:{size:10},callback:v=>v+'%'}},x:{grid:{color:'#2e344830'},ticks:{color:'#5c657e',font:{size:10}}}}}});}
async function saveSiteReport(){
  if(!currentReport)return;
  currentReport.notes=document.getElementById('sr-notes')?.value||currentReport.notes;
  currentReport.progress_pct=projects.length?Math.round(projects.reduce((a,p)=>a+(+p.pct||0),0)/projects.length):0;
  try{await API.post('/reports',{report_date:currentReport.date,project_id:currentReport.proj==='ALL'?null:currentReport.proj,supervisor:currentReport.supervisor,weather:currentReport.weather,temperature:currentReport.temp,workforce:currentReport.workforce,safety_incidents:currentReport.safety_incidents,progress_pct:currentReport.progress_pct,issues:currentReport.issues,notes:currentReport.notes});toast('تم حفظ التقرير ✅','ok');}catch(e){toast(e.message,'err');}
}
function printSR(){saveSiteReport();document.getElementById('sr-phdr').style.display='block';window.print();setTimeout(()=>document.getElementById('sr-phdr').style.display='none',1500);}

// ══ LOG ══
async function renderLog(){
  const f=document.getElementById('log-f')?.value||'';
  try{const data=await API.get('/log'+(f?'?type='+f:''));document.getElementById('log-list').innerHTML=data?.length?data.map(x=>`<div class="logitem"><div class="logic" style="background:${x.color}18"><i class="ti ${x.icon}" style="color:${x.color}"></i></div><div class="logbody"><div class="logtxt"><strong>${x.user_name||'—'}</strong> — ${x.message}</div><div class="logmeta"><span>${new Date(x.created_at).toLocaleDateString('ar')}</span><span>${new Date(x.created_at).toLocaleTimeString('ar')}</span><span class="pill p-muted" style="font-size:9px">${x.type}</span></div></div></div>`).join(''):'<div class="empty">لا توجد سجلات</div>';}
  catch(e){document.getElementById('log-list').innerHTML='<div class="empty">خطأ في التحميل</div>';}
}

// ══ SETTINGS ══
function switchST(sec,el){document.querySelectorAll('.stsec').forEach(s=>s.classList.remove('active'));document.querySelectorAll('.stni').forEach(n=>n.classList.remove('active'));document.getElementById('ss-'+sec).classList.add('active');el.classList.add('active');if(sec==='users')renderUsersTable();if(sec==='appearance')renderSwatches();if(sec==='roles')renderRoles();if(sec==='integrations')renderIntegrations();}
async function renderSettings(){renderSwatches();renderRoles();if(CU?.role==='admin')renderUsersTable();}
async function renderUsersTable(){
  try{const users=await API.get('/auth/users');document.getElementById('users-tbl').innerHTML=`<thead><tr><th>المستخدم</th><th>الاسم</th><th>الدور</th><th>آخر دخول</th><th></th></tr></thead><tbody>${users.map(u=>`<tr><td style="font-family:monospace;font-size:12px;color:#4f8ef7">${u.username}</td><td>${u.full_name}</td><td><span class="rbadge rb-${u.role}">${RMETA[u.role]?.l||u.role}</span></td><td style="font-size:11px;color:var(--t3)">${u.last_login?new Date(u.last_login).toLocaleDateString('ar'):'—'}</td><td>${u.id!==CU?.id?`<button class="tcabtn" style="color:var(--red);font-size:11px" onclick="delUser(${u.id})"><i class="ti ti-trash"></i></button>`:''}</td></tr>`).join('')}</tbody>`;}
  catch(e){document.getElementById('users-tbl').innerHTML='<tr><td colspan="5">خطأ في التحميل</td></tr>';}
}
function renderSwatches(){document.getElementById('cswatches').innerHTML=ACOLORS.map(c=>`<div style="width:28px;height:28px;border-radius:7px;background:${c};cursor:pointer;border:2px solid transparent;transition:all .15s" onclick="setAccent('${c}')" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'"></div>`).join('');}
function renderRoles(){document.getElementById('roles-list').innerHTML=Object.entries(RMETA).map(([k,v])=>`<div class="dr"><span class="rbadge rb-${k}" style="min-width:70px;text-align:center;display:inline-block">${v.l}</span><span style="font-size:12px;color:#9aa3bc;margin-right:10px">${v.desc}</span></div>`).join('');}
function setAccent(c){document.documentElement.style.setProperty('--accent',c);document.documentElement.style.setProperty('--accent2',c+'cc');document.documentElement.style.setProperty('--aglow',c+'22');renderSwatches();toast('تم تغيير اللون','ok');}
async function delUser(id){if(!confirm('حذف هذا المستخدم؟'))return;try{await API.del('/auth/users/'+id);renderUsersTable();toast('تم الحذف','ok');}catch(e){toast(e.message,'err');}}

// ══ TASK MODAL ══
function openTM(col,id){
  if(!can('add_task')){toast('ليس لديك صلاحية','err');return;}
  editTId=id||null;document.getElementById('tm-lbl').textContent=id?'تعديل المهمة':'مهمة جديدة';
  initSels();
  if(id){const t=tasks.find(x=>x.id===id);if(!t)return;document.getElementById('ft-title').value=t.title;document.getElementById('ft-proj').value=t.project_id||'';document.getElementById('ft-col').value=t.col;document.getElementById('ft-prio').value=t.priority;document.getElementById('ft-assign').value=t.assigned_to||'';document.getElementById('ft-date').value=t.due_date||'';document.getElementById('ft-hours').value=t.hours_estimated||'';document.getElementById('ft-start').value=t.start_date||'';document.getElementById('ft-duration').value=t.duration_days||1;document.getElementById('ft-notes').value=t.notes||'';}
  else{['ft-title','ft-date','ft-hours','ft-start','ft-notes'].forEach(x=>document.getElementById(x).value='');document.getElementById('ft-duration').value=1;document.getElementById('ft-prio').value='med';if(col)document.getElementById('ft-col').value=col;}
  document.getElementById('tm').classList.add('open');
}
function closeTM(){document.getElementById('tm').classList.remove('open');}
async function saveTask(){
  const title=document.getElementById('ft-title').value.trim();if(!title){toast('أدخل عنوان المهمة','err');return;}
  const body={title,project_id:document.getElementById('ft-proj').value,col:document.getElementById('ft-col').value,priority:document.getElementById('ft-prio').value,assigned_to:document.getElementById('ft-assign').value,due_date:document.getElementById('ft-date').value||null,hours_estimated:parseInt(document.getElementById('ft-hours').value)||0,start_date:document.getElementById('ft-start').value||null,duration_days:parseInt(document.getElementById('ft-duration').value)||1,notes:document.getElementById('ft-notes').value};
  try{if(editTId)await API.put('/tasks/'+editTId,body);else await API.post('/tasks',body);closeTM();await refreshData();toast(editTId?'تم التعديل':'تمت الإضافة','ok');}catch(e){toast(e.message,'err');}
}

// ══ PROJECT MODAL ══
function openPM(id){
  if(!can('add_project')){toast('ليس لديك صلاحية','err');return;}
  editPId=id||null;document.getElementById('pm-lbl').textContent=id?'تعديل المشروع':'مشروع جديد';
  initSels();
  if(id){const p=projects.find(x=>x.id===id);if(!p)return;document.getElementById('fp-name').value=p.name;document.getElementById('fp-bud').value=p.budget||0;document.getElementById('fp-spent').value=p.spent||0;document.getElementById('fp-lead').value=p.lead||'';document.getElementById('fp-status').value=p.status;document.getElementById('fp-start').value=p.start_date||'';document.getElementById('fp-end').value=p.end_date||'';document.getElementById('fp-pct').value=p.pct||0;document.getElementById('fp-color').value=p.color||'#4f8ef7';}
  else{['fp-name','fp-start','fp-end'].forEach(x=>document.getElementById(x).value='');['fp-bud','fp-spent'].forEach(x=>document.getElementById(x).value=0);document.getElementById('fp-pct').value=0;document.getElementById('fp-color').value=ACOLORS[projects.length%ACOLORS.length];document.getElementById('fp-status').value='on-track';}
  document.getElementById('pm').classList.add('open');
}
function closePM(){document.getElementById('pm').classList.remove('open');}
async function saveProject(){
  const name=document.getElementById('fp-name').value.trim();if(!name){toast('أدخل اسم المشروع','err');return;}
  const body={name,color:document.getElementById('fp-color').value,pct:parseInt(document.getElementById('fp-pct').value)||0,status:document.getElementById('fp-status').value,budget:parseInt(document.getElementById('fp-bud').value)||0,spent:parseInt(document.getElementById('fp-spent').value)||0,lead:document.getElementById('fp-lead').value,start_date:document.getElementById('fp-start').value||null,end_date:document.getElementById('fp-end').value||null};
  try{if(editPId)await API.put('/projects/'+editPId,body);else await API.post('/projects',body);closePM();await refreshData();toast(editPId?'تم التعديل':'تمت الإضافة','ok');}catch(e){toast(e.message,'err');}
}

// ══ MEMBER MODAL ══
function openMemModal(id){editMemId=id||null;document.getElementById('mem-lbl').textContent=id?'تعديل عضو':'إضافة عضو';if(id){const m=teamMembers.find(x=>x.id===id);if(!m)return;document.getElementById('fm-name').value=m.name;document.getElementById('fm-role').value=m.role||'';document.getElementById('fm-email').value=m.email||'';document.getElementById('fm-color').value=m.color||'#4f8ef7';}else{['fm-name','fm-role','fm-email'].forEach(x=>document.getElementById(x).value='');document.getElementById('fm-color').value=ACOLORS[teamMembers.length%ACOLORS.length];}document.getElementById('mem-m').classList.add('open');}
async function saveMember(){const name=document.getElementById('fm-name').value.trim();if(!name){toast('أدخل الاسم','err');return;}const body={name,role:document.getElementById('fm-role').value,email:document.getElementById('fm-email').value,color:document.getElementById('fm-color').value};try{if(editMemId)await API.put('/team/'+editMemId,body);else await API.post('/team',body);closeModal('mem-m');await refreshData();toast('تمت العملية','ok');}catch(e){toast(e.message,'err');}}

// ══ MILESTONE MODAL ══
function openMsModal(projId,msId){
  editMsId=msId||null;document.getElementById('ms-lbl').textContent=msId?'تعديل Milestone':'إضافة Milestone';
  const sp=document.getElementById('ms-proj');sp.innerHTML=projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  if(msId){const m=milestones.find(x=>x.id===msId);if(!m)return;document.getElementById('ms-title').value=m.title;document.getElementById('ms-notes').value=m.notes||'';document.getElementById('ms-pct').value=m.pct||0;document.getElementById('ms-status').value=m.status;document.getElementById('ms-type').value=m.type;document.getElementById('ms-start').value=m.start_date||'';document.getElementById('ms-end').value=m.end_date||'';sp.value=m.project_id;}
  else{['ms-title','ms-notes'].forEach(x=>document.getElementById(x).value='');document.getElementById('ms-pct').value=0;document.getElementById('ms-status').value='upcoming';document.getElementById('ms-type').value='milestone';const today=new Date().toISOString().slice(0,10);document.getElementById('ms-start').value=today;document.getElementById('ms-end').value=today;if(projId)sp.value=projId;}
  document.getElementById('ms-m').classList.add('open');
}
async function saveMilestone(){const title=document.getElementById('ms-title').value.trim();if(!title){toast('أدخل العنوان','err');return;}const body={title,project_id:document.getElementById('ms-proj').value,type:document.getElementById('ms-type').value,start_date:document.getElementById('ms-start').value||null,end_date:document.getElementById('ms-end').value||null,status:document.getElementById('ms-status').value,pct:parseInt(document.getElementById('ms-pct').value)||0,notes:document.getElementById('ms-notes').value};try{if(editMsId)await API.put('/milestones/'+editMsId,body);else await API.post('/milestones',body);closeModal('ms-m');milestones=await API.get('/milestones');if(curPage==='timeline')renderTimeline();if(curPage==='gantt')renderGantt();toast('تمت العملية','ok');}catch(e){toast(e.message,'err');}}

// ══ ADD USER ══
async function saveNewUser(){const u=document.getElementById('au-u').value.trim(),p=document.getElementById('au-p').value,n=document.getElementById('au-n').value.trim();if(!u||!p||!n){toast('جميع الحقول مطلوبة','err');return;}try{await API.post('/auth/users',{username:u,password:p,full_name:n,role:document.getElementById('au-r').value,color:document.getElementById('au-color').value});closeModal('aum');renderUsersTable();toast('تمت إضافة المستخدم','ok');}catch(e){toast(e.message,'err');}}

// ══ NOTIFICATIONS ══
function buildNotifs(){const n=[];tasks.filter(t=>t.col!=='done'&&ov(t.due_date)).forEach(t=>n.push({icon:'ti-clock',color:'#f05a5a',title:'مهمة متأخرة: '+t.title,sub:t.project_id+' — '+t.due_date}));projects.filter(p=>p.budget>0&&p.spent/p.budget>.85).forEach(p=>n.push({icon:'ti-currency-dollar',color:'#f0a030',title:'تجاوز الميزانية: '+p.name,sub:Math.round(p.spent/p.budget*100)+'% مستخدم'}));projects.filter(p=>p.status==='delayed').forEach(p=>n.push({icon:'ti-alert-triangle',color:'#f05a5a',title:'مشروع متأخر: '+p.name,sub:'المسؤول: '+(p.lead||'—')}));return n;}
function updateNBadge(){const n=buildNotifs().length,b=document.getElementById('ncnt');if(b){b.textContent=n;b.style.display=n?'flex':'none';}}
function toggleNotif(){const pn=document.getElementById('notifpanel');const open=pn.classList.toggle('open');if(open){const n=buildNotifs();document.getElementById('np-list').innerHTML=n.length?n.map(x=>`<div class="npitem"><div class="npic" style="background:${x.color}18"><i class="ti ${x.icon}" style="color:${x.color}"></i></div><div><div class="nptxt">${x.title}</div><div class="npsub">${x.sub}</div></div></div>`).join(''):'<div class="empty">✅ لا توجد تنبيهات</div>';document.getElementById('ncnt').style.display='none';}}

// ══ AI ══
function openAI(){document.getElementById('aiov').classList.add('open');}
function closeAI(){document.getElementById('aiov').classList.remove('open');}
async function renderIntegrations(){
  try{
    const s=await API.get('/integrations/msgraph/status');
    const el=document.getElementById('msg-status'),btn=document.getElementById('msg-connect-btn');
    if(!s.configured){el.textContent='غير مضبوط على السيرفر — أضف MS_CLIENT_ID/MS_CLIENT_SECRET في .env';btn.disabled=true;}
    else if(s.connected){el.textContent='متصل: '+(s.account?.account_email||'');btn.textContent='إعادة الربط';btn.onclick=connectMicrosoft;}
    else{el.textContent='غير متصل';btn.disabled=false;}
  }catch(e){}
  loadWebhooks();loadApiKeys();
}

function connectMicrosoft(){window.open(API.base+'/integrations/msgraph/connect?token='+API.token,'_blank');}

async function loadWebhooks(){
  try{
    const list=await API.get('/integrations/webhooks');
    const tbl=document.getElementById('webhooks-tbl');
    tbl.innerHTML='<tr><th>الاسم</th><th>الأحداث</th><th>الحالة</th><th></th></tr>'+
      list.map(w=>`<tr><td>${w.name}</td><td style="font-size:11px">${w.events.join(', ')}</td><td>${w.enabled?'مفعّل':'موقوف'}</td>
        <td><button class="tbtn" onclick="toggleWebhook(${w.id})"><i class="ti ti-power"></i></button>
        <button class="tbtn" onclick="deleteWebhook(${w.id})"><i class="ti ti-trash"></i></button></td></tr>`).join('')
      || '<tr><td colspan="4" style="color:#888">لا يوجد webhooks</td></tr>';
  }catch(e){}
}
async function toggleWebhook(id){await API.put('/integrations/webhooks/'+id+'/toggle');loadWebhooks();}
async function deleteWebhook(id){if(!confirm('حذف الـ webhook؟'))return;await API.del('/integrations/webhooks/'+id);loadWebhooks();}
function openWebhookModal(){
  const name=prompt('اسم الـ Webhook (مثال: Power Automate Flow)');if(!name)return;
  const url=prompt('Target URL (من Power Automate HTTP trigger)');if(!url)return;
  const evs=prompt('الأحداث مفصولة بفاصلة:\ntask.created, task.updated, project.status_changed, project.over_budget, milestone.delayed');
  if(!evs)return;
  API.post('/integrations/webhooks',{name,target_url:url,events:evs.split(',').map(s=>s.trim())})
    .then(()=>loadWebhooks()).catch(e=>alert(e.message));
}

async function loadApiKeys(){
  try{
    const list=await API.get('/integrations/api-keys');
    const tbl=document.getElementById('apikeys-tbl');
    tbl.innerHTML='<tr><th>الاسم</th><th>Prefix</th><th>آخر استخدام</th><th></th></tr>'+
      list.map(k=>`<tr><td>${k.name}</td><td style="font-family:monospace">${k.key_prefix}...</td><td>${k.last_used_at?new Date(k.last_used_at).toLocaleDateString('ar'):'-'}</td>
        <td>${k.revoked?'ملغي':`<button class="tbtn" onclick="revokeApiKey(${k.id})"><i class="ti ti-trash"></i></button>`}</td></tr>`).join('')
      || '<tr><td colspan="4" style="color:#888">لا يوجد مفاتيح</td></tr>';
  }catch(e){}
}
async function createApiKey(){
  const name=prompt('اسم المفتاح (مثال: Power Automate Inbound)');if(!name)return;
  try{
    const r=await API.post('/integrations/api-keys',{name});
    prompt('انسخ المفتاح الآن — مش هيتعرض تاني:',r.key);
    loadApiKeys();
  }catch(e){alert(e.message);}
}
async function revokeApiKey(id){if(!confirm('إلغاء المفتاح؟'))return;await API.del('/integrations/api-keys/'+id);loadApiKeys();}

async function exportMSProject(){
  const proj=document.getElementById('tl-pf')?.value||'';
  try{
    const url=API.base+'/msproject/export'+(proj?'?project='+encodeURIComponent(proj):'');
    const res=await fetch(url,{headers:API.headers()});
    if(!res.ok){const e=await res.json().catch(()=>({error:'فشل التصدير'}));throw new Error(e.error);}
    const blob=await res.blob();
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=(proj||'all-projects')+'.xml';
    document.body.appendChild(a);a.click();a.remove();
  }catch(e){alert(e.message||'فشل تصدير MS Project');}
}

async function importMSProject(input){
  const file=input.files[0];if(!file)return;
  const proj=document.getElementById('tl-pf')?.value;
  if(!proj){alert('اختر مشروع محدد من القائمة الأول عشان نربط المهام المستوردة بيه');input.value='';return;}
  const fd=new FormData();fd.append('file',file);fd.append('project_id',proj);
  try{
    const res=await fetch(API.base+'/msproject/import',{method:'POST',headers:{'Authorization':'Bearer '+API.token},body:fd});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||'فشل الاستيراد');
    alert(`تم الاستيراد: ${data.created} مهمة جديدة، ${data.updated} تحديث`);
    renderTimeline();
  }catch(e){alert(e.message||'فشل استيراد الملف');}
  input.value='';
}

// ══ PORTFOLIO ══
function switchPF(sec,el){
  document.querySelectorAll('.pf-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.pfsec').forEach(s=>s.style.display='none');
  el.classList.add('active');document.getElementById('pf-'+sec).style.display='block';
  if(sec==='res')loadPFResources();else if(sec==='dep')loadPFDependencies();else if(sec==='tmpl')loadPFTemplates();
}

async function renderPortfolio(){loadPFDashboard();}

async function loadPFDashboard(){
  const el=document.getElementById('pf-dash');
  el.innerHTML='<div class="loading"><i class="ti ti-loader-2"></i></div>';
  try{
    const d=await API.get('/portfolio/dashboard');
    const t=d.totals;
    el.innerHTML=`
      <div class="kgrid" style="margin-bottom:16px">
        <div class="kcard"><div class="kval">${t.projects}</div><div class="klbl">مشروع</div></div>
        <div class="kcard"><div class="kval">${t.avgProgress}%</div><div class="klbl">متوسط التقدم</div></div>
        <div class="kcard"><div class="kval" style="color:${t.atRisk?'#f05a5a':'#22c87a'}">${t.atRisk}</div><div class="klbl">مشروع في خطر</div></div>
        <div class="kcard"><div class="kval">${fmtSAR(t.totalSpent)}</div><div class="klbl">من ${fmtSAR(t.totalBudget)}</div></div>
        <div class="kcard"><div class="kval" style="color:${t.totalOverdueTasks?'#f0a030':'#22c87a'}">${t.totalOverdueTasks}</div><div class="klbl">مهمة متأخرة</div></div>
        <div class="kcard"><div class="kval" style="color:${t.totalMissingDocs?'#f05a5a':'#22c87a'}">${t.totalMissingDocs}</div><div class="klbl">مستند ناقص</div></div>
      </div>
      <table class="stbl"><tr><th>المشروع</th><th>التقدم</th><th>SPI</th><th>CPI</th><th>ميزانية مستخدمة</th><th>مهام متأخرة</th><th>مستندات ناقصة</th><th>الخطورة</th></tr>
      ${d.projects.map(p=>`<tr style="${p.riskScore>=3?'background:#f05a5a0d':''}">
        <td><strong>${p.name}</strong></td>
        <td>${p.pct}%</td>
        <td style="color:${p.spi<0.8?'#f05a5a':p.spi<0.95?'#f0a030':'#22c87a'}">${p.spi}</td>
        <td style="color:${p.cpi<0.8?'#f05a5a':p.cpi<0.95?'#f0a030':'#22c87a'}">${p.cpi}</td>
        <td>${p.budget?Math.round(p.spent/p.budget*100)+'%':'-'}</td>
        <td>${p.overdueTasks||'-'}</td>
        <td>${p.missingDocs||'-'}</td>
        <td>${p.riskScore>=3?'<span class="pill" style="background:#f05a5a18;color:#f05a5a">عالية</span>':p.riskScore>=1?'<span class="pill" style="background:#f0a03018;color:#f0a030">متوسطة</span>':'<span class="pill" style="background:#22c87a18;color:#22c87a">منخفضة</span>'}</td>
      </tr>`).join('')}</table>`;
  }catch(e){el.innerHTML='<div class="empty">فشل تحميل البيانات</div>';}
}
function fmtSAR(n){return 'SAR '+Math.round(n||0).toLocaleString('en-US');}

async function loadPFResources(){
  const el=document.getElementById('pf-res');
  el.innerHTML='<div class="loading"><i class="ti ti-loader-2"></i></div>';
  try{
    const d=await API.get('/portfolio/resources');
    el.innerHTML=d.team.length?(`<div class="stsub" style="margin-bottom:10px">السعة الافتراضية: ${d.capacityHoursPerWeek} ساعة/أسبوع لكل فرد</div>
      <table class="stbl"><tr><th>العضو</th><th>عدد المشاريع</th><th>مهام نشطة</th><th>الساعات المقدرة</th><th>نسبة الحمل</th><th>متأخر</th></tr>
      ${d.team.map(p=>`<tr style="${p.overallocated?'background:#f05a5a0d':''}">
        <td><strong>${p.name}</strong></td>
        <td>${p.projectCount}</td>
        <td>${p.activeTasks}</td>
        <td>${p.totalHours}h</td>
        <td style="color:${p.overallocated?'#f05a5a':p.utilizationPct>80?'#f0a030':'#22c87a'}">${p.utilizationPct}%${p.overallocated?' ⚠️ تحميل زائد':''}</td>
        <td>${p.overdue||'-'}</td>
      </tr>`).join('')}</table>`)
      :'<div class="empty">لا توجد مهام مسندة حالياً</div>';
  }catch(e){el.innerHTML='<div class="empty">فشل تحميل البيانات</div>';}
}

async function loadPFDependencies(){
  const el=document.getElementById('pf-dep');
  el.innerHTML='<div class="loading"><i class="ti ti-loader-2"></i></div>';
  try{
    const list=await API.get('/portfolio/dependencies');
    const DEP_LBL={blocks:'يعطّل',depends_on:'يعتمد على',related:'مرتبط بـ'};
    el.innerHTML=`<div style="margin-bottom:12px"><button class="tbtn pri" onclick="addDependency()"><i class="ti ti-plus"></i>ربط مشروعين</button></div>`+
      (list.length?(`<table class="stbl"><tr><th>من</th><th>العلاقة</th><th>إلى</th><th>الوصف</th><th></th></tr>
      ${list.map(d=>`<tr><td>${d.from_name}</td><td>${DEP_LBL[d.type]||d.type}</td><td>${d.to_name}</td><td>${d.description||'-'}</td>
        <td><button class="tbtn" onclick="deleteDependency(${d.id})"><i class="ti ti-trash"></i></button></td></tr>`).join('')}</table>`)
      :'<div class="empty">لا توجد ترابطات بين المشاريع بعد</div>');
  }catch(e){el.innerHTML='<div class="empty">فشل تحميل البيانات</div>';}
}
async function addDependency(){
  if(!projects.length){toast('لا توجد مشاريع','err');return;}
  const names=projects.map((p,i)=>`${i+1}) ${p.name} [${p.id}]`).join('\n');
  const from=prompt('كود المشروع (from) — المشروع اللي عليه التأثير:\n'+names);if(!from)return;
  const to=prompt('كود المشروع (to) — المشروع التاني:');if(!to)return;
  const type=prompt('نوع العلاقة: blocks (يعطّل) / depends_on (يعتمد على) / related (مرتبط)','blocks');
  const description=prompt('وصف مختصر (اختياري):','');
  try{await API.post('/portfolio/dependencies',{from_project:from.trim(),to_project:to.trim(),type:(type||'blocks').trim(),description});loadPFDependencies();}
  catch(e){toast(e.message,'err');}
}
async function deleteDependency(id){if(!confirm('حذف الربط؟'))return;await API.del('/portfolio/dependencies/'+id);loadPFDependencies();}

async function loadPFTemplates(){
  const el=document.getElementById('pf-tmpl');
  el.innerHTML='<div class="loading"><i class="ti ti-loader-2"></i></div>';
  try{
    const list=await API.get('/portfolio/templates');
    el.innerHTML=`<div style="margin-bottom:12px"><button class="tbtn pri" onclick="createTemplate()"><i class="ti ti-plus"></i>قالب مشروع جديد</button></div>`+
      (list.length?(`<table class="stbl"><tr><th>الاسم</th><th>الوصف</th><th>المهام الافتراضية</th><th>Milestones</th><th></th></tr>
      ${list.map(t=>`<tr><td><strong>${t.name}</strong></td><td>${t.description||'-'}</td><td>${(t.default_tasks||[]).length}</td><td>${(t.default_milestones||[]).length}</td>
        <td><button class="tbtn" onclick="applyProjectTemplate(${t.id})">تطبيق على مشروع</button>
        <button class="tbtn" onclick="deleteTemplate(${t.id})"><i class="ti ti-trash"></i></button></td></tr>`).join('')}</table>`)
      :'<div class="empty">لا توجد قوالب مشاريع بعد — أنشئ واحد لتسريع بدء المشاريع الجديدة</div>');
  }catch(e){el.innerHTML='<div class="empty">فشل تحميل البيانات</div>';}
}
async function createTemplate(){
  const name=prompt('اسم القالب (مثال: مشروع GMP قياسي):');if(!name)return;
  const description=prompt('وصف مختصر:','');
  const tasksRaw=prompt('المهام الافتراضية، كل مهمة في سطر:\n(مثال:\nIQ Protocol\nOQ Protocol\nPQ Protocol)');
  const default_tasks=(tasksRaw||'').split('\n').map(s=>s.trim()).filter(Boolean).map(title=>({title}));
  const msRaw=prompt('الـ Milestones الافتراضية، كل واحدة في سطر (اختياري):');
  const default_milestones=(msRaw||'').split('\n').map(s=>s.trim()).filter(Boolean).map(title=>({title}));
  const document_template_key=prompt('قالب المستندات المرتبط (اختياري): gmp_validation / bms_handover / general','');
  try{await API.post('/portfolio/templates',{name,description,default_tasks,default_milestones,document_template_key:document_template_key||null});loadPFTemplates();}
  catch(e){toast(e.message,'err');}
}
async function deleteTemplate(id){if(!confirm('حذف القالب؟'))return;await API.del('/portfolio/templates/'+id);loadPFTemplates();}
async function applyProjectTemplate(id){
  if(!projects.length){toast('لا توجد مشاريع','err');return;}
  const names=projects.map((p,i)=>`${i+1}) ${p.name} [${p.id}]`).join('\n');
  const proj=prompt('كود المشروع اللي هتطبّق عليه القالب:\n'+names);if(!proj)return;
  try{
    const r=await API.post('/portfolio/templates/'+id+'/apply',{project_id:proj.trim()});
    toast(`تم: ${r.tasksAdded} مهمة، ${r.msAdded} milestone، ${r.docsAdded} مستند`,'ok');
  }catch(e){toast(e.message,'err');}
}

// ══ DOCUMENT TRACKING ══
const DOC_STATUS={missing:{l:'ناقص',c:'#f05a5a'},uploaded:{l:'مرفوع',c:'#f0a030'},under_review:{l:'مراجعة',c:'#9b72f4'},approved:{l:'معتمد',c:'#22c87a'}};

async function renderDocuments(){
  initSels();
  const proj=document.getElementById('doc-pf')?.value||'';
  const summaryEl=document.getElementById('doc-summary'),contentEl=document.getElementById('documents-content');
  contentEl.innerHTML='<div class="loading"><i class="ti ti-loader-2"></i></div>';
  try{
    if(!proj){
      // No project selected: show cross-project missing summary
      const missing=await API.get('/documents/summary/missing');
      summaryEl.innerHTML=`<div class="kcard" style="max-width:260px"><div class="kval" style="color:#f05a5a">${missing.length}</div><div class="klbl">مستند ناقص عبر كل المشاريع</div></div>`;
      contentEl.innerHTML=missing.length?('<table class="stbl"><tr><th>المستند</th><th>المشروع</th><th>الفئة</th><th>موعد الاستحقاق</th></tr>'+
        missing.map(d=>`<tr><td>${d.name}</td><td>${d.project_name}</td><td>${d.category}</td><td>${d.due_date||'-'}</td></tr>`).join('')+'</table>')
        :'<div class="empty">اختر مشروع من القائمة، أو لا يوجد مستندات ناقصة حالياً 🎉</div>';
      return;
    }
    const docs=await API.get('/documents/'+proj);
    const byStatus={missing:0,uploaded:0,under_review:0,approved:0};
    docs.forEach(d=>byStatus[d.status]=(byStatus[d.status]||0)+1);
    summaryEl.innerHTML=Object.entries(DOC_STATUS).map(([k,v])=>
      `<span class="pill" style="background:${v.c}18;color:${v.c};border:1px solid ${v.c}33;margin-left:6px">${v.l}: ${byStatus[k]||0}</span>`
    ).join('');
    contentEl.innerHTML=docs.length?('<table class="stbl"><tr><th>المستند</th><th>الفئة</th><th>الحالة</th><th>موعد الاستحقاق</th><th>ملف</th><th></th></tr>'+
      docs.map(d=>`<tr>
        <td>${d.name}</td><td>${d.category}</td>
        <td><select class="fsel" style="font-size:11px" onchange="updateDocStatus(${d.id},this.value)">
          ${Object.entries(DOC_STATUS).map(([k,v])=>`<option value="${k}" ${d.status===k?'selected':''}>${v.l}</option>`).join('')}
        </select></td>
        <td>${d.due_date||'-'}</td>
        <td>${d.file_url?`<a href="${d.file_url}" target="_blank"><i class="ti ti-external-link"></i></a>`:`<button class="tbtn" style="font-size:11px" onclick="attachDocLink(${d.id})">إرفاق رابط</button>`}</td>
        <td><button class="tbtn" onclick="deleteDocRequirement(${d.id})"><i class="ti ti-trash"></i></button></td>
      </tr>`).join('')+'</table>')
      :'<div class="empty">لا توجد مستندات مطلوبة لهذا المشروع بعد — طبّق قالب أو أضف مستند جديد</div>';
  }catch(e){contentEl.innerHTML='<div class="empty">فشل تحميل البيانات</div>';}
}

async function updateDocStatus(id,status){
  try{await API.put('/documents/item/'+id,{status});toast('تم التحديث','ok');}catch(e){toast(e.message,'err');}
}
async function attachDocLink(id){
  const url=prompt('رابط الملف (مثال: رابط OneDrive أو أي مكان تخزين):');if(!url)return;
  try{await API.put('/documents/item/'+id,{file_url:url,status:'uploaded'});renderDocuments();}catch(e){toast(e.message,'err');}
}
async function deleteDocRequirement(id){
  if(!confirm('حذف هذا المستند من القائمة؟'))return;
  try{await API.del('/documents/item/'+id);renderDocuments();}catch(e){toast(e.message,'err');}
}
async function addDocRequirement(){
  const proj=document.getElementById('doc-pf')?.value;
  if(!proj){toast('اختر مشروع أولاً','err');return;}
  const name=prompt('اسم المستند المطلوب:');if(!name)return;
  const category=prompt('الفئة (مثال: validation, planning, handover):','general');
  try{await API.post('/documents/'+proj,{name,category});renderDocuments();}catch(e){toast(e.message,'err');}
}
async function applyDocTemplate(){
  const proj=document.getElementById('doc-pf')?.value;
  if(!proj){toast('اختر مشروع أولاً','err');return;}
  const choice=prompt('اختر قالب:\n1) gmp_validation — تحقق GMP/صيدلاني\n2) bms_handover — تسليم BMS/EMS\n3) general — عام\n\nاكتب: gmp_validation او bms_handover او general');
  if(!choice)return;
  try{
    const r=await API.post('/documents/'+proj+'/apply-template',{template:choice.trim()});
    toast(`تم إضافة ${r.added} مستند`,'ok');renderDocuments();
  }catch(e){toast(e.message,'err');}
}
async function runDocCheck(){
  try{
    const r=await API.post('/documents/check/run');
    toast(`تم الفحص: ${r.added} تنبيه جديد من ${r.checked} مستند ناقص`,'ok');
  }catch(e){toast(e.message,'err');}
}

// ══ COMMISSIONING MATRIX ══
let cmStageTemplate=null;
const CM_STATUS={done:{l:'✓',c:'#22c87a',next:'na'},na:{l:'-',c:'#5c657e',next:'pending'},pending:{l:'',c:'#f0a030',next:'done'}};
const CM_CATEGORY_COLOR={Communication:'#4f8ef7',Programming:'#9b72f4',Commissioning:'#f0a030',Validation:'#22c87a',Handover:'#f472b6'};

async function renderCommissioning(){
  initSels();
  const proj=document.getElementById('cm-pf')?.value;
  const summaryEl=document.getElementById('cm-summary'),contentEl=document.getElementById('commissioning-content');
  if(!proj){contentEl.innerHTML='<div class="empty">اختر مشروع من القائمة عشان تشوف مصفوفة الإنجاز</div>';summaryEl.innerHTML='';return;}
  contentEl.innerHTML='<div class="loading"><i class="ti ti-loader-2"></i></div>';
  try{
    if(!cmStageTemplate){const t=await API.get('/commissioning/template');cmStageTemplate=t.stages;}
    const items=await API.get('/commissioning/'+proj);
    const avgPct=items.length?Math.round(items.reduce((a,i)=>a+i.pct,0)/items.length):0;
    summaryEl.innerHTML=`<div class="kcard" style="max-width:220px"><div class="kval" style="color:${avgPct>=80?'#22c87a':avgPct>=40?'#f0a030':'#f05a5a'}">${avgPct}%</div><div class="klbl">متوسط الإنجاز — ${items.length} لوحة/حلقة</div></div>`;

    if(!items.length){contentEl.innerHTML='<div class="empty">لا توجد لوحات/حلقات لهذا المشروع بعد — استوردي ملف Excel أو أضيفي لوحة يدوياً</div>';return;}

    // Build grouped 2-row header
    const cats=[];cmStageTemplate.forEach(s=>{if(!cats.length||cats[cats.length-1].name!==s.category)cats.push({name:s.category,count:1});else cats[cats.length-1].count++;});
    const catRow=cats.map(c=>`<th colspan="${c.count}" style="background:${CM_CATEGORY_COLOR[c.name]}18;color:${CM_CATEGORY_COLOR[c.name]};text-align:center;font-size:10px;padding:6px 2px">${c.name}</th>`).join('');
    const stageRow=cmStageTemplate.map(s=>`<th style="font-size:9px;padding:6px 3px;writing-mode:vertical-rl;text-orientation:mixed;max-height:90px;white-space:nowrap">${s.label}</th>`).join('');

    contentEl.innerHTML=`<table class="stbl" style="min-width:1200px"><thead>
      <tr><th rowspan="2">اللوحة</th><th rowspan="2">تخدم</th><th rowspan="2">%</th>${catRow}</tr>
      <tr>${stageRow}</tr>
    </thead><tbody>
    ${items.map(it=>`<tr>
      <td style="white-space:nowrap"><strong>${it.panel_name}</strong></td>
      <td style="font-size:11px;color:var(--t3)">${it.serving_equipment||'-'}</td>
      <td style="font-weight:700;color:${it.pct>=80?'#22c87a':it.pct>=40?'#f0a030':'#f05a5a'}">${it.pct}%</td>
      ${cmStageTemplate.map(s=>{
        const st=it.stages?.[s.key]||'pending';const m=CM_STATUS[st];
        return `<td style="text-align:center;cursor:pointer;background:${m.c}12" title="${s.label}: ${st}" onclick="cycleCommissioningStage(${it.id},'${s.key}','${st}')"><span style="color:${m.c};font-weight:700">${m.l}</span></td>`;
      }).join('')}
      <td><button class="tbtn" style="font-size:10px" onclick="deleteCommissioningItem(${it.id})"><i class="ti ti-trash"></i></button></td>
    </tr>`).join('')}
    </tbody></table>`;
  }catch(e){contentEl.innerHTML='<div class="empty">فشل تحميل البيانات</div>';}
}

async function cycleCommissioningStage(id,stageKey,curStatus){
  const next=CM_STATUS[curStatus].next;
  try{await API.put('/commissioning/item/'+id,{stage_key:stageKey,stage_status:next});renderCommissioning();}
  catch(e){toast(e.message,'err');}
}
async function deleteCommissioningItem(id){
  if(!confirm('حذف هذه اللوحة/الحلقة من المصفوفة؟'))return;
  try{await API.del('/commissioning/item/'+id);renderCommissioning();}catch(e){toast(e.message,'err');}
}
async function addCommissioningItem(){
  const proj=document.getElementById('cm-pf')?.value;
  if(!proj){toast('اختر مشروع أولاً','err');return;}
  const panel_name=prompt('اسم اللوحة/الحلقة (مثال: LCP-28):');if(!panel_name)return;
  const serving_equipment=prompt('تخدم أي معدة/منطقة (اختياري):','');
  try{await API.post('/commissioning/'+proj,{panel_name,serving_equipment});renderCommissioning();}
  catch(e){toast(e.message,'err');}
}
async function importCommissioning(input){
  const file=input.files[0];if(!file)return;
  const proj=document.getElementById('cm-pf')?.value;
  if(!proj){alert('اختر مشروع أولاً عشان نربط اللوحات المستوردة بيه');input.value='';return;}
  const fd=new FormData();fd.append('file',file);
  try{
    const res=await fetch(API.base+'/commissioning/'+proj+'/import',{method:'POST',headers:{'Authorization':'Bearer '+API.token},body:fd});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||'فشل الاستيراد');
    toast(`تم الاستيراد: ${data.created} لوحة جديدة، ${data.updated} تحديث`,'ok');
    renderCommissioning();
  }catch(e){toast(e.message||'فشل استيراد الملف','err');}
  input.value='';
}

// ══ ISSUES LOG ══
const IS_STATUS_COLOR={'Open':'#f05a5a','Closed':'#22c87a','Done with notes':'#9b72f4'};
function isColor(s){return IS_STATUS_COLOR[s]||'#f0a030';}

async function renderIssues(){
  initSels();
  const proj=document.getElementById('is-pf')?.value;
  const summaryEl=document.getElementById('is-summary'),contentEl=document.getElementById('issues-content');
  if(!proj){contentEl.innerHTML='<div class="empty">اختر مشروع من القائمة</div>';summaryEl.innerHTML='';return;}
  contentEl.innerHTML='<div class="loading"><i class="ti ti-loader-2"></i></div>';
  try{
    const items=await API.get('/issues/'+proj);
    const open=items.filter(i=>i.status==='Open').length,closed=items.filter(i=>i.status==='Closed').length;
    summaryEl.innerHTML=`<span class="pill" style="background:#f05a5a18;color:#f05a5a;margin-left:6px">مفتوحة: ${open}</span><span class="pill" style="background:#22c87a18;color:#22c87a">مغلقة: ${closed}</span>`;
    contentEl.innerHTML=items.length?(`<table class="stbl"><tr><th>#</th><th>Phase</th><th>System</th><th>المشكلة</th><th>المسؤول</th><th>الحالة</th><th>تاريخ الفتح</th><th></th></tr>
      ${items.map(it=>`<tr>
        <td>${it.sn||'-'}</td><td>${it.phase||'-'}</td><td>${it.system_name||'-'}</td>
        <td style="max-width:280px;white-space:normal">${it.issue}</td>
        <td>${it.responsible||'-'}</td>
        <td><select class="fsel" style="font-size:11px;color:${isColor(it.status)}" onchange="updateIssueStatus(${it.id},this.value)">
          ${['Open','Closed','Done with notes'].map(s=>`<option value="${s}" ${it.status===s?'selected':''}>${s}</option>`).join('')}
        </select></td>
        <td style="font-size:11px">${it.open_date||'-'}</td>
        <td><button class="tbtn" onclick="viewIssue(${it.id})"><i class="ti ti-eye"></i></button>
        <button class="tbtn" onclick="deleteIssue(${it.id})"><i class="ti ti-trash"></i></button></td>
      </tr>`).join('')}</table>`)
      :'<div class="empty">لا توجد مشاكل مسجلة لهذا المشروع بعد</div>';
    window._issuesCache=items;
  }catch(e){contentEl.innerHTML='<div class="empty">فشل تحميل البيانات</div>';}
}
function viewIssue(id){
  const it=(window._issuesCache||[]).find(i=>i.id===id);if(!it)return;
  alert(`المشكلة: ${it.issue}\n\nالسبب: ${it.reasons||'-'}\n\nالإجراء المقترح: ${it.corrective_action||'-'}\n\nملاحظة: ${it.remark||'-'}`);
}
async function updateIssueStatus(id,status){
  try{await API.put('/issues/item/'+id,{status});toast('تم التحديث','ok');renderIssues();}catch(e){toast(e.message,'err');}
}
async function deleteIssue(id){
  if(!confirm('حذف هذه المشكلة؟'))return;
  try{await API.del('/issues/item/'+id);renderIssues();}catch(e){toast(e.message,'err');}
}
async function addIssue(){
  const proj=document.getElementById('is-pf')?.value;
  if(!proj){toast('اختر مشروع أولاً','err');return;}
  const issue=prompt('وصف المشكلة:');if(!issue)return;
  const phase=prompt('المرحلة (اختياري، مثال: Communication):','');
  const system_name=prompt('النظام/الموقع (اختياري):','');
  const responsible=prompt('المسؤول (اختياري):','');
  try{await API.post('/issues/'+proj,{issue,phase,system_name,responsible});renderIssues();}
  catch(e){toast(e.message,'err');}
}
async function importIssues(input){
  const file=input.files[0];if(!file)return;
  const proj=document.getElementById('is-pf')?.value;
  if(!proj){alert('اختر مشروع أولاً');input.value='';return;}
  const fd=new FormData();fd.append('file',file);
  try{
    const res=await fetch(API.base+'/issues/'+proj+'/import',{method:'POST',headers:{'Authorization':'Bearer '+API.token},body:fd});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||'فشل الاستيراد');
    toast(`تم الاستيراد: ${data.created} جديد، ${data.updated} تحديث`,'ok');
    renderIssues();
  }catch(e){toast(e.message||'فشل استيراد الملف','err');}
  input.value='';
}

// ══ DOCUMENTS EXCEL IMPORT (Deliverable / Pre-Requisite) ══
async function importDocsExcel(input,sheetType){
  const file=input.files[0];if(!file)return;
  const proj=document.getElementById('doc-pf')?.value;
  if(!proj){alert('اختر مشروع أولاً عشان نربط المستندات المستوردة بيه');input.value='';return;}
  const fd=new FormData();fd.append('file',file);fd.append('sheet',sheetType);
  try{
    const res=await fetch(API.base+'/documents/'+proj+'/import-excel',{method:'POST',headers:{'Authorization':'Bearer '+API.token},body:fd});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||'فشل الاستيراد');
    toast(`تم استيراد ${data.added} مستند من شيت ${data.sheet}`,'ok');
    renderDocuments();
  }catch(e){toast(e.message||'فشل استيراد الملف','err');}
  input.value='';
}

async function downloadReport(format){
  const type=document.getElementById('rep-type').value;
  try{
    const res=await fetch(API.base+'/reports/'+type+'/'+format,{headers:API.headers()});
    if(!res.ok){const e=await res.json().catch(()=>({error:'فشل التصدير'}));throw new Error(e.error);}
    const blob=await res.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=type+'-report.'+(format==='xlsx'?'xlsx':'pdf');
    document.body.appendChild(a);a.click();a.remove();
    URL.revokeObjectURL(url);
  }catch(e){alert(e.message||'فشل تحميل التقرير');}
}

// ══ RISK REGISTER ══
const RK_LEVEL={high:{l:'عالية',c:'#f05a5a'},medium:{l:'متوسطة',c:'#f0a030'},low:{l:'منخفضة',c:'#22c87a'}};
const RK_CAT={technical:'تقني',schedule:'جدول زمني',cost:'تكلفة',quality:'جودة',safety:'سلامة',external:'خارجي'};

async function renderRisks(){
  initSels();
  const proj=document.getElementById('rk-pf')?.value;
  const summaryEl=document.getElementById('rk-summary'),contentEl=document.getElementById('risks-content');
  if(!proj){contentEl.innerHTML='<div class="empty">اختر مشروع من القائمة</div>';summaryEl.innerHTML='';return;}
  contentEl.innerHTML='<div class="loading"><i class="ti ti-loader-2"></i></div>';
  try{
    const items=await API.get('/risks/'+proj);
    const high=items.filter(r=>r.level==='high'&&r.status==='open').length;
    summaryEl.innerHTML=`<span class="pill" style="background:#f05a5a18;color:#f05a5a;margin-left:6px">عالية: ${high}</span><span class="pill" style="background:var(--bg3);color:var(--t3)">إجمالي: ${items.length}</span>`;
    contentEl.innerHTML=items.length?(`<table class="stbl"><tr><th>#</th><th>الوصف</th><th>الفئة</th><th>احتمالية×تأثير</th><th>الخطورة</th><th>المسؤول</th><th>الحالة</th><th></th></tr>
      ${items.map(r=>`<tr>
        <td>${r.rn||'-'}</td>
        <td style="max-width:260px;white-space:normal">${r.description}</td>
        <td>${RK_CAT[r.category]||r.category}</td>
        <td>${r.probability}×${r.impact}=${r.score}</td>
        <td><span class="pill" style="background:${RK_LEVEL[r.level].c}18;color:${RK_LEVEL[r.level].c}">${RK_LEVEL[r.level].l}</span></td>
        <td>${r.owner||'-'}</td>
        <td><select class="fsel" style="font-size:11px" onchange="updateRiskStatus(${r.id},this.value)">
          ${['open','mitigated','occurred','closed'].map(s=>`<option value="${s}" ${r.status===s?'selected':''}>${s}</option>`).join('')}
        </select></td>
        <td><button class="tbtn" onclick="viewRisk(${r.id})"><i class="ti ti-eye"></i></button>
        <button class="tbtn" onclick="deleteRisk(${r.id})"><i class="ti ti-trash"></i></button></td>
      </tr>`).join('')}</table>`)
      :'<div class="empty">لا توجد مخاطر مسجلة لهذا المشروع بعد</div>';
    window._risksCache=items;
  }catch(e){contentEl.innerHTML='<div class="empty">فشل تحميل البيانات</div>';}
}
function viewRisk(id){
  const r=(window._risksCache||[]).find(x=>x.id===id);if(!r)return;
  alert(`الخطر: ${r.description}\n\nخطة التخفيف: ${r.mitigation_plan||'-'}\n\nالخطة الاحتياطية: ${r.contingency_plan||'-'}`);
}
async function updateRiskStatus(id,status){
  try{await API.put('/risks/item/'+id,{status});toast('تم التحديث','ok');renderRisks();}catch(e){toast(e.message,'err');}
}
async function deleteRisk(id){
  if(!confirm('حذف هذا الخطر؟'))return;
  try{await API.del('/risks/item/'+id);renderRisks();}catch(e){toast(e.message,'err');}
}
async function addRisk(){
  const proj=document.getElementById('rk-pf')?.value;
  if(!proj){toast('اختر مشروع أولاً','err');return;}
  const description=prompt('وصف الخطر:');if(!description)return;
  const probability=prompt('احتمالية الحدوث (1-5):','3');
  const impact=prompt('حجم التأثير لو حصل (1-5):','3');
  const owner=prompt('المسؤول عن متابعة الخطر (اختياري):','');
  const mitigation_plan=prompt('خطة التخفيف (اختياري):','');
  try{await API.post('/risks/'+proj,{description,probability:+probability||3,impact:+impact||3,owner,mitigation_plan});renderRisks();}
  catch(e){toast(e.message,'err');}
}

// ══ CHANGE ORDERS ══
const CO_STATUS={proposed:{l:'مقترح',c:'#5c657e'},under_review:{l:'تحت المراجعة',c:'#f0a030'},approved:{l:'معتمد',c:'#22c87a'},rejected:{l:'مرفوض',c:'#f05a5a'},implemented:{l:'منفّذ',c:'#4f8ef7'}};

async function renderChangeOrders(){
  initSels();
  const proj=document.getElementById('co-pf')?.value;
  const summaryEl=document.getElementById('co-summary'),contentEl=document.getElementById('co-content');
  if(!proj){contentEl.innerHTML='<div class="empty">اختر مشروع من القائمة</div>';summaryEl.innerHTML='';return;}
  contentEl.innerHTML='<div class="loading"><i class="ti ti-loader-2"></i></div>';
  try{
    const items=await API.get('/change-orders/'+proj);
    const approvedCost=items.filter(c=>c.status==='approved'||c.status==='implemented').reduce((a,c)=>a+(+c.cost_impact||0),0);
    summaryEl.innerHTML=`<span class="pill" style="background:#22c87a18;color:#22c87a;margin-left:6px">إجمالي المعتمد: SAR ${approvedCost.toLocaleString('en-US')}</span><span class="pill" style="background:var(--bg3);color:var(--t3)">إجمالي الطلبات: ${items.length}</span>`;
    contentEl.innerHTML=items.length?(`<table class="stbl"><tr><th>رقم</th><th>العنوان</th><th>تأثير التكلفة</th><th>تأثير الجدول</th><th>الحالة</th><th></th></tr>
      ${items.map(c=>`<tr>
        <td style="font-family:monospace;font-size:11px">${c.co_number}</td>
        <td>${c.title}</td>
        <td>${c.cost_impact>0?'+':''}${(+c.cost_impact).toLocaleString('en-US')} SAR</td>
        <td>${c.schedule_impact_days>0?'+':''}${c.schedule_impact_days} يوم</td>
        <td><select class="fsel" style="font-size:11px;color:${CO_STATUS[c.status].c}" onchange="updateCOStatus(${c.id},this.value)">
          ${Object.entries(CO_STATUS).map(([k,v])=>`<option value="${k}" ${c.status===k?'selected':''}>${v.l}</option>`).join('')}
        </select></td>
        <td><button class="tbtn" onclick="viewCO(${c.id})"><i class="ti ti-eye"></i></button>
        <button class="tbtn" onclick="deleteCO(${c.id})"><i class="ti ti-trash"></i></button></td>
      </tr>`).join('')}</table>`)
      :'<div class="empty">لا توجد طلبات تغيير لهذا المشروع بعد</div>';
    window._coCache=items;
  }catch(e){contentEl.innerHTML='<div class="empty">فشل تحميل البيانات</div>';}
}
function viewCO(id){
  const c=(window._coCache||[]).find(x=>x.id===id);if(!c)return;
  alert(`${c.co_number}: ${c.title}\n\nالوصف: ${c.description||'-'}\n\nالسبب: ${c.reason||'-'}\n\nطلبها: ${c.requested_by||'-'}`);
}
async function updateCOStatus(id,status){
  try{
    await API.put('/change-orders/item/'+id,{status});
    toast(status==='approved'?'تم الاعتماد — تحديث الميزانية تلقائياً':'تم التحديث','ok');
    renderChangeOrders();
  }catch(e){toast(e.message,'err');}
}
async function deleteCO(id){
  if(!confirm('حذف طلب التغيير؟ لو كان معتمد هيتم تعديل الميزانية تلقائياً'))return;
  try{await API.del('/change-orders/item/'+id);renderChangeOrders();}catch(e){toast(e.message,'err');}
}
async function addChangeOrder(){
  const proj=document.getElementById('co-pf')?.value;
  if(!proj){toast('اختر مشروع أولاً','err');return;}
  const title=prompt('عنوان التغيير:');if(!title)return;
  const description=prompt('الوصف (اختياري):','');
  const reason=prompt('السبب (اختياري):','');
  const cost_impact=prompt('تأثير التكلفة بالريال (رقم موجب للزيادة، سالب للتوفير):','0');
  const schedule_impact_days=prompt('تأثير الجدول الزمني بالأيام:','0');
  try{await API.post('/change-orders/'+proj,{title,description,reason,cost_impact:+cost_impact||0,schedule_impact_days:+schedule_impact_days||0});renderChangeOrders();}
  catch(e){toast(e.message,'err');}
}

// ══ CRITICAL PATH METHOD (CPM) ══
async function renderCPM(){
  initSels();
  const proj=document.getElementById('cpm-pf')?.value;
  const summaryEl=document.getElementById('cpm-summary'),contentEl=document.getElementById('cpm-content');
  if(!proj){contentEl.innerHTML='<div class="empty">اختر مشروع من القائمة</div>';summaryEl.innerHTML='';return;}
  contentEl.innerHTML='<div class="loading"><i class="ti ti-loader-2"></i></div>';
  try{
    const [cpmData,deps]=await Promise.all([API.get('/dependencies/'+proj+'/critical-path'),API.get('/dependencies/'+proj)]);
    window._cpmTasksCache=cpmData.tasks;
    if(!cpmData.tasks.length){contentEl.innerHTML='<div class="empty">لا توجد مهام لهذا المشروع بعد</div>';summaryEl.innerHTML='';return;}

    summaryEl.innerHTML=`<div class="kcard" style="max-width:260px;display:inline-block;margin-left:10px"><div class="kval">${cpmData.projectDurationDays}</div><div class="klbl">إجمالي مدة المشروع (يوم)</div></div>
      <div class="kcard" style="max-width:260px;display:inline-block"><div class="kval" style="color:#f05a5a">${cpmData.criticalPath.length}</div><div class="klbl">مهمة على المسار الحرج</div></div>`;

    const sorted=[...cpmData.tasks].sort((a,b)=>a.es-b.es);
    contentEl.innerHTML=`
      <table class="stbl" style="margin-bottom:16px"><tr><th>المهمة</th><th>المدة (يوم)</th><th>ES</th><th>EF</th><th>LS</th><th>LF</th><th>Float</th><th>حرجة؟</th></tr>
      ${sorted.map(t=>`<tr style="${t.is_critical?'background:#f05a5a12':''}">
        <td>${t.is_critical?'<i class="ti ti-flame" style="color:#f05a5a;margin-left:4px"></i>':''}<strong>${t.title}</strong></td>
        <td>${t.duration_days||1}</td><td>${t.es}</td><td>${t.ef}</td><td>${t.ls}</td><td>${t.lf}</td>
        <td style="color:${t.float===0?'#f05a5a':'var(--t3)'};font-weight:${t.float===0?700:400}">${t.float}</td>
        <td>${t.is_critical?'<span class="pill" style="background:#f05a5a18;color:#f05a5a">نعم</span>':'-'}</td>
      </tr>`).join('')}</table>

      <div class="stsub" style="margin-bottom:8px">الروابط الحالية بين المهام</div>
      ${deps.length?(`<table class="stbl"><tr><th>من</th><th>النوع</th><th>إلى</th><th>Lag</th><th></th></tr>
        ${deps.map(d=>`<tr><td>${d.predecessor_title}</td><td>${d.type}</td><td>${d.successor_title}</td><td>${d.lag_days} يوم</td>
          <td><button class="tbtn" onclick="deleteDependency2(${d.id})"><i class="ti ti-trash"></i></button></td></tr>`).join('')}</table>`)
        :'<div class="empty">لا توجد روابط بين المهام بعد — دوسي "ربط مهام" لتحديد ترتيب التنفيذ</div>'}
    `;
  }catch(e){
    if(e.message&&e.message.includes('دائرة'))contentEl.innerHTML=`<div class="empty" style="color:#f05a5a">${e.message}</div>`;
    else contentEl.innerHTML='<div class="empty">فشل تحميل البيانات</div>';
  }
}
async function linkTasks(){
  const proj=document.getElementById('cpm-pf')?.value;
  if(!proj){toast('اختر مشروع أولاً','err');return;}
  try{
    const tasksList=tasks.filter(t=>t.project_id===proj);
    if(!tasksList.length){toast('لا توجد مهام في هذا المشروع','err');return;}
    const names=tasksList.map((t,i)=>`${i+1}) ${t.title} [ID:${t.id}]`).join('\n');
    const predId=prompt('ID المهمة السابقة (Predecessor):\n'+names);if(!predId)return;
    const succId=prompt('ID المهمة اللاحقة (Successor):');if(!succId)return;
    const type=prompt('نوع العلاقة: FS (الافتراضي) / SS / FF / SF','FS');
    const lag_days=prompt('فترة تأخير بالأيام (0 لو مفيش):','0');
    await API.post('/dependencies',{predecessor_id:+predId,successor_id:+succId,type:(type||'FS').trim().toUpperCase(),lag_days:+lag_days||0});
    toast('تم الربط','ok');renderCPM();
  }catch(e){toast(e.message,'err');}
}
async function deleteDependency2(id){
  if(!confirm('حذف هذا الربط؟'))return;
  try{await API.del('/dependencies/'+id);renderCPM();}catch(e){toast(e.message,'err');}
}

async function runRiskAnalysis(){
  const box=document.getElementById('ai-msgs');
  box.innerHTML+=`<div class="aimsg user">تحليل المخاطر — بناءً على Issues Log ومصفوفة الإنجاز والمستندات الناقصة</div>`;box.scrollTop=box.scrollHeight;
  document.getElementById('ai-typing').style.display='block';
  const proj=document.getElementById('cm-pf')?.value||document.getElementById('is-pf')?.value||document.getElementById('doc-pf')?.value||null;
  try{
    const res=await fetch('/api/ai/risk-analysis',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+API.token},body:JSON.stringify({project_id:proj})});
    const data=await res.json();
    document.getElementById('ai-typing').style.display='none';
    if(!res.ok){box.innerHTML+=`<div class="aimsg bot" style="color:var(--red)">${data.error||'فشل التحليل'}</div>`;}
    else{
      const scopeNote=proj?`<div style="font-size:10px;color:var(--t3);margin-bottom:6px">نطاق التحليل: ${proj}</div>`:'';
      box.innerHTML+=`<div class="aimsg bot">${scopeNote}${data.analysis.replace(/\n/g,'<br>')}</div>`;
    }
    box.scrollTop=box.scrollHeight;
  }catch(e){document.getElementById('ai-typing').style.display='none';box.innerHTML+=`<div class="aimsg bot" style="color:var(--red)">فشل الاتصال بخدمة التحليل</div>`;}
}

async function askAI(q){document.getElementById('ai-q').value=q;await sendAI();}
async function sendAI(){
  const inp=document.getElementById('ai-q'),q=inp.value.trim();if(!q)return;
  inp.value='';const box=document.getElementById('ai-msgs');
  box.innerHTML+=`<div class="aimsg user">${q}</div>`;box.scrollTop=box.scrollHeight;
  document.getElementById('ai-typing').style.display='block';
  const pd=projects.map(p=>`• ${p.name}: ${p.pct}% إنجاز، SAR ${fmt(p.budget)} ميزانية، حالة: ${SM[p.status].l}`).join('\n');
  const td=`المهام: ${tasks.length}، ${tasks.filter(t=>t.col==='doing').length} جارية، ${tasks.filter(t=>t.col==='done').length} مكتملة`;
  try{
    const res=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+API.token},body:JSON.stringify({question:q,context:{projects:pd,tasks:td,user:CU?.name,role:CU?.role}})});
    const data=await res.json();
    document.getElementById('ai-typing').style.display='none';
    box.innerHTML+=`<div class="aimsg bot">${data.answer||data.error||'لا توجد إجابة'}</div>`;
    box.scrollTop=box.scrollHeight;
  }catch(e){document.getElementById('ai-typing').style.display='none';box.innerHTML+=`<div class="aimsg bot" style="color:var(--red)">تأكد أن ANTHROPIC_API_KEY مضاف في الـ .env على الخادم</div>`;}
}

// ══ EXPORT ══
function doExport(){const rows=[['ID','المشروع','المسؤول','الإنجاز%','الميزانية','المنفق','الحالة'],...projects.map(p=>[p.id,p.name,p.lead||'',p.pct,p.budget||0,p.spent||0,SM[p.status].l]),[],...tasks.map(t=>[t.title,t.project_id,t.priority,t.col,t.assigned_to||'',t.due_date||''])];const csv='\ufeff'+rows.map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),download:'ProjectHub_'+new Date().toISOString().slice(0,10)+'.csv'});a.click();toast('تم التصدير','ok');}

// ══ SEARCH & KEYBOARD ══
function gSearch(v){if(v.length>1){goto('kanban');document.getElementById('kb-q').value=v;renderKanban();}}
document.addEventListener('keydown',e=>{
  if(!CU)return;if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
  if(e.key==='1')goto('dashboard');else if(e.key==='2')goto('projects');else if(e.key==='3')goto('kanban');
  else if(e.key==='4')goto('gantt');else if(e.key==='5')goto('timeline');
  else if(e.key==='n'&&can('add_task'))openTM();else if(e.key==='p'&&can('add_project'))openPM();
  else if(e.key==='/')  {e.preventDefault();document.getElementById('gsearch').focus();}
  else if(e.key==='Escape'){closeAI();document.getElementById('notifpanel').classList.remove('open');['tm','pm','mem-m','ms-m','aum'].forEach(id=>document.getElementById(id)?.classList.remove('open'));}
});

// ══ TOAST ══
function toast(msg,type='ok'){const el=document.getElementById('toast'),ic=document.getElementById('t-ic');document.getElementById('t-msg').textContent=msg;ic.className='ti '+(type==='err'?'ti-x':type==='info'?'ti-info-circle':'ti-check');el.className='toast '+(type==='err'?'terr':type==='info'?'tinfo':'tok');el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),2600);}

// ══ INIT ══
autoLogin();

// ══════════════════════════════════════════════════════════════
// KPI CENTER
// ══════════════════════════════════════════════════════════════
let kpiData = null;
let kpiCharts = {};
let kpiRefreshTimer = null;

async function loadKPI() {
  try {
    kpiData = await API.get('/kpi/overview');
    renderKPIPage();
  } catch(e) { toast('خطأ في تحميل KPI: ' + e.message, 'err'); }
}

function renderKPIPage() {
  if (!kpiData) return;
  const el = document.getElementById('kpi-center-content');
  if (!el) return;

  const { projects: P, tasks: T, team: TM, financial: F, alerts: A, trend, milestones: MS } = kpiData;

  // Destroy old charts
  Object.values(kpiCharts).forEach(c => { try { c.destroy(); } catch(e){} });
  kpiCharts = {};

  el.innerHTML = `
  <!-- ALERT BANNER -->
  ${A.filter(a=>a.level==='critical').length ? `
  <div style="background:rgba(240,90,90,.1);border:1px solid rgba(240,90,90,.3);border-radius:var(--r);padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:10px">
    <i class="ti ti-alert-triangle" style="color:#f05a5a;font-size:20px;flex-shrink:0"></i>
    <div style="flex:1"><div style="font-size:13px;font-weight:600;color:#f05a5a">يوجد ${A.filter(a=>a.level==='critical').length} تنبيه حرج يحتاج تدخل فوري</div>
    <div style="font-size:11px;color:var(--t3);margin-top:2px">${A.filter(a=>a.level==='critical').map(a=>a.msg).slice(0,2).join(' • ')}</div></div>
    <button class="tbtn" onclick="goto('kpi-alerts')" style="flex-shrink:0;font-size:11px">عرض الكل</button>
  </div>` : ''}

  <!-- TOP KPI ROW -->
  <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px">
    ${[
      {ic:'ti-briefcase',bg:'rgba(79,142,247,.08)',c:'#4f8ef7',v:P.onTrack+'/'+P.total,l:'على المسار / الكل'},
      {ic:'ti-chart-line',bg:'rgba(34,200,122,.08)',c:'#22c87a',v:P.avgProgress+'%',l:'متوسط الإنجاز'},
      {ic:'ti-circle-check',bg:'rgba(34,200,122,.08)',c:'#22c87a',v:T.completionRate+'%',l:'معدل إتمام المهام'},
      {ic:'ti-clock',bg:'rgba(240,90,90,.08)',c:'#f05a5a',v:T.overdue,l:'مهام متأخرة'},
      {ic:'ti-currency-dollar',bg:'rgba(240,160,48,.08)',c:'#f0a030',v:F.budgetUtilization+'%',l:'استخدام الميزانية'},
      {ic:'ti-trending-up',bg:'rgba(155,114,244,.08)',c:'#9b72f4',v:F.roi+'%',l:'مؤشر ROI'},
    ].map(k=>`<div class="kcard" style="padding:12px"><div class="kglow" style="background:${k.c}"></div>
      <div class="kicon" style="background:${k.bg};margin-bottom:8px"><i class="ti ${k.ic}" style="color:${k.c}"></i></div>
      <div class="kval" style="font-size:20px">${k.v}</div><div class="klbl">${k.l}</div></div>`).join('')}
  </div>

  <!-- ROW 2: SPI Table + Task Distribution -->
  <div class="g2" style="margin-bottom:12px">
    <div class="panel">
      <div class="phdr"><div class="ptitle"><i class="ti ti-chart-arrows-vertical"></i>مؤشرات الأداء (SPI / CPI)</div>
        <div style="font-size:10px;color:var(--t3)">SPI=تقدم/مخطط · CPI=قيمة/تكلفة · أفضل من 1</div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="font-size:10px;color:var(--t3);padding:7px 12px;border-bottom:1px solid var(--border);text-align:right">المشروع</th>
          <th style="font-size:10px;color:var(--t3);padding:7px 12px;border-bottom:1px solid var(--border);text-align:right">الإنجاز</th>
          <th style="font-size:10px;color:var(--t3);padding:7px 12px;border-bottom:1px solid var(--border);text-align:right">المخطط</th>
          <th style="font-size:10px;color:var(--t3);padding:7px 12px;border-bottom:1px solid var(--border);text-align:right">SPI</th>
          <th style="font-size:10px;color:var(--t3);padding:7px 12px;border-bottom:1px solid var(--border);text-align:right">CPI</th>
        </tr></thead>
        <tbody>
          ${P.spi.map(p=>{
            const sc=p.spi>=1?'#22c87a':p.spi>=0.8?'#f0a030':'#f05a5a';
            const cc=p.cpi>=1?'#22c87a':p.cpi>=0.8?'#f0a030':'#f05a5a';
            return `<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px 12px"><div style="display:flex;align-items:center;gap:7px"><div style="width:8px;height:8px;border-radius:50%;background:${p.color};flex-shrink:0"></div><div style="font-size:12px;color:var(--text)">${p.name}</div></div></td>
              <td style="padding:8px 12px;font-size:12px;color:var(--text)">${p.pct||0}%</td>
              <td style="padding:8px 12px;font-size:12px;color:var(--t3)">${p.planned||0}%</td>
              <td style="padding:8px 12px;font-size:12px;font-weight:700;color:${sc}">${p.spi}</td>
              <td style="padding:8px 12px;font-size:12px;font-weight:700;color:${cc}">${p.cpi}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="panel">
      <div class="phdr"><div class="ptitle"><i class="ti ti-chart-donut-2"></i>توزيع المهام بالتفصيل</div></div>
      <div class="chbox" style="height:210px"><canvas id="kpi-task-donut"></canvas></div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;padding:0 14px 12px;text-align:center">
        ${[['backlog','#5c657e','Backlog'],['todo','#4f8ef7','مخطط'],['doing','#f0a030','جارية'],['review','#9b72f4','مراجعة'],['done','#22c87a','مكتمل']].map(([k,c,l])=>`<div><div style="font-size:16px;font-weight:700;color:${c}">${T.byCol[k]||0}</div><div style="font-size:10px;color:var(--t3)">${l}</div></div>`).join('')}
      </div>
    </div>
  </div>

  <!-- ROW 3: Progress Trend + Financial -->
  <div class="g2" style="margin-bottom:12px">
    <div class="panel">
      <div class="phdr"><div class="ptitle"><i class="ti ti-chart-line"></i>منحنى التقدم الأسبوعي</div></div>
      <div class="chbox" style="height:220px"><canvas id="kpi-trend-line"></canvas></div>
    </div>
    <div class="panel">
      <div class="phdr"><div class="ptitle"><i class="ti ti-currency-dollar"></i>الأداء المالي</div></div>
      <div style="padding:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          ${[
            {l:'إجمالي الميزانية',v:'SAR '+fmtK(F.totalBudget),c:'var(--text)'},
            {l:'إجمالي المنفق',v:'SAR '+fmtK(F.totalSpent),c:F.budgetUtilization>90?'#f05a5a':F.budgetUtilization>70?'#f0a030':'#22c87a'},
            {l:'الانحراف المتبقي',v:'SAR '+fmtK(Math.abs(F.budgetVariance)),c:F.budgetVariance>=0?'#22c87a':'#f05a5a'},
            {l:'القيمة المكتسبة',v:'SAR '+fmtK(F.earnedValue),c:'#9b72f4'},
          ].map(x=>`<div style="background:var(--bg3);border-radius:8px;padding:10px"><div style="font-size:10px;color:var(--t3);margin-bottom:3px">${x.l}</div><div style="font-size:14px;font-weight:700;color:${x.c}">${x.v}</div></div>`).join('')}
        </div>
        <div class="chbox" style="height:160px;padding:0"><canvas id="kpi-fin-bar"></canvas></div>
      </div>
    </div>
  </div>

  <!-- ROW 4: Team Performance -->
  <div class="panel" style="margin-bottom:12px">
    <div class="phdr"><div class="ptitle"><i class="ti ti-users"></i>أداء الفريق</div>
      <div style="font-size:11px;color:var(--t3)">Score = (مهام مكتملة / إجمالي) × 100 - (متأخرة × 10)</div>
    </div>
    <div style="padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">
      ${TM.map(m=>{
        const sc=m.score>=70?'#22c87a':m.score>=40?'#f0a030':'#f05a5a';
        return `<div style="background:var(--bg3);border-radius:var(--r);padding:12px;text-align:center">
          <div style="width:44px;height:44px;border-radius:50%;background:${m.color}22;color:${m.color};display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;margin:0 auto 8px">${m.name[0]}</div>
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px">${m.name}</div>
          <div style="font-size:10px;color:var(--t3);margin-bottom:8px">${m.role||''}</div>
          <div style="font-size:22px;font-weight:700;color:${sc};margin-bottom:6px">${m.score}</div>
          <div style="height:4px;background:var(--bg4);border-radius:2px;overflow:hidden;margin-bottom:8px"><div style="height:100%;background:${sc};width:${m.score}%;border-radius:2px"></div></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:10px;color:var(--t3)">
            <div><div style="font-weight:700;color:var(--text)">${m.total}</div>إجمالي</div>
            <div><div style="font-weight:700;color:#22c87a">${m.done}</div>مكتمل</div>
            <div><div style="font-weight:700;color:${m.overdue>0?'#f05a5a':'var(--t3)'}">${m.overdue}</div>متأخر</div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>

  <!-- ROW 5: Milestones summary + Alerts list -->
  <div class="g2" style="margin-bottom:12px">
    <div class="panel">
      <div class="phdr"><div class="ptitle"><i class="ti ti-flag-3"></i>ملخص Milestones</div></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0;text-align:center;padding:16px">
        ${[['الكل',MS.total,'#4f8ef7'],['مكتملة',MS.done,'#22c87a'],['قادمة',MS.upcoming,'#9b72f4'],['متأخرة',MS.delayed,'#f05a5a']].map(([l,v,c])=>`<div style="padding:10px;border-left:1px solid var(--border)"><div style="font-size:28px;font-weight:700;color:${c}">${v}</div><div style="font-size:12px;color:var(--t3);margin-top:3px">${l}</div></div>`).join('')}
      </div>
    </div>
    <div class="panel">
      <div class="phdr"><div class="ptitle"><i class="ti ti-bell"></i>التنبيهات النشطة</div><span style="font-size:11px;color:var(--t3)">${A.length} تنبيه</span></div>
      <div style="max-height:160px;overflow-y:auto">
        ${A.slice(0,6).map(a=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border)">
          <div style="width:28px;height:28px;border-radius:50%;background:${a.color}18;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ti ${a.icon}" style="color:${a.color};font-size:13px"></i></div>
          <div style="font-size:12px;color:var(--text);flex:1">${a.msg}</div>
          <span class="pill" style="font-size:9px;background:${a.color}18;color:${a.color};border:1px solid ${a.color}33">${a.level==='critical'?'حرج':'تحذير'}</span>
        </div>`).join('')}
        ${A.length===0?'<div class="empty" style="padding:20px">✅ لا توجد تنبيهات</div>':''}
      </div>
    </div>
  </div>`;

  // Render charts
  setTimeout(() => {
    // Task Donut
    const ctx1 = document.getElementById('kpi-task-donut')?.getContext('2d');
    if(ctx1) kpiCharts.donut = new Chart(ctx1, {type:'doughnut',data:{labels:['Backlog','قيد التخطيط','جارية','مراجعة','مكتملة'],datasets:[{data:[T.byCol.backlog,T.byCol.todo,T.byCol.doing,T.byCol.review,T.byCol.done],backgroundColor:['#3a4060','#4f8ef7','#f0a030','#9b72f4','#22c87a'],borderWidth:0,hoverOffset:5}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{display:false}}}});

    // Trend Line
    const ctx2 = document.getElementById('kpi-trend-line')?.getContext('2d');
    if(ctx2 && trend) kpiCharts.trend = new Chart(ctx2, {type:'line',data:{labels:trend.weeks,datasets:trend.progress.map(p=>({label:p.name,data:p.data,borderColor:p.color,backgroundColor:p.color+'15',borderWidth:2,fill:true,tension:.4,pointRadius:3}))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#9aa3bc',font:{size:10},padding:8,boxWidth:10}}},scales:{y:{max:100,grid:{color:'#2e344860'},ticks:{color:'#5c657e',font:{size:10},callback:v=>v+'%'}},x:{grid:{color:'#2e344830'},ticks:{color:'#5c657e',font:{size:10}}}}}});

    // Financial Bar
    const ctx3 = document.getElementById('kpi-fin-bar')?.getContext('2d');
    if(ctx3) kpiCharts.fin = new Chart(ctx3, {type:'bar',data:{labels:F.byProject.map(p=>p.id),datasets:[{label:'الميزانية',data:F.byProject.map(p=>p.budget),backgroundColor:'#4f8ef755',borderRadius:4},{label:'المنفق',data:F.byProject.map(p=>p.spent),backgroundColor:F.byProject.map(p=>p.utilization>90?'#f05a5a':p.utilization>70?'#f0a030':'#22c87a'),borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#9aa3bc',font:{size:10},padding:6,boxWidth:10}}},scales:{x:{grid:{display:false},ticks:{color:'#5c657e',font:{size:10}}},y:{grid:{color:'#2e344860'},ticks:{color:'#5c657e',font:{size:10},callback:v=>fmtK(v)}}}}});
  }, 100);
}

function fmtK(n) { return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(0)+'K':n; }

// ══ ALERT RULES PAGE ══
async function renderAlertRules() {
  const el = document.getElementById('kpi-rules-content');
  if (!el) return;
  try {
    const [rules, schedStatus] = await Promise.all([
      API.get('/kpi/rules'),
      API.get('/kpi/schedule-status'),
    ]);
    el.innerHTML = `
    <div class="g2" style="margin-bottom:14px">
      <div class="panel">
        <div class="phdr"><div class="ptitle"><i class="ti ti-mail"></i>إرسال تقرير فوري</div></div>
        <div style="padding:14px">
          <div class="fg"><label>البريد الإلكتروني</label><input type="email" class="fi" id="email-to-input" placeholder="manager@atech.sa"></div>
          <div class="fg"><label>الموضوع</label><input type="text" class="fi" id="email-subject" value="تقرير الأداء — ProjectHub Pro"></div>
          <button class="btn-s" onclick="sendEmailReport()"><i class="ti ti-send" style="margin-left:5px"></i>إرسال التقرير الآن</button>
        </div>
      </div>
      <div class="panel">
        <div class="phdr"><div class="ptitle"><i class="ti ti-calendar-repeat"></i>التقرير الأسبوعي التلقائي</div></div>
        <div style="padding:14px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <div style="width:10px;height:10px;border-radius:50%;background:${schedStatus.emailConfigured?'#22c87a':'#f05a5a'}"></div>
            <span style="font-size:13px;color:var(--text)">${schedStatus.emailConfigured?'البريد مضبوط ✅':'البريد غير مضبوط ❌'}</span>
          </div>
          ${schedStatus.weeklyReportTo?`<div style="font-size:12px;color:var(--t3);margin-bottom:8px">يُرسل إلى: <strong style="color:var(--accent)">${schedStatus.weeklyReportTo}</strong></div>`:''}
          <div style="font-size:11px;color:var(--t3);background:var(--bg3);padding:10px;border-radius:var(--r);line-height:1.7">
            أضف في الـ <code style="color:var(--accent)">.env</code> على الخادم:<br>
            <code>EMAIL_USER=your@gmail.com</code><br>
            <code>EMAIL_PASS=app_password</code><br>
            <code>WEEKLY_REPORT_EMAIL=manager@atech.sa</code><br>
            <span style="font-size:10px">للـ Gmail: فعّل 2FA ثم أنشئ App Password</span>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="phdr"><div class="ptitle"><i class="ti ti-bell-ringing"></i>قواعد التنبيهات</div>
        <button class="tbtn pri" onclick="openRuleModal()"><i class="ti ti-plus"></i>قاعدة جديدة</button>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="font-size:11px;color:var(--t3);padding:9px 14px;border-bottom:1px solid var(--border);text-align:right">القاعدة</th>
          <th style="font-size:11px;color:var(--t3);padding:9px 14px;border-bottom:1px solid var(--border);text-align:right">النوع</th>
          <th style="font-size:11px;color:var(--t3);padding:9px 14px;border-bottom:1px solid var(--border);text-align:right">الحد</th>
          <th style="font-size:11px;color:var(--t3);padding:9px 14px;border-bottom:1px solid var(--border);text-align:right">مفعّل</th>
          <th style="font-size:11px;color:var(--t3);padding:9px 14px;border-bottom:1px solid var(--border);text-align:right">إيميل</th>
          <th style="font-size:11px;color:var(--t3);padding:9px 14px;border-bottom:1px solid var(--border)"></th>
        </tr></thead>
        <tbody>
          ${rules.map(r=>`<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:9px 14px;font-size:13px;color:var(--text)">${r.name}</td>
            <td style="padding:9px 14px"><span class="pill p-info" style="font-size:10px">${r.type}</span></td>
            <td style="padding:9px 14px;font-size:12px;color:var(--t3)">${r.threshold||'—'}</td>
            <td style="padding:9px 14px"><span style="font-size:12px;color:${r.enabled?'#22c87a':'#5c657e'}">${r.enabled?'✅ نعم':'❌ لا'}</span></td>
            <td style="padding:9px 14px"><span style="font-size:12px;color:${r.notify_email?'#4f8ef7':'#5c657e'}">${r.notify_email?'✉️ نعم':'لا'}</span></td>
            <td style="padding:9px 14px;display:flex;gap:6px">
              <button class="tcabtn" onclick="toggleRule(${r.id},${!r.enabled})" style="font-size:11px"><i class="ti ti-${r.enabled?'toggle-right':'toggle-left'}"></i></button>
              <button class="tcabtn" style="color:var(--red);font-size:11px" onclick="deleteRule(${r.id})"><i class="ti ti-trash"></i></button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div style="padding:12px 14px;border-top:1px solid var(--border)">
        <button class="tbtn" onclick="runAlertCheck()"><i class="ti ti-refresh"></i>تشغيل فحص التنبيهات الآن</button>
      </div>
    </div>`;
  } catch(e) { el.innerHTML = '<div class="empty">خطأ في التحميل</div>'; }
}

async function sendEmailReport() {
  const to = document.getElementById('email-to-input')?.value?.trim();
  const subject = document.getElementById('email-subject')?.value?.trim();
  if (!to) { toast('أدخل البريد الإلكتروني', 'err'); return; }
  try {
    const data = await API.post('/kpi/send-report', { to, subject });
    toast(data.message || 'تم الإرسال', 'ok');
  } catch(e) { toast(e.message, 'err'); }
}

async function toggleRule(id, enabled) {
  try { await API.put('/kpi/rules/'+id, { enabled }); renderAlertRules(); toast('تم التحديث', 'ok'); }
  catch(e) { toast(e.message, 'err'); }
}
async function deleteRule(id) {
  if (!confirm('حذف هذه القاعدة؟')) return;
  try { await API.del('/kpi/rules/'+id); renderAlertRules(); toast('تم الحذف', 'ok'); }
  catch(e) { toast(e.message, 'err'); }
}
async function runAlertCheck() {
  try { const d = await API.post('/kpi/check-alerts', {}); toast(`تم الفحص — أضيف ${d.added} تنبيه جديد`, 'info'); }
  catch(e) { toast(e.message, 'err'); }
}

// ══ NOTIFICATIONS PANEL ══
let notifData = [];
async function loadNotifications() {
  try {
    notifData = await API.get('/kpi/notifications');
    renderNotifPanel();
    updateNBadge();
  } catch(e) {}
}

function renderNotifPanel() {
  const el = document.getElementById('np-list');
  if (!el) return;
  const unread = notifData.filter(n => !n.is_read);
  if (!notifData.length) { el.innerHTML = '<div class="empty">✅ لا توجد تنبيهات</div>'; return; }
  el.innerHTML = `
    ${unread.length ? `<div style="padding:8px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--t3)">${unread.length} غير مقروء</span><button class="pact" onclick="markAllRead()">تحديد الكل كمقروء</button></div>` : ''}
    ${notifData.slice(0,10).map(n=>`
    <div class="npitem" style="opacity:${n.is_read?0.5:1};cursor:pointer" onclick="markRead(${n.id},this)">
      <div class="npic" style="background:${n.color||'#4f8ef7'}18"><i class="ti ${n.icon||'ti-bell'}" style="color:${n.color||'#4f8ef7'}"></i></div>
      <div style="flex:1"><div class="nptxt">${n.message}</div>
      <div class="npsub">${new Date(n.created_at).toLocaleDateString('ar')} ${new Date(n.created_at).toLocaleTimeString('ar',{hour:'2-digit',minute:'2-digit'})}</div></div>
      ${!n.is_read?'<div style="width:7px;height:7px;border-radius:50%;background:#4f8ef7;flex-shrink:0;margin-top:5px"></div>':''}
    </div>`).join('')}`;
}

async function markRead(id, el) {
  try { await API.put('/kpi/notifications/'+id+'/read', {}); el.style.opacity='0.5'; updateNBadge(); }
  catch(e) {}
}
async function markAllRead() {
  try { await API.put('/kpi/notifications/read-all', {}); loadNotifications(); }
  catch(e) {}
}

// Override updateNBadge to use server notifications
const _origUpdateNBadge = updateNBadge;
updateNBadge = function() {
  const unread = notifData.filter(n => !n.is_read).length;
  const localN = buildNotifs().length;
  const total = Math.max(unread, localN);
  const b = document.getElementById('ncnt');
  if (b) { b.textContent = total; b.style.display = total ? 'flex' : 'none'; }
};

// Override toggleNotif to load server notifications
const _origToggleNotif = toggleNotif;
toggleNotif = function() {
  const pn = document.getElementById('notifpanel');
  const open = pn.classList.toggle('open');
  if (open) { loadNotifications(); }
};

// ══ AUTO REFRESH KPI ══
function startKPIRefresh() {
  if (kpiRefreshTimer) clearInterval(kpiRefreshTimer);
  kpiRefreshTimer = setInterval(() => {
    if (curPage === 'kpi-overview') loadKPI();
  }, 30000);
}

// ══ PATCH GOTO FOR KPI PAGES ══
const _origGotoForKPI = goto;
goto = async function(pg) {
  if (pg === 'kpi-overview') {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
    document.getElementById('page-kpi-overview')?.classList.add('active');
    document.querySelector(".ni[onclick*=\"'kpi-overview'\"]")?.classList.add('active');
    document.getElementById('tb-pg').textContent = 'KPI Center';
    document.getElementById('tb-sub').textContent = 'مؤشرات الأداء الرئيسية';
    curPage = pg;
    await loadKPI();
    startKPIRefresh();
    return;
  }
  if (pg === 'kpi-alerts') {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
    document.getElementById('page-kpi-alerts')?.classList.add('active');
    document.querySelector(".ni[onclick*=\"'kpi-alerts'\"]")?.classList.add('active');
    document.getElementById('tb-pg').textContent = 'التنبيهات والإيميل';
    document.getElementById('tb-sub').textContent = 'قواعد التنبيه وإرسال التقارير';
    curPage = pg;
    await renderAlertRules();
    return;
  }
  _origGotoForKPI(pg);
};

// Load notifications on startup
setTimeout(() => { if (CU) loadNotifications(); }, 2000);
setInterval(() => { if (CU) loadNotifications(); }, 60000);
