import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('Business recovery catches render and lazy failures, exposes no error data, and reloads only on request', async () => {
  const rootPath = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/sign-in?returnTo=%2Fapp#resume',pretendToBeVisual:true });
  const values = {window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,
    Node:dom.window.Node,Event:dom.window.Event,MouseEvent:dom.window.MouseEvent,IS_REACT_ACT_ENVIRONMENT:true};
  const originals = new Map(Object.keys(values).map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const [key,value] of Object.entries(values)) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const priorError = console.error; const logs = []; console.error = (...args) => {logs.push(args);};
  let vite,root;
  try {
    const {createTestServer} = await import('./helpers/vite-server.js');
    vite = await createTestServer({configFile:resolve(rootPath,'vite.config.js'),root:rootPath,logLevel:'silent',server:{middlewareMode:true},appType:'custom'});
    const {default:AppErrorBoundary} = await vite.ssrLoadModule('/src/components/AppErrorBoundary.jsx');
    const React = await import('react'); const {createRoot} = await import('react-dom/client');
    const {getByRole,queryByRole} = await import('@testing-library/dom');
    let reloads = 0,caught = 0,loadAttempts = 0;
    const privateMarker = 'synthetic-password-token-payload-do-not-expose';
    const session = JSON.stringify({accessToken:'synthetic-session',expiresAt:'2030-10-01'});
    dom.window.sessionStorage.setItem('nitewide.business.session',session);
    root = createRoot(dom.window.document.getElementById('root'),{onCaughtError:() => {caught += 1;}});
    const boundary = child => React.createElement(AppErrorBoundary,{onReload:() => {reloads += 1;}},child);
    const url = dom.window.location.href;

    await React.act(async () => root.render(boundary(React.createElement('form',null,React.createElement('input',{type:'password','aria-label':'Password',defaultValue:privateMarker})))));
    // A generic window/network error is outside this boundary's scope. It must
    // not remount a healthy sign-in form or wipe its controlled input values.
    dom.window.dispatchEvent(new dom.window.ErrorEvent('error',{message:privateMarker}));
    assert.equal(queryByRole(dom.window.document.body,'heading',{name:'This page couldn’t open'}),null);
    assert.equal(dom.window.document.querySelector('input').value,privateMarker);
    assert.equal(reloads,0);

    function BrokenRoute() {throw new Error(privateMarker);}
    await React.act(async () => root.render(boundary(React.createElement(BrokenRoute))));
    assert.ok(getByRole(dom.window.document.body,'main'));
    assert.ok(getByRole(dom.window.document.body,'alert'));
    assert.equal(dom.window.document.activeElement,getByRole(dom.window.document.body,'heading',{name:'This page couldn’t open'}));
    assert.equal(dom.window.document.body.textContent.includes(privateMarker),false);
    assert.equal(reloads,0); assert.equal(caught,1);
    assert.equal(dom.window.sessionStorage.getItem('nitewide.business.session'),session); assert.equal(dom.window.location.href,url);
    await React.act(async () => getByRole(dom.window.document.body,'button',{name:'Reload page'}).click());
    assert.equal(reloads,1); assert.equal(dom.window.location.href,url); assert.equal(logs.length,0);
    await React.act(async () => root.unmount());

    const FailedChunk = React.lazy(() => {loadAttempts += 1;return Promise.reject(new Error(privateMarker));});
    root = createRoot(dom.window.document.getElementById('root'),{onCaughtError:() => {caught += 1;}});
    await React.act(async () => root.render(boundary(React.createElement(React.Suspense,{fallback:React.createElement('p',null,'Opening your workspace…')},React.createElement(FailedChunk)))));
    assert.ok(getByRole(dom.window.document.body,'button',{name:'Reload page'}));
    assert.equal(loadAttempts,1); assert.equal(reloads,1); assert.equal(caught,2);
    assert.equal(dom.window.document.body.textContent.includes(privateMarker),false);
    assert.equal(dom.window.sessionStorage.getItem('nitewide.business.session'),session); assert.equal(logs.length,0);
  } finally {
    if (root) {const React = await import('react');await React.act(async () => root.unmount());}
    if (vite) await vite.close();
    console.error = priorError;
    for (const [key,descriptor] of originals) {if (descriptor) Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
    dom.window.close();
  }
});
