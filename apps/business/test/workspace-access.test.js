import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceAccess } from '../src/lib/workspace-access.js';

test('basic employees and event-only promoters receive a personal workspace', () => {
  const employee = { organizations:[{id:'venue',canManage:false}], events:[{id:'event',canManage:false}] };
  const promoter = { organizations:[], events:[{id:'selected',canManage:false}] };
  assert.deepEqual(workspaceAccess(employee,{isInternalAdmin:false}),{canManage:false,ownOnly:true});
  assert.deepEqual(workspaceAccess(promoter,{isInternalAdmin:false}),{canManage:false,ownOnly:true});
});

test('owners, managers, independent creators and admins retain management views', () => {
  assert.equal(workspaceAccess({organizations:[{canManage:true}],events:[]},{}).canManage,true);
  assert.equal(workspaceAccess({organizations:[],events:[{canManage:true}]},{}).canManage,true);
  assert.equal(workspaceAccess({organizations:[],events:[]},{isInternalAdmin:true}).canManage,true);
  assert.equal(workspaceAccess(null,{}).ownOnly,false);
});
