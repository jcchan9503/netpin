import { OID } from '../app/core/snmp.mjs';
export const mac = '02:11:22:33:44:55';
export const device = { id:'r', name:'Fixture router', host:'127.0.0.1', port:1161, kind:'l3', branch:'fixture', space:'test', credentialId:'c', context:'', uplinks:[1024] };
export const net = { id:'n', name:'Test network', network:'192.0.2.0', prefix:24, gateway:'192.0.2.1', branch:'fixture', space:'test', vlan:10, arpSources:['r'], switches:['s'], start:'192.0.2.21', end:'192.0.2.23', exclusions:[] };
export const credential = { id:'c', name:'fixture-only', version:'2c', community:'netpin-test-only' };
export function tables({ legacy = false } = {}) {
  const data = Object.fromEntries(Object.keys(OID).map(k => [k, []]));
  const put = (key, idx, value) => data[key].push({index:idx, value});
  for (const i of [110,1001,1024]) {
    put('ifDescr',String(i),Buffer.from('Ethernet')); put('ifName',String(i),Buffer.from(i===110?'Vlan10':i===1001?'Gi0/1':'Gi0/24'));
    put('ifAlias',String(i),Buffer.from(i===110?'办公网关':i===1001?'测试工位':'下联交换机')); put('ifAdmin',String(i),1); put('ifOper',String(i),1); put('ifType',String(i),6);
  }
  put('ipIf','192.0.2.1',110); put('ipMask','192.0.2.1','255.255.255.0');
  const idx = legacy ? '110.192.0.2.21' : '110.1.4.192.0.2.21';
  put(legacy?'arpOld':'arp',idx,Buffer.from('021122334455','hex'));
  put(legacy?'arpOldType':'arpType',idx,3); if (!legacy) put('arpState',idx,6);
  put('bridgeIf','7',1001); put('bridgeIf','24',1024);
  put('qPort','300.2.17.34.51.68.85',7); put('qState','300.2.17.34.51.68.85',3);
  put('vlanFdb','0.10',300); // FDB ID 300 deliberately differs from VLAN 10.
  return data;
}
export function factory(data = tables(), failures = new Set()) {
  const calls = [], adapter = { async walk(root) { const name=Object.keys(OID).find(k=>OID[k]===root); calls.push(name); if(failures.has(name)) throw Error('fixture transport failure'); return data[name] || []; }, close() { adapter.closed=true; } };
  return { calls, adapter, open: async()=>adapter };
}
export function snapshot(rows = {}) {
  const at = new Date().toISOString();
  return {at, warnings:[], tables:{}, sections:Object.fromEntries(['interfaces','arp','fdb'].map(k=>[k,{ok:true,stale:false,at,rows:rows[k]||[]}]))};
}
export const memorySecrets = () => {
  const values=new Map(); let seq=0;
  return { async seal(value) { const ref=String(++seq); values.set(ref,value); return {storage:'session',ref}; }, async open(envelope) { if(!values.has(envelope.ref)) throw Error('会话凭据已失效'); return values.get(envelope.ref); } };
};
