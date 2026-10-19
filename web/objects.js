export function resizeBox(box, corner, dx, dy, bounds, aspect=false) {
  const [x,y,w,h]=box, [pw,ph]=bounds;
  const left=corner.includes('w'), top=corner.includes('n');
  const ax=left?x+w:x, ay=top?y+h:y;
  let nw=Math.max(20,w+(left?-dx:dx)), nh=Math.max(20,h+(top?-dy:dy));
  const maxW=left?ax:pw-ax, maxH=top?ay:ph-ay;
  if(aspect){const ratio=w/h;nw=Math.max(nw,nh*ratio);nw=Math.min(nw,maxW,maxH*ratio);nh=nw/ratio}
  else {nw=Math.min(nw,maxW);nh=Math.min(nh,maxH)}
  return [left?ax-nw:ax,top?ay-nh:ay,nw,nh];
}

export class ObjectEditor {
  constructor({host,state,changed}) {
    this.host=host;this.state=state;this.changed=changed;this.items=[];this.selected=null;this.past=[];this.future=[];
    this.layer=document.createElement('div');this.layer.id='object-layer';host.append(this.layer);
  }
  snapshot(){return this.items.map(i=>({...i,box:[...i.box]}))}
  record(){this.past.push(this.snapshot());this.past=this.past.slice(-30);this.future=[]}
  undo(){if(!this.past.length)return false;this.future.push(this.snapshot());this.items=this.past.pop();this.selected=null;this.render();this.changed();return true}
  redo(){if(!this.future.length)return false;this.past.push(this.snapshot());this.items=this.future.pop();this.selected=null;this.render();this.changed();return true}
  clear(){this.items=[];this.past=[];this.future=[];this.selected=null;this.render();this.changed()}
  add(kind,{x=60,y=100,text='',size=14,color='#20392d',template=null,width=220,height=65}={}) {
    const {page,bounds}=this.state();
    if(template){width=Math.min(180,bounds[0]*.6);height=width*template.height/template.width}
    const scale=Math.min(1,bounds[0]/width,bounds[1]/height);width*=scale;height*=scale;
    x=Math.max(0,Math.min(x,bounds[0]-width));y=Math.max(0,Math.min(y,bounds[1]-height));
    this.record();const item={id:crypto.randomUUID(),kind,page,box:[x,y,width,height],text,size,color,template};
    this.items.push(item);this.selected=item.id;this.render();this.changed();
    if(kind!=='image')this.layer.querySelector(`[data-object-id="${item.id}"] textarea`)?.focus();
  }
  remove(id){this.record();this.items=this.items.filter(i=>i.id!==id);this.selected=null;this.render();this.changed()}
  render() {
    this.layer.replaceChildren();const {page,zoom,bounds}=this.state();
    for(const item of this.items.filter(i=>i.page===page)) {
      const el=document.createElement('div');el.className='pdf-object'+(this.selected===item.id?' is-selected':'');el.dataset.objectId=item.id;
      el.setAttribute('role','group');el.setAttribute('aria-label',item.kind==='image'?'Signature object':'Text box');
      const position=()=>{const [x,y,w,h]=item.box;Object.assign(el.style,{left:x*zoom+'px',top:y*zoom+'px',width:w*zoom+'px',height:h*zoom+'px'})};position();
      el.onpointerdown=e=>{e.stopPropagation();if(this.selected!==item.id){this.selected=item.id;this.layer.querySelectorAll('.pdf-object').forEach(n=>n.classList.toggle('is-selected',n===el));this.changed()}};
      if(item.kind==='image'){
        const img=document.createElement('img');img.src=URL.createObjectURL(item.template.blob);img.onload=()=>URL.revokeObjectURL(img.src);img.draggable=false;img.alt='Placed signature';el.append(img);
      }else{
        const input=document.createElement('textarea');input.value=item.text;input.placeholder=item.kind==='signature'?'Type your signature':'Type here…';input.setAttribute('aria-label','Text box content');input.spellcheck=false;
        Object.assign(input.style,{fontSize:item.size*zoom+'px',color:item.color,fontStyle:item.kind==='signature'?'italic':'normal'});
        input.onfocus=()=>{this.record()};input.oninput=()=>{item.text=input.value;this.changed()};el.append(input);
      }
      const bar=document.createElement('div');bar.className='object-controls';
      const move=document.createElement('button');move.textContent='✥ Move';move.title='Drag to move; arrow keys nudge';move.setAttribute('aria-label','Move object');
      const del=document.createElement('button');del.textContent='×';del.setAttribute('aria-label','Delete object');del.onclick=e=>{e.stopPropagation();this.remove(item.id)};
      bar.append(move,del);el.append(bar);
      const drag=(e,corner=null)=>{
        if(e.button!==0)return;e.preventDefault();e.stopPropagation();this.selected=item.id;this.record();
        this.layer.querySelectorAll('.pdf-object').forEach(n=>n.classList.toggle('is-selected',n===el));
        const initial=[...item.box],sx=e.clientX,sy=e.clientY,target=e.currentTarget;target.setPointerCapture(e.pointerId);
        target.onpointermove=ev=>{const dx=(ev.clientX-sx)/zoom,dy=(ev.clientY-sy)/zoom;
          item.box=corner?resizeBox(initial,corner,dx,dy,bounds,item.kind==='image'):[Math.max(0,Math.min(bounds[0]-initial[2],initial[0]+dx)),Math.max(0,Math.min(bounds[1]-initial[3],initial[1]+dy)),initial[2],initial[3]];position()};
        const finish=()=>{target.onpointermove=null;target.onpointerup=null;target.onpointercancel=null;this.changed()};target.onpointerup=finish;target.onpointercancel=finish;
      };
      move.onpointerdown=e=>drag(e);if(item.kind==='image')el.querySelector('img').onpointerdown=e=>drag(e);
      move.onkeydown=e=>{const deltas={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(!deltas[e.key])return;e.preventDefault();e.stopPropagation();this.record();const [dx,dy]=deltas[e.key],step=e.shiftKey?10:1;item.box[0]=Math.max(0,Math.min(bounds[0]-item.box[2],item.box[0]+dx*step));item.box[1]=Math.max(0,Math.min(bounds[1]-item.box[3],item.box[1]+dy*step));position();this.changed()};
      for(const corner of ['nw','ne','sw','se']){const handle=document.createElement('button');handle.className='resize-handle '+corner;handle.setAttribute('aria-label','Resize '+({nw:'top left',ne:'top right',sw:'bottom left',se:'bottom right'}[corner]));handle.onpointerdown=e=>drag(e,corner);handle.onkeydown=e=>{const delta={ArrowLeft:[-2,0],ArrowRight:[2,0],ArrowUp:[0,-2],ArrowDown:[0,2]}[e.key];if(!delta)return;e.preventDefault();e.stopPropagation();this.record();item.box=resizeBox(item.box,corner,...delta,bounds,item.kind==='image');position();this.changed()};el.append(handle)}
      this.layer.append(el);
    }
  }
}
