import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./web/objects.js',import.meta.url),'utf8');
const {resizeBox}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
assert.deepEqual(resizeBox([20,30,100,50],'se',40,20,[600,800]),[20,30,140,70]);
assert.deepEqual(resizeBox([20,30,100,50],'nw',-10,-20,[600,800]),[10,10,110,70]);
assert.deepEqual(resizeBox([20,30,100,50],'se',50,0,[600,800],true),[20,30,150,75]);
for(const corner of ['nw','ne','sw','se']){
  const [x,y,w,h]=resizeBox([20,30,100,50],corner,1000,-1000,[600,800],true);
  assert.ok(x>=0&&y>=0&&x+w<=600&&y+h<=800,'Signature stays inside page');
  assert.equal(w/h,2,'Signature keeps its aspect ratio');
}
assert.deepEqual(resizeBox([20,30,100,50],'se',-500,-500,[600,800]),[20,30,20,20]);
console.log('Object resizing: bounds, corners, minimum size, and signature proportions passed.');
