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
  [['ft-proj','proj'],['kb-pf','proj'],['g-pf','proj'],['tl-pf','proj'],['sr-pf','proj'],
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
const PT={dashboard:['لوحة التحكم','نظرة عامة'],projects:['المشاريع','إدارة المشاريع'],kanban:['Kanban Board','تتبع المهام'],gantt:['Gantt Chart','الجدول الزمني'],timeline:['Timeline','الخط الزمني'],team:['الفريق','أعضاء الفريق'],sitereport:['Site Report اليومي','تقارير الأداء'],log:['سجل النشاط','مسجل على الخادم'],settings:['الإعدادات','إعدادات النظام']};
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
function switchST(sec,el){document.querySelectorAll('.stsec').forEach(s=>s.classList.remove('active'));document.querySelectorAll('.stni').forEach(n=>n.classList.remove('active'));document.getElementById('ss-'+sec).classList.add('active');el.classList.add('active');if(sec==='users')renderUsersTable();if(sec==='appearance')renderSwatches();if(sec==='roles')renderRoles();}
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
  if(id){const t=tasks.find(x=>x.id===id);if(!t)return;document.getElementById('ft-title').value=t.title;document.getElementById('ft-proj').value=t.project_id||'';document.getElementById('ft-col').value=t.col;document.getElementById('ft-prio').value=t.priority;document.getElementById('ft-assign').value=t.assigned_to||'';document.getElementById('ft-date').value=t.due_date||'';document.getElementById('ft-hours').value=t.hours_estimated||'';document.getElementById('ft-notes').value=t.notes||'';}
  else{['ft-title','ft-date','ft-hours','ft-notes'].forEach(x=>document.getElementById(x).value='');document.getElementById('ft-prio').value='med';if(col)document.getElementById('ft-col').value=col;}
  document.getElementById('tm').classList.add('open');
}
function closeTM(){document.getElementById('tm').classList.remove('open');}
async function saveTask(){
  const title=document.getElementById('ft-title').value.trim();if(!title){toast('أدخل عنوان المهمة','err');return;}
  const body={title,project_id:document.getElementById('ft-proj').value,col:document.getElementById('ft-col').value,priority:document.getElementById('ft-prio').value,assigned_to:document.getElementById('ft-assign').value,due_date:document.getElementById('ft-date').value||null,hours_estimated:parseInt(document.getElementById('ft-hours').value)||0,notes:document.getElementById('ft-notes').value};
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
