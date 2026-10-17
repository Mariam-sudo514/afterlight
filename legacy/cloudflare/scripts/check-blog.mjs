import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const require = createRequire(realpathSync('node_modules/drizzle-kit/bin.cjs'));
const { build } = require('esbuild');
const sql = new DatabaseSync(':memory:');
sql.exec(await readFile('drizzle/0000_flimsy_orphan.sql','utf8'));
const db = {
  prepare(query) {
    const statement = sql.prepare(query);
    return { bind(...values) { return {
      async first(){return statement.get(...values)??null;},
      async all(){return {results:statement.all(...values)};},
      async run(){const r=statement.run(...values);return {meta:{changes:r.changes}};},
    }; }, async all(){return {results:statement.all()};} };
  },
  async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}},
};
const objects=new Map();
const bucket={async put(key,bytes,options){objects.set(key,{bytes,options});},async get(key){const object=objects.get(key);return object?{body:object.bytes,httpMetadata:object.options.httpMetadata}:null;},async delete(key){objects.delete(key);}};
globalThis.__testBindings={DB:db,BUCKET:bucket,EDITOR_EMAIL:'owner@example.test'};
globalThis.__testIdentity=null;
const dir=process.cwd()+'/.sites-runtime/blog-check';await mkdir(dir,{recursive:true});
await build({stdin:{contents:`export * from './lib/server';export * from './lib/content';export * from './lib/image-format';export {RichText} from './components/rich-text';export {Footer} from './components/site-chrome';export {POST as post,GET as list} from './app/api/admin/posts/route';export {POST as upload} from './app/api/admin/uploads/route';export {GET as image} from './app/media/[key]/route';`,resolveDir:process.cwd()},outfile:dir+'/check.mjs',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'test-bindings',setup(build){build.onResolve({filter:/^(cloudflare:workers|.*chatgpt-auth)$/},args=>({path:args.path,namespace:'test'}));build.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__testBindings;':'export const getChatGPTUser=async()=>globalThis.__testIdentity;'}));}}]});
const app=await import(pathToFileURL(dir+'/check.mjs'));
let passed=0;async function check(name,work){await work();passed++;console.log(`OK ${name}`);}
const identity={userId:'site-owner-id',email:'owner@example.test',displayName:'Owner',fullName:null};
const payload={id:'test-story',slug:'test-story',category:'analysis',status:'draft',cover:'/assets/archive.webp',coverKind:'illustration',ru:{title:'История для проверки',excerpt:'Короткое описание материала',body:'Проверяем хранение и публикацию статьи на двух языках.',coverCaption:'Иллюстрация: архивные материалы.'},en:{title:'A test story',excerpt:'A brief description of the story',body:'Checking durable storage and publication in two languages.',coverCaption:'Illustration: archival material.'},version:0};
const mutation=(data,origin=app.SITE_ORIGIN)=>new Request(app.SITE_ORIGIN+'/api/admin/posts',{method:'POST',headers:{origin,'Content-Type':'application/json','X-Afterlight-Editor':'1'},body:JSON.stringify(data)});
await check('Anonymous editor APIs deny access',async()=>assert.equal((await app.list()).status,403));
await check('Unlisted signed-in visitor cannot claim editor',async()=>{globalThis.__testIdentity={...identity,userId:'stranger',email:'other@example.test'};assert.equal(await app.editorIdentity(),null);assert.equal(sql.prepare("SELECT count(*) n FROM settings WHERE key='editor_user_id'").get().n,0);});
await check('Configured owner is bound to stable Site identity',async()=>{globalThis.__testIdentity=identity;assert.equal((await app.editorIdentity()).userId,identity.userId);globalThis.__testIdentity={...identity,userId:'other-id'};assert.equal(await app.editorIdentity(),null);globalThis.__testIdentity=identity;});
await check('Cross-origin writes rejected before modification',async()=>assert.equal((await app.post(mutation(payload,'https://evil.example'))).status,403));
await check('Draft save persists both versions and remains private',async()=>{const response=await app.post(mutation(payload));assert.equal(response.status,200);payload.version=(await response.json()).post.version;assert.equal(await app.publishedPost(payload.slug),null);assert.ok(!(await app.listPosts()).some(p=>p.id===payload.id));});
await check('Incomplete translation cannot be published',async()=>assert.equal((await app.post(mutation({...payload,status:'published',en:{...payload.en,body:''}}))).status,400));
await check('Publish serves complete Russian and English text',async()=>{const response=await app.post(mutation({...payload,status:'published'}));assert.equal(response.status,200);payload.version=(await response.json()).post.version;payload.status='published';const stored=await app.publishedPost(payload.slug);assert.equal(stored.ru.title,payload.ru.title);assert.equal(stored.en.body,payload.en.body);});
await check('Concurrent saves have one winner and preserve its content',async()=>{const a={...payload,ru:{...payload.ru,title:'First concurrent title'}},b={...payload,ru:{...payload.ru,title:'Second concurrent title'}};const results=await Promise.all([app.post(mutation(a)),app.post(mutation(b))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const saved=(await results.find(r=>r.status===200).json()).post;Object.assign(payload,saved);assert.equal((await app.publishedPost(payload.slug)).ru.title,saved.ru.title);});
await check('Saved URLs cannot change and duplicate URLs are rejected',async()=>{assert.equal((await app.post(mutation({...payload,slug:'changed-slug'}))).status,400);assert.equal((await app.post(mutation({...payload,id:'second-id',version:0}))).status,409);});
await check('Unpublishing removes story from public lookup',async()=>{const response=await app.post(mutation({...payload,status:'draft'}));assert.equal(response.status,200);Object.assign(payload,(await response.json()).post);assert.equal(await app.publishedPost(payload.slug),null);});
await check('Raw HTML and unsafe links cannot execute',async()=>{const rendered=renderToStaticMarkup(createElement(app.RichText,{body:'<img src=x onerror=alert(1)>\n\n[bad](javascript:alert)\n\n[good](https://example.com)'}));assert.ok(!rendered.includes('<img'));assert.ok(!rendered.includes('href="javascript:'));assert.ok(rendered.includes('href="https://example.com/"'));});
await check('Truncated images and unsafe cover URLs rejected',async()=>{assert.equal(app.imageFormat(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])),null);assert.equal(app.postSchema.safeParse({...payload,cover:'javascript:alert(1)'}).success,false);const response=await app.upload(new Request(app.SITE_ORIGIN+'/api/admin/uploads',{method:'POST',headers:{origin:app.SITE_ORIGIN,'X-Afterlight-Editor':'1'},body:'<svg onload="alert(1)"></svg>'}));assert.equal(response.status,400);});
await check('Oversize upload fails before storage',async()=>{const response=await app.upload(new Request(app.SITE_ORIGIN+'/api/admin/uploads',{method:'POST',headers:{origin:app.SITE_ORIGIN,'X-Afterlight-Editor':'1','Content-Length':'6000000'},body:'small'}));assert.equal(response.status,413);assert.equal(objects.size,0);});
await check('Uploaded cover is private until its story is published',async()=>{const bytes=await readFile('public/assets/house.webp');const response=await app.upload(new Request(app.SITE_ORIGIN+'/api/admin/uploads',{method:'POST',headers:{origin:app.SITE_ORIGIN,'X-Afterlight-Editor':'1'},body:bytes}));assert.equal(response.status,201);payload.cover=(await response.json()).url;const key=payload.cover.slice(7),context={params:Promise.resolve({key})},request=new Request(app.SITE_ORIGIN+payload.cover);globalThis.__testIdentity=null;assert.equal((await app.image(request,context)).status,404);globalThis.__testIdentity=identity;assert.equal((await app.image(request,context)).status,200);const saved=await app.post(mutation({...payload,status:'published'}));assert.equal(saved.status,200);Object.assign(payload,(await saved.json()).post);globalThis.__testIdentity=null;assert.equal((await app.image(request,context)).status,200);globalThis.__testIdentity=identity;const unpublished=await app.post(mutation({...payload,status:'draft'}));assert.equal(unpublished.status,200);Object.assign(payload,(await unpublished.json()).post);globalThis.__testIdentity=null;assert.equal((await app.image(request,context)).status,404);globalThis.__testIdentity=identity;});
await check('Valid long bilingual articles fit the bounded API',async()=>{const response=await app.post(mutation({...payload,ru:{...payload.ru,body:'я'.repeat(180000)},en:{...payload.en,body:'a'.repeat(180000)}}));assert.equal(response.status,200);});
await check('HTML language follows public and editor URLs',async()=>{assert.equal(app.localeFromUrl(new URL(app.SITE_ORIGIN+'/en/articles/test')),'en');assert.equal(app.localeFromUrl(new URL(app.SITE_ORIGIN+'/ru/articles/test')),'ru');assert.equal(app.localeFromUrl(new URL(app.SITE_ORIGIN+'/admin?lang=en')),'en');});
await check('Editor link is emitted only for the owner in both languages',async()=>{for(const locale of ['ru','en']){globalThis.__testIdentity=null;assert.ok(!renderToStaticMarkup(await app.Footer({locale})).includes('/admin'));globalThis.__testIdentity={...identity,userId:'other-visitor',email:'visitor@example.test'};assert.ok(!renderToStaticMarkup(await app.Footer({locale})).includes('/admin'));assert.equal((await app.list()).status,403);globalThis.__testIdentity=identity;assert.ok(renderToStaticMarkup(await app.Footer({locale})).includes(`/admin?lang=${locale}`));}});
console.log(`Passed ${passed} checks against the real SQLite schema and application handlers.`);sql.close();
