// Run after branding/flixleo-icon-v2.png is uploaded. Generate all native + web icon sizes.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const icon = fs.existsSync(path.join(root,'branding','flixleo-icon-v2.png')) ? path.join(root,'branding','flixleo-icon-v2.png') : path.join(root,'branding','flixleo-icon-v2.svg');
async function main() {
 if (!fs.existsSync(icon)) throw Error('Upload branding/flixleo-icon-v2.png or branding/flixleo-icon-v2.svg first.');
 const targets = [
  ['public/flixleo-icon-v2.png',512], ['public/favicon-32.png',32],
  ['public/apple-touch-icon.png',180],['public/pwa-192.png',192],
  ['public/pwa-512.png',512],
  ['android-native/app/src/main/res/drawable/flixleo_brand.png',512],
  ['desktop/brand-icon.png',256]
 ];
 for (const [file,size] of targets) {
  const dest=path.join(root,file);fs.mkdirSync(path.dirname(dest),{recursive:true});
  await sharp(icon).resize(size,size,{fit:'contain',background:'#090b13'}).png().toFile(dest);
 }
 const replace = (file,pairs) => {
  const full=path.join(root,file);let text=fs.readFileSync(full,'utf8');
  for(const [a,b] of pairs) text=text.replaceAll(a,b);
  fs.writeFileSync(full,text);
 };
 replace('index.html',[['/flixleo-splash-icon.svg','/pwa-512.png']]);
 replace('public/landing.html',[['/flixleo-splash-icon.svg','/flixleo-icon-v2.png']]);
 replace('src/components/Header/Navbar.tsx',[['/flixleo-logo.svg','/flixleo-icon-v2.png']]);
 const manifest=path.join(root,'public/manifest.webmanifest');
 let m=JSON.parse(fs.readFileSync(manifest,'utf8'));
 m.icons=[
 {src:'/pwa-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
 {src:'/pwa-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
 {src:'/pwa-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}
 ];
 fs.writeFileSync(manifest,JSON.stringify(m,null,2)+'\n');
 console.log('Logo 2.0 applied to Android launcher, web app, landing, PWA and desktop icon sources');
}
main().catch(err=>{console.error(err);process.exit(1)});
