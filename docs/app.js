// 유체콩샵 앱 — 견주 / 미용사 / 픽업 매니저
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, collection, query, where,
  onSnapshot, getDocs, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fb = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(fb);
const db = getFirestore(fb);
const SHOP = window.SHOP;
const $app = document.getElementById('app');
const $tabs = document.getElementById('tabs');

// ---------- 선택지 ----------
const OPT = {
  sensitive: ['귀', '눈 주변', '입 주변', '앞발', '뒷다리', '배', '꼬리', '엉덩이', '피부 질환 부위'],
  body: ['3mm', '5mm', '7mm', '10mm', '가위컷'],
  face: ['곰돌이컷', '동그란 얼굴', '브로콜리컷', '짧고 깔끔하게'],
  legs: ['방울 다리', '일자 다리', '부츠컷', '짧게 정리'],
  dislikes: ['발톱 깎기', '드라이어 소리', '귀 청소', '얼굴 만지기', '발바닥 털', '목욕물'],
  allergies: ['닭고기', '소고기', '오리', '연어', '양고기', '밀가루', '유제품', '계란'],
  snackPolicy: ['간식 줘도 돼요', '알러지 재료만 빼고 줘도 돼요', '간식 주지 마세요']
};
const MULTI = ['sensitive', 'dislikes', 'allergies'];
const DANGER = ['sensitive', 'dislikes', 'allergies', 'snackPolicy'];
const SERVICES = ['전체 미용', '부분 미용', '목욕'];
const TIMES = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
const MOVES = { both: '픽업 + 귀가', pickup: '픽업만 (귀가는 직접)', visit: '직접 방문' };
const STEPS = [
  ['requested', '예약 접수'], ['confirmed', '예약 확정'], ['pickup', '픽업 출발'], ['onboard', '탑승 완료'],
  ['atShop', '샵 도착'], ['grooming', '미용 중'], ['done', '미용 완료'], ['returning', '귀가 출발'], ['delivered', '집 도착']
];
const LABEL = Object.fromEntries(STEPS.concat([['cancelled', '취소됨']]));
const CHECKS = ['요청서 확인', '미용 전 사진 촬영', '피부·귀 상태 체크', '목욕', '컷', '발톱', '미용 후 사진 촬영'];
const MOVING = ['pickup', 'onboard', 'returning'];

// ---------- 상태 ----------
const S = { user: null, staff: null, dogs: [], bookings: [], all: [], unsubs: [], draft: null, share: null, page: null };

// ---------- 도우미 ----------
const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmt = (ts) => { if (!ts || !ts.toDate) return ''; const d = ts.toDate(); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toast = (msg) => { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2400); };
const go = (h) => { location.hash = h; };
const stepsFor = (b) => STEPS.filter(([k]) => b.move === 'visit' ? !['pickup', 'onboard', 'returning', 'delivered'].includes(k)
  : b.move === 'pickup' ? !['returning', 'delivered'].includes(k) : true);
const statusTag = (s) => `<span class="tag ${s === 'cancelled' ? 'red' : ''}">${e(LABEL[s] || s)}</span>`;

function km(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// 사진 압축 (파이어베이스 무료 요금제에서 쓰도록 문서에 직접 저장)
function compress(file, max = 1000) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let q = 0.75, out = c.toDataURL('image/jpeg', q);
      while (out.length > 850000 && q > 0.3) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      URL.revokeObjectURL(img.src); res(out);
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
async function savePhoto(file, meta) {
  const data = await compress(file);
  const ref = await addDoc(collection(db, 'photos'), { ...meta, data, by: S.user.uid, takenAt: serverTimestamp() });
  return ref.id;
}
const photoCache = {};
async function fillPhotos(root = document) {
  for (const img of root.querySelectorAll('img[data-photo]')) {
    const id = img.dataset.photo;
    try {
      if (!photoCache[id]) { const s = await getDoc(doc(db, 'photos', id)); photoCache[id] = s.exists() ? s.data().data : ''; }
      img.src = photoCache[id];
    } catch { img.alt = '사진을 볼 수 없어요'; }
  }
}
function pickFile(capture) {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*'; if (capture) i.capture = 'environment';
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
}

// 오류가 나면 화면에 내용을 보여 줌 (원인 확인용)
window.addEventListener('unhandledrejection', (ev) => { console.error(ev.reason); toast('오류: ' + (ev.reason?.code || ev.reason?.message || ev.reason)); });
window.addEventListener('error', (ev) => { toast('오류: ' + ev.message); });

// ---------- 로그인 · 데이터 구독 ----------
onAuthStateChanged(auth, async (u) => {
  S.unsubs.forEach((f) => f()); S.unsubs = [];
  S.user = u; S.staff = null; S.dogs = []; S.bookings = []; S.all = [];
  if (!u) { $tabs.hidden = true; return renderLogin(); }
  try { const s = await getDoc(doc(db, 'staff', u.uid)); if (s.exists()) S.staff = s.data(); } catch { /* 직원 아님 */ }
  try { const t = await getDoc(doc(db, 'config', 'testMode')); if (t.exists() && !S.staff) S.staff = { role: 'test' }; } catch { /* 테스트 모드 아님 */ }
  await setDoc(doc(db, 'users', u.uid), { name: u.displayName || '', email: u.email || '', lastSeen: serverTimestamp() }, { merge: true });
  S.unsubs.push(onSnapshot(query(collection(db, 'dogs'), where('ownerUid', '==', u.uid)), (q) => {
    S.dogs = q.docs.map((d) => ({ id: d.id, ...d.data() })); refresh();
  }));
  S.unsubs.push(onSnapshot(query(collection(db, 'bookings'), where('ownerUid', '==', u.uid)), (q) => {
    S.bookings = q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)); refresh();
  }));
  if (S.staff) {
    S.unsubs.push(onSnapshot(collection(db, 'bookings'), (q) => {
      S.all = q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)); refresh();
    }));
  }
  route();
});

