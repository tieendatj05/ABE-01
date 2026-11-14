import fs from 'node:fs/promises';
import {Presentation,PresentationFile} from 'file:///C:/Users/ASUS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const p=Presentation.create({slideSize:{width:1280,height:720}});
const s=p.slides.add();s.background.fill='#FFFFFF';
const sh=s.shapes.add({geometry:'textbox',position:{left:70,top:45,width:1100,height:100},fill:'none',line:{fill:'none',width:0}});
sh.text='Mã hóa dựa trên thuộc tính trong MedABE';sh.text.style={fontSize:44,typeface:'Arial',color:'#103D3A',bold:true,insets:0};
const t=s.tables.add({rows:3,columns:2,left:70,top:180,width:1140,height:300,columnWidths:[360,780],values:[['Thành phần','Vai trò'],['Thuộc tính','Quyền do các nút ghi nhận'],['Khóa ABE','Vật liệu mật mã gắn GID và epoch']]});
t.cells.block({row:0,column:0,rowCount:3,columnCount:2}).assign({fill:'#F1F6F5',textStyle:{fontSize:25,typeface:'Arial',color:'#103D3A'},margins:{left:18,right:18,top:15,bottom:15}});
t.borders.assign({fill:'#FFFFFF',width:2});
for(let c=0;c<2;c++){t.getCell(0,c).fill='#103D3A';t.getCell(0,c).text.style={fontSize:25,typeface:'Arial',color:'#FFFFFF',bold:true};}
s.speakerNotes.text='Ghi chú thuyết trình bằng tiếng Việt.';
await fs.writeFile('probe.png',new Uint8Array(await (await p.export({slide:s,format:'png',scale:1})).arrayBuffer()));
await (await PresentationFile.exportPptx(p)).save('probe.pptx');
console.log('probe OK');
