import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardedAccountDeletion } from '../../supabase/functions/_shared/delete-account-guard.mjs';

const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'self@example.invalid' };
const body = { confirmation: 'DELETE MY ACCOUNT', password: 'this-is-a-synthetic-password' };
function harness(changes={}) {
  const calls=[];
  const defaults={
    enabled:'enabled', user, requestBody:body,
    checkActiveSession:async()=>{calls.push('session');return {data:true,error:null};},
    runPreflight:async()=>{calls.push('preflight');return {data:'RESERVE_CLEAR',error:null};},
    reauthenticate:async(email,password)=>{calls.push('password');assert.equal(email,user.email);assert.equal(password,body.password);return {userId:user.id,hasSession:true,error:null};},
    deleteAuthenticatedUser:async(id)=>{calls.push('hard-delete');assert.equal(id,user.id);return {error:null};},
  };
  return {calls, run:()=>guardedAccountDeletion({...defaults,...changes})};
}

test('disposable Website-only account requires two Reserve checks and fresh password, then deletes its own identity',async()=>{
  const h=harness(); const result=await h.run();
  assert.deepEqual(result,{status:200,body:{deleted:true}});
  assert.deepEqual(h.calls,['session','preflight','password','session','preflight','hard-delete']);
});

test('unset flag fails CLOSED, including with clean Reserve state',async()=>{
  for(const enabled of [undefined,'disabled','true','']) {
    const h=harness({enabled});const result=await h.run();
    assert.equal(result.status,503);assert.deepEqual(h.calls,[]);
  }
});

test('missing account and malformed or cross-user inputs cannot delete',async()=>{
  const unauth=harness({user:null});assert.equal((await unauth.run()).status,401);
  assert.deepEqual(unauth.calls,[]);
  for(const requestBody of [null,{},[],{confirmation:'DELETE MY ACCOUNT'},
    {confirmation:'DELETE MY ACCOUNT',password:''},{confirmation:'delete my account',password:'valid'},
    {...body,userId:'other'},{...body,id:user.id},'DELETE MY ACCOUNT']) {
    const h=harness({requestBody});const result=await h.run();
    assert.equal(result.status,400);assert.deepEqual(h.calls,[]);
  }
});

test('Reserve owner, staff, retained identity and anonymous claim block before password',async()=>{
  for(const [state,expectedCode] of [
    ['OWNER_TRANSFER_REQUIRED','RESERVE_OWNER_TRANSFER_REQUIRED'],
    ['RESERVE_HISTORY_REVIEW_REQUIRED','RESERVE_RECORDS_REVIEW_REQUIRED'],
    ['REAUTH_REQUIRED','REAUTHENTICATION_REQUIRED'],
  ]) {
    const h=harness({runPreflight:async()=>{h.calls.push('preflight');return {data:state,error:null};}});
    const result=await h.run();assert.equal(result.body.code,expectedCode);
    assert.deepEqual(h.calls,['session','preflight']);
  }
});

test('RPC exception, errors and unknown statuses fail closed',async()=>{
  for(const runPreflight of [async()=>{throw Error('down');},
    async()=>({data:'RESERVE_CLEAR',error:Error('denied')}),async()=>({data:null,error:null})]) {
    const h=harness({runPreflight});const result=await h.run();
    assert.equal(result.status,503);assert.deepEqual(h.calls,['session']);
  }
});

test('password failure, wrong account, missing fresh session and verifier error deny delete',async()=>{
  for(const reauthenticate of [
    async()=>({userId:user.id,hasSession:false,error:null}),
    async()=>({userId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',hasSession:true,error:null}),
    async()=>({userId:user.id,hasSession:true,error:Error('bad password')}),
    async()=>{throw Error('auth down');},
  ]) {
    const h=harness({reauthenticate});const result=await h.run();
    assert.equal(result.status,401);assert.deepEqual(h.calls,['session','preflight']);
  }
});

test('password-less identity fails closed until an OAuth step-up path is built',async()=>{
  const h=harness({user:{id:user.id,email:null}});
  const result=await h.run();assert.equal(result.body.code,'PASSWORD_REAUTH_UNAVAILABLE');
  assert.deepEqual(h.calls,['session','preflight']);
});

test('ownership or history added after password verification blocks at final preflight',async()=>{
  for(const state of ['OWNER_TRANSFER_REQUIRED','RESERVE_HISTORY_REVIEW_REQUIRED']) {
    let n=0;
    const h=harness({runPreflight:async()=>{h.calls.push('preflight');return {data:++n===1?'RESERVE_CLEAR':state,error:null};},
      reauthenticate:async()=>{h.calls.push('password');return {userId:user.id,hasSession:true,error:null};}});
    const result=await h.run();assert.equal(result.status,409);
    assert.deepEqual(h.calls,['session','preflight','password','session','preflight']);
  }
});

test('final preflight exception fails closed despite successful password verification',async()=>{
  let n=0;
  const h=harness({runPreflight:async()=>{h.calls.push('preflight');if(++n>1)throw Error('down');return {data:'RESERVE_CLEAR'};}});
  const result=await h.run();assert.equal(result.status,503);
  assert.deepEqual(h.calls,['session','preflight','password','session','preflight']);
});

test('admin delete errors never report success',async()=>{
  for(const deleteAuthenticatedUser of [async()=>({error:Error('FK RESTRICT')}),async()=>{throw Error('down');}]) {
    const h=harness({deleteAuthenticatedUser});const result=await h.run();
    assert.equal(result.status,500);assert.equal(result.body.code,'ACCOUNT_DELETION_FAILED');
    assert.deepEqual(h.calls,['session','preflight','password','session','preflight']);
  }
});

test('missing, unavailable, throwing or ambiguous session checker fails closed',async()=>{
  for (const checkActiveSession of [undefined,
    async()=>({data:null,error:null}),
    async()=>({data:true,error:Error('DB unreachable')}),
    async()=>({data:'true',error:null}),
    async()=>{throw Error('RPC unavailable');}]) {
    const h=harness({checkActiveSession});
    const result=await h.run();
    assert.equal(result.status,503);
    assert.equal(result.body.code,'ACCOUNT_SESSION_CHECK_UNAVAILABLE');
    assert.deepEqual(h.calls,[],'No password, business RPC or admin action after unverifiable session');
  }
});

test('signed token from revoked session is not sufficient for account deletion',async()=>{
  const h=harness({checkActiveSession:async()=>({data:false,error:null})});
  const result=await h.run();
  assert.equal(result.status,401);
  assert.equal(result.body.code,'ACCOUNT_SESSION_NOT_ACTIVE');
  assert.deepEqual(h.calls,[]);
});

test('revocation of requesting session during password step-up stops final deletion',async()=>{
  let checks=0;
  const h=harness({checkActiveSession:async()=>{
    h.calls.push('session');return {data:++checks===1,error:null};
  }});
  const result=await h.run();
  assert.equal(result.status,401);
  assert.equal(result.body.code,'ACCOUNT_SESSION_NOT_ACTIVE');
  assert.deepEqual(h.calls,['session','preflight','password','session']);
});
