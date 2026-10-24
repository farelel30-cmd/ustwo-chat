(() => {
  const cfg = window.USTWO_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const authView = $('authView'), chatView = $('chatView'), authForm = $('authForm');
  let supabase = null, currentUser = null, messagesChannel = null, presenceChannel = null;
  let authMode = 'login', typingTimer = null, typingClearTimer = null, recorder = null, recordedChunks = [], isRecording = false;
  let knownMessages = new Set(), toastTimer = null, profileChannel = null, profiles = {}, pendingAvatar = undefined;
  const allowed = new Set((cfg.ALLOWED_USER_IDS || []).filter(x => x && !x.includes('UUID')));
  const esc = (value='') => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const formatTime = (value) => new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit'}).format(new Date(value));
  const formatDate = (value) => new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value));
  const prettySize = (n) => { if (!Number.isFinite(n)) return ''; const units=['B','KB','MB','GB','TB']; let i=0; while(n>=1024 && i<units.length-1){n/=1024;i++;} return `${n.toFixed(i>1?1:0)} ${units[i]}`; };
  function toast(message) { const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),3200); }
  function configured() { return cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('YOUR-PROJECT') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('YOUR_'); }
  function showAuth(message='') { authView.classList.remove('hidden'); chatView.classList.add('hidden'); $('authMessage').textContent=message; }
  function showChat() { authView.classList.add('hidden'); chatView.classList.remove('hidden'); }
  function allowedUser(user) { return !!user && allowed.has(user.id); }
  function setConnection(text, ok=false) { $('connectionLabel').textContent=text; $('presenceText').textContent=text; const dot=document.querySelector('.side-footer .online-dot'); if(dot)dot.style.background=ok?'#62aa83':'#d7a0b5'; }
  async function init() {
    if (!configured() || !window.supabase) { showAuth('Konfigurasi belum diisi. Ikuti README untuk menyiapkan Supabase dan config.js.'); $('authSubmit').disabled=true; $('authSubmit').textContent='Menunggu konfigurasi'; return; }
    supabase=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data:{session}}=await supabase.auth.getSession();
    if(session?.user) await enterApp(session.user); else showAuth();
  }
  authForm.addEventListener('submit', async (e)=>{
    e.preventDefault(); if(!supabase)return;
    const email=$('email').value.trim(), password=$('password').value; $('authSubmit').disabled=true; $('authMessage').textContent='Memeriksa akun...';
    try {
      // Signup sengaja tidak dibuka dari frontend. Buat tepat dua akun di dashboard Auth,
      // lalu masukkan UUID keduanya ke allowlist dan aturan database.
      const {data,error}=await supabase.auth.signInWithPassword({email,password});
      if(error) throw error;
      if(!allowedUser(data.user)){ await supabase.auth.signOut(); throw new Error('Akun ini belum diizinkan masuk ke UsTwo Chat.'); }
      await enterApp(data.user);
    } catch(err) { $('authMessage').textContent=err.message || 'Login gagal.'; }
    finally { $('authSubmit').disabled=false; }
  });
  $('toggleAuth').addEventListener('click',()=>toast('Pendaftaran dilakukan oleh pemilik project di Supabase agar hanya dua akun yang diizinkan.'));
  $('logoutBtn').addEventListener('click',async()=>{ await cleanupChannels(); await supabase?.auth.signOut(); currentUser=null; showAuth('Kamu sudah keluar.'); });

  async function enterApp(user) {
    if(!allowedUser(user)){await supabase.auth.signOut();showAuth('Akun ini belum diizinkan masuk ke UsTwo Chat.');return;}
    currentUser=user; showChat(); setConnection('Menghubungkan...',false); $('partnerTitle').textContent='Ruang kecil kita';
    await loadProfiles(); subscribeProfiles(); await loadMessages(); subscribeMessages(); subscribePresence();
  }
  async function cleanupChannels(){ if(messagesChannel)await supabase.removeChannel(messagesChannel); if(presenceChannel)await supabase.removeChannel(presenceChannel); if(profileChannel)await supabase.removeChannel(profileChannel); messagesChannel=null;presenceChannel=null;profileChannel=null; }
  const partnerId = () => [...allowed].find(id=>id!==currentUser?.id);
  const displayName = (id) => profiles[id]?.display_name || cfg.DISPLAY_NAMES?.[id] || (id===currentUser?.id?'Kamu':'Pasangan');
  function avatarMarkup(id, cls='') { const p=profiles[id]; return p?.avatar_data ? '<img class="'+cls+'" src="'+esc(p.avatar_data)+'" alt="Foto profil">' : '<span class="'+cls+' avatar-fallback">'+esc(displayName(id).slice(0,1).toUpperCase()||'♡')+'</span>'; }
  function paintAvatars(){ const mine=profiles[currentUser?.id], other=profiles[partnerId()]; const ownBtn=$('myProfileBtn'); if(ownBtn) ownBtn.innerHTML=mine?.avatar_data?avatarMarkup(currentUser.id,'header-avatar-img'):'☺'; const partnerBtn=$('partnerAvatarBtn'); if(partnerBtn)partnerBtn.innerHTML=other?.avatar_data?avatarMarkup(partnerId(),'header-avatar-img'):'♡'; document.querySelectorAll('.couple-avatars span').forEach((el,i)=>{const id=i===0?currentUser?.id:partnerId();el.innerHTML=avatarMarkup(id,'side-avatar-img');}); const conv=document.querySelector('.conversation-avatar');if(conv)conv.innerHTML=avatarMarkup(partnerId(),'side-avatar-img'); const preview=$('profilePreview'), initial=$('profileInitial'); if(preview&&initial){const data=pendingAvatar!==undefined?pendingAvatar:mine?.avatar_data;preview.src=data||'';preview.classList.toggle('hidden',!data);initial.classList.toggle('hidden',!!data);initial.textContent=displayName(currentUser?.id).slice(0,1).toUpperCase()||'♡';} }
  async function loadProfiles(){ const {data,error}=await supabase.from('profiles').select('user_id,display_name,avatar_data'); if(error){console.warn('Profil belum dikonfigurasi:',error.message);toast('Jalankan profiles.sql di Supabase untuk mengaktifkan foto profil.');profiles={};}else{profiles={};for(const p of data||[])profiles[p.user_id]=p;}paintAvatars(); }
  function subscribeProfiles(){ profileChannel=supabase.channel('ustwo-profiles').on('postgres_changes',{event:'*',schema:'public',table:'profiles'},payload=>{const p=payload.new;if(p?.user_id)profiles[p.user_id]=p;paintAvatars();}).subscribe(); }
  function openProfileDialog(){pendingAvatar=undefined;$('profileMessage').textContent='';paintAvatars();$('profileDialog').showModal();}
  $('myProfileBtn').addEventListener('click',openProfileDialog); $('partnerAvatarBtn').addEventListener('click',()=>toast(displayName(partnerId()))); $('closeProfileBtn').addEventListener('click',()=>$('profileDialog').close()); $('chooseAvatarBtn').addEventListener('click',()=>$('avatarFileInput').click());
  $('avatarFileInput').addEventListener('change',async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(!file.type.startsWith('image/')){toast('Pilih file gambar ya.');return;}try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Foto tidak bisa dibaca.'));reader.onload=()=>{const img=new Image();img.onerror=()=>reject(new Error('Format foto tidak didukung.'));img.onload=()=>{const canvas=document.createElement('canvas');const scale=Math.min(1,512/Math.max(img.width,img.height));canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',0.78));};img.src=reader.result;};reader.readAsDataURL(file);});if(data.length>500000){toast('Foto masih terlalu besar, coba foto lain.');return;}pendingAvatar=data;paintAvatars();}catch(err){toast(err.message||'Gagal memproses foto.');}});
  $('removeAvatarBtn').addEventListener('click',()=>{pendingAvatar=null;paintAvatars();});
  $('profileForm').addEventListener('submit',async e=>{e.preventDefault();if(pendingAvatar===undefined){$('profileDialog').close();return;}const btn=$('saveProfileBtn');btn.disabled=true;$('profileMessage').textContent='Menyimpan foto profil...';try{const {data:authData}=await supabase.auth.getUser();if(!authData.user||authData.user.id!==currentUser.id)throw new Error('Sesi login perlu diperiksa.');const record={user_id:currentUser.id,display_name:cfg.DISPLAY_NAMES?.[currentUser.id]||'Pengguna',avatar_data:pendingAvatar};const {data,error}=await supabase.from('profiles').upsert(record,{onConflict:'user_id'}).select().single();if(error)throw error;profiles[currentUser.id]=data;pendingAvatar=undefined;paintAvatars();$('profileDialog').close();toast('Foto profil berhasil disimpan ♡');}catch(err){$('profileMessage').textContent='Gagal menyimpan: '+(err.message||'Periksa tabel dan izin Supabase.');}finally{btn.disabled=false;}});
  async function loadMessages(){
    const {data,error}=await supabase.from('messages').select('*').order('created_at',{ascending:true}).limit(250);
    if(error){toast('Belum bisa memuat chat. Periksa SQL dan aturan akses.');console.error(error);return;}
    $('messages').innerHTML='';knownMessages.clear();
    if(!data.length) renderWelcome();
    for(const row of data) await renderMessage(row,false);
    scrollToBottom(); markUnreadRead(data.filter(m=>m.sender_id!==currentUser.id && !m.read_at).map(m=>m.id));
    if(data.length) $('lastPreview').textContent=preview(data[data.length-1]);
  }
  function renderWelcome(){ $('messages').innerHTML='<div class="welcome-note"><span>♡</span><b>Mulai cerita hari ini</b><p>Kirim pesan pertama, foto, video, atau pesan suara untuk pasanganmu.</p></div>'; }
  function preview(m){ if(m.kind==='image')return '♡ Foto'; if(m.kind==='video')return '♡ Video'; if(m.kind==='audio')return '🎙 Pesan suara'; return (m.content||'').slice(0,70); }
  function subscribeMessages(){
    messagesChannel=supabase.channel('ustwo-messages').on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},async payload=>{
      if(!knownMessages.has(payload.new.id)){await renderMessage(payload.new,true);$('lastPreview').textContent=preview(payload.new);scrollToBottom();if(payload.new.sender_id!==currentUser.id)markUnreadRead([payload.new.id]);}
    }).on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages'},payload=>updateReadState(payload.new)).subscribe(status=>setConnection(status==='SUBSCRIBED'?'Online · tersambung':`Status: ${status}`,status==='SUBSCRIBED'));
  }
  function subscribePresence(){
    presenceChannel=supabase.channel('ustwo-presence',{config:{presence:{key:currentUser.id},broadcast:{self:false}}});
    presenceChannel.on('presence',{event:'sync'},()=>{
      const state=presenceChannel.presenceState(); const others=Object.entries(state).filter(([key])=>key!==currentUser.id).flatMap(([,vals])=>vals||[]); const typing=others.some(x=>x.typing);
      $('typingIndicator').classList.toggle('hidden',!typing); $('presenceText').textContent=typing?'sedang mengetik...':'Obrolan pribadi kalian';
    }).on('broadcast',{event:'typing'},({payload})=>{if(payload?.userId!==currentUser.id){$('typingIndicator').classList.toggle('hidden',!payload.typing);$('presenceText').textContent=payload.typing?'sedang mengetik...':'Obrolan pribadi kalian';clearTimeout(typingClearTimer);typingClearTimer=setTimeout(()=>{$('typingIndicator').classList.add('hidden');$('presenceText').textContent='Obrolan pribadi kalian';},2500);}}).subscribe(async status=>{if(status==='SUBSCRIBED'){await presenceChannel.track({online:true,typing:false});setConnection('Online · tersambung',true);}});
  }
  async function sendTyping(typing){ if(!presenceChannel)return; try{await presenceChannel.track({online:true,typing});await presenceChannel.send({type:'broadcast',event:'typing',payload:{userId:currentUser.id,typing}});}catch(e){} }
  $('messageInput').addEventListener('input',()=>{const el=$('messageInput');el.style.height='auto';el.style.height=Math.min(el.scrollHeight,130)+'px';sendTyping(true);clearTimeout(typingTimer);typingTimer=setTimeout(()=>sendTyping(false),1000);});
  $('messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('composer').requestSubmit();}});
  $('composer').addEventListener('submit',async e=>{e.preventDefault();const input=$('messageInput'),text=input.value.trim();if(!text||!currentUser)return;input.value='';input.style.height='auto';await sendRow({kind:'text',content:text});sendTyping(false);});
  async function sendRow(row){const {error}=await supabase.from('messages').insert({sender_id:currentUser.id,kind:row.kind,content:row.content||null,storage_key:row.storage_key||null,file_name:row.file_name||null,mime_type:row.mime_type||null,file_size:row.file_size||null});if(error){toast(`Pesan gagal dikirim: ${error.message}`);console.error(error);return false;}return true;}
  async function renderMessage(m,animate=true){
    if(knownMessages.has(m.id))return;knownMessages.add(m.id);const welcome=$('messages').querySelector('.welcome-note');if(welcome)welcome.remove();
    const mine=m.sender_id===currentUser.id;const row=document.createElement('article');row.className=`message-row${mine?' mine':''}`;row.dataset.messageId=m.id;
    let body='';
    if(m.kind==='text') body=`<div class="bubble">${esc(m.content||'')}</div>`;
    else if(m.kind==='image'||m.kind==='video'||m.kind==='audio'){
      const url=await mediaUrl(m.storage_key); if(!url){body=`<div class="bubble">${m.kind==='audio'?'Pesan suara':m.kind==='video'?'Video':'Foto'} · file belum tersedia</div>`;}
      else if(m.kind==='image')body=`<div class="media-bubble"><a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" loading="lazy" alt="Foto yang dibagikan"></a><a class="media-download" href="${esc(url)}" download="${esc(m.file_name||'foto')}">Unduh file asli · ${prettySize(m.file_size)}</a></div>`;
      else if(m.kind==='video')body=`<div class="media-bubble"><video controls playsinline preload="metadata" src="${esc(url)}"></video><a class="media-download" href="${esc(url)}" download="${esc(m.file_name||'video')}">Unduh video asli · ${prettySize(m.file_size)}</a></div>`;
      else body=`<div class="bubble"><audio class="audio-player" controls preload="metadata" src="${esc(url)}"></audio><div class="message-meta">Pesan suara · ${prettySize(m.file_size)}</div><a class="media-download" href="${esc(url)}" download="${esc(m.file_name||'pesan-suara.webm')}">Unduh audio</a></div>`;
    } else body=`<div class="bubble">Lampiran tidak dikenal</div>`;
    row.innerHTML=body+`<div class="message-meta"><span>${mine?'Kamu':'Pasangan'}</span><span>${formatTime(m.created_at)}</span>${mine?`<span class="read-state">${m.read_at?'✓✓ Dibaca':'✓ Terkirim'}</span>`:''}</div>`;
    $('messages').appendChild(row);if(animate)scrollToBottom();
    if(m.kind!=='text') addToGallery(m);
  }
  async function mediaUrl(key){
    if(!key)return null;
    try{
      const {data,error}=await supabase.storage.from('ustwo-media').createSignedUrl(key,3600);
      if(error)throw error;
      return data?.signedUrl||null;
    }catch(e){console.warn('URL media:',e.message);return null;}
  }
  function addToGallery(m){const urlSafe=esc(m.storage_key||'');const a=document.createElement('a');a.href='#';a.title=m.file_name||m.kind;a.innerHTML=m.kind==='image'?'<span>▧</span>':m.kind==='video'?'<span>▶</span>':'<span>🎙</span>';a.style.cssText='flex:0 0 74px;height:74px;display:grid;place-items:center;border-radius:12px;background:#fce8f1;color:#b7527f;text-decoration:none;font-size:25px';a.addEventListener('click',async e=>{e.preventDefault();const url=await mediaUrl(m.storage_key);if(url)window.open(url,'_blank','noopener');});$('galleryItems').appendChild(a);}
  async function markUnreadRead(ids){if(!ids.length)return;const {error}=await supabase.from('messages').update({read_at:new Date().toISOString()}).in('id',ids).is('read_at',null);if(error)console.warn('read status:',error.message);}
  function updateReadState(m){const el=document.querySelector(`[data-message-id="${CSS.escape(m.id)}"] .read-state`);if(el&&m.read_at)el.textContent='✓✓ Dibaca';}
  function scrollToBottom(){const el=$('messages');el.scrollTop=el.scrollHeight;}

  $('attachBtn').addEventListener('click',()=>$('fileInput').click());
  $('fileInput').addEventListener('change',async e=>{const file=e.target.files?.[0];e.target.value='';if(file)await uploadMedia(file);});
  async function uploadMedia(file){
    if(file.size<=0){toast('File kosong.');return;}
    if(file.size>50*1024*1024){toast('File lebih dari 50 MB. Periksa batas unggahan Storage Supabase atau coba file lebih kecil.');return;}
    const kind=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':null;
    if(!kind){toast('Pilih foto atau video.');return;}
    const session=(await supabase.auth.getSession()).data.session;
    if(!session){toast('Silakan login kembali.');return;}
    const status=$('uploadStatus');status.classList.remove('hidden');
    $('uploadLabel').textContent=`Mengunggah ${file.name}`;
    $('uploadPercent').textContent='...';$('uploadProgress').style.width='25%';$('attachBtn').disabled=true;
    try{
      const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100)||'media';
      const key=`${currentUser.id}/${crypto.randomUUID()}-${safeName}`;
      const {error}=await supabase.storage.from('ustwo-media').upload(key,file,{contentType:file.type||'application/octet-stream',upsert:false});
      if(error)throw error;
      $('uploadPercent').textContent='100%';$('uploadProgress').style.width='100%';
      const ok=await sendRow({kind,storage_key:key,file_name:file.name,mime_type:file.type,file_size:file.size,content:null});
      if(ok)toast('Media berhasil dikirim ♡');
    }catch(err){console.error(err);toast(`Unggahan gagal: ${err.message}`);}
    finally{status.classList.add('hidden');$('attachBtn').disabled=false;}
  }
  function putWithProgress(url,file,onProgress){return Promise.reject(new Error('Unggah menggunakan Supabase Storage.'));}
  $('voiceBtn').addEventListener('click',async()=>{if(!isRecording){if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('Browser ini belum mendukung rekaman suara. Coba Safari atau Chrome versi terbaru.');return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});recordedChunks=[];recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)recordedChunks.push(e.data);};recorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(recordedChunks,{type:recorder.mimeType||'audio/webm'});if(blob.size){const ext=(blob.type.split('/')[1]||'webm').split(';')[0];await uploadAudio(new File([blob],`pesan-suara-${Date.now()}.${ext}`,{type:blob.type}));}};recorder.start();isRecording=true;$('voiceBtn').textContent='■';$('voiceBtn').style.background='#f5c5d8';toast('Merekam pesan suara… tekan tombol lagi untuk berhenti.');}catch(e){toast('Izin mikrofon belum diberikan. Aktifkan akses mikrofon pada browser.');}}else{recorder.stop();isRecording=false;$('voiceBtn').textContent='🎙';$('voiceBtn').style.background='';}});
  async function uploadAudio(file){
    if(file.size>50*1024*1024){toast('Pesan suara lebih dari 50 MB.');return;}
    const session=(await supabase.auth.getSession()).data.session;
    if(!session){toast('Silakan login kembali.');return;}
    const status=$('uploadStatus');status.classList.remove('hidden');
    $('uploadLabel').textContent='Mengunggah pesan suara...';$('uploadPercent').textContent='...';$('uploadProgress').style.width='25%';
    try{
      const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100)||'voice.webm';
      const key=`${currentUser.id}/${crypto.randomUUID()}-${safeName}`;
      const {error}=await supabase.storage.from('ustwo-media').upload(key,file,{contentType:file.type||'audio/webm',upsert:false});
      if(error)throw error;
      $('uploadPercent').textContent='100%';$('uploadProgress').style.width='100%';
      if(await sendRow({kind:'audio',storage_key:key,file_name:file.name,mime_type:file.type,file_size:file.size}))toast('Pesan suara terkirim ♡');
    }catch(e){console.error(e);toast(`Pesan suara gagal dikirim: ${e.message}`);}
    finally{status.classList.add('hidden');}
  }
  $('galleryBtn').addEventListener('click',()=>$('galleryPanel').classList.toggle('hidden'));$('closeGallery').addEventListener('click',()=>$('galleryPanel').classList.add('hidden'));$('aboutBtn').addEventListener('click',()=>$('aboutDialog').showModal());
  window.addEventListener('beforeunload',()=>{if(presenceChannel)presenceChannel.untrack();});
  init();
})();
