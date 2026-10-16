import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releasesEndpoint = 'https://api.github.com/repos/PrasanthXo/FlixLeo/releases?per_page=20';
type Release = { name: string; tag: string; date: string; notes: string; assets: Array<{name:string;url:string;size:number}> };
let cache: { until:number; items:Release[] } | null = null;
async function releases():Promise<Release[]> {
  if(cache && Date.now()<cache.until)return cache.items;
  const response=await fetch(releasesEndpoint,{headers:{'User-Agent':'FlixLeo-Release-Landing','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(6500)});
  if(!response.ok)throw new Error('GitHub release API unavailable');
  const data:any=await response.json();
  const items:Release[]=(Array.isArray(data)?data:[]).filter((r:any)=>!r.draft&&!r.prerelease).map((r:any)=>({
    name:String(r.name||r.tag_name||'Release').slice(0,100),tag:String(r.tag_name||'').slice(0,80),
    date:String(r.published_at||''),notes:String(r.body||'').slice(0,2000),
    assets:(Array.isArray(r.assets)?r.assets:[]).filter((a:any)=>a.state==='uploaded').map((a:any)=>({name:String(a.name||''),url:String(a.browser_download_url||''),size:Number(a.size)||0}))
  }));
  cache={until:Date.now()+300000,items};return items;
}
function typeOf(release:Release):'android'|'windows'|null{
  if(release.assets.some(a=>/\.apk$/i.test(a.name)))return 'android';
  if(release.assets.some(a=>/\.exe$/i.test(a.name)))return 'windows';
  return null;
}
// Password recovery must never be treated as email signup confirmation.
router.get('/native-reset-password', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'");
  return res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset FlixLeo password</title><style>body{background:#0b101a;color:#fff;font:16px system-ui;min-height:95vh;display:grid;place-items:center}main{max-width:400px;width:90%;padding:20px}input,button{width:100%;box-sizing:border-box;padding:14px;margin:9px 0;border-radius:11px;font:inherit}input{background:#202a39;color:white;border:1px solid #718096}button{background:#f6bd4f;color:#141414;border:0;font-weight:bold}p{line-height:1.5}</style></head><body><main><h1>Reset your password</h1><p id="status">Enter a new password for FlixLeo.</p><form id="form"><input type="password" id="password" minlength="8" maxlength="256" required autocomplete="new-password" placeholder="New password (8+ characters)"><input type="password" id="confirm" minlength="8" required autocomplete="new-password" placeholder="Confirm new password"><button type="submit">Update password</button></form></main><script>(function(){var p=new URLSearchParams(location.hash.slice(1)),q=new URLSearchParams(location.search),jwt=p.get('access_token'),type=p.get('type'),form=document.getElementById('form'),status=document.getElementById('status');history.replaceState(null,'',location.pathname);if(q.get('error')||p.get('error')||!jwt||type!=='recovery'){status.textContent='Reset link is invalid or expired. Request another password reset email from FlixLeo.';form.hidden=true;return;}form.addEventListener('submit',async function(e){e.preventDefault();var pass=document.getElementById('password').value;if(pass!==document.getElementById('confirm').value){status.textContent='Passwords do not match.';return;}if(pass.length<8){status.textContent='Use at least 8 characters.';return;}var btn=form.querySelector('button');btn.disabled=true;status.textContent='Updating password…';try{var response=await fetch('/api/native/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+jwt},body:JSON.stringify({password:pass})});var data=await response.json();if(!response.ok)throw Error(data.error||'Password update failed');status.textContent='Password updated successfully. Return to FlixLeo and sign in with your new password.';form.hidden=true; jwt=null;}catch(err){status.textContent=err.message||'Reset failed';btn.disabled=false;}});})();</script></body></html>`);
});
// Email confirmation returns to the app without forwarding session credentials.
// Users sign in normally after confirming their address.
router.get('/', (req: Request, res: Response, next) => {
  if (req.query.native_email_confirmed !== '1') return next();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  return res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FlixLeo email verification</title><style>body{background:#0b101a;color:#fff;font:16px system-ui;min-height:95vh;display:grid;place-items:center;text-align:center}main{max-width:380px;padding:28px}a{background:#f6bd4f;color:#171717;border-radius:12px;display:inline-block;padding:14px 25px;font-weight:700;text-decoration:none}</style></head><body><main><h1 id="title">Confirming email…</h1><p id="detail">Returning to FlixLeo Android.</p><a id="open" href="flixleo://email-confirmed" style="display:none">Open FlixLeo app</a></main><script>(function(){var hash=new URLSearchParams(location.hash.slice(1));var query=new URLSearchParams(location.search);var error=hash.get('error')||query.get('error');var verified=!error&&(hash.get('type')!=='recovery')&&(hash.has('access_token')||hash.get('type')==='signup'||query.has('code'));var title=document.getElementById('title');var detail=document.getElementById('detail');var link=document.getElementById('open');if(error){title.textContent='Confirmation failed';detail.textContent='The verification link may have expired. Request another email from the app.';return;}if(!verified){title.textContent='Open your verification email';detail.textContent='Follow the confirmation link to verify your email.';return;}title.textContent='Mail confirmed';detail.textContent='Your email is confirmed. Return to FlixLeo to sign in.';history.replaceState(null,'',location.pathname+'?native_email_confirmed=1');link.style.display='inline-block';location.replace('flixleo://email-confirmed');})();</script></body></html>`);
});
router.get('/api/download/release-notes',async(req:Request,res:Response)=>{
  res.setHeader('Cache-Control','public, max-age=300');
  const platform=String(req.query.platform||'');
  try{
    const items=await releases();
    const selected=items.filter(r=>!platform||typeOf(r)===platform);
    return res.json({releases:selected.slice(0,5).map(({name,tag,date,notes})=>({name,tag,date,notes}))});
  }catch{return res.status(503).json({releases:[],error:'Release notes unavailable'});}
});
// Never route users to a private, debug, undersized or stale APK.
router.get('/api/download/android',async(_req:Request,res:Response)=>{
  res.setHeader('Cache-Control','no-store');
  let items:Release[];
  try {
    // Bypass the 5-minute release-notes cache for APK downloads. Fresh public
    // releases must become installable immediately after the publishing job.
    cache = null;
    items = await releases();
  } catch(error) {
    console.error('Android download: public GitHub Releases lookup failed',error);
    return res.redirect(302,'https://github.com/PrasanthXo/FlixLeo/releases');
  }
  const candidates=items.flatMap(r=>{
    const m=/^android-v1\.(5|6)\.(\d+)$/.exec(r.tag);
    if(!m)return [];
    const name='FlixLeo-Android-v1.'+m[1]+'.'+m[2]+'-signed.apk';
    return r.assets.filter(a=>
      a.name===name&&
      a.size>8_000_000&&
      /^https:\/\/github\.com\/PrasanthXo\/FlixLeo\/releases\/download\//i.test(a.url)
    ).map(a=>({url:a.url,version:(m[1]==='6'?100000:1000)+Number(m[2])}));
  }).sort((a,b)=>b.version-a.version);
  if(candidates.length)return res.redirect(302,candidates[0].url);
  console.warn('Android download: no valid public signed Android release asset',items.map(r=>({tag:r.tag,assets:r.assets.map(a=>a.name)})));
  // Never display an error page from an Android download button. If no public
  // verified APK exists yet, let the visitor inspect public releases instead.
  // Do not point at private release assets (anonymous users cannot download them).
  return res.redirect(302,'https://github.com/PrasanthXo/FlixLeo/releases');
});
export function serveAppLanding(req:Request,res:Response,next:()=>void){
  // Only the apex is the download landing; web.flixleo.cyou remains the SPA.
  const host=String(req.headers.host||'').split(':')[0].toLowerCase();
  // iPhone and iPad use the full web application directly at the apex.
  // Include iPadOS desktop-mode Safari (Macintosh + Mobile).
  const agent=String(req.headers['user-agent']||'');
  const appleMobile=/iPhone|iPad|iPod/i.test(agent)||(/Macintosh/i.test(agent)&&/Mobile\//i.test(agent));
  // TV browsers (including LG webOS, Samsung Tizen and Android TV) open the streaming app directly.
  const television=/\b(?:webOS|web0S|NetCast|Tizen|SmartTV|Smart-TV|HbbTV|GoogleTV|Google TV|Android TV|AppleTV|Apple TV|Roku|AFT[A-Z0-9]+|BRAVIA|Viera|DTV)\b/i.test(agent);
  if(appleMobile||television)return next();
  if((host==='flixleo.cyou'||host==='www.flixleo.cyou')&&req.path==='/'&&!['code','token_hash','type','error','error_code','access_token','refresh_token','tv_pair'].some(k=>Object.prototype.hasOwnProperty.call(req.query,k))){
    res.setHeader('Cache-Control','public, max-age=60');
    return res.sendFile(path.resolve(__dirname,'../dist/landing.html'),err=>{
      if(err&&!res.headersSent)res.status(503).send('Landing page not built yet.');
    });
  }
  next();
}
export default router;
