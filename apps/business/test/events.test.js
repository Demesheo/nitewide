import test from 'node:test';
import assert from 'node:assert/strict';
import { eventPhase, selectEvents, eventTeamRoles, filterEventTeam } from '../src/lib/events.js';
import { editorDraft, eventPayload } from '../src/lib/business.js';

test('event team multiselect offers only present roles and combines selected roles', () => {
  const people = [{role:'Owner'},{role:'Employee'},{role:'Employee'},{role:'Manager'}];
  assert.deepEqual(eventTeamRoles(people).map((r)=>r.id),['Employee','Manager','Owner']);
  assert.equal(filterEventTeam(people,['Employee','Manager']).length,3);
  assert.equal(filterEventTeam(people,[]).length,4);
  assert.equal(filterEventTeam(people,['Promoter']).length,4,'a stale role must not hide the entire new roster');
  assert.deepEqual(eventTeamRoles([]),[]);
});

test('event timelines distinguish live, future, drafts and past in venue time', () => {
  const now = Date.parse('2030-10-01T23:00:00Z');
  const base = {title:'A night',startsAt:'2030-10-01T22:00:00Z',endsAt:'2030-10-02T02:00:00Z',status:'published',location:{timezone:'America/New_York'}};
  assert.equal(eventPhase(base,now),'live');
  assert.equal(eventPhase({...base,status:'draft'},now),'draft');
  assert.equal(eventPhase({...base,endsAt:'2030-10-01T23:00:00Z'},now),'past');
  assert.equal(selectEvents([base],{view:'upcoming',from:'2030-10-01',to:'2030-10-01'},now).length,1);
  assert.equal(selectEvents([base],{view:'past'},now).length,0);
});
test('venue editor uses saved venue location and maps chained tiers to request indexes', () => {
  const draft = editorDraft(null,'org',[{id:'org',location:{city:'Tampa',addressLine1:'10 Main St',timezone:'America/New_York'}}]);
  assert.equal(draft.location.city,'Tampa');
  draft.offerings = [{...draft.offerings[0],clientKey:'early'},{...draft.offerings[0],clientKey:'late',price:20,releaseAfterKey:'early'}];
  const payload = eventPayload(draft);
  assert.equal(payload.offerings[1].releaseAfterIndex,0);
  assert.equal(payload.offerings[1].priceCents,2000);
  const independent = editorDraft({organizationId:null,location:{city:'Miami',timezone:'America/New_York'}},'org',[{id:'org',location:{city:'Tampa'}}]);
  assert.equal(independent.location.city,'Miami');
  const existing = editorDraft({organizationId:'org',location:{city:'Orlando',name:'Existing venue',timezone:'America/New_York'}},'org',[{id:'org',location:{city:'Tampa',timezone:'America/New_York'}}]);
  assert.equal(existing.location.city,'Orlando','editing preserves the selected venue instead of the organization default');
});
