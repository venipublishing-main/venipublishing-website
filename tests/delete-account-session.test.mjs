import {strict as assert} from 'node:assert';
import {registerHooks} from 'node:module';
import test from 'node:test';

// Exercise the actual Edge handler. All clients and deletion calls are in-memory spies.
test('only a provider-verified user with a confirmed direct Account session reaches deletion', async () => {
  let handler, verdict, verified, adminCalls, deleted;
  const userId = 'synthetic-user';
  globalThis.Deno = {env:{get: name => name}, serve: fn => {handler=fn;}};
  globalThis.createEdgeTestClient = (_url, key) => {
    if (key === 'SUPABASE_SERVICE_ROLE_KEY') {
      adminCalls++;
      return {auth:{admin:{deleteUser: async id => {deleted.push(id); return {error:null};}}}};
    }
    return {auth:{getUser:async () => ({data:{user:verified ? {id:userId} : null}})},
      rpc:async name => {assert.equal(name,'veni_account_is_direct_session'); return verdict;}};
  };
  const hooks = registerHooks({resolve(spec, context, next) {
    if (spec === 'jsr:@supabase/supabase-js@2') {
      return {shortCircuit:true,url:'data:text/javascript,export const createClient=globalThis.createEdgeTestClient'};
    }
    if (spec === 'jsr:@supabase/functions-js/edge-runtime.d.ts') return {shortCircuit:true,url:'data:text/javascript,export {}'};
    return next(spec,context);
  }});
  try {
    await import('../supabase/functions/delete-account/index.ts');
    for (const [user, result, expected] of [
      [false,{data:true},401],[true,{data:false},403],[true,{error:{message:'unavailable'}},403],
      [true,{data:null},403],[true,{data:true},200]
    ]) {
      verified=user; verdict=result; adminCalls=0; deleted=[];
      const response=await handler(new Request('http://localhost/delete-account',{method:'POST',headers:{Authorization:'Bearer synthetic'}}));
      assert.equal(response.status,expected);
      assert.equal(adminCalls,expected===200 ? 1 : 0);
      assert.deepEqual(deleted,expected===200 ? [userId] : []);
    }
  } finally {
    hooks.deregister();
    delete globalThis.Deno;
    delete globalThis.createEdgeTestClient;
  }
});
