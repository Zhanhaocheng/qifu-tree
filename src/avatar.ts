import { AVATAR_MAX_BYTES, AVATAR_PRESETS, AVATAR_SIZE, avatarError, type AvatarPresetId, type PublicUser } from '../shared/game';

/* 内置头像：项目内自绘的中国风小插画，纯内联 SVG（64x64，满版底色，外层用圆形裁切），无任何外部依赖 */
const ART: Record<AvatarPresetId, string> = {
  crane: `<rect width="64" height="64" fill="#dfeee9"/><circle cx="44" cy="20" r="9" fill="#e5503f"/><path d="M0 50q16-8 32-2t32-4v20H0z" fill="#a9c9bf"/><path d="M14 36c8-10 20-12 30-6 4 2 6 6 5 9-8-4-16-3-23 3z" fill="#fff" stroke="#6c7f86" stroke-width="1.4" stroke-linejoin="round"/><path d="M44 30c1-6 3-10 6-12" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/><path d="M44 30c1-6 3-10 6-12" fill="none" stroke="#6c7f86" stroke-width="1" stroke-linecap="round"/><circle cx="51" cy="17.5" r="3" fill="#fff" stroke="#6c7f86" stroke-width="1.2"/><path d="M50 14.6c.4-1.2 1.4-1.9 2.6-1.8" fill="none" stroke="#d8343a" stroke-width="2" stroke-linecap="round"/><path d="M53.5 18.2l5 1.2-5 1" fill="#e9a64a"/><path d="M14 36l-7 7M20 40l-8 7" stroke="#2f3b46" stroke-width="2.2" stroke-linecap="round"/><path d="M30 40v12M36 39v13" stroke="#8a6f5a" stroke-width="1.6" stroke-linecap="round"/>`,
  lotus: `<rect width="64" height="64" fill="#cfe7d6"/><ellipse cx="32" cy="52" rx="34" ry="10" fill="#8cc6a0"/><ellipse cx="14" cy="52" rx="13" ry="4" fill="#5fa57a"/><ellipse cx="52" cy="54" rx="11" ry="3.5" fill="#6fb088"/><path d="M32 50V36" stroke="#4d8f68" stroke-width="2.4" stroke-linecap="round"/><path d="M32 40c-12-2-18-10-17-17 8 1 15 7 17 17z" fill="#f8b5cf" stroke="#e58aab" stroke-width="1.2" stroke-linejoin="round"/><path d="M32 40c12-2 18-10 17-17-8 1-15 7-17 17z" fill="#f8b5cf" stroke="#e58aab" stroke-width="1.2" stroke-linejoin="round"/><path d="M32 40c-8-6-8-18 0-26 8 8 8 20 0 26z" fill="#fde0ec" stroke="#e58aab" stroke-width="1.2" stroke-linejoin="round"/><circle cx="32" cy="38" r="2.4" fill="#f2c14e"/>`,
  koi: `<rect width="64" height="64" fill="#1f4e6b"/><circle cx="32" cy="32" r="22" fill="none" stroke="#3a7799" stroke-width="1.2" opacity=".6"/><circle cx="32" cy="32" r="14" fill="none" stroke="#3a7799" stroke-width="1.2" opacity=".5"/><path d="M12 36c6-14 22-18 34-8 3 2 6 2 10-1-1 6-4 9-8 10 4 2 6 6 6 10-6-2-10-4-12-7-10 6-24 5-30-4z" fill="#f2f0e8" stroke="#fff" stroke-width="1"/><path d="M22 27c8-4 14-2 18 3-6 2-12 2-18-3z" fill="#e5503f"/><path d="M36 41c5 0 9-2 11-5 0 5-4 8-11 5z" fill="#e5503f" opacity=".85"/><circle cx="20" cy="35" r="1.8" fill="#222"/><ellipse cx="50" cy="52" rx="7" ry="3.2" fill="#3f8a5c" transform="rotate(-20 50 52)"/><ellipse cx="14" cy="14" rx="6" ry="2.8" fill="#3f8a5c" transform="rotate(25 14 14)"/>`,
  bamboo: `<rect width="64" height="64" fill="#e6efd8"/><circle cx="46" cy="18" r="10" fill="#fbf6df"/><path d="M0 52q18-10 36-3t28-2v17H0z" fill="#c7dbb0"/><g stroke="#4e8a49" stroke-width="3.6" stroke-linecap="round"><path d="M22 66V8"/><path d="M36 66V16"/></g><g stroke="#2f6a3c" stroke-width="1.6" stroke-linecap="round"><path d="M18.4 24h7.2M18.4 42h7.2M32.4 30h7.2M32.4 48h7.2"/></g><g fill="#5f9d54"><path d="M22 16c8-2 14-8 14-8-4 8-8 10-14 8z"/><path d="M22 28c-8 0-14-5-16-9 8-1 13 1 16 9z"/><path d="M36 22c8-2 12-6 14-10-8-1-12 3-14 10z"/><path d="M36 36c-6 0-10-3-12-7 7-1 11 1 12 7z"/></g>`,
  plum: `<rect width="64" height="64" fill="#f3e8e4"/><path d="M0 58c10-8 18-6 24-14 6-8 6-18 18-24 8-4 16-4 22-2" fill="none" stroke="#5a3d34" stroke-width="4.4" stroke-linecap="round"/><path d="M30 38c2 8 6 12 10 14M42 20c4-2 8-2 12 2" fill="none" stroke="#5a3d34" stroke-width="2.4" stroke-linecap="round"/><g fill="#e8527a" stroke="#fff" stroke-width=".8"><circle cx="44" cy="16" r="5"/><circle cx="52" cy="26" r="4.4"/><circle cx="22" cy="34" r="5"/><circle cx="38" cy="30" r="4"/><circle cx="14" cy="50" r="4.4"/></g><g fill="#fde48a"><circle cx="44" cy="16" r="1.5"/><circle cx="52" cy="26" r="1.3"/><circle cx="22" cy="34" r="1.5"/><circle cx="38" cy="30" r="1.2"/><circle cx="14" cy="50" r="1.3"/></g><circle cx="10" cy="14" r="3" fill="#fff" opacity=".8"/><circle cx="58" cy="46" r="2" fill="#fff" opacity=".8"/>`,
  lantern: `<rect width="64" height="64" fill="#2a1830"/><circle cx="32" cy="34" r="24" fill="#ff8a3d" opacity=".18"/><path d="M32 4v8" stroke="#c9a15a" stroke-width="2.4" stroke-linecap="round"/><rect x="21" y="11" width="22" height="5" rx="2" fill="#7a4f1c"/><ellipse cx="32" cy="32" rx="16" ry="17" fill="#e5503f"/><path d="M32 15v34M23 18q-6 14 0 28M41 18q6 14 0 28" fill="none" stroke="#ffd98a" stroke-width="1.4" opacity=".75"/><rect x="21" y="47" width="22" height="5" rx="2" fill="#7a4f1c"/><path d="M32 52v8M28 60h8M30 54v5M34 54v5" stroke="#f2c14e" stroke-width="2" stroke-linecap="round"/><text x="32" y="38" text-anchor="middle" font-size="16" font-family="'Qifu Brush','STKaiti','KaiTi',serif" fill="#ffe9b0">福</text>`,
  fu: `<rect width="64" height="64" fill="#c9362e"/><rect x="5" y="5" width="54" height="54" rx="6" fill="none" stroke="#ffe3b0" stroke-width="2.4"/><rect x="9" y="9" width="46" height="46" rx="4" fill="none" stroke="#ffe3b0" stroke-width=".9" opacity=".7"/><text x="32" y="46" text-anchor="middle" font-size="38" font-family="'Qifu Brush','STKaiti','KaiTi','Songti SC',serif" fill="#ffe9c4">福</text>`,
  cloud: `<rect width="64" height="64" fill="#2d4a73"/><circle cx="46" cy="16" r="7" fill="#f6e3a8" opacity=".9"/><g fill="none" stroke="#f7e6b6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 38a7 7 0 1 1 5-11 8 8 0 0 1 14-2 6 6 0 1 1 6 11H14z"/><path d="M30 54a5 5 0 1 1 3.5-8 6 6 0 0 1 10.5-1.5 4.6 4.6 0 1 1 4.5 9.5H30z" stroke="#e8a89c"/></g><path d="M10 48h12M44 30h12" stroke="#f7e6b6" stroke-width="2.4" stroke-linecap="round" opacity=".6"/>`,
  panda: `<rect width="64" height="64" fill="#d8ecd2"/><g fill="#2b2b30"><circle cx="16" cy="17" r="8"/><circle cx="48" cy="17" r="8"/></g><circle cx="32" cy="36" r="21" fill="#fff"/><ellipse cx="23" cy="33" rx="5.6" ry="7.4" fill="#2b2b30" transform="rotate(20 23 33)"/><ellipse cx="41" cy="33" rx="5.6" ry="7.4" fill="#2b2b30" transform="rotate(-20 41 33)"/><circle cx="24" cy="32" r="2" fill="#fff"/><circle cx="40" cy="32" r="2" fill="#fff"/><ellipse cx="32" cy="42" rx="3.4" ry="2.5" fill="#2b2b30"/><path d="M28 47q4 3 8 0" fill="none" stroke="#2b2b30" stroke-width="1.8" stroke-linecap="round"/><path d="M6 60c6-6 12-8 18-8M58 60c-6-6-12-8-18-8" stroke="#6fa968" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  rabbit: `<rect width="64" height="64" fill="#26305c"/><circle cx="32" cy="30" r="22" fill="#f8efc4"/><circle cx="32" cy="30" r="22" fill="none" stroke="#fff8dc" stroke-width="2" opacity=".6"/><g fill="#fff" stroke="#c9bfa0" stroke-width="1.2"><ellipse cx="26" cy="22" rx="3.2" ry="9" transform="rotate(-10 26 22)"/><ellipse cx="37" cy="21" rx="3.2" ry="9" transform="rotate(12 37 21)"/><ellipse cx="32" cy="39" rx="11" ry="9"/></g><g fill="#f4a3b5"><ellipse cx="26" cy="22" rx="1.4" ry="6" transform="rotate(-10 26 22)"/><ellipse cx="37" cy="21" rx="1.4" ry="6" transform="rotate(12 37 21)"/></g><circle cx="28" cy="37" r="1.4" fill="#e5503f"/><circle cx="36" cy="37" r="1.4" fill="#e5503f"/><path d="M31 41h2l-1 1.4z" fill="#f4a3b5"/><path d="M6 56c6-3 10-2 14 1M44 56c6-3 10-2 14 1" stroke="#f7e6b6" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".6"/>`,
  mountain: `<rect width="64" height="64" fill="#f2dfc4"/><circle cx="44" cy="22" r="10" fill="#e5503f" opacity=".92"/><path d="M0 46 18 22l10 14 8-10 28 28v10H0z" fill="#7f9bb3"/><path d="M18 22l6 8-5-2-4 5zM36 26l5 7-4-1-3 4z" fill="#fff" opacity=".85"/><path d="M0 52q16-6 32-2t32-2v16H0z" fill="#4f7894"/><path d="M8 58q10-3 20 0M36 60q10-3 20 0" stroke="#cfe0ea" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".7"/>`,
  coin: `<rect width="64" height="64" fill="#7a2f2a"/><circle cx="32" cy="32" r="24" fill="#d9a441" stroke="#f6dc8e" stroke-width="2.4"/><circle cx="32" cy="32" r="19.5" fill="none" stroke="#a87a22" stroke-width="1.4"/><rect x="25" y="25" width="14" height="14" rx="1.5" fill="#7a2f2a" stroke="#a87a22" stroke-width="2"/><g fill="#f6dc8e" font-size="8.5" font-family="'Qifu Kai','Songti SC',serif" text-anchor="middle"><text x="32" y="17">祈</text><text x="32" y="53">福</text><text x="13" y="35.5">平</text><text x="51" y="35.5">安</text></g>`,
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function presetSvg(id: AvatarPresetId): string {
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">${ART[id]}</svg>`;
}

