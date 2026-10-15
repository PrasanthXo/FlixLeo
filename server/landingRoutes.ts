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
    return res.status(503).type('text/plain').send('Unable to check Android releases right now. Please try again shortly.');
  }
  const candidates=items.flatMap(r=>{
    const m=/^android-v1\.5\.(\d+)$/.exec(r.tag);
    if(!m)return [];
    return r.assets.filter(a=>
      /^FlixLeo-Android-v1\.5\.\d+-signed\.apk$/i.test(a.name)&&
      a.size>8_000_000&&
      /^https:\/\/github\.com\/PrasanthXo\/FlixLeo\/releases\/download\//i.test(a.url)
    ).map(a=>({url:a.url,version:Number(m[1])}));
  }).sort((a,b)=>b.version-a.version);
  if(candidates.length)return res.redirect(302,candidates[0].url);
  console.warn('Android download: no valid public signed Android release asset',items.map(r=>({tag:r.tag,assets:r.assets.map(a=>a.name)})));
  return res.status(503).type('text/plain').send('No publicly published signed Android APK found. Check the FlixLeo GitHub Releases publishing job.');
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
