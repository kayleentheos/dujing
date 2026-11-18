import asyncio
from playwright.async_api import async_playwright
BASE = "http://127.0.0.1:8765/index.html"
SEED = """() => {
 const mk=(w,py,pos,def,refs)=>({schema:1,id:w+'|'+py,word:w,pinyin:py,pos,definition:def,senses:def.split('; '),kind:'dictionary',firstRef:refs[0][0],
   refs:refs.map(([id,zh,en])=>{const [b,c,v]=id.split('.');return {verseId:id,book:b,bookZh:'约翰福音',bookEn:'John',chapter:+c,verse:+v,zh,en,contextual:null,addedAt:'2026-11-16T20:00:00Z'}}),
   addedAt:'2026-11-16T20:00:00Z',updatedAt:'2026-11-16T20:00:00Z',review:{seen:0,flips:0,history:[]}});
 const all={};
 [mk('生命','shēng mìng','noun','life (as the characteristic of living beings); living being; creature',[['JHN.1.4','生命在他里头，这生命就是人的光。','In him was life, and the life was the light of men.'],['JHN.5.26','因为父怎样在自己有生命，就赐给他儿子也照样在自己有生命，','For as the Father has life in himself, even so he gave to the Son also to have life in himself.']]),
  mk('恩典','ēn diǎn','noun','favor; grace',[['JHN.1.14','道成了肉身，住在我们中间，充充满满地有恩典有真理。我们也见过他的荣光，正是父独生子的荣光。','The Word became flesh and lived among us. We saw his glory, such glory as of the only born Son of the Father, full of grace and truth.']]),
  mk('权柄','quán bǐng','noun','authority',[['JHN.1.12','凡接待他的，就是信他名的人，他就赐他们权柄作　神的儿女。','But as many as received him, to them he gave the right to become God’s children, to those who believe in his name:']])].forEach(r=>all[r.id]=r);
 localStorage.setItem('dujing:coll:vocab', JSON.stringify(all)); }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        for name, vp in [("d", {"width": 1366, "height": 860}), ("m", {"width": 390, "height": 844})]:
            ctx = await b.new_context(viewport=vp); page = await ctx.new_page()
            await page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
            await page.goto(BASE + "#home"); await page.evaluate(SEED)
            await page.goto(BASE + "#vocab"); await page.reload(); await page.wait_for_selector(".vocab-entry"); await page.wait_for_timeout(300)
            await page.screenshot(path=f"shots/{name}-vocab.png")
            await page.click(".vocab-entry__word >> text=生命"); await page.wait_for_selector(".word-verse"); await page.wait_for_timeout(200)
            await page.screenshot(path=f"shots/{name}-word.png", full_page=True)
            await page.goto(BASE + "#cards"); await page.wait_for_selector(".card")
            await page.screenshot(path=f"shots/{name}-card-front.png")
            await page.click(".card"); await page.wait_for_timeout(700)
            await page.screenshot(path=f"shots/{name}-card-back.png")
            await ctx.close()
        await b.close()
asyncio.run(main())