// 입력 중인 화면(폼·지도)은 데이터가 바뀌어도 다시 그리지 않음
function refresh() {
  if (['dog', 'book', 'track'].includes(S.page)) return;
  const a = document.activeElement;
  if (a && $app.contains(a) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) return; // 리포트 작성 중
  route();
}

window.addEventListener('hashchange', route);

function route() {
  if (!S.user) return;
  if (S.page === 'track' && S.trackCleanup) { S.trackCleanup(); S.trackCleanup = null; }
  const [, p1, p2] = (location.hash || '#/').split('/');
  renderTabs(p1 || '');
  if (p1 === 'dog') return renderDog(p2);
  if (p1 === 'book') return renderBook(p2);
  if (p1 === 'b') return renderBooking(p2);
  if (p1 === 'track') return renderTrack(p2);
  if (p1 === 'shop' && S.staff) return renderShop(p2 || 'today');
  if (p1 === 'order' && S.staff) return renderOrder(p2);
  if (p1 === 'drive' && S.staff) return renderDrive();
  return renderHome();
}

function renderTabs(cur) {
  const items = [['', '홈'], ['book', '예약하기']];
  if (S.staff) items.push(['shop', '샵'], ['drive', '픽업']);
  $tabs.hidden = false;
  $tabs.innerHTML = items.map(([k, l]) => `<a href="#/${k}" class="${(cur === k || (k === 'shop' && cur === 'order')) ? 'on' : ''}">${l}</a>`).join('');
}

// 테스트 버전: 구글 없이 바로 시작 (익명 로그인 — 이 휴대폰·브라우저에만 기록이 남음)
async function quickStart() {
  const btn = document.getElementById('login'); if (btn) btn.disabled = true;
  try { await signInAnonymously(auth); }
  catch (err) {
    console.error(err);
    const box = document.getElementById('loginErr');
    if (box) box.textContent = '들어가지 못했어요 (' + (err?.code || '알 수 없는 오류') + '). 잠시 후 다시 눌러 주세요.';
    if (btn) btn.disabled = false;
  }
}

function renderLogin() {
  S.page = 'login';
  $app.innerHTML = `
    <img src="hero.jpg" alt="${e(SHOP.name)}에서 미용한 강아지들" class="hero">
    <h1>${e(SHOP.name)}</h1>
    <p class="sub">픽업부터 귀가까지, 우리 아이 맞춤 미용</p>
    <div class="card"><p style="margin:0 0 8px">우리 아이 미용 요청서를 한 번 적어 두면 예약할 때마다 그대로 전달돼요.</p>
      <button class="btn" id="login">바로 시작하기</button><p class="sub" id="loginErr" style="color:var(--red)"></p>
      <p class="sub" style="margin:4px 0 0">테스트 버전이에요. 견주·샵·픽업 화면을 모두 둘러볼 수 있어요.</p></div>`;
  document.getElementById('login').onclick = quickStart;
}

// ---------- 견주: 홈 ----------
function renderHome() {
  S.page = 'home';
  const active = S.bookings.filter((b) => !['delivered', 'cancelled'].includes(b.status) && !(b.status === 'done' && b.move !== 'both'));
  const past = S.bookings.filter((b) => !active.includes(b));
  const bItem = (b) => `<a class="list-item" href="#/b/${b.id}"><span><b>${e(b.request?.name)}</b> · ${e(b.service)}<br><span class="sub">${e(b.date)} ${e(b.time)} · ${e(MOVES[b.move])}</span></span>${statusTag(b.status)}${MOVING.includes(b.status) ? '<span class="live">LIVE</span>' : ''}</a>`;
  $app.innerHTML = `
    <img src="hero.jpg" alt="" class="hero small"><h1>${e(SHOP.name)}</h1><p class="sub">${e(S.user.displayName || '보호자')}님 반가워요</p>
    <div class="card"><h2>우리 아이</h2>
      ${S.dogs.length ? S.dogs.map((d) => `<a class="list-item" href="#/dog/${d.id}"><span><b>${e(d.name)}</b> <span class="sub">${e(d.breed)} · ${e(d.age)} · ${e(d.weight)}</span><br>
        ${(d.allergies || []).map((a) => `<span class="tag red">${e(a)} 알러지</span>`).join('')}${(d.dislikes || []).slice(0, 2).map((a) => `<span class="tag red">${e(a)} 예민</span>`).join('')}</span><span class="sub">요청서 수정</span></a>`).join('') : '<p class="sub">아직 등록된 아이가 없어요.</p>'}
      <a class="btn line" href="#/dog/new">아이 등록하기 (미용 요청서)</a></div>
    <div class="card"><h2>진행 중인 예약</h2>${active.length ? active.map(bItem).join('') : '<p class="sub">진행 중인 예약이 없어요.</p>'}
      <a class="btn" href="#/book">미용 예약하기</a></div>
    ${past.length ? `<div class="card"><h2>지난 예약</h2>${past.slice(0, 10).map(bItem).join('')}</div>` : ''}
    ${S.user.isAnonymous ? '' : '<button class="btn gray" id="logout">로그아웃</button>'}`;
  const lo = document.getElementById('logout'); if (lo) lo.onclick = () => signOut(auth);
}

