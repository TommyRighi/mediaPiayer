import { useState, useCallback, useRef, useEffect, useId } from 'react';
import Cropper from 'react-easy-crop';

export default function ImageCropModal({ imageSrc, imageType, onCropComplete, onClose }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [aspectLocked, setAspectLocked] = useState(true);
  const canvasRef = useRef(null);
  const dialogRef = useRef(null);
  const titleId = useId();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const dialog = dialogRef.current; dialog.showModal(); return () => dialog.close(); }, []);

  const aspectRatio = imageType === 'poster' ? 2 / 3 : 16 / 9;

  const onCropChange = useCallback((_, croppedPixels) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  async function createCroppedImage() {
    if (!croppedAreaPixels || !imageSrc) return;

    setProcessing(true); setError('');
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Unable to open this image.'));
        image.src = imageSrc;
      });
      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = Math.round(croppedAreaPixels.width);
      canvas.height = Math.round(croppedAreaPixels.height);
      canvas.getContext('2d').drawImage(image, croppedAreaPixels.x, croppedAreaPixels.y, croppedAreaPixels.width, croppedAreaPixels.height, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.9));
      if (!blob) throw new Error('Unable to create the cover. Try another image.');
      await onCropComplete(blob);
    } catch (err) { setError(err.message); }
    finally { setProcessing(false); }
  }

  return (
    <dialog ref={dialogRef} className="jf-crop-dialog flex flex-col" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!processing) onClose(); }}>

      <div className="flex flex-wrap gap-3 items-center justify-between px-4 py-3" style={{ background: 'var(--jf-surface)', borderBottom: '1px solid var(--jf-divider)' }}>
        <h2 id={titleId} className="text-lg font-semibold" style={{ color: 'var(--jf-text-primary)' }}>
          Edit {imageType === 'poster' ? 'Poster' : 'Backdrop'}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--jf-text-secondary)' }}>
            <input
              type="checkbox"
              checked={aspectLocked}
              onChange={(e) => setAspectLocked(e.target.checked)}
              className="w-4 h-4 accent-red-600"
            />
            Lock aspect ratio
          </label>
          <button disabled={processing} onClick={onClose} className="jf-btn-outline" style={{ padding: '8px 16px' }}>Cancel</button>
          <button disabled={processing || !croppedAreaPixels} onClick={createCroppedImage} className="jf-btn-primary" style={{ padding: '8px 16px' }}>{processing ? 'Preparing image…' : 'Save cover'}</button>
        </div>
      </div>

      {error && <p role="alert" className="p-4">{error}</p>}
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
          aria-label="Image zoom"
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
    </dialog>
  );
}