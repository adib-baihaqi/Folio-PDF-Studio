import { ObjectEditor } from './objects.js';
import { loadSignature, saveSignature, removeSignature, prepareSignature } from './signatures.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let doc=null,page=0,mode='edit',tool='select',zoom=1,selected=new Set(),dragPage=null,details=null,start=null,busy=false;
let signatureTemplate=null, signatureStyle='image';
const objects=new ObjectEditor({host:$('#page-wrap'),state:()=>({page,zoom,bounds:doc?.dimensions[page]||[595,842]}),changed:updateObjectStatus});
const tools={edit:[['select','↖','Select & read'],['text','T','Add text'],['replace','✎','Edit existing text'],['image','▧','Add image'],['highlight','▰','Highlight'],['note','☷','Comment'],['signature','〰','Sign document'],['rectangle','□','Draw rectangle'],['redact','▣','Redact'],['crop','⌗','Crop page'],['form','☑','Fill forms']],organize:[['merge','⊞','Merge PDFs'],['extract','⇱','Extract pages'],['split','◫','Split PDF'],['rotate','↻','Rotate selected'],['duplicate','▱','Duplicate selected'],['delete','×','Delete selected'],['blank','＋','Insert blank page'],['watermark','W','Add watermark'],['numbers','#','Page numbers']],convert:[['pdf','↓','Download PDF'],['compress','⇲','Optimize PDF'],['png','▧','Export images'],['textExport','T','Export text'],['protect','♧','Password protect']]};
const descriptions={select:'Browse your pages. Switch to Organize pages to rearrange them.',text:'Click or draw a text box, type directly on the page, then drag its corners to resize. Use Move to reposition.',replace:'Click a text area to replace its content. Uses a standard font and white background; layout may change.',image:'Drag a box on the page, then choose a PNG or JPEG.',highlight:'Drag across the area you want to highlight.',note:'Click anywhere on the page to add a PDF comment.',signature:'Add your saved signature, drag it to position, and resize using the corner handles.',rectangle:'Drag on the page to draw a rectangle.',redact:'Drag over content to permanently remove it from the exported PDF. Review the result before sharing.',crop:'Drag to choose the visible page area. Cropping hides content; it does not securely remove it.',form:'Fill supported interactive form fields on this page.'};
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',5500)}
function signatureImage(template, className='signature-preview') {
  const img=document.createElement('img');
  img.className=className;
  img.alt='Signature template preview';
  img.src=URL.createObjectURL(template.blob);
  img.onload=()=>URL.revokeObjectURL(img.src);
  return img;
}
function renderSignatureOptions() {
  const options=$('#options');
  const style=document.createElement('select');
  for(const [value,text] of [['image','My signature image'],['typed','Type a signature']]) {
    const option=document.createElement('option');option.value=value;option.textContent=text;style.append(option);
  }
  style.value=signatureStyle;style.onchange=()=>{signatureStyle=style.value;renderOptions()};
  options.prepend(label('Signature style',style));
  if(signatureStyle==='image') {
    if(signatureTemplate) {
      options.append(signatureImage(signatureTemplate));
      const add=document.createElement('button');add.className='button primary';add.textContent='Add signature';add.disabled=!doc;add.onclick=()=>objects.add('image',{template:signatureTemplate});options.append(add);
      const name=document.createElement('p');name.className='signature-name';name.textContent=signatureTemplate.name;options.append(name);
    }
    const upload=document.createElement('button');upload.className='button primary';upload.textContent=signatureTemplate?'Replace signature image':'Upload signature image';
    upload.onclick=()=>$('#signature-input').click();options.append(upload);
    if(signatureTemplate) {
      const settings=document.createElement('button');settings.className='button';settings.textContent='Signature settings';
      settings.onclick=()=>importSignature(new File([signatureTemplate.source||signatureTemplate.blob],signatureTemplate.source?signatureTemplate.name:'signature.png'),signatureTemplate.settings||{},!signatureTemplate.source);options.append(settings);
      const remove=document.createElement('button');remove.className='button';remove.textContent='Remove saved template';
      remove.onclick=()=>work(async()=>{await removeSignature();signatureTemplate=null;renderOptions();toast('Template removed. Signatures already placed in PDFs are unchanged.')});options.append(remove);
    }
    const hint=document.createElement('p');hint.className='option-note';hint.textContent=signatureTemplate?'Click Add signature, then drag the image to move it. Drag a corner to resize proportionally.':'PNG, JPG, BMP, or WebP · up to 10 MB. Crop unused space in Paint for a closer fit.';options.append(hint);
  }
  const note=document.createElement('p');note.className='option-note';note.textContent=signatureStyle==='image'?'Saved only in this browser on this computer. Clearing browser data removes your template.':'Click the page to type a signature. Drag its corners to resize the text box.';options.append(note);
}
async function importSignature(file, savedSettings={}, legacy=false) {
  if(!file)return;
  try {
    let settings={removeBackground:false,backgroundColor:'#ffffff',tolerance:25,recolor:false,inkColor:'#000000',...savedSettings};
    let prepared=await prepareSignature(file,settings);
    const preview=signatureImage(prepared);
    const remove=field('checkbox');remove.checked=settings.removeBackground;
    const background=field('color',settings.backgroundColor);
    const tolerance=field('range',settings.tolerance);tolerance.min=0;tolerance.max=150;
    const toleranceLabel=label(`Background tolerance: ${settings.tolerance}`,tolerance);
    const recolor=field('checkbox');recolor.checked=settings.recolor;
    const ink=field('color',settings.inkColor);
    const surface=document.createElement('select');
    for(const [value,text] of [['checker','Checkerboard'],['dark','Dark page'],['light','White page']]){const option=document.createElement('option');option.value=value;option.textContent=text;surface.append(option)}
    surface.onchange=()=>{preview.dataset.surface=surface.value};
    const presets=document.createElement('div');presets.className='signature-presets';
    for(const [text,bg,color] of [['Black ink / white background','#ffffff','#000000'],['White ink / black background','#000000','#ffffff']]){
      const button=document.createElement('button');button.type='button';button.className='button';button.textContent=text;
      button.onclick=()=>{remove.checked=true;background.value=bg;recolor.checked=false;ink.value=color;surface.value=color==='#ffffff'?'dark':'checker';surface.onchange();update()};presets.append(button);
    }
    const hint=document.createElement('p');hint.className='option-note';hint.textContent='Choose the background color to make transparent. Increase tolerance for uneven backgrounds. Change ink color affects every remaining non-transparent pixel. For a solid background, remove it first. Preview surface is not saved into the PDF.';
    if(legacy)hint.textContent+=' This older template has no original image; re-upload it to restore previously removed pixels.';
    const error=document.createElement('p');error.className='danger';error.setAttribute('role','status');
    let generation=0,closed=false;
    const apply=$('#dialog button[value="ok"]');
    function update(){
      const current=++generation;apply.disabled=true;
      settings={removeBackground:remove.checked,backgroundColor:background.value,tolerance:Number(tolerance.value),recolor:recolor.checked,inkColor:ink.value};
      toleranceLabel.firstChild.textContent=`Background tolerance: ${tolerance.value}`;
      background.disabled=tolerance.disabled=!remove.checked;ink.disabled=!recolor.checked;
      prepareSignature(file,settings).then(value=>{
        if(closed||current!==generation)return;
        prepared=value;preview.src=URL.createObjectURL(value.blob);error.textContent='';apply.disabled=false;
      }).catch(e=>{if(!closed&&current===generation)error.textContent=e.message});
    }
    for(const control of [remove,background,tolerance,recolor,ink])control.oninput=update;
    background.disabled=tolerance.disabled=!remove.checked;ink.disabled=!recolor.checked;
    apply.disabled=false;
    const accepted=await ask('Signature settings','Adjust the background and ink, then save your reusable template.',[preview,label('Preview surface',surface),presets,label('Remove background',remove),label('Background color to remove',background),toleranceLabel,label('Change ink color',recolor),label('Signature ink color',ink),hint,error]);
    closed=true;apply.disabled=false;
    if(!accepted)return;
    await work(async()=>{await saveSignature(prepared);signatureTemplate=prepared;signatureStyle='image';renderOptions();toast('Signature template saved. Click Add signature to place it.')});
  } catch(e){toast(e.message)}
}
function updateObjectStatus(){
  $('#objects-status').hidden=!objects.items.length;
  $('#objects-status span').textContent=`${objects.items.length} editable object(s) · Save a copy includes them. Click an object to edit.`;
  $('#undo').disabled=!objects.past.length&&!doc?.undo;
  $('#redo').disabled=!objects.future.length&&!doc?.redo;
  const current=objects.items.find(i=>i.id===objects.selected&&i.kind!=='image');
  for(const [selector,key] of [['#font-size','size'],['#color','color']]){
    const input=$(selector);if(!input)continue;
    if(current)input.value=current[key];
    input.onchange=()=>{if(!current)return;const value=key==='size'?Number(input.value):input.value;if(key==='size'&&(!Number.isFinite(value)||value<4||value>200)){toast('Choose a font size between 4 and 200.');return}objects.record();current[key]=value;objects.render();updateObjectStatus()};
  }
}
async function writeObjects(sid,items){
  let result=null;
  for(const item of items){
    const [x,y,w,h]=item.box,rect=[x,y,x+w,y+h];
    if(item.kind==='image'){
      const data=new FormData();data.append('file',item.template.blob,'signature.png');data.append('page',item.page);data.append('rect',JSON.stringify(rect));
      result=await(await api(`/api/doc/${sid}/image`,{method:'POST',body:data})).json();
    }else if(item.text.trim()){
      result=await(await api(`/api/doc/${sid}/action`,json({op:item.kind,page:item.page,rect,text:item.text,size:item.size,color:item.color}))).json();
    }
  }
  return result;
}
async function copyWithObjects(){
  const base=await(await api(`/api/doc/${doc.id}/export`,json({kind:'pdf'}))).blob();
  const data=new FormData();data.append('file',base,doc.name);
  const copy=await(await api('/api/open',{method:'POST',body:data})).json();
  try{await writeObjects(copy.id,objects.items);return copy}
  catch(e){await api(`/api/doc/${copy.id}`,{method:'DELETE'});throw e}
}
async function exportWithObjects(kind,extra){
  let copy=null;
  try{if(objects.items.length)copy=await copyWithObjects();return await(await api(`/api/doc/${copy?.id||doc.id}/export`,json({kind,...extra}))).blob()}
  finally{if(copy)await api(`/api/doc/${copy.id}`,{method:'DELETE'})}
}
async function finalizeObjects(){
  if(!objects.items.length)return true;
  if(!await ask('Apply editable objects?','This writes your text and signatures into the PDF before other PDF edits or page changes. Corner handles will be removed. Save a copy instead if you want to keep adjusting them in this session.',[]))return false;
  return !!await work(async()=>{
    // Validate all objects on a temporary copy before touching the working PDF.
    const copy=await copyWithObjects();
    try{doc=await writeObjects(doc.id,objects.items)||doc}finally{await api(`/api/doc/${copy.id}`,{method:'DELETE'})}
    objects.clear();
    await render();return true;
  });
}
async function work(fn){if(busy)return;busy=true;$('#busy').hidden=false;try{return await fn()}catch(e){toast(e.message)}finally{busy=false;$('#busy').hidden=true}}
async function api(url,opts={}){const r=await fetch(url,opts);if(!r.ok){let e;try{e=await r.json()}catch{e={detail:'The operation failed.'}}throw Error(e.detail||'The operation failed.')}return r}
const json=data=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
function label(text,element){let l=document.createElement('label');l.append(document.createTextNode(text),element);return l}
function field(type,value='',id=''){let e=document.createElement(type==='textarea'?'textarea':'input');if(type!=='textarea')e.type=type;e.value=value;if(id)e.id=id;return e}
async function ask(title,description,fields){$('#dialog-title').textContent=title;$('#dialog-description').textContent=description;$('#dialog-fields').replaceChildren(...fields);$('#dialog').showModal();return new Promise(resolve=>$('#dialog').addEventListener('close',()=>resolve($('#dialog').returnValue==='ok'),{once:true}))}
function pageURL(i,scale=1){return `/api/doc/${doc.id}/page/${i}?scale=${scale}&r=${doc.revision}`}
function renderTools(){ $('#tool-list').replaceChildren();for(const [id,icon,name] of tools[mode]){let b=document.createElement('button');b.className='tool'+(id===tool?' active':'');b.innerHTML=`<span class="tool-icon">${icon}</span><span>${name}</span>`;b.onclick=()=>choose(id);$('#tool-list').append(b)} }
async function setMode(next){if(next==='organize'&&!await finalizeObjects())return;mode=next;tool='select';$$('#modes>button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));renderTools();if(doc)await render();else{$('#panel-title').textContent='Open a PDF to get started';$('#panel-description').textContent='All tools become available once your document is open.'}}
async function openFile(file){if(!file)return;if(doc){let ok=await ask('Open another document?','Download a copy first if you want to keep your changes. Opening another file will close this session.',[]);if(!ok)return}await work(async()=>{let f=new FormData();f.append('file',file);let r=await fetch('/api/open',{method:'POST',body:f});if(!r.ok){let e=await r.json();if(String(e.detail).includes('password')){let pw=field('password');$('#busy').hidden=true;let ok=await ask('Unlock PDF','Enter the document password.',[label('Password',pw)]);$('#busy').hidden=false;if(!ok)return;f.append('password',pw.value);r=await api('/api/open',{method:'POST',body:f})}else throw Error(e.detail)}let next=await r.json();if(doc)await api(`/api/doc/${doc.id}`,{method:'DELETE'});doc=next;objects.clear();page=0;selected.clear();zoom=.85;tool='select';await render();toast('Document opened. Your original file is unchanged.')})}
async function render(){if(!doc)return;page=Math.max(0,Math.min(page,doc.pages-1));$('#empty').hidden=true;$('#editor').hidden=false;$('#filename').textContent=doc.name;$('#save').disabled=false;$('#close').disabled=false;$('#undo').disabled=!doc.undo;$('#redo').disabled=!doc.redo;$('#page-number').value=page+1;$('#page-number').max=doc.pages;$('#page-count').textContent=`/ ${doc.pages}`;$('#prev').disabled=page===0;$('#next').disabled=page===doc.pages-1;$('#doc-status').textContent=`${doc.pages} page${doc.pages>1?'s':''} · ${(doc.size/1024).toFixed(0)} KB · ${doc.revision?'Modified document':'Ready'}`;$('#zoom-label').textContent=`${Math.round(zoom*100)}%`;
$('#page-wrap').hidden=mode==='organize';$('#page-grid').hidden=mode!=='organize';$('#thumbnails').replaceChildren();
if(mode==='organize'){renderGrid();$('#panel-title').textContent='Every page in its place.';$('#panel-description').textContent='Drag pages to rearrange. Select pages for bulk actions. Use arrow buttons for keyboard-friendly reordering.';$('#options').replaceChildren();let b=document.createElement('button');b.className='button';b.textContent=selected.size===doc.pages?'Clear selection':'Select all pages';b.onclick=()=>{selected=selected.size===doc.pages?new Set():new Set(Array.from({length:doc.pages},(_,i)=>i));render()};$('#options').append(b)}else{const [w,h]=doc.dimensions[page];$('#page-wrap').style.width=w*zoom+'px';$('#page-wrap').style.height=h*zoom+'px';$('#page-image').src=pageURL(page,Math.min(2,zoom*1.4));details=await (await api(`/api/doc/${doc.id}/details/${page}`)).json();for(let i=0;i<doc.pages;i++){let b=document.createElement('button');b.className='thumbnail'+(i===page?' active':'');b.innerHTML=`<img loading="lazy" src="${pageURL(i,.23)}" alt="Page ${i+1}"><span>PAGE ${String(i+1).padStart(2,'0')}</span>`;b.onclick=()=>navigate(i);$('#thumbnails').append(b)}renderOptions();renderTextTargets()}renderTools();objects.render();updateObjectStatus()}
async function navigate(i){if(i>=0&&i<doc.pages)await work(async()=>{page=i;await render()})}
function renderGrid(){$('#page-grid').replaceChildren();for(let i=0;i<doc.pages;i++){let card=document.createElement('div');card.className='grid-card'+(selected.has(i)?' selected':'');card.draggable=true;card.innerHTML=`<img loading="lazy" src="${pageURL(i,.4)}" alt="Page ${i+1}"><div><label><input type="checkbox" ${selected.has(i)?'checked':''} aria-label="Select page ${i+1}"></label><span>${i+1}</span><button title="Move page left" ${i===0?'disabled':''}>←</button><button title="Move page right" ${i===doc.pages-1?'disabled':''}>→</button></div>`;card.querySelector('input').onchange=e=>{e.target.checked?selected.add(i):selected.delete(i);renderGrid()};let buttons=card.querySelectorAll('button');buttons[0].onclick=()=>move(i,i-1);buttons[1].onclick=()=>move(i,i+1);card.ondragstart=e=>{dragPage=i;e.dataTransfer.setData('text/plain',String(i))};card.ondragover=e=>e.preventDefault();card.ondrop=e=>{e.preventDefault();e.stopPropagation();if(dragPage!==null&&dragPage!==i)move(dragPage,i);dragPage=null};$('#page-grid').append(card)}}
async function move(from,to){let order=Array.from({length:doc.pages},(_,i)=>i);order.splice(to,0,order.splice(from,1)[0]);await mutate({op:'arrange',order});selected.clear()}
function renderOptions(){$('#panel-title').textContent=(tools.edit.find(t=>t[0]===tool)||['','','Export a finished copy'])[2];$('#panel-description').textContent=descriptions[tool]||'Download the format you need. Changes are saved only to your exported copy.';$('#tool-hint').textContent=descriptions[tool]?.split('.')[0]||'Choose an export option';$('#options').replaceChildren();if((['text','replace','highlight','rectangle'].includes(tool)||(tool==='signature'&&signatureStyle==='typed'))){if(!['highlight','rectangle'].includes(tool))$('#options').append(label('Font size',field('number',14,'font-size')));$('#options').append(label('Color',field('color',tool==='highlight'?'#f3cd45':'#20392d','color')))}if(tool==='signature')renderSignatureOptions();if(tool==='form'){let values={};for(const f of details.fields){if(!['Text','CheckBox','ComboBox','ListBox'].includes(f.type))continue;let e;if(f.choices?.length){e=document.createElement('select');for(const c of f.choices){let o=document.createElement('option');o.value=Array.isArray(c)?c[0]:c;o.textContent=Array.isArray(c)?c[1]:c;e.append(o)}e.value=f.value}else e=field(f.type==='CheckBox'?'checkbox':'text',f.value||'');if(f.type==='CheckBox')e.checked=!!f.value&&f.value!=='Off';values[f.xref]=e;$('#options').append(label(f.name,e))}if(Object.keys(values).length){let b=document.createElement('button');b.className='button primary';b.textContent='Save form values';b.onclick=()=>mutate({op:'form',page,values:Object.fromEntries(Object.entries(values).map(([k,e])=>[k,e.type==='checkbox'?e.checked:e.value]))});$('#options').append(b)}else $('#options').textContent='No supported interactive fields on this page. Use Add text for a flat form.'}}
function renderTextTargets(){$('#text-targets').replaceChildren();if(tool!=='replace')return;for(const span of details.spans){let b=document.createElement('button');b.className='text-target';b.title=`Edit: ${span.text}`;let [x,y,x2,y2]=span.rect;Object.assign(b.style,{left:x*zoom+'px',top:y*zoom+'px',width:(x2-x)*zoom+'px',height:(y2-y)*zoom+'px'});b.onclick=()=>editRect(span.rect,span.text,span.size);$('#text-targets').append(b)}}
async function mutate(a){if(a.op==='undo'&&objects.undo())return;if(a.op==='redo'&&objects.redo())return;if(!['undo','redo'].includes(a.op)&&!await finalizeObjects())return;if(['undo','redo'].includes(a.op)&&objects.items.length){toast('Apply or remove editable objects before undoing earlier PDF changes.');return}await work(async()=>{doc=await (await api(`/api/doc/${doc.id}/action`,json(a))).json();selected.clear();await render();toast('Document updated. Undo is available.')})}
async function choose(id){if(!doc){if(id==='signature'){tool=id;renderTools();renderOptions();return}toast('Open a PDF to use this tool.');return}if(mode==='edit'){tool=id;renderTools();renderOptions();renderTextTargets();objects.render();return}const pages=[...selected].sort((a,b)=>a-b);if(['rotate','delete','duplicate','extract'].includes(id)&&!pages.length){toast('Select one or more pages first.');return}if(id==='merge')$('#merge-input').click();else if(id==='rotate')await mutate({op:'rotate',pages});else if(id==='blank')await mutate({op:'blank'});else if(id==='delete'){if(pages.length===doc.pages)return toast('Keep at least one page in your document.');if(await ask('Delete selected pages?',`${pages.length} page(s) will be removed from this working copy. You can undo this change.`,[]))await mutate({op:'arrange',order:Array.from({length:doc.pages},(_,i)=>i).filter(i=>!selected.has(i))})}else if(id==='duplicate'){let order=[];for(let i=0;i<doc.pages;i++){order.push(i);if(selected.has(i))order.push(i)}await mutate({op:'arrange',order})}else if(id==='numbers')await mutate({op:'numbers'});else if(id==='watermark'){let f=field('text','DRAFT');if(await ask('Add watermark','Adds a light text watermark at the top of every page.',[label('Watermark text',f)]))await mutate({op:'watermark',text:f.value})}else if(id==='protect'){let f=field('password');if(await ask('Protect a copy','The downloaded PDF will require this password to open.',[label('Password',f)])){if(f.value.length<6)return toast('Use a password with at least 6 characters.');await download('pdf',{password:f.value},'protected')}}else await download(id==='textExport'?'text':id==='compress'?'pdf':id,{pages},id==='compress'?'optimized':id)}
async function download(kind='pdf',extra={},suffix='edited'){await work(async()=>{const blob=await exportWithObjects(kind,extra);let ext=['split','png'].includes(kind)?'zip':kind==='text'?'txt':'pdf';let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=doc.name.replace(/\.pdf$/i,'')+'-'+suffix+'.'+ext;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),30000);toast(kind==='pdf'&&suffix==='optimized'?`Optimized copy downloaded (${Math.round(blob.size/1024)} KB). Size reduction depends on the source PDF.`:'Your download is ready.')})}
async function editRect(rect,old='',size=14){if(tool==='text'||tool==='signature'){const [x,y,x2,y2]=rect;if(tool==='signature'&&signatureStyle==='image'){if(!signatureTemplate)return toast('Upload your signature image first.');objects.add('image',{x,y,template:signatureTemplate})}else objects.add(tool,{x,y,width:x2-x,height:y2-y,size:Number($('#font-size')?.value||14),color:$('#color')?.value||'#20392d'});return}let op=tool;let color=$('#color')?.value||'#20392d';let fontSize=Number($('#font-size')?.value||size);if(['text','replace','signature','note'].includes(op)){let text=field('textarea',old);if(!await ask(op==='replace'?'Replace text':op==='signature'?'Add signature':op==='note'?'Add comment':'Add text',op==='replace'?'Replaces the selected text with a standard font. Increase the box height by using Add text if replacement does not fit.':'Enter the content for your selected area.',[label('Text',text)]))return;if(!text.value.trim())return;if(op==='replace')rect=[rect[0],rect[1],rect[2],rect[3]+size*.5];await mutate({op,page,rect,text:text.value,size:op==='replace'?Math.min(fontSize,size):fontSize,color})}else if(op==='image'){window.imageRect=rect;$('#image-input').click()}else if(op==='redact'){if(await ask('Remove this content?','The content in this area will be removed from the exported file. Undo remains available in this session. This does not remove metadata or content elsewhere in the document.',[]))await mutate({op,page,rect})}else await mutate({op,page,rect,color})}
$('#page-wrap').onpointerdown=e=>{if(busy||!doc||!['text','image','highlight','note','signature','rectangle','redact','crop'].includes(tool))return;let r=$('#page-wrap').getBoundingClientRect();start=[Math.max(0,(e.clientX-r.left)/zoom),Math.max(0,(e.clientY-r.top)/zoom)];$('#page-wrap').setPointerCapture(e.pointerId)};
$('#page-wrap').onpointermove=e=>{if(!start)return;let r=$('#page-wrap').getBoundingClientRect();let x=(e.clientX-r.left)/zoom,y=(e.clientY-r.top)/zoom;Object.assign($('#selection').style,{display:'block',left:Math.min(start[0],x)*zoom+'px',top:Math.min(start[1],y)*zoom+'px',width:Math.abs(x-start[0])*zoom+'px',height:Math.abs(y-start[1])*zoom+'px'})};
$('#page-wrap').onpointerup=async e=>{if(!start)return;let r=$('#page-wrap').getBoundingClientRect(),[w,h]=doc.dimensions[page];let x=Math.min(w,Math.max(0,(e.clientX-r.left)/zoom)),y=Math.min(h,Math.max(0,(e.clientY-r.top)/zoom));let rect=[Math.min(start[0],x),Math.min(start[1],y),Math.max(start[0],x),Math.max(start[1],y)];start=null;$('#selection').style.display='none';if(tool==='note'){rect[2]=Math.min(w,rect[0]+20);rect[3]=Math.min(h,rect[1]+20)}else if((tool==='text'||tool==='signature')&&(rect[2]-rect[0]<10||rect[3]-rect[1]<10)){rect[2]=rect[0]+220;rect[3]=rect[1]+65}else if(rect[2]-rect[0]<10||rect[3]-rect[1]<10)return toast('Drag a larger box on the page.');await editRect(rect)};
$('#page-wrap').onpointercancel=()=>{start=null;$('#selection').style.display='none'};
$('#open').onclick=$('#empty-open').onclick=()=>$('#file-input').click();$('#file-input').onchange=e=>{openFile(e.target.files[0]);e.target.value=''};
$('#merge-input').onchange=e=>{let files=[...e.target.files];e.target.value='';if(files.length)work(async()=>{let f=new FormData();files.forEach(file=>f.append('files',file));doc=await(await api(`/api/doc/${doc.id}/merge`,{method:'POST',body:f})).json();await render();toast('PDFs merged in the selected file order.')})};
$('#image-input').onchange=e=>{let file=e.target.files[0];e.target.value='';if(file)work(async()=>{let f=new FormData();f.append('file',file);f.append('page',page);f.append('rect',JSON.stringify(window.imageRect));doc=await(await api(`/api/doc/${doc.id}/image`,{method:'POST',body:f})).json();await render();toast('Image added.')})};
$('#save').onclick=()=>download();$('#undo').onclick=()=>mutate({op:'undo'});$('#redo').onclick=()=>mutate({op:'redo'});$('#prev').onclick=()=>navigate(page-1);$('#next').onclick=()=>navigate(page+1);$('#page-number').onchange=e=>navigate(Number(e.target.value)-1);$('#zoom-in').onclick=()=>{zoom=Math.min(2,zoom+.15);render()};$('#zoom-out').onclick=()=>{zoom=Math.max(.25,zoom-.15);render()};$$('#modes>button').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
$('#close').onclick=async()=>{if(await ask('Close document?','Download a copy first to keep your changes. This will clear the document from memory.',[]))await work(async()=>{await api(`/api/doc/${doc.id}`,{method:'DELETE'});doc=null;objects.clear();location.reload()})};
document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>{e.preventDefault();if(e.dataTransfer.files.length)openFile(e.dataTransfer.files[0])});document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'&&doc&&!$('#dialog').open){e.preventDefault();download();return}if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)||$('#dialog').open)return;if((e.ctrlKey||e.metaKey)&&doc){if(e.key==='s'){e.preventDefault();download()}if(e.key==='z'){e.preventDefault();mutate({op:e.shiftKey?'redo':'undo'})}if(e.key==='y'){e.preventDefault();mutate({op:'redo'})}}});window.addEventListener('beforeunload',e=>{if(doc?.revision||objects.items.length){e.preventDefault();e.returnValue=''}});renderTools();

loadSignature().then(value=>{signatureTemplate=value||null;if(tool==='signature')renderOptions()}).catch(e=>toast(e.message));

$('#apply-objects').onclick=()=>finalizeObjects();
$('#signature-input').onchange=e=>{const file=e.target.files[0];e.target.value='';importSignature(file)};