export function displayName(u: Pick<PublicUser, 'nickname' | 'username'>): string {
  return u.nickname || u.username;
}

/** 头像内容（不含外层容器）：预设 SVG / 上传图片 / 首字母。非法值一律退回首字母，所以不会注入任何标记 */
export function avatarInner(avatar: string | null | undefined, name: string): string {
  if (avatar && avatarError(avatar) === null) {
    if (avatar.startsWith('preset:')) return presetSvg(avatar.slice(7) as AvatarPresetId);
    return `<img src="${avatar}" alt="" draggable="false" decoding="async" />`;
  }
  return `<b class="initial">${esc([...name][0]?.toUpperCase() ?? '?')}</b>`;
}

export function avatarEl(user: Pick<PublicUser, 'nickname' | 'username' | 'avatar'>, cls = 'avatar'): string {
  return `<span class="${cls}" aria-hidden="true">${avatarInner(user.avatar, displayName(user))}</span>`;
}

/* ------------------------------------------------------------------ 上传裁剪 */

export interface CropView {
  /** 图片自然尺寸 */
  w: number;
  h: number;
}

export interface CropState {
  zoom: number;
  /** 图片中心相对视窗中心的偏移（视窗像素） */
  x: number;
  y: number;
}

/** 视窗内「刚好铺满」的基础缩放 */
export const coverScale = (v: CropView, box: number) => box / Math.min(v.w, v.h);

