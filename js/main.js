import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- CONFIGURATION & STATE ---
const state = {
    isStarted: false,
    user: null,
    player: null,
    peers: new Map(),
    altitude: 0,
    shards: 0,
    gravity: -1,
    isDashing: false,
    lastMoveTime: 0
};

// --- GUN.JS P2P SETUP ---
const gun = Gun(['https://gun-manhattan.herokuapp.com/gun']);
const sea = Gun.SEA;
const world = gun.get('neon-eternity-v1').get('world');

// --- THREE.JS ENGINE ---
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050505, 0.05);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ReinhardToneMapping;

// Post-processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
composer.addPass(bloomPass);

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 2);
scene.add(ambientLight);
const pointLight = new THREE.PointLight(0x00ffff, 1, 100);
scene.add(pointLight);

// --- WORLD GENERATION (Vapor-City) ---
const gridHelper = new THREE.GridHelper(200, 50, 0xff00ff, 0x222222);
scene.add(gridHelper);

const platforms = [];
function createPlatform(y) {
    const geometry = new THREE.BoxGeometry(5, 0.5, 5);
    const material = new THREE.MeshPhongMaterial({ 
        color: 0x00ffff, 
        emissive: 0x00ffff, 
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.8
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((Math.random() - 0.5) * 20, y, (Math.random() - 0.5) * 20);
    scene.add(mesh);
    platforms.push(mesh);
}

for(let i=0; i<20; i++) createPlatform(i * 5);

// --- PLAYER SYSTEM ---
function createAvatar(color = 0x00ffff) {
    const group = new THREE.Group();
    const geometry = new THREE.IcosahedronGeometry(0.8, 1);
    const material = new THREE.MeshPhongMaterial({ color, wireframe: true, emissive: color, emissiveIntensity: 1 });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    
    const coreGeom = new THREE.SphereGeometry(0.4, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const core = new THREE.Mesh(coreGeom, coreMat);
    group.add(core);
    
    return group;
}

const localAvatar = createAvatar(0x00ffff);
scene.add(localAvatar);
localAvatar.position.y = 2;

// --- INPUTS (Nipple.js) ---
let moveDir = new THREE.Vector3();
const joystick = nipplejs.create({
    zone: document.getElementById('joystick-zone'),
    mode: 'static',
    position: { left: '80px', bottom: '80px' },
    color: 'cyan'
});

joystick.on('move', (evt, data) => {
    const forward = data.vector.y;
    const right = data.vector.x;
    moveDir.set(right, 0, -forward).multiplyScalar(0.2);
});

joystick.on('end', () => moveDir.set(0, 0, 0));

// --- GAMEPLAY LOGIC ---
window.addEventListener('touchstart', (e) => {
    if(e.touches.length === 2) { // Double tap / Two fingers
        state.gravity *= -1;
    }
});

function updatePhysics() {
    localAvatar.position.add(moveDir);
    localAvatar.position.y += state.gravity * 0.1;
    
    // Simple collision
    platforms.forEach(p => {
        const dist = localAvatar.position.distanceTo(p.position);
        if(dist < 2.5 && Math.abs(localAvatar.position.y - p.position.y) < 1) {
            if(state.gravity < 0 && localAvatar.position.y > p.position.y) {
                localAvatar.position.y = p.position.y + 1;
            } else if(state.gravity > 0 && localAvatar.position.y < p.position.y) {
                localAvatar.position.y = p.position.y - 1;
            }
        }
    });

    // Camera follow
    const targetCamPos = localAvatar.position.clone().add(new THREE.Vector3(0, 5, 10));
    camera.position.lerp(targetCamPos, 0.1);
    camera.lookAt(localAvatar.position);
    
    state.altitude = Math.max(state.altitude, Math.floor(localAvatar.position.y));
    document.getElementById('alt-val').textContent = state.altitude;
}

// --- NETWORK SYNC ---
function syncPosition() {
    if(!state.user) return;
    const now = Date.now();
    if(now - state.lastMoveTime > 50) {
        world.get(state.user.is.pub).put({
            x: localAvatar.position.x,
            y: localAvatar.position.y,
            z: localAvatar.position.z,
            pub: state.user.is.pub
        });
        state.lastMoveTime = now;
    }
}

world.map().on((data, id) => {
    if(!data || (state.user && id === state.user.is.pub)) return;
    let peer = state.peers.get(id);
    if(!peer) {
        peer = createAvatar(0xff00ff);
        scene.add(peer);
        state.peers.set(id, peer);
    }
    peer.position.lerp(new THREE.Vector3(data.x, data.y, data.z), 0.2);
});

// --- AUTHENTICATION ---
document.getElementById('btn-new').onclick = async () => {
    const alias = document.getElementById('alias').value;
    const pass = document.getElementById('pass').value;
    if(!alias || !pass) return alert('Enter Alias & Pass');
    
    state.user = gun.user();
    state.user.create(alias, pass, (ack) => {
        if(ack.err) return alert(ack.err);
        login(alias, pass);
    });
};

document.getElementById('btn-load').onclick = () => {
    const alias = document.getElementById('alias').value;
    const pass = document.getElementById('pass').value;
    login(alias, pass);
};

function login(alias, pass) {
    state.user = gun.user();
    state.user.auth(alias, pass, (ack) => {
        if(ack.err) return alert(ack.err);
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('game-ui').classList.remove('hidden');
        state.isStarted = true;
    });
}

// --- CHAT SYSTEM ---
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

chatInput.onkeydown = (e) => {
    if(e.key === 'Enter' && chatInput.value) {
        gun.get('chat').set({ msg: chatInput.value, user: document.getElementById('alias').value });
        chatInput.value = '';
    }
};

gun.get('chat').map().once((data) => {
    if(!data) return;
    const div = document.createElement('div');
    div.textContent = `${data.user}: ${data.msg}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

// --- MAIN LOOP ---
function animate() {
    requestAnimationFrame(animate);
    if(state.isStarted) {
        updatePhysics();
        syncPosition();
    }
    localAvatar.rotation.y += 0.01;
    state.peers.forEach(p => p.rotation.y += 0.01);
    composer.render();
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});
