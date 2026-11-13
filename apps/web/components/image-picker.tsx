'use client';
import { useEffect, useRef, useState } from 'react';
import { Upload, ImagePlus, Search } from 'lucide-react';
import { api } from '../lib/api';
import { ErrorBox } from './ui';
export default function ImagePicker({
  value,
  onChange,
  busyChanged,
}: {
  value: string;
  onChange: (image: string) => void;
  busyChanged: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false),
    [images, setImages] = useState<any[]>([]),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open)
      api('admin/media')
        .then(setImages)
        .catch((e) => setError(e.message));
  }, [open]);
  async function upload(file?: File) {
    if (!file) return;
    setError('');
    if (file.size > 4 * 1024 * 1024) {
      setError('Elegí una foto de hasta 4 MB');
      return;
    }
    setBusy(true);
    busyChanged(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/admin/media', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
        signal: AbortSignal.timeout(60000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'No pudimos subir la foto');
      onChange(data.image);
      setOpen(false);
    } catch (e: any) {
      setError(e.message || 'No pudimos subir la foto');
    } finally {
      setBusy(false);
      busyChanged(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <section className="image-picker">
      <span className="field-label">Foto del producto</span>
      <div className="row">
        {value ? (
          <img className="editor-photo" src={value} alt="Foto seleccionada" />
        ) : (
          <div className="photo-placeholder">
            <ImagePlus />
            Sin foto
          </div>
        )}
        <div>
          <div className="row">
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Upload size={17} />
              {busy ? 'Subiendo…' : 'Subir foto'}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => setOpen(!open)}
            >
              Elegir de la biblioteca
            </button>
          </div>
          <p className="muted small">
            JPG, PNG o WebP · hasta 6 MB. Después, guardá el producto para aplicar la foto.
          </p>
          {value && (
            <button
              className="text-action"
              type="button"
              disabled={busy}
              onClick={() => onChange('')}
            >
              Quitar foto del producto
            </button>
          )}
        </div>
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Seleccionar foto del dispositivo"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <ErrorBox message={error} />
      {open && (
        <div className="image-library">
          <label className="search">
            <Search size={16} />
            <input
              placeholder="Buscar foto…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="image-library-grid">
            {images
              .filter((i) =>
                (i.name + ' ' + i.category).toLowerCase().includes(query.toLowerCase()),
              )
              .map((i) => (
                <button
                  type="button"
                  key={i.id}
                  className={value === i.image ? 'selected' : ''}
                  onClick={() => {
                    onChange(i.image);
                    setOpen(false);
                  }}
                >
                  <img loading="lazy" src={i.image} alt={i.name} />
                  <span>{i.name}</span>
                </button>
              ))}
          </div>
          {!images.length && <p className="muted">Todavía no hay fotos disponibles.</p>}
        </div>
      )}
    </section>
  );
}
