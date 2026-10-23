/* Viking Culture image importer. OCR runs in the browser; screenshots are not uploaded. */
(() => {
  "use strict";
  const $p = id => document.getElementById(id);
  const BASE_W = 1536, BASE_H = 709;
  const TYPES = {
    buildings: [
      {id:"bee",name:"벌집",prod:"벌통",level:[91,118,171,152],count:[181,51,232,102]},
      {id:"fishpier",name:"부두",prod:"어업 부두",level:[222,118,301,151],count:[310,51,362,102]},
      {id:"expedition",name:"탐험 부두",prod:"원정 부두",level:[220,250,307,285],count:[310,184,361,236]},
      {id:"tavern",name:"선술집",prod:null,level:[91,380,171,417],count:[182,314,232,375]},
      {id:"workerhome",name:"일꾼의 집",home:"Home_Worker",level:[222,382,304,415],count:[304,312,360,368]},
      {id:"sailorhome",name:"선원의 집",home:"Home_Sailor",level:[91,513,176,548],count:[181,451,233,503]}
    ],
    stock: [
      {id:"penny",name:"페니",box:[438,8,517,41],target:"penny"},
      {id:"honey",name:"꿀",box:[538,9,625,42],target:"벌통"},
      {id:"fish",name:"생선",box:[630,9,731,41],target:"어업 부두"},
      {id:"mead",name:"벌꿀 술(미드)",box:[367,182,457,217],target:"미드"},
      {id:"pottery",name:"도자기 보물",box:[684,182,764,219],target:"도자기 보물"},
      {id:"gold",name:"황금 보물",box:[1000,182,1080,220],target:"황금 보물"},
      {id:"dried",name:"건어물",box:[367,260,449,299],target:"건어물"},
      {id:"spice",name:"향신료 보물",box:[686,261,763,302],target:"향신료 보물"},
      {id:"gem",name:"보석 보물",box:[1002,263,1087,300],target:"보석 보물"}
    ]
  };
  let ocrWorker = null, busy = false, findings = [];

  function setStatus(message, error=false) {
    const el=$p("photoStatus");
    el.textContent=message;
    el.classList.toggle("bad",error);
  }
  function makeEntry(id,label,value,source,kind,extra="") {
    return {id,label,value,source,kind,extra};
  }
  function numeric(text, level=false) {
    const cleaned=String(text||"").toUpperCase().replace(/\s/g,"").replace(/[O]/g,"0");
    if(level){
      return /^[1-6]$/.test(cleaned)?Number(cleaned):null;
    }
    const match=cleaned.match(/(\d[\d,]*(?:\.\d+)?)([KM]?)/);
    if(!match)return null;
    const raw=Number(match[1].replace(/,/g,""));
    const value=raw*(match[2]==="M"?1e6:match[2]==="K"?1e3:1);
    return Number.isFinite(value)&&value>=0&&value<=1e12?Math.round(value):null;
  }
  async function loadOCR() {
    if(ocrWorker)return ocrWorker;
    if(!window.Tesseract){
      await new Promise((resolve,reject)=>{
        const s=document.createElement("script");
        s.src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
        s.async=true;
        s.onload=resolve;
        s.onerror=()=>reject(new Error("인식 엔진을 불러오지 못했습니다. 인터넷 연결을 확인하세요."));
        document.head.append(s);
      });
    }
    if(!window.Tesseract?.createWorker)throw new Error("사진 인식 엔진이 지원되지 않습니다.");
    const worker=await window.Tesseract.createWorker("eng",1,{logger:()=>{}});
    await worker.setParameters({tessedit_char_whitelist:"0123456789.,KkMmXx",tessedit_pageseg_mode:"7"});
    ocrWorker=worker;
    return worker;
  }
  async function readImage(file){
    if(!file||!file.type.startsWith("image/"))throw new Error("이미지 파일을 선택해주세요.");
    if(file.size>20*1024*1024)throw new Error("20MB 이하 사진을 사용해주세요.");
    const url=URL.createObjectURL(file);
    try {
      const img=new Image();
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error("사진을 열 수 없습니다."));img.src=url;});
      if(Math.abs(img.width/img.height - BASE_W/BASE_H)>0.30)throw new Error("가로형 게임 전체 화면을 캡처해주세요. 현재 화면 비율은 인식하기 어렵습니다.");
      return img;
    } finally { URL.revokeObjectURL(url); }
  }
  function crop(img,box,scale=5){
    const sx=img.width/BASE_W,sy=img.height/BASE_H;
    const [x1,y1,x2,y2]=box;
    const width=Math.max(2,Math.round((x2-x1)*scale));
    const height=Math.max(2,Math.round((y2-y1)*scale));
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);
    ctx.imageSmoothingEnabled=true;
    ctx.drawImage(img,x1*sx,y1*sy,(x2-x1)*sx,(y2-y1)*sy,0,0,width,height);
    return canvas;
  }
  function badgeExists(img,box){
    const canvas=crop(img,box,1);
    const data=canvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
    let colored=0,total=0;
    for(let p=0;p<data.length;p+=4){
      const [r,g,b]=[data[p],data[p+1],data[p+2]];
      if(r>140&&r>g+25&&g>b+13&&g>70&&g<210)colored++;
      total++;
    }
    return colored/total>0.09;
  }
  async function readValue(worker,img,box,isLevel=false){
    const canvas=crop(img,box);
    let result=(await worker.recognize(canvas)).data.text;
    let val=numeric(result,isLevel);
    if(val===null){
      const ctx=canvas.getContext("2d",{willReadFrequently:true});
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      for(let j=0;j<pixels.data.length;j+=4)for(let k=0;k<3;k++)pixels.data[j+k]=255-pixels.data[j+k];
      ctx.putImageData(pixels,0,0);
      result=(await worker.recognize(canvas)).data.text;
      val=numeric(result,isLevel);
    }
    return val;
  }

  // Locate building cards by text, not their fixed row or column.
  let koreanWorker;
  function buildingId(text){
    const v=String(text||"").replace(/[\s.,·"'‘’“”()[\]{}~^\-]/g,"");
    if(/탐험.*부두|원정부두/.test(v))return "expedition";
    if(/일꾼/.test(v))return "workerhome";
    if(/선원|서워의|서원의/.test(v))return "sailorhome";
    if(/선술집|술집/.test(v))return "tavern";
    if(/벌집|벌통|벌질|벌짐|벌진|별집|법집/.test(v))return "bee";
    if(/시청/.test(v))return "ignore";
    if(/어업|부두/.test(v))return "fishpier";
    return null;
  }
  async function koreanOCR(){
    if(koreanWorker)return koreanWorker;
    await loadOCR();
    koreanWorker=await window.Tesseract.createWorker(["kor","eng"],1,{logger:()=>{}});
    return koreanWorker;
  }
  function blackWhite(img,box,zoom=3){
    const cv=crop(img,box,zoom),c=cv.getContext("2d",{willReadFrequently:true}),d=c.getImageData(0,0,cv.width,cv.height);
    for(let i=0;i<d.data.length;i+=4){
      const gray=.299*d.data[i]+.587*d.data[i+1]+.114*d.data[i+2],v=gray>=155?255:0;
      d.data[i]=d.data[i+1]=d.data[i+2]=v;
    }
    c.putImageData(d,0,0);return cv;
  }
  function extractLevels(tsv){
    const groups=new Map();
    for(const row of String(tsv||"").split(/\r?\n/).slice(1)){
      const a=row.split("\t");if(a.length<12||a[0]!=="5"||!a.slice(11).join("\t").trim())continue;
      const key=a.slice(1,5).join(":");
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push({text:a.slice(11).join("\t"),x:Number(a[6]),y:Number(a[7])});
    }
    const arr=[];
    for(const words of groups.values()){
      words.sort((a,b)=>a.x-b.x);
      const found=words.map(w=>w.text).join("").replace(/\s/g,"").match(/레벨([1-6])/);
      if(found)arr.push({x:45+Math.min(...words.map(w=>w.x))/3,y:Math.min(...words.map(w=>w.y))/3,lv:Number(found[1])});
    }
    return arr.filter((c,i)=>arr.findIndex(p=>Math.abs(p.x-c.x)<18&&Math.abs(p.y-c.y)<18)===i);
  }

  // Exact visual fallback for the very short in-game label "부두".
  // Derived solely from the label glyphs, not a hardcoded card position.
  // High threshold avoids treating other dark-backed building names as the pier.
  // The in-game "벌집" card label may not decode reliably through Korean OCR.
  // A position-relative text-glyph check covers that case without binding
  // recognition to a fixed card row or column.
  const BEE_GLYPH="AAAAAAAAAAAAAAA4AAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAAAAAAAAGMYADAAAAAAYxj/MAAAAAB/+P4wAAAAAH/4HDAAAAAAZ7g8MAAAAAB/GH4wAAAAAH8Y57AAAAAAIhjDMAAAAAAf+AAwAAAAgB/4MDAAAADAADg4cAAAAOAf+D/wAAAAwB/wP/AAAACAH/g/8AAAAAAf+D/wAAAA";
  const FISH_PIER_GLYPH="AAAAAAAABAAAAAAAAAAMEAAAAAAKAB7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAYHAAgAAAAAB/8P/AAAAAAH/w7IAAAAAAYHDAAAAAAABgcOAAAAAAAHlw/+AAAAAAf/D/wAAAAAAewAAAAAAAAAAAAAAAAAAB//v/8AAAAAH/+//wAAAAAAYADAAAAAAABgAMAAAAAAAGAAwAAAAAAAYADAAAAAA";
  let fishPierGlyphBits=null;
  function getFishPierBits(){
    if(fishPierGlyphBits)return fishPierGlyphBits;
    const bytes=atob(FISH_PIER_GLYPH),bits=new Uint8Array(64*24);
    for(let i=0;i<bits.length;i++)bits[i]=((bytes.charCodeAt(i>>3)>>(7-(i&7)))&1);
    return (fishPierGlyphBits=bits);
  }
  function looksLikeFishPier(img,card){
    const target=getFishPierBits();
    const canvas=crop(img,[card.x-11,card.y-41,card.x+65,card.y-7],1);
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    // The stored 64x24 glyph appears at +6,+6; compensate for OCR
    // bounding-box offsets without assuming any absolute row or column.
    let best=0;
    for(let dx=2;dx<=10;dx++)for(let dy=2;dy<=10;dy++){
      let both=0,either=0;
      for(let y=0;y<24;y++)for(let x=0;x<64;x++){
        const p=((dy+y)*canvas.width+(dx+x))*4;
        const pixel=.299*data[p]+.587*data[p+1]+.114*data[p+2]>=155?1:0;
        const stored=target[y*64+x];
        if(pixel&&stored)both++;
        if(pixel||stored)either++;
      }
      if(either)best=Math.max(best,both/either);
    }
    return best>=.70;
  }

  let beeGlyphBits=null;
  function looksLikeBee(img,card){
    if(!beeGlyphBits){
      const bytes=atob(BEE_GLYPH),bits=new Uint8Array(64*24);
      for(let i=0;i<bits.length;i++)bits[i]=(bytes.charCodeAt(i>>3)>>(7-(i&7)))&1;
      beeGlyphBits=bits;
    }
    const canvas=crop(img,[card.x-11,card.y-41,card.x+65,card.y-7],1);
    const data=canvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
    let best=0;
    for(let dx=2;dx<=10;dx++)for(let dy=2;dy<=10;dy++){
      let both=0,either=0;
      for(let y=0;y<24;y++)for(let x=0;x<64;x++){
        const p=((dy+y)*canvas.width+(dx+x))*4;
        const pixel=.299*data[p]+.587*data[p+1]+.114*data[p+2]>=155?1:0;
        const stored=beeGlyphBits[y*64+x];
        if(pixel&&stored)both++;
        if(pixel||stored)either++;
      }
      if(either)best=Math.max(best,both/either);
    }
    return best>=.70;
  }

  // Locate count badges without requiring the Korean '레벨' OCR pass to succeed.
  // Template coordinates are RELATIVE to the badge, so card reordering is fine.
  const LABEL_PATTERNS={
    fishpier:"AAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYGAAAAAAAAAAAAAAAAcGD/wAAAAAAAAAAAAAf+DgAAAAAAAAAAAAAAYGDAAAAAAAAAAAAAAAYGDAAAAAAAAAAAAAAAYGD/wAAAAAAAAAAAAAf+B/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB//v/8AAAAAAAAAAAAA//H/8AAAAAAAAAAAAABgAMAAAAAAAAAAAAAABgAMAAAAAAAAAAAAAABgAMAAAAAAAAAAAAAABgAMAAAAAAAAAAAAAAAgAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    bee:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAhjAAYAAAAAAAAAAAAAxjH+YAAAAAAAAAAAAA//B4YAAAAAAAAAAAAA//AwYAAAAAAAAAAAAAxjB4YAAAAAAAAAAAAAzjB8YAAAAAAAAAAAAA/jHOYAAAAAAAAAAAAAADGGYAAAAAAAAAAAAAP/AAYAAAAAAAAAAAAAP/BgYAAAAAAAAAAAAAAHBgYAAAAAAAAAAAAAP/B/4AAAAAAAAAAAAAOABw4AAAAAAAAAAAAAP/B/4AAAAAAAAAAAAAP/B/4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB+AAAAAAAAAAAAAAAMD4AAAAAAAAAAAAAAAAPgAAAAAAAAAAAAAAAA5AAAAAAAAAAAAAAAAA4AAAAAAA",
    tavern:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAMAADAAAAAAAAAAAGDAeA/zAAAAAAAAAAAGDA7AHDAAAAAAAAAAAGfHx4GDAAAAAAAAAAAOfDAYPDAAAAAAAAAAAPDAAAPjAAAAAAAAAAAbjP/85zAAAAAAAAAAA5zAOAwTAAAAAAAAAAAwDD/wACAAAAAAAAAAAADD/wMDAAAAAAAAAAAMDAAwMDAAAAAAAAAAAMAAAwP/AAAAAAAAAAAMAD/wMDAAAAAAAAAAAP/DAAP/AAAAAAAAAAAP/D/4P/AAAAAAAAAAAAAD/4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    expedition:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgIAAAAAAAAAAAAAAGAwYBgMAAAAAAAAAA/mP+YBwcP/AAAAAAAA4GAAYB/8OAAAAAAAAA/Hh4YBgMMAAAAAAAAA/Hj94BgMOAAAAAAAAAwGGO4BwcP/gAAAAAAA72GMYB/8AAAAAAAAAA/2D8YAAAAAAAAAAAAAAGB4YAAAAAAAAAAAAAAAAAAD/+f/wAAAAAAAP+B/4B/+f/wAAAAAAAcOB74AGAA4AAAAAAAAYGBgYAGAAYAAAAAAAAf+B/4AGAAwAAAAAAAAP+B/4AGAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    workerhome:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPDAAAADAABgAAAAAAA/jD7wPjAf5gAAAAAAAxjA4wZzADhgAAAAAAAgjAwwwzADhgAAAAAAAxjAwwwzADhgAAAAAAA7jAwwwzAHxgAAAAAAAfDF74fzAcdgAAAAAAAAAP/8PjAYJgAAAAAAAP/AOAADAAAgAAAAAAAP/AMAADAGBgAAAAAAAADDMAD7AHBgAAAAAAAP/DAA/7AH/gAAAAAAAMADAAADAHBgAAAAAAAP/D/wADAH/gAAAAAAAP/D/wADAH/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    sailorhome:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYABAAAAAAAAAAAADB8YADAABgAAAAAAAGDDOYfjAf5gAAAAAAAGDDGYZzADhgAAAAAAAGfDGYwzADhgAAAAAAAOPB8YwzADhgAAAAAAAPDAQY4zAHxgAAAAAAAZjD/YfzAcdgAAAAAAA5zH/YPjAcJgAAAAAAAgDAwYADAAAgAAAAAAAADAz4ADAGBgAAAAAAAMDAw4D7AHBgAAAAAAAMADgA/7AH/gAAAAAAAMADAAADAHBgAAAAAAAP/D/4ADAH/gAAAAAAAP/B/4ADAH/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
  };
  const BADGE_PATTERNS={
    2:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAfgAAATgAAADAAYgGAAbAcAA+AwAB4BgABwGAADgcAAHBwAAfDAAA2PgADMfwAAAfgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    4:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAAAHgAAAPAAYg+AAbB8AA+GYAA4MwABwzgADh3AAHD/AAfB+AA2A4ADGAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    5:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAAAPgAAAYAAAAwAAYxgAAbDAAA+HwAA4BwABwBgADgDAAHAGAAfAMAA2H4ADGPgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    19:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYGAABweAAHhwAAfDEAYGGIFgMMQPAYZgcAw/g4Bg+BwDAEDgGAIHgMAwDAYHADAweAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
  };
  const LEVEL_PATTERNS={
    2:"AAAAAAAAAAPAfABgDgDADAGAMAMAfgfgAAAAAAAAAAAAAAAA",
    3:"AAAAAAAAAAPAfABgBAHAOADABgBgfAeAAAAAAAAAAAAAAAAA"
  };
  function patternBits(str,n){
    const bytes=atob(str),out=new Uint8Array(n);
    if(bytes.length*8<n)throw new Error("사진 인식 기준 데이터가 손상되었습니다.");
    for(let i=0;i<n;i++)out[i]=(bytes.charCodeAt(i>>3)>>(7-(i&7)))&1;
    return out;
  }
  const labelBits=Object.fromEntries(Object.entries(LABEL_PATTERNS).map(([k,v])=>[k,patternBits(v,108*32)]));
  const badgeBits=Object.fromEntries(Object.entries(BADGE_PATTERNS).map(([k,v])=>[k,patternBits(v,29*29)]));
  const levelBits=Object.fromEntries(Object.entries(LEVEL_PATTERNS).map(([k,v])=>[k,patternBits(v,12*24)]));
  function pixelMask(data,width,x0,y0,w,h,kind){
    const bits=new Uint8Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const ix=x0+x,iy=y0+y;if(ix<0||iy<0||ix>=width||iy>=BASE_H)continue;
      const p=(iy*width+ix)*4,r=data[p],g=data[p+1],b=data[p+2];
      if(kind==="ink"){
        const dx=x-14,dy=y-14;
        bits[y*w+x]=(dx*dx+dy*dy<=144&&r<155&&g<145&&b<100)?1:0;
      }else{
        bits[y*w+x]=((r+g+b)/3>(kind==="level"?170:180)&&Math.max(r,g,b)-Math.min(r,g,b)<65)?1:0;
      }
    }
    return bits;
  }
  function comparePattern(a,b){
    let common=0,either=0;
    for(let i=0;i<a.length;i++){if(a[i]&&b[i])common++;if(a[i]||b[i])either++;}
    return either?common/either:0;
  }
  function matchPattern(data,w,cx,cy,patterns,pw,ph,ox,oy,kind){
    const scores=[];
    for(const [id,pattern] of Object.entries(patterns)){
      let best=0;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        const actual=pixelMask(data,w,cx+ox+dx,cy+oy+dy,pw,ph,kind);
        best=Math.max(best,comparePattern(actual,pattern));
      }
      scores.push([id,best]);
    }
    scores.sort((a,b)=>b[1]-a[1]);
    return {value:scores[0]?.[0]??null,score:scores[0]?.[1]??0,margin:(scores[0]?.[1]??0)-(scores[1]?.[1]??0)};
  }
  function findOrangeBadges(pixels){
    const {data,width:w}=pixels,mask=new Uint8Array(w*BASE_H),seen=new Uint8Array(w*BASE_H),result=[];
    for(let y=25;y<BASE_H-24;y++)for(let x=55;x<430;x++){
      const p=(y*w+x)*4;if(isOrange(data[p],data[p+1],data[p+2]))mask[y*w+x]=1;
    }
    const stack=[];
    for(let y=25;y<BASE_H-24;y++)for(let x=55;x<430;x++){
      const start=y*w+x;if(!mask[start]||seen[start])continue;
      let area=0,left=x,right=x,top=y,bottom=y,sumx=0,sumy=0;
      stack.push(start);seen[start]=1;
      while(stack.length){
        const p=stack.pop(),px=p%w,py=(p-px)/w;
        area++;sumx+=px;sumy+=py;
        left=Math.min(left,px);right=Math.max(right,px);
        top=Math.min(top,py);bottom=Math.max(bottom,py);
        for(let yy=Math.max(25,py-1);yy<=Math.min(BASE_H-25,py+1);yy++)
          for(let xx=Math.max(55,px-1);xx<=Math.min(429,px+1);xx++){
            const at=yy*w+xx;if(mask[at]&&!seen[at]){seen[at]=1;stack.push(at);}
          }
      }
      const ww=right-left+1,hh=bottom-top+1;
      if(area>=450&&area<=1000&&ww>=27&&ww<=39&&hh>=27&&hh<=39){
        result.push({cx:Math.round(sumx/area),cy:Math.round(sumy/area)});
      }
    }
    return result;
  }
  function badgeLocatedCards(img){
    const canvas=document.createElement("canvas");canvas.width=BASE_W;canvas.height=BASE_H;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(img,0,0,BASE_W,BASE_H);
    const pixels=ctx.getImageData(0,0,BASE_W,BASE_H),cards=new Map();
    for(const badge of findOrangeBadges(pixels)){
      const m=matchPattern(pixels.data,BASE_W,badge.cx,badge.cy,labelBits,108,32,-113,18,"label");
      if(m.score<.70||m.margin<.12)continue;
      const lv=matchPattern(pixels.data,BASE_W,badge.cx,badge.cy,levelBits,12,24,-77,49,"level");
      const qty=matchPattern(pixels.data,BASE_W,badge.cx,badge.cy,badgeBits,29,29,-14,-14,"ink");
      const card={x:badge.cx-113,y:badge.cy+50,lv:lv.score>=.79&&lv.margin>=.16?Number(lv.value):null,
        count:qty.score>=.77&&qty.margin>=.17?Number(qty.value):null,badge,fromBadge:true};
      if(!cards.has(m.value))cards.set(m.value,[]);
      cards.get(m.value).push(card);
    }
    return cards;
  }
  async function detectedCardLevel(worker,img,card){
    if(card.lv!==null)return card.lv;
    if(!card.badge)return null;
    await worker.setParameters({tessedit_char_whitelist:"123456",tessedit_pageseg_mode:"10"});
    const b=card.badge;
    return readValue(worker,img,[b.cx-79,b.cy+47,b.cx-63,b.cy+74],true);
  }
  async function locateCards(img){
    const ocr=await koreanOCR();
    await ocr.setParameters({tessedit_pageseg_mode:"11"});
    const result=await ocr.recognize(blackWhite(img,[45,0,430,BASE_H]),{}, {tsv:true});
    const cards=extractLevels(result.data.tsv),recognized=new Map();
    await ocr.setParameters({tessedit_pageseg_mode:"7"});
    for(const card of cards){
      const region=[card.x-8,card.y-37,card.x+72,card.y-9];
      const name=(await ocr.recognize(blackWhite(img,region,4))).data.text;
      let id=buildingId(name);
      if(!id)id=buildingId((await ocr.recognize(crop(img,region,4))).data.text);
      if(!id&&looksLikeBee(img,card))id="bee";
      if(!id&&looksLikeFishPier(img,card))id="fishpier";
      if(!id||id==="ignore")continue;
      if(!recognized.has(id))recognized.set(id,[]);
      const entries=recognized.get(id);
      if(!entries.some(x=>Math.abs(x.x-card.x)<18&&Math.abs(x.y-card.y)<18))entries.push(card);
    }
    return recognized;
  }
  function isOrange(r,g,b){return r>175&&g>98&&g<227&&b<140&&r>g+30&&g>b+20;}
  function badgeAt(pixels,x,y){
    const {data,width,height}=pixels;let best=null;
    for(let cx=Math.round(x+98);cx<=Math.round(x+120);cx+=2){
      for(let cy=Math.round(y-63);cy<=Math.round(y-34);cy+=2){
        let ok=0,all=0;
        for(let dx=-18;dx<=18;dx+=3)for(let dy=-18;dy<=18;dy+=3){
          const r2=dx*dx+dy*dy;if(r2<145||r2>312)continue;
          const px=cx+dx,py=cy+dy;
          if(px<0||py<0||px>=width||py>=height)continue;
          const n=(py*width+px)*4;
          if(isOrange(data[n],data[n+1],data[n+2]))ok++;
          all++;
        }
        const rate=all?ok/all:0,score=rate-.008*(Math.abs(cx-x-108)+Math.abs(cy-y+49));
        if(rate>=.47&&(!best||score>best.score))best={cx,cy,score};
      }
    }
    return best;
  }
  async function badgeQuantity(worker,img,badge){
    const source=crop(img,[badge.cx-20,badge.cy-20,badge.cx+20,badge.cy+20],6);
    const cv=document.createElement("canvas");cv.width=156;cv.height=192;
    cv.getContext("2d").drawImage(source,source.width*.25,source.height*.10,source.width*.65,source.height*.80,0,0,156,192);
    await worker.setParameters({tessedit_char_whitelist:"0123456789",tessedit_pageseg_mode:"13"});
    let value=numeric((await worker.recognize(cv)).data.text);
    if(value===null||value<1||value>10000){
      await worker.setParameters({tessedit_pageseg_mode:"10"});
      value=numeric((await worker.recognize(cv)).data.text);
    }
    return value!==null&&value>=1&&value<=10000?value:null;
  }
  async function recognizeBuildings(img,worker){
    const cards=badgeLocatedCards(img);
    // OCR remains a secondary route for single buildings without count badges.
    if(TYPES.buildings.some(item=>!cards.has(item.id))){
      try{
        const ocrCards=await locateCards(img);
        for(const [id,card] of ocrCards){
          if(!cards.has(id)&&card)cards.set(id,[card]);
        }
      }catch(e){console.warn("보조 건물 OCR 실패",e);}
    }
    const cv=document.createElement("canvas");cv.width=BASE_W;cv.height=BASE_H;
    const ctx=cv.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(img,0,0,BASE_W,BASE_H);
    const pixels=ctx.getImageData(0,0,BASE_W,BASE_H);
    const rows=[];
    for(const item of TYPES.buildings){
      const found=cards.get(item.id)||[];
      if(!found.length){
        rows.push(makeEntry(item.id+"_lv",item.name+" 레벨",null,"buildings","level","건물명 미인식 · 직접 확인"));
        rows.push(makeEntry(item.id+"_count",item.name+" 수량",null,"buildings","count","건물명 미인식 · 직접 확인"));
        continue;
      }
      const cardsWithCounts=[];
      for(const card of found){
        setStatus(item.name+" 수량 인식 중…");
        const badge=card.badge||badgeAt(pixels,card.x,card.y);
        const count=card.count!==undefined&&card.count!==null?card.count:(badge?await badgeQuantity(worker,img,badge):1);
        const lv=card.lv!==null&&card.lv!==undefined?card.lv:await detectedCardLevel(worker,img,card);
        cardsWithCounts.push({...card,lv,count,extra:lv===null?"레벨 인식 실패 · 직접 확인":!badge?"배지 없음 · 1개":count===null?"배지 숫자 인식 실패":""});
      }
      if(item.home&&cardsWithCounts.length>1&&cardsWithCounts.some(c=>c.lv===null)){
        rows.push(makeEntry(item.id+"_lv",item.name+" 레벨",null,"buildings","level","복수 주택의 레벨을 확인해야 합니다"));
        rows.push(makeEntry(item.id+"_count",item.name+" 수량",null,"buildings","count","서로 다른 레벨의 수량을 직접 확인"));
      }else if(item.home&&cardsWithCounts.length>1){
        // Multiple cards for one type of house may have different levels.
        // Preserve each level instead of discarding both duplicate names.
        const groups=new Map();
        for(const card of cardsWithCounts){
          if(!groups.has(card.lv))groups.set(card.lv,[]);
          groups.get(card.lv).push(card);
        }
        for(const [lv,group]of [...groups].sort((a,b)=>a[0]-b[0])){
          const count=group.some(c=>c.count===null)?null:group.reduce((sum,c)=>sum+c.count,0);
          rows.push(makeEntry(item.id+"_mix_"+lv,item.name+" Lv."+lv+" 수량",count,"buildings","count",count===null?"배지 숫자 인식 실패 · 직접 확인":"서로 다른 레벨을 구분해 도시 관리에 반영"));
        }
      }else if(cardsWithCounts.length>1){
        // Never silently choose one of multiple production configurations.
        rows.push(makeEntry(item.id+"_lv",item.name+" 레벨",null,"buildings","level","여러 레벨의 건물 발견 · 상세 설정에서 직접 확인"));
        rows.push(makeEntry(item.id+"_count",item.name+" 수량",null,"buildings","count","여러 건물 카드 발견 · 상세 설정에서 직접 확인"));
      }else{
        const card=cardsWithCounts[0];
        rows.push(makeEntry(item.id+"_lv",item.name+" 레벨",card.lv,"buildings","level",card.lv===null?"레벨 인식 실패 · 직접 확인":""));
        rows.push(makeEntry(item.id+"_count",item.name+" 수량",card.count,"buildings","count",card.extra));
      }
    }
    await worker.setParameters({tessedit_char_whitelist:"0123456789.,KkMmXx",tessedit_pageseg_mode:"7"});
    return rows;
  }

  function review(){
    const root=$p("photoReview");
    root.replaceChildren();
    if(!findings.length){$p("photoApply").disabled=true;return;}
    const table=document.createElement("table");
    table.className="photo-table";
    const header=document.createElement("thead");
    header.innerHTML="<tr><th>적용</th><th>항목</th><th>인식된 값 · 수정 가능</th></tr>";
    table.append(header);
    const body=document.createElement("tbody");
    for(const entry of findings){
      const tr=document.createElement("tr"),a=document.createElement("td"),b=document.createElement("td"),c=document.createElement("td");
      const check=document.createElement("input");
      check.type="checkbox";check.className="photo-select";check.checked=entry.value!==null;check.setAttribute("aria-label",entry.label+" 적용");
      check.dataset.id=entry.id;
      a.append(check);
      b.textContent=entry.label;
      if(entry.extra){const small=document.createElement("small");small.className="photo-caution";small.textContent=entry.extra;b.append(small);}
      const number=document.createElement("input");
      number.type="text";number.inputMode="decimal";number.className="photo-amount";
      number.value=entry.value===null?"":String(entry.value);
      number.dataset.id=entry.id;
      number.setAttribute("aria-label",entry.label+" 인식값");
      number.placeholder="인식 실패 · 직접 입력";
      number.addEventListener("input",()=>{if(number.value.trim()!=="")check.checked=true;});
      c.append(number);tr.append(a,b,c);body.append(tr);
    }
    table.append(body);root.append(table);
    $p("photoApply").disabled=false;
  }
  async function scan(){
    if(busy)return;
    const building=$p("photoBuildings").files[0], goods=$p("photoStocks").files[0];
    if(!building&&!goods){setStatus("건물 사진 또는 생산물 사진을 선택하세요.",true);return;}
    busy=true;$p("photoScan").disabled=true;$p("photoApply").disabled=true;
    try{
      setStatus("인식 엔진 준비 중… 처음 이용할 때 다운로드가 필요합니다.");
      const imgs={};
      if(building)imgs.buildings=await readImage(building);
      if(goods)imgs.stock=await readImage(goods);
      const worker=await loadOCR();
      const total=(imgs.buildings?TYPES.buildings.length*2:0)+(imgs.stock?TYPES.stock.length:0);
      let done=0;
      const results=[];
      if(imgs.buildings){
        setStatus("건물 이름과 레벨 표시를 검색하는 중…");
        try{results.push(...await recognizeBuildings(imgs.buildings,worker));}
        catch(err){
          for(const item of TYPES.buildings){
            results.push(makeEntry(item.id+"_lv",item.name+" 레벨",null,"buildings","level","한글 카드 분석 실패 · 직접 입력"));
            results.push(makeEntry(item.id+"_count",item.name+" 수량",null,"buildings","count","한글 카드 분석 실패 · 직접 입력"));
          }
          setStatus(err?.message||"건물 분석 실패. 자원 사진 분석은 진행합니다.",true);
        }
        done+=TYPES.buildings.length*2;
      }
      if(imgs.stock){
        for(const item of TYPES.stock){
          setStatus("생산물 사진 분석 중… "+(done+1)+"/"+total);
          const value=await readValue(worker,imgs.stock,item.box);done++;
          results.push(makeEntry(item.id,item.name,value,"stock","stock",item.id==="penny"?"K 단위 표시는 반올림된 근삿값":""));
        }
      }
      findings=results;
      review();
      const recognized=results.filter(item=>item.value!==null).length;
      setStatus("분석 완료: "+recognized+"/"+results.length+"개 인식. 숫자를 확인·수정한 뒤 적용하세요.");
    }catch(err){setStatus(err?.message||"사진 인식에 실패했습니다.",true);}
    finally{busy=false;$p("photoScan").disabled=false;}
  }
  function apply(){
    if(busy)return;
    const values={};
    let selected=0;
    for(const check of $p("photoReview").querySelectorAll(".photo-select")){
      if(!check.checked)continue;
      const input=$p("photoReview").querySelector('.photo-amount[data-id="'+check.dataset.id+'"]');
      const original=findings.find(f=>f.id===check.dataset.id);
      const value=numeric(input.value,original?.kind==="level");
      if(value===null){setStatus(original.label+" 항목의 숫자를 확인하세요.",true);input.focus();return;}
      if(original.kind==="level"&&(value<1||value>6)){setStatus(original.label+" 레벨은 1~6이어야 합니다.",true);input.focus();return;}
      if(original.kind==="count"&&value>10000){setStatus(original.label+" 수량을 확인하세요.",true);input.focus();return;}
      values[check.dataset.id]=value;selected++;
    }
    if(!selected){setStatus("적용할 항목을 체크하세요.",true);return;}
    const affected=TYPES.buildings.filter(item=>item.prod&&(values[item.id+"_lv"]!==undefined||values[item.id+"_count"]!==undefined)).map(item=>item.prod);
    if(values.tavern_lv!==undefined||values.tavern_count!==undefined)affected.push("미드","건어물");
    const active=[...new Set(affected)].filter(b=>app.details?.[b]?.enabled);
    if(active.length&&!window.confirm("상세 설정이 적용 중인 건물이 있습니다: "+active.join(", ")+"\n사진의 기본 수량·레벨을 반영하려면 해당 상세 설정을 해제해야 합니다. 계속하시겠습니까?"))return;
    for(const b of active)app.details[b].enabled=false;
    for(const item of TYPES.buildings){
      const lv=values[item.id+"_lv"],count=values[item.id+"_count"];
      if(item.home){
        const mixed=Object.entries(values)
          .filter(([key])=>key.startsWith(item.id+"_mix_"))
          .map(([key,value])=>({lv:Number(key.slice((item.id+"_mix_").length)),count:value}))
          .filter(group=>group.lv>=1&&group.lv<=6);
        if(mixed.length){
          app.city.homeMix??={};
          app.city.homeMix[item.home]=mixed;
          const total=mixed.reduce((sum,g)=>sum+g.count,0);
          const main=[...mixed].sort((a,b)=>b.count-a.count)[0];
          app.city.homes[item.home]={lv:main.lv,count:total};
        }else if(lv!==undefined||count!==undefined){
          if(app.city.homeMix)delete app.city.homeMix[item.home];
          if(lv!==undefined)app.city.homes[item.home].lv=lv;
          if(count!==undefined)app.city.homes[item.home].count=count;
        }
      } else if(item.prod){
        const s=app.buildings[item.prod];
        if(lv!==undefined){s.lv=closestAvailableLevel(item.prod,lv);s.mode=modeForLevel(item.prod,s.lv,s.mode);}
        if(count!==undefined)s.bldgs=count;
        const map={bee:"Beehive_Average",fishpier:"FishingPier_Average",expedition:"ExpeditionPier_Average"};
        if(map[item.id])delete app.city.manual[map[item.id]];
      }
    }
    const tavernLv=values.tavern_lv,tavernCount=values.tavern_count;
    if(tavernCount!==undefined){
      app.city.manual.Workshop_Tavern=tavernCount;
      if(tavernLv!==undefined&&tavernLv<4){
        app.buildings["미드"].bldgs=tavernCount;
        app.buildings["건어물"].bldgs=0;
      }
    }
    if(tavernLv!==undefined&&tavernLv<4){
      app.buildings["미드"].lv=tavernLv;
      app.buildings["미드"].mode=modeForLevel("미드",tavernLv,app.buildings["미드"].mode);
    }
    const stocks={penny:["city","pennyStock"],honey:["벌통","stock"],fish:["어업 부두","stock"],mead:["미드","stock"],dried:["건어물","stock"],pottery:["도자기 보물"],gold:["황금 보물"],spice:["향신료 보물"],gem:["보석 보물"]};
    for(const [key,destination]of Object.entries(stocks)){
      if(values[key]===undefined)continue;
      if(destination[0]==="city")app.city.pennyStock=values[key];
      else if(destination.length===2)app.buildings[destination[0]].stock=values[key];
      else app.treasureStocks[destination[0]]=values[key];
    }
    renderAll();saveState();
    $p("photoImportDialog").close();
    $p("resetStatus").textContent="사진 입력 "+selected+"개 항목 적용 완료";
    if(tavernCount!==undefined&&(tavernLv===undefined||tavernLv>=4)){
      $p("resetStatus").textContent+=" · 선술집 생산별 배분은 직접 확인";
    }
    $p("resetStatus").scrollIntoView({block:"nearest",behavior:"smooth"});
  }
  $p("photoImportBtn").addEventListener("click",()=>{$p("photoImportDialog").showModal();});
  $p("photoImportClose").addEventListener("click",()=>$p("photoImportDialog").close());
  $p("photoScan").addEventListener("click",scan);
  $p("photoApply").addEventListener("click",apply);
})();
