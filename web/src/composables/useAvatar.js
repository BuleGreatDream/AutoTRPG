// 头像相关的纯函数。取代旧 public/app.js 的 fillAvatar / resizeImageToDataUrl，
// 「有图显示图、无图显示名字首字」的展示逻辑改由 AvatarImg.vue 承担。

// 无头像时的占位字符：名字首字，取不到则问号
export function initialOf(name) {
  return (name || '?').trim().charAt(0);
}

/**
 * 选中的图片文件 → 居中裁剪的正方形 JPEG data URL。
 * 头像以 base64 存在 personas.avatar 列，所以前端先缩到 256px 控制体积。
 * @param {File} file
 * @param {number} [size=256] 输出边长
 * @returns {Promise<string>} data URL
 */
export function resizeImageToDataUrl(file, size = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片格式不支持'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        // 居中裁剪成正方形
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// 把人设对象转成气泡渲染用的 speaker 结构（原 app.js personaSpeaker）
export function personaSpeaker(persona) {
  if (!persona) return { personaId: 'self', name: '', avatar: null };
  return { personaId: persona.id, name: persona.name, avatar: persona.avatar || null };
}

// 说话人唯一键：判断「是否换人」（换人才显示头像/名字）。无说话人返回 null。
export function speakerKey(speaker) {
  return speaker ? (speaker.personaId ?? 'self') : null;
}
