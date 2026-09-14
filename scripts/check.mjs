import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const required=['app/main.cjs','app/preload.cjs','app/worker.cjs','app/renderer/index.html','scripts/preview.mjs','scripts/installer.nsh','scripts/linux-after-install.sh','scripts/install-linux.sh','scripts/build-linux.sh','scripts/package-metadata.mjs','tests/core.test.mjs','tests/snmp.integration.mjs','package-lock.json'];
for(const file of required)if(!existsSync(file))throw Error(`Missing required file: ${file}`);
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=['app','scripts','tests'].flatMap(walk).filter(f=>/\.(cjs|mjs|js)$/.test(f));
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0)throw Error(`${file}: ${r.stderr}`);}
const pkg=JSON.parse(readFileSync('package.json','utf8')),lock=JSON.parse(readFileSync('package-lock.json','utf8'));
for(const group of ['dependencies','devDependencies'])for(const [name,version] of Object.entries(pkg[group]||{}))if(lock.packages[''][group]?.[name]!==version)throw Error(`Lock mismatch for ${name}`);
const main=readFileSync('app/main.cjs','utf8');
for(const phrase of ['contextIsolation: true','sandbox: true','nodeIntegration: false'])if(!main.includes(phrase))throw Error(`Desktop security invariant missing: ${phrase}`);
if(/session\.set\s*\(/.test(readFileSync('app/core/snmp.mjs','utf8')))throw Error('Read-only collector unexpectedly includes SET');
console.log(`PASS: ${files.length} JavaScript files, required scripts, lockfile and security invariants`);