/** 限制偏移，保证图片始终盖满裁剪框 */
export function clampCrop(v: CropView, box: number, s: CropState): CropState {
  const k = coverScale(v, box) * s.zoom;
  const mx = Math.max(0, (v.w * k - box) / 2);
  const my = Math.max(0, (v.h * k - box) / 2);
  return { zoom: s.zoom, x: Math.min(mx, Math.max(-mx, s.x)), y: Math.min(my, Math.max(-my, s.y)) };
}

export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty');
    return img;
  } finally {
    // decode 完成后位图已在内存，可以立即释放
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function drawCrop(ctx: CanvasRenderingContext2D, img: CanvasImageSource, v: CropView, box: number, s: CropState, out: number) {
  const k = (coverScale(v, box) * s.zoom * out) / box;
  ctx.fillStyle = '#f6efe0';
  ctx.fillRect(0, 0, out, out);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, out / 2 + (s.x * out) / box - (v.w * k) / 2, out / 2 + (s.y * out) / box - (v.h * k) / 2, v.w * k, v.h * k);
}

const dataBytes = (url: string) => {
  const b64 = url.slice(url.indexOf(',') + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
};

/** 裁剪后的 128x128 画布压缩成 WebP（不支持则 JPEG），逐步降质量直到不超过上限；失败返回 null */
export function encodeAvatar(canvas: HTMLCanvasElement): string | null {
  for (const type of ['image/webp', 'image/jpeg']) {
    for (const q of [0.88, 0.78, 0.66, 0.54, 0.42]) {
      const url = canvas.toDataURL(type, q);
      if (!url.startsWith(`data:${type};`)) break;
      if (dataBytes(url) <= AVATAR_MAX_BYTES && avatarError(url) === null) return url;
    }
  }
  return null;
}

export { AVATAR_PRESETS, AVATAR_SIZE };
