import test from 'node:test';
import assert from 'node:assert/strict';
import {groupTextLayerEntriesIntoBlocks} from '../text-blocks.js';
const item = (text, x, y, width=100, extras={}) => ({text, x, y, width, height:12, fontHeight:12, item:{str:text,hasEOL:true}, ...extras});
test('joins aligned paragraph lines and preserves newlines', () => {
 const blocks=groupTextLayerEntriesIntoBlocks([item('First line',10,10), item('Second line',10,25)]);
 assert.equal(blocks.length,1); assert.equal(blocks[0].text,'First line\nSecond line');
});
test('keeps two columns separate', () => {
 const blocks=groupTextLayerEntriesIntoBlocks([item('Left one',10,10),item('Right one',210,10),item('Left two',10,25),item('Right two',210,25)]);
 assert.deepEqual(blocks.map(b=>b.text),['Left one\nLeft two','Right one\nRight two']);
});
test('separates headings and distant paragraphs', () => {
 const blocks=groupTextLayerEntriesIntoBlocks([item('Heading',10,0,100,{height:22,fontHeight:22}),item('Body',10,35),item('Next paragraph',10,85)]);
 assert.equal(blocks.length,3);
});
test('preserves spaces between fragments', () => {
 const a=item('Hello',10,10,30); a.item.hasEOL=false;
 const b=item('world',44,10,30);
 assert.equal(groupTextLayerEntriesIntoBlocks([b,a])[0].text,'Hello world');
});
const {layoutText}=await import('../text-layout.js');
const font={encodeText:t=>t,widthOfTextAtSize:(t,s)=>t.length*s*.5,heightAtSize:(s,o)=>o?.descender===false?s*.75:s};
test('layout wraps and fits width and height',()=>{
 const result=layoutText({text:'one two three four',fontSize:12,rect:{x:10,y:10,width:45,height:30}},font);
 assert.ok(result.lines.length>1); assert.ok(result.lines.every(l=>l.width<=43));
 assert.ok(result.lines.at(-1).y>=10);
});
test('rotation transforms text baselines',()=>{
 const result=layoutText({text:'Hi',fontSize:12,frame:{x:20,y:100,width:40,height:20,angle:Math.PI/2}},font);
 assert.ok(Math.abs(result.lines[0].x-29)<.001); assert.ok(Math.abs(result.lines[0].y-101)<.001);
});
test('rotated fragments remain separate rather than lose their angle',()=>{
 const a=item('Rotated',10,10,30,{angle:.06});a.item.hasEOL=false;
 const b=item('fragments',41,12,30,{angle:.06});
 const blocks=groupTextLayerEntriesIntoBlocks([a,b]);assert.equal(blocks.length,2);assert.ok(blocks.every(b=>b.angle===.06));
});
