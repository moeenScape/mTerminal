import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Presentation,PresentationFile} from '@oai/artifact-tool';

const root='/home/moeen775/test/ownterminal';
const build=path.join(root,'.artifact-build/termius');
const skill='/home/moeen775/.codex/plugins/cache/openai-primary-runtime/presentations/26.1011.11113/skills/presentations';
const data=JSON.parse(await fs.readFile(path.join(build,'content.json'),'utf8'));
const p=Presentation.create({slideSize:{width:1280,height:720}});
const font='DejaVu Sans';
const C={bg:'#101820',fg:'#F4F7FA',muted:'#B6C3CF',accent:'#8FDEC4',light:'#F6F8FA',ink:'#142635'};
const texts=[];
function txt(s,t,x,y,w,h,size=28,color=C.fg,bold=false){
 const sh=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 sh.text=t;sh.text.style={typeface:font,fontSize:size,color,bold,insets:0,autoFit:'none',wrap:'square'};
 texts.push(t);return sh;
}
function slide(title,sourceKeys=[],note='',light=false){
 const s=p.slides.add();s.background.fill=light?C.light:C.bg;
 txt(s,title,70,55,1140,100,46,light?C.ink:C.fg,true);
 txt(s,String(p.slides.items.length).padStart(2,'0'),1155,668,55,25,16,light?'#526577':C.muted);
 s.speakerNotes.text=[note,'Sources reviewed 27 October 2026:',...sourceKeys.map(k=>`${data.sources[k][0]}: ${data.sources[k][1]}`)].join('\n');
 return s;
}
function rows(s,items,{top=195,width=1100,step=135,light=false}={}){
 items.forEach(([head,body],i)=>{
  txt(s,head,75,top+i*step,width,42,30,light?'#245B68':C.accent,true);
  txt(s,body,75,top+i*step+46,width,78,26,light?C.ink:C.fg);
 });
}
async function picture(s,key,y=335,h=290){
 const bytes=await fs.readFile(path.join(build,'assets',`${key}.png`));
 s.images.add({blob:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),contentType:'image/png',alt:`Official Termius ${key} documentation screenshot`,fit:'contain',position:{left:70,top:y,width:1140,height:h}});
 s.speakerNotes.text += `\nImage source: ${data.sources[key][1]}`;
}
function table(s,values,widths,{top=180,height=410,size=23}={}){
 const t=s.tables.add({rows:values.length,columns:values[0].length,left:70,top,width:1140,height,columnWidths:widths,values});
 t.borders.assign({fill:'#B8C7D1',width:1,style:'solid'});
 for(let r=0;r<values.length;r++)for(let c=0;c<values[0].length;c++){
  const cell=t.getCell(r,c);cell.fill=r===0?'#173A52':(r%2?'#EAF0F4':'#FFFFFF');
  cell.text.style={typeface:font,fontSize:size,color:r===0?'#FFFFFF':C.ink,bold:r===0,insets:12,verticalAlignment:'middle'};
 }
 return t;
}

let s=slide('Termius', ['overview'], 'Independent feature review. Published documentation, not hands-on product testing.');
// A flat typographic cover keeps the product name and purpose editable.
txt(s,'Free and paid features',75,235,1100,95,66,C.fg,true);
txt(s,'Connections, automation and shared infrastructure',78,365,1050,70,30,C.accent);
txt(s,'Detailed guide companion  •  27 October 2026',78,558,1100,40,23,C.muted);

s=slide('The product model',['overview'],'Vaults contain reusable host and credential information. Group defaults reduce repeated connection setup.');
rows(s,[['Vaults','Storage and sharing boundaries for infrastructure data'],['Groups and hosts','Organize environments and reuse connection settings'],['Keychain and terminal','Reuse credentials, connect, transfer files and run commands']]);

s=slide('Plans and annual pricing',['pricing','billing'],'USD monthly equivalents billed annually. Pro totals $120 per year. Team and Business require at least two seats; monthly checkout rates were not verified.',true);
table(s,[['Plan','USD per month','Primary purpose'],['Starter','Free','Local workflow'],['Pro','$10 / user','Personal sync and records'],['Team','$20 / seat','Shared infrastructure'],['Business','$30 / seat','Separated access'],['Enterprise','Custom','Organizational requirements']],[220,270,650],{height:420});
txt(s,'Annual billing • subscriptions • Team and Business minimum two seats',75,625,1100,30,20,'#526577');

s=slide('Free connection tools',['connect','changelog'],'Jump hosts, proxies, agent forwarding and serial became free in desktop 10.1.0, September 2026. Device and server support still apply.');
rows(s,[['SSH, Mosh and local terminal','Remote shell access plus a shell on the desktop machine'],['SFTP, Telnet and serial','File transfers and access to compatible legacy equipment'],['Tunnels, chains and proxies','Reach private services through an approved network path']]);

