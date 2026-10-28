import json
from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT

ROOT=Path('/home/moeen775/test/ownterminal')
B=ROOT/'.artifact-build/termius'
data=json.loads((B/'content.json').read_text())
sources=data['sources']
sources['env']=['Environment variables','https://docs.termius.com/terminal/environment-variables']
sources['aiwidget']=['AI widget settings','https://docs.termius.com/help-center/faq/how-can-i-hide-the-ai-widget']
sources['home']=['Product overview and multiplayer','https://www.termius.com/']
data['pages'][7]['sources'] += ['env','aiwidget']
data['pages'][10]['sources'] += ['home']
refs={k:i+1 for i,k in enumerate(sources)}
d=Document(); sec=d.sections[0]
sec.top_margin=Inches(.65);sec.bottom_margin=Inches(.65)
sec.left_margin=sec.right_margin=Inches(.75)
sec.page_width=Inches(8.27);sec.page_height=Inches(11.69)
for name in ['Normal','Title','Subtitle','Heading 1','Heading 2','Heading 3']:
 st=d.styles[name]; st.font.name='Calibri';st.font.color.rgb=RGBColor(0,0,0)
 st.paragraph_format.space_after=Pt(7)
d.styles['Normal'].font.size=Pt(11.5)
d.styles['Normal'].paragraph_format.line_spacing=1.12
d.styles['Title'].font.size=Pt(29)
d.styles['Heading 1'].font.size=Pt(23)
d.styles['Heading 2'].font.size=Pt(13)
d.styles['Heading 2'].paragraph_format.space_before=Pt(12)
d.styles['Subtitle'].font.size=Pt(14)
for border in list(d.styles.element.iter(qn('w:pBdr'))):
 border.getparent().remove(border)
hdr=sec.header.paragraphs[0];hdr.text='TERMIUS   /   FEATURE REFERENCE'
hdr.style=d.styles['Normal'];hdr.runs[0].font.size=Pt(8)
foot=sec.footer.paragraphs[0];foot.alignment=WD_ALIGN_PARAGRAPH.RIGHT
foot.add_run('Reviewed 27 October 2026   |   ')
field=OxmlElement('w:fldSimple');field.set(qn('w:instr'),'PAGE');foot._p.append(field)
for run in foot.runs:run.font.size=Pt(8)

def hyperlink(p,label,url):
 rel=p.part.relate_to(url,'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',is_external=True)
 h=OxmlElement('w:hyperlink');h.set(qn('r:id'),rel)
 r=OxmlElement('w:r');pr=OxmlElement('w:rPr');c=OxmlElement('w:color');c.set(qn('w:val'),'174A70');pr.append(c)
 r.append(pr);t=OxmlElement('w:t');t.text=label;r.append(t);h.append(r);p._p.append(h)

for i,page in enumerate(data['pages']):
 if i:d.add_page_break()
 d.add_paragraph(page['title'], 'Title' if i==0 else 'Heading 1')
 if page.get('intro'):d.add_paragraph(page['intro'],'Subtitle')
 for title,body in page['sections']:
  d.add_paragraph(title,'Heading 2');d.add_paragraph(body)
 if page.get('image'):
  image=B/'assets'/f"{page['image']}.png"
  p=d.add_paragraph();p.add_run().add_picture(str(image),width=Inches(6.6))
  p=d.add_paragraph('Official documentation screenshot for workflow reference')
  p.runs[0].italic=True;p.runs[0].font.size=Pt(8)
 p=d.add_paragraph('Sources  '+', '.join(f'[{refs[k]:02}]' for k in page['sources']))
 p.runs[0].font.size=Pt(9)

d.add_page_break();d.add_paragraph('Feature availability catalogue','Heading 1')
d.add_paragraph('Minimum plan shown below. Paid tiers inherit lower-tier capabilities. Platform restrictions and disputed entitlements still apply.')
t=d.add_table(rows=1,cols=3);t.autofit=False
for c,w in zip(t.columns,[1.65,1.18,3.94]):c.width=Inches(w)
for c,txt in zip(t.rows[0].cells,['Category','Minimum','Coverage']):c.text=txt
for row in data['matrix']:
 for c,txt in zip(t.add_row().cells,row):c.text=txt
for ri,row in enumerate(t.rows):
 for ci,c in enumerate(row.cells):
  c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
  tcpr=c._tc.get_or_add_tcPr();sh=OxmlElement('w:shd');sh.set(qn('w:fill'),'173A52' if ri==0 else ('F0F4F7' if ri%2 else 'FFFFFF'));tcpr.append(sh)
  mar=OxmlElement('w:tcMar')
  for edge in ['top','bottom','left','right']:
   e=OxmlElement('w:'+edge);e.set(qn('w:w'),'90');e.set(qn('w:type'),'dxa');mar.append(e)
  tcpr.append(mar)
  borders=OxmlElement('w:tcBorders')
  for edge in ['top','bottom','left','right']:
   e=OxmlElement('w:'+edge);e.set(qn('w:val'),'single');e.set(qn('w:sz'),'4');e.set(qn('w:color'),'D9D9D9');borders.append(e)
  tcpr.append(borders)
  for p in c.paragraphs:
   p.paragraph_format.space_after=Pt(2);p.paragraph_format.line_spacing=1.05
   for r in p.runs:r.font.size=Pt(9);r.font.bold=ri==0;r.font.color.rgb=RGBColor.from_string('FFFFFF' if ri==0 else '000000')
 repeat=OxmlElement('w:tblHeader')
 if ri==0:row._tr.get_or_add_trPr().append(repeat)
d.add_paragraph(f'Source [{refs["pricing"]:02}]  Public comparison; cloud eligibility disputed as explained in the guide.')

d.add_page_break();d.add_paragraph('Source directory','Heading 1')
d.add_paragraph('Official Termius pages reviewed for this guide. URLs are clickable. Product screenshots come from the corresponding documentation. The guide is a dated research snapshot; current checkout and app behavior take precedence for purchasing decisions.')
for key,(title,url) in sources.items():
 p=d.add_paragraph();hyperlink(p,f'[{refs[key]:02}]  {title}',url)
 p.paragraph_format.space_after=Pt(5)
 for r in p.runs:r.font.size=Pt(10)
out=ROOT/'docs/termius/Termius_Feature_Guide.docx';d.save(out)
(B/'content.json').write_text(json.dumps(data,indent=2))
print(out)
assert len(d.tables)==1 and len(data['pages'])==13
