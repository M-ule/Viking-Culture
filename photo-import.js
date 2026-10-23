/* Viking Culture image importer. OCR runs in the browser; screenshots are not uploaded. */
(() => {
  "use strict";
  const $p = id => document.getElementById(id);
  const BASE_W = 1536, BASE_H = 709;
  const TYPES = {
    buildings: [
      {id:"bee",name:"벌통",prod:"벌통",level:[91,118,171,152],count:[181,51,232,102]},
      {id:"fishpier",name:"어업 부두",prod:"어업 부두",level:[222,118,301,151],count:[310,51,362,102]},
      {id:"expedition",name:"원정 부두",prod:"원정 부두",level:[220,250,307,285],count:[310,184,361,236]},
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
      const matches=cleaned.match(/\d/g)||[];
      const digit=Number(matches[matches.length-1]);
      return Number.isInteger(digit)&&digit>=1&&digit<=6?digit:null;
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
        for(const item of TYPES.buildings){
          setStatus("건물 사진 분석 중… "+(done+1)+"/"+total);
          const lv=await readValue(worker,imgs.buildings,item.level,true);done++;
          const hasBadge=badgeExists(imgs.buildings,item.count);
          setStatus("건물 사진 분석 중… "+(done+1)+"/"+total);
          const count=hasBadge?await readValue(worker,imgs.buildings,item.count,false):1;done++;
          results.push(makeEntry(item.id+"_lv",item.name+" 레벨",lv,"buildings","level"));
          results.push(makeEntry(item.id+"_count",item.name+" 수량",count,"buildings","count",hasBadge?"":"배지가 없어 1개로 추정"));
        }
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
        if(lv!==undefined)app.city.homes[item.home].lv=lv;
        if(count!==undefined)app.city.homes[item.home].count=count;
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