s=slide('Host organization',['groups','overview'],'Nested groups can supply settings to hosts unless overridden. Tags provide another search dimension. Changing a group can affect many connections.');
rows(s,[['Groups','Use projects, clients or environments as the hierarchy'],['Inherited settings','Share credentials, routing, environment and appearance defaults'],['Tags and search','Find related machines without duplicating host entries']]);

s=slide('Port forwarding and routing',['tunnel','connect'],'Example only: 127.0.0.1:15432 on a laptop tunnels through a bastion to db.internal:5432. Server forwarding policy and endpoint reachability still apply.');
rows(s,[['Local','Use a local listener to reach a service through an SSH host'],['Remote','Forward a server-side listener toward a client-side service'],['Dynamic','Provide a SOCKS endpoint for compatible applications']]);

s=slide('SFTP in the same workflow',['sftp'],'Desktop provides two panes; mobile supports multiple SFTP tabs. File editing downloads a copy and tracks changes for upload. Filesystem permissions and distribution sandboxing still apply.');
txt(s,'Browse, transfer and edit files beside the terminal',75,180,1100,85,32,C.accent);
await picture(s,'sftp',295,320);

s=slide('Credentials and authentication',['keys','sshid'],'SSH keys and certificates, FIDO2 and biometrics are documented. SSH ID publishes public keys while keeping private keys device-bound. Server provisioning and revocation are separate responsibilities.');
txt(s,'Reusable identities, certificates and device-backed keys',75,180,1100,90,32,C.accent);
await picture(s,'keys',290,335);

s=slide('Desktop workspaces',['workspace'],'At least two sessions are required. Templates capture connection and layout state. They should not be treated as guaranteed persistent remote processes.');
txt(s,'Focus view, split sessions and reusable layouts',75,180,1100,85,32,C.accent);
await picture(s,'workspace',290,330);

s=slide('Snippets and broadcast',['snippets','workspace','pricing'],'Basic snippets and multi-execution appear in Starter. Startup snippets require Pro or above. Check destinations and current shell state before broadcasting.');
rows(s,[['Saved commands','Keep inspection commands and scripts in reusable packages'],['Multi-execution and broadcast','Send a script or input to several intended destinations'],['Startup snippets','Run an assigned command when a connection opens']]);

s=slide('Autocomplete and AI',['autocomplete','ai','aiwidget'],'Shell integration is local Bash/Zsh and documented remotely for Bash with OpenSSH 7.2+. It may disconnect servers that reject extra exec channels. Command generation is described as cloud processing. Current AI quotas were not verified.');
rows(s,[['Completion','Suggestions from paths, history, commands and snippets'],['Natural language','Generate a candidate command or a saved snippet'],['Review before execution','Check paths and effects; avoid submitting secrets in prompts']]);

s=slide('Synchronization and vault protection',['sync','crypto','expiry'],'Personal credential sync can be disabled separately. Other eligible vault data continues syncing. Logout clears local data; unsynced changes after expiry can be lost. SSO does not replace the vault encryption password.');
rows(s,[['Across devices','Keep an eligible personal vault available on desktop and mobile'],['Local credentials option','Exclude personal keys and identities from synchronization'],['Recovery boundary','Preserve the encryption password and any unsynced changes']]);

s=slide('Session logs and bookmarks',['logs'],'Recent logs rotate per host. Bookmarks preserve selected sessions. Mosh is not recorded. Mobile records but cannot view logs. Disabling logging deletes the vault’s logs, including bookmarks.');
txt(s,'Review a session and preserve the important ones',75,180,1100,90,32,C.accent);
await picture(s,'logs',295,310);

s=slide('Mobile use',['mobile','logs'],'The detailed mobile guide primarily describes iOS/iPadOS. Android interaction and background behavior must be checked in the installed app. Mobile does not provide all desktop functionality.');
rows(s,[['Touch controls','Gestures, keyboard controls, selection and adjustable text size'],['Short operational tasks','Connect, run a saved command or transfer a file'],['Platform differences','Workspaces and log viewing remain desktop workflows']]);

s=slide('Team collaboration',['team','vaults','teamlogs','home'],'Owners manage membership and vault access. The homepage describes multiplayer with one typist at a time. The pricing table lists multiplayer as free, while team-wide sharing is paid; exact account limits need confirmation.');
rows(s,[['Shared infrastructure','Make host settings and approved scripts available together'],['Live terminal work','Troubleshoot together with controlled typing handoff'],['Shared records','Review recent per-host, per-member sessions and comments']]);