// ---------- 견주: 강아지 요청서 ----------
function chipGroup(key) {
  const multi = MULTI.includes(key);
  const val = S.draft[key];
  return `<div class="chips" data-group="${key}">${OPT[key].map((o) => {
    const on = multi ? (val || []).includes(o) : val === o;
    return `<button type="button" class="chip ${on ? 'on' : ''} ${DANGER.includes(key) ? 'danger' : ''}" data-v="${e(o)}">${e(o)}</button>`;
  }).join('')}</div>`;
}
function renderDog(id) {
  S.page = 'dog';
  const dog = id && id !== 'new' ? S.dogs.find((d) => d.id === id) : null;
  if (id && id !== 'new' && !dog) { $app.innerHTML = '<p class="loading">불러오는 중…</p>'; S.page = null; return; }
  S.draft = dog ? JSON.parse(JSON.stringify(dog)) : { sensitive: [], dislikes: [], allergies: [], body: '5mm', face: '', legs: '', snackPolicy: '간식 줘도 돼요', refPhotoIds: [] };
  const d = S.draft;
  $app.innerHTML = `
    <a class="back" href="#/">‹ 홈</a><h1>${dog ? e(dog.name) + ' 미용 요청서' : '아이 등록하기'}</h1>
    <p class="sub">미용사 선생님이 미용 전에 꼭 읽어요. 한 번 적어 두면 다음 예약에도 그대로 쓰여요.</p>
    <form id="f">
    <div class="card"><h2>1. 기본 정보</h2>
      <div class="row"><label class="f">이름<input name="name" required value="${e(d.name)}"></label><label class="f">견종<input name="breed" value="${e(d.breed)}"></label></div>
      <div class="row"><label class="f">나이<input name="age" value="${e(d.age)}" placeholder="예: 4살"></label><label class="f">몸무게<input name="weight" value="${e(d.weight)}" placeholder="예: 3.2kg"></label></div></div>
    <div class="card"><h2>2. 조심해 주세요 · 민감한 부위</h2>${chipGroup('sensitive')}
      <label class="f">자세히 적어 주세요<textarea name="sensitiveNote">${e(d.sensitiveNote)}</textarea></label></div>
    <div class="card"><h2>3. 원하는 스타일</h2>
      <div class="k">참고 사진</div><div class="photos" id="refs">${(d.refPhotoIds || []).map((p) => `<img data-photo="${p}" alt="참고 사진">`).join('')}</div>
      <button type="button" class="btn line" id="addRef">참고 사진 추가</button>
      <div class="k">몸통 길이</div>${chipGroup('body')}
      <div class="k">얼굴</div>${chipGroup('face')}
      <div class="k">다리</div>${chipGroup('legs')}
      <label class="f">그 밖에 원하는 점<textarea name="styleNote">${e(d.styleNote)}</textarea></label></div>
    <div class="card"><h2>4. 싫어하는 것 · 달래는 방법</h2>${chipGroup('dislikes')}
      <label class="f">아이가 힘들어할 때는<textarea name="calming" placeholder="예: 뽀뽀를 좋아해요. 힘들어하면 뽀뽀해 주세요.">${e(d.calming)}</textarea></label></div>
    <div class="card warn"><h2 style="color:var(--red)">5. 간식 · 알러지</h2>${chipGroup('snackPolicy')}
      <div class="k">이 재료는 절대 안 돼요</div>${chipGroup('allergies')}
      <label class="f">그 밖의 알러지·건강 메모<textarea name="healthNote">${e(d.healthNote)}</textarea></label></div>
    <button class="btn" type="submit">저장하기</button></form>`;
  fillPhotos();
  $app.querySelectorAll('[data-group]').forEach((g) => g.addEventListener('click', (ev) => {
    const b = ev.target.closest('.chip'); if (!b) return;
    const key = g.dataset.group, v = b.dataset.v;
    if (MULTI.includes(key)) {
      const arr = S.draft[key] || [];
      S.draft[key] = arr.includes(v) ? arr.filter((x) => x !== v) : arr.concat([v]);
      b.classList.toggle('on');
    } else {
      S.draft[key] = v; g.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    }
  }));
  document.getElementById('addRef').onclick = async () => {
    const f = await pickFile(false); if (!f) return;
    toast('사진 올리는 중…');
    const pid = await savePhoto(f, { kind: 'reference', ownerUid: S.user.uid });
    S.draft.refPhotoIds = (S.draft.refPhotoIds || []).concat([pid]);
    document.getElementById('refs').insertAdjacentHTML('beforeend', `<img data-photo="${pid}" alt="참고 사진">`);
    fillPhotos(document.getElementById('refs'));
  };
  document.getElementById('f').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target));
    const data = { ...S.draft, ...fd, ownerUid: S.user.uid, updatedAt: serverTimestamp() };
    delete data.id;
    if (dog) await setDoc(doc(db, 'dogs', dog.id), data);
    else await addDoc(collection(db, 'dogs'), { ...data, createdAt: serverTimestamp() });
    toast('요청서를 저장했어요'); go('#/');
  };
}

// 예약에 들어가는 요청서 사본
const snapshotOf = (d) => ({
  name: d.name || '', breed: d.breed || '', age: d.age || '', weight: d.weight || '',
  sensitive: d.sensitive || [], sensitiveNote: d.sensitiveNote || '', body: d.body || '', face: d.face || '', legs: d.legs || '',
  styleNote: d.styleNote || '', dislikes: d.dislikes || [], calming: d.calming || '', snackPolicy: d.snackPolicy || '',
  allergies: d.allergies || [], healthNote: d.healthNote || '', refPhotoIds: d.refPhotoIds || []
});

