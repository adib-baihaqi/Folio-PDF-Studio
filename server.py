from pathlib import Path
import io, json, secrets, zipfile
import pymupdf as pdf
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
app = FastAPI(title='Folio PDF Studio')
sessions = {}
MAX_FILE = 50 * 1024 * 1024

@app.middleware('http')
async def local_only(request: Request, call_next):
    if request.headers.get('host', '').split(':')[0] not in ('127.0.0.1', 'localhost', 'testserver'):
        return Response('Local access only', status_code=403)
    origin = request.headers.get('origin')
    if origin and origin not in ('http://127.0.0.1:8765', 'http://localhost:8765'):
        return Response('Origin not allowed', status_code=403)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response

def get(sid):
    if sid not in sessions: raise HTTPException(404, 'Document session expired. Open the file again.')
    return sessions[sid]

def opened(data, password=''):
    try:
        doc = pdf.open(stream=data, filetype='pdf')
        if doc.needs_pass and not doc.authenticate(password):
            raise HTTPException(400, 'This PDF requires the correct password.')
        if not len(doc): raise ValueError('Empty PDF')
        return doc
    except HTTPException: raise
    except Exception: raise HTTPException(400, 'Cannot read this PDF. It may be damaged or unsupported.')

def info(sid):
    s = get(sid)
    with opened(s['data']) as d:
        return dict(id=sid, name=s['name'], pages=len(d), size=len(s['data']), revision=s['revision'], undo=bool(s['undo']), redo=bool(s['redo']), dimensions=[[p.rect.width,p.rect.height] for p in d])

def commit(s, data):
    s['undo'].append(s['data'])
    s['undo'] = s['undo'][-12:]
    s['redo'].clear()
    s['data'] = data
    s['revision'] += 1

@app.post('/api/open')
async def upload(file: UploadFile = File(...), password: str = Form('')):
    data = await file.read(MAX_FILE + 1)
    if len(data)>MAX_FILE: raise HTTPException(413, 'Maximum file size is 50 MB.')
    with opened(data,password) as d:
        data = d.tobytes(encryption=pdf.PDF_ENCRYPT_NONE)
    if len(sessions)>=10: raise HTTPException(400,'Close a document before opening another.')
    sid = secrets.token_urlsafe(24)
    sessions[sid] = dict(data=data, name=Path(file.filename or 'Untitled.pdf').name, undo=[], redo=[], revision=0)
    return info(sid)

@app.delete('/api/doc/{sid}')
def close(sid: str):
    sessions.pop(sid,None)
    return {'ok': True}

@app.get('/api/doc/{sid}/page/{number}')
def render(sid: str, number: int, scale: float=1):
    with opened(get(sid)['data']) as d:
        if number<0 or number>=len(d): raise HTTPException(400,'Page does not exist.')
        p=d[number]
        scale=min(max(scale,.1),2,3000/max(p.rect.width,p.rect.height))
        return Response(p.get_pixmap(matrix=pdf.Matrix(scale,scale),alpha=False).tobytes('png'),media_type='image/png')

@app.get('/api/doc/{sid}/details/{number}')
def details(sid: str, number: int):
    with opened(get(sid)['data']) as d:
        p=d[number]
        spans=[]
        for block in p.get_text('dict')['blocks']:
            for line in block.get('lines',[]):
                for span in line['spans']:
                    if span['text'].strip(): spans.append(dict(text=span['text'],rect=list(pdf.Rect(span['bbox'])*p.rotation_matrix),size=span['size']))
        fields=[dict(xref=w.xref,name=w.field_label or w.field_name,value=w.field_value,type=w.field_type_string,choices=w.choice_values) for w in (p.widgets() or [])]
        return dict(spans=spans,fields=fields)

