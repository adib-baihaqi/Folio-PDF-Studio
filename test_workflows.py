import io, unittest, zipfile
import pymupdf as pdf
from fastapi.testclient import TestClient
from server import app, sessions

class Workflows(unittest.TestCase):
    def setUp(self):
        sessions.clear(); self.c=TestClient(app)
        d=pdf.open()
        for text in ['Alpha secret','Beta second','Gamma third']:
            p=d.new_page(); p.insert_text((72,90),text,fontsize=16)
        w=pdf.Widget(); w.field_name='Name'; w.field_type=pdf.PDF_WIDGET_TYPE_TEXT; w.rect=pdf.Rect(72,150,260,180)
        d[0].add_widget(w)
        self.source=d.tobytes(); d.close()
        r=self.c.post('/api/open',files={'file':('sample.pdf',self.source,'application/pdf')})
        self.assertEqual(r.status_code,200,r.text); self.sid=r.json()['id']; self.base='/api/doc/'+self.sid
    def action(self,**a):
        r=self.c.post(self.base+'/action',json=a); self.assertEqual(r.status_code,200,r.text); return r.json()
    def export(self,**a):
        r=self.c.post(self.base+'/export',json=a); self.assertEqual(r.status_code,200,r.text); return r.content
    def test_arrange_rotate_undo(self):
        self.action(op='arrange',order=[2,0,1,1]); d=pdf.open(stream=self.export()); self.assertEqual(len(d),4); self.assertIn('Gamma',d[0].get_text())
        self.action(op='rotate',pages=[0]); d=pdf.open(stream=self.export()); self.assertEqual(d[0].rotation,90)
        self.action(op='undo'); d=pdf.open(stream=self.export()); self.assertEqual(d[0].rotation,0)
        self.action(op='redo'); d=pdf.open(stream=self.export()); self.assertEqual(d[0].rotation,90)
    def test_text_redact_and_atomic_failure(self):
        self.action(op='text',page=0,rect=[72,220,320,270],text='Added text',size=14)
        d=pdf.open(stream=self.export()); self.assertIn('Added text',d[0].get_text())
        before=self.export(); r=self.c.post(self.base+'/action',json=dict(op='replace',page=0,rect=[72,73,80,85],text='Too long for tiny area',size=40)); self.assertEqual(r.status_code,400)
        d=pdf.open(stream=self.export()); self.assertIn('Alpha secret',d[0].get_text())
        self.action(op='redact',page=0,rect=[70,70,250,98]); d=pdf.open(stream=self.export()); self.assertNotIn('secret',d[0].get_text())
    def test_merge_split_extract(self):
        r=self.c.post(self.base+'/merge',files=[('files',('extra.pdf',self.source,'application/pdf'))]); self.assertEqual(r.status_code,200,r.text); self.assertEqual(r.json()['pages'],6)
        z=zipfile.ZipFile(io.BytesIO(self.export(kind='split'))); self.assertEqual(len(z.namelist()),6)
        for n in z.namelist(): self.assertEqual(len(pdf.open(stream=z.read(n))),1)
        d=pdf.open(stream=self.export(kind='extract',pages=[2,0])); self.assertEqual(len(d),2); self.assertIn('Gamma',d[0].get_text())
    def test_forms(self):
        fields=self.c.get(self.base+'/details/0').json()['fields']; self.assertEqual(len(fields),1)
        self.action(op='form',page=0,values={str(fields[0]['xref']):'Ahmad'})
        d=pdf.open(stream=self.export()); self.assertEqual(list(d[0].widgets())[0].field_value,'Ahmad')
    def test_exports_and_render(self):
        self.assertIn(b'Alpha',self.export(kind='text'))
        data=self.export(password='secret123'); d=pdf.open(stream=data); self.assertTrue(d.needs_pass); self.assertTrue(d.authenticate('secret123'))
        r=self.c.get(self.base+'/page/0'); self.assertEqual(r.status_code,200); self.assertTrue(r.content.startswith(b'\x89PNG'))
        z=zipfile.ZipFile(io.BytesIO(self.export(kind='png'))); self.assertEqual(len(z.namelist()),3)
    def test_replacement_crop_and_annotations(self):
        self.action(op='replace',page=0,rect=[70,71,280,105],text='Replaced title',size=14)
        self.action(op='highlight',page=0,rect=[70,71,200,105],color='#ffdd00')
        self.action(op='note',page=0,rect=[300,100,320,120],text='Review this')
        d=pdf.open(stream=self.export()); self.assertIn('Replaced title',d[0].get_text()); self.assertNotIn('Alpha',d[0].get_text()); self.assertEqual(len(list(d[0].annots())),2)
        self.action(op='crop',page=0,rect=[30,30,500,700]); d=pdf.open(stream=self.export()); self.assertEqual(d[0].rect.width,470)
    def test_invalid_and_origin(self):
        self.assertEqual(self.c.post('/api/open',files={'file':('bad.pdf',b'not pdf')}).status_code,400)
        self.assertEqual(self.c.post(self.base+'/action',json={'op':'arrange','order':[]}).status_code,400)
        self.assertEqual(self.c.get('/',headers={'Origin':'https://evil.example'}).status_code,403)
        self.assertEqual(self.c.get('/',headers={'Host':'evil.example'}).status_code,403)

    def test_signature_image_export_and_undo(self):
        # A synthetic ink stroke, not a person's signature.
        fixture=pdf.open(); p=fixture.new_page(width=200,height=70)
        p.draw_polyline([(15,45),(45,15),(35,55),(95,25),(130,45),(185,20)],color=(0,0,.5),width=3)
        image=p.get_pixmap(alpha=True).tobytes('png')
        r=self.c.post(self.base+'/image',files={'file':('signature.png',image,'image/png')},data={'page':'0','rect':'[70,300,270,370]'})
        self.assertEqual(r.status_code,200,r.text)
        d=pdf.open(stream=self.export()); self.assertEqual(len(d[0].get_images()),1)
        image_info=d[0].get_image_info()[0]
        self.assertEqual(tuple(image_info['bbox']),(70,300,270,370))
        self.assertTrue(d[0].get_images()[0][1], 'Transparent signature mask is retained')
        self.action(op='undo'); d=pdf.open(stream=self.export()); self.assertEqual(len(d[0].get_images()),0)
        self.action(op='redo'); d=pdf.open(stream=self.export()); self.assertEqual(len(d[0].get_images()),1)

if __name__=='__main__': unittest.main(verbosity=2)
