import { useState, useCallback, useRef } from 'react';
import Cropper from 'react-easy-crop';

export default function ImageCropModal({ imageSrc, imageType, onCropComplete, onClose }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [aspectLocked, setAspectLocked] = useState(true);
  const canvasRef = useRef(null);

  const aspectRatio = imageType === 'poster' ? 2 / 3 : 16 / 9;

  const onCropChange = useCallback((_, croppedPixels) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  async function createCroppedImage() {
    if (!croppedAreaPixels || !imageSrc) return;

    const image = new Image();
    image.crossOrigin = 'anonymous';

    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = imageSrc;
    });

    const canvas = canvasRef.current || document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = croppedAreaPixels.width;
    canvas.height = croppedAreaPixels.height;

    ctx.drawImage(
      image,
      croppedAreaPixels.x,
      croppedAreaPixels.y,
      croppedAreaPixels.width,
      croppedAreaPixels.height,
      0,
      0,
      croppedAreaPixels.width,
      croppedAreaPixels.height
    );

    canvas.toBlob((blob) => {
      if (blob) {
        onCropComplete(blob);
      }
    }, 'image/webp', 0.9);
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ background: 'rgba(0,0,0,0.92)' }}
    >
      <div className="flex items-center justify-between px-4 py-3" style={{ background: 'var(--jf-surface)', borderBottom: '1px solid var(--jf-divider)' }}>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--jf-text-primary)' }}>
          Edit {imageType === 'poster' ? 'Poster' : 'Backdrop'}
        </h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--jf-text-secondary)' }}>
            <input
              type="checkbox"
              checked={aspectLocked}
              onChange={(e) => setAspectLocked(e.target.checked)}
              className="w-4 h-4 accent-red-600"
            />
            Lock aspect ratio
          </label>
          <button onClick={onClose} className="jf-btn-outline" style={{ padding: '8px 16px' }}>Cancel</button>
          <button onClick={createCroppedImage} className="jf-btn-primary" style={{ padding: '8px 16px' }}>Apply & Upload</button>
        </div>
      </div>

      <div className="relative flex-1" style={{ background: '#0a0a0a' }}>
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspectLocked ? aspectRatio : undefined}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropChange}
          style={{
            containerStyle: { width: '100%', height: '100%' }
          }}
        />
      </div>

      <div className="flex items-center gap-4 px-4 py-3" style={{ background: 'var(--jf-surface)', borderTop: '1px solid var(--jf-divider)' }}>
        <span className="text-sm flex-shrink-0" style={{ color: 'var(--jf-text-muted)' }}>Zoom</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="flex-1"
          style={{ accentColor: 'var(--jf-primary)' }}
        />
        <span className="text-sm w-12 text-right" style={{ color: 'var(--jf-text-secondary)' }}>
          {Math.round(zoom * 100)}%
        </span>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}