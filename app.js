(() => {
  "use strict";
  const COST = 500;
  const STORAGE_KEY = "nomgen-save-v1";
  const ODDS_KEY = "nomgen-odds-v1";
  const PLAYERS_KEY = "nomgen-players-v1";
  const DEFAULT_WEIGHTS = [69.5,22,7,1.5,.5];
  let weights = [...DEFAULT_WEIGHTS];
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
  function load(){
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if(saved && typeof saved.balance === "number" && Array.isArray(saved.collection) && Array.isArray(saved.sales)) return {...saved, spins:Number(saved.spins)||0, balance:Math.max(0,saved.balance)};
    } catch(e) {}
    return {balance:5000,collection:[],sales:[],spins:0,nextId:1};
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
      if(!adminError&&isAdmin){adminUser=user;$("admin-content").hidden=false;renderOdds();}
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
  async function refreshLeaderboard(){
    if(!supabase)return;
    const {data,error}=await supabase.from("nomgen_players").select("user_id,display_name,rarest_plate,rarest_region,rarest_tier,rarest_value,rarity_rank").order("rarity_rank",{ascending:false}).order("rarest_value",{ascending:false}).limit(100);
    if(error){$("leaderboard").innerHTML='<div class="history-empty">Не удалось загрузить рейтинг: '+error.message+'</div>';return;}
    $("leaderboard").innerHTML=data?.length?data.map((p,i)=>'<div class="leader-row"><span class="leader-rank">'+(i+1)+'</span><div class="leader-details"><strong>'+escapeHtml(p.display_name||"Игрок")+'</strong><small>'+(p.rarest_plate?escapeHtml(p.rarest_tier)+" · "+escapeHtml(p.rarest_plate)+" · регион "+escapeHtml(p.rarest_region||"—"):"Пока нет номеров")+'</small></div><span>'+money(Number(p.rarest_value)||0)+'</span></div>').join(""):'<div class="history-empty">Пока нет участников. Стань первым!</div>';
  }
  function escapeHtml(value){return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
  function chooseTier(){
    const total=weights.reduce((sum,n)=>sum+n,0);
    let roll=Math.random()*total;
    for(let i=0;i<tiers.length;i++){roll-=weights[i];if(roll<0)return tiers[i];}
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
    let digits, chars, region;
    if(tier.key==="legendary"){
      // Легендарные находки — только узнаваемые «зеркальные» номера с тройными цифрами и буквами.
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
    const score=patternScore(digits,chars);
    let value=Math.round((tier.min+Math.random()*(tier.max-tier.min))*(1+score*.12)/50)*50;
    if(tier.key==="legendary") value=Math.max(15000000,value);
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
        currentUser=null;playerReady=false;loadingUserId=null;
        $("auth-gate").hidden=false;
        document.body.classList.add("auth-required");
        $("spin-button").disabled=true;
      }
    });
    try{
      const {data:sessionData,error:sessionError}=await supabase.auth.getSession();
      if(sessionError)throw sessionError;
      if(sessionData?.session?.user){
        showGame();
        await loadPlayer(sessionData.session.user);
      }else{
        $("auth-gate").hidden=false;
        document.body.classList.add("auth-required");
        $("spin-button").disabled=true;
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
      if(!error&&Array.isArray(data?.weights)&&data.weights.length===5&&data.weights.some(x=>Number(x)>0)){weights=data.weights.map(Number);renderOdds();}
      else $("odds-status").textContent="Ошибка загрузки глобальных шансов: "+(error?.message||"проверь SQL");
      supabase.channel("nomgen-global-settings").on("postgres_changes",{event:"UPDATE",schema:"public",table:"nomgen_settings",filter:"id=eq.1"},payload=>{
        if(Array.isArray(payload.new.weights)){weights=payload.new.weights.map(Number);renderOdds();}
      }).subscribe();
    }catch(error){console.warn("Global settings unavailable:",error);}
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
    state.balance=5000;state.collection=[];state.sales=[];state.spins=0;state.nextId=1;
    localStorage.removeItem(STORAGE_KEY);
    save();
    $("plate-main").textContent="А000АА";$("plate-region").textContent="77";
    $("rarity-label").textContent="ГОТОВ К РОЗЫГРЫШУ";
    $("result-value").textContent="Твоя следующая находка?";
    $("result-hint").textContent="Нажми кнопку, чтобы запустить генератор";
    $("result-info").className="result-info";
    $("player-name").value="Игрок";
    playerName="Игрок";avatarData="";localStorage.removeItem("nomgen-avatar");renderProfileButton();localStorage.setItem("nomgen-player-name",playerName);
    render();showGame();
  });
  $("google-login").addEventListener("click",async()=>{
    if(!supabase){$("auth-error").textContent="Supabase не настроен.";return;}
    $("google-login").disabled=true;$("auth-error").textContent="Переход к Google…";
    localStorage.setItem("nomgen-oauth-pending","1");
    const {error}=await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:window.location.origin+window.location.pathname}});
    if(error){localStorage.removeItem("nomgen-oauth-pending");$("auth-error").textContent="Ошибка входа: "+error.message;$("google-login").disabled=false;}
  });
  $("logout-button").addEventListener("click",async()=>{if(supabase)await supabase.auth.signOut();});
  $("spin-button").addEventListener("click",spin);
  $("save-player").addEventListener("click",async()=>{
    const name=$("player-name").value.trim().slice(0,20);
    if(!name){notify("Введи имя игрока");return;}
    playerName=name;localStorage.setItem("nomgen-player-name",playerName);$("player-name").value=playerName;render();await persistProfile();notify("Профиль сохранён");
  });
  $("admin-toggle").addEventListener("click",async()=>{
    if(!supabase){notify("Сначала настрой Supabase");return;}
    if(adminUser){$("admin-content").hidden=!$("admin-content").hidden;$("admin-toggle").textContent=$("admin-content").hidden?"Открыть":"Скрыть";return;}
    const email=prompt("Email администратора Supabase:");if(!email)return;
    const password=prompt("Пароль аккаунта Supabase:");if(!password)return;
    const {data,error}=await supabase.auth.signInWithPassword({email,password});
    if(error){notify("Ошибка входа: "+error.message);return;}
    const {data:isAdmin,error:roleError}=await supabase.rpc("is_nomgen_admin");
    if(roleError||!isAdmin){await supabase.auth.signOut();notify("У аккаунта нет прав администратора");return;}
    adminUser=data.user;$("admin-content").hidden=false;$("admin-toggle").textContent="Скрыть";renderOdds();$("odds-status").textContent="Вход выполнен: "+email;
  });
  $("apply-odds").addEventListener("click",async()=>{
    if(!supabase||!adminUser){notify("Войди как администратор");return;}
    const next=Array.from(document.querySelectorAll("[data-odds]"),el=>Math.max(0,Number(el.value)||0));
    if(next.every(x=>x===0)){notify("Хотя бы один вес должен быть больше нуля");return;}
    const {error}=await supabase.from("nomgen_settings").update({weights:next,updated_at:new Date().toISOString()}).eq("id",1);
    if(error){notify("Не удалось сохранить: "+error.message);return;}
    weights=next;renderOdds();$("odds-status").textContent="Общие шансы сохранены для всех игроков.";notify("Глобальные шансы обновлены");
  });
  $("reset-odds").addEventListener("click",async()=>{
    if(!supabase||!adminUser){notify("Войди как администратор");return;}
    const {error}=await supabase.from("nomgen_settings").update({weights:DEFAULT_WEIGHTS,updated_at:new Date().toISOString()}).eq("id",1);
    if(error){notify("Не удалось сбросить: "+error.message);return;}
    weights=[...DEFAULT_WEIGHTS];renderOdds();$("odds-status").textContent="Стандартные общие шансы восстановлены.";notify("Шансы сброшены");
  });
  $("collection-grid").addEventListener("click",e=>{const btn=e.target.closest("[data-sell]");if(btn)sell(Number(btn.dataset.sell));});
  $("sell-duplicates").addEventListener("click",sellDuplicates);
  $("sort-select").addEventListener("change",render);
  $("reset-game").addEventListener("click",()=>{if(confirm("Сбросить весь прогресс? Баланс вернётся к 5 000 ₽, коллекция и история будут удалены.")){state.balance=5000;state.collection=[];state.sales=[];state.spins=0;state.nextId=1;save();$("plate-main").textContent="А000АА";$("plate-region").textContent="77";$("rarity-label").textContent="ГОТОВ К РОЗЫГРЫШУ";$("result-value").textContent="Твоя следующая находка?";$("result-hint").textContent="Нажми кнопку, чтобы запустить генератор";$("result-info").className="result-info";render();notify("Прогресс сброшен");}});
  $("player-name").value=playerName;
  render();
  renderProfileButton();
  initSupabase();
})();