@app.post('/api/doc/{sid}/action')
async def action(sid: str, request: Request):
    s=get(sid); a=await request.json(); op=a.get('op')
    if op in ('undo','redo'):
        src=s[op]; dst=s['redo' if op=='undo' else 'undo']
        if src: dst.append(s['data']); s['data']=src.pop(); s['revision']+=1
        return info(sid)
    try:
        with opened(s['data']) as d:
            if op=='arrange':
                order=a['order']
                if not order or len(order)>2000 or any(type(i)!=int or i<0 or i>=len(d) for i in order): raise ValueError('Invalid page order.')
                d.select(order)
            elif op=='blank': d.new_page(pno=a.get('at',len(d)))
            elif op=='rotate':
                for i in a['pages']: d[i].set_rotation((d[i].rotation+90)%360)
            elif op=='watermark':
                for p in d:
                    p.insert_text((36,36),a['text'],fontsize=18,color=(.5,.5,.5),fill_opacity=.45)
            elif op=='numbers':
                for i,p in enumerate(d): p.insert_text((p.rect.width/2,p.rect.height-20),str(i+1),fontsize=10)
            elif op=='form':
                p=d[a['page']]
                for w in p.widgets() or []:
                    if str(w.xref) in a['values']:
                        value=a['values'][str(w.xref)]
                        if w.field_type==pdf.PDF_WIDGET_TYPE_CHECKBOX: value=w.on_state() if value else 'Off'
                        if w.field_type==pdf.PDF_WIDGET_TYPE_SIGNATURE: continue
                        w.field_value=value; w.update()
            else:
                p=d[a['page']]
                rect=pdf.Rect(a['rect'])*p.derotation_matrix
                color=tuple(int(a.get('color','#17252a')[i:i+2],16)/255 for i in (1,3,5))
                if op in ('text','replace','signature'):
                    text=a['text']; size=float(a.get('size',14)); font='heit' if op=='signature' else 'helv'
                    if any(ord(c)>255 for c in text): raise ValueError('This text tool currently supports Latin characters only.')
                    if op=='replace':
                        p.add_redact_annot(rect,fill=(1,1,1)); p.apply_redactions(images=0,graphics=0)
                    fit=p.insert_textbox(rect,text,fontsize=size,fontname=font,color=color)
                    if fit<0: raise ValueError('Text does not fit. Use a larger box or a smaller font size.')
                elif op=='highlight':
                    an=p.add_highlight_annot(rect); an.set_colors(stroke=color); an.update()
                elif op=='redact':
                    p.add_redact_annot(rect,fill=(0,0,0)); p.apply_redactions()
                elif op=='note': p.add_text_annot(rect.tl,a['text'])
                elif op=='rectangle': p.draw_rect(rect,color=color,width=2)
                elif op=='crop':
                    crop=rect & p.cropbox
                    if crop.width<30 or crop.height<30: raise ValueError('Crop area is too small.')
                    p.set_cropbox(crop)
                else: raise ValueError('Unknown operation.')
            commit(s,d.tobytes(garbage=4,deflate=True))
    except (ValueError,KeyError,IndexError,RuntimeError) as e: raise HTTPException(400,str(e))
    return info(sid)

@app.post('/api/doc/{sid}/merge')
async def merge(sid: str, files: list[UploadFile]=File(...)):
    s=get(sid)
    with opened(s['data']) as d:
        for f in files:
            data=await f.read(MAX_FILE+1)
            if len(data)>MAX_FILE: raise HTTPException(413,'Each file must be under 50 MB.')
            with opened(data) as other: d.insert_pdf(other,widgets=True)
        commit(s,d.tobytes(garbage=4,deflate=True))
    return info(sid)

@app.post('/api/doc/{sid}/image')
async def image(sid: str, file: UploadFile=File(...), page: int=Form(...), rect: str=Form(...)):
    s=get(sid); data=await file.read(10*1024*1024+1)
    if len(data)>10*1024*1024: raise HTTPException(413,'Image limit is 10 MB.')
    try:
        with opened(s['data']) as d:
            p=d[page]; p.insert_image(pdf.Rect(json.loads(rect))*p.derotation_matrix,stream=data)
            commit(s,d.tobytes(garbage=4,deflate=True))
    except Exception: raise HTTPException(400,'Could not insert this image. Use PNG or JPEG.')
    return info(sid)

@app.post('/api/doc/{sid}/export')
async def export(sid: str, request: Request):
    s=get(sid); a=await request.json(); kind=a.get('kind','pdf')
    with opened(s['data']) as d:
        if kind in ('split','png'):
            out=io.BytesIO()
            with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
                for i in range(len(d)):
                    if kind=='png': z.writestr(f'page-{i+1}.png',d[i].get_pixmap(matrix=pdf.Matrix(1.5,1.5)).tobytes('png'))
                    else:
                        with pdf.open() as part:
                            part.insert_pdf(d,from_page=i,to_page=i,widgets=True)
                            z.writestr(f'page-{i+1}.pdf',part.tobytes())
            return Response(out.getvalue(),media_type='application/zip')
        if kind=='text': return Response('\n\n'.join(p.get_text() for p in d),media_type='text/plain')
        if kind=='extract':
            order=a.get('pages',[])
            if not order or any(i<0 or i>=len(d) for i in order): raise HTTPException(400,'Select valid pages.')
            d.select(order)
        opts=dict(garbage=4,deflate=True)
        if a.get('password'): opts.update(encryption=pdf.PDF_ENCRYPT_AES_256,owner_pw=secrets.token_urlsafe(24),user_pw=a['password'])
        return Response(d.tobytes(**opts),media_type='application/pdf')

app.mount('/',StaticFiles(directory=ROOT/'web',html=True),name='web')
