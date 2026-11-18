const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

function service(entry, seed = {}, options = {}) {
  let tables = structuredClone({
    couples: { space001: { _id: 'space001', memberIds: ['user-a','user-b'], partnerNotesMigrationVersion: 1 } },
    couple_members: {
      'space001_user-a': { _id: 'space001_user-a', coupleId: 'space001', userId: 'user-a' },
      'space001_user-b': { _id: 'space001_user-b', coupleId: 'space001', userId: 'user-b' },
    }, ...seed,
  })
  let serial = Promise.resolve()
  const removedFiles = []
  const filename = path.join(__dirname, '..', entry, 'index.js')
  const actualRequire = createRequire(filename)
  function collection(name, getTables, tx) {
    function operation(write) { if (!tx) return; if (!write) assert.equal(tx.wrote,false,'transaction reads precede writes'); else tx.wrote=true }
    return {
      doc(id) {
        const docs = () => (getTables()[name] ||= {})
        return {
          async get() { operation(false); const value=docs()[id]; return { data: tx ? structuredClone(value||null) : (value ? [structuredClone(value)] : []) } },
          async set(value) { operation(true); docs()[id]={...structuredClone(value),_id:id}; return {id} },
          async update(value) { operation(true); if(!docs()[id]) return {updated:0}; docs()[id]={...docs()[id],...structuredClone(value)}; return {updated:1} },
          async remove() { operation(true); const deleted=docs()[id]?1:0; delete docs()[id]; return {deleted} },
        }
      },
      where(filter) {
        assert.ok(!tx,'no transaction collection queries')
        let skip=0, limit=100, sort=null
        const query={
          skip(n){skip=n;return query},limit(n){limit=n;return query},
          orderBy(field,dir){sort=[field,dir];return query},
          async get(){ let docs=Object.values(getTables()[name]||{}).filter(d=>Object.entries(filter).every(([k,v])=>d[k]===v)); if(sort) docs=docs.sort((a,b)=>String(a[sort[0]]).localeCompare(String(b[sort[0]]))*(sort[1]==='desc'?-1:1)); return {data:structuredClone(docs.slice(skip,skip+limit))} },
        };return query
      },
    }
  }
  const db={
    collection:n=>collection(n,()=>tables),
    serverDate:()=>new Date().toISOString(),
    runTransaction(callback){
      const pending=serial.then(async()=>{ const snapshot=structuredClone(tables); const tx={wrote:false}; const result=await callback({collection:n=>collection(n,()=>snapshot,tx)}); tables=snapshot; return result })
      serial=pending.catch(()=>{});return pending
    },
  }
  const exports={}
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{
    exports,console:{warn(){},error(){}},
    require(name){if(name!=='@cloudbase/node-sdk') return actualRequire(name);return {SYMBOL_CURRENT_ENV:'test',init:()=>({
      database:()=>db,auth:()=>({getUserInfo:()=>options.auth||{customUserId:'user-a'}}),
      async deleteFile({fileList}) { removedFiles.push([...fileList]); if(options.failFiles) throw Error('storage unavailable'); return {fileList:fileList.map(fileID=>({fileID,code:'SUCCESS'}))} },
    })}},
  },{filename})
  return {async call(action,extra={}){return JSON.parse(JSON.stringify(await exports.main({action,coupleId:'space001',...extra})))}, get tables(){return tables},removedFiles}
}
function archived(kind, doc={}, overrides={}) {
  return {_id:kind+'_item',coupleId:'space001',kind,originalId:'item',doc:{coupleId:'space001',...doc},deletedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30*86400000).toISOString(),...overrides}
}

