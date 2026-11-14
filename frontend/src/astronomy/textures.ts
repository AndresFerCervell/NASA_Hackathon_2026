import * as THREE from 'three';

export function createEarthTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Deep ocean gradient
  const oceanGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  oceanGrad.addColorStop(0, '#133b6e');
  oceanGrad.addColorStop(0.5, '#0e4d92');
  oceanGrad.addColorStop(1, '#133b6e');
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle latitude/longitude graticule
  ctx.strokeStyle = 'rgba(130, 190, 255, 0.14)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 12; i++) {
    const x = (i / 12) * canvas.width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let j = 1; j < 6; j++) {
    const y = (j / 6) * canvas.height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Stylized landmass blobs (deterministic pseudo-continents for 3D visual reference)
  const continents: Array<[number, number, number, number, number]> = [
    // [cx, cy, rx, ry, rot]
    [220, 175, 75, 55, 0.3],   // North America
    [290, 325, 45, 75, -0.2],  // South America
    [515, 165, 55, 38, 0.1],   // Europe
    [535, 275, 60, 75, 0.15],  // Africa
    [680, 170, 130, 68, -0.1], // Asia
    [795, 345, 48, 35, 0.25],  // Australia
  ];

  ctx.fillStyle = '#2d7a5f';
  for (const [cx, cy, rx, ry, rot] of continents) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Polar ice caps
  ctx.fillStyle = 'rgba(235, 245, 255, 0.85)';
  ctx.fillRect(0, 0, canvas.width, 28);
  ctx.fillRect(0, canvas.height - 28, canvas.width, 28);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createMoonTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#b4b8c2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Dark lunar maria
  const maria: Array<[number, number, number, number]> = [
    [150, 100, 55, 38],
    [220, 90, 48, 34],
    [265, 125, 42, 32],
    [195, 150, 35, 25],
    [350, 115, 40, 28],
  ];
  ctx.fillStyle = 'rgba(90, 96, 112, 0.45)';
  for (const [x, y, rx, ry] of maria) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Deterministic craters
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 95; i++) {
    const x = rand() * canvas.width;
    const y = 20 + rand() * (canvas.height - 40);
    const r = 2 + rand() * 11;
    ctx.fillStyle = 'rgba(72, 78, 92, 0.35)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(225, 230, 240, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createSunGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255, 244, 196, 1)');
  grad.addColorStop(0.22, 'rgba(255, 198, 72, 0.75)');
  grad.addColorStop(0.55, 'rgba(255, 138, 24, 0.22)');
  grad.addColorStop(1, 'rgba(255, 110, 0, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