// ---------- 견주: 예약하기 ----------
function renderBook(dogId) {
  S.page = 'book';
  if (!S.dogs.length) {
    $app.innerHTML = `<h1>미용 예약하기</h1><div class="card"><p>먼저 아이를 등록하고 미용 요청서를 적어 주세요.</p><a class="btn" href="#/dog/new">아이 등록하기</a></div>`;
    return;
  }
  const pick = { lat: null, lng: null };
  $app.innerHTML = `
    <h1>미용 예약하기</h1>
    <form id="f">
    <div class="card">
      <label class="f">어떤 아이인가요?<select name="dogId">${S.dogs.map((d) => `<option value="${d.id}" ${d.id === dogId ? 'selected' : ''}>${e(d.name)}</option>`).join('')}</select></label>
      <label class="f">미용 종류<select name="service">${SERVICES.map((s) => `<option>${s}</option>`).join('')}</select></label>
      <div class="row"><label class="f">날짜<input type="date" name="date" required min="${today()}"></label>
      <label class="f">시간<select name="time">${TIMES.map((t) => `<option>${t}</option>`).join('')}</select></label></div>
      <label class="f">이동 방법<select name="move" id="move">${Object.entries(MOVES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    </div>
    <div class="card" id="addrBox"><h2>픽업 장소</h2>
      <label class="f">주소<input name="address" placeholder="예: ○○아파트 101동 1203호"></label>
      <button type="button" class="btn line" id="here">지금 있는 곳을 픽업 위치로 저장</button><p class="sub" id="hereMsg"></p>
      <label class="f">전달 메모 (공동현관 비밀번호 등)<textarea name="memo"></textarea></label></div>
    <div class="card"><h2>보호자 정보</h2>
      <label class="f">보호자 이름<input name="ownerName" required placeholder="예: 홍길동"></label>
      <label class="f">연락처<input name="phone" type="tel" required placeholder="010-0000-0000"></label></div>
    <div class="card"><h2>확인 및 동의</h2>
      <ul class="sub" style="padding-left:18px;line-height:1.7;margin:0 0 8px">
        <li>선택한 아이의 미용 요청서가 이 예약에 그대로 첨부돼요.</li>
        <li>털 엉킴이 심하면 원하는 길이보다 짧게 밀 수 있어요. 이때는 미용 전에 먼저 연락드려요.</li>
        <li>아이가 심하게 힘들어하면 안전을 위해 미용을 중단할 수 있어요.</li>
        <li>요청서·사진·진행 기록은 접수 시각과 함께 보관돼요.</li></ul>
      <label class="check" style="cursor:pointer"><input type="checkbox" name="agree" required style="width:22px;height:22px"> 위 내용을 확인했고, 요청서대로 미용해 주세요</label></div>
    <button class="btn" type="submit">요청서 보내고 예약하기</button></form>`;
  const sync = () => { document.getElementById('addrBox').hidden = document.getElementById('move').value === 'visit'; };
  document.getElementById('move').onchange = sync; sync();
  document.getElementById('here').onclick = () => {
    const m = document.getElementById('hereMsg'); m.textContent = '위치 확인 중…';
    navigator.geolocation.getCurrentPosition((p) => { pick.lat = p.coords.latitude; pick.lng = p.coords.longitude; m.textContent = '픽업 위치를 저장했어요'; },
      () => { m.textContent = '위치를 가져오지 못했어요. 주소만 적어 주셔도 돼요.'; }, { enableHighAccuracy: true, timeout: 10000 });
  };
  document.getElementById('f').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target));
    const dog = S.dogs.find((d) => d.id === fd.dogId);
    const d = new Date();
    const code = `YC-${pad(d.getMonth() + 1)}${pad(d.getDate())}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const ref = await addDoc(collection(db, 'bookings'), {
      ownerUid: S.user.uid, ownerName: fd.ownerName || S.user.displayName || '', ownerPhone: fd.phone || '',
      dogId: dog.id, service: fd.service, date: fd.date, time: fd.time, move: fd.move,
      address: fd.move === 'visit' ? '' : (fd.address || ''), memo: fd.memo || '', pickupLat: pick.lat, pickupLng: pick.lng,
      request: snapshotOf(dog), code, status: 'requested', revisionCount: 0, checks: {},
      timeline: { requested: serverTimestamp() }, agreedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    toast('예약 요청을 보냈어요'); go(`#/b/${ref.id}`);
  };
}

// ---------- 공통: 요청서 보기 ----------
function requestView(r) {
  return `
    ${(r.allergies?.length || r.snackPolicy === '간식 주지 마세요') ? `<div class="banner">알러지 · 간식 주의<b>${r.allergies?.length ? e(r.allergies.join(', ')) + ' 성분 금지' : '간식 금지'}</b>${e(r.snackPolicy)}${r.healthNote ? '<br>' + e(r.healthNote) : ''}</div>` : `<div class="card"><span class="k">간식</span> ${e(r.snackPolicy)}${r.healthNote ? ' · ' + e(r.healthNote) : ''}</div>`}
    <div class="card"><h2>${e(r.name)} <span class="sub">${e(r.breed)} · ${e(r.age)} · ${e(r.weight)}</span></h2>
      ${r.refPhotoIds?.length ? `<div class="photos">${r.refPhotoIds.map((p) => `<img data-photo="${p}" alt="참고 사진">`).join('')}</div>` : ''}
      <div class="row" style="margin:8px 0"><div><span class="sub">몸통</span><br><b>${e(r.body || '-')}</b></div><div><span class="sub">얼굴</span><br><b>${e(r.face || '-')}</b></div><div><span class="sub">다리</span><br><b>${e(r.legs || '-')}</b></div></div>
      ${r.styleNote ? `<p style="margin:8px 0">“${e(r.styleNote)}”</p>` : ''}
      <div class="k" style="color:var(--red)">민감 부위 · 싫어하는 것</div>
      <div>${(r.sensitive || []).map((s) => `<span class="tag red">${e(s)}</span>`).join('')}${(r.dislikes || []).map((s) => `<span class="tag red">${e(s)}</span>`).join('') || '<span class="sub">없음</span>'}</div>
      ${r.sensitiveNote ? `<p class="sub" style="margin:6px 0 0">${e(r.sensitiveNote)}</p>` : ''}
      ${r.calming ? `<div class="card" style="background:var(--mainLt);border:0;margin-bottom:0"><span class="k">힘들어할 때</span><br>${e(r.calming)}</div>` : ''}
    </div>`;
}
const stepsView = (b) => `<ul class="steps">${stepsFor(b).map(([k, l]) => `<li class="${b.timeline?.[k] ? 'done' : ''}"><i></i>${l} <span class="sub" style="margin-left:auto">${fmt(b.timeline?.[k])}</span></li>`).join('')}</ul>`;