test('all five kinds restore original author/time/content and retry without overwriting',async()=>{
  const kinds={memory:'memories',wish:'wishes',anniversary:'anniversaries',message:'messages',partner_note:'partner_notes'}
  for(const [kind,collection] of Object.entries(kinds)){
    const item=archived(kind,{text:'saved',createdAt:'2001-02-03T04:05:06Z',createdBy:'user-b',pinned:true})
    const app=service('trashAccess',{trash:{[item._id]:item}})
    assert.equal((await app.call('restore',{trashId:item._id})).ok,true)
    assert.deepEqual(app.tables[collection].item,{...item.doc,_id:'item'})
    assert.equal(app.tables.trash[item._id],undefined)
    assert.equal((await app.call('restore',{trashId:item._id})).ok,true)
  }
})
test('restore protects current content, expired archives and purging archives',async()=>{
  for(const [overrides,code] of [[{},'RESTORE_CONFLICT'],[{expiresAt:'2000-01-01'},'TRASH_EXPIRED'],[{purging:true},'TRASH_PURGING']]){
    const item=archived('partner_note',{text:'old'},overrides)
    const app=service('trashAccess',{trash:{[item._id]:item},partner_notes:code==='RESTORE_CONFLICT'?{item:{_id:'item',coupleId:'space001',text:'current'}}:{}})
    assert.equal((await app.call('restore',{trashId:item._id})).code,code)
    assert.ok(app.tables.trash[item._id])
    if(code==='RESTORE_CONFLICT') assert.equal(app.tables.partner_notes.item.text,'current')
  }
})
test('hidden messages never leak titles through trash or allow restore/purge',async()=>{
  const item=archived('message',{text:'secret',createdBy:'user-b',revealAt:'2099-01-01'})
  const app=service('trashAccess',{trash:{[item._id]:item}})
  assert.deepEqual((await app.call('list')).items,[])
  for(const action of ['restore','purge']) assert.equal((await app.call(action,{trashId:item._id})).code,'FORBIDDEN')
})
test('anonymous, nonmembers and cross-couple archive targets are denied',async()=>{
  const item=archived('partner_note',{}, {coupleId:'other'})
  const app=service('trashAccess',{trash:{[item._id]:item}})
  assert.equal((await app.call('restore',{trashId:item._id})).code,'FORBIDDEN')
  for(const auth of [{isAnonymous:true},{customUserId:'intruder'}]){
    const denied=service('trashAccess',{}, {auth})
    assert.equal((await denied.call('list')).ok,false)
  }
})
test('hidden recent messages do not displace an older visible archive from the list',async()=>{
  const trash={}
  for(let index=0;index<205;index++){
    const item=archived('message',{createdBy:'user-b',text:'hidden',revealAt:'2099-01-01'},{_id:'message_hidden_'+index,originalId:'hidden_'+index})
    trash[item._id]=item
  }
  const visible=archived('partner_note',{text:'visible'},{deletedAt:'2026-10-01T00:00:00Z',expiresAt:'2099-01-01'})
  trash[visible._id]=visible
  const app=service('trashAccess',{trash})
  const result=await app.call('list')
  assert.equal(result.items.length,1)
  assert.equal(result.items[0].title,'visible')
})
test('file deletion failure leaves a nonrestorable archive for safe retry',async()=>{
  const item=archived('memory',{photos:[{fileID:'cloud://original'}]})
  const options={failFiles:true}
  const app=service('trashAccess',{trash:{[item._id]:item}},options)
  assert.equal((await app.call('purge',{trashId:item._id})).ok,false)
  assert.equal(app.tables.trash[item._id].purging,true)
  assert.equal((await app.call('restore',{trashId:item._id})).code,'TRASH_PURGING')
  options.failFiles=false
  assert.equal((await app.call('purge',{trashId:item._id})).ok,true)
  assert.equal(app.tables.trash[item._id],undefined)
  assert.equal((await app.call('purge',{trashId:item._id})).ok,true)
})
test('purge retains files referenced by a live memory or a second archive',async()=>{
  const item=archived('memory',{photos:[{fileID:'cloud://live'},{fileID:'cloud://archived'},{fileID:'cloud://unused'}]})
  const other=archived('memory',{photos:[{fileID:'cloud://archived'}]},{_id:'memory_other',originalId:'other'})
  const app=service('trashAccess',{trash:{[item._id]:item,[other._id]:other},memories:{live:{_id:'live',coupleId:'space001',photos:[{fileID:'cloud://live'}]}}})
  assert.equal((await app.call('purge',{trashId:item._id})).ok,true)
  assert.deepEqual(app.removedFiles,[['cloud://unused']])
})
test('message and reply retries are idempotent, conflicting content is rejected, and deletion cannot be resurrected',async()=>{
  const app=service('messageAccess')
  const input={messageId:'message1',text:'hello',revealAt:null}
  const created=await app.call('create',input)
  assert.equal(created.ok,true,JSON.stringify(created))
  const original=structuredClone(app.tables.messages.message1)
  assert.equal((await app.call('create',input)).ok,true)
  assert.deepEqual(app.tables.messages.message1,original)
  assert.equal((await app.call('create',{...input,text:'different'})).code,'REQUEST_CONFLICT')
  const reply={messageId:'message1',replyId:'reply001',text:'answer'}
  assert.equal((await app.call('reply',reply)).ok,true)
  assert.equal((await app.call('reply',reply)).ok,true)
  assert.equal(app.tables.messages.message1.replies.length,1)
  assert.equal((await app.call('reply',{...reply,text:'other'})).code,'REQUEST_CONFLICT')
  assert.equal((await app.call('delete',{messageId:'message1'})).ok,true)
  assert.equal((await app.call('create',input)).ok,true)
  assert.equal(app.tables.messages.message1,undefined)
  assert.equal(app.tables.trash.message_message1.doc.replies.length,1)
  // Simulate completed physical purge; the private receipt must still prevent resurrection.
  delete app.tables.trash.message_message1
  assert.equal((await app.call('create',input)).ok,true)
  assert.equal(app.tables.messages.message1,undefined)
  assert.equal((await app.call('create',{...input,text:'conflict after purge'})).code,'REQUEST_CONFLICT')
  const receipt=app.tables.message_receipts.message1
  assert.deepEqual(Object.keys(receipt).sort(),['_id','coupleId','createdBy','requestHash'])
  assert.equal(receipt.requestHash.length,64)
})
test('concurrent replies preserve both and recipients cannot reply to locked messages',async()=>{
  const options={auth:{customUserId:'user-a'}}
  const app=service('messageAccess',{},options)
  await app.call('create',{messageId:'message1',text:'secret',revealAt:'2099-01-01'})
  options.auth={customUserId:'user-b'}
  assert.equal((await app.call('reply',{messageId:'message1',replyId:'blocked1',text:'no'})).code,'MESSAGE_LOCKED')
  options.auth={customUserId:'user-a'}
  const results=await Promise.all(['reply-one','reply-two'].map(replyId=>app.call('reply',{messageId:'message1',replyId,text:replyId})))
  assert.ok(results.every(result=>result.ok))
  assert.equal(app.tables.messages.message1.replies.length,2)
})
