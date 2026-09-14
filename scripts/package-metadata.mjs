import {createHash} from 'node:crypto';
import {createReadStream,readdirSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import path from 'node:path';
const dir='release';if(!existsSync(dir))throw Error('No release directory');
const files=readdirSync(dir).filter(f=>/^NetPin-.*\.(exe|deb|rpm|tar\.gz)$/.test(f)).sort();
if(!files.length)throw Error('No installer packages were generated');
const rows=[];for(const name of files){const hash=createHash('sha256');for await(const chunk of createReadStream(path.join(dir,name)))hash.update(chunk);rows.push(hash.digest('hex')+'  '+name);}
writeFileSync(path.join(dir,'SHA256SUMS'),rows.join('\n')+'\n');
for(const file of ['install-linux.sh','install-windows.ps1'])copyFileSync(path.join('scripts',file),path.join(dir,file));
copyFileSync('docs/INSTALL.md',path.join(dir,'INSTALL.md'));
console.log(`PASS: ${files.length} packages checksummed; offline installation wrappers copied`);
