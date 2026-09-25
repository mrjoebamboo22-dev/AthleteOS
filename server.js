const http=require('http');
const fs=require('fs');
const path=require('path');
const {randomUUID}=require('crypto');
const seed=JSON.parse(fs.readFileSync(path.join(__dirname,'data','seed.json'),'utf8'));
const state={diagnostics:new Map(),plans:new Map(),assignments:new Map(),verifications:new Map(),audit:[]};
const PORT=process.env.PORT||3000;
function send(res,status,data,type='application/json'){res.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(data,null,2):data)}
function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>100000)req.destroy()});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch(e){reject(e)}})})}
function user(req){return {id:req.headers['x-demo-user']||'coach-joe',role:req.headers['x-demo-role']||'coach',teamId:'team-eagles'}}
function requireRole(req,res,roles){const u=user(req);if(!roles.includes(u.role)){send(res,403,{error:'forbidden'});return null}return u}
function audit(actor,action,entityType,entityId){state.audit.push({id:randomUUID(),actor,action,entityType,entityId,at:new Date().toISOString()})}
function coachOwnsTeam(u,teamId){return u.role==='coach'&&u.teamId===teamId}
async function api(req,res,url){
 const u=user(req); const p=url.pathname;
 if(req.method==='GET'&&p==='/api/v1/me')return send(res,200,{user:u,team:seed.team,permissions:u.role==='coach'?['diagnose','plan','assign','verify']:[]});
 if(req.method==='GET'&&p==='/api/v1/teams/team-eagles/athletes'){if(!coachOwnsTeam(u,'team-eagles'))return send(res,403,{error:'forbidden'});return send(res,200,[seed.athlete]);}
 if(req.method==='GET'&&p==='/api/v1/seed/outside-contain'){if(!['coach','guardian','athlete'].includes(u.role))return send(res,403,{error:'forbidden'});return send(res,200,seed);}
 if(req.method==='POST'&&p==='/api/v1/diagnostics'){
   if(!requireRole(req,res,['coach']))return; const b=await body(req);
   if(!coachOwnsTeam(u,b.teamId)||b.athleteId!==seed.athlete.id)return send(res,403,{error:'object_access_denied'});
   const d={id:randomUUID(),...b,createdBy:u.id,status:'questions_ready',createdAt:new Date().toISOString()};state.diagnostics.set(d.id,d);audit(u.id,'create','diagnostic',d.id);
   return send(res,201,{diagnosticSessionId:d.id,questions:seed.diagnosticQuestions});
 }
 let m=p.match(/^\/api\/v1\/diagnostics\/([^/]+)\/answers$/);
 if(req.method==='POST'&&m){if(!requireRole(req,res,['coach']))return;const d=state.diagnostics.get(m[1]);if(!d||d.createdBy!==u.id)return send(res,404,{error:'not_found'});const b=await body(req);d.answers=b.answers||[];d.status='causes_ready';audit(u.id,'answer','diagnostic',d.id);return send(res,200,{diagnosticSessionId:d.id,possibleCauses:seed.possibleCauses,disclaimer:'These are coaching hypotheses. Confirm the most relevant cause through observation.'});}
 if(req.method==='POST'&&p==='/api/v1/development-plans'){
   if(!requireRole(req,res,['coach']))return;const b=await body(req);const d=state.diagnostics.get(b.diagnosticSessionId);if(!d||d.createdBy!==u.id)return send(res,403,{error:'diagnostic_access_denied'});
   const plan={id:randomUUID(),teamId:seed.team.id,athleteId:seed.athlete.id,coachId:u.id,status:'draft',title:'Outside Contain Development',goalStatement:b.goalStatement||seed.skill.goal,selectedCauseCode:b.selectedCauseCode,successCriteria:seed.successCriteria,drills:seed.drills,lesson:seed.lesson,quiz:seed.quiz,createdAt:new Date().toISOString()};state.plans.set(plan.id,plan);audit(u.id,'create','development_plan',plan.id);return send(res,201,plan);
 }
 if(req.method==='POST'&&p==='/api/v1/assignments'){
   if(!requireRole(req,res,['coach']))return;const b=await body(req);const plan=state.plans.get(b.developmentPlanId);if(!plan||plan.coachId!==u.id)return send(res,403,{error:'plan_access_denied'});
   const assignment={id:randomUUID(),developmentPlanId:plan.id,athleteId:seed.athlete.id,title:b.title||plan.title,instructions:b.instructions||'Complete the lesson, home drill, and knowledge check.',dueAt:b.dueAt||null,status:b.publish?'assigned':'draft',items:[{id:'item-lesson',type:'lesson',title:seed.lesson.title,status:'not_started'},{id:'item-drill',type:'drill',title:seed.drills[0].title,status:'not_started'},{id:'item-quiz',type:'quiz',title:seed.quiz.title,status:'not_started'}]};state.assignments.set(assignment.id,assignment);plan.status='active';audit(u.id,'publish','assignment',assignment.id);return send(res,201,assignment);
 }
 if(req.method==='GET'&&p==='/api/v1/athlete/assignments'){if(!requireRole(req,res,['athlete']))return;return send(res,200,[...state.assignments.values()].filter(a=>a.athleteId===seed.athlete.id));}
 m=p.match(/^\/api\/v1\/athlete\/assignments\/([^/]+)$/);
 if(req.method==='GET'&&m){if(!requireRole(req,res,['athlete']))return;const a=state.assignments.get(m[1]);if(!a||a.athleteId!==seed.athlete.id)return send(res,404,{error:'not_found'});return send(res,200,a);}
 m=p.match(/^\/api\/v1\/athlete\/assignments\/([^/]+)\/complete$/);
 if(req.method==='POST'&&m){if(!requireRole(req,res,['athlete']))return;const a=state.assignments.get(m[1]);if(!a||a.athleteId!==seed.athlete.id)return send(res,404,{error:'not_found'});a.status='completed';a.completedAt=new Date().toISOString();audit(u.id,'complete','assignment',a.id);return send(res,200,a);}
 if(req.method==='GET'&&p==='/api/v1/guardian/athletes/athlete-tyler/development-summary'){if(!requireRole(req,res,['guardian']))return;const assignment=[...state.assignments.values()].find(a=>a.athleteId===seed.athlete.id);return send(res,200,{athlete:seed.athlete,currentFocus:seed.skill.name,goal:seed.skill.goal,assignment:assignment?{id:assignment.id,title:assignment.title,status:assignment.status,dueAt:assignment.dueAt}:null,supportGuidance:['Ask the athlete to explain force responsibility.','Reinforce effort and learning, not comparison.','Let the coach handle technical correction.']});}
 m=p.match(/^\/api\/v1\/development-plans\/([^/]+)\/verifications$/);
 if(req.method==='POST'&&m){if(!requireRole(req,res,['coach']))return;const plan=state.plans.get(m[1]);if(!plan||plan.coachId!==u.id)return send(res,403,{error:'plan_access_denied'});const b=await body(req);const v={id:randomUUID(),planId:plan.id,...b,verifiedBy:u.id,verifiedAt:new Date().toISOString()};state.verifications.set(v.id,v);if(!b.followUpRequired)plan.status='completed';audit(u.id,'verify','development_plan',plan.id);return send(res,201,{verification:v,nextStep:b.outcome==='improved'?'Progress to a controlled live-read challenge.':'Repeat the no-contact progression and reinforce patience before commitment.'});}
 if(req.method==='GET'&&p==='/api/v1/audit'){if(!requireRole(req,res,['coach']))return;return send(res,200,state.audit);}
 return send(res,404,{error:'route_not_found'});
}
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/'))return await api(req,res,url);let file=url.pathname==='/'?'index.html':url.pathname.slice(1);file=path.normalize(file).replace(/^\.\.(\/|\\|$)/,'');const full=path.join(__dirname,'public',file);if(!full.startsWith(path.join(__dirname,'public')))return send(res,403,'Forbidden','text/plain');if(!fs.existsSync(full)||fs.statSync(full).isDirectory())return send(res,404,'Not found','text/plain');const ext=path.extname(full);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};send(res,200,fs.readFileSync(full),types[ext]||'application/octet-stream')}catch(e){send(res,400,{error:'bad_request',message:e.message})}});
server.listen(PORT,()=>console.log(`AthleteOS prototype running at http://localhost:${PORT}`));
