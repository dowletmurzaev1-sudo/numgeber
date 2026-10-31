(() => {
  "use strict";
  const COST = 500;
  const STORAGE_KEY = "nomgen-save-v1";
  const ODDS_KEY = "nomgen-odds-v1";
  const PLAYERS_KEY = "nomgen-players-v1";
  const DEFAULT_WEIGHTS = [69.5,22,7,1.5,.5];
  let weights = [...DEFAULT_WEIGHTS];
  let hasCustomWeights = false;
  let players = [];
  let supabase = null;
  let adminUser = null;
  let currentUser = null;
  let playerReady = false;
  let loadingUserId = null;
  let saveQueue = Promise.resolve();
  let playerName = localStorage.getItem("nomgen-player-name") || "Игрок";
  let avatarData = localStorage.getItem("nomgen-avatar") || "";
  const letters = ["А","В","Е","К","М","Н","О","Р","С","Т","У","Х"];
  const regions = ["77","97","99","177","197","199","777","50","90","150","750","78","98","178","198","23","93","123","116","716","02","102","54","154","66","96","196","74","174","52","152","63","163","61","161"];
  const tiers = [
    {name:"Обычный",key:"common",weight:69.5,min:350,max:650,color:"#aeb8c4"},
    {name:"Редкий",key:"rare",weight:22,min:900,max:1800,color:"#56a8ff"},
    {name:"Эпический",key:"epic",weight:7,min:3000,max:7000,color:"#b78aff"},
    {name:"Мифический",key:"mythic",weight:1.5,min:12000,max:30000,color:"#ff9c54"},
    {name:"Легендарный",key:"legendary",weight:.5,min:15000000,max:50000000,color:"#f4d16d"}
  ];
  const $ = id => document.getElementById(id);
  const money = n => Math.round(n).toLocaleString("ru-RU") + " ₽";
  const state = load();
  let toastTimer;
  let musicContext=null, musicMaster=null, musicNodes=[], musicTimer=null, musicMelodyTimer=null;
  let musicEnabled=localStorage.getItem("nomgen-music-enabled")==="1";
  let musicVolume=Math.max(0,Math.min(1,Number(localStorage.getItem("nomgen-music-volume")??0.35)));
  function load(){
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if(saved && typeof saved.balance === "number" && Array.isArray(saved.collection) && Array.isArray(saved.sales)) return {...saved, spins:Number(saved.spins)||0, balance:Math.max(0,saved.balance), luckLevel:Math.min(5,Math.max(0,Number(saved.luckLevel)||0)), autoTapLevel:Math.min(3,Math.max(0,Number(saved.autoTapLevel)||0)), autoTapEnabled:Boolean(saved.autoTapEnabled)};
    } catch(e) {}
    return {balance:5000,collection:[],sales:[],spins:0,nextId:1,luckLevel:0};
  }
  function save(){
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    if(currentUser && supabase) {
      const rarest=[...state.collection].sort((a,b)=>tierRank(b.key)-tierRank(a.key)||b.value-a.value)[0]||null;
      saveQueue=saveQueue.then(async()=>{
        const saved=await supabase.from("nomgen_saves").upsert({user_id:currentUser.id,game_state:state,updated_at:new Date().toISOString()},{onConflict:"user_id"});
        if(saved.error) throw saved.error;
        const profile=await supabase.from("nomgen_players").upsert({
          user_id:currentUser.id,display_name:playerName,
          rarest_plate:rarest?.plate||null,rarest_region:rarest?.region||null,
          rarest_tier:rarest?.tier||null,rarest_value:rarest?.value||0,
          rarity_rank:rarest?tierRank(rarest.key):0,updated_at:new Date().toISOString()
        },{onConflict:"user_id"});
        if(profile.error) throw profile.error;
      }).catch(error=>console.error("Cloud save failed:",error.message));
    }
  }
  function tierRank(key){return ({common:1,rare:2,epic:3,mythic:4,legendary:5})[key]||0;}
  function showGame(){
    $("auth-gate").hidden=true;
    document.body.classList.remove("auth-required");
    playerReady=true;
    $("spin-button").disabled=false;
  }
  async function loadPlayer(user){
    if(!user)return;
    if(currentUser?.id===user.id && (playerReady||loadingUserId===user.id)){showGame();return;}
    currentUser=user;
    loadingUserId=user.id;
    // Сразу закрываем экран входа после подтверждения сессии Google.
    showGame();
    avatarData=user.user_metadata?.avatar_data||localStorage.getItem("nomgen-avatar")||"";
    if(avatarData)localStorage.setItem("nomgen-avatar",avatarData);
    renderProfileButton();
    try{
      const {data:isAdmin,error:adminError}=await supabase.rpc("is_nomgen_admin");
      if(!adminError&&isAdmin){adminUser=user;$("admin-secret").hidden=false;$("admin-content").hidden=false;$("admin-toggle").textContent="Скрыть";renderOdds();}else{adminUser=null;$("admin-secret").hidden=true;$("admin-panel").hidden=true;}
      const {data:userWeights,error:weightsError}=await supabase.rpc("get_my_rare_weights");
      if(!weightsError&&Array.isArray(userWeights)&&userWeights.length===5&&userWeights.some(x=>Number(x)>0)){weights=userWeights.map(Number);hasCustomWeights=true;}
      const {data,error}=await supabase.from("nomgen_saves").select("game_state").eq("user_id",user.id).maybeSingle();
      if(error)throw error;
      if(data?.game_state && typeof data.game_state.balance==="number"){
        Object.assign(state,data.game_state);
        const {data:profile,error:profileError}=await supabase.from("nomgen_players").select("display_name").eq("user_id",user.id).maybeSingle();
        if(profileError)console.warn("Profile name could not be loaded:",profileError.message);
        playerName=(profile?.display_name||user.user_metadata?.full_name||user.user_metadata?.name||user.email?.split("@")[0]||"Игрок").slice(0,20);
      }else{
        playerName=(user.user_metadata?.full_name||user.user_metadata?.name||user.email?.split("@")[0]||"Игрок").slice(0,20);
        await persistProfile();
      }
      localStorage.setItem("nomgen-player-name",playerName);
      $("player-name").value=playerName;
      render();
      renderProfileButton();
      await refreshLeaderboard();
    }catch(error){
      console.error("Player data load failed:",error);
      $("auth-error").textContent="Вход выполнен, но не удалось загрузить облачный прогресс: "+(error.message||error);
      notify("Вход в Google выполнен. Ошибка загрузки прогресса.");
    }finally{
      loadingUserId=null;
      showGame();
    }
  }
  async function persistProfile(){
    if(!currentUser||!supabase)return;
    const rarest=[...state.collection].sort((a,b)=>tierRank(b.key)-tierRank(a.key)||b.value-a.value)[0]||null;
    const saved=await supabase.from("nomgen_saves").upsert({user_id:currentUser.id,game_state:state,updated_at:new Date().toISOString()},{onConflict:"user_id"});
    if(saved.error){notify("Не удалось сохранить прогресс: "+saved.error.message);return;}
    const {error}=await supabase.from("nomgen_players").upsert({
      user_id:currentUser.id,display_name:playerName,
      rarest_plate:rarest?.plate||null,rarest_region:rarest?.region||null,
      rarest_tier:rarest?.tier||null,rarest_value:rarest?.value||0,
      rarity_rank:rarest?tierRank(rarest.key):0,updated_at:new Date().toISOString()
    },{onConflict:"user_id"});
    if(error)notify("Не удалось сохранить профиль: "+error.message);
    else await refreshLeaderboard();
  }
  let leaderboardNextRefresh=Date.now()+60000;
  async function refreshLeaderboard(){
    if(!supabase)return;
    leaderboardNextRefresh=Date.now()+60000;
    const {data,error}=await supabase.from("nomgen_players").select("user_id,display_name,rarest_plate,rarest_region,rarest_tier,rarest_value,rarity_rank").order("rarity_rank",{ascending:false}).order("rarest_value",{ascending:false}).limit(100);
    if(error){$("leaderboard").innerHTML='<div class="history-empty">Не удалось загрузить рейтинг: '+error.message+'</div>';return;}
    $("leaderboard").innerHTML=data?.length?data.map((p,i)=>'<div class="leader-row"><span class="leader-rank">'+(i+1)+'</span><div class="leader-details"><strong>'+escapeHtml(p.display_name||"Игрок")+'</strong><small>'+(p.rarest_plate?escapeHtml(p.rarest_tier)+" · "+escapeHtml(p.rarest_plate)+" · регион "+escapeHtml(p.rarest_region||"—"):"Пока нет номеров")+'</small></div><span>'+money(Number(p.rarest_value)||0)+'</span></div>').join(""):'<div class="history-empty">Пока нет участников. Стань первым!</div>';
  }
  setInterval(()=>{
    const left=Math.max(0,Math.ceil((leaderboardNextRefresh-Date.now())/1000));
    const el=$("leaderboard-refresh");
    if(el)el.textContent=left>0?"Обновление через "+left+" сек.":"Обновляем рейтинг…";
    if(left===0)refreshLeaderboard();
  },1000);
  function escapeHtml(value){return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
  const LUCK_MULTIPLIERS=[1,1.1,1.3,1.5,1.7,2];
  const LUCK_COSTS=[10000,150000,700000,2500000,7000000];
  function chooseTier(){
    const luck=LUCK_MULTIPLIERS[state.luckLevel]||1;
    const effectiveWeights=weights.map((weight,index)=>index===0?weight:weight*luck);
    const total=effectiveWeights.reduce((sum,n)=>sum+n,0);
    let roll=Math.random()*total;
    for(let i=0;i<tiers.length;i++){roll-=effectiveWeights[i];if(roll<0)return tiers[i];}
    return tiers[0];
  }
  function patternDetails(digits, chars){
    const digitPairs=digits[0]===digits[1]||digits[1]===digits[2]||digits[0]===digits[2];
    const letterPairs=chars[0]===chars[1]||chars[1]===chars[2]||chars[0]===chars[2];
    const digitTriple=digits[0]===digits[1]&&digits[1]===digits[2];
    const letterTriple=chars[0]===chars[1]&&chars[1]===chars[2];
    const sequence=["123","234","345","456","567","678","789","987","876","765","654","543","432","321"].includes(digits);
    return {digitPairs,letterPairs,digitTriple,letterTriple,sequence,score:(digitPairs?2:0)+(letterPairs?2:0)+(digitTriple?2:0)+(letterTriple?2:0)+(sequence?1:0),label:[digitTriple?"три одинаковые цифры":digitPairs?"две одинаковые цифры":"",letterTriple?"три одинаковые буквы":letterPairs?"две одинаковые буквы":"",sequence?"последовательность":""] .filter(Boolean).join(" · ")};
  }
  function numberReason(digits,chars,region,pattern){
    const reasons=[];
    if(["777","999","001","002","003","004","005"].includes(region)) reasons.push("Престижный региональный код "+region);
    if(["777","001","002","003","111","222","333","555","888","999"].includes(digits)) reasons.push("Красивый цифровой ряд "+digits);
    if(chars[0]===chars[1]&&chars[1]===chars[2]) reasons.push("Три одинаковые буквы — коллекционная серия");
    else if(chars[0]===chars[1]||chars[1]===chars[2]||chars[0]===chars[2]) reasons.push("Повторяющиеся буквы — востребованная комбинация");
    if(digits[0]===digits[1]&&digits[1]===digits[2]) reasons.push("Три одинаковые цифры — «тройной» номер");
    else if(pattern.digitPairs) reasons.push("Повторяющиеся цифры повышают коллекционную ценность");
    if(pattern.sequence) reasons.push("Последовательность цифр — легко запоминаемый номер");
    if(!reasons.length) reasons.push("Цена определяется редкостью выпадения и сочетанием символов");
    return reasons.join(" · ");
  }
  function makeNumber(){
    const baseTier=chooseTier();
    let digits, chars, region;
    if(baseTier.key==="legendary"){
      const premiumDigits=["777","888","999","111","222","333","555"];
      const premiumLetters=["А","М","О","Х","Т","Е","К","С"];
      const letter=premiumLetters[Math.floor(Math.random()*premiumLetters.length)];
      digits=premiumDigits[Math.floor(Math.random()*premiumDigits.length)];
      chars=[letter,letter,letter];
      region=["77","97","99","177","197","199","777"][Math.floor(Math.random()*7)];
    }else{
      digits=String(Math.floor(Math.random()*1000)).padStart(3,"0");
      chars=Array.from({length:3},()=>letters[Math.floor(Math.random()*letters.length)]);
      region=regions[Math.floor(Math.random()*regions.length)].trim();
    }
    const pattern=patternDetails(digits,chars);
    const upgrade=(pattern.digitPairs?1:0)+(pattern.letterPairs?1:0)+(pattern.digitTriple?1:0)+(pattern.letterTriple?1:0);
    const tierIndex=Math.min(4,tiers.findIndex(t=>t.key===baseTier.key)+upgrade);
    const tier=tiers[tierIndex];
    const premiumMultiplier=1+(pattern.digitPairs?0.65:0)+(pattern.letterPairs?0.65:0)+(pattern.digitTriple?1.1:0)+(pattern.letterTriple?1.1:0)+(pattern.sequence?0.35:0);
    let value=Math.round((tier.min+Math.random()*(tier.max-tier.min))*premiumMultiplier/50)*50;
    if(tier.key==="legendary") value=Math.max(15000000,value);
    const reason=numberReason(digits,chars,region,pattern);
    return {id:state.nextId++,digits,chars:chars.join(""),region,plate:chars[0]+digits+chars[1]+chars[2],tier:tier.name,key:tier.key,color:tier.color,value,created:Date.now(),pattern:pattern.label,reason,favorite:false};
  }
  function showWinAnimation(item){
    if(tierRank(item.key)<2 && !item.pattern && !item.reason)return;
    const overlay=$("win-overlay");
    overlay.className="win-overlay rarity-"+item.key+" visible";
    $("win-tier").textContent=item.tier.toUpperCase();
    $("win-plate").textContent=item.plate;
    $("win-region").textContent=item.region;
    $("win-pattern").textContent=item.reason||item.pattern||"Особенная комбинация";
    const price=$("win-price");
    const target=item.value;
    const duration=1500,start=performance.now();
    function frame(now){
      const progress=Math.min(1,(now-start)/duration);
      const eased=1-Math.pow(1-progress,3);
      price.textContent=money(target*eased);
      if(progress<1 && overlay.classList.contains("visible"))requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    clearTimeout(winOverlayTimer);
    winOverlayTimer=setTimeout(()=>overlay.classList.remove("visible"),4200);
  }
  let winOverlayTimer=null;
    function notify(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2400);}
  function makeForcedNumber(forced){
    const plate=String(forced.plate||"").toUpperCase();
    const match=plate.match(/^([АВЕКМНОРСТУХ])(\d{3})([АВЕКМНОРСТУХ]{2})$/);
    if(!match)return makeNumber();
    const region=String(forced.region||"77");
    const value=Math.round((15000000+Math.random()*35000000)/50)*50;
    const chars=match[1]+match[3], pattern=patternDetails(match[2],chars);
    return {id:state.nextId++,digits:match[2],chars,region,plate,tier:"Легендарный",key:"legendary",color:tiers[4].color,value,created:Date.now(),pattern:pattern.label,reason:numberReason(match[2],chars,region,pattern),favorite:false};
  }
  async function spin(){
    if($("spin-button").disabled)return;
    if(state.balance<COST){notify("Недостаточно средств для попытки");return;}
    const btn=$("spin-button");
    btn.disabled=true;btn.querySelector("span:nth-child(2)").textContent="ГЕНЕРАТОР ЗАПУЩЕН";
    let forcedNumber=null;
    if(currentUser&&supabase){
      const {data,error}=await supabase.rpc("consume_forced_number");
      if(error){btn.disabled=false;btn.querySelector("span:nth-child(2)").textContent="КРУТИТЬ ГЕНЕРАТОР";notify("Не удалось проверить настройку номера: "+error.message);return;}
      forcedNumber=data;
    }
    state.balance-=COST;state.spins++;save();render();
    const machine=$("plate-wrap");
    machine.classList.add("spinning");
    $("rarity-label").textContent="ИДЁТ РОЗЫГРЫШ";$("result-value").textContent="Ищем красивую комбинацию…";$("result-hint").textContent="Удача уже где-то рядом";
    let ticks=0;
    const interval=setInterval(()=>{
      $("plate-main").textContent=letters[Math.floor(Math.random()*letters.length)]+String(Math.floor(Math.random()*1000)).padStart(3,"0")+letters[Math.floor(Math.random()*letters.length)]+letters[Math.floor(Math.random()*letters.length)];
      $("plate-region").textContent=regions[Math.floor(Math.random()*regions.length)].trim();ticks++;
      if(ticks>=10){
        clearInterval(interval);machine.classList.remove("spinning");
        const item=forcedNumber?makeForcedNumber(forcedNumber):makeNumber();state.collection.unshift(item);save();
        $("plate-main").textContent=item.plate;$("plate-region").textContent=item.region;
        const info=$("result-info");info.className="result-info rarity-"+item.key;
        $("rarity-label").textContent=item.tier.toUpperCase();$("result-value").textContent="Найдено! Оценка: "+money(item.value);$("result-hint").textContent=item.reason||"Номер добавлен в твою коллекцию";
        machine.classList.add("win-flash");setTimeout(()=>machine.classList.remove("win-flash"),700);
        btn.disabled=false;btn.querySelector("span:nth-child(2)").textContent="КРУТИТЬ ГЕНЕРАТОР";
        render();showWinAnimation(item);notify(item.key==="legendary"?"ЛЕГЕНДАРНАЯ НАХОДКА! "+item.plate:item.tier+": "+item.plate+" — "+money(item.value));
      }
    },60);
  }
  function sell(id){
    const index=state.collection.findIndex(x=>x.id===id);if(index<0)return;
    if(state.collection[index].favorite){notify("Избранный номер нельзя продать");return;}
    const [item]=state.collection.splice(index,1);state.balance+=item.value;
    state.sales.unshift({plate:item.plate,region:item.region,tier:item.tier,value:item.value,date:Date.now()});
    save();render();notify("Продано за "+money(item.value));
  }
  function toggleFavorite(id){
    const item=state.collection.find(x=>x.id===id);if(!item)return;
    item.favorite=!item.favorite;save();render();
    notify(item.favorite?"Добавлено в избранное — номер защищён от продажи":"Убрано из избранного");
  }
  function sellAll(){
    const items=state.collection.filter(x=>!x.favorite);
    if(!items.length){notify("Нет номеров для продажи: все оставшиеся в избранном");return;}
    if(!confirm("Продать все номера, кроме избранных? Количество: "+items.length))return;
    const ids=new Set(items.map(x=>x.id)),total=items.reduce((sum,x)=>sum+x.value,0);
    state.collection=state.collection.filter(x=>!ids.has(x.id));state.balance+=total;
    items.forEach(x=>state.sales.unshift({plate:x.plate,region:x.region,tier:x.tier,value:x.value,date:Date.now()}));
    save();render();notify("Продано номеров: "+items.length+" на "+money(total));
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
  function renderUpgrades(){
    const luckLevel=Math.min(5,Math.max(0,Number(state.luckLevel)||0));
    $("luck-level").textContent="×"+LUCK_MULTIPLIERS[luckLevel];
    $("luck-description").textContent=luckLevel===5?"Максимальный уровень удачи.":"Следующий уровень: ×"+LUCK_MULTIPLIERS[luckLevel+1]+" — повышает вероятность редких номеров.";
    $("buy-luck").textContent=luckLevel===5?"МАКС":"Улучшить · "+money(LUCK_COSTS[luckLevel]);
    $("buy-luck").disabled=luckLevel===5;
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
    $("collection-grid").innerHTML=items.map(item=>`<article class="number-card rarity-${item.key}" style="--tier:${item.color}"><div class="card-top"><span class="tier-tag">${item.tier}</span><span class="card-id">#${String(item.id).padStart(4,"0")}</span></div><div class="small-plate">${item.plate}<small style="font:9px Manrope;margin-left:7px;border-left:1px solid #17212a;padding-left:5px">${item.region}</small></div><p class="number-reason">${escapeHtml(item.reason||item.pattern||"Цена зависит от редкости комбинации")}</p><div class="card-bottom"><strong class="card-price">${money(item.value)}</strong><div class="card-actions"><button class="favorite-button ${item.favorite?"is-favorite":""}" data-favorite="${item.id}">${item.favorite?"★":"☆"}</button>${item.favorite?'<span class="protected-label">Защищён</span>':'<button class="sell-button" data-sell="'+item.id+'">Продать</button>'}</div></div></article>`).join("");
    renderUpgrades();
    $("sales-count").textContent=state.sales.length+" "+plural(state.sales.length,["операция","операции","операций"]);
    $("history-list").innerHTML=state.sales.length?state.sales.slice(0,30).map(s=>`<div class="history-row"><div><strong>${s.plate} · ${s.region}</strong><small>${s.tier} · ${new Date(s.date).toLocaleString("ru-RU",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</small></div><span class="history-amount">+${money(s.value)}</span></div>`).join(""):'<div class="history-empty">Здесь появятся твои сделки</div>';
  }
  function renderOdds(){
    const host=$("odds-controls");if(!host)return;
    const total=weights.reduce((a,b)=>a+b,0);
    host.innerHTML=tiers.map((tier,i)=>'<label class="odds-row"><span>'+tier.name+'</span><input data-odds="'+i+'" type="number" min="0" step="0.1" value="'+Number(weights[i]||0)+'"><b>'+((total?weights[i]/total*100:0).toFixed(2))+'%</b></label>').join("");
  }
  async function initSupabase(){
    const cfg=window.NOMGEN_SUPABASE||{};
    if(!window.supabase||!cfg.url||!cfg.anonKey||cfg.url.includes("YOUR_")||cfg.anonKey.includes("YOUR_")){
      $("odds-status").textContent="Supabase не настроен. Заполни supabase-config.js и выполни supabase/schema.sql.";
      $("admin-toggle").disabled=true;return;
    }
    // Переносим ранее сохранённую сессию на стандартный ключ Supabase.
    const defaultAuthKey="sb-ctuevujtnzjotwwwwszb-auth-token";
    if(!localStorage.getItem(defaultAuthKey)&&localStorage.getItem("nomgen-auth-v1")){
      localStorage.setItem(defaultAuthKey,localStorage.getItem("nomgen-auth-v1"));
    }
    supabase=window.supabase.createClient(cfg.url,cfg.anonKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:"pkce"}
    });
    // Слушатель авторизации регистрируется до любых сетевых запросов.
    supabase.auth.onAuthStateChange((event,session)=>{
      if((event==="SIGNED_IN"||event==="INITIAL_SESSION"||event==="TOKEN_REFRESHED")&&session?.user){
        showGame();
        if(event==="SIGNED_IN"||(event==="INITIAL_SESSION"&&localStorage.getItem("nomgen-oauth-pending")==="1")){
          localStorage.removeItem("nomgen-oauth-pending");
          showRegistrationSuccess();
        }
        setTimeout(()=>loadPlayer(session.user),0);
      }
      if(event==="SIGNED_OUT"){
        currentUser=null;adminUser=null;playerReady=false;loadingUserId=null;
        $("profile-modal").hidden=true;$("settings-modal").hidden=true;
        $("admin-secret").hidden=true;$("admin-panel").hidden=true;$("admin-content").hidden=true;
        $("auth-gate").hidden=false;
        document.body.classList.add("auth-required");
        $("spin-button").disabled=true;
        }
    });
    try{
      // Supabase сам обработает OAuth callback благодаря detectSessionInUrl:true.
      const {data:sessionData,error:sessionError}=await supabase.auth.getSession();
      if(sessionError)throw sessionError;
      if(sessionData?.session?.user){
        showGame();
        await loadPlayer(sessionData.session.user);
      }else{
        $("auth-gate").hidden=false;
        document.body.classList.add("auth-required");
        $("spin-button").disabled=true;
        const pending=localStorage.getItem("nomgen-oauth-pending")==="1";
        const callbackUrl=new URL(window.location.href);
        const oauthError=callbackUrl.searchParams.get("error_description")||callbackUrl.searchParams.get("error")||new URLSearchParams(window.location.hash.slice(1)).get("error_description")||new URLSearchParams(window.location.hash.slice(1)).get("error");
        const hasCode=callbackUrl.searchParams.has("code");
        $("auth-error").textContent=oauthError
          ?"Ошибка OAuth: "+decodeURIComponent(oauthError.replace(/\\+/g," "))
          :hasCode
            ?"Google вернул код, но Supabase не завершил вход. Возможно, не сохранился ключ подтверждения входа (PKCE)."
            :pending
              ?"Google вернул тебя на сайт, но сессия не сохранилась. Проверь настройки Redirect URLs в Supabase."
              :"Сессия не найдена. Нажми «Войти через Google» для входа.";
      }
    }catch(error){
      console.error("Session initialization failed:",error);
      $("auth-error").textContent="Не удалось проверить вход: "+(error.message||error);
      $("auth-gate").hidden=false;
      document.body.classList.add("auth-required");
    }
    // Настройки и рейтинг загружаются отдельно — их ошибки не блокируют вход.
    try{
      const {data,error}=await supabase.from("nomgen_settings").select("weights").eq("id",1).single();
      if(!error&&Array.isArray(data?.weights)&&data.weights.length===5&&data.weights.some(x=>Number(x)>0)&&!currentUser){weights=data.weights.map(Number);renderOdds();}
      else $("odds-status").textContent="Ошибка загрузки глобальных шансов: "+(error?.message||"проверь SQL");
      supabase.channel("nomgen-global-settings").on("postgres_changes",{event:"UPDATE",schema:"public",table:"nomgen_settings",filter:"id=eq.1"},payload=>{
        if(Array.isArray(payload.new.weights)&&!currentUser){weights=payload.new.weights.map(Number);renderOdds();}
      }).subscribe();
    }catch(error){console.warn("Global settings unavailable:",error);}
  }
  async function loadAdminPlayers(){
    if(!adminUser){notify("Нет прав администратора");return;}
    const host=$("admin-player-list");
    host.textContent="Загрузка игроков…";
    const {data,error}=await supabase.rpc("admin_list_players");
    if(error){host.textContent="Ошибка: "+error.message+" Проверь SQL-файл supabase/admin-tools.sql.";return;}
    const rows=data||[];
    const opts=rows.map(p=>'<option value="'+p.user_id+'">'+escapeHtml(p.display_name||p.email||"Игрок")+' — '+money(Number(p.balance)||0)+'</option>').join("")||'<option value="">Игроков пока нет</option>';
    $("money-player").innerHTML=opts;
    const playerOptions=rows.map(p=>'<option value="'+p.user_id+'">'+escapeHtml(p.display_name||p.email||"Игрок")+"</option>").join("")||'<option value="">Игроков пока нет</option>';
    $("odds-player").innerHTML=playerOptions;
    $("forced-player").innerHTML=playerOptions;
    host.innerHTML=rows.length?rows.map(p=>'<div class="admin-player-row"><div><strong>'+escapeHtml(p.display_name||"Игрок")+'</strong><small>'+escapeHtml(p.email||p.user_id)+'</small></div><b>'+money(Number(p.balance)||0)+'</b></div>').join(""):'<p class="admin-status">Игроков пока нет.</p>';
    if(rows.length){
      $("money-player").value=rows[0].user_id;$("money-balance").value=Number(rows[0].balance)||0;
      $("odds-player").value=rows[0].user_id;weights=Array.isArray(rows[0].weights)?rows[0].weights.map(Number):[...DEFAULT_WEIGHTS];renderOdds();
    }
  }
  function selectAdminTab(tab){
    document.querySelectorAll("[data-admin-tab]").forEach(b=>b.classList.toggle("active",b.dataset.adminTab===tab));
    ["players","odds","money","forced"].forEach(name=>$("admin-"+name).hidden=name!==tab);
    if(tab==="players"||tab==="money")loadAdminPlayers();
  }
  function plural(n,forms){const n10=n%10,n100=n%100;return n100>=11&&n100<=14?forms[2]:n10===1?forms[0]:n10>=2&&n10<=4?forms[1]:forms[2];}
  function showRegistrationSuccess(){
    const el=$("auth-success");
    if(!el)return;
    el.hidden=false;
    el.textContent="✓ Регистрация прошла успешно";
    el.classList.add("visible");
    window.setTimeout(()=>{el.classList.remove("visible");el.hidden=true;},5000);
  }
  function renderProfileButton(){
    const img=$("profile-avatar");
    if(!img)return;
    const source=avatarData||(currentUser?.user_metadata?.avatar_url||"");
    img.innerHTML=source?'<img src="'+source+'" alt="Аватар">':'<span>'+(escapeHtml((playerName||"И").trim().charAt(0).toUpperCase()||"И"))+'</span>';
    $("profile-button").setAttribute("aria-label","Профиль: "+playerName);
  }
  $("settings-open").addEventListener("click",()=>{$("profile-modal").hidden=true;$("settings-modal").hidden=false;renderUpgrades();syncMusicControls();});
  function syncMusicControls(){
    $("music-toggle").textContent=musicEnabled?"Выключить фоновую музыку":"Включить фоновую музыку";
    $("music-toggle").classList.toggle("active",musicEnabled);
    $("music-volume").value=Math.round(musicVolume*100);
    $("music-volume-value").textContent=Math.round(musicVolume*100)+"%";
  }
  function stopAmbientMusic(){
    if(musicTimer){clearInterval(musicTimer);musicTimer=null;}
    if(musicMelodyTimer){clearInterval(musicMelodyTimer);musicMelodyTimer=null;}
    musicNodes.forEach(node=>{try{node.stop();}catch(e){}});
    musicNodes=[];musicMaster=null;
    if(musicContext){musicContext.close().catch(()=>{});musicContext=null;}
  }
  async function startAmbientMusic(){
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx){notify("Этот браузер не поддерживает фоновую музыку");return;}
    if(!musicContext){
      musicContext=new AudioCtx();
      musicMaster=musicContext.createGain();musicMaster.gain.value=musicVolume*0.4;musicMaster.connect(musicContext.destination);
      const filter=musicContext.createBiquadFilter();filter.type="lowpass";filter.frequency.value=1800;filter.connect(musicMaster);
      const notes=[164.81,207.65,246.94,329.63];
      notes.forEach((hz,i)=>{
        const osc=musicContext.createOscillator(),gain=musicContext.createGain();
        osc.type="sine";osc.frequency.value=hz;gain.gain.value=[0.18,0.12,0.1,0.07][i];
        osc.connect(gain);gain.connect(filter);osc.start();musicNodes.push(osc);
      });
      let chord=0;
      const progressions=[[164.81,207.65,246.94,329.63],[146.83,185,220,293.66],[130.81,164.81,196,261.63],[146.83,185,220,293.66]];
      musicTimer=setInterval(()=>{
        if(!musicContext)return;
        chord=(chord+1)%progressions.length;
        progressions[chord].forEach((hz,i)=>musicNodes[i]?.frequency.setTargetAtTime(hz,musicContext.currentTime,1.5));
      },8000);
      // Оригинальная лёгкая игровая мелодия с колокольчиковым тембром.
      const melody=[[79,1],[76,1],[74,1],[72,1],[74,1],[76,1],[79,2],[76,1],[74,1],[72,1],[74,1],[76,1],[74,1],[76,1],[79,2],[76,1],[79,1],[81,2],[76,1],[81,1],[79,2],[76,1],[74,1],[72,2]];
      let noteIndex=0;
      const playNote=()=>{
        if(!musicContext||musicContext.state==="closed")return;
        const [midi,beats]=melody[noteIndex],now=musicContext.currentTime;
        const osc=musicContext.createOscillator(),gain=musicContext.createGain();
        osc.type="triangle";osc.frequency.value=440*Math.pow(2,(midi-69)/12);
        gain.gain.setValueAtTime(0.0001,now);gain.gain.linearRampToValueAtTime(0.38,now+0.08);
        gain.gain.setTargetAtTime(0.0001,now+beats*0.48,0.16);
        osc.connect(gain);gain.connect(filter);osc.start(now);osc.stop(now+beats*0.48+0.7);
        noteIndex=(noteIndex+1)%melody.length;
      };
      playNote();musicMelodyTimer=setInterval(playNote,480);
    }
    try{await musicContext.resume();}catch(e){}
    if(musicMaster)musicMaster.gain.setTargetAtTime(musicVolume*0.4,musicContext.currentTime,0.15);
  }
  document.addEventListener("pointerdown",()=>{if(musicEnabled&&!musicContext)startAmbientMusic();},{once:true});
  $("music-toggle").addEventListener("click",async()=>{
    musicEnabled=!musicEnabled;localStorage.setItem("nomgen-music-enabled",musicEnabled?"1":"0");
    if(musicEnabled)await startAmbientMusic();else stopAmbientMusic();
    syncMusicControls();
  });
  $("music-volume").addEventListener("input",e=>{
    musicVolume=Number(e.target.value)/100;localStorage.setItem("nomgen-music-volume",String(musicVolume));
    if(musicMaster&&musicContext)musicMaster.gain.setTargetAtTime(musicVolume*0.4,musicContext.currentTime,0.08);
    syncMusicControls();
  });
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&musicContext?.state==="running")musicContext.suspend();else if(!document.hidden&&musicEnabled&&musicContext)musicContext.resume().catch(()=>{});});
  $("settings-close").addEventListener("click",()=>{$("settings-modal").hidden=true;});
  $("settings-modal").addEventListener("click",e=>{if(e.target===$("settings-modal"))$("settings-modal").hidden=true;});
  $("collection-open").addEventListener("click",()=>{$("collection-modal").hidden=false;});
  $("collection-close").addEventListener("click",()=>{$("collection-modal").hidden=true;});
  $("collection-modal").addEventListener("click",e=>{if(e.target===$("collection-modal"))$("collection-modal").hidden=true;});
  $("admin-secret").addEventListener("click",()=>{if(!adminUser||currentUser?.id!==adminUser.id){notify("Доступ только для администраторского аккаунта");return;} $("admin-panel").hidden=false;});
  $("buy-luck").addEventListener("click",()=>{
    const level=state.luckLevel||0;if(level>=5)return;
    const price=LUCK_COSTS[level];
    if(state.balance<price){notify("Недостаточно денег для улучшения удачи");return;}
    state.balance-=price;state.luckLevel=level+1;save();render();notify("Удача улучшена до ×"+LUCK_MULTIPLIERS[state.luckLevel]);
  });
  $("profile-button").addEventListener("click",()=>{
    $("profile-name").value=playerName;
    $("profile-preview").innerHTML=avatarData?'<img src="'+avatarData+'" alt="Аватар">':'<span>'+(escapeHtml(playerName.charAt(0).toUpperCase()||"И"))+'</span>';
    $("profile-modal").hidden=false;
  });
  $("profile-close").addEventListener("click",()=>$("profile-modal").hidden=true);
  $("profile-modal").addEventListener("click",e=>{if(e.target===$("profile-modal"))$("profile-modal").hidden=true;});
  $("avatar-file").addEventListener("change",()=>{
    const file=$("avatar-file").files?.[0];if(!file)return;
    if(!file.type.startsWith("image/")){notify("Выбери файл изображения");return;}
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement("canvas");canvas.width=160;canvas.height=160;
        const ctx=canvas.getContext("2d");const side=Math.min(img.width,img.height);
        ctx.drawImage(img,(img.width-side)/2,(img.height-side)/2,side,side,0,0,160,160);
        avatarData=canvas.toDataURL("image/jpeg",.72);
        $("profile-preview").innerHTML='<img src="'+avatarData+'" alt="Аватар">';
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
  $("profile-save").addEventListener("click",async()=>{
    const name=$("profile-name").value.trim().slice(0,20);
    if(!name){notify("Введи имя профиля");return;}
    playerName=name;localStorage.setItem("nomgen-player-name",playerName);
    localStorage.setItem("nomgen-avatar",avatarData);
    if(currentUser&&supabase){
      const {error}=await supabase.auth.updateUser({data:{display_name:playerName,avatar_data:avatarData}});
      if(error){notify("Не удалось сохранить аватар в аккаунте: "+error.message);return;}
    }
    $("player-name").value=playerName;
    await persistProfile();renderProfileButton();$("profile-modal").hidden=true;
    notify("Профиль обновлён");
  });
  $("avatar-remove").addEventListener("click",()=>{
    avatarData="";localStorage.removeItem("nomgen-avatar");
    $("avatar-file").value="";
    $("profile-preview").innerHTML='<span>'+(escapeHtml(playerName.charAt(0).toUpperCase()||"И"))+'</span>';
  });
  $("guest-login").addEventListener("click",async()=>{
    const accepted=confirm("ВНИМАНИЕ! Гостевой режим начнётся с нуля. Весь текущий прогресс на этом устройстве — баланс, коллекция и история — будет сброшен. Прогресс гостя не сохраняется в Google-аккаунте. Продолжить?");
    if(!accepted)return;
    currentUser=null;adminUser=null;playerReady=false;
    if(supabase) await supabase.auth.signOut();
    state.balance=5000;state.collection=[];state.sales=[];state.spins=0;state.nextId=1;state.luckLevel=0;
    localStorage.removeItem(STORAGE_KEY);
    save();
    $("plate-main").textContent="А000АА";$("plate-region").textContent="77";
    $("rarity-label").textContent="ГОТОВ К РОЗЫГРЫШУ";
    $("result-value").textContent="Твоя следующая находка?";
    $("result-hint").textContent="Нажми кнопку, чтобы запустить генератор";
    $("result-info").className="result-info";
    $("player-name").value="Игрок";
    playerName="Игрок";avatarData="";localStorage.removeItem("nomgen-avatar");renderProfileButton();localStorage.setItem("nomgen-player-name",playerName);
    render();renderUpgrades();showGame();configureAutoTap();
  });
  $("google-login").addEventListener("click",async()=>{
    if(!supabase){$("auth-error").textContent="Supabase не настроен.";return;}
    $("google-login").disabled=true;$("auth-error").textContent="Переход к Google…";
    localStorage.setItem("nomgen-oauth-pending","1");
    const {error}=await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:window.location.origin+window.location.pathname,queryParams:{prompt:"select_account"}}});
    if(error){localStorage.removeItem("nomgen-oauth-pending");$("auth-error").textContent="Ошибка входа: "+error.message;$("google-login").disabled=false;}
  });
  async function logoutAccount(){
    if(currentUser&&supabase){
      const {error}=await supabase.auth.signOut();
      if(error){notify("Не удалось выйти: "+error.message);return;}
    }else{
      currentUser=null;adminUser=null;playerReady=false;loadingUserId=null;
      $("auth-gate").hidden=false;document.body.classList.add("auth-required");
      $("spin-button").disabled=true;configureAutoTap();
    }
    $("profile-modal").hidden=true;$("settings-modal").hidden=true;
    $("admin-secret").hidden=true;$("admin-panel").hidden=true;
  }
  $("logout-button").addEventListener("click",logoutAccount);
  $("profile-logout").addEventListener("click",logoutAccount);
  $("spin-button").addEventListener("click",spin);
  $("save-player").addEventListener("click",async()=>{
    const name=$("player-name").value.trim().slice(0,20);
    if(!name){notify("Введи имя игрока");return;}
    playerName=name;localStorage.setItem("nomgen-player-name",playerName);$("player-name").value=playerName;render();await persistProfile();notify("Профиль сохранён");
  });
  $("admin-toggle").addEventListener("click",async()=>{
    if(!supabase){notify("Сначала настрой Supabase");return;}
    if(adminUser){$("admin-content").hidden=!$("admin-content").hidden;$("admin-toggle").textContent=$("admin-content").hidden?"Открыть":"Скрыть";if(!$("admin-content").hidden)selectAdminTab("players");return;}
    const email=prompt("Email администратора Supabase:");if(!email)return;
    const password=prompt("Пароль аккаунта Supabase:");if(!password)return;
    const {data,error}=await supabase.auth.signInWithPassword({email,password});
    if(error){notify("Ошибка входа: "+error.message);return;}
    const {data:isAdmin,error:roleError}=await supabase.rpc("is_nomgen_admin");
    if(roleError||!isAdmin){await supabase.auth.signOut();notify("У аккаунта нет прав администратора");return;}
    adminUser=data.user;$("admin-content").hidden=false;$("admin-toggle").textContent="Скрыть";renderOdds();$("odds-status").textContent="Вход выполнен: "+email;selectAdminTab("players");
  });
  document.querySelectorAll("[data-admin-tab]").forEach(b=>b.addEventListener("click",()=>selectAdminTab(b.dataset.adminTab)));
  $("refresh-admin-players").addEventListener("click",loadAdminPlayers);
  $("save-player-balance").addEventListener("click",async()=>{
    if(!adminUser){notify("Нет прав администратора");return;}
    const userId=$("money-player").value, balance=Number($("money-balance").value);
    if(!userId||!Number.isSafeInteger(balance)||balance<0){notify("Введи целый баланс от 0 ₽");return;}
    const {error}=await supabase.rpc("admin_set_player_balance",{target_user_id:userId,new_balance:balance});
    if(error){notify("Не удалось изменить баланс: "+error.message);return;}
    if(userId===currentUser?.id){state.balance=balance;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render();}
    notify("Баланс игрока обновлён");await loadAdminPlayers();await refreshLeaderboard();
  });
  $("odds-player").addEventListener("change",async()=>{
    const {data,error}=await supabase.rpc("admin_get_player_weights",{target_user_id:$("odds-player").value});
    if(error){$("odds-status").textContent="Не удалось загрузить шансы: "+error.message;return;}
    weights=Array.isArray(data)?data.map(Number):[...DEFAULT_WEIGHTS];renderOdds();
  });
  $("apply-odds").addEventListener("click",async()=>{
    if(!supabase||!adminUser){notify("Войди как администратор");return;}
    const next=Array.from(document.querySelectorAll("[data-odds]"),el=>Math.max(0,Number(el.value)||0));
    if(next.every(x=>x===0)){notify("Хотя бы один вес должен быть больше нуля");return;}
    const {error}=await supabase.rpc("admin_set_player_weights",{target_user_id:$("odds-player").value,new_weights:next});
    if(error){notify("Не удалось сохранить: "+error.message);return;}
    weights=next;renderOdds();$("odds-status").textContent="Персональные шансы игрока сохранены.";notify("Шансы игрока обновлены");
  });
  $("reset-odds").addEventListener("click",async()=>{
    if(!supabase||!adminUser){notify("Войди как администратор");return;}
    const {error}=await supabase.rpc("admin_set_player_weights",{target_user_id:$("odds-player").value,new_weights:DEFAULT_WEIGHTS});
    if(error){notify("Не удалось сбросить: "+error.message);return;}
    weights=[...DEFAULT_WEIGHTS];renderOdds();$("odds-status").textContent="Стандартные шансы восстановлены для выбранного игрока.";notify("Шансы сброшены");
  });
  $("forced-save").addEventListener("click",async()=>{
    if(!supabase||!adminUser){notify("Войди как администратор");return;}
    const userId=$("forced-player").value;
    const plate=$("forced-plate").value.trim().toUpperCase().replace(/\s/g,"");
    const region=$("forced-region").value.trim();
    const count=Number($("forced-count").value);
    if(!userId){notify("Выбери игрока");return;}
    if(!/^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}$/.test(plate)){notify("Введи номер в формате А777АА");return;}
    if(!/^\d{2,3}$/.test(region)){notify("Регион должен содержать 2–3 цифры");return;}
    if(!Number.isInteger(count)||count<1||count>100){notify("Количество попыток: от 1 до 100");return;}
    const {error}=await supabase.rpc("admin_set_forced_number",{target_user_id:userId,forced_plate:plate,forced_region:region,spin_count:count});
    if(error){notify("Не удалось назначить номер: "+error.message);return;}
    $("forced-status").textContent="Назначено: "+plate+" · регион "+region+" · выпадет "+count+" раз подряд.";
    notify("Номер назначен выбранному игроку");
  });
  $("forced-clear").addEventListener("click",async()=>{
    if(!supabase||!adminUser){notify("Войди как администратор");return;}
    const userId=$("forced-player").value;
    if(!userId){notify("Выбери игрока");return;}
    const {error}=await supabase.rpc("admin_clear_forced_number",{target_user_id:userId});
    if(error){notify("Не удалось отменить: "+error.message);return;}
    $("forced-status").textContent="Назначенный номер отменён.";
    notify("Настройка выпадения отменена");
  });
  $("win-close").addEventListener("click",()=>{$("win-overlay").classList.remove("visible");clearTimeout(winOverlayTimer);});
  $("win-overlay").addEventListener("click",e=>{if(e.target===$("win-overlay")){$("win-overlay").classList.remove("visible");clearTimeout(winOverlayTimer);}});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")$("win-overlay").classList.remove("visible");});
  $("collection-grid").addEventListener("click",e=>{const fav=e.target.closest("[data-favorite]");if(fav){toggleFavorite(Number(fav.dataset.favorite));return;}const btn=e.target.closest("[data-sell]");if(btn)sell(Number(btn.dataset.sell));});
  $("sell-duplicates").addEventListener("click",sellDuplicates);
  $("sell-all").addEventListener("click",sellAll);
  $("menu-button").addEventListener("click",()=>$("menu-modal").hidden=false);
  $("menu-close").addEventListener("click",()=>$("menu-modal").hidden=true);
  $("menu-modal").addEventListener("click",e=>{if(e.target===$("menu-modal"))$("menu-modal").hidden=true;});
  $("menu-collection").addEventListener("click",()=>{$("menu-modal").hidden=true;$("collection-modal").hidden=false;});
  $("menu-upgrades").addEventListener("click",()=>{$("menu-modal").hidden=true;$("upgrade-modal").hidden=false;renderUpgrades();});
  $("upgrade-close").addEventListener("click",()=>$("upgrade-modal").hidden=true);
  $("upgrade-modal").addEventListener("click",e=>{if(e.target===$("upgrade-modal"))$("upgrade-modal").hidden=true;});
  $("home-button").addEventListener("click",()=>{document.querySelectorAll(".feature-modal").forEach(m=>m.hidden=true);window.scrollTo({top:0,behavior:"smooth"});});
  $("sort-select").addEventListener("change",render);
  $("reset-game").addEventListener("click",()=>{if(confirm("Сбросить весь прогресс? Баланс вернётся к 5 000 ₽, коллекция, история и улучшения будут удалены.")){state.balance=5000;state.collection=[];state.sales=[];state.spins=0;state.nextId=1;state.luckLevel=0;state.autoTapLevel=0;state.autoTapEnabled=false;configureAutoTap();save();$("plate-main").textContent="А000АА";$("plate-region").textContent="77";$("rarity-label").textContent="ГОТОВ К РОЗЫГРЫШУ";$("result-value").textContent="Твоя следующая находка?";$("result-hint").textContent="Нажми кнопку, чтобы запустить генератор";$("result-info").className="result-info";render();notify("Прогресс сброшен");}});
  $("player-name").value=playerName;
  render();
  renderUpgrades();
  configureAutoTap();
  renderProfileButton();
  initSupabase();
})();