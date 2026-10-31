'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {warnings,compare}=require('../release/windows-warning-diff');
test('preexisting CryLo warning stays in baseline',()=>{
 const s='2026-10-29T03:46:01.000Z D:/a/CryLo/CryLo/src/common/utf8.h:92:19: warning: always true [-Wtype-limits]';
 const r=compare(s,s);assert.equal(r.newDiagnostics.length,0);assert.equal(r.preexistingDiagnostics.length,1);
 assert.equal(r.currentDiagnostics[0].key,'compiler:src/common/utf8.h:always true [-Wtype-limits]');
});
test('new OpenSSL warning requires frozen review',()=>{
 const r=compare('','crypto/bio/bio_sock.c:256:13: warning: overflow [-Woverflow]');
 assert.equal(r.newDiagnostics.length,1);assert.equal(r.mayPublish,false);assert.equal(r.releaseFrozen,true);
});
test('CMake, Python, Boost and missing wallet fixtures are captured',()=>{
 const s=[
 'CMake Warning (deprecated) at CMakeLists.txt:29 (cmake_minimum_required):',
 'CMake Warning (author) at CMakeLists.txt:47 (project):',
 "ModuleNotFoundError: No module named 'requests'",
 'C:/msys64/mingw64/include/boost/variant/detail/initializer.hpp:108:17: warning: may be used uninitialized [-Wmaybe-uninitialized]',
 'D:/a/CryLo/CryLo/tests/unit_tests/node_server.cpp:524:87: warning: bad construction [-Wunused-value]',
 'NOTICE: 3 historical Monero wallet tests remain unvalidated (missing original .keys fixture).',
 'Monero crypto autodetect failed to find any libraries for target platform',
 'Could NOT find Readline (missing: Readline_INCLUDE_DIR)',
 'ccache NOT found! Please install it for faster rebuilds.'
 ].join('\n');
 const w=warnings(s);assert.equal(Object.keys(w).length,9);
 assert.equal(w['cmake:deprecated:CMakeLists.txt:29'],1);
 assert.equal(w['cmake:author:CMakeLists.txt:47'],1);
 assert.equal(w['python-missing-module:requests'],1);
 assert.equal(w['test-coverage:historical-wallet-fixture-missing'],1);
 assert.ok(Object.keys(w).some(k=>k.includes('boost/variant/detail/initializer.hpp')));
});
test('npm deprecations and MSYS2 notices are distinct',()=>{
 const w=warnings('npm warn deprecated glob@7.2.3: old\nwarning: tar-1.35-3 is up to date -- skipping');
 assert.equal(w['npm-deprecated:glob@7.2.3'],1);
 assert.equal(w['package-warning:tar-1.35-3 is up to date -- skipping'],1);
});
test('runner path and timestamps do not invent warnings',()=>{
 const a='2026-10-29T00:01:02Z D:/a/CryLo/CryLo/tests/unit_tests/node_server.cpp:524:4: warning: may be used uninitialized [-Wmaybe-uninitialized]';
 const b='2026-10-29T03:03:09Z E:/w/CryLo/tests/unit_tests/node_server.cpp:524:4: warning: may be used uninitialized [-Wmaybe-uninitialized]';
 assert.equal(compare(a,b).newDiagnostics.length,0);
});