async function photosOf(bookingId) {
  const q = S.staff ? query(collection(db, 'photos'), where('bookingId', '==', bookingId))
    : query(collection(db, 'photos'), where('bookingId', '==', bookingId), where('ownerUid', '==', S.user.uid));
  const r = await getDocs(q);
  return r.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.takenAt?.seconds || 0) - (b.takenAt?.seconds || 0));
}
const KIND = { before: '미용 전', after: '미용 후', onboard: '탑승', handover: '귀가 인계' };
const photoGrid = (ps) => ps.length ? `<div class="photos">${ps.map((p) => `<div><img data-photo="${p.id}" alt="${KIND[p.kind] || ''} 사진"><div class="sub" style="text-align:center">${KIND[p.kind] || ''} ${fmt(p.takenAt)}</div></div>`).join('')}</div>` : '';

// ---------- 견주: 예약 상세 ----------
async function renderBooking(id) {
  S.page = 'booking';
  const b = S.bookings.find((x) => x.id === id) || S.all.find((x) => x.id === id);
  if (!b) { $app.innerHTML = '<p class="loading">불러오는 중…</p>'; return; }
  const mine = b.ownerUid === S.user.uid;
  const rep = b.report;
  $app.innerHTML = `
    <a class="back" href="#/">‹ 홈</a>
    <h1>${e(b.request.name)} · ${e(b.service)}</h1>
    <p class="sub">${e(b.date)} ${e(b.time)} · ${e(MOVES[b.move])} · 예약번호 ${e(b.code)}</p>
    ${MOVING.includes(b.status) ? `<a class="btn" href="#/track/${b.id}">실시간 위치 보기 <span class="live">LIVE</span></a>` : ''}
    <div class="card"><h2>진행 상황 ${statusTag(b.status)}</h2>${stepsView(b)}
      ${b.groomerConfirmedAt ? `<p class="sub" style="margin:8px 0 0">미용사 요청서 확인: ${fmt(b.groomerConfirmedAt)}</p>` : ''}</div>
    ${rep ? `<div class="card"><h2>미용 완료 리포트</h2><div id="ph"></div>
      <div class="row" style="margin:8px 0"><div><span class="sub">기분</span><br><b>${e(rep.mood)}</b></div><div><span class="sub">피부</span><br><b>${e(rep.skin)}</b></div><div><span class="sub">털 엉킴</span><br><b>${e(rep.tangles)}</b></div></div>
      ${rep.note ? `<div class="card warn" style="margin:8px 0">${e(rep.note)}</div>` : ''}
      ${rep.calmNote ? `<div class="card" style="background:var(--mainLt);border:0;margin:8px 0">${e(rep.calmNote)}</div>` : ''}
      ${rep.nextDate ? `<p>다음 미용 추천일 <b>${e(rep.nextDate)}</b></p>` : ''}
      ${mine ? `<a class="btn line" href="#/book/${b.dogId}">같은 요청서로 다시 예약</a>` : ''}</div>` : '<div id="ph"></div>'}
    <h2 style="margin-top:20px">접수된 요청서 <span class="sub">(${fmt(b.agreedAt)} 동의)</span></h2>
    ${requestView(b.request)}
    ${mine && b.status === 'requested' ? `<button class="btn line" id="resync">수정한 아이 정보로 요청서 바꾸기</button><button class="btn gray" id="cancel">예약 취소</button>` : ''}
    <div class="card"><h2>요청서 수정 기록</h2><div id="revs" class="sub">불러오는 중…</div></div>`;
  fillPhotos();
  photosOf(b.id).then((ps) => { const el = document.getElementById('ph'); if (el && ps.length) { el.innerHTML = photoGrid(ps); fillPhotos(el); } }).catch(() => {});
  getDocs(collection(db, 'bookings', b.id, 'revisions')).then((r) => {
    const el = document.getElementById('revs'); if (!el) return;
    const list = r.docs.map((d) => d.data()).sort((a, c) => (a.changedAt?.seconds || 0) - (c.changedAt?.seconds || 0));
    el.innerHTML = list.length ? list.map((v, i) => `<div>${i + 1}차 수정 · ${fmt(v.changedAt)}</div>`).join('') : '수정 기록 없음 (처음 접수한 요청서 그대로예요)';
  }).catch(() => {});
  const rs = document.getElementById('resync');
  if (rs) rs.onclick = async () => {
    const dog = S.dogs.find((d) => d.id === b.dogId); if (!dog) return toast('아이 정보를 찾을 수 없어요');
    const after = snapshotOf(dog);
    await addDoc(collection(db, 'bookings', b.id, 'revisions'), { before: b.request, after, changedAt: serverTimestamp(), by: S.user.uid });
    await updateDoc(doc(db, 'bookings', b.id), { request: after, revisionCount: (b.revisionCount || 0) + 1, updatedAt: serverTimestamp() });
    toast('요청서를 바꿨어요. 수정 기록이 남아요.');
  };
  const cc = document.getElementById('cancel');
  if (cc) cc.onclick = async () => { await updateDoc(doc(db, 'bookings', b.id), { status: 'cancelled', updatedAt: serverTimestamp() }); toast('예약을 취소했어요'); };
}

