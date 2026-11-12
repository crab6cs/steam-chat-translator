import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
// fflate is installed explicitly to keep ZIP creation portable across platforms.
import {zipSync} from 'fflate';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'plugin.json'),'utf8'));
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
if (manifest.version!==pkg.version) throw new Error('Manifest versions differ');
const files={};
for(const file of ['plugin.json','backend/main.lua','.millennium/Dist/index.js','README.md','LICENSE']) {
  files[`${manifest.name}/${file}`]=new Uint8Array(await readFile(path.join(root,file)));
}
await mkdir(path.join(root,'downloads'),{recursive:true});
const zip=zipSync(files,{level:9});
const target=path.join(root,'downloads',`${manifest.name}-${manifest.version}.zip`);
await writeFile(target,zip);
console.log(`Packaged ${Object.keys(files).length} files: ${target}`);