s=slide('Business access and SSO',['vaults','sso','pricing'],'Multiple vaults can separate clients or environments. Viewer permissions still allow connections and snippets; server privileges remain independent. SAML is a Business add-on and included in the Enterprise pricing summary.');
rows(s,[['Separate vaults','Give each project or environment its own access boundary'],['Viewer and editor','Distinguish connecting from editing stored infrastructure data'],['Identity provider login','Centralize sign-in while retaining a vault encryption password']]);

s=slide('Cloud inventory eligibility is disputed',['aws','do','azure','pricing'],'All three integration guides specify Team, Business and Enterprise. The pricing table includes cloud integration in Pro. Confirm eligibility before buying for this feature. Azure excludes VMs without public IPs.',true);
table(s,[['Provider','Managed inventory'],['AWS','EC2 and Lightsail'],['DigitalOcean','Droplets'],['Azure','VMs with public IP addresses']],[340,800],{top:190,height:310,size:27});
txt(s,'Pricing table: Pro+   •   Implementation guides: Team+',75,550,1100,75,29,'#8A421C',true);

s=slide('Enterprise and integration catalogue',['pricing'],'These entries are listed publicly. Implementation documentation for API bridge, Ansible and Vanta was not found in the reviewed index. Confirm exact interfaces, deployment and contractual limits with Termius.',true);
table(s,[['Minimum','Additional capabilities'],['Team','API bridge and Ansible'],['Enterprise','Vanta; approved domains; SOC 2 report'],['Enterprise','Priority support; manager; onboarding; SLA'],['Enterprise','Check/transfer; purchase order; custom terms'],['Enterprise','Custom log retention controls']],[270,870],{height:420,size:24});

s=slide('Operational limits worth checking',['logs','sync','autocomplete','sftp','pqc'],'Test each requirement on a non-production host with the intended app version and distribution. These are documented limitations, not results from a hands-on test.');
rows(s,[['Compatibility','Shell integration, cryptographic algorithms and app sandboxing'],['Data retention','Rotating logs, deleted logs and local-only credentials'],['Access revocation','Remove server permissions as well as client vault membership']]);

s=slide('Plan selection',['billing'],'Assessment: choose the lowest plan that meets a tested workflow. The free tier can cover substantial single-device use. Student eligibility may provide Pro and Team features through GitHub.',true);
table(s,[['Your need','Evaluate'],['Local connections and file work','Starter'],['One setup across personal devices','Pro'],['Shared hosts and team handovers','Team'],['Different vault access by project','Business'],['Contractual and enterprise controls','Enterprise']],[800,340],{height:420,size:25});

s=slide('A short evaluation workflow',['connect','sftp','tunnel','workspace','logs'],'Use disposable or non-production hosts. Record OS, app version, distribution and subscription. No commands in this presentation have been executed against your systems.');
rows(s,[['Connect and organize','Create two groups, assign a key and verify a host'],['Work across tools','Transfer a sample file, open a workspace and start a local tunnel'],['Validate the paid need','Test sync, log bookmarks and separate vault permissions']]);

s=slide('Sources and verification boundary',['pricing','changelog','billing','overview'],'All slide-specific sources appear in speaker notes. The accompanying guide includes a complete clickable source directory. Reviewed 27 October 2026. Published documentation only; no performance benchmarks or hands-on entitlement testing.');
rows(s,[['Official sources','Termius pricing, product documentation and release notes'],['Unresolved items','Cloud entitlement, multiplayer limits and detailed integration contracts'],['Companion guide','Detailed workflows, examples, limits and source directory']]);

await fs.mkdir(path.join(build,'slides'),{recursive:true});
for(const [i,s] of p.slides.items.entries()){
 const png=await p.export({slide:s,format:'png',scale:1});
 await fs.writeFile(path.join(build,'slides',`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));
}
const candidatePath=path.join(build,'candidate.pptx');
await (await PresentationFile.exportPptx(p)).save(candidatePath);
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({
 workspaceDir:root,candidatePath,finalPath:path.join(root,'docs/termius/Termius_Feature_Presentation.pptx'),
 pythonExecutable:'/home/moeen775/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',
 integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),
 layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),
 layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],
 requiredNativeTableOwnerSlides:[3,17,18,20],fontPolicy:{basis:'design',families:[font]},
 verifyArtifactToolImport:true,receiptPath:path.join(build,'presentation-validation.json'),
});
await fs.writeFile(path.join(build,'slide-text.json'),JSON.stringify(texts));
console.log(JSON.stringify({slides:p.slides.items.length,result}));
