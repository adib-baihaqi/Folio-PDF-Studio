import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('./web/signatures.js', import.meta.url), 'utf8');
const { adjustSignaturePixels } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const process = (pixels, settings) => [...adjustSignaturePixels(new Uint8ClampedArray(pixels), settings)];

assert.deepEqual(process([0,0,0,255, 255,255,255,255], {removeBackground:true,backgroundColor:'#000000'}), [0,0,0,0, 255,255,255,255], 'White signature survives black background removal');
assert.deepEqual(process([255,255,255,255, 0,0,0,255], {removeBackground:true,backgroundColor:'#ffffff'}), [255,255,255,0, 0,0,0,255], 'Black signature survives white background removal');
assert.deepEqual(process([32,64,96,255, 255,255,255,180], {removeBackground:true,backgroundColor:'#204060',recolor:true,inkColor:'#000000'}), [0,0,0,0, 0,0,0,180], 'Custom background is removed before ink recoloring, retaining alpha');
assert.deepEqual(process([255,255,255,0, 20,20,20,128], {recolor:true,inkColor:'#ffffff'}), [255,255,255,0, 255,255,255,128], 'White recoloring preserves transparency');
assert.equal(process([45,45,45,255], {removeBackground:true,backgroundColor:'#000000',tolerance:50})[3],0,'Higher tolerance removes near-background pixels');
assert.equal(process([45,45,45,255], {removeBackground:true,backgroundColor:'#000000',tolerance:5})[3],255,'Lower tolerance retains differing pixels');
assert.deepEqual(process([14,93,201,142], {}),[14,93,201,142],'Defaults preserve the original image');
console.log('7 signature color and transparency checks passed.');