// ---------- 견주: 실시간 위치 ----------
function renderTrack(id) {
  S.page = 'track';
  $app.innerHTML = `
    <a class="back" href="#/b/${id}">‹ 예약 상세</a><h1 id="tTitle">이동 현황 <span class="live">LIVE</span></h1>
    <div id="map"></div>
    <div class="card"><span class="sub" id="tDest"></span><div class="eta" id="tEta">위치를 기다리는 중…</div><span class="sub" id="tAgo"></span></div>
    <div class="card" id="tSteps"></div>
    ${SHOP.phone ? `<a class="btn line" href="tel:${e(SHOP.phone)}">샵에 전화하기</a>` : ''}`;
  const map = L.map('map', { zoomControl: false }).setView([SHOP.lat, SHOP.lng], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  L.marker([SHOP.lat, SHOP.lng]).addTo(map).bindTooltip(SHOP.name, { permanent: true, direction: 'top' });
  const car = L.circleMarker([SHOP.lat, SHOP.lng], { radius: 12, color: '#fff', weight: 3, fillColor: '#1E7F6E', fillOpacity: 1 });
  let home = null, booking = null, last = null, fitted = false;
  const tick = setInterval(() => {
    if (last?.updatedAt?.toDate) document.getElementById('tAgo').textContent = `${Math.max(0, Math.round((Date.now() - last.updatedAt.toDate()) / 1000))}초 전 위치`;
  }, 1000);
  const draw = () => {
    if (!booking) return;
    const toHome = booking.status === 'returning';
    document.getElementById('tDest').textContent = toHome ? '우리 집 도착까지' : `${SHOP.name} 도착까지`;
    document.getElementById('tSteps').innerHTML = stepsView(booking);
    if (!MOVING.includes(booking.status)) { document.getElementById('tEta').textContent = LABEL[booking.status] || ''; return; }
    if (!last?.lat) return;
    car.setLatLng([last.lat, last.lng]).addTo(map);
    const dest = toHome ? (booking.pickupLat ? { lat: booking.pickupLat, lng: booking.pickupLng } : null) : SHOP;
    if (dest) {
      const d = km(last, dest);
      document.getElementById('tEta').textContent = d < 0.15 ? '곧 도착해요' : `약 ${Math.max(1, Math.round(d / 0.4) + 1)}분 남았어요`;
      if (!fitted) { map.fitBounds([[last.lat, last.lng], [dest.lat, dest.lng]], { padding: [40, 40] }); fitted = true; }
    } else { document.getElementById('tEta').textContent = '이동 중이에요'; map.panTo([last.lat, last.lng]); }
  };
  const u1 = onSnapshot(doc(db, 'bookings', id), (s) => {
    booking = { id, ...s.data() };
    if (booking.pickupLat && !home) home = L.marker([booking.pickupLat, booking.pickupLng]).addTo(map).bindTooltip('우리 집', { permanent: true, direction: 'top' });
    draw();
  });
  let u2 = () => {};
  const listenLive = () => { u2 = onSnapshot(doc(db, 'live', id), (s) => { last = s.data(); draw(); }, () => { setTimeout(listenLive, 5000); }); };
  listenLive();
  S.trackCleanup = () => { u1(); u2(); clearInterval(tick); map.remove(); };
}

// ---------- 샵: 예약 목록 ----------
function renderShop(tab) {
  S.page = 'shop';
  const t = today();
  const list = S.all.filter((b) => tab === 'today' ? b.date === t : tab === 'next' ? b.date > t && b.status !== 'cancelled' : b.date < t || b.status === 'cancelled');
  if (tab === 'past') list.reverse();
  $app.innerHTML = `
    <h1>${e(SHOP.name)} 예약</h1>
    <div class="chips">${[['today', '오늘'], ['next', '예정'], ['past', '지난·취소']].map(([k, l]) => `<a class="chip ${tab === k ? 'on' : ''}" style="display:inline-flex;align-items:center;text-decoration:none" href="#/shop/${k}">${l}</a>`).join('')}</div>
    <div class="card">${list.length ? list.map((b) => `
      <div class="list-item"><a href="#/order/${b.id}" style="color:inherit;text-decoration:none;flex:1"><b>${e(b.time)} ${e(b.request?.name)}</b> <span class="sub">${e(b.request?.breed)}</span><br>
        <span class="sub">${e(b.date)} · ${e(b.service)} · ${e(MOVES[b.move])}</span><br>
        ${(b.request?.allergies || []).map((a) => `<span class="tag red">${e(a)} 알러지</span>`).join('')}${b.revisionCount ? `<span class="tag">요청서 ${b.revisionCount}회 수정</span>` : ''}</a>
        <div style="text-align:right">${statusTag(b.status)}${b.status === 'requested' ? `<button class="chip on" data-confirm="${b.id}" style="margin-top:6px">확정</button>` : ''}</div></div>`).join('') : '<p class="sub">예약이 없어요.</p>'}</div>`;
  $app.querySelectorAll('[data-confirm]').forEach((btn) => btn.onclick = () => setStatus(btn.dataset.confirm, 'confirmed').then(() => toast('예약을 확정했어요')));
}
function setStatus(id, st, extra = {}) {
  return updateDoc(doc(db, 'bookings', id), { status: st, [`timeline.${st}`]: serverTimestamp(), updatedAt: serverTimestamp(), ...extra });
}

// ---------- 샵: 작업지시서 ----------
async function renderOrder(id) {
  S.page = 'order';
  const b = S.all.find((x) => x.id === id);
  if (!b) { $app.innerHTML = '<p class="loading">불러오는 중…</p>'; return; }
  const next = { requested: ['confirmed', '예약 확정'], confirmed: b.move === 'visit' ? ['atShop', '샵 입실'] : null, atShop: ['grooming', '미용 시작'] }[b.status];
  const rep = b.report || {};
  const sel = (name, opts, v) => `<select name="${name}">${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  $app.innerHTML = `
    <a class="back" href="#/shop">‹ 예약 목록</a>
    <h1>${e(b.request.name)} 작업지시서</h1>
    <p class="sub">${e(b.date)} ${e(b.time)} · ${e(b.service)} · ${e(MOVES[b.move])} · ${e(b.code)}<br>견주 ${e(b.ownerName)} ${b.ownerPhone ? `· <a href="tel:${e(b.ownerPhone)}">${e(b.ownerPhone)}</a>` : ''}${b.revisionCount ? ` · 요청서 ${b.revisionCount}회 수정됨` : ''}</p>
    ${requestView(b.request)}
    ${b.memo ? `<div class="card"><span class="k">전달 메모</span><br>${e(b.memo)}</div>` : ''}
    <div class="card"><h2>진행 ${statusTag(b.status)}</h2>
      ${b.groomerConfirmedAt ? `<p class="sub">요청서 확인 ${fmt(b.groomerConfirmedAt)} · ${e(b.groomerConfirmedBy)}</p>` : `<button class="btn red" id="ack">요청서를 끝까지 읽었어요 (확인 시각 기록)</button>`}
      ${next ? `<button class="btn" id="next">${next[1]}</button>` : ''}
      ${stepsView(b)}</div>
    <div class="card"><h2>작업 체크 <span class="sub">${Object.keys(b.checks || {}).length}/${CHECKS.length}</span></h2>
      ${CHECKS.map((c, i) => `<button class="check ${b.checks?.[i] ? 'on' : ''}" data-check="${i}">${b.checks?.[i] ? '✓' : '○'} ${c}<small>${b.checks?.[i] ? fmt(b.checks[i]) : '대기'}</small></button>`).join('')}</div>
    <div class="card"><h2>사진 기록</h2><div id="ph" class="sub">불러오는 중…</div>
      <div class="row"><button class="btn line" data-shot="before">미용 전 사진</button><button class="btn line" data-shot="after">미용 후 사진</button></div></div>
    <form class="card" id="rep"><h2>미용 완료 리포트</h2>
      <div class="row"><label class="f">기분${sel('mood', ['좋음', '보통', '힘들어함'], rep.mood)}</label><label class="f">피부${sel('skin', ['좋음', '확인 필요'], rep.skin)}</label><label class="f">털 엉킴${sel('tangles', ['없음', '조금', '많음'], rep.tangles)}</label></div>
      <label class="f">특이사항 (피부·귀·혹 등)<textarea name="note">${e(rep.note)}</textarea></label>
      <label class="f">오늘 아이 모습<textarea name="calmNote" placeholder="예: 발톱 깎을 때 힘들어해서 뽀뽀해 주니 금방 진정됐어요">${e(rep.calmNote)}</textarea></label>
      <label class="f">다음 미용 추천일<input type="date" name="nextDate" value="${e(rep.nextDate)}"></label>
      <button class="btn" type="submit">${b.report ? '리포트 수정' : '미용 완료 · 리포트 보내기'}</button></form>`;
  fillPhotos();
  const loadPh = () => photosOf(b.id).then((ps) => { const el = document.getElementById('ph'); if (!el) return; el.innerHTML = ps.length ? photoGrid(ps) : '아직 사진이 없어요'; fillPhotos(el); });
  loadPh();
  const ack = document.getElementById('ack');
  if (ack) ack.onclick = () => updateDoc(doc(db, 'bookings', b.id), { groomerConfirmedAt: serverTimestamp(), groomerConfirmedBy: S.user.displayName || '미용사', 'checks.0': serverTimestamp(), updatedAt: serverTimestamp() });
  const nx = document.getElementById('next');
  if (nx) nx.onclick = () => setStatus(b.id, next[0]);
  $app.querySelectorAll('[data-check]').forEach((btn) => btn.onclick = () => {
    const i = btn.dataset.check;
    updateDoc(doc(db, 'bookings', b.id), { [`checks.${i}`]: b.checks?.[i] ? deleteField() : serverTimestamp(), updatedAt: serverTimestamp() });
  });
  $app.querySelectorAll('[data-shot]').forEach((btn) => btn.onclick = async () => {
    const f = await pickFile(true); if (!f) return;
    toast('사진 올리는 중…');
    await savePhoto(f, { kind: btn.dataset.shot, bookingId: b.id, ownerUid: b.ownerUid });
    toast('사진을 기록했어요'); loadPh();
  });
  document.getElementById('rep').onsubmit = async (ev) => {
    ev.preventDefault();
    const report = { ...Object.fromEntries(new FormData(ev.target)), by: S.user.displayName || '미용사' };
    if (b.report) await updateDoc(doc(db, 'bookings', b.id), { report, updatedAt: serverTimestamp() });
    else await setStatus(b.id, 'done', { report });
    toast('리포트를 보냈어요');
  };
}

// ---------- 매니저: 픽업 · 위치 공유 ----------
async function startShare(b, leg) {
  if (!navigator.geolocation) return toast('이 휴대폰은 위치를 쓸 수 없어요');
  stopShare(false);
  await setDoc(doc(db, 'live', b.id), { ownerUid: b.ownerUid, bookingId: b.id, leg, active: true, startedAt: serverTimestamp() }, { merge: true });
  const sh = { id: b.id, last: 0, wake: null, watch: null };
  sh.watch = navigator.geolocation.watchPosition((p) => {
    if (Date.now() - sh.last < 4000) return;
    sh.last = Date.now();
    setDoc(doc(db, 'live', b.id), { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), updatedAt: serverTimestamp() }, { merge: true });
  }, () => toast('위치 권한을 허용해 주세요'), { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  try { sh.wake = await navigator.wakeLock?.request('screen'); } catch { /* 화면 켜짐 유지 미지원 */ }
  S.share = sh;
}
function stopShare(write = true) {
  const sh = S.share; if (!sh) return;
  navigator.geolocation.clearWatch(sh.watch);
  try { sh.wake?.release(); } catch { /* 무시 */ }
  if (write) setDoc(doc(db, 'live', sh.id), { active: false, endedAt: serverTimestamp() }, { merge: true });
  S.share = null;
}
document.addEventListener('visibilitychange', async () => {
  if (S.share && document.visibilityState === 'visible' && !S.share.wake) { try { S.share.wake = await navigator.wakeLock?.request('screen'); } catch { /* 무시 */ } }
});

function renderDrive() {
  S.page = 'drive';
  const t = today();
  const list = S.all.filter((b) => b.move !== 'visit' && b.status !== 'cancelled' && b.status !== 'delivered' && b.date <= t
    && !(b.move === 'pickup' && ['done'].includes(b.status)));
  const act = (b) => {
    const sharing = S.share?.id === b.id;
    switch (b.status) {
      case 'requested': return '<p class="sub">샵에서 예약 확정 전이에요</p>';
      case 'confirmed': return `<button class="btn" data-a="pickup" data-id="${b.id}">픽업 출발 (위치 공유 시작)</button>`;
      case 'pickup': return `${sharing ? '' : `<button class="btn line" data-a="resume" data-id="${b.id}">위치 공유 다시 켜기</button>`}<button class="btn" data-a="onboard" data-id="${b.id}">탑승 완료 (사진 찍기)</button>`;
      case 'onboard': return `${sharing ? '' : `<button class="btn line" data-a="resume" data-id="${b.id}">위치 공유 다시 켜기</button>`}<button class="btn" data-a="atShop" data-id="${b.id}">샵 도착 (공유 끝)</button>`;
      case 'atShop': case 'grooming': return '<p class="sub">샵에서 미용 중이에요</p>';
      case 'done': return `<button class="btn" data-a="returning" data-id="${b.id}">귀가 출발 (위치 공유 시작)</button>`;
      case 'returning': return `${sharing ? '' : `<button class="btn line" data-a="resume" data-id="${b.id}">위치 공유 다시 켜기</button>`}<button class="btn" data-a="delivered" data-id="${b.id}">집 도착 · 인계 사진</button>`;
      default: return '';
    }
  };
  $app.innerHTML = `
    <h1>픽업 · 귀가</h1>
    <p class="sub">이동 중에는 이 화면을 켜 두세요. 화면이 꺼지면 위치 전송이 멈출 수 있어요.</p>
    ${S.share ? `<div class="banner" style="background:var(--main)">위치 공유 중<b>${e(S.all.find((x) => x.id === S.share.id)?.request?.name || '')}</b>견주에게 실시간으로 보이고 있어요</div>` : ''}
    ${list.length ? list.map((b) => `<div class="card"><h2>${e(b.time)} ${e(b.request?.name)} ${statusTag(b.status)}</h2>
      <p class="sub" style="margin:0 0 6px">${e(b.date)} · ${e(MOVES[b.move])}<br>${e(b.address || '주소 없음')}${b.memo ? '<br>메모: ' + e(b.memo) : ''}</p>
      <div class="row">${b.ownerPhone ? `<a class="btn line" href="tel:${e(b.ownerPhone)}">견주 전화</a>` : ''}${b.pickupLat ? `<a class="btn line" target="_blank" rel="noopener" href="https://map.kakao.com/link/to/${encodeURIComponent(b.request?.name + ' 집')},${b.pickupLat},${b.pickupLng}">길안내</a>` : ''}</div>
      ${act(b)}</div>`).join('') : '<div class="card"><p class="sub">오늘 픽업할 예약이 없어요.</p></div>'}`;
  $app.querySelectorAll('[data-a]').forEach((btn) => btn.onclick = async () => {
    const b = S.all.find((x) => x.id === btn.dataset.id); const a = btn.dataset.a;
    btn.disabled = true;
    try {
      if (a === 'pickup') { await startShare(b, 'toShop'); await setStatus(b.id, 'pickup'); }
      else if (a === 'resume') { await startShare(b, b.status === 'returning' ? 'toHome' : 'toShop'); renderDrive(); }
      else if (a === 'onboard' || a === 'delivered') {
        const f = await pickFile(true);
        if (f) { toast('사진 올리는 중…'); await savePhoto(f, { kind: a === 'onboard' ? 'onboard' : 'handover', bookingId: b.id, ownerUid: b.ownerUid }); }
        await setStatus(b.id, a);
        if (a === 'delivered') stopShare();
      }
      else if (a === 'atShop') { await setStatus(b.id, 'atShop'); stopShare(); }
      else if (a === 'returning') { await startShare(b, 'toHome'); await setStatus(b.id, 'returning'); }
      toast('기록했어요');
    } catch (err) { console.error(err); toast('저장에 실패했어요. 다시 눌러 주세요.'); btn.disabled = false; }
  });
}
