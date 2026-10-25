/* Viking Culture image importer. OCR runs in the browser; screenshots are not uploaded. */
(() => {
  "use strict";
  const $p = id => document.getElementById(id);
  const BASE_W = 1536, BASE_H = 709;
  const TYPES = {
    buildings: [
      {id:"bee",name:"벌집",prod:"벌집",level:[91,118,171,152],count:[181,51,232,102]},
      {id:"fishpier",name:"부두",prod:"부두",level:[222,118,301,151],count:[310,51,362,102]},
      {id:"expedition",name:"탐험 부두",prod:"탐험 부두",level:[220,250,307,285],count:[310,184,361,236]},
      {id:"harbor",name:"선원 항구",prod:"선원 항구"},
      {id:"tavern",name:"선술집",prod:null,level:[91,380,171,417],count:[182,314,232,375]},
      {id:"workerhome",name:"일꾼의 집",home:"Home_Worker",level:[222,382,304,415],count:[304,312,360,368]},
      {id:"sailorhome",name:"선원의 집",home:"Home_Sailor",level:[91,513,176,548],count:[181,451,233,503]}
    ],
    stock: [
      {id:"penny",name:"페니",box:[448,14,510,39],target:"penny"},
      {id:"honey",name:"꿀",box:[556,14,617,39],target:"벌집"},
      // The fish icon extends through x=658. Start after it so OCR cannot
      // mistake the icon for a leading digit (320.4K -> 8320.4K).
      {id:"fish",name:"생선",box:[662,14,726,39],target:"부두"},
      {id:"mead",name:"벌꿀 술",box:[367,182,457,217],target:"벌꿀 술"},
      {id:"pottery",name:"도자기 보물",box:[684,182,764,219],target:"도자기 보물"},
      {id:"gold",name:"황금 보물",box:[1000,182,1080,220],target:"황금 보물"},
      {id:"dried",name:"건어물",box:[376,269,449,302],target:"건어물"},
      {id:"spice",name:"향신료 보물",box:[686,269,770,302],target:"향신료 보물"},
      {id:"gem",name:"보석 보물",box:[997,269,1090,302],target:"보석 보물"}
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
    const match=cleaned.match(/^(?:[X×])?(\d[\d,]*(?:\.\d+)?)([KM]?)$/);
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

  function stockVariant(img,box,mode){
    const cv=crop(img,box,mode==='original'?5:6);
    if(mode==='original')return cv;
    const ctx=cv.getContext('2d',{willReadFrequently:true}),d=ctx.getImageData(0,0,cv.width,cv.height);
    // Stock dialogs dim the game header. A fixed 145 threshold can erase
    // every fish digit; adapt to the brightness of this icon-free number crop.
    let fishThreshold=145;
    if(box[1]<60&&box[0]>=660&&box[0]<670){
      let brightest=0;
      for(let i=0;i<d.data.length;i+=4)brightest=Math.max(brightest,.299*d.data[i]+.587*d.data[i+1]+.114*d.data[i+2]);
      fishThreshold=Math.max(45,brightest*.65);
    }
    for(let i=0;i<d.data.length;i+=4){
      const r=d.data[i],g=d.data[i+1],b=d.data[i+2],gray=.299*r+.587*g+.114*b;
      // Header digits are light on dark; stock-panel digits are dark on light.
      const header=box[1]<60;
      const v=mode==='contrast'?(header?255-gray:gray):(header?(gray>fishThreshold?0:255):(gray<135?0:255));
      d.data[i]=d.data[i+1]=d.data[i+2]=v;
    }
    ctx.putImageData(d,0,0);
    let left=0,top=0,right=cv.width,bottom=cv.height;
    if(mode==='binary'){
      left=cv.width;top=cv.height;right=0;bottom=0;
      for(let y=0;y<cv.height;y++)for(let x=0;x<cv.width;x++){
        if(d.data[(y*cv.width+x)*4]<128){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
      }
      if(right<=left||bottom<=top){left=0;top=0;right=cv.width;bottom=cv.height;}
    }
    const padded=document.createElement('canvas');padded.width=right-left+20;padded.height=bottom-top+20;
    const c=padded.getContext('2d');c.fillStyle='white';c.fillRect(0,0,padded.width,padded.height);c.drawImage(cv,left,top,right-left,bottom-top,10,10,right-left,bottom-top);
    return padded;
  }
  function stockConsensus(readings){
    const valid=readings.filter(r=>r.value!==null), votes=new Map();
    for(const r of valid)votes.set(r.value,(votes.get(r.value)||0)+1);
    const ranked=[...votes].sort((a,b)=>b[1]-a[1]);
    const agreed=ranked.length>0&&ranked[0][1]>=2;
    const conflict=ranked.length>1;
    return {value:ranked.length?(agreed||ranked.length===1?ranked[0][0]:null):null,
      candidates:ranked.map(([value])=>value),
      needsReview:!agreed||conflict, approximate:valid.some(r=>/[KM]/i.test(r.text)),
      extra:conflict?'인식 결과 불일치: '+ranked.map(r=>r[0]).join(' / ')+' · 직접 확인':
        !agreed?'교차 검증 부족 · 직접 확인':''};
  }

  // Independently count full-height glyphs in the stock panel. OCR agreement
  // alone is insufficient: several variants can all drop the same digits.
  function panelNumberImage(img,box,threshold=135){
    const cv=crop(img,box,4),ctx=cv.getContext('2d',{willReadFrequently:true});
    const {data}=ctx.getImageData(0,0,cv.width,cv.height),w=cv.width,h=cv.height;
    const mask=new Uint8Array(w*h),seen=new Uint8Array(w*h),parts=[];
    for(let i=0;i<mask.length;i++)mask[i]=.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2]<threshold?1:0;
    for(let i=0;i<mask.length;i++){
      if(!mask[i]||seen[i])continue;
      const stack=[i],points=[];seen[i]=1;
      let left=w,right=0,top=h,bottom=0;
      while(stack.length){
        const p=stack.pop(),x=p%w,y=Math.floor(p/w);points.push(p);
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        for(let yy=Math.max(0,y-1);yy<=Math.min(h-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(w-1,x+1);xx++){
          const q=yy*w+xx;if(mask[q]&&!seen[q]){seen[q]=1;stack.push(q);}
        }
      }
      parts.push({left,right,top,bottom,points});
    }
    const tallest=Math.max(0,...parts.map(p=>p.bottom-p.top+1));
    const digits=parts.filter(p=>p.bottom-p.top+1>=Math.max(20,tallest*.65)&&p.points.length>=30);
    if(!digits.length)return null;
    const top=Math.min(...digits.map(p=>p.top)),bottom=Math.max(...digits.map(p=>p.bottom));
    // Reject non-aligned shapes instead of claiming a reliable digit count.
    if(digits.some(p=>Math.abs(p.top-top)>(bottom-top+1)*.25))return null;
    // Touching the crop edge or implausibly wide components can indicate a
    // clipped digit, adjacent icon, or merged digits. Do not trust that count.
    const height=bottom-top+1;
    if(digits.some(p=>p.left===0||p.right===w-1||p.top===0||p.bottom===h-1||p.right-p.left+1>height*.95))return null;
    digits.sort((a,b)=>a.left-b.left);
    const left=Math.min(...digits.map(p=>p.left)),right=Math.max(...digits.map(p=>p.right));
    const result=document.createElement('canvas');result.width=right-left+33;result.height=bottom-top+33;
    const c=result.getContext('2d'),d=c.createImageData(result.width,result.height);d.data.fill(255);
    for(const part of digits)for(const p of part.points){
      const i=((Math.floor(p/w)-top+16)*result.width+(p%w)-left+16)*4;
      d.data[i]=d.data[i+1]=d.data[i+2]=0;
    }
    c.putImageData(d,0,0);
    return {canvas:result,count:digits.length,digits:digits.map(part=>{
      const digit=document.createElement('canvas');digit.width=part.right-part.left+33;digit.height=height+32;
      const c=digit.getContext('2d');c.fillStyle='white';c.fillRect(0,0,digit.width,digit.height);
      c.drawImage(result,part.left-left+16,16,part.right-part.left+1,height,16,16,part.right-part.left+1,height);
      return digit;
    })};
  }

  const STOCK_DIGIT_PATTERNS={"0":["AAAAH4AH/AB/4A//APnwHw+B8PgfB4HgeB4Hg+B8PgfD4Hw+B8PgfD4Hw+B8PgfD4HweB8HgeB4HgfD4Hw+B8PgPnwD/8Af+AH/gA/gAAAA=","AAAADwAD/AB/4A//AP/wHw8B4PgeB4HgeB4HgeB4HgeB4HgeB4HgeB4HgeB4HgeB4HgeB4HgeB4HgeB4Hg+B8PgPnwD/8A/+AH/AA/gAAAA=","AAAAP4AH/AB/4A/+APvwHx8B4PgeD4PgeD4Hg+B4PgfD4Hw+B8PgfD4Hw+B8PgfD4Hw+B4PgeD4HgeD4Hg+B8fAPvwD/4A/+AH/AA/gAAAA="],"1":["AAAAAeAAPgAH8AD/AB/wA/8Af/AP3wBx8AIfAAHwAB8AAfAAHwAB8AAfAAHwAB8AAfAAHwAB8AAfAAHwAB8AAfAAHwAB8AAfAAHwAB4AAAA=","AAAAAeAAPgAH4AD+AB/gA/4Af+AH3gBx4AAeAAHgAB4AAeAAHgAB4AAeAAHgAB4AAeAAHgAB4AAeAAHgAB4AAeAAHgAB4AAeAAHgAB4AAAA="],"2":["AAAAP4AH/gD/8B//Af/wDB+AAfgAD4AA+AAPgAD4AB8AAfAAHwAD8AB+AAfAAPwAD4AB8AA+AAPgAHwAD4AB+AAfyAH//D//w//8H//AAAA=","AAAAP4AH/gD/8B//Af/wHB+AAPgAD4AA+AAPgAD4AA8AAfAAHwAD4AA+AAfAAPwAD4AB8AA+AAfgAHwAD4AB+AAfwQH//D//wf/8H/+AAAA=","AAAAP4AH/AD/8B//Af/4DB+AAPgAD4AA+AAPgAD4AB8AAfAAHwAD8AB+AAfAAPwAD4AB8AA+AAPgAHwAD4AB+AAfzAH/+D//w//8H/+AAAA="],"3":["AAAAP4AH/gH/8B//AP/4AA+AAPgAD4AA+AAPgADwAB8AB+AD/AA/wAP+AAfwAB+AAPgAB8AAfAAHwAB8AA/AAPgcP4H/8B/+Af/AB/AAAAA=","AAAAPwAP/AH/8B//Af/wAB+AAPgAD4AA+AAPgAHwAB8AB+AD/AB/gAf8AB/gAB8AAfgAD4AAeAAHwAB8AA+AAPgQP4P/8D//A//AH/gAAAA=","AAAAf8AP/gH/8B//AOP4AA+AAPgAD4AA+AAPgADwAB8AB+AD/AA/wAP+AAfwAB+AAPgAD8AAfAAHwAB8AA/AAPgwP4P/8D//A//gH/gAAAA="],"4":["AAAAA+AAfwAH8AB/AA/wAP8AH/AD/wA/8AP/ADnwB58A8fAPHwHh8B4fAeHwPB8DwfB//8f//n//5//+H//AAfAAHwAB8AAfAAHwAB4AAAA=","AAAAAeAAPgAH8AB/AA/wAP8AH/AB/wA/8APfAH3wB58AcfAPHwHx8B4fAeHwPB8DwfB+/4f//H//5//+H//AAfAAHwAB8AAfAAHwAB4AAAA=","AAAAA+AAfgAH4AD+AA/gAf4AH+AD/gA/4AP+AHvgB74A8eAfHgHh4B4eA8HgPB8Hw/B//8f//n//5//+P//AA/AAHwAB8AAeAAHgAB4AAAA="],"5":["AAAAf+AP/wH/8B//Af9AHwAB8AAfAAHwAB8AAfAAH/AB/8Af/gH/8A//gAH4AB+AAPgAD4AA+AAPgAD4AB+AAfgcf4H/4B/+Af/AD+AAAAA=","AAAA/+AP/wD/8A/+APgAHwAB8AAeAAHgAB4AAfAAH/AD/+A//wH/8AA/AAH4AA+AAPwAD8AA/AAPwAD4AA+AAfA8fwP/8D/+Af+AD+AAAAA=","AAAAf+AP/wD/8A//AP/gDwAA8AAPAADgAB8AAfAAH/AB/8Af/gH/8AR/AAH4AA+AAPgAB4AAeAAPgAD4AA+AAfg//wP/8D/+Af+AD/AAAAA="],"6":["AAAAB/AA/wA/8AP/AH4AB8AA+AAPAADwAB4AAeAAHjwD//A//wP/+D+fg/D4PgfD4Hw+B8PgfB4HweB8HgfA8PgP34D/8Af/AD/gAfwAAAA=","AAAAB+AB/wA/8Af+AH4AD4AA8AAPAAHgAB4AAeAAHjwB7+Af/wP/+D+fg/D4PweD4Hw+B8HgfB4HweB8HweB8PgPn4D/8Af+AH/gAfgAAAA=","AAAAB/AA/wAf8AP/AH4AD8AA+AAPAAHwAB4AAeAAHzwB9+Af/wP/+D+fg/D4Pw+D8Hw+B8HgfB4HwfB4Hw+A8PgPn4D/8Af/AD/gAfgAAAA="],"7":["AAAB//gf/4P//B//gf/4AA+AAPgADwAB8AAfAAHwAB4AA+AAPgAHwAB8AAfAAHwAD4AA+AAPAAHwAB8AA+AAPgAD4AA+AAfAAHwAB4AAAAA=","AAAB//g//8P//B//wAH4AA+AAPgAD4AA8AAfAAHwAD8AA+AAPgADwAB8AAfAAHgAD4AA+AAfgAHwAB8AAfAAPgAD4AA8AAfAAHwAB4AAAAA=","AAAA//Af/8P//B//wf/8AA+AAPgAD4AB8AAfAAHwAB4AA+AAPgADwAB8AAfAAHwAD4AA+AAPgAHwAB8AA+AAPgAD4AA+AAfAAHwAB8AAAAA="],"8":["AAAAH4AH/gD/8A//Afn4Hw+B4HgeB4HgeB8PgPnwD/8Af+AD/AA/wAf8AH/gD58B8PgeB4HgeB4HgeB4HgeB8Pgfn4D/8A//AH/gAfgAAAA=","AAAAP4AH/gD/8B//AfHwHg+B4HgeB4Hg8B8PAPnwD/4Af8AH/AA/wAf8AP/gH58B8PAeD4HgeB4HgeB4HgeB8Pgfn4H/8A/+AH/AAfAAAAA="],"9":["AAAAH4AH/AD/4A//Af34Hw+B4HgeB4HgeD4Hg+B8HgfB4HwfD8Hx/B//wP/4B+eAHHgAB4AAeAAHgAD4AB8AA/AA/gB/4A/8AP8AD8AAAAA=","AAAAP4AH/AD/4B//Af/wHw+B4Pg+B4PgeD4Hg+B4PgeD4HwfD4Hx+B//gP/4D+eAGHgAB4AAeAAPgAHwAB8AA/AB/gD/wB/4Af4AD8AAAAA="]};
  function stockGlyphSignature(cv){const {data}=cv.getContext('2d').getImageData(0,0,cv.width,cv.height);let l=cv.width,t=cv.height,r=0,b=0;for(let y=0;y<cv.height;y++)for(let x=0;x<cv.width;x++)if(data[(y*cv.width+x)*4]<128){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}const out=document.createElement('canvas');out.width=20;out.height=32;const c=out.getContext('2d');c.fillStyle='white';c.fillRect(0,0,20,32);const scale=Math.min(18/(r-l+1),30/(b-t+1));c.drawImage(cv,l,t,r-l+1,b-t+1,(20-(r-l+1)*scale)/2,(32-(b-t+1)*scale)/2,(r-l+1)*scale,(b-t+1)*scale);const d=c.getImageData(0,0,20,32).data;return Array.from({length:640},(_,i)=>d[i*4]<128?1:0);}
  function readStockGlyphs(glyphs){
    let text='',lowest=1;
    for(const cv of glyphs.digits){
      const actual=stockGlyphSignature(cv);
      const scores=Object.entries(STOCK_DIGIT_PATTERNS).map(([digit,patterns])=>({digit,score:Math.max(...patterns.map(p=>comparePattern(actual,patternBits(p,640))))})).sort((a,b)=>b.score-a.score);
      if(scores[0].score<.80||scores[0].score-scores[1].score<.10)return null;
      lowest=Math.min(lowest,scores[0].score);text+=scores[0].digit;
    }
    return {text,value:numeric(text),score:lowest};
  }

  async function readStock(worker,img,box){
    // Modest padding retains the first digit while keeping nearby icons out.
    const area=[box[0]-1,box[1]-1,box[2]+1,box[3]+1],readings=[];
    for(const [mode,psm] of [['original','7'],['contrast','7'],['binary','7']]){
      await worker.setParameters({tessedit_char_whitelist:'0123456789.,KkMm',tessedit_pageseg_mode:psm});
      const text=(await worker.recognize(stockVariant(img,area,mode))).data.text;
      readings.push({text,value:numeric(text),mode});
    }
    let rejected=false,unverifiedDigits=false,glyphs=null;
    if(box[1]>=60){
      glyphs=panelNumberImage(img,area);
      const alternate=panelNumberImage(img,area,110);
      if(!alternate||alternate.count!==glyphs?.count)glyphs=null;
      if(glyphs){
        const visual=readStockGlyphs(glyphs);
        if(visual&&String(visual.value).length===glyphs.count)readings.push({...visual,mode:'게임 글꼴 비교'});
        await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'8'});
        const text=(await worker.recognize(glyphs.canvas)).data.text;
        readings.push({text,value:numeric(text),mode:"숫자 분리"});
        for(const reading of readings){
          if(reading.value!==null&&String(reading.value).length!==glyphs.count){reading.rejectedValue=reading.value;reading.value=null;rejected=true;}
        }
      }else unverifiedDigits=true;
    }
    let result=stockConsensus(readings);
    if(result.needsReview&&glyphs){
      // Retry each glyph independently when whole-line OCR disagrees or drops
      // digits. Never reconstruct missing digits by multiplying or appending 0.
      await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'10'});
      let text='';
      for(const digit of glyphs.digits){
        const part=(await worker.recognize(digit)).data.text.trim();
        if(!/^[0-9]$/.test(part)){text='';break;}
        text+=part;
      }
      if(text&&String(numeric(text)).length===glyphs.count){
        readings.push({text,value:numeric(text),mode:"한 글자씩"});
        result=stockConsensus(readings);
      }
    }
    if(unverifiedDigits){result.needsReview=true;result.extra=[result.extra,'숫자 자릿수 확인 실패 · 직접 확인'].filter(Boolean).join(' · ');}
    if(rejected&&result.needsReview)result.extra=[result.extra,'숫자 자릿수 불일치 감지 · 직접 확인'].filter(Boolean).join(' · ');
    return {...result,candidates:[...new Set([...(result.candidates||[]),...readings.map(r=>r.value??r.rejectedValue).filter(v=>v!==undefined&&v!==null)])],rejectedCandidates:[...new Set(readings.filter(r=>r.rejectedValue!==undefined).map(r=>r.rejectedValue))],diagnostics:readings.map(r=>({mode:r.mode,text:r.text.trim(),accepted:r.value!==null})),preview:crop(img,area,3).toDataURL('image/png')};
  }

  // Locate building cards by text, not their fixed row or column.
  let koreanWorker;
  function buildingId(text){
    const v=String(text||"").replace(/[\s.,·"'‘’“”()[\]{}~^\-]/g,"");
    if(/탐험.*부두|원정부두/.test(v))return "expedition";
    if(/일꾼/.test(v))return "workerhome";
    if(/호화/.test(v))return "ignore";
    if(/선원항구|^항구$/.test(v))return "harbor";
    if(/선원의집|선원주택|서워의|서원의/.test(v))return "sailorhome";
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
    harbor:"AAAAAAAAAAAAAAAAAAAAAAAAAAADYAAAAAAAP5+AAAAAAH8EAAAAAAF4EAAAAAAH7+AAAAAAD4QAAAAAAHYQAAAAAAH4QAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    fishpier:"AAAAcAAAAAAAAAAAAAAAAAAAAAAGYAAAAAAAH58AAAAAAGZAAAAAAAH58AAAAAAAAAAAAAAAP/+AAAAAABgQAAAAAABgQAAAAAAAgQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    bee:"AAAAAAAAAAAAAAAAAAAAAAAAAAAFoGAAAAAAH7+AAAAAAH52AAAAAAHr+AAAAAAD7eAAAAAAD5mAAAAAAD5+AAAAAAD5+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAAAAAAACeAAAAAAAA4AAA",
    tavern:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAIQBAAAAADI49AAAAAD7uZAAAAAHr+9AAAAAHp8lAAAAACJ8RAAAAACB8fAAAAAD5+fAAAAAAB+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    expedition:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAYmMQAAAAH7+Pz4AAAHd+MTAAAAH7ePz8AAAH52AAAAAAD5+P/8AAAGZ+DAwAAAH5+DAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    workerhome:"AAAAAAAAAAAAAAAAAAAAAAAAAAADIABAMAAAHp89H8AAAFoklBsAAAHr+9H8AAAD7+dGcAAAD5QPDMAAAD5A/D8AAAD58BD8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    sailorhome:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAJ2BAMAAADJe9H8AAAD5+lBsAAAHp+9H8AAAHr+dGcAAACIuPDMAAACBg/D8AAAD5+BD8AAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAEAAAAAAAAAAAA"
  };
  // These count templates are high-confidence visual anchors only.
  // Unlisted numbers still use digit OCR below, never the closest template
  // unless its shape score and separation pass confidence checks.
  const BADGE_PATTERNS={
    "10":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAA4OAADw6AAPhgAMLDECwGGIFgMMQOAYYgcAwxg4BhiBwDDEDwGHYFgMHwBgYPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    "25":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8GAAD8OAAE4YAAAwwAMBhgCwDDAHgMPwOAYLgcBgBg4HACBwMAEDw4AYFj+PwBn8fAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    "6":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAAAHgAAAYAAAAwAAYzAAA7GwAA+PwAA4dwABwxgADhjAAPDGAAfHMAB2H4ADOHgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",

    3:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAAfwAAADgAAADAAYwGAA7AYAA+DgAB4HgABwDgADgDAAPAGAAfAMAB2P4ADOfgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    9:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAPgAAA5gAABjAAYjGAA7GMAA+MYAB4f4ABwdgADgDAAPAGAAfAcAB2BwADMPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    12:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMGAAA4eAADwCAAPgAAMDAMCwGAYHgMAwOAYDgcAwGA4BgcBwDBwDwGDAFgMPwBgYfAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    23:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8GAAD8eAAEYCAAAwAAMBgMCwDAYHgODgOAYHgcBwDg4HACBwMAEDw4AIFj8PwBn+fAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",

    2:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAfgAAATgAAADAAYgGAAbAcAA+AwAB4BgABwGAADgcAAHBwAAfDAAA2PgADMfwAAAfgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    4:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAAAHgAAAPAAYg+AAbB8AA+GYAA4MwABwzgADh3AAHD/AAfB+AA2A4ADGAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    5:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAAAPgAAAYAAAAwAAYxgAAbDAAA+HwAA4BwABwBgADgDAAHAGAAfAMAA2H4ADGPgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    19:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYGAABweAAHhwAAfDEAYGGIFgMMQPAYZgcAw/g4Bg+BwDAEDgGAIHgMAwDAYHADAweAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    21:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AAAH4GAAJwcAABh8AYDCYFgGAwPAcBgcAwDA4DAGBwOAMDgYA4HhwAwDH8BADP4CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    7:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4AAAf4AAABgAAADAAYgGAAbAYAA+AwAA4BgABwGAADgMAAHAYAAfBwAA2DAADGGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
  };
  const LEVEL_PATTERNS={
    4:"AAAAAAAAAADADAHAHAPAJAZAfgfgBABAAAAAAAAAAAAAAAAA",
    2:"AAAAAAAAAAPAfABgDgDADAGAMAMAfgfgAAAAAAAAAAAAAAAA",
    3:"AAAAAAAAAAPAfABgBAHAOADABgBgfAeAAAAAAAAAAAAAAAAA"
  };
  function patternBits(str,n){
    const bytes=atob(str),out=new Uint8Array(n);
    if(bytes.length*8<n)throw new Error("사진 인식 기준 데이터가 손상되었습니다.");
    for(let i=0;i<n;i++)out[i]=(bytes.charCodeAt(i>>3)>>(7-(i&7)))&1;
    return out;
  }
  const labelBits=Object.fromEntries(Object.entries(LABEL_PATTERNS).map(([k,v])=>[k,patternBits(v,54*16)]));
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
        const full=pixelMask(data,w,cx+ox+dx,cy+oy+dy,pw,ph,kind);
        let actual=full;
        if(kind==="label"){
          actual=new Uint8Array(54*16);
          for(let y=0;y<16;y++)for(let x=0;x<54;x++){
            const i=y*2*108+x*2;
            actual[y*54+x]=full[i]|full[i+1]|full[i+108]|full[i+109];
          }
        }
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
    // A count badge can touch an orange roof. In that case connected-
    // component analysis merges the two areas and rejects the large blob.
    // A circular color-ring check recovers the badge without a fixed position.
    const offsets=r=>Array.from({length:32},(_,i)=>[Math.round(r*Math.cos(i*Math.PI/16)),Math.round(r*Math.sin(i*Math.PI/16))]);
    const rings=[offsets(11),offsets(13)],outside=offsets(19);
    const colorAt=(x,y)=>{
      if(x<55||x>=430||y<25||y>=BASE_H-24)return 0;
      return mask[y*w+x];
    };
    const candidates=[];
    for(let y=44;y<BASE_H-24;y+=2)for(let x=65;x<410;x+=2){
      let inner=0,outer=0;
      for(const ring of rings)for(const [dx,dy] of ring)inner+=colorAt(x+dx,y+dy);
      if(inner<46)continue; // at least 72% of the orange ring
      for(const [dx,dy] of outside)outer+=colorAt(x+dx,y+dy);
      const score=inner/64-.18*outer/32;
      if(score>=.69)candidates.push({cx:x,cy:y,score});
    }
    candidates.sort((a,b)=>b.score-a.score);
    for(const point of candidates){
      if(result.every(b=>(b.cx-point.cx)**2+(b.cy-point.cy)**2>20**2))
        result.push({cx:point.cx,cy:point.cy});
    }
    return result;
  }
  // Roofs can merge into the orange badge ring and shift the detected center.
  // Refine it with the actual digit ink before looking up the building name
  // and level; otherwise a 3px displacement can hide an entire housing card.
  function refineBadgeCenter(pixels,badge){
    const {data,width}=pixels;
    let best=null;
    for(let dy=-6;dy<=6;dy++)for(let dx=-6;dx<=6;dx++){
      const ink=pixelMask(data,width,badge.cx+dx-14,badge.cy+dy-14,29,29,"ink");
      const scores=Object.entries(badgeBits)
        .map(([value,pattern])=>({value,score:comparePattern(ink,pattern)}))
        .sort((a,b)=>b.score-a.score);
      const candidate={dx,dy,count:Number(scores[0].value),
        score:scores[0].score,margin:scores[0].score-scores[1].score};
      if(!best||candidate.score>best.score+1e-9||
          (Math.abs(candidate.score-best.score)<=1e-9&&candidate.margin>best.margin)){
        best=candidate;
      }
    }
    if(!best||best.score<.77||best.margin<.17)return {badge,count:null};
    return {badge:{...badge,cx:badge.cx+best.dx,cy:badge.cy+best.dy},
      count:best.count};
  }
  function badgeLocatedCards(img){
    const canvas=document.createElement("canvas");canvas.width=BASE_W;canvas.height=BASE_H;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(img,0,0,BASE_W,BASE_H);
    const pixels=ctx.getImageData(0,0,BASE_W,BASE_H),cards=new Map();
    for(const detected of findOrangeBadges(pixels)){
      const badge=detected;
      const m=matchPattern(pixels.data,BASE_W,badge.cx,badge.cy,labelBits,108,32,-113,18,"label");
      if(m.score<.70||m.margin<.12)continue;
      const lv=matchPattern(pixels.data,BASE_W,badge.cx,badge.cy,levelBits,12,24,-77,49,"level");
      const card={x:badge.cx-113,y:badge.cy+50,lv:lv.score>=.79&&lv.margin>=.16?Number(lv.value):null,
        count:null,badge,fromBadge:true};
      if(!cards.has(m.value))cards.set(m.value,[]);
      // Avoid duplicate ring candidates that belong to one physical badge.
      if(!cards.get(m.value).some(c=>Math.hypot(c.badge.cx-badge.cx,c.badge.cy-badge.cy)<18)){
        cards.get(m.value).push(card);
      }
    }
    return cards;
  }
  // A single harbor has no orange count badge. Search for its label glyphs
  // across the panel rather than assuming a particular card row or column.
  function unbadgedHarborCards(img){
    const cv=document.createElement("canvas");cv.width=BASE_W;cv.height=BASE_H;
    const ctx=cv.getContext("2d",{willReadFrequently:true});ctx.drawImage(img,0,0,BASE_W,BASE_H);
    const pixels=ctx.getImageData(0,0,BASE_W,BASE_H),target=labelBits.harbor;
    const white=new Uint8Array(BASE_W*BASE_H);
    for(let y=0;y<BASE_H;y++)for(let x=50;x<430;x++){
      const p=(y*BASE_W+x)*4,r=pixels.data[p],g=pixels.data[p+1],b=pixels.data[p+2];
      white[y*BASE_W+x]=(r+g+b)/3>180&&Math.max(r,g,b)-Math.min(r,g,b)<65?1:0;
    }
    let best=null;
    for(let y=35;y<BASE_H-80;y+=2)for(let x=65;x<330;x+=2){
      let common=0,either=0;
      for(let yy=0;yy<16;yy++)for(let xx=0;xx<54;xx++){
        const p=(y+yy*2)*BASE_W+x+xx*2;
        const actual=white[p]|white[p+1]|white[p+BASE_W]|white[p+BASE_W+1],stored=target[yy*54+xx];
        if(actual&&stored)common++;if(actual||stored)either++;
      }
      const score=either?common/either:0;
      if(score>=.50&&(!best||score>best.score))best={x,y,score};
    }
    if(!best)return [];
    const m=matchPattern(pixels.data,BASE_W,best.x+113,best.y-18,labelBits,108,32,-113,18,"label");
    if(m.value!=="harbor"||m.score<.80||m.margin<.15)return [];
    // Refine the two-pixel search before locating the adjacent level numeral.
    let anchor=best;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const full=pixelMask(pixels.data,BASE_W,best.x+dx,best.y+dy,108,32,"label"),actual=new Uint8Array(864);
      for(let y=0;y<16;y++)for(let x=0;x<54;x++){
        const i=y*216+x*2;actual[y*54+x]=full[i]|full[i+1]|full[i+108]|full[i+109];
      }
      const score=comparePattern(actual,target);if(score>anchor.score)anchor={x:best.x+dx,y:best.y+dy,score};
    }
    const virtual={cx:anchor.x+113,cy:anchor.y-18};
    const lv=matchPattern(pixels.data,BASE_W,virtual.cx,virtual.cy,levelBits,12,24,-77,49,"level");
    return [{x:anchor.x,y:anchor.y+32,lv:lv.score>=.79&&lv.margin>=.16?Number(lv.value):null,
      levelAnchor:virtual,preview:crop(img,[anchor.x,anchor.y-65,anchor.x+130,anchor.y+60],2).toDataURL("image/png")}];
  }
  async function detectedCardLevel(worker,img,card){
    if(card.lv!==null)return card.lv;
    if(!card.badge&&!card.levelAnchor)return null;
    await worker.setParameters({tessedit_char_whitelist:"123456",tessedit_pageseg_mode:"10"});
    const b=card.badge||card.levelAnchor;
    return readValue(worker,img,[b.cx-79,b.cy+47,b.cx-63,b.cy+74],true);
  }
  async function locateCards(img){
    const ocr=await koreanOCR();
    await ocr.setParameters({tessedit_pageseg_mode:"11"});
    const result=await ocr.recognize(blackWhite(img,[45,0,430,BASE_H]),{}, {tsv:true});
    const cards=extractLevels(result.data.tsv),recognized=new Map();
    await ocr.setParameters({tessedit_pageseg_mode:"7"});
    for(const card of cards){
      const region=[card.x-8,card.y-37,card.x+110,card.y-9];
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
  function badgeDigitImage(img,badge,threshold){
    // Keep the complete interior, including the left digit; remove the orange
    // background and circular edge before OCR, then add a small white border.
    const cv=crop(img,[badge.cx-15,badge.cy-15,badge.cx+15,badge.cy+15],6);
    const ctx=cv.getContext("2d",{willReadFrequently:true}),d=ctx.getImageData(0,0,cv.width,cv.height);
    for(let y=0;y<cv.height;y++)for(let x=0;x<cv.width;x++){
      const p=(y*cv.width+x)*4,r=d.data[p],g=d.data[p+1],b=d.data[p+2];
      const inside=(x-cv.width/2)**2+(y-cv.height/2)**2<(cv.width*.44)**2;
      const ink=inside&&r<threshold&&g<threshold&&b<110;
      d.data[p]=d.data[p+1]=d.data[p+2]=ink?0:255;
    }
    ctx.putImageData(d,0,0);
    const padded=document.createElement("canvas");padded.width=cv.width+24;padded.height=cv.height+24;
    const c=padded.getContext("2d");c.fillStyle="white";c.fillRect(0,0,padded.width,padded.height);c.drawImage(cv,12,12);
    return padded;
  }
  async function badgeQuantity(worker,img,badge){
    const votes=new Map();
    for(const [threshold,mode] of [[140,"7"],[165,"13"],[155,"8"]]){
      await worker.setParameters({tessedit_char_whitelist:"0123456789xX×",tessedit_pageseg_mode:mode});
      const value=numeric((await worker.recognize(badgeDigitImage(img,badge,threshold))).data.text);
      if(value===null||value<1||value>10000)continue;
      votes.set(value,(votes.get(value)||0)+1);

    }
    const cv=document.createElement("canvas");cv.width=BASE_W;cv.height=BASE_H;
    const ctx=cv.getContext("2d",{willReadFrequently:true});ctx.drawImage(img,0,0,BASE_W,BASE_H);
    const pixels=ctx.getImageData(0,0,BASE_W,BASE_H);
    const shape=matchPattern(pixels.data,BASE_W,badge.cx,badge.cy,badgeBits,29,29,-14,-14,"ink");
    const visual=shape.score>=.82&&shape.margin>=.12?Number(shape.value):null;
    const ranked=[...votes].sort((a,b)=>b[1]-a[1]);
    if(visual!==null){
      // A conflicting visual check must never be overridden by repeated OCR.
      if(ranked.length&&ranked[0][0]!==visual)return null;
      if(votes.has(visual))return visual;
    }
    return ranked.length===1&&ranked[0][1]>=2?ranked[0][0]:null;
  }
  async function recognizeBuildings(img,worker){
    const cards=badgeLocatedCards(img);
    if(!cards.has("harbor")){const harbor=unbadgedHarborCards(img);if(harbor.length)cards.set("harbor",harbor);}
    // OCR remains a secondary route for single buildings without count badges.
    if(TYPES.buildings.some(item=>!cards.has(item.id))){
      try{
        const ocrCards=await locateCards(img);
        for(const [id,entries] of ocrCards){
          const existing=cards.get(id)||[];
          for(const card of entries){
            if(!existing.some(c=>Math.abs(c.x-card.x)<35&&Math.abs(c.y-card.y)<24))existing.push(card);
          }
          cards.set(id,existing);
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
        cardsWithCounts.push({...card,lv,count,
          extra:lv===null?"레벨 인식 실패 · 직접 확인":
            !badge?"배지 없음 · 1개":
            count===null?"배지 숫자 인식 실패 · 직접 확인":
            ""});
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
          rows.push({...makeEntry(item.id+"_mix_"+lv,item.name+" Lv."+lv+" 수량",count,"buildings","count",count===null?"배지 숫자 인식 실패 · 직접 확인":"서로 다른 레벨을 구분해 도시 관리에 반영"),preview:group.length===1&&group[0].badge?crop(img,[group[0].badge.cx-19,group[0].badge.cy-19,group[0].badge.cx+19,group[0].badge.cy+19],3).toDataURL("image/png"):null});
        }
      }else if(cardsWithCounts.length>1){
        // Never silently choose one of multiple production configurations.
        rows.push(makeEntry(item.id+"_lv",item.name+" 레벨",null,"buildings","level","여러 레벨의 건물 발견 · 상세 설정에서 직접 확인"));
        rows.push(makeEntry(item.id+"_count",item.name+" 수량",null,"buildings","count","여러 건물 카드 발견 · 상세 설정에서 직접 확인"));
      }else{
        const card=cardsWithCounts[0];
        rows.push(makeEntry(item.id+"_lv",item.name+" 레벨",card.lv,"buildings","level",card.lv===null?"레벨 인식 실패 · 직접 확인":""));
        rows.push({...makeEntry(item.id+"_count",item.name+" 수량",card.count,"buildings","count",card.extra),preview:card.badge?crop(img,[card.badge.cx-19,card.badge.cy-19,card.badge.cx+19,card.badge.cy+19],3).toDataURL("image/png"):card.preview||null});
      }
    }
    await worker.setParameters({tessedit_char_whitelist:"0123456789.,KkMmXx",tessedit_pageseg_mode:"7"});
    return rows;
  }

  function review(){
    const root=$p("photoReview");
    root.replaceChildren();
    if(!findings.length){$p("photoApply").disabled=true;return;}
    const skip=document.createElement("button");skip.type="button";skip.textContent="미인식·확인 필요 값 미적용";
    skip.addEventListener("click",()=>{
      let count=0;
      for(const check of root.querySelectorAll(".photo-select")){
        const entry=findings.find(f=>f.id===check.dataset.id);
        if(entry.value===null||entry.needsReview||entry.extra.includes("직접 확인")){
          check.checked=false;count++;
        }
      }
      setStatus(count+"개 항목을 미적용으로 설정했습니다. 기존 입력값은 유지됩니다.");
    });root.append(skip);
    const table=document.createElement("table");
    table.className="photo-table";
    const header=document.createElement("thead");
    header.innerHTML="<tr><th>적용</th><th>항목</th><th>인식된 값 · 수정 가능</th></tr>";
    table.append(header);
    const body=document.createElement("tbody");
    for(const entry of findings){
      const tr=document.createElement("tr"),a=document.createElement("td"),b=document.createElement("td"),c=document.createElement("td");
      const check=document.createElement("input");
      check.type="checkbox";check.className="photo-select";check.checked=entry.value!==null&&!entry.needsReview&&!entry.extra.includes("직접 확인");check.setAttribute("aria-label",entry.label+" 적용");
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
      c.append(number);
      const candidates=[...new Set(entry.candidates||[])];
      if(candidates.length>1||(entry.needsReview&&candidates.length)){
        const options=document.createElement('div');options.className='photo-candidates';
        const hint=document.createElement('small');hint.textContent='원본과 비교해 후보 선택';options.append(hint);
        const buttons=[];
        const update=()=>buttons.forEach(({button,value})=>button.setAttribute('aria-pressed',String(numeric(number.value)===value)));
        for(const value of candidates){
          const button=document.createElement('button');button.type='button';
          const rejected=entry.rejectedCandidates?.includes(value)&&!entry.diagnostics?.some(r=>r.accepted&&numeric(r.text)===value);
          button.textContent=value.toLocaleString('ko-KR')+(rejected?' (자릿수 불일치)':'');
          button.setAttribute('aria-label',entry.label+' '+value.toLocaleString('ko-KR')+' 선택');
          button.setAttribute('aria-pressed','false');
          button.addEventListener('click',()=>{
            number.value=String(value);check.checked=true;update();
          });
          buttons.push({button,value});options.append(button);
        }
        number.addEventListener('input',update);c.append(options);
      }
      if(entry.preview){
        const preview=document.createElement('img');preview.src=entry.preview;
        preview.alt=entry.label+' 원본 숫자 확대';preview.style.cssText='display:block;width:100%;max-width:240px;height:auto;margin:8px auto 0;border:1px solid #9fb0ba;border-radius:4px';
        c.append(preview);
      }
      if(entry.needsReview&&entry.diagnostics){
        const details=document.createElement('details'),summary=document.createElement('summary');
        summary.textContent='판독 내역';details.append(summary);
        const list=document.createElement('small');list.style.cssText='display:block;white-space:pre-wrap;overflow-wrap:anywhere';
        list.textContent=entry.diagnostics.map(r=>r.mode+': '+(r.text||'미인식')+(r.accepted?'':' (검증 제외)')).join('\n');details.append(list);b.append(details);
      }
      tr.append(a,b,c);body.append(tr);
    }
    table.append(body);root.append(table);
    $p("photoApply").disabled=false;
  }
  function syncPhotoControls(){
    for(const id of ['photoBuildings','photoStocks']){
      $p(id).disabled=busy;
      $p(id+'Clear').disabled=busy||!$p(id).files.length;
    }
    $p('photoReset').disabled=busy||(!findings.length&&!$p('photoBuildings').files.length&&!$p('photoStocks').files.length);
  }
  function clearPhotoResults(message){
    findings=[];$p('photoReview').replaceChildren();$p('photoApply').disabled=true;
    setStatus(message);syncPhotoControls();
  }
  function clearPhoto(id){
    if(busy)return;
    $p(id).value='';
    clearPhotoResults('사진을 삭제했습니다. 남은 사진은 다시 분석해주세요.');
  }
  function resetPhotos(){
    if(busy)return;
    $p('photoBuildings').value='';$p('photoStocks').value='';
    clearPhotoResults('사진과 분석 결과를 초기화했습니다. 사진을 선택해주세요.');
  }
  async function scan(){
    if(busy)return;
    const building=$p("photoBuildings").files[0], goods=$p("photoStocks").files[0];
    if(!building&&!goods){setStatus("건물 사진 또는 생산물 사진을 선택하세요.",true);return;}
    findings=[];$p("photoReview").replaceChildren();
    busy=true;$p("photoScan").disabled=true;$p("photoApply").disabled=true;syncPhotoControls();
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
          const result=await readStock(worker,imgs.stock,item.box);done++;
          const extra=[result.extra,result.approximate?'K/M 단위 표시는 반올림된 근삿값':''].filter(Boolean).join(' · ');
          results.push({...makeEntry(item.id,item.name,result.value,"stock","stock",extra),needsReview:result.needsReview,preview:result.preview,diagnostics:result.diagnostics,candidates:result.candidates,rejectedCandidates:result.rejectedCandidates});
        }
      }
      findings=results;
      review();
      const recognized=results.filter(item=>item.value!==null).length;
      setStatus("분석 완료: "+recognized+"/"+results.length+"개 값 추출 · 정확성 확인 필요. 숫자를 확인·수정한 뒤 적용하세요.");
    }catch(err){setStatus(err?.message||"사진 인식에 실패했습니다.",true);}
    finally{busy=false;$p("photoScan").disabled=false;syncPhotoControls();}
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
    if(values.tavern_lv!==undefined||values.tavern_count!==undefined)affected.push("벌꿀 술","건어물");
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
        const map={bee:"Beehive_Average",fishpier:"FishingPier_Average",expedition:"ExpeditionPier_Average",harbor:"SailorPort_Average"};
        if(map[item.id])delete app.city.manual[map[item.id]];
      }
    }
    const tavernLv=values.tavern_lv,tavernCount=values.tavern_count;
    if(tavernCount!==undefined){
      app.city.manual.Workshop_Tavern=tavernCount;
      if(tavernLv!==undefined&&tavernLv<4){
        app.buildings["벌꿀 술"].bldgs=tavernCount;
        app.buildings["건어물"].bldgs=0;
      }
    }
    if(tavernLv!==undefined&&tavernLv<4){
      app.buildings["벌꿀 술"].lv=tavernLv;
      app.buildings["벌꿀 술"].mode=modeForLevel("벌꿀 술",tavernLv,app.buildings["벌꿀 술"].mode);
    }
    const stocks={penny:["city","pennyStock"],honey:["벌집","stock"],fish:["부두","stock"],mead:["벌꿀 술","stock"],dried:["건어물","stock"],pottery:["도자기 보물"],gold:["황금 보물"],spice:["향신료 보물"],gem:["보석 보물"]};
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
  for(const id of ['photoBuildings','photoStocks']){
    $p(id+'Clear').addEventListener('click',()=>clearPhoto(id));
    $p(id).addEventListener('change',()=>clearPhotoResults('사진이 변경되었습니다. 사진 분석을 눌러주세요.'));
  }
  $p('photoReset').addEventListener('click',resetPhotos);
  syncPhotoControls();
  $p("photoScan").addEventListener("click",scan);
  $p("photoApply").addEventListener("click",apply);
})();



