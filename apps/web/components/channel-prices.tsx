'use client';
import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Field, ErrorBox, Toggle } from './ui';
export default function ChannelPrices({
  value,
  onChange,
  selected,
  onSelect,
}: {
  value: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
  selected?: string[];
  onSelect?: (v: string[]) => void;
}) {
  const [channels, setChannels] = useState<any[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    api('admin/settings')
      .then((s) => setChannels(s.channels))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <ErrorBox message={error} />
      {onSelect ? (
        <fieldset>
          <legend>Canales donde aplica (ninguno marcado = todos)</legend>
          {channels.map((c) => (
            <label className="check-row" key={c.id}>
              <Toggle
                checked={selected?.includes(c.id) || false}
                onChange={(e) =>
                  onSelect(
                    e.target.checked
                      ? [...(selected || []), c.id]
                      : (selected || []).filter((id) => id !== c.id),
                  )
                }
              />
              {c.name}
            </label>
          ))}
        </fieldset>
      ) : (
        <>
          <p className="muted small">
            Importes en pesos. Dejá vacío para usar el precio general del producto.
          </p>
          <div className="form-grid">
            {channels.map((c) => (
              <Field key={c.id} label={c.name}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Usar precio general"
                  value={value[c.id] === undefined ? '' : value[c.id] / 100}
                  onChange={(e) => {
                    const next = { ...value };
                    if (e.target.value === '') delete next[c.id];
                    else next[c.id] = Math.round(Number(e.target.value) * 100);
                    onChange(next);
                  }}
                />
              </Field>
            ))}
          </div>
        </>
      )}
    </>
  );
}
