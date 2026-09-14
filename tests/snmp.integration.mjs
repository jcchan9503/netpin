/** Real UDP loopback requests, not mocks. No traffic goes to a user or public network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import snmp from 'net-snmp';
import {collect,OID} from '../app/core/snmp.mjs';
import {probe} from '../app/core/probe.mjs';
import {tables,device,credential,mac} from './fixtures.mjs';
async function freePort() {
  const socket=dgram.createSocket('udp4'); await new Promise((res,rej)=>{socket.once('error',rej);socket.bind(0,'127.0.0.1',res);});
  const port=socket.address().port; await new Promise(r=>socket.close(r));return port;
}
async function agentFixture(legacy=false){
  const port=await freePort(), operations=[];
  const agent=snmp.createAgent({port,address:'127.0.0.1',disableAuthorization:false},(error,data)=>{if(!error)operations.push(data.pdu.type);});
  agent.getAuthorizer().addCommunity(credential.community);
  const user={name:'fixture-user',level:snmp.SecurityLevel.authPriv,authProtocol:snmp.AuthProtocols.sha256,authKey:'fixture-auth-123',privProtocol:snmp.PrivProtocols.aes,privKey:'fixture-priv-123'};
  agent.getAuthorizer().addUser(user);
  const grouped=new Map();
  for(const [key,rows] of Object.entries(tables({legacy}))){
    if(!rows.length)continue;
    const oid=OID[key],root=oid.slice(0,oid.lastIndexOf('.')),column=Number(oid.split('.').at(-1));
    if(!grouped.has(root))grouped.set(root,[]);
    grouped.get(root).push({key,column,rows,type:key==='ipMask'?snmp.ObjectType.IpAddress:Buffer.isBuffer(rows[0].value)?snmp.ObjectType.OctetString:snmp.ObjectType.Integer});
  }
  let sequence=0;
  for(const [oid,columns] of grouped){
    const name='fixtureTable'+sequence++, parts=columns[0].rows[0].index.split('.').length;
    const indexColumns=Array.from({length:parts},(_,i)=>({number:1000+i,name:name+'Index'+i,type:snmp.ObjectType.Integer,maxAccess:snmp.MaxAccess['not-accessible']}));
    agent.getMib().registerProvider({name,type:snmp.MibProviderType.Table,oid,maxAccess:snmp.MaxAccess['read-only'],tableIndex:indexColumns.map(c=>({columnName:c.name})),tableColumns:[...indexColumns,...columns.map(c=>({number:c.column,name:c.key,type:c.type,maxAccess:snmp.MaxAccess['read-only']}))]});
    const indexes=new Set(columns.flatMap(c=>c.rows.map(r=>r.index)));
    for(const index of indexes){const values=columns.map(c=>c.rows.find(r=>r.index===index)?.value??(c.type===snmp.ObjectType.Integer?0:''));agent.getMib().addTableRow(name,[...index.split('.').map(Number),...values]);}
  }
  await new Promise(r=>setTimeout(r,20));
  return {agent,port,operations,user,close:()=>new Promise(r=>agent.close(r))};
}
for(const [version,legacy] of [['2c',false],['1',true],['3',false]]){
  test(`real UDP SNMPv${version}: interfaces, ARP and VLAN/FDB correlation`,{timeout:12000},async()=>{
    const f=await agentFixture(legacy);
    try{
      const c=version==='3'?{version:'3',username:f.user.name,authProtocol:'SHA256',authKey:f.user.authKey,privKey:f.user.privKey}:{...credential,version};
      const s=await collect({...device,port:f.port},c,AbortSignal.timeout(10000));
      assert.equal(s.sections.arp.ok,true);
      assert.equal(s.sections.arp.rows[0]?.mac,mac);
      assert.equal(s.sections.interfaces.rows.find(i=>i.ifIndex===1001)?.description,'测试工位');
      assert.equal(s.sections.fdb.rows[0]?.ifIndex,1001);
      assert.deepEqual(s.sections.fdb.rows[0]?.vlans,[10]);
      assert(f.operations.length>0);assert(!f.operations.includes(snmp.PduType.SetRequest),'collector must never issue SET');
    }finally{await f.close();}
  });
}
test('live UDP wrong credential terminates on cancellation',{timeout:4000},async()=>{
  const f=await agentFixture();
  try{await assert.rejects(collect({...device,port:f.port},{...credential,community:'invalid'},AbortSignal.timeout(200)));}
  finally{await f.close();}
});
test('real local ICMP echo succeeds',{timeout:10000, skip:process.env.NETPIN_SKIP_LIVE_ICMP === '1' ? 'Explicit environment limitation: container lacks ICMP socket permission' : false},async()=>{
  const result=await probe('127.0.0.1',AbortSignal.timeout(8000));assert.equal(result.status,'reply',JSON.stringify(result));
});
