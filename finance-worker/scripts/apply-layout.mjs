import {readFile,writeFile} from 'node:fs/promises';
import {applyLayoutHtml,applyLayoutJavaScript} from './ui-layout.mjs';
for(const [name,transform]of [['index.html',applyLayoutHtml],['app.js',applyLayoutJavaScript]]){
  const file=new URL('../public/'+name,import.meta.url);
  await writeFile(file,transform(await readFile(file,'utf8')));
}
console.log('Applied Finance workspace presentation.');
