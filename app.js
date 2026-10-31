(() => {
  "use strict";
  const COST = 500;
  const STORAGE_KEY = "nomgen-save-v1";
  const ADMIN_PIN = "NOMG3N-ADMIN"; // Измени этот код перед публикацией сайта.
  const ODDS_KEY = "nomgen-odds-v1";
  const PLAYERS_KEY = "nomgen-players-v1";
  const DEFAULT_WEIGHTS = [69.5,22,7,1.5,.5];
  let weights = loadWeights();
  let players = loadPlayers();
  let playerName = localStorage.getItem("nomgen-player-name") || "Игрок";
  const letters = ["А","В","Е","К","М","Н","О","Р","С","Т","У","Х"];
  const regions = ["77","97","99","177","197","199","777","50","90","150","750","78","98","178","198","23","93","123","116","716","02","102","54","154","66","96","196","74","174","52","152","63","163","61","161"];
  const tiers = [
    {name:"Обычный",key:"common",weight:69.5,min:350,max:650,color:"#aeb8c4"},
    {name:"Редкий",key:"rare",weight:22,min:900,max:1800,color:"#56a8ff"},
    {name:"Эпический",key:"epic",weight:7,min:3000,max:7000,color:"#b78aff"},
    {name:"Мифический",key:"mythic",weight:1.5,min:12000,max:30000,color:"#ff9c54"},
    {name:"Легендарный",key:"legendary",weight:.5,min:50000,max:150000,color:"#f4d16d"}
  ];
  const $ = id => document.getElementById(id);
  const money = n => Math.round(n).toLocaleString("ru-RU") + " ₽";
  const state = load();
  let toastTimer;
  function load(){
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if(saved && typeof saved.balance === "number" && Array.isArray(saved.collection) && Array.isArray(saved.sales)) return {...saved, spins:Number(saved.spins)||0, balance:Math.max(0,saved.balance)};
    } catch(e) {}
    return {balance:5000,collection:[],sales:[],spins:0,nextId:1};
  }
  function save(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }
  function chooseTier(){
    let roll=Math.random()*100;
    for(const tier of tiers){roll-=tier.weight;if(roll<0)return tier;}
    return tiers[0];
  }
  function patternScore(digits, chars){
    let score=0;
    if(digits[0]===digits[1]&&digits[1]===digits[2]) score+=5;
    else if(digits[0]===digits[1]||digits[1]===digits[2]||digits[0]===digits[2]) score+=2;
    if(digits==="123"||digits==="321"||digits==="777"||digits==="001"||digits==="007") score+=3;
    if(chars[0]===chars[1]&&chars[1]===chars[2]) score+=4;
    else if(chars[0]===chars[1]||chars[1]===chars[2]||chars[0]===chars[2]) score+=1;
    return score;
  }
  function makeNumber(){
    const tier=chooseTier();
    let digits=String(Math.floor(Math.random()*1000)).padStart(3,"0");
    let chars=Array.from({length:3},()=>letters[Math.floor(Math.random()*letters.length)]);
    const score=patternScore(digits,chars);
    let region=regions[Math.floor(Math.random()*regions.length)].trim();
    let value=Math.round((tier.min+Math.random()*(tier.max-tier.min))*(1+score*.12)/50)*50;
    return {id:state.nextId++,digits,chars:chars.join(""),region,plate:chars[0]+digits+chars[1]+chars[2],tier:tier.name,key:tier.key,color:tier.color,value,created:Date.now()};
  }
  function notify(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2400);}
  function spin(){
    if(state.balance<COST){notify("Недостаточно средств для попытки");return;}
    state.balance-=COST;state.spins++;save();render();
    const btn=$("spin-button"),machine=$("plate-wrap"),panel=$("generator-panel");
    btn.disabled=true;btn.querySelector("span:nth-child(2)").textContent="ГЕНЕРАТОР ЗАПУЩЕН";
    machine.classList.add("spinning");
    $("rarity-label").textContent="ИДЁТ РОЗЫГРЫШ";$("result-value").textContent="Ищем красивую комбинацию…";$("result-hint").textContent="Удача уже где-то рядом";
    let ticks=0;
    const interval=setInterval(()=>{
      $("plate-main").textContent=letters[Math.floor(Math.random()*letters.length)]+String(Math.floor(Math.random()*1000)).padStart(3,"0")+letters[Math.floor(Math.random()*letters.length)]+letters[Math.floor(Math.random()*letters.length)];
      $("plate-region").textContent=regions[Math.floor(Math.random()*regions.length)].trim();ticks++;
      if(ticks>=17){
        clearInterval(interval);machine.classList.remove("spinning");
        const item=makeNumber();state.collection.unshift(item);save();
        $("plate-main").textContent=item.plate;$("plate-region").textContent=item.region;
        const info=$("result-info");info.className="result-info rarity-"+item.key;
        $("rarity-label").textContent=item.tier.toUpperCase();$("result-value").textContent="Найдено! Оценка: "+money(item.value);$("result-hint").textContent="Номер добавлен в твою коллекцию";
        machine.classList.add("win-flash");setTimeout(()=>machine.classList.remove("win-flash"),700);
        btn.disabled=false;btn.querySelector("span:nth-child(2)").textContent="КРУТИТЬ ГЕНЕРАТОР";
        render();notify(item.key==="legendary"?"ЛЕГЕНДАРНАЯ НАХОДКА! "+item.plate:item.tier+": "+item.plate+" — "+money(item.value));
      }
    },85);
  }
  function sell(id){
    const index=state.collection.findIndex(x=>x.id===id);if(index<0)return;
    const [item]=state.collection.splice(index,1);state.balance+=item.value;
    state.sales.unshift({plate:item.plate,region:item.region,tier:item.tier,value:item.value,date:Date.now()});
    save();render();notify("Продано за "+money(item.value));
  }
  function sellDuplicates(){
    const seen=new Set(),dupes=[];
    [...state.collection].sort((a,b)=>a.created-b.created).forEach(item=>{
      const key=item.plate+"-"+item.region;
      if(seen.has(key))dupes.push(item);else seen.add(key);
    });
    if(!dupes.length){notify("Дубликатов пока нет");return;}
    const ids=new Set(dupes.map(x=>x.id));let total=0;
    state.collection=state.collection.filter(x=>{if(ids.has(x.id)){total+=x.value;return false;}return true;});
    state.balance+=total;dupes.forEach(x=>state.sales.unshift({plate:x.plate,region:x.region,tier:x.tier,value:x.value,date:Date.now()}));
    save();render();notify("Продано дубликатов: "+dupes.length+" на "+money(total));
  }
  function render(){
    $("balance").textContent=money(state.balance);$("collection-count").textContent=state.collection.length+" "+plural(state.collection.length,["номер","номера","номеров"]);
    $("collection-badge").textContent=state.collection.length;$("spins-count").textContent=state.spins;
    const total=state.collection.reduce((s,x)=>s+x.value,0);$("total-value").textContent=money(total);
    const best=[...state.collection].sort((a,b)=>b.value-a.value)[0];
    $("best-number").textContent=best?best.plate:"—";$("best-value").textContent=best?money(best.value):"пока нет номеров";
    const found=new Set(state.collection.map(x=>x.tier));$("rarity-progress-label").textContent=found.size+" / 5";
    document.querySelectorAll(".rarity-dots i").forEach((el,i)=>{el.classList.toggle("active",found.has(tiers[i].name));el.style.setProperty("--dot",tiers[i].color);});
    const sort=$("sort-select").value;
    let items=[...state.collection];
    if(sort==="price")items.sort((a,b)=>b.value-a.value);
    if(sort==="rarity")items.sort((a,b)=>tiers.findIndex(t=>t.name===b.tier)-tiers.findIndex(t=>t.name===a.tier));
    if(sort==="new")items.sort((a,b)=>b.created-a.created);
    $("empty-state").style.display=items.length?"none":"block";
    $("collection-grid").innerHTML=items.map(item=>`<article class="number-card rarity-${item.key}" style="--tier:${item.color}"><div class="card-top"><span class="tier-tag">${item.tier}</span><span class="card-id">#${String(item.id).padStart(4,"0")}</span></div><div class="small-plate">${item.plate}<small style="font:9px Manrope;margin-left:7px;border-left:1px solid #17212a;padding-left:5px">${item.region}</small></div><div class="card-bottom"><strong class="card-price">${money(item.value)}</strong><button class="sell-button" data-sell="${item.id}">Продать</button></div></article>`).join("");
    $("sales-count").textContent=state.sales.length+" "+plural(state.sales.length,["операция","операции","операций"]);
    $("history-list").innerHTML=state.sales.length?state.sales.slice(0,30).map(s=>`<div class="history-row"><div><strong>${s.plate} · ${s.region}</strong><small>${s.tier} · ${new Date(s.date).toLocaleString("ru-RU",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</small></div><span class="history-amount">+${money(s.value)}</span></div>`).join(""):'<div class="history-empty">Здесь появятся твои сделки</div>';
  }
  function plural(n,forms){const n10=n%10,n100=n%100;return n100>=11&&n100<=14?forms[2]:n10===1?forms[0]:n10>=2&&n10<=4?forms[1]:forms[2];}
  $("spin-button").addEventListener("click",spin);
  $("save-player").addEventListener("click",()=>{
    const name=$("player-name").value.trim().slice(0,20);
    if(!name){notify("Введи имя игрока");return;}
    playerName=name;localStorage.setItem("nomgen-player-name",playerName);render();notify("Профиль сохранён");
  });
  $("admin-toggle").addEventListener("click",()=>{
    const panel=$("admin-content");
    if(!panel.hidden){panel.hidden=true;$("admin-toggle").textContent="Открыть";return;}
    const pin=prompt("Введите код администратора:");
    if(pin!==ADMIN_PIN){notify("Неверный код администратора");return;}
    panel.hidden=false;$("admin-toggle").textContent="Закрыть";renderOdds();
  });
  $("apply-odds").addEventListener("click",()=>{
    const next=Array.from(document.querySelectorAll("[data-odds]"),el=>Math.max(0,Number(el.value)||0));
    if(next.every(x=>x===0)){notify("Хотя бы один шанс должен быть больше нуля");return;}
    weights=next;localStorage.setItem(ODDS_KEY,JSON.stringify(weights));renderOdds();$("odds-status").textContent="Шансы сохранены. Они применяются к следующим попыткам.";notify("Шансы обновлены");
  });
  $("reset-odds").addEventListener("click",()=>{
    weights=[...DEFAULT_WEIGHTS];localStorage.setItem(ODDS_KEY,JSON.stringify(weights));renderOdds();$("odds-status").textContent="Стандартные шансы восстановлены.";notify("Шансы сброшены");
  });
  $("collection-grid").addEventListener("click",e=>{const btn=e.target.closest("[data-sell]");if(btn)sell(Number(btn.dataset.sell));});
  $("sell-duplicates").addEventListener("click",sellDuplicates);
  $("sort-select").addEventListener("change",render);
  $("reset-game").addEventListener("click",()=>{if(confirm("Сбросить весь прогресс? Баланс вернётся к 5 000 ₽, коллекция и история будут удалены.")){state.balance=5000;state.collection=[];state.sales=[];state.spins=0;state.nextId=1;save();$("plate-main").textContent="А000АА";$("plate-region").textContent="77";$("rarity-label").textContent="ГОТОВ К РОЗЫГРЫШУ";$("result-value").textContent="Твоя следующая находка?";$("result-hint").textContent="Нажми кнопку, чтобы запустить генератор";$("result-info").className="result-info";render();notify("Прогресс сброшен");}});
  render();
})();