import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const original='e36a45fab689b959ab96bf9f8c172a4635655203';
const additions=await readFile(new URL('tests/fixtures/aud02-acceptance-cases.js',import.meta.url),'utf8');
for(const mode of ['original','corrected']) {
  let source=mode==='original'
    ? execFileSync('git',['show',`${original}:erp-james-unico/validate-aud02-sales-inbox.mjs`],{encoding:'utf8'})
    : await readFile(new URL('validate-aud02-sales-inbox.mjs',import.meta.url),'utf8');
  source=source.replace("import assert from 'node:assert/strict';",`import assert from 'node:assert/strict';\nimport {execFileSync} from 'node:child_process';\nconst originalMode=${mode==='original'};`);
  const read=mode==='original'
    ? `const read=async name=>execFileSync('git',['show',${JSON.stringify(original+':erp-james-unico/')}+name],{encoding:'utf8'});`
    : `const read=name=>readFile(new URL(name,${JSON.stringify(import.meta.url)}),'utf8');`;
  source=source.replace(/const read = name=>.*;/,read);
  source=source.slice(0,source.indexOf('console.log(JSON.stringify({result:'));
  try { await import('data:text/javascript;base64,'+Buffer.from(source+'\n'+additions).toString('base64')); }
  catch(error) { console.error(JSON.stringify({mode,code:error.code,message:error.message,actual:error.actual,expected:String(error.expected)},null,2));process.exitCode=1;break; }
}
