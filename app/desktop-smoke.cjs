'use strict';
// Invoked only by --smoke-test, always in a separate temporary user-data directory.
// Uses the real Electron renderer, preload, utility process and SQLite, not UI mocks.
const fs=require('node:fs');
const path=require('node:path');
module.exports=async function desktopSmoke(window,call){
  const evalFunction=fn=>window.webContents.executeJavaScript(`(${fn.toString()})()`);
  const result=await evalFunction(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    async function until(fn,message){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await sleep(75);}throw Error(message);}
    const click=s=>{const e=document.querySelector(s);if(!e)throw Error('Missing UI control: '+s);e.click();};
    const fill=(form,values)=>{for(const [name,value] of Object.entries(values)){const e=document.querySelector(`#${form} [name="${name}"]`);if(!e)throw Error('Missing field: '+name);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));}};
    async function submit(form){document.querySelector('#'+form).requestSubmit();await until(()=>!document.querySelector('#modal').open || document.querySelector('#'+form+' .form-error')?.textContent,'Form did not finish');const error=document.querySelector('#'+form+' .form-error')?.textContent;if(error)throw Error(error);}
    async function nav(name,title){click(`[data-nav="${name}"]`);await until(()=>document.querySelector('#content h1')?.textContent===title,'Navigation did not finish: '+name);}
    await until(()=>window.__netpinReady,'UI did not become ready');
    if(typeof require!=='undefined'||typeof process!=='undefined')throw Error('Node leaked into renderer');
    const state=await window.netpin.invoke('state');if(!state.demo||state.devices.length!==2)throw Error('Demo IPC fixture mismatch');
    const row=(await window.netpin.invoke('subnetView',{id:'demo-net',query:'192.0.2.21'})).rows.find(r=>r.ip==='192.0.2.21');
    if(!row.locations.some(l=>l.port==='Gi0/1'))throw Error('Port correlation failed');
    await nav('settings','凭据与设置');click('[data-action="add-credential"]');
    fill('credential-form',{name:'Desktop test',version:'3',username:'fixture-user',authKey:'test-auth-123',privKey:'test-priv-123'});await submit('credential-form');
    const credentials=(await window.netpin.invoke('state')).credentials,c=credentials.find(c=>c.name==='Desktop test');
    if(!c||JSON.stringify(await window.netpin.invoke('state')).includes('test-auth-123'))throw Error('Credential sealing/redaction failed');
    await nav('devices','设备与端口');click('[data-action="add-device"]');
    fill('device-form',{name:'Desktop test router',host:'192.0.2.200',branch:'UI test',space:'test',credentialId:c.id});await submit('device-form');
    if((await window.netpin.invoke('state')).devices.length!==3)throw Error('Device form did not persist');
    await until(()=>document.querySelector('[data-action="add-device"]'),'Device page missing');click('[data-action="add-device"]');
    fill('device-form',{name:'Duplicate',host:'192.0.2.200',branch:'UI test',space:'test',credentialId:c.id});document.querySelector('#device-form').requestSubmit();
    await until(()=>document.querySelector('#device-form .form-error')?.textContent,'Duplicate validation did not appear');
    if((await window.netpin.invoke('state')).devices.length!==3)throw Error('Duplicate validation failed');click('[data-action="close-modal"]');
    await nav('subnets','IP 地址台账');click('[data-action="add-network"]');
    fill('network-form',{name:'UI test network',branch:'UI test',space:'test',network:'198.51.100.0',mask:'255.255.255.0',gateway:'198.51.100.1'});await submit('network-form');
    const network=(await window.netpin.invoke('state')).subnets.find(n=>n.name==='UI test network');if(!network)throw Error('Subnet form did not persist');
    await until(()=>document.querySelector('[data-ip="198.51.100.1"]'),'New network did not render');click('[data-ip="198.51.100.1"]');
    await until(()=>document.querySelector('#assignment-form'),'Address form did not open');
    fill('assignment-form',{status:'reserved',owner:'Desktop test',note:'<img src=x onerror="window.netpinUnsafe=1">'});await submit('assignment-form');
    const saved=(await window.netpin.invoke('subnetView',{id:network.id,query:'198.51.100.1'})).rows.find(r=>r.ip==='198.51.100.1');
    if(saved.management!=='reserved')throw Error('Assignment form did not persist');
    click('[data-action="table"]');await until(()=>document.querySelector('.table-wrap'),'Table view did not render');
    if(window.netpinUnsafe || document.querySelector('#content img'))throw Error('Untrusted note executed as HTML');
    click('[data-action="next-page"]');await until(()=>document.querySelector('#content').textContent.includes('第 2 / 2 页'),'Pagination failed');
    await window.netpin.invoke('resetDemo');
    return {rendererIsolation:true,portCorrelation:true,credentialForm:true,credentialRedaction:true,deviceForm:true,duplicateValidation:true,subnetForm:true,assignmentForm:true,escapedNotes:true,pagination:true,sqlite:true};
  });
  await new Promise(resolve=>{window.webContents.once('did-finish-load',resolve);window.webContents.reload();});
  const readyDeadline=Date.now()+15000;
  while(Date.now()<readyDeadline && !(await window.webContents.executeJavaScript('Boolean(window.__netpinReady)')))await new Promise(r=>setTimeout(r,75));
  if(!(await window.webContents.executeJavaScript('Boolean(window.__netpinReady)')))throw Error('UI reload failed');
  const out=path.resolve(process.env.NETPIN_TEST_OUTPUT||'test-results');fs.mkdirSync(out,{recursive:true});
  for(const [nav,title] of [['overview','网络概览'],['subnets','IP 地址台账'],['devices','设备与端口'],['settings','凭据与设置']]){
    await window.webContents.executeJavaScript(`document.querySelector('[data-nav="${nav}"]').click()`);
    const end=Date.now()+15000;
    while(Date.now()<end && !(await window.webContents.executeJavaScript(`document.querySelector('#content h1')?.textContent===${JSON.stringify(title)}`)))await new Promise(r=>setTimeout(r,75));
    if(!(await window.webContents.executeJavaScript(`document.querySelector('#content h1')?.textContent===${JSON.stringify(title)}`)))throw Error('Screenshot page did not finish: '+nav);
    await new Promise(r=>setTimeout(r,200));
    fs.writeFileSync(path.join(out,`electron-${nav}.png`),(await window.webContents.capturePage()).toPNG());
  }
  const csv=await call('exportCsv',{id:'demo-net'});if(!csv.content.includes('192.0.2.21'))throw Error('Export backend failed');
  fs.writeFileSync(path.join(out,'electron-smoke.json'),JSON.stringify({...result,csvExport:true,electron:process.versions.electron,node:process.versions.node,platform:process.platform,arch:process.arch,sandboxDisabledForRootTest:process.argv.includes('--no-sandbox')},null,2));
  console.log('NETPIN_DESKTOP_SMOKE_PASS',JSON.stringify(result));return result;
};
