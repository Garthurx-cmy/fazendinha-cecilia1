import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, addDoc, getDocs, query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import { firebaseConfig } from './firebase-config.js';

const $ = (id) => document.getElementById(id);
const screens = ['home','cameraScreen','previewScreen','galleryScreen'];
const video = $('video');
const videoBackdrop = $('videoBackdrop');
const PHOTOS_PATH = 'events/cecilia-1-aninho/photos';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
let stream = null;
let facingMode = 'user';
let timerEnabled = true;
let currentPhoto = null;
let currentPhotoUrl = null;
let firebaseReady = false;
let authUser = null;
let authReadyPromise;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

function showScreen(id) {
  screens.forEach((screen) => { $(screen).hidden = screen !== id; });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function setMessage(id, message) { $(id).textContent = message; }
function makePhotoId() {
  return `${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
}

// A sessão anônima permite que convidados enviem fotos sem criar uma conta.
authReadyPromise = new Promise((resolve) => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      authUser = user;
      firebaseReady = true;
      resolve(user);
      setMessage('cameraMessage', 'Tudo pronto! Enquadre seu sorriso e aperte o botão.');
      return;
    }
    try {
      const credential = await signInAnonymously(auth);
      authUser = credential.user;
      firebaseReady = true;
      resolve(credential.user);
    } catch (error) {
      console.error('Falha no login anônimo Firebase:', error);
      firebaseReady = false;
      resolve(null);
      setMessage('cameraMessage', 'Não foi possível conectar à galeria online. Você ainda pode tirar e baixar sua foto.');
    }
  });
});

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('FazendinhaCeciliaDB', 1);
    req.onupgradeneeded = () => {
      const localDb = req.result;
      if (!localDb.objectStoreNames.contains('photos')) localDb.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function savePhotoLocally(blob) {
  const localDb = await openDB();
  return new Promise((resolve, reject) => {
    const tx = localDb.transaction('photos', 'readwrite');
    const req = tx.objectStore('photos').add({ blob, createdAt: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function getLocalPhotos() {
  const localDb = await openDB();
  return new Promise((resolve, reject) => {
    const tx = localDb.transaction('photos', 'readonly');
    const req = tx.objectStore('photos').getAll();
    req.onsuccess = () => resolve(req.result.reverse());
    req.onerror = () => reject(req.error);
  });
}
async function updateCount() {
  try {
    const snapshot = await getDocs(collection(db, PHOTOS_PATH));
    $('photoCount').textContent = `(${snapshot.size} na galeria)`;
  } catch (error) {
    console.warn('Não foi possível consultar a contagem online:', error);
    try { const local = await getLocalPhotos(); $('photoCount').textContent = `(${local.length} neste aparelho)`; } catch (localError) { console.warn(localError); }
  }
}
async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    setMessage('cameraMessage', 'A câmera precisa de HTTPS ou localhost para funcionar neste navegador.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1080 },
        height: { ideal: 1920 }
      }
    });

    // Usa o menor zoom disponibilizado pelo aparelho. No Safari/iPhone,
    // quando o navegador não oferece controle de zoom, a composição abaixo
    // ainda mostra o quadro inteiro da câmera, sem recortar a pessoa.
    const cameraTrack = stream.getVideoTracks()[0];
    try {
      const capabilities = cameraTrack?.getCapabilities?.();
      if (capabilities?.zoom && Number.isFinite(capabilities.zoom.min)) {
        await cameraTrack.applyConstraints({ advanced: [{ zoom: capabilities.zoom.min }] });
      }
    } catch (zoomError) {
      console.warn('Controle de zoom não disponível neste aparelho:', zoomError);
    }

    video.srcObject = stream;
    videoBackdrop.srcObject = stream;
    video.classList.toggle('mirrored', facingMode === 'user');
    videoBackdrop.classList.toggle('mirrored', facingMode === 'user');
    await Promise.all([video.play(), videoBackdrop.play()]);
    $('cameraPlaceholder').hidden = true;
    setMessage('cameraMessage', 'Enquadramento aberto: você verá mais da pessoa e do ambiente.');
  } catch (error) {
    $('cameraPlaceholder').hidden = false;
    setMessage('cameraMessage', error.name === 'NotAllowedError' ? 'Permita o acesso à câmera nas configurações do navegador.' : 'Não foi possível abrir a câmera. Verifique se ela está sendo usada por outro aplicativo.');
  }
}
function stopCamera() {
  if (stream) { stream.getTracks().forEach((track) => track.stop()); stream = null; }
  video.srcObject = null;
  videoBackdrop.srcObject = null;
}
function makeComposite() {
  const width = 941, height = 1672;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Abertura transparente da moldura atual. A imagem inteira da câmera
  // aparece centralizada; as laterais recebem o mesmo ambiente desfocado,
  // evitando faixas pretas e reduzindo o efeito de zoom/corte.
  const x = 58, y = 249, photoWidth = 817, photoHeight = 894;
  const vw = video.videoWidth || 720, vh = video.videoHeight || 1280;
  const sourceRatio = vw / vh;
  const targetRatio = photoWidth / photoHeight;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, photoWidth, photoHeight);
  ctx.clip();
  if (facingMode === 'user') {
    ctx.translate(x + photoWidth, 0);
    ctx.scale(-1, 1);
  }

  // Fundo preenchido com a própria câmera, desfocado: não cria barras pretas.
  let coverW = vw, coverH = vh, coverX = 0, coverY = 0;
  if (sourceRatio > targetRatio) {
    coverW = vh * targetRatio;
    coverX = (vw - coverW) / 2;
  } else {
    coverH = vw / targetRatio;
    coverY = (vh - coverH) / 2;
  }
  ctx.filter = 'blur(22px) brightness(0.82)';
  ctx.drawImage(video, coverX, coverY, coverW, coverH, facingMode === 'user' ? 0 : x, y, photoWidth, photoHeight);

  // Foto principal sem corte: mostra a pessoa e mais do ambiente ao redor.
  const fitScale = Math.min(photoWidth / vw, photoHeight / vh);
  const fitW = vw * fitScale;
  const fitH = vh * fitScale;
  const fitX = (photoWidth - fitW) / 2;
  const fitY = y + (photoHeight - fitH) / 2;
  ctx.filter = 'none';
  ctx.drawImage(video, 0, 0, vw, vh, facingMode === 'user' ? fitX : x + fitX, fitY, fitW, fitH);
  ctx.restore();

  return new Promise((resolve, reject) => {
    const frame = new Image();
    frame.onload = () => {
      ctx.drawImage(frame, 0, 0, width, height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Falha ao gerar JPEG')), 'image/jpeg', 0.90);
    };
    frame.onerror = () => reject(new Error('Não foi possível carregar a moldura'));
    frame.src = 'assets/moldura-fazendinha-cecilia.png';
  });
}

async function capture() {
  if (!stream) { setMessage('cameraMessage', 'Primeiro, permita o acesso à câmera.'); return; }
  $('captureBtn').disabled = true;
  try {
    if (timerEnabled) {
      for (let number = 3; number > 0; number--) {
        $('countdown').hidden = false; $('countdown').textContent = number;
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      $('countdown').hidden = true;
    }
    currentPhoto = await makeComposite();
    $('saveBtn').disabled = false;
    $('saveBtn').textContent = 'Enviar para galeria';
    if (currentPhotoUrl) URL.revokeObjectURL(currentPhotoUrl);
    currentPhotoUrl = URL.createObjectURL(currentPhoto);
    $('previewImage').src = currentPhotoUrl;
    setMessage('previewMessage', 'Sua lembrança está pronta! Baixe, compartilhe ou envie para a galeria da festa.');
    showScreen('previewScreen');
  } catch (error) {
    console.error(error); setMessage('cameraMessage', 'Não foi possível criar a foto. Tente novamente.');
  } finally { $('captureBtn').disabled = false; }
}
async function uploadPhotoToCloud(blob) {
  const user = await authReadyPromise;
  if (!user || !firebaseReady) throw new Error('A conexão com a galeria online não está disponível.');
  if (blob.size > MAX_PHOTO_BYTES) throw new Error('A foto ultrapassou o limite de 8 MB.');
  const photoId = makePhotoId();
  const storagePath = `${PHOTOS_PATH}/${photoId}.jpg`;
  const fileRef = ref(storage, storagePath);
  await uploadBytes(fileRef, blob, { contentType: 'image/jpeg', cacheControl: 'public,max-age=3600' });
  const downloadURL = await getDownloadURL(fileRef);
  try {
    await addDoc(collection(db, PHOTOS_PATH), {
      storagePath,
      downloadURL,
      createdAt: serverTimestamp(),
      contentType: 'image/jpeg',
      sizeBytes: blob.size
    });
  } catch (error) {
    console.error('Falha ao registrar metadados; removendo arquivo órfão:', error);
    // O arquivo não deve ficar órfão se a gravação dos metadados falhar.
    const { deleteObject } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js');
    await deleteObject(fileRef).catch(() => {});
    throw error;
  }
}
async function renderGallery() {
  const grid = $('galleryGrid');
  grid.innerHTML = '';
  $('emptyGallery').hidden = true;
  setMessage('galleryMessage', 'Carregando as lembranças da festa...');
  try {
    const photosQuery = query(collection(db, PHOTOS_PATH), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(photosQuery);
    const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    setMessage('galleryMessage', `${items.length} fotografia(s) compartilhada(s) na galeria.`);
    $('emptyGallery').hidden = items.length > 0;
    for (const item of items) {
      if (!item.downloadURL) continue;
      const card = document.createElement('article'); card.className = 'gallery-card';
      const img = document.createElement('img'); img.src = item.downloadURL; img.alt = 'Foto da festa'; img.loading = 'lazy';
      const btn = document.createElement('button'); btn.textContent = '⬇ Baixar';
      btn.onclick = async () => {
        try {
          const response = await fetch(item.downloadURL);
          if (!response.ok) throw new Error('Download indisponível');
          downloadBlob(await response.blob(), `cecilia-${item.id}.jpg`);
        } catch (error) { window.open(item.downloadURL, '_blank', 'noopener'); }
      };
      card.append(img, btn); grid.append(card);
    }
    $('photoCount').textContent = `(${items.length} na galeria)`;
  } catch (error) {
    console.error('Erro ao carregar galeria:', error);
    setMessage('galleryMessage', 'Não foi possível carregar a galeria. Confira a conexão e as regras do Firebase.');
    $('emptyGallery').hidden = false;
  }
}
function downloadBlob(blob, name) {
  const anchor = document.createElement('a'); const url = URL.createObjectURL(blob);
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

$('startBtn').onclick = () => { showScreen('cameraScreen'); startCamera(); };
$('captureBtn').onclick = capture;
$('switchCameraBtn').onclick = () => { facingMode = facingMode === 'user' ? 'environment' : 'user'; startCamera(); };
$('timerBtn').onclick = () => { timerEnabled = !timerEnabled; $('timerBtn').textContent = timerEnabled ? '⏱ 3 segundos' : '⚡ Sem timer'; };
$('openGalleryBtn').onclick = async () => { showScreen('galleryScreen'); await renderGallery(); };
$('galleryFromCamera').onclick = async () => { stopCamera(); showScreen('galleryScreen'); await renderGallery(); };
$('backToCameraBtn').onclick = () => { showScreen('cameraScreen'); startCamera(); };
$('retakeBtn').onclick = () => { showScreen('cameraScreen'); startCamera(); };
$('downloadBtn').onclick = () => { if (currentPhoto) downloadBlob(currentPhoto, 'foto-fazendinha-da-cecilia.jpg'); };
$('saveBtn').onclick = async () => {
  if (!currentPhoto) return;
  $('saveBtn').disabled = true;
  setMessage('previewMessage', 'Enviando sua fotografia para a galeria da festa...');
  try {
    await uploadPhotoToCloud(currentPhoto);
    await savePhotoLocally(currentPhoto).catch((error) => console.warn('Cópia local não salva:', error));
    setMessage('previewMessage', 'Foto enviada para a galeria coletiva! 🌻 Obrigado por participar!');
    $('saveBtn').textContent = '✓ Enviada para a galeria';
    await updateCount();
    $('saveBtn').disabled = true;
  } catch (error) {
    console.error(error);
    setMessage('previewMessage', error.message || 'Não foi possível enviar a foto. Tente novamente ou baixe a imagem.');
    $('saveBtn').disabled = false;
  }
};
$('shareBtn').onclick = async () => {
  if (!currentPhoto) return;
  const file = new File([currentPhoto], 'foto-fazendinha-da-cecilia.jpg', { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: '1 aninho da Cecília', text: 'Uma lembrança da Fazendinha da Cecília!' }); }
    catch (error) { if (error.name !== 'AbortError') setMessage('previewMessage', 'Compartilhamento não concluído.'); }
  } else setMessage('previewMessage', 'Seu aparelho não oferece compartilhamento direto. Use “Baixar foto” e envie pelo WhatsApp.');
};
document.querySelectorAll('[data-go-home]').forEach((button) => button.onclick = () => { stopCamera(); showScreen('home'); });
document.querySelectorAll('[data-go-camera]').forEach((button) => button.onclick = () => { showScreen('cameraScreen'); startCamera(); });
window.addEventListener('pagehide', stopCamera);
updateCount();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
