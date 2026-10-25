'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {compare}=require('../release/windows-warning-diff');
test('baseline CryLo warning remains preexisting',()=>{
 const s='src/common/utf8.h:92:19: warning: always true [-Wtype-limits]';
 const r=compare(s,s);assert.equal(r.newDiagnostics.length,0);assert.equal(r.preexistingDiagnostics.length,1);
});
test('new upstream OpenSSL warning requires frozen review',()=>{
 const r=compare('','crypto/bio/bio_sock.c:256:13: warning: overflow [-Woverflow]');
 assert.equal(r.newDiagnostics.length,1);assert.equal(r.mayPublish,false);assert.equal(r.releaseFrozen,true);
});
