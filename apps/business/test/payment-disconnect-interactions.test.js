import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestServer} from './helpers/vite-server.js';

test('connection warning requires explicit confirmation, blocks unresolved obligations and never treats a lost provider response as disconnected',async()=>{
  const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
  const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/app',pretendToBeVisual:true});
  const values={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,
    HTMLInputElement:dom.window.HTMLInputElement,HTMLButtonElement:dom.window.HTMLButtonElement,HTMLFormElement:dom.window.HTMLFormElement,
    Element:dom.window.Element,Node:dom.window.Node,NodeFilter:dom.window.NodeFilter,DocumentFragment:dom.window.DocumentFragment,
    Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,MutationObserver:dom.window.MutationObserver,
    getComputedStyle:dom.window.getComputedStyle.bind(dom.window),IS_REACT_ACT_ENVIRONMENT:true};
  const originals=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(values)) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  let vite,view;
  try {
    vite=await createTestServer({root,configFile:resolve(root,'vite.config.js'),logLevel:'silent',server:{middlewareMode:true},appType:'custom'});
    const {PaymentConnectionDialog}=await vite.ssrLoadModule('/src/components/PaymentConnectionDialog.jsx');
    const {PaymentAccounts}=await vite.ssrLoadModule('/src/components/PaymentAccounts.jsx');
    const React=await import('react'),{render,screen,waitFor}=await import('@testing-library/react');
    const user=(await import('@testing-library/user-event')).default.setup({document:dom.window.document});
    const account={id:'profile',stripeAccountId:'acct_fixture',name:'Venue merchant',lifecycleState:'active',disconnectStatus:'none'};
    const counts={account,affectedEvents:2,pendingPayments:0,reviewPayments:0,unresolvedRefunds:0,unfulfilledPaidBookings:0,historicalBookings:30,
      blockedReasons:[],providerDisconnectConfigured:true,canDisconnect:true};
    const calls=[],saved=[];let closes=0,fail=true;
    const session={accessToken:'offline'},base='/business/organizations/org/payment-accounts';
    const request=async(path,_session,options={})=>{
      calls.push({path,options});
      if(path.endsWith('disconnect-impact')) return counts;
      return {account:{...account,paymentsDisabledAt:new Date().toISOString(),disconnectStatus:fail?'pending':'disconnected',
        disconnectRequestId:'00000000-0000-4000-8000-000000000010',disconnectErrorCode:fail?'DISCONNECT_UNCONFIRMED':null},retryable:fail};
    };
    const props={account,mode:'disconnect',base,session,request,onClose:()=>closes++,onSaved:a=>saved.push(a)};
    view=render(React.createElement(PaymentConnectionDialog,props),{container:dom.window.document.getElementById('root')});
    await screen.findByText('Saved booking history');
    assert.ok(screen.getByRole('dialog',{name:'Disconnect Stripe account'}));
    assert.equal(screen.getByRole('button',{name:'Disconnect Stripe account'}).disabled,true);
    await user.type(screen.getByLabelText('Reason'),'Leaving this connection');
    assert.equal(screen.getByRole('button',{name:'Disconnect Stripe account'}).disabled,true);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button',{name:'Disconnect Stripe account'}));
    await screen.findByRole('alert');assert.equal(saved[0].disconnectStatus,'pending');assert.equal(closes,0);
    fail=false;await user.click(screen.getByRole('button',{name:'Disconnect Stripe account'}));
    await waitFor(()=>assert.equal(closes,1));
    const mutations=calls.filter(c=>c.options.method==='POST');
    assert.equal(mutations.length,2);
    assert.equal(JSON.parse(mutations[0].options.body).idempotencyKey,JSON.parse(mutations[1].options.body).idempotencyKey,'retry retains one disconnect request');
    assert.equal(JSON.parse(mutations[0].options.body).confirmed,true);
    view.unmount();
    const blocked={...counts,canDisconnect:false,pendingPayments:2,blockedReasons:['Pending payments must finish or expire.']};
    view=render(React.createElement(PaymentConnectionDialog,{...props,request:async()=>blocked}));
    await screen.findByText('Resolve these before disconnecting');
    await user.type(screen.getByLabelText('Reason'),'Closing this profile');await user.click(screen.getByRole('checkbox'));
    assert.equal(screen.getByRole('button',{name:'Disconnect Stripe account'}).disabled,true);
    assert.ok(screen.getByText(/disable new payments now/));view.unmount();
    view=render(React.createElement(PaymentAccounts,{session,organization:{id:'org',canManageFinance:true},request:async()=>({items:[account],total:1,canDisconnectPayments:false})}));
    await screen.findByRole('heading',{name:'Venue merchant'});assert.equal(screen.queryByRole('button',{name:'Disconnect Stripe'}),null);
    assert.equal(screen.queryByRole('button',{name:'Disable new payments'}),null);
  } finally {
    view?.unmount();await vite?.close();
    for(const [key,descriptor] of originals) {if(descriptor) Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
    dom.window.close();
  }
});
