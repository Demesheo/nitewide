import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eventPhase, selectEvents, eventTeamRoles, filterEventTeam, eventTeamSalesSlices } from '../src/lib/events.js';
import { editorDraft, eventPayload, releaseOptions, removeOffering } from '../src/lib/business.js';

test('removing an offering unlinks only its dependents and preserves the original draft', () => {
  const offerings = [{id:'a'}, {clientKey:'b',releaseAfterKey:'a'}, {clientKey:'c',releaseAfterKey:'b'}, {clientKey:'d',releaseAfterKey:'a'}];
  const remaining = removeOffering(offerings,'b');
  assert.deepEqual(remaining,[{id:'a'}, {clientKey:'c',releaseAfterKey:''}, {clientKey:'d',releaseAfterKey:'a'}]);
  assert.equal(offerings[2].releaseAfterKey,'b');
  assert.deepEqual(removeOffering([{id:'last'}],'last'),[]);
});

test('event collection defaults to the earliest event date and time first', () => {
  const component = readFileSync(new URL('../src/components/Events.jsx', import.meta.url), 'utf8');
  assert.match(component, /<EventTable searchable=\{false\} rows=\{rows\} onSelect=\{\(e\) => setSelectedId\(e\.id\)\} onPageChange=\{scrollToCollection\} defaultSort="date" defaultDescending=\{false\}/);
});

test('event team multiselect offers only present roles and combines selected roles', () => {
  const people = [{role:'Owner'},{role:'Employee'},{role:'Employee'},{role:'Manager'}];
  assert.deepEqual(eventTeamRoles(people).map((r)=>r.id),['Employee','Manager','Owner']);
  assert.equal(filterEventTeam(people,['Employee','Manager']).length,3);
  assert.equal(filterEventTeam(people,[]).length,4);
  assert.equal(filterEventTeam(people,['Promoter']).length,4,'a stale role must not hide the entire new roster');
  assert.deepEqual(eventTeamRoles([]),[]);
});

test('event team sales mix reconciles people, direct sales, and unmatched referrals', () => {
  const slices = eventTeamSalesSlices({
    people: [{ userId: 'a', name: 'Alex', salesCents: 5000 }, { userId: 'b', name: 'Blair', salesCents: 0 }],
    channels: [{ name: 'Direct', salesCents: 3000 }, { name: 'Other referral', salesCents: 1000 }],
    summary: { salesCents: 9000 },
  });
  assert.deepEqual(slices.map(({ name, salesCents }) => [name, salesCents]), [['Alex', 5000], ['Direct sales', 3000], ['Other referrals', 1000]]);
  assert.equal(slices.reduce((sum, row) => sum + row.salesCents, 0), 9000);
  assert.deepEqual(eventTeamSalesSlices({ people: [], channels: [], summary: { salesCents: 0 } }).map(({ name, salesCents }) => [name, salesCents]), [['Direct sales', 0]]);
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
test('business editor builds a three-step GA ladder, supports windows, manual close, and package ladders', () => {
  const draft = editorDraft(null, 'org', [{id:'org',location:{city:'Orlando',timezone:'America/New_York'}}]);
  const base = {...draft.offerings[0], clientKey:'ga-10', name:'GA first 50',price:10,quantityTotal:50};
  const middle = {...base,clientKey:'ga-20',name:'GA next 50',price:20,releaseAfterKey:'ga-10',salesStartAt:'2030-10-01T18:00'};
  const final = {...base,clientKey:'ga-40',name:'GA final 100',price:40,quantityTotal:100,releaseAfterKey:'ga-20'};
  const packageFirst = {...base,clientKey:'vip-300',kind:'package',name:'VIP early',price:300,isActive:false};
  const packageNext = {...base,clientKey:'vip-400',kind:'package',name:'VIP later',price:400,releaseAfterKey:'vip-300',salesEndAt:'2030-10-02T00:00'};
  draft.offerings = [base,middle,final,packageFirst,packageNext];
  assert.deepEqual(releaseOptions(draft.offerings,2).map((item)=>item.key),['ga-10','ga-20']);
  assert.deepEqual(releaseOptions(draft.offerings,4).map((item)=>item.key),['vip-300']);
  const payload = eventPayload(draft);
  assert.deepEqual(payload.offerings.map((item)=>item.releaseAfterIndex),[null,0,1,null,3]);
  assert.deepEqual(payload.offerings.slice(0,3).map((item)=>[item.priceCents,item.quantityTotal]),[[1000,50],[2000,50],[4000,100]]);
  assert.equal(payload.offerings[3].isActive,false);
  assert.equal(payload.offerings[1].salesStartAt,'2030-10-01T22:00:00.000Z');
  assert.equal(payload.offerings[4].salesEndAt,'2030-10-02T04:00:00.000Z');
  const edited = editorDraft({organizationId:'org',location:{city:'Orlando',timezone:'America/New_York'},offerings:payload.offerings.map((item,index)=>({...item,id:`tier-${index}`,releaseAfterOfferingId:item.releaseAfterIndex == null ? null : `tier-${item.releaseAfterIndex}`}))},'org',[]);
  assert.equal(edited.offerings[2].releaseAfterKey,'tier-1');
  assert.equal(edited.offerings[3].isActive,false);
});